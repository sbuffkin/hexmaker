import { describe, it } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { syncHexMapData } from "../src/maps/calloutSync";
import { mapDataLines, shownValues, type HexMapDataView } from "../src/hexMapData";
import { canDo, setModeMapLookup } from "../src/modeGate";
import type { ModeAction } from "../src/workMode";
import type { HexData } from "../src/maps/mapNote";

/**
 * syncHexMapData end to end on a fake plugin: the real method, a vault of
 * one hex note, a map store of plain maps, and the work-mode gate.
 */
function setup(opts: { mode?: string; hex?: HexData; note: (lines: string[]) => string; shown?: HexData }) {
	const path = "hexes/coast/3_4.md";
	const file = Object.assign(Object.create(TFile.prototype) as TFile, { path, name: "3_4.md", basename: "3_4", extension: "md" });
	const hexes = new Map<string, HexData>([["3_4", { ...(opts.hex ?? {}) }]]);
	const memory = new Map<string, Record<string, string>>();
	const view = (h: HexData): HexMapDataView => ({ map: "coast", mapLabel: "Coast", x: 3, y: 4, terrain: h.terrain, region: h.region, name: h.name });
	if (opts.shown) memory.set(path, shownValues(mapDataLines(view(opts.shown))));
	let content = opts.note(mapDataLines(view(opts.shown ?? opts.hex ?? {})));
	const map = { name: "coast", workMode: opts.mode ?? "build" };
	setModeMapLookup((n) => (n === "coast" ? map : undefined));
	const encounterSyncs: (string | null)[] = [];
	const fake = {
		app: {
			vault: {
				getAbstractFileByPath: (p: string) => (p === path ? file : null),
				read: async () => content,
				process: async (_f: TFile, fn: (c: string) => string) => { content = fn(content); return content; },
			},
		},
		hexPath: () => path,
		mapLabel: () => "Coast",
		calloutMemory: { ready: async () => {}, get: (p: string) => memory.get(p), set: (p: string, v: Record<string, string>) => memory.set(p, v) },
		hexMapDataView: (_m: string, _x: number, _y: number) => view(hexes.get("3_4") ?? {}),
		getMapPalette: () => [{ name: "forest", color: "#228833" }, { name: "Swamp", color: "#556633" }],
		undoableEdit: async (_m: string, fn: () => unknown) => fn(),
		setHexName: async (_m: string, _x: number, _y: number, name: string) => { hexes.set("3_4", { ...hexes.get("3_4"), name: name || undefined }); },
		syncHexEncounterTableLink: async (_p: string, t: string | null) => { encounterSyncs.push(t); },
		mapStore: {
			set: (m: string, key: string, patch: Partial<HexData>, action?: string) => {
				if (action && !canDo(m, action as ModeAction)) return false; // the real work-mode gate
				const h = { ...(hexes.get(key) ?? {}) } as Record<string, unknown>;
				for (const [k, v] of Object.entries(patch)) if (v === null || v === undefined) delete h[k]; else h[k] = v;
				hexes.set(key, h as HexData);
				return true;
			},
		},
	};
	const sync = () => syncHexMapData(fake as never, "coast", 3, 4, { quiet: true });
	return { sync, hexes, memory, content: () => content, encounterSyncs };
}

const note = (lines: string[]) => `# Hex 3, 4\n\n${lines.join("\n")}\n\nText.\n`;

describe("Map data callout phase 2, end to end (syncHexMapData)", () => {
	it("puts a hand-edited terrain on the map (palette case), then shows it", async () => {
		const s = setup({ hex: { terrain: "forest" }, shown: { terrain: "forest" }, note: (l) => note(l).replace("> Terrain: forest", "> Terrain: swamp") });
		const r = await s.sync();
		expect(r.applied).toEqual(["Terrain: swamp"]);
		expect(s.hexes.get("3_4")?.terrain).toBe("Swamp");
		expect(s.encounterSyncs).toEqual(["Swamp"]);
		expect(s.content()).toContain("> Terrain: Swamp");
		expect(s.memory.get("hexes/coast/3_4.md")?.terrain).toBe("Swamp");
		// A second pass finds nothing to do.
		expect(await s.sync()).toMatchObject({ wrote: false, applied: [], notApplied: [] });
	});

	it("in Play, a locked field is reported and kept as typed; a name still goes through", async () => {
		const s = setup({ mode: "play", hex: { terrain: "forest", name: "Oak" }, shown: { terrain: "forest", name: "Oak" },
			note: (l) => note(l).replace("> Terrain: forest", "> Terrain: swamp").replace("> Name: Oak", "> Name: Great Oak") });
		const r = await s.sync();
		expect(s.hexes.get("3_4")).toEqual({ terrain: "forest", name: "Great Oak" });
		expect(r.notApplied).toEqual(["Terrain: swamp (Switch to Build to paint terrain.)"]);
		expect(s.content()).toContain("> Terrain: forest");
		expect(s.content()).toContain("> Not applied: Terrain: swamp (Switch to Build to paint terrain.)");
	});

	it("never writes over a newer map value", async () => {
		const s = setup({ hex: { terrain: "hills" }, shown: { terrain: "forest" }, note: (l) => note(l).replace("> Terrain: forest", "> Terrain: swamp") });
		const r = await s.sync();
		expect(s.hexes.get("3_4")?.terrain).toBe("hills");
		expect(r.notApplied).toEqual(["Terrain: swamp (the map has changed it to hills since)"]);
		expect(s.content()).toContain("> Terrain: hills");
	});

	it("refreshes a stale copy without touching the map", async () => {
		const s = setup({ hex: { terrain: "hills" }, shown: { terrain: "forest" }, note });
		const r = await s.sync();
		expect(r).toMatchObject({ wrote: true, applied: [], notApplied: [] });
		expect(s.hexes.get("3_4")?.terrain).toBe("hills");
		expect(s.content()).toContain("> Terrain: hills");
	});

	it("reports a terrain the palette doesn't have", async () => {
		const s = setup({ hex: { terrain: "forest" }, shown: { terrain: "forest" }, note: (l) => note(l).replace("> Terrain: forest", "> Terrain: lava") });
		const r = await s.sync();
		expect(s.hexes.get("3_4")?.terrain).toBe("forest");
		expect(r.notApplied).toEqual(["Terrain: lava (not in this map's palette)"]);
	});

	it("NF2: moves an old **Terrain:** line into Map data (adding it), never onto the map", async () => {
		const s = setup({ hex: { terrain: "forest" }, note: () => "# Hex 3, 4\n\n**Terrain:** swamp\n\nText.\n" });
		const r = await s.sync();
		expect(r).toMatchObject({ wrote: true, applied: [], moved: ["Old terrain: swamp"] });
		expect(s.hexes.get("3_4")?.terrain).toBe("forest");
		expect(s.content()).toBe("# Hex 3, 4\n\n> [!hexmaker] Map data\n> Map: [[_coast|Coast]], hex 3, 4\n> Terrain: forest\n> Region: —\n> Name: —\n> Old terrain: swamp\n\nText.\n");
		expect(s.memory.get("hexes/coast/3_4.md")?.terrain).toBe("forest");
		// Done once: the next sync has nothing to move or write.
		expect(await s.sync()).toMatchObject({ wrote: false, moved: [] });
	});

	it("a note without a callout or old lines is left alone", async () => {
		const s = setup({ hex: { terrain: "forest" }, note: () => "# Hex 3, 4\n\n**Terrain:**\n\nText.\n" });
		expect(await s.sync()).toMatchObject({ wrote: false, moved: [] });
		expect(s.content()).toBe("# Hex 3, 4\n\n**Terrain:**\n\nText.\n");
	});
});

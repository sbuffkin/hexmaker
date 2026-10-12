/**
 * Round-5 overworld tools (owner decisions BC1, BC2, BC3, MM1):
 * - BC1: the Biome column is written for every overworld hex with a biome,
 *   readable (the biome's label), and older overworlds are filled once;
 *   the "Custom (blank)" biome makes blank regions, and new overworlds can
 *   get several blank hexes in one go.
 * - Biome painter: first placement in Build/God, a placed region's biome is
 *   God's, re-painting the same biome never regenerates, reshapes are undoable.
 * - BC2: what a pool's biomes without a climate do ("fill gaps" / "never").
 * - BC3: Coast has a climate and is placed on sea↔land borders.
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { hexDistance, hexNeighbors } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import { biomeByRef, biomeRef, isBlankBiome, representativeTerrain, setBiomeSource } from "../src/overworld/biomes";
import { allBiomesPool } from "../src/overworld/biomePool";
import { regionGenerator, routeNote, fieldsFromForm, formFromFields, formProblem, formTypes } from "../src/overworld/biomeForm";
import { biomeColumnFills, firstPassWrites, pickBlankHexes } from "../src/overworld/overworldPass";
import { parseUnclimated, placementPool, unclimatedText, worldBiomes } from "../src/overworld/worldBiomes";
import { BiomeStroke, biomePaintStep } from "../src/overworld/biomePainter";
import { paintBiomeHex, setBiomeAt } from "../src/overworld/regionsVault";
import { fillBiomeColumns } from "../src/overworld/overworldGen";
import { buildMapNote, parseMapNote, type HexData, type MapNoteData } from "../src/maps/mapNote";
import { cellPatch, type CellEdit } from "../src/undoBook";
import { PLACE_LOCKED_HINT, RESHAPE_LOCKED_HINT, TOOL_ACTIONS } from "../src/workMode";
import { toolModeLabel } from "../src/hex-map/toolMode";
import type { MapData } from "../src/types";

afterEach(() => setBiomeSource(undefined));

const hexWorld = (R: number): [number, number][] => {
	const out: [number, number][] = [];
	for (let x = 0; x <= 2 * R; x++) for (let y = 0; y <= 2 * R; y++) if (hexDistance([x, y], [R, R], "flat", "odd") <= R) out.push([x, y]);
	return out;
};
const PAL = DEFAULT_TERRAIN_PALETTE;
const terrainOf = (id: string) => representativeTerrain(id, PAL)!;

// ── a small overworld in memory (like walkNewRegion.test.ts) ─────────────

type Hex = Partial<HexData>;
function world(mode?: string) {
	const overworld = {
		name: "ow", paletteName: "Default", workMode: mode,
		gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 4, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [],
	} as unknown as MapData;
	const maps: MapData[] = [overworld];
	const store = new Map<string, Map<string, Hex>>();
	const hexes = (m: string): Map<string, Hex> => {
		let h = store.get(m);
		if (!h) store.set(m, (h = new Map()));
		return h;
	};
	let recorder: ((m: string, k: string, before: Hex | undefined) => void) | null = null;
	const write = (m: string, k: string, patch: Record<string, unknown>) => {
		recorder?.(m, k, hexes(m).get(k));
		const h: Record<string, unknown> = { ...hexes(m).get(k) };
		for (const [f, v] of Object.entries(patch)) {
			if (v === undefined || v === null || v === "" || v === false) delete h[f];
			else h[f] = v;
		}
		if (Object.keys(h).length) hexes(m).set(k, h as Hex); else hexes(m).delete(k);
	};
	const writes: string[] = [];
	const made: { name: string; cells?: Map<string, string> }[] = [];
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" } as Record<string, unknown>,
		getMap: (n: string) => maps.find((m) => m.name === n),

		rolledMapName: () => undefined,
		getMapPalette: () => PAL,
		getPaletteOrPresetTerrains: () => PAL,
		getPaletteByName: () => undefined,
		mapLabel: (n: string) => n,
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Record<string, unknown>) => { writes.push(`${m}|${k}`); write(m, k, patch); return true; },
			setMany: (m: string, cells: Iterable<[string, Record<string, unknown>]>) => { for (const [k, p] of cells) { writes.push(`${m}|${k}`); write(m, k, p); } },
			flush: async () => {},
			record: async <T>(fn: () => T | Promise<T>) => {
				const before = new Map<string, { map: string; key: string; before?: Hex }>();
				recorder = (m, k, b) => { const id = `${m}|${k}`; if (!before.has(id)) before.set(id, { map: m, key: k, before: b ? { ...b } : undefined }); };
				try {
					const result = await fn();
					return { result, cells: [...before.values()].map((c) => ({ ...c, after: hexes(c.map).get(c.key) ? { ...hexes(c.map).get(c.key) } : undefined })) };
				} finally { recorder = null; }
			},
		},
		saveSettings: async () => {},
		createNewMap: async (
			name: string, cols: number, rows: number, _palette: string, x: number, y: number, stagger: string,
			_progress: unknown, cells?: Map<string, string>, extra?: { parent?: { map: string; hex: string } },
		) => {
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, submapKind: "region", pathChains: [] } as unknown as MapData);
			for (const [k, t] of cells ?? []) hexes(slug).set(k, { terrain: t });
			made.push({ name: slug, cells });
			return { name: slug };
		},
		// The first region writes the shipped biome notes (DJ-Q4); nothing to write here.
		ensureOverworldBiomes: async () => {},
		linkRegion: async () => true,
	};
	/** A region already made on hex (x, y), painted with `terrain`. */
	const addRegion = (x: number, y: number, biome: string) => {
		const name = `ow-${x}-${y}`;
		maps.push({ name, submapKind: "region", parent: { map: "ow", hex: `${x}_${y}` }, gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 4 * x, y: 4 * y }, biome: { generator: biome }, pathChains: [] } as unknown as MapData);
		hexes("ow").set(`${x}_${y}`, { terrain: terrainOf(biome), biome: biomeRef(biome) });
		for (let i = 0; i < 4; i++) hexes(name).set(`${4 * x + i}_${4 * y}`, { terrain: terrainOf(biome) });
		return name;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, store, maps, overworld, writes, made, addRegion, hexes };
}

// ── BC1: the Biome column ─────────────────────────────────────────────────

describe("BC1: the Biome column, always", () => {
	it("first pass writes every hex's biome, by label, even when its terrain says it", () => {
		setBiomeSource(BIOME_PRESETS);
		const r = worldBiomes(hexWorld(2), "flat", "odd", PAL, { seed: 5 });
		const w = firstPassWrites(new Map(), r, biomeRef, isBlankBiome);
		expect(w.cells.length).toBe(r.biomes.size);
		for (const [k, patch] of w.cells) {
			expect(patch.biome).toBe(biomeRef(r.biomes.get(k)!));
			expect(biomeByRef(patch.biome)).toBe(r.biomes.get(k));
			expect(patch.terrain).toBe(r.terrain.get(k));
		}
		// Nothing to do the second time.
		const after = new Map(w.cells.map(([k, p]) => [k, { terrain: p.terrain ?? undefined, biome: p.biome }]));
		expect(firstPassWrites(after, r, biomeRef, isBlankBiome).cells).toEqual([]);
	});

	it("an old id-style cell is rewritten readably once, and a locked hex is kept", () => {
		setBiomeSource(BIOME_PRESETS);
		const r = { biomes: new Map([["0_0", "taiga"], ["1_0", "taiga"]]), terrain: new Map([["0_0", terrainOf("taiga")], ["1_0", terrainOf("taiga")]]) };
		const cur = new Map([["0_0", { terrain: terrainOf("taiga"), biome: "taiga" }], ["1_0", { terrain: "x", locked: true }]]);
		const w = firstPassWrites(cur, r, biomeRef, isBlankBiome);
		expect(w.cells).toEqual([["0_0", { terrain: terrainOf("taiga"), biome: "Taiga" }]]);
		expect(w.kept).toEqual(["1_0"]);
	});

	it("round-trips through the map note, and reads tolerantly", () => {
		setBiomeSource(BIOME_PRESETS);
		const data: MapNoteData = { settings: { paletteName: "Default" }, hexes: new Map<string, HexData>([["0_0", { terrain: "forest", biome: "Temperate forest" }], ["1_0", { biome: "Custom (blank)" }]]), paths: [] };
		const back = parseMapNote(buildMapNote("ow", data))!;
		expect(back.hexes.get("0_0")).toEqual({ terrain: "forest", biome: "Temperate forest" });
		expect(back.hexes.get("1_0")).toEqual({ biome: "Custom (blank)" });
		// Any spelling of a biome reads back (id, label, note name; case).
		for (const ref of ["temperate-forest", "Temperate forest", "TEMPERATE FOREST"]) expect(biomeByRef(ref)).toBe("temperate-forest");
		expect(biomeByRef("No such biome")).toBeUndefined();
	});

	it("the migration fills hexes with a biome and no cell, leaving written cells alone", () => {
		const cur = new Map<string, Hex>([["0_0", { terrain: "forest" }], ["1_0", { terrain: "forest", biome: "My own" }], ["2_0", {}]]);
		const fills = biomeColumnFills(["0_0", "1_0", "2_0"], (k) => cur.get(k), (k) => (k === "2_0" ? undefined : "taiga"), (b) => `<${b}>`);
		expect(fills).toEqual([["0_0", "<taiga>"]]);
	});

	it("fillBiomeColumns runs once per vault", async () => {
		setBiomeSource(BIOME_PRESETS);
		const w = world("play"); // the migration is not a user action: no mode gate
		w.hexes("ow").set("0_0", { terrain: terrainOf("taiga") });
		w.hexes("ow").set("1_0", { terrain: terrainOf("grassland"), biome: "ash" });
		const n = await fillBiomeColumns(w.plugin);
		expect(n).toBe(1);
		expect(w.hexes("ow").get("0_0")).toEqual({ terrain: terrainOf("taiga"), biome: "Taiga" });
		expect(w.hexes("ow").get("1_0")?.biome).toBe("ash");
		expect(w.plugin.settings.biomeColumnsFilled).toBe(true);
		w.hexes("ow").set("2_0", { terrain: terrainOf("taiga") });
		expect(await fillBiomeColumns(w.plugin)).toBe(0);
		expect(w.hexes("ow").get("2_0")?.biome).toBeUndefined();
	});
});

// ── the blank biome ───────────────────────────────────────────────────────

describe("Custom (blank) biome", () => {
	it("ships as a blank preset with no mix, outside the All biomes pool and placement", () => {
		const custom = biomePreset("custom")!;
		expect(custom.blank).toBe(true);
		expect(custom.mix).toEqual([]);
		expect(custom.climate).toBeUndefined();
		expect(allBiomesPool(BIOME_PRESETS).map((r) => r.biome)).not.toContain("Custom (blank)");
		expect(placementPool(BIOME_PRESETS).cands.map((c) => c.id)).not.toContain("custom");
		expect(placementPool(BIOME_PRESETS).fallback.map((c) => c.id)).not.toContain("custom");
	});

	it("`blank: yes` round-trips through its note, and a hand-edited value reads", () => {
		const note = buildBiomeNote(biomePreset("custom")!);
		expect(note).toContain("blank: yes");
		const back = parseBiomeNote(note, "Custom (blank)");
		expect(back.problems).toEqual([]);
		expect(back.fields.blank).toBe(true);
		expect(parseBiomeNote(note.replace("blank: yes", "blank: TRUE"), "x").fields.blank).toBe(true);
		expect(parseBiomeNote(note.replace("blank: yes", "blank: maybe"), "x").problems.map((p) => p.text)).toEqual(['blank should be yes or no, not "maybe"']);
		// Turning it off removes the key; the user's spelling is kept when it reads the same.
		expect(updateBiomeNote(note, { ...back.fields, blank: undefined }).split("\n---")[0]).not.toContain("blank:");
		const spelled = note.replace("blank: yes", "blank: true");
		expect(updateBiomeNote(spelled, back.fields)).toBe(spelled);
	});

	it("routes to a blank region; any biome can be made blank in the form (no mix needed)", () => {
		expect(regionGenerator({ blank: true, generator: "x" })).toEqual({ kind: "blank" });
		expect(routeNote({ blank: true })).toMatch(/^Blank/);
		const s = formFromFields(undefined, formTypes(PAL));
		s.label = "Unknown lands";
		expect(formProblem(s, [])).toMatch(/weight/);
		s.blank = true;
		expect(formProblem(s, [])).toBeUndefined();
		expect(fieldsFromForm(s).blank).toBe(true);
	});

	it("placing it leaves the overworld hex blank (the Biome column names it) and makes an empty region", async () => {
		setBiomeSource(BIOME_PRESETS);
		const w = world("build");
		w.hexes("ow").set("2_1", { terrain: terrainOf("taiga") });
		const r = await setBiomeAt(w.plugin, "ow", 2, 1, "custom");
		expect("name" in r).toBe(true);
		expect(w.hexes("ow").get("2_1")).toEqual({ biome: "Custom (blank)" });
		expect(w.made).toHaveLength(1);
		expect(w.made[0].cells?.size ?? 0).toBe(0);
		expect(w.maps.find((m) => m.parent?.hex === "2_1")?.biome).toEqual({ generator: "custom" });
	});

	it("remaking a region as blank (God) clears its painted cells but keeps locked ones", async () => {
		setBiomeSource(BIOME_PRESETS);
		const w = world("god");
		const name = w.addRegion(1, 1, "taiga");
		w.hexes(name).set("7_4", { terrain: "lake", locked: true });
		await setBiomeAt(w.plugin, "ow", 1, 1, "custom");
		expect([...w.hexes(name).entries()]).toEqual([["7_4", { terrain: "lake", locked: true }]]);
	});

	it("blank hexes on a new overworld: n of them, land first, spread out, the same for a seed", () => {
		const cells = hexWorld(3).map(([x, y]) => `${x}_${y}`);
		const sea = new Set(cells.slice(0, 20));
		const a = pickBlankHexes(cells, sea, 4, 7, "flat", "odd");
		expect(a).toHaveLength(4);
		expect(new Set(a).size).toBe(4);
		for (const k of a) expect(sea.has(k)).toBe(false);
		expect(pickBlankHexes(cells, sea, 4, 7, "flat", "odd")).toEqual(a);
		const pos = (k: string) => k.split("_").map(Number) as [number, number];
		expect(Math.min(...a.slice(1).map((k) => hexDistance(pos(k), pos(a[0]), "flat", "odd")))).toBeGreaterThan(1);
		// More than the land: the sea fills the rest; never more than the map.
		expect(pickBlankHexes(cells, sea, cells.length - 10, 1, "flat", "odd").filter((k) => sea.has(k))).toHaveLength(10);
		expect(pickBlankHexes(cells, sea, 999, 1, "flat", "odd")).toHaveLength(cells.length);
		expect(pickBlankHexes(cells, sea, 0, 1, "flat", "odd")).toEqual([]);
	});
});

// ── the Biome painter ─────────────────────────────────────────────────────

describe("Biome painter", () => {
	it("is a drawing tool for Build (first placements)", () => {
		expect(TOOL_ACTIONS.biome).toBe("place-biome");
		expect(toolModeLabel({ mode: "biome", erasing: false, biomeName: "Taiga" })).toMatch(/^Painting biome: Taiga/);
	});

	it("gates each hex by the map's mode: place in Build/God, change a placed one in God only", () => {
		expect(biomePaintStep({ workMode: "play" }, false, undefined, "taiga")).toEqual({ kind: "locked", hint: PLACE_LOCKED_HINT });
		expect(biomePaintStep({ workMode: "build" }, false, "grassland", "taiga")).toEqual({ kind: "place" });
		expect(biomePaintStep({ workMode: "god" }, false, undefined, "taiga")).toEqual({ kind: "place" });
		expect(biomePaintStep({ workMode: "build" }, true, "grassland", "taiga")).toEqual({ kind: "locked", hint: RESHAPE_LOCKED_HINT });
		expect(biomePaintStep({ workMode: "god" }, true, "grassland", "taiga")).toEqual({ kind: "reshape" });
	});

	it("the same biome again never regenerates, in any mode", () => {
		for (const mode of ["play", "build", "god"]) expect(biomePaintStep({ workMode: mode }, true, "taiga", "taiga")).toEqual({ kind: "skip" });
	});

	it("on the map: first placement in Build makes the region, no undo entry (it makes a map)", async () => {
		setBiomeSource(BIOME_PRESETS);
		const w = world("build");
		const r = await paintBiomeHex(w.plugin, "ow", 0, 0, "grassland");
		expect(r.step).toBe("place");
		expect(r.made).toBeTruthy();
		expect(r.edits).toBeUndefined();
		expect(w.hexes("ow").get("0_0")).toEqual({ terrain: terrainOf("grassland"), biome: "Grassland" });
	});

	it("on the map: re-painting the same biome on a region writes nothing", async () => {
		setBiomeSource(BIOME_PRESETS);
		const w = world("god");
		w.addRegion(1, 1, "taiga");
		const writes = w.writes.length;
		expect(await paintBiomeHex(w.plugin, "ow", 1, 1, "taiga")).toEqual({ step: "skip" });
		expect(w.writes.length).toBe(writes);
		expect(w.made).toEqual([]);
	});

	it("on the map: Build can't change a placed biome; God remakes it and undo puts it back", async () => {
		setBiomeSource(BIOME_PRESETS);
		const b = world("build");
		const nameB = b.addRegion(1, 1, "taiga");
		const before = [...b.hexes(nameB)];
		expect(await paintBiomeHex(b.plugin, "ow", 1, 1, "grassland")).toEqual({ step: "locked", hint: RESHAPE_LOCKED_HINT });
		expect([...b.hexes(nameB)]).toEqual(before);

		const g = world("god");
		const name = g.addRegion(1, 1, "taiga");
		const owBefore = { ...g.hexes("ow").get("1_1") };
		const r = await paintBiomeHex(g.plugin, "ow", 1, 1, "grassland");
		expect(r.step).toBe("reshape");
		expect(g.hexes("ow").get("1_1")).toEqual({ terrain: terrainOf("grassland"), biome: "Grassland" });
		const edits = r.edits as CellEdit[];
		expect(edits.some((e) => e.map === "ow" && e.key === "1_1")).toBe(true);
		expect(edits.some((e) => e.map === name)).toBe(true);
		// Undo: every recorded field back to its value before the stroke.
		for (const e of edits) g.plugin.mapStore.set(e.map, e.key, cellPatch(e, "undo"));
		expect(g.hexes("ow").get("1_1")).toEqual(owBefore);
		expect(g.hexes(name).get("4_4")).toEqual({ terrain: terrainOf("taiga") });
	});

	it("a stroke paints each hex once, in order, and gathers edits and hints", async () => {
		const order: string[] = [];
		const s = new BiomeStroke<number>(async (k) => {
			order.push(k);
			if (k === "2_0") return { step: "locked", hint: "nope" };
			if (k === "3_0") return { step: "skip" };
			return { step: "reshape", edits: [Number(k[0])] };
		});
		for (const k of ["0_0", "1_0", "0_0", "2_0", "3_0", "1_0", "2_0"]) s.add(k);
		const r = await s.finish();
		expect(order).toEqual(["0_0", "1_0", "2_0", "3_0"]);
		expect(r.edits).toEqual([0, 1]);
		expect(r.changed).toBe(2);
		expect(r.hints).toEqual(["nope"]);
	});
});

// ── BC2: pool biomes without a climate ────────────────────────────────────

describe("BC2: biomes without a climate", () => {
	const PLAIN: BiomeNoteFields = { id: "glass", label: "Glass", mix: [{ type: "desert", weight: 1 }], transitions: [] };
	const POOL = [BIOME_PRESETS.find((p) => p.id === "tundra")!, BIOME_PRESETS.find((p) => p.id === "open-sea")!, PLAIN];

	it("fill gaps (default) puts them where nothing else fits; never leaves them out", () => {
		setBiomeSource([...BIOME_PRESETS, PLAIN]);
		expect(placementPool(POOL).fallback.map((f) => f.id)).toEqual(["glass"]);
		expect(placementPool(POOL, "never").fallback).toEqual([]);
		let filled = 0;
		for (const seed of [1, 2, 3, 4, 5, 6]) {
			const fill = worldBiomes(hexWorld(3), "flat", "odd", PAL, { seed, climate: "warm", biomes: POOL });
			filled += [...fill.biomes.values()].filter((b) => b === "glass").length;
			const never = worldBiomes(hexWorld(3), "flat", "odd", PAL, { seed, climate: "warm", biomes: POOL, unclimated: "never" });
			expect([...never.biomes.values()]).not.toContain("glass");
			expect(never.biomes.size).toBe(hexWorld(3).length);
		}
		expect(filled).toBeGreaterThan(0);
	});

	it("is kept on the overworld readably and read forgivingly", () => {
		expect(unclimatedText("fill")).toBe("fill gaps");
		expect(unclimatedText("never")).toBe("never");
		for (const v of ["never", "Never", "no", "hand only", "none"]) expect(parseUnclimated(v)).toBe("never");
		for (const v of [undefined, "", "fill gaps", "fill", "gaps", "whatever"]) expect(parseUnclimated(v)).toBe("fill");
		const data: MapNoteData = { settings: { paletteName: "Default", biomeGaps: "never" }, hexes: new Map(), paths: [] };
		const note = buildMapNote("ow", data);
		expect(note).toContain("no-climate-biomes: never");
		expect(parseMapNote(note)!.settings.biomeGaps).toBe("never");
	});
});

// ── BC3: Coast on sea↔land borders ────────────────────────────────────────

describe("BC3: Coast is placed on sea↔land borders", () => {
	it("has a coastal lowland climate", () => {
		expect(biomePreset("coast")!.climate).toMatchObject({ elevation: "low", coastal: true });
	});

	it("only on land next to the sea (bar a rare boxed-in patch), and on most generated overworlds", () => {
		setBiomeSource(BIOME_PRESETS);
		let inland = 0, total = 0;
		let worlds = 0, withCoast = 0;
		for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
			for (const cells of [hexWorld(3), hexWorld(4)]) {
				const r = worldBiomes(cells, "flat", "odd", PAL, { seed, climate: "temperate", water: 0.3 });
				worlds++;
				const coast = [...r.biomes].filter(([, b]) => b === "coast").map(([k]) => k);
				if (coast.length) withCoast++;
				for (const k of coast) {
					total++;
					expect(r.sea.has(k)).toBe(false);
					const [x, y] = k.split("_").map(Number);
					if (!hexNeighbors(x, y, "flat", "odd").some(([a, b]) => r.sea.has(`${a}_${b}`))) inland++;
					expect(r.terrain.get(k)).toBe(representativeTerrain("coast", PAL));
				}
			}
		}
		expect(withCoast).toBeGreaterThan(worlds / 2);
		expect(inland).toBeLessThanOrEqual(total / 20);
	});

	it("is not placed where the palette can't paint it (no notes loaded: no terrain stands for Coast)", () => {
		for (const seed of [1, 2, 3]) {
			const r = worldBiomes(hexWorld(4), "flat", "odd", PAL, { seed, climate: "temperate", water: 0.3 });
			expect([...r.biomes.values()]).not.toContain("coast");
			for (const k of r.biomes.keys()) expect(r.terrain.has(k)).toBe(true);
		}
	});
});

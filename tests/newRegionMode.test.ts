/**
 * Edit region's new-region mode (owner 2026-10-13: "first region
 * generation … should be the full suite and let the user mix, reroll, etc
 * … at min needs a preview + confirm … Neighbor influence as a weight").
 *
 * - every entry point (an empty brick, Set biome…, New region, a walk)
 *   opens Edit region in new-region mode;
 * - the preview writes nothing; Cancel writes nothing;
 * - Create writes exactly the previewed terrain (same seed and settings);
 * - a walk keeps its direction and grows the overworld on Create only;
 * - the neighbour-influence weight changes generation, is stored readably
 *   in the region's map note and is used by rerolls;
 * - the Biome painter and arrival stay form-free.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampNeighbourWeight, paintBiomeHex, planRegionAt, regenerateRegion, storeNeighbourWeight } from "../src/overworld/regionsVault";
import { createFromDraft, draftGrowth, draftLock, newDraft, previewDraft, startBiome, type NewRegionDraft } from "../src/overworld/newRegion";
import { combinedBiome, representativeTerrain } from "../src/overworld/biomes";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { ADD_REGION_LOCKED_HINT } from "../src/workMode";
import type { MapData } from "../src/types";

type Hex = { terrain?: string; locked?: boolean; biome?: string };

function world(mode = "build") {
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
	const taiga = representativeTerrain("taiga", DEFAULT_TERRAIN_PALETTE)!;
	hexes("ow").set("1_1", { terrain: taiga });
	let writes = 0;
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap: (n: string) => maps.find((m) => m.name === n),
		rolledMapName: () => undefined,
		getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteByName: () => undefined,
		mapLabel: (n: string) => n,
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Hex) => { writes++; hexes(m).set(k, { ...hexes(m).get(k), ...patch }); },
			setMany: (m: string, cells: [string, Hex][]) => { writes++; for (const [k, h] of cells) hexes(m).set(k, { ...hexes(m).get(k), ...h }); },
			flush: async () => {},
			record: async <T>(fn: () => Promise<T>) => ({ result: await fn(), cells: [] }),
		},
		saveSettings: async () => { writes++; },
		createNewMap: async (name: string, cols: number, rows: number, _p: string, x: number, y: number, stagger: string, _pr: unknown, cells?: Map<string, string>, extra?: { parent?: { map: string; hex: string } }) => {
			writes++;
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, submapKind: "region", pathChains: [] } as unknown as MapData);
			for (const [k, t] of cells ?? []) hexes(slug).set(k, { terrain: t });
			return { name: slug };
		},
		ensureOverworldBiomes: async () => {},
		linkRegion: async (_p: string, x: number, y: number, child: string) => {
			const m = maps.find((n) => n.name === child)!;
			m.parent = { map: "ow", hex: `${x}_${y}` };
			m.submapKind = "region";
			return true;
		},
	};
	const regionOf = (hex: string) => maps.find((m) => m.submapKind === "region" && m.parent?.hex === hex);
	const terrainOf = (name: string) => new Map([...hexes(name)].filter(([, h]) => h.terrain).map(([k, h]) => [k, h.terrain!]));
	/** Everything a write would change: maps, settings and every hex. */
	const state = () => JSON.stringify({ maps, hexes: [...store].map(([m, h]) => [m, [...h]]) });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, overworld, maps, hexes, regionOf, terrainOf, state, taiga, writes: () => writes };
}

const draft = (d: Partial<NewRegionDraft>): NewRegionDraft => ({ biome: "taiga", seed: 4242, neighbourWeight: 1, ...d });

describe("new-region mode: preview, then Create makes exactly that", () => {
	it("the preview writes nothing (and so Cancel or × writes nothing)", async () => {
		const w = world();
		const before = w.state();
		const plan = await previewDraft(w.plugin, "ow", 0, 0, draft({ biome: "swamp", neighbourWeight: 1.6, blend: "wide", warp: 0.3 }));
		expect(plan?.cells.size).toBeGreaterThan(0);
		expect(w.state()).toBe(before);
		expect(w.writes()).toBe(0);
		expect(w.regionOf("0_0")).toBeUndefined();
	});

	it("Create writes exactly the previewed terrain, with its seed, open", async () => {
		const w = world();
		const d = draft({ biome: "grassland", seed: 777 });
		const plan = (await previewDraft(w.plugin, "ow", 0, 0, d))!;
		const res = await createFromDraft(w.plugin, "ow", 0, 0, d);
		expect(res).toMatchObject({ grew: false });
		const r = w.regionOf("0_0")!;
		expect([...w.terrainOf(r.name)].sort()).toEqual([...plan.cells].sort());
		expect(r.regionSeed).toBe(777);
		expect(r.arrival).toBe("open");
		// The overworld hex now has the biome (its Biome column and terrain).
		expect(w.hexes("ow").get("0_0")?.terrain).toBe(representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE));
	});

	it("a mix, a blend, borders and a neighbour weight: still exactly the preview (next to a made region)", async () => {
		const w = world();
		await createFromDraft(w.plugin, "ow", 1, 1, draft({ biome: "taiga", seed: 1 }));
		const mix = combinedBiome([{ id: "swamp", weight: 2 }, { id: "grassland", weight: 1 }]);
		const d = draft({ biome: mix, seed: 99, blend: "narrow", warp: 0.4, neighbourWeight: 1.7, name: "Fenmark" });
		const plan = (await previewDraft(w.plugin, "ow", 1, 0, d))!;
		const res = await createFromDraft(w.plugin, "ow", 1, 0, d);
		expect(res).toMatchObject({ name: "fenmark" });
		const r = w.regionOf("1_0")!;
		expect([...w.terrainOf(r.name)].sort()).toEqual([...plan.cells].sort());
		expect(r.neighbourInfluence).toBe(1.7);
	});

	it("starts on the hex's overworld biome", () => {
		const w = world();
		expect(startBiome(w.plugin, "ow", 1, 1)).toBe("taiga");
		expect(newDraft(w.plugin, "ow", 1, 1, undefined, 5)).toEqual({ biome: "taiga", seed: 5, neighbourWeight: 1 });
	});

	it("Play: Create is locked and writes nothing", async () => {
		const w = world("play");
		expect(draftLock(w.plugin, "ow")).toBe(ADD_REGION_LOCKED_HINT);
		const before = w.state();
		expect(await createFromDraft(w.plugin, "ow", 0, 0, draft({}))).toEqual({ error: ADD_REGION_LOCKED_HINT });
		expect(w.state()).toBe(before);
	});

	it("God may make one too (extending never needs God, but God isn't refused)", () => {
		expect(draftLock(world("god").plugin, "ow")).toBeUndefined();
		expect(draftLock(world("build").plugin, "ow")).toBeUndefined();
	});
});

describe("new-region mode: walking into new land", () => {
	it("starts on the biome walked from, grows the overworld only on Create, and makes the preview", async () => {
		const w = world();
		// The overworld fills unpainted hexes with a base terrain: a grown column counts in the blend.
		(w.overworld as { baseTerrain?: string }).baseTerrain = representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE);
		await createFromDraft(w.plugin, "ow", 2, 1, draft({ biome: "swamp", seed: 3 }));
		const from = w.regionOf("2_1")!.name;
		const walk = { from, bearing: "east" };
		expect(startBiome(w.plugin, "ow", 3, 1, walk)).toBe("swamp");
		expect(draftGrowth(w.plugin, "ow", 3, 1)).not.toBeNull();
		const d = { ...newDraft(w.plugin, "ow", 3, 1, walk, 31), neighbourWeight: 0.5 };
		const before = w.state();
		const plan = (await previewDraft(w.plugin, "ow", 3, 1, d))!;
		expect(w.state()).toBe(before);
		expect(w.overworld.gridSize).toEqual({ cols: 3, rows: 3 });
		const res = await createFromDraft(w.plugin, "ow", 3, 1, d, walk);
		expect(res).toMatchObject({ grew: true });
		expect(w.overworld.gridSize.cols).toBe(4);
		const r = w.regionOf("3_1")!;
		expect([...w.terrainOf(r.name)].sort()).toEqual([...plan.cells].sort());
		expect(r.neighbourInfluence).toBe(0.5);
	});

	it("a walk in Play is refused with the walk's hint", async () => {
		const w = world();
		await createFromDraft(w.plugin, "ow", 2, 1, draft({}));
		const from = w.regionOf("2_1")!;
		from.workMode = "play";
		const lock = draftLock(w.plugin, "ow", { from: from.name, bearing: "east" });
		expect(lock).toBe(ADD_REGION_LOCKED_HINT);
	});
});

describe("Neighbour influence: a per-region weight on the biome's tuning", () => {
	it("is clamped to 0–2, 1 when unset", () => {
		expect(clampNeighbourWeight(undefined)).toBe(1);
		expect(clampNeighbourWeight(Number.NaN)).toBe(1);
		expect(clampNeighbourWeight(-1)).toBe(0);
		expect(clampNeighbourWeight(5)).toBe(2);
		expect(clampNeighbourWeight(1.25)).toBe(1.25);
	});

	it("changes generation next to a made region (0 vs 2), and 1 is the biome as tuned", async () => {
		const w = world();
		await createFromDraft(w.plugin, "ow", 1, 1, draft({ biome: "taiga", seed: 8 }));
		const at = (neighbourWeight?: number) => [...(planRegionAt(w.plugin, "ow", 1, 0, { biome: "swamp", seed: 5, hexTerrain: representativeTerrain("swamp", DEFAULT_TERRAIN_PALETTE), neighbourWeight })!.cells)].sort().join(",");
		expect(at(0)).not.toBe(at(2));
		expect(at(1)).toBe(at(undefined));
	});

	it("is written to the region's map note only when not 1, and read back", () => {
		const r = { name: "r" } as MapData;
		storeNeighbourWeight(r, 1.5);
		expect(r.neighbourInfluence).toBe(1.5);
		const note = buildMapNote("r", { settings: { paletteName: "Default", neighbourInfluence: 1.5 }, hexes: new Map(), paths: [] });
		expect(note).toMatch(/^neighbour-influence: 1\.5$/m);
		expect(parseMapNote(note)!.settings.neighbourInfluence).toBe(1.5);
		storeNeighbourWeight(r, 1);
		expect(r.neighbourInfluence).toBeUndefined();
		expect(buildMapNote("r", { settings: { paletteName: "Default" }, hexes: new Map(), paths: [] })).not.toMatch(/neighbour-influence/);
	});

	it("rerolls and regenerates use the stored weight; Regenerate may change it", async () => {
		const w = world();
		await createFromDraft(w.plugin, "ow", 1, 1, draft({ biome: "taiga", seed: 8 }));
		await createFromDraft(w.plugin, "ow", 1, 0, draft({ biome: "swamp", seed: 5, neighbourWeight: 2 }));
		const r = w.regionOf("1_0")!;
		const swamp = representativeTerrain("swamp", DEFAULT_TERRAIN_PALETTE);
		const expected = (weight: number, seed: number) => [...planRegionAt(w.plugin, "ow", 1, 0, { biome: "swamp", seed, hexTerrain: swamp, neighbourWeight: weight })!.cells].sort();
		// A reroll (a new seed, no weight given) keeps the region's weight.
		await regenerateRegion(w.plugin, r.name, { seed: 6 });
		expect(r.neighbourInfluence).toBe(2);
		expect([...w.terrainOf(r.name)].sort()).toEqual(expected(2, 6));
		// The slider in Edit region: a new weight, same seed.
		await regenerateRegion(w.plugin, r.name, { neighbourWeight: 0 });
		expect(r.neighbourInfluence).toBe(0);
		expect([...w.terrainOf(r.name)].sort()).toEqual(expected(0, 6));
		await regenerateRegion(w.plugin, r.name, { neighbourWeight: 1 });
		expect(r.neighbourInfluence).toBeUndefined();
	});
});

describe("unchanged: the Biome painter and arrival stay form-free", () => {
	it("the Biome painter makes the region in one click (open, so it can be edited after)", async () => {
		const w = world();
		const res = await paintBiomeHex(w.plugin, "ow", 2, 2, "swamp");
		expect(res).toMatchObject({ step: "place" });
		expect(w.regionOf("2_2")?.arrival).toBe("open");
	});

	it("arrival makes its region with no dialog", () => {
		const src = read("src", "arrival", "ArrivalService.ts");
		expect(src).not.toMatch(/EditRegionModal|WalkRegionModal|Modal\(/);
	});
});

const read = (...p: string[]) => readFileSync(join(...p), "utf8").replace(/\r\n/g, "\n");

describe("every entry point opens Edit region in new-region mode", () => {
	const view = read("src", "hex-map", "HexMapView.ts");

	it("an empty brick (Regions or Biomes view) and Set biome… on an empty hex", () => {
		expect(view).toMatch(/act\.kind === "place"\) this\.openNewRegion\(px, py\)/);
		expect(view).toMatch(/it\.id === "set-biome"\) this\.openNewRegion\(px, py\)/);
		expect(view).toMatch(/private openNewRegion\(px: number, py: number\): void \{[\s\S]{0,200}new wm\.EditRegionModal\([^;]*, px, py, \{\}\)\.open\(\)/);
		expect(view).not.toMatch(/BiomePickerModal/);
	});

	it("walking into new land from the map (region flower, d-pad) and from the hex editor's neighbour flower", () => {
		expect(view).toMatch(/new wm\.EditRegionModal\(host, to\.overworld, to\.px, to\.py, \{ walk: \{ from, bearing: to\.bearing \}/);
		const editor = read("src", "hex-map", "HexEditorModal.ts");
		expect(editor).toMatch(/new wm\.EditRegionModal\(host, home\.overworld\.name, px, py, \{\s*walk: \{ from: this\.mapName, bearing \}/);
		// The old walk form is gone (WalkRegionModal is the side-by-side worlds' only).
		const walk = read("src", "overworld", "WalkRegionModal.ts");
		expect(walk).not.toMatch(/renderOverworld|walkIntoHex/);
	});

	it("the hex menu's New region card", () => {
		expect(read("src", "hex-map", "newChildMap.ts")).toMatch(/new wm\.EditRegionModal\([\s\S]*?parentMap, x, y, \{ after: "close"/);
	});

	it("only Create writes: Cancel and × just close", () => {
		const modal = read("src", "overworld", "EditRegionModal.ts");
		expect(modal.match(/createFromDraft\(/g)?.length).toBe(1);
		expect(modal).toMatch(/private async create\([^)]*\): Promise<void> \{[\s\S]*?createFromDraft\(/);
		expect(modal).toMatch(/\{ text: "Cancel" \}\)\.addEventListener\("click", \(\) => this\.close\(\)\)/);
	});
});

/**
 * New regions start open (owner 2026-10-12: "reroll should be enabled for
 * the newest sector when build is on"). Every way of making a region marks
 * it `arrival: open` (the state places made on arrival already use, GM4):
 * while open, Build may reroll it, change its biome and its settings; Lock
 * makes that God's. Regions made before (no `arrival` key) count as locked.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { canChangeRegion, CHANGE_OPEN_REGION_HINT, isOpenPlace, regionChangeAction, RESHAPE_LOCKED_HINT } from "../src/workMode";
import { createRegion, generateMissingRegions, regenerateRegion, reshapeGate, reshapeLock, setBiomeAt, walkIntoHex } from "../src/overworld/regionsVault";
import { finishNewOverworld } from "../src/overworld/overworldGen";
import { biomePaintStep } from "../src/overworld/biomePainter";
import { BIOME_LOCKED_HINT, editRegionPlan } from "../src/overworld/overworldInput";
import { representativeTerrain } from "../src/overworld/biomes";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { MapData } from "../src/types";
import type { NewMapOptions } from "../src/services/MapsService";

type Hex = { terrain?: string; locked?: boolean; biome?: string };

function world(mode = "build") {
	const overworld = {
		name: "ow", paletteName: "Default", workMode: mode,
		gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 4, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [],
	} as unknown as MapData;
	// Made before this change: no `arrival` key.
	const old = { name: "ow-1-1", submapKind: "region", parent: { map: "ow", hex: "1_1" }, gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 4, y: 6 }, world: { id: "w1", cx: 1, cy: 1 } } as unknown as MapData;
	const maps: MapData[] = [overworld, old];
	const store = new Map<string, Map<string, Hex>>();
	const hexes = (m: string): Map<string, Hex> => {
		let h = store.get(m);
		if (!h) store.set(m, (h = new Map()));
		return h;
	};
	const taiga = representativeTerrain("taiga", DEFAULT_TERRAIN_PALETTE)!;
	hexes("ow").set("1_1", { terrain: taiga });
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap: (n: string) => maps.find((m) => m.name === n),
		rolledMapName: () => undefined,
		getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
		mapLabel: (n: string) => n,
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Hex) => { hexes(m).set(k, { ...hexes(m).get(k), ...patch }); },
			setMany: (m: string, cells: [string, Hex][]) => { for (const [k, h] of cells) hexes(m).set(k, { ...hexes(m).get(k), ...h }); },
			flush: async () => {},
		},
		saveSettings: async () => {},
		createNewMap: async (opts: NewMapOptions) => {
			const { name, cols, rows, stagger, terrain: cells } = opts;
			const x = opts.offset?.x ?? 0, y = opts.offset?.y ?? 0, extra = opts;
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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, overworld, old, maps, hexes, regionOf, taiga };
}

describe("new regions start open: every way of making one", () => {
	it("createRegion (Set biome on an empty brick's form, New region)", async () => {
		const w = world();
		const r = await createRegion(w.plugin, "ow", 0, 0, { fill: "match", biome: "taiga" });
		expect("name" in r).toBe(true);
		expect(w.regionOf("0_0")!.arrival).toBe("open");
	});

	it("setBiomeAt (the biome picker, the Biome painter's first placement)", async () => {
		const w = world();
		await setBiomeAt(w.plugin, "ow", 2, 0, "grassland");
		expect(w.regionOf("2_0")!.arrival).toBe("open");
	});

	it("walk into new land", async () => {
		const w = world();
		const r = await walkIntoHex(w.plugin, "ow", 3, 1, "swamp", { seed: 2 });
		expect(r).toMatchObject({ grew: true });
		expect(w.regionOf("3_1")!.arrival).toBe("open");
	});

	it("make every region (New overworld's \"make every region now\", Generate missing regions)", async () => {
		const w = world();
		w.hexes("ow").set("0_1", { terrain: w.taiga });
		w.hexes("ow").set("2_2", { terrain: w.taiga });
		const r = await generateMissingRegions(w.plugin, "ow");
		expect(r.errors).toEqual([]);
		expect(r.made.length).toBe(2);
		for (const name of r.made) expect(w.plugin.getMap(name).arrival).toBe("open");
	});

	it("finishNewOverworld with makeAll (the wizard's Biomes scale, New overworld…)", async () => {
		const w = world();
		w.hexes("ow").set("0_0", { terrain: w.taiga });
		const r = await finishNewOverworld(w.plugin, "ow", undefined, {
			regionSize: 4, blend: "normal", palette: "Default", stagger: "odd", seed: 1, unclimated: "skip" as never,
			makeAll: true, cells: [[0, 0]],
		});
		expect(r?.errors).toEqual([]);
		expect(r?.made.length).toBe(1);
		expect(w.regionOf("0_0")!.arrival).toBe("open");
	});

	it("is written to the region's map note as `arrival: open` and read back", () => {
		const note = buildMapNote("r", { settings: { paletteName: "Default", arrival: "open" }, hexes: new Map(), paths: [] });
		expect(note).toMatch(/^arrival: open$/m);
		expect(parseMapNote(note)!.settings.arrival).toBe("open");
	});
});

describe("open regions: Build may change them until they're locked", () => {
	it("the policy: open → placing (Build), locked or old → reshaping (God)", () => {
		expect(isOpenPlace({ arrival: "open" })).toBe(true);
		expect(isOpenPlace({ arrival: " Open " })).toBe(true);
		expect(isOpenPlace({ arrival: "locked" })).toBe(false);
		expect(isOpenPlace({})).toBe(false);
		expect(regionChangeAction({ arrival: "open" })).toBe("place-biome");
		expect(regionChangeAction({ arrival: "locked" })).toBe("reshape");
		expect(regionChangeAction({})).toBe("reshape");
		expect(canChangeRegion({ workMode: "build" }, { arrival: "open" })).toBe(true);
		expect(canChangeRegion({ workMode: "play" }, { arrival: "open" })).toBe(false);
		expect(canChangeRegion({ workMode: "build" }, { arrival: "locked" })).toBe(false);
		expect(canChangeRegion({ workMode: "god" }, { arrival: "locked" })).toBe(true);
	});

	it("Build can reroll an open region but not a locked one; Lock makes it God's", async () => {
		const w = world("build");
		await setBiomeAt(w.plugin, "ow", 0, 0, "taiga");
		const r = w.regionOf("0_0")!;
		expect(reshapeGate(w.plugin, "ow", 0, 0)).toBe("allowed");
		// A reroll (new seed) goes through in Build.
		await regenerateRegion(w.plugin, r.name, { seed: 12345 });
		expect(r.regionSeed).toBe(12345);
		// Lock (ArrivalService.lock writes this).
		r.arrival = "locked";
		expect(reshapeGate(w.plugin, "ow", 0, 0)).toBe("locked");
		expect(reshapeLock(w.plugin, "ow", 0, 0)).toBe(RESHAPE_LOCKED_HINT);
		expect(await regenerateRegion(w.plugin, r.name, { seed: 999 })).toBe(0);
		expect(r.regionSeed).toBe(12345);
		// God still may.
		w.overworld.workMode = "god";
		expect(reshapeGate(w.plugin, "ow", 0, 0)).toBe("allowed");
	});

	it("regions made before this change (no `arrival` key) count as locked and aren't opened", async () => {
		const w = world("build");
		expect(w.old.arrival).toBeUndefined();
		expect(reshapeGate(w.plugin, "ow", 1, 1)).toBe("locked");
		expect(await regenerateRegion(w.plugin, "ow-1-1", { seed: 5 })).toBe(0);
		// Making another region doesn't touch it.
		await setBiomeAt(w.plugin, "ow", 0, 0, "taiga");
		expect(w.old.arrival).toBeUndefined();
	});

	it("Play: an open region's biome stays Build's (Reroll on the map view's bar follows GM4)", () => {
		const w = world("play");
		w.old.arrival = "open";
		expect(reshapeLock(w.plugin, "ow", 1, 1)).toBe(CHANGE_OPEN_REGION_HINT);
	});

	it("the Biome painter remakes an open region in Build, not a locked one", () => {
		expect(biomePaintStep({ workMode: "build" }, true, "grassland", "taiga", { arrival: "open" })).toEqual({ kind: "reshape" });
		expect(biomePaintStep({ workMode: "build" }, true, "grassland", "taiga", { arrival: "locked" })).toEqual({ kind: "locked", hint: RESHAPE_LOCKED_HINT });
		expect(biomePaintStep({ workMode: "build" }, true, "grassland", "taiga")).toEqual({ kind: "locked", hint: RESHAPE_LOCKED_HINT });
	});

	it("Edit region…: Reroll, Settings… and Lock in Build while open; read-only once locked", () => {
		expect(editRegionPlan({ workMode: "build" }, { arrival: "open" })).toEqual({ biome: "pick", reroll: true, settings: true, lock: true });
		expect(editRegionPlan({ workMode: "build" }, { arrival: "locked" })).toEqual({ biome: "show", reroll: false, settings: false, lock: false, hint: BIOME_LOCKED_HINT });
		expect(editRegionPlan({ workMode: "build" }, {})).toEqual({ biome: "show", reroll: false, settings: false, lock: false, hint: BIOME_LOCKED_HINT });
		expect(editRegionPlan({ workMode: "play" }, { arrival: "open" })).toEqual({ biome: "show", reroll: false, settings: false, lock: true, hint: CHANGE_OPEN_REGION_HINT });
		expect(editRegionPlan({ workMode: "god" }, { arrival: "locked" })).toEqual({ biome: "pick", reroll: true, settings: true, lock: false });
	});
});

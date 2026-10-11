/**
 * Walking into new land from a region (owner: "when you go from region to
 * region walking you should be able to pick or roll for what the NEXT biome
 * is"): the region flower's empty petals, the d-pad's empty sides, rolling a
 * biome from a seed, and making the region, growing the overworld when the
 * hex lies past its grid.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { flowerPetals, neighbourButton } from "../src/maps/mapNav";
import { gridToInclude, rollBiome } from "../src/overworld/regionWorld";
import { inOverworldGrid, walkIntoHex, walkLock } from "../src/overworld/regionsVault";
import { representativeTerrain } from "../src/overworld/biomes";
import { ADD_REGION_LOCKED_HINT } from "../src/workMode";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { MapData } from "../src/types";

const LOCK = { lockedHint: ADD_REGION_LOCKED_HINT };

describe("region flower petals and d-pad sides", () => {
	it("a petal with a region goes there", () => {
		const b = neighbourButton("north-east", { name: "ow-2-1", label: "Pinewood" }, { canMake: true, canAdd: true, ...LOCK });
		expect(b).toEqual({ action: { kind: "go", target: "ow-2-1" }, plus: false, disabled: false, title: "North-east: Pinewood" });
	});

	it("an empty petal is a + that walks into new land, named by its direction", () => {
		const b = neighbourButton("south-west", undefined, { canMake: true, canAdd: true, inGrid: true, ...LOCK });
		expect(b.action).toEqual({ kind: "new", grows: false });
		expect(b.plus).toBe(true);
		expect(b.disabled).toBe(false);
		expect(b.title).toBe("New region to the south-west");
	});

	it("an empty petal past the overworld's grid grows it", () => {
		const b = neighbourButton("north", undefined, { canMake: true, canAdd: true, inGrid: false, ...LOCK });
		expect(b.action).toEqual({ kind: "new", grows: true });
	});

	it("in Play the + stays but is locked, and says to switch to Build", () => {
		const b = neighbourButton("east", undefined, { canMake: true, canAdd: false, ...LOCK });
		expect(b.action).toEqual({ kind: "locked", hint: "Switch to Build to make a region." });
		expect(b.plus).toBe(true);
		expect(b.disabled).toBe(true);
		expect(b.title).toBe("New region to the east. Switch to Build to make a region.");
	});

	it("Play still goes to regions that are there", () => {
		const b = neighbourButton("east", { name: "r", label: "R" }, { canMake: true, canAdd: false, ...LOCK });
		expect(b.action).toEqual({ kind: "go", target: "r" });
		expect(b.disabled).toBe(false);
	});

	it("a side where nothing can be made stays a plain disabled arrow", () => {
		const b = neighbourButton("west", undefined, { canMake: false, canAdd: true, ...LOCK });
		expect(b).toEqual({ action: { kind: "none" }, plus: false, disabled: true, title: "West: nothing there" });
	});

	it("every petal of the flower has a direction to name its +", () => {
		for (const o of ["flat", "pointy"] as const) {
			const petals = flowerPetals(o, "odd", 2, 3);
			expect(petals).toHaveLength(6);
			for (const p of petals) {
				expect(neighbourButton(p.bearing, undefined, { canMake: true, canAdd: true, ...LOCK }).title).toMatch(/^New region to the [a-z-]+$/);
			}
		}
	});
});

describe("rolling the next biome", () => {
	const ids = ["taiga", "grassland", "swamp", "alpine"];
	it("is repeatable: the same seed rolls the same biome", () => {
		for (const seed of [1, 42, 123456789, 4294967295]) expect(rollBiome(ids, seed)).toBe(rollBiome(ids, seed));
	});
	it("avoids the biome walked from when there is another", () => {
		for (let seed = 0; seed < 200; seed++) expect(rollBiome(ids, seed, "taiga")).not.toBe("taiga");
		expect(rollBiome(["taiga"], 7, "taiga")).toBe("taiga");
		expect(rollBiome([], 7)).toBeUndefined();
	});
	it("reaches every other biome over many seeds", () => {
		const seen = new Set<string>();
		for (let seed = 0; seed < 400; seed++) seen.add(rollBiome(ids, seed, "taiga")!);
		expect([...seen].sort()).toEqual(["alpine", "grassland", "swamp"]);
	});
});

describe("growing the overworld to take a hex in", () => {
	const off = { x: 0, y: 0 }, size = { cols: 5, rows: 5 };
	it("is null inside the grid", () => {
		expect(gridToInclude(off, size, 0, 0)).toBeNull();
		expect(gridToInclude(off, size, 4, 4)).toBeNull();
	});
	it("grows by one column or row toward the hex, keeping hex numbers", () => {
		expect(gridToInclude(off, size, 5, 2)).toEqual({ offset: { x: 0, y: 0 }, size: { cols: 6, rows: 5 } });
		expect(gridToInclude(off, size, -1, 2)).toEqual({ offset: { x: -1, y: 0 }, size: { cols: 6, rows: 5 } });
		expect(gridToInclude(off, size, 2, -1)).toEqual({ offset: { x: 0, y: -1 }, size: { cols: 5, rows: 6 } });
		expect(gridToInclude(off, size, -1, 5)).toEqual({ offset: { x: -1, y: 0 }, size: { cols: 6, rows: 6 } });
	});
});

describe("walkIntoHex: making the next region", () => {
	type Hex = { terrain?: string; locked?: boolean };
	function world(mode?: string) {
		const overworld = {
			name: "ow", paletteName: "Default", workMode: mode,
			gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
			regions: { footprint: "rect", size: 4, blend: "normal", worldId: "w1", stagger: "odd" },
			pathChains: [],
		} as unknown as MapData;
		const here = { name: "ow-1-1", submapKind: "region", parent: { map: "ow", hex: "1_1" }, gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 4, y: 6 } } as unknown as MapData;
		const maps: MapData[] = [overworld, here];
		const store = new Map<string, Map<string, Hex>>();
		const hexes = (m: string): Map<string, Hex> => {
			let h = store.get(m);
			if (!h) store.set(m, (h = new Map()));
			return h;
		};
		hexes("ow").set("1_1", { terrain: representativeTerrain("taiga", DEFAULT_TERRAIN_PALETTE)! });
		const writes: string[] = [];
		const made: { name: string; cols: number; rows: number; cells?: Map<string, string> }[] = [];
		const plugin = {
			settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
			getMap: (n: string) => maps.find((m) => m.name === n),
			getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
			getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
			mapLabel: (n: string) => n,
			mapStore: {
				get: (m: string, k: string) => store.get(m)?.get(k),
				all: (m: string) => hexes(m),
				set: (m: string, k: string, patch: Hex) => {
					writes.push(`${m}|${k}`);
					hexes(m).set(k, { ...hexes(m).get(k), ...patch });
				},
				setMany: (m: string) => writes.push(m),
				flush: async () => {},
			},
			saveSettings: async () => {},
			createNewMap: async (
				name: string, cols: number, rows: number, _palette: string, x: number, y: number, stagger: string,
				_progress: unknown, cells?: Map<string, string>, extra?: { parent?: { map: string; hex: string } },
			) => {
				const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
				maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, submapKind: "region", pathChains: [] } as unknown as MapData);
				for (const [k, t] of cells ?? []) hexes(slug).set(k, { terrain: t });
				made.push({ name: slug, cols, rows, cells });
				return { name: slug };
			},
			// The first region writes the shipped biome notes (DJ-Q4); nothing to write here.
			ensureOverworldBiomes: async () => {},
			linkRegion: async () => true,
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return { plugin: plugin as any, store, overworld, maps, writes, made };
	}

	it("in Play nothing is made or grown", async () => {
		const w = world("play");
		expect(await walkIntoHex(w.plugin, "ow", 3, 1, "grassland")).toEqual({ error: ADD_REGION_LOCKED_HINT });
		expect(w.overworld.gridSize).toEqual({ cols: 3, rows: 3 });
		expect(w.writes).toEqual([]);
		expect(w.made).toEqual([]);
	});

	it("a hex inside the overworld with no region gets the biome and its region", async () => {
		const w = world("build");
		const r = await walkIntoHex(w.plugin, "ow", 2, 1, "grassland", { seed: 99, name: "Plains" });
		expect(r).toEqual({ name: "plains", grew: false });
		expect(w.overworld.gridSize).toEqual({ cols: 3, rows: 3 });
		expect(w.store.get("ow")?.get("2_1")?.terrain).toBe(representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE));
		const child = w.maps.find((m) => m.name === "plains")!;
		expect(child.parent).toEqual({ map: "ow", hex: "2_1" });
		expect(child.world).toEqual({ id: "w1", cx: 2, cy: 1 });
		expect(child.regionSeed).toBe(99);
		expect(w.made[0].cols).toBe(4);
		// Generated from the blend field ("match"), not blank. (The shipped
		// biome models aren't loaded in unit tests, so the cells' content is
		// checked in the sandbox run instead.)
		expect(w.made[0].cells).toBeInstanceOf(Map);
	});

	it("a hex past the overworld's edge grows the overworld first, then makes the region", async () => {
		const w = world("god");
		expect(inOverworldGrid(w.overworld, 3, 1)).toBe(false);
		const r = await walkIntoHex(w.plugin, "ow", 3, 1, "swamp", { seed: 5 });
		expect(r).toMatchObject({ grew: true });
		expect(w.overworld.gridSize).toEqual({ cols: 4, rows: 3 });
		expect(w.overworld.gridOffset).toEqual({ x: 0, y: 0 });
		expect(inOverworldGrid(w.overworld, 3, 1)).toBe(true);
		expect(w.store.get("ow")?.get("3_1")?.terrain).toBe(representativeTerrain("swamp", DEFAULT_TERRAIN_PALETTE));
		expect(w.maps.find((m) => m.parent?.hex === "3_1")?.world).toEqual({ id: "w1", cx: 3, cy: 1 });
	});

	it("growing west keeps every hex number (regions keep their slots)", async () => {
		const w = world("build");
		const r = await walkIntoHex(w.plugin, "ow", -1, 1, "alpine", { seed: 1 });
		expect(r).toMatchObject({ grew: true });
		expect(w.overworld.gridOffset).toEqual({ x: -1, y: 0 });
		expect(w.overworld.gridSize).toEqual({ cols: 4, rows: 3 });
		expect(w.maps.find((m) => m.name === "ow-1-1")!.parent).toEqual({ map: "ow", hex: "1_1" });
	});

	it("the region you walk from counts too: Play there locks it, and the overworld's Play is named", async () => {
		const w = world("build");
		w.maps.find((m) => m.name === "ow-1-1")!.workMode = "play";
		expect(walkLock(w.plugin, "ow-1-1", "ow")).toBe(ADD_REGION_LOCKED_HINT);
		expect(await walkIntoHex(w.plugin, "ow", 2, 1, "grassland", { from: "ow-1-1" })).toEqual({ error: ADD_REGION_LOCKED_HINT });
		expect(w.made).toEqual([]);
		const v = world("play");
		expect(walkLock(v.plugin, "ow-1-1", "ow")).toBe("Switch ow to Build to make a region.");
		expect(walkLock(world("god").plugin, "ow-1-1", "ow")).toBeUndefined();
	});

	it("a hex that already has a region is refused (changing it is God's biome swap)", async () => {
		const w = world("god");
		const r = await walkIntoHex(w.plugin, "ow", 1, 1, "swamp");
		expect(r).toEqual({ error: "That hex's region is ow-1-1." });
		expect(w.writes).toEqual([]);
	});
});

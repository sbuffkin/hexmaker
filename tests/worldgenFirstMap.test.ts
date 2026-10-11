import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_SETTINGS, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_PATH_TYPES, SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS, SYSTEM_PATH_TYPES } from "../src/palettes/presets";
import {
	OVERLAND_OPTIONS,
	maxLakeSize,
	mountainQuantile,
	overlandDescription,
	planetRoles,
	sideSeaMask,
	planetSurface,
	resolveSeaSide,
	seaSideFromNeighbours,
	OVERLAND_ID,
} from "../src/worldgen/procedural/planetSurface";
import { STAR_SCATTER_ID } from "../src/worldgen/procedural/starScatter";
import { BLANK_ID, firstMapGenerator, generationKey, kindOptions, listGeneratorKinds, optionsWithDefaults } from "../src/worldgen/registry";
import { ORBITS_ID } from "../src/worldgen/procedural/orbits";
import { NO_PATHS, ORBIT_TYPE_KEY, PRESET_PATH_TYPE, ROUTE_TYPE_KEY, chosenPathType, defaultPathTypeFor } from "../src/worldgen/generatorPathTypes";
import { generatedToMapPaths, routedBranches } from "../src/paths/fromGenerated";
import { mapRouteContext, pathTypeStyleFor } from "../src/paths/mapContext";
import { defaultPaletteFor, paletteHint, repointPaletteName, resolveDefaultPalette, resolveExpandedDefault } from "../src/palettes/paletteOptions";
import { isUnusedPlaceholderMap } from "../src/setupPlaceholder";
import { neighbourSeaText } from "../src/worldgen/NewMapSetupModal";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import { hexNeighbors } from "../packages/hex-wfc/src";
import type { PathType, TerrainColor } from "../src/types";
import { worldTypesSource } from "../src/space/worldTypesSource";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";

const DEFAULT_SPACE = { name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS };

/** Fresh-eyes 2026-10-09 (#36): first-run wizard, Overland, Frozen, palette defaults. */

const grid: ProcGrid = { cols: 20, rows: 14, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const overland = (seed: number, options: Record<string, string>, terrains: TerrainColor[] = DEFAULT_TERRAIN_PALETTE) =>
	planetSurface(terrains, grid, seed, options, undefined, "overland").cells;

const typeOf = (terrains: TerrainColor[]) => new Map(terrains.map((t) => [t.name, t.type]));
const WET_TYPES = new Set(["water", "deep-water", "shallows"]);
const isWet = (types: Map<string, string | undefined>) => (t: string | undefined) => !!t && WET_TYPES.has(types.get(t) ?? "");

/** Share of `cells` in the hexes picked by `where` that satisfy `pred`, averaged over seeds. */
function share(
	gen: (seed: number) => Map<string, string>,
	where: (x: number, y: number) => boolean,
	pred: (t: string | undefined) => boolean,
): number {
	let hit = 0, n = 0;
	for (const seed of SEEDS) {
		const cells = gen(seed);
		for (let x = 0; x < grid.cols; x++)
			for (let y = 0; y < grid.rows; y++) {
				if (!where(x, y)) continue;
				n++;
				if (pred(cells.get(`${x}_${y}`))) hit++;
			}
	}
	return hit / n;
}

describe("Overland: a region, not a planet", () => {
	const roles = planetRoles(DEFAULT_TERRAIN_PALETTE)!;
	const edgeRows = (_x: number, y: number) => y === 0 || y === grid.rows - 1;

	it("has no polar ice on its top and bottom rows (temperate)", () => {
		const icy = share((s) => overland(s, { climate: "temperate", sea: "scattered" }), edgeRows, (t) => t === roles.snow);
		expect(icy).toBe(0);
	});

	it("Planet surface keeps its polar caps", () => {
		const icy = share((s) => planetSurface(DEFAULT_TERRAIN_PALETTE, grid, s, { climate: "temperate" }).cells, edgeRows, (t) => t === roles.snow);
		expect(icy).toBeGreaterThan(0.2);
	});

	it("puts the sea along the chosen side", () => {
		const wet = isWet(typeOf(DEFAULT_TERRAIN_PALETTE));
		const bands: Record<string, [(x: number, y: number) => boolean, (x: number, y: number) => boolean]> = {
			west: [(x) => x < 3, (x) => x >= grid.cols - 3],
			east: [(x) => x >= grid.cols - 3, (x) => x < 3],
			north: [(_x, y) => y < 2, (_x, y) => y >= grid.rows - 2],
			south: [(_x, y) => y >= grid.rows - 2, (_x, y) => y < 2],
		};
		for (const [side, [near, far]] of Object.entries(bands)) {
			const gen = (s: number) => overland(s, { water: "30", sea: side });
			expect(share(gen, near, wet)).toBeGreaterThan(0.7);
			expect(share(gen, far, wet)).toBeLessThan(0.1);
		}
	});

	it("'around' makes an island; 'none' has no sea", () => {
		const wet = isWet(typeOf(DEFAULT_TERRAIN_PALETTE));
		const border = (x: number, y: number) => x === 0 || y === 0 || x === grid.cols - 1 || y === grid.rows - 1;
		const middle = (x: number, y: number) => Math.abs(x - grid.cols / 2) < 3 && Math.abs(y - grid.rows / 2) < 2;
		const island = (s: number) => overland(s, { water: "50", sea: "around" });
		expect(share(island, border, wet)).toBeGreaterThan(0.8);
		expect(share(island, middle, wet)).toBeLessThan(0.1);
		expect(share((s) => overland(s, { water: "50", sea: "none" }), () => true, wet)).toBe(0);
	});

	it("'none' still makes ordinary land (no all-snow map from the lapse rate)", () => {
		const cells = overland(3, { water: "50", sea: "none", climate: "temperate" });
		const snow = [...cells.values()].filter((t) => t === roles.snow).length;
		expect(snow / cells.size).toBeLessThan(0.05);
		expect(cells.size).toBe(grid.cols * grid.rows);
	});

	it("still hits the water fraction with a sea side", () => {
		const wet = isWet(typeOf(DEFAULT_TERRAIN_PALETTE));
		for (const water of ["10", "50", "85"]) {
			const frac = share((s) => overland(s, { water, sea: "east" }), () => true, wet);
			expect(frac).toBeGreaterThanOrEqual(Number(water) / 100 - 0.06);
		}
	});

	it("the Sea option defaults to a random side, picked from the seed", () => {
		const opt = OVERLAND_OPTIONS.find((o) => o.key === "sea")!;
		expect(opt.default).toBe("random");
		const sides = new Set(SEEDS.map((s) => resolveSeaSide("random", s)));
		for (const s of sides) expect(["north", "east", "south", "west"]).toContain(s);
		expect(sides.size).toBeGreaterThan(1);
		expect(resolveSeaSide("random", 7)).toBe(resolveSeaSide(undefined, 7));
		expect(resolveSeaSide("west", 7)).toBe("west");
		expect(resolveSeaSide("bogus", 7)).toBe(resolveSeaSide("random", 7));
	});

	it("is deterministic per seed", () => {
		expect([...overland(9, {})]).toEqual([...overland(9, {})]);
	});
});

/** Fresh-eyes round 3 (2026-10-09): Sea = West streaked water inland; a Temperate map grew a big desert. */
describe("Overland round 3: the sea stays on its side, temperate has no desert", () => {
	const big: ProcGrid = { cols: 20, rows: 16, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
	const MANY = Array.from({ length: 30 }, (_, i) => i + 1);
	const run = (seed: number, options: Record<string, string>, terrains: TerrainColor[] = LIMITED_TERRAIN_PALETTE) =>
		planetSurface(terrains, big, seed, options, undefined, "overland").cells;

	/** Water bodies (hex-connected), each with whether it touches `edge`. */
	function waterBodies(cells: Map<string, string>, wet: (t: string | undefined) => boolean, edge: (x: number, y: number) => boolean) {
		const seen = new Set<string>();
		const bodies: { size: number; onEdge: boolean }[] = [];
		for (const [k, t] of cells) {
			if (!wet(t) || seen.has(k)) continue;
			const stack = [k.split("_").map(Number) as [number, number]];
			seen.add(k);
			let size = 0, onEdge = false;
			while (stack.length) {
				const [x, y] = stack.pop()!;
				size++;
				if (edge(x, y)) onEdge = true;
				for (const [nx, ny] of hexNeighbors(x, y, big.orientation, big.stagger)) {
					const nk = `${nx}_${ny}`;
					if (cells.has(nk) && !seen.has(nk) && wet(cells.get(nk))) { seen.add(nk); stack.push([nx, ny]); }
				}
			}
			bodies.push({ size, onEdge });
		}
		return bodies;
	}

	const SIDE_EDGE: Record<string, (x: number, y: number) => boolean> = {
		west: (x) => x === 0,
		east: (x) => x === big.cols - 1,
		north: (_x, y) => y === 0,
		south: (_x, y) => y === big.rows - 1,
	};
	/** The half of the map away from the sea. */
	const FAR_HALF: Record<string, (x: number, y: number) => boolean> = {
		west: (x) => x >= big.cols / 2,
		east: (x) => x < big.cols / 2,
		north: (_x, y) => y >= big.rows / 2,
		south: (_x, y) => y < big.rows / 2,
	};

	for (const [label, terrains] of [["Limited", LIMITED_TERRAIN_PALETTE], ["Expanded", DEFAULT_TERRAIN_PALETTE]] as const) {
		it(`${label}: one sea on the chosen side; other water is only small lakes`, () => {
			const wet = isWet(typeOf(terrains));
			const lakeMax = maxLakeSize(big.cols * big.rows);
			for (const side of Object.keys(SIDE_EDGE)) {
				for (const seed of MANY) {
					const cells = run(seed, { water: "30", climate: "temperate", sea: side }, terrains);
					const bodies = waterBodies(cells, wet, SIDE_EDGE[side]);
					const seas = bodies.filter((b) => b.onEdge);
					expect(seas.length).toBe(1);
					for (const lake of bodies.filter((b) => !b.onEdge)) expect(lake.size).toBeLessThanOrEqual(lakeMax);
				}
			}
		});
	}

	it("no water streaks into the far half (30% water)", () => {
		const wet = isWet(typeOf(LIMITED_TERRAIN_PALETTE));
		for (const side of Object.keys(SIDE_EDGE)) {
			let far = 0, n = 0;
			for (const seed of MANY) {
				const cells = run(seed, { water: "30", sea: side });
				for (const [k, t] of cells) {
					const [x, y] = k.split("_").map(Number);
					if (!FAR_HALF[side](x, y)) continue;
					n++;
					if (wet(t)) far++;
				}
			}
			expect(far / n).toBeLessThan(0.02);
		}
	});

	it("keeps the water share with the sea on a side", () => {
		const wet = isWet(typeOf(LIMITED_TERRAIN_PALETTE));
		for (const water of ["10", "30", "65"]) {
			for (const seed of MANY.slice(0, 8)) {
				const cells = run(seed, { water, sea: "west" });
				const frac = [...cells.values()].filter(wet).length / cells.size;
				expect(Math.abs(frac - Number(water) / 100)).toBeLessThan(0.02);
			}
		}
	});

	for (const [label, terrains] of [["Limited", LIMITED_TERRAIN_PALETTE], ["Expanded", DEFAULT_TERRAIN_PALETTE]] as const) {
		it(`${label}: Temperate and Lush regions grow no desert; Arid still does`, () => {
			const deserts = new Set(terrains.filter((t) => t.type === "desert").map((t) => t.name));
			const desertShare = (climate: string) => {
				let d = 0, n = 0;
				for (const seed of MANY) {
					for (const sea of ["west", "random", "scattered", "none"]) {
						for (const t of run(seed, { water: "30", climate, sea }, terrains).values()) { n++; if (deserts.has(t)) d++; }
					}
				}
				return d / n;
			};
			expect(desertShare("temperate")).toBe(0);
			expect(desertShare("lush")).toBe(0);
			expect(desertShare("arid")).toBeGreaterThan(0.15);
		});
	}

	it("Planet surface (a whole world) keeps its desert belts", () => {
		let d = 0;
		for (const seed of MANY) {
			for (const t of planetSurface(LIMITED_TERRAIN_PALETTE, big, seed, { water: "30", climate: "temperate" }).cells.values()) if (t === "desert") d++;
		}
		expect(d).toBeGreaterThan(0);
	});
});

describe("sideSeaMask", () => {
	// A 6×1 strip: neighbours are left/right.
	const keys: [number, number][] = [0, 1, 2, 3, 4, 5].map((x) => [x, 0]);
	const strip = (x: number, _y: number): [number, number][] => [[x - 1, 0], [x + 1, 0]];
	const west = (x: number) => x === 0;

	it("keeps a small inland lake", () => {
		// Lowest four: 0 (on the sea edge) and 3,4,5, a 3-hex body (maxLakeSize = 3).
		const water = sideSeaMask(keys, [0, 0.9, 0.95, 0.1, 0.1, 0.1], 4, west, strip);
		expect(water).toEqual([true, false, false, true, true, true]);
	});

	it("drops a big inland body and grows the sea from the coast instead", () => {
		const long: [number, number][] = Array.from({ length: 10 }, (_, x) => [x, 0]);
		// Lowest six: 0 (edge) and 5..9, a 5-hex body: too big for a lake.
		const field = [0, 0.6, 0.7, 0.8, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1];
		const water = sideSeaMask(long, field, 6, west, strip);
		expect(water).toEqual([true, true, true, true, true, true, false, false, false, false]);
	});

	it("hits the target exactly and always touches the sea edge", () => {
		const field = [0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
		const water = sideSeaMask(keys, field, 2, west, strip);
		expect(water.filter(Boolean).length).toBe(2);
		expect(water[0]).toBe(true);
	});

	it("zero target → no water", () => {
		expect(sideSeaMask(keys, [0, 0, 0, 0, 0, 0], 0, west, strip).some(Boolean)).toBe(false);
	});
});

describe("Frozen climate: no temperate belt", () => {
	const GREEN = new Set(["forest", "jungle", "grassland", "wetland"]);
	for (const [label, terrains] of [["Expanded", DEFAULT_TERRAIN_PALETTE], ["Limited", LIMITED_TERRAIN_PALETTE]] as const) {
		it(`Planet surface and Overland on ${label}: no forest, grass or swamp`, () => {
			const types = typeOf(terrains);
			for (const seed of SEEDS) {
				const runs = [
					planetSurface(terrains, grid, seed, { water: "30", climate: "frozen" }).cells,
					planetSurface(terrains, grid, seed, { water: "30", climate: "frozen" }, undefined, "overland").cells,
				];
				for (const cells of runs) {
					for (const t of cells.values()) expect(GREEN.has(types.get(t) ?? "")).toBe(false);
				}
			}
		});
	}

	it("temperate still grows forests (the fix is frozen-only)", () => {
		const types = typeOf(DEFAULT_TERRAIN_PALETTE);
		const forest = share((s) => planetSurface(DEFAULT_TERRAIN_PALETTE, grid, s, { water: "30", climate: "temperate" }).cells,
			() => true, (t) => types.get(t ?? "") === "forest");
		expect(forest).toBeGreaterThan(0.05);
	});
});

describe("defaultPaletteFor (new-map palette by map type)", () => {
	const pal = (name: string, terrains: TerrainColor[]) => ({ name, terrains });
	const fresh = [pal("Limited", LIMITED_TERRAIN_PALETTE), pal("Expanded", DEFAULT_TERRAIN_PALETTE)];

	it("uses the Palette for new maps setting (seeded with Expanded, G7b), else the first overland palette", () => {
		const d = "Expanded";
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: fresh, defaultPalette: d })).toBe("Expanded");
		expect(defaultPaletteFor({ mapKinds: ["world", "space"], terrainPalettes: fresh, defaultPalette: d })).toBe("Expanded");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Space - Sector", SPACE_SECTOR_TERRAINS), ...fresh], defaultPalette: d })).toBe("Expanded");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Mine", LIMITED_TERRAIN_PALETTE), pal("Limited", LIMITED_TERRAIN_PALETTE)], defaultPalette: d })).toBe("Mine");
		// Unset: the first overland palette, whatever it is called.
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: fresh })).toBe("Limited");
	});

	it("no palette is special by name: any palette can be the default, renamed or not", () => {
		const mine = [pal("Crayons", LIMITED_TERRAIN_PALETTE), pal("Big box", DEFAULT_TERRAIN_PALETTE)];
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: mine, defaultPalette: "Big box" })).toBe("Big box");
		// A setting naming a deleted palette falls back to the first palette, not to a name.
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: mine, defaultPalette: "Expanded" })).toBe("Crayons");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: mine, defaultPalette: "Gone" })).toBe("Crayons");
		// A space palette as the default while space is off: skipped.
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Stars", SPACE_SECTOR_TERRAINS), ...mine], defaultPalette: "Stars" })).toBe("Crayons");
	});

	it("with every palette deleted, still picks something", () => {
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [] })).toBe("Expanded");
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: [] })).toBe("Space - Sector");
	});

	it("a rename repoints maps, the default and child palettes", () => {
		const settings = {
			maps: [{ paletteName: "Sector" }, { paletteName: "Other" }],
			defaultPalette: "Sector",
			terrainPalettes: [{ childPalette: "Sector", submapDefaults: { a: { palette: "Sector" }, b: { palette: "X" } } }],
		};
		repointPaletteName(settings, "Sector", "Galaxy");
		expect(settings.maps.map((m) => m.paletteName)).toEqual(["Galaxy", "Other"]);
		expect(settings.defaultPalette).toBe("Galaxy");
		expect(settings.terrainPalettes[0].childPalette).toBe("Galaxy");
		expect(settings.terrainPalettes[0].submapDefaults.a.palette).toBe("Galaxy");
		expect(settings.terrainPalettes[0].submapDefaults.b.palette).toBe("X");
	});

	it("a fresh install starts on Expanded", () => {
		expect(DEFAULT_SETTINGS.terrainPalettes[0].name).toBe("Expanded");
		expect(DEFAULT_SETTINGS.maps[0].paletteName).toBe("Expanded");
		expect(defaultPaletteFor(DEFAULT_SETTINGS)).toBe("Expanded");
	});

	it("says what Limited and Expanded are for", () => {
		expect(paletteHint("Limited")).toMatch(/fewer, simpler terrains; quicker to paint/);
		expect(paletteHint("Expanded")).toMatch(/coasts/);
		expect(paletteHint("Space - Sector")).toBe("");
	});

	it("space-only users get their first space palette, else the first space preset", () => {
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: fresh, defaultPalette: "Expanded" })).toBe("Space - Sector");
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: [...fresh, pal("Space - System", SPACE_SYSTEM_TERRAINS)] })).toBe("Space - System");
		expect(defaultPaletteFor({
			mapKinds: ["space"],
			terrainPalettes: [...fresh, pal("Space - System", SPACE_SYSTEM_TERRAINS), pal("Space - Sector", SPACE_SECTOR_TERRAINS)],
			defaultPalette: "Space - Sector",
		})).toBe("Space - Sector");
	});

	it("world users with no overland palette installed get the first overland preset", () => {
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Space - Sector", SPACE_SECTOR_TERRAINS)] })).toBe("Expanded");
	});

	// GEN1 = B: Expanded is the default for new installs only.
	it("existing installs keep their first overland palette even with Expanded installed", () => {
		const existing = [pal("Limited", LIMITED_TERRAIN_PALETTE), pal("Expanded", DEFAULT_TERRAIN_PALETTE)];
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: existing, defaultPalette: resolveDefaultPalette({ hexFolder: "x" }) })).toBe("Limited");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: existing, defaultPalette: resolveDefaultPalette(null) })).toBe("Expanded");
		// Space users are unaffected either way.
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: existing, defaultPalette: "" })).toBe("Space - Sector");
	});

	it("fresh install vs update is decided from the raw saved data, and a saved answer wins", () => {
		expect(resolveExpandedDefault(null)).toBe(true);
		expect(resolveExpandedDefault({})).toBe(true);
		expect(resolveExpandedDefault({ hexFolder: "world/hexes", maps: [] })).toBe(false);
		expect(resolveExpandedDefault({ hexFolder: "x", expandedByDefault: true })).toBe(true);
		expect(resolveExpandedDefault({ expandedByDefault: false })).toBe(false);
		// The setting is seeded from it once, then the saved value wins.
		expect(resolveDefaultPalette(null)).toBe("Expanded");
		expect(resolveDefaultPalette({ hexFolder: "x" })).toBe("");
		expect(resolveDefaultPalette({ hexFolder: "x", expandedByDefault: true })).toBe("Expanded");
		expect(resolveDefaultPalette({ defaultPalette: "Crayons", expandedByDefault: true })).toBe("Crayons");
		expect(resolveDefaultPalette({ defaultPalette: "" })).toBe("");
	});
});

describe("firstMapGenerator (setup wizard default)", () => {
	const k = (...ids: string[]) => ids.map((id) => ({ id }));

	it("world → Overland, space only → Star scatter", () => {
		expect(firstMapGenerator(k(BLANK_ID, OVERLAND_ID), ["world"])).toBe(OVERLAND_ID);
		expect(firstMapGenerator(k(BLANK_ID, OVERLAND_ID, STAR_SCATTER_ID), ["world", "space"])).toBe(OVERLAND_ID);
		expect(firstMapGenerator(k(BLANK_ID, STAR_SCATTER_ID), ["space"])).toBe(STAR_SCATTER_ID);
	});

	it("follows the palette: a space palette for a world+space user → Star scatter", () => {
		expect(firstMapGenerator(k(BLANK_ID, STAR_SCATTER_ID), ["world", "space"])).toBe(STAR_SCATTER_ID);
	});

	it("falls back to Blank", () => {
		expect(firstMapGenerator(k(BLANK_ID), ["world"])).toBe(BLANK_ID);
		expect(firstMapGenerator([], ["space"])).toBe(BLANK_ID);
	});
});

describe("generationKey (create exactly the previewed map)", () => {
	const base = {
		generatorId: OVERLAND_ID, options: { water: "30", sea: "west" }, seed: 42,
		cols: 20, rows: 16, orientation: "flat", stagger: "odd", palette: "Limited",
	};

	it("is the same for the same run, whatever the option order", () => {
		expect(generationKey(base)).toBe(generationKey({ ...base, options: { sea: "west", water: "30" } }));
	});

	it("changes with anything the run reads", () => {
		const k = generationKey(base);
		for (const change of [
			{ seed: 43 }, { options: { water: "30", sea: "east" } }, { cols: 21 }, { rows: 15 },
			{ orientation: "pointy" }, { stagger: "even" }, { palette: "Expanded" }, { generatorId: BLANK_ID },
			{ extra: "next to thornwood (east)" },
		]) expect(generationKey({ ...base, ...change })).not.toBe(k);
	});

	it("a preview run and a create run with the same key give the same map", () => {
		const run = () => planetSurface(LIMITED_TERRAIN_PALETTE, { ...grid, cols: 20, rows: 16 }, base.seed, base.options, undefined, "overland").cells;
		expect([...run()]).toEqual([...run()]);
	});
});

describe("isUnusedPlaceholderMap (the shipped 'default' map)", () => {
	const map = { name: "default", pathChains: [] };
	const unused = { hexCount: 0, folderEntries: ["_default.md"], referenced: false };

	it("an untouched default (just its map note, or no folder) is a placeholder", () => {
		expect(isUnusedPlaceholderMap(map, unused)).toBe(true);
		expect(isUnusedPlaceholderMap(map, { ...unused, folderEntries: [] })).toBe(true);
	});

	it("any use keeps it", () => {
		expect(isUnusedPlaceholderMap({ ...map, name: "my-world" }, unused)).toBe(false);
		expect(isUnusedPlaceholderMap(map, { ...unused, hexCount: 1 })).toBe(false);
		expect(isUnusedPlaceholderMap(map, { ...unused, folderEntries: ["_default.md", "3_4.md"] })).toBe(false);
		expect(isUnusedPlaceholderMap(map, { ...unused, referenced: true })).toBe(false);
		expect(isUnusedPlaceholderMap({ ...map, pathChains: [{ typeName: "Road", hexes: ["1_1"] }] }, unused)).toBe(false);
		expect(isUnusedPlaceholderMap({ ...map, world: { id: "w", cx: 0, cy: 0 } }, unused)).toBe(false);
	});
});

describe("Overland relief (fresh-eyes r4: Normal is not a mountain range)", () => {
	const HIGH = new Set(["mountains", "peaks"]);
	for (const [label, pal] of [["Limited", LIMITED_TERRAIN_PALETTE], ["Expanded", DEFAULT_TERRAIN_PALETTE]] as const) {
		const types = typeOf(pal);
		const high = (t: string | undefined) => !!t && HIGH.has(types.get(t) ?? "");
		const hill = (t: string | undefined) => !!t && types.get(t) === "hills";
		const all = () => true;
		const run = (relief: string, water: string) => (s: number) => overland(s, { relief, water, sea: "west" }, pal);

		it(`${label}: Normal keeps mountains to a minority (≤ 8% of the map) at every water level and seed`, () => {
			for (const water of ["10", "30", "50"]) {
				for (const seed of SEEDS) {
					const cells = run("normal", water)(seed);
					const n = [...cells.values()].filter(high).length;
					expect(n / cells.size).toBeLessThanOrEqual(0.08);
				}
			}
		});

		it(`${label}: Normal has more hills than mountains; Rugged stays the mountainous choice; Flat the least`, () => {
			const normal = share(run("normal", "30"), all, high);
			expect(share(run("normal", "30"), all, hill)).toBeGreaterThan(normal * 1.5);
			expect(share(run("rugged", "30"), all, high)).toBeGreaterThan(normal * 2);
			expect(share(run("flat", "30"), all, high)).toBeLessThan(normal);
			expect(normal).toBeGreaterThan(0.02); // still some mountains
		});
	}

	it("a whole planet (Planet surface) keeps its old Normal", () => {
		expect(mountainQuantile("normal", "planet")).toBe(0.87);
		expect(mountainQuantile("normal", "overland")).toBeGreaterThan(0.9);
		expect(mountainQuantile("rugged", "overland")).toBe(mountainQuantile("rugged", "planet"));
	});
});

describe("Overland description follows the palette (fresh-eyes r4)", () => {
	it("Limited has no coast terrain, so the card doesn't promise a coast", () => {
		const text = overlandDescription(LIMITED_TERRAIN_PALETTE);
		expect(text).not.toMatch(/coast/i);
		expect(text).toMatch(/sea/);
		expect(text).toMatch(/hills and mountains|hills, mountains/);
	});

	it("Expanded has a beach / coast terrain, so it says coast", () => {
		expect(overlandDescription(DEFAULT_TERRAIN_PALETTE)).toMatch(/coast/);
	});

	it("only names terrain kinds the palette has", () => {
		const tiny: TerrainColor[] = [
			{ name: "ocean", color: "#00f", type: "water" },
			{ name: "grass", color: "#0f0", type: "grassland" },
		];
		expect(overlandDescription(tiny)).toMatch(/^A region from noise: sea and plains\. /);
	});
});

describe("Overland Sea default next to a neighbour (fresh-eyes r4)", () => {
	// The new map sits east of its neighbour: its west seam is x = 9.
	const g = { cols: 10, rows: 8, offset: { x: 10, y: 0 } };
	const seam = (wetAt: (y: number) => boolean) =>
		new Map(Array.from({ length: 8 }, (_, y) => [`9_${y}`, wetAt(y) ? { terrain: "ocean", type: "water" } : { terrain: "grass", type: "grassland" }] as const));

	it("a seam that's mostly water puts the sea on that side", () => {
		expect(seaSideFromNeighbours(g, seam(() => true))).toEqual({ side: "west", why: "edge", seam: "west" });
		expect(seaSideFromNeighbours(g, seam((y) => y !== 3))?.side).toBe("west");
	});

	it("a coast meeting one end of the seam runs the sea along that side, not toward the neighbour", () => {
		expect(seaSideFromNeighbours(g, seam((y) => y >= 6))).toEqual({ side: "south", why: "end", seam: "west" });
		expect(seaSideFromNeighbours(g, seam((y) => y <= 1))?.side).toBe("north");
	});

	it("no water on the seam → no sea; water only mid-seam → scattered", () => {
		expect(seaSideFromNeighbours(g, seam(() => false))).toEqual({ side: "none", why: "dry" });
		expect(seaSideFromNeighbours(g, seam((y) => y === 3 || y === 4))?.side).toBe("scattered");
	});

	it("north / south seams map their ends to west / east", () => {
		// New map south of its neighbour: its north seam is y = -1.
		const below = { cols: 10, rows: 8, offset: { x: 0, y: 0 } };
		const cells = new Map(Array.from({ length: 10 }, (_, x) => [`${x}_-1`, x >= 8 ? { terrain: "ocean", type: "water" } : { terrain: "forest", type: "forest" }] as const));
		expect(seaSideFromNeighbours(below, cells)).toEqual({ side: "east", why: "end", seam: "north" });
	});

	it("reads terrain by type, never by name, skips corners, and is undefined with no neighbour", () => {
		const cells = new Map([["9_2", { terrain: "Brine", type: "water" }], ["9_-1", { terrain: "grass", type: "grassland" }], ["9_3", { terrain: "Brine", type: "water" }]]);
		expect(seaSideFromNeighbours(g, cells)?.side).toBe("west");
		// An untyped "ocean" isn't read as water.
		const untyped = new Map([["9_2", { terrain: "ocean" }], ["9_3", { terrain: "ocean" }]]);
		expect(seaSideFromNeighbours(g, untyped)).toBeUndefined();
		expect(seaSideFromNeighbours(g, undefined)).toBeUndefined();
		expect(seaSideFromNeighbours(g, new Map())).toBeUndefined();
	});

	it("the setup modal says where the default came from", () => {
		expect(neighbourSeaText({ side: "east", why: "edge", seam: "east" }, "ashby-vale")).toMatch(/ashby-vale.*sea is on the east/);
		expect(neighbourSeaText({ side: "none", why: "dry" }, "ashby-vale")).toMatch(/no water/);
	});
});

// ── Phase 6: generator path types are explicit options, never names ──────────

describe("Star scatter and Orbits: the path type is an option from the palette", () => {
	const fakePlugin = {
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", terrainPalettes: [] },
		app: { vault: { getMarkdownFiles: () => [] } },
		// The shipped World types table, as a vault would have it (SP1).
		worldTypeStore: {
			list: () => [DEFAULT_SPACE],
			defaultName: () => DEFAULT_SPACE.name,
			sourceFor: (_v: string | undefined, palette: TerrainColor[]) => ({ source: worldTypesSource(DEFAULT_SPACE, palette) }),
		},
	};
	const kindsP = listGeneratorKinds(fakePlugin as never);
	const kindOf = async (id: string) => (await kindsP).find((k) => k.id === id)!;
	const sector: ProcGrid = { cols: 16, rows: 16, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
	const system: ProcGrid = { ...sector, cols: 13, rows: 13 };
	const gridSpec = (g: ProcGrid) => ({ cols: g.cols, rows: g.rows, offset: g.offset, stagger: g.stagger });
	const renamedSector: PathType[] = SPACE_PATH_TYPES.map((t, i) => ({ ...t, name: ["Hyperlane", "Spice run"][i] }));
	const renamedSystem: PathType[] = SYSTEM_PATH_TYPES.map((t) => ({ ...t, name: "Ring" }));
	const run = async (id: string, terrains: TerrainColor[], g: ProcGrid, pathTypes: PathType[] | undefined, options: Record<string, string> = {}) => {
		const kind = await kindOf(id);
		const out = kind.generate({ terrains, grid: gridSpec(g), seed: 9, options: optionsWithDefaults(kind, options), pathTypes });
		if (!out.ok) throw new Error(out.message);
		return out;
	};
	const optionOf = async (id: string, terrains: TerrainColor[], pathTypes: PathType[] | undefined, key: string) =>
		kindOptions(await kindOf(id), terrains, pathTypes).find((o) => o.key === key)!;

	it("the Space presets say, as data, which of their types draws routes and orbits", () => {
		expect(defaultPathTypeFor("routes", SPACE_PATH_TYPES)).toBe("Jump route");
		expect(defaultPathTypeFor("orbits", SYSTEM_PATH_TYPES)).toBe("Orbit");
		// Only a preset's own designation counts: a type that merely sounds right doesn't.
		expect(defaultPathTypeFor("routes", [{ name: "Orbit" }])).toBeUndefined();
		expect(defaultPathTypeFor("routes", [{ name: "Jump route" }], [{ pathRoles: { routes: "Lane" } }])).toBeUndefined();
		expect(defaultPathTypeFor("routes", [{ name: "Lane" }], [{ pathRoles: { routes: "Lane" } }])).toBe("Lane");
	});

	it("Star scatter: the preset's route type by default, listed among the palette's types", async () => {
		const opt = await optionOf(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, SPACE_PATH_TYPES, ROUTE_TYPE_KEY);
		expect(opt.label).toBe("Path type for routes");
		expect(opt.choices.map((c) => c.value)).toEqual(["Jump route", "Trade route", NO_PATHS]);
		expect(opt.default).toBe("Jump route");
		const r = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, SPACE_PATH_TYPES);
		expect(r.paths.length).toBeGreaterThan(0);
		expect(new Set(r.paths.map((p) => p.type))).toEqual(new Set(["Jump route"]));
		const trade = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, SPACE_PATH_TYPES, { [ROUTE_TYPE_KEY]: "Trade route" });
		expect(new Set(trade.paths.map((p) => p.type))).toEqual(new Set(["Trade route"]));
	});

	it("Star scatter on a palette whose types are renamed: no guessing, and the option works", async () => {
		const opt = await optionOf(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, renamedSector, ROUTE_TYPE_KEY);
		expect(opt.choices.map((c) => c.value)).toEqual(["Hyperlane", "Spice run", NO_PATHS]);
		expect(opt.default).toBe(NO_PATHS);
		const byDefault = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, renamedSector);
		expect(byDefault.paths).toEqual([]);
		expect(byDefault.warnings.join(" ")).toContain("Path type for routes");
		const chosen = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, renamedSector, { [ROUTE_TYPE_KEY]: "Hyperlane" });
		expect(chosen.paths.length).toBeGreaterThan(0);
		expect(new Set(chosen.paths.map((p) => p.type))).toEqual(new Set(["Hyperlane"]));
		// The same routes as under the preset's names: the name changes nothing else.
		const preset = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, SPACE_PATH_TYPES);
		expect(chosen.paths.map((p) => p.hexes)).toEqual(preset.paths.map((p) => p.hexes));
	});

	it("Star scatter: None on purpose draws no routes quietly; a palette without types offers only None and says so", async () => {
		const none = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, SPACE_PATH_TYPES, { [ROUTE_TYPE_KEY]: NO_PATHS });
		expect(none.paths).toEqual([]);
		expect(none.warnings.join(" ")).not.toContain("Path type for routes");
		const opt = await optionOf(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, [], ROUTE_TYPE_KEY);
		expect(opt.choices).toEqual([{ value: NO_PATHS, label: "None (this palette has no path types)" }]);
		const bare = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, []);
		expect(bare.paths).toEqual([]);
		expect(bare.warnings.join(" ")).toContain("Path type for routes");
	});

	it("Orbits: the preset's orbit type by default; a renamed type works through the option", async () => {
		const opt = await optionOf(ORBITS_ID, SPACE_SYSTEM_TERRAINS, SYSTEM_PATH_TYPES, ORBIT_TYPE_KEY);
		expect(opt.label).toBe("Path type for orbits");
		expect(opt.default).toBe("Orbit");
		const r = await run(ORBITS_ID, SPACE_SYSTEM_TERRAINS, system, SYSTEM_PATH_TYPES, { bodies: "crowded" });
		expect(r.paths.length).toBeGreaterThan(0);
		expect(new Set(r.paths.map((p) => p.type))).toEqual(new Set(["Orbit"]));

		expect((await optionOf(ORBITS_ID, SPACE_SYSTEM_TERRAINS, renamedSystem, ORBIT_TYPE_KEY)).default).toBe(NO_PATHS);
		const byDefault = await run(ORBITS_ID, SPACE_SYSTEM_TERRAINS, system, renamedSystem, { bodies: "crowded" });
		expect(byDefault.paths).toEqual([]);
		expect(byDefault.warnings.join(" ")).toContain("Path type for orbits");
		const ring = await run(ORBITS_ID, SPACE_SYSTEM_TERRAINS, system, renamedSystem, { bodies: "crowded", [ORBIT_TYPE_KEY]: "Ring" });
		expect(new Set(ring.paths.map((p) => p.type))).toEqual(new Set(["Ring"]));
		expect(ring.paths.map((p) => p.hexes)).toEqual(r.paths.map((p) => p.hexes));
		const none = await run(ORBITS_ID, SPACE_SYSTEM_TERRAINS, system, SYSTEM_PATH_TYPES, { bodies: "crowded", [ORBIT_TYPE_KEY]: NO_PATHS });
		expect(none.paths).toEqual([]);
		expect(none.warnings.join(" ")).not.toContain("Path type for orbits");
	});

	it("a choice saved on another palette falls back to this palette's default", () => {
		expect(chosenPathType("Hyperlane", "routes", SPACE_PATH_TYPES)).toBe("Jump route");
		expect(chosenPathType(PRESET_PATH_TYPE, "routes", SPACE_PATH_TYPES)).toBe("Jump route");
		expect(chosenPathType(NO_PATHS, "routes", SPACE_PATH_TYPES)).toBeUndefined();
		expect(chosenPathType("Trade route", "routes", SPACE_PATH_TYPES)).toBe("Trade route");
	});

	it("orbit rings come out as anchored paths that draw exactly the ring hexes", async () => {
		const r = await run(ORBITS_ID, SPACE_SYSTEM_TERRAINS, system, SYSTEM_PATH_TYPES, { bodies: "crowded" });
		const ctx = mapRouteContext({ orientation: "flat", stagger: "odd", gridSize: { cols: 13, rows: 13 }, gridOffset: { x: 0, y: 0 }, terrainOf: [], impassable: [] });
		const styleFor = pathTypeStyleFor(SYSTEM_PATH_TYPES);
		const { paths, inexact } = generatedToMapPaths(r.paths.map((p) => ({ typeName: p.type, hexes: p.hexes })), ctx, { styleFor });
		expect(inexact).toEqual([]);
		expect(paths.map((p) => p.name)).toEqual(r.paths.map((_, i) => (i ? `Orbit ${i + 1}` : "Orbit")));
		paths.forEach((p, i) => {
			expect(routedBranches(p, ctx, styleFor)).toEqual([r.paths[i].hexes]);
			expect(p.branches[0].anchors.length).toBeLessThan(r.paths[i].hexes.length);
		});
	});

	it("jump routes draw through every system they link (one network per joined set)", async () => {
		const r = await run(STAR_SCATTER_ID, SPACE_SECTOR_TERRAINS, sector, SPACE_PATH_TYPES);
		const ctx = mapRouteContext({ orientation: "flat", stagger: "odd", gridSize: { cols: 16, rows: 16 }, gridOffset: { x: 0, y: 0 }, terrainOf: [], impassable: [] });
		const { paths } = generatedToMapPaths(r.paths.map((p) => ({ typeName: p.type, hexes: p.hexes })), ctx, { styleFor: pathTypeStyleFor(SPACE_PATH_TYPES) });
		expect(paths.length).toBeLessThan(r.paths.length);
		// Systems a step apart may sit on a route between two anchors; every one is drawn.
		const drawn = new Set(paths.flatMap((p) => routedBranches(p, ctx, pathTypeStyleFor(SPACE_PATH_TYPES)).flat()));
		for (const p of r.paths) for (const h of p.hexes) expect(drawn.has(h)).toBe(true);
	});
});

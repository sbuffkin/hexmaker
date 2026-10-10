import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/palettes/presets";
import {
	OVERLAND_OPTIONS,
	maxLakeSize,
	planetRoles,
	sideSeaMask,
	planetSurface,
	resolveSeaSide,
	OVERLAND_ID,
} from "../src/worldgen/procedural/planetSurface";
import { STAR_SCATTER_ID } from "../src/worldgen/procedural/starScatter";
import { BLANK_ID, firstMapGenerator } from "../src/worldgen/registry";
import { defaultPaletteFor } from "../src/palettes/paletteOptions";
import { isUnusedPlaceholderMap } from "../src/setupPlaceholder";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import { hexNeighbors } from "../packages/hex-wfc/src";
import type { TerrainColor } from "../src/types";

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

	it("world users get their first overland palette", () => {
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: fresh })).toBe("Limited");
		expect(defaultPaletteFor({ mapKinds: ["world", "space"], terrainPalettes: fresh })).toBe("Limited");
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Space - Sector", SPACE_SECTOR_TERRAINS), ...fresh] })).toBe("Limited");
	});

	it("space-only users get a space palette, Space - Sector first", () => {
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: fresh })).toBe("Space - Sector");
		expect(defaultPaletteFor({ mapKinds: ["space"], terrainPalettes: [...fresh, pal("Space - System", SPACE_SYSTEM_TERRAINS)] })).toBe("Space - System");
		expect(defaultPaletteFor({
			mapKinds: ["space"],
			terrainPalettes: [...fresh, pal("Space - System", SPACE_SYSTEM_TERRAINS), pal("Space - Sector", SPACE_SECTOR_TERRAINS)],
		})).toBe("Space - Sector");
	});

	it("world users with no overland palette installed get the Limited preset", () => {
		expect(defaultPaletteFor({ mapKinds: ["world"], terrainPalettes: [pal("Space - Sector", SPACE_SECTOR_TERRAINS)] })).toBe("Limited");
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
		expect(isUnusedPlaceholderMap({ ...map, pathChains: [{}] }, unused)).toBe(false);
		expect(isUnusedPlaceholderMap({ ...map, world: { id: "w", cx: 0, cy: 0 } }, unused)).toBe(false);
	});
});

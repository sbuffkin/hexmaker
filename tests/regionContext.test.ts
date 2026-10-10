import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SYSTEM_TERRAINS } from "../src/palettes/presets";
import { planetSurface } from "../src/worldgen/procedural/planetSurface";
import { mainworldFor, orbits } from "../src/worldgen/procedural/orbits";
import { sideOf, type GenerationContext, type ProcGrid } from "../src/worldgen/procedural/common";
import { regionDetailDescription } from "../src/worldgen/registry";

const grid: ProcGrid = { cols: 16, rows: 12, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
const typeOf = new Map(DEFAULT_TERRAIN_PALETTE.map((t) => [t.name, t.type]));
const WET = new Set(["water", "deep-water", "shallows"]);

/** Share of hexes in the given columns whose terrain type is in `types`. */
function share(cells: Map<string, string>, cols: number[], types: Set<string>): number {
	let hit = 0, n = 0;
	for (const [k, t] of cells) {
		const x = Number(k.split("_")[0]);
		if (!cols.includes(x)) continue;
		n++;
		if (types.has(typeOf.get(t) ?? "")) hit++;
	}
	return n ? hit / n : 0;
}

const all = Array.from({ length: grid.cols }, (_, i) => i);
const westEdge = [0, 1], eastEdge = [14, 15], middle = [6, 7, 8, 9];
const avg = (f: (seed: number) => number) => {
	let s = 0;
	for (let seed = 1; seed <= 12; seed++) s += f(seed);
	return s / 12;
};

describe("sideOf", () => {
	it("maps directions to compass sides (screen y down)", () => {
		expect(sideOf(1, 0)).toBe("E");
		expect(sideOf(-1, 0)).toBe("W");
		expect(sideOf(0, -1)).toBe("N");
		expect(sideOf(0, 1)).toBe("S");
		expect(sideOf(1, -1)).toBe("NE");
		expect(sideOf(-1, 1)).toBe("SW");
	});
});

describe("Region detail (planet surface with context)", () => {
	it("the parent terrain fills the map", () => {
		const forest = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, { parent: { terrain: "forest", type: "forest" } }).cells, all, new Set(["forest"])));
		const desert = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, { parent: { terrain: "dunes", type: "desert" } }).cells, all, new Set(["desert", "badlands"])));
		expect(forest).toBeGreaterThan(0.45);
		expect(desert).toBeGreaterThan(0.45);
	});

	it("a sea to the east puts water on the east edge, not the west", () => {
		const ctx: GenerationContext = { parent: { terrain: "grass", type: "grassland" }, sides: { E: { terrain: "ocean", type: "water" } } };
		const east = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, eastEdge, WET));
		const west = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, westEdge, WET));
		expect(east).toBeGreaterThan(0.6);
		expect(west).toBeLessThan(0.15);
	});

	it("east AND west neighbours both act, each on its own edge", () => {
		const ctx: GenerationContext = {
			parent: { terrain: "grass", type: "grassland" },
			sides: { E: { terrain: "ocean", type: "water" }, W: { terrain: "ocean", type: "water" } },
		};
		const run = (cols: number[]) => avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, cols, WET));
		expect(run(eastEdge)).toBeGreaterThan(0.6);
		expect(run(westEdge)).toBeGreaterThan(0.6);
		expect(run(middle)).toBeLessThan(0.25);
	});

	it("mountains beyond an edge raise that edge", () => {
		const HIGH = new Set(["hills", "mountains", "peaks"]);
		const ctx: GenerationContext = { parent: { terrain: "grass", type: "grassland" }, sides: { W: { terrain: "mountain", type: "mountains" } } };
		const west = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, westEdge, HIGH));
		const east = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, eastEdge, HIGH));
		expect(west).toBeGreaterThan(east + 0.3);
	});

	it("exact border cells from a neighbouring region pull the nearby hexes", () => {
		// A column of ocean just outside the west edge (x = -1).
		const edgeCells = new Map(Array.from({ length: grid.rows }, (_, y) => [`-1_${y}`, { terrain: "ocean", type: "water" }]));
		const ctx: GenerationContext = { parent: { terrain: "grass", type: "grassland" }, edgeCells };
		const west = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, [0], WET));
		const east = avg((seed) => share(planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, {}, ctx).cells, [15], WET));
		expect(west).toBeGreaterThan(0.6);
		expect(east).toBeLessThan(0.15);
	});

	it("untyped context terrains are read from their names", () => {
		const ctx: GenerationContext = { parent: { terrain: "dark forest" }, sides: { S: { terrain: "salt sea" } } };
		const r = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 2, {}, ctx);
		expect(share(r.cells, all, new Set(["forest"]))).toBeGreaterThan(0.3);
	});

	it("is deterministic per seed", () => {
		const ctx: GenerationContext = { parent: { type: "hills" }, sides: { N: { type: "snow" } } };
		const a = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 9, {}, ctx);
		const b = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 9, {}, ctx);
		expect([...a.cells]).toEqual([...b.cells]);
	});

	it("without context, planet mode is unchanged (no context argument)", () => {
		const a = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 4, { water: "50" });
		expect(a.cells.size).toBe(grid.cols * grid.rows);
	});
});

describe("Orbits mainworld from the sector hex", () => {
	const bodies = SPACE_SYSTEM_TERRAINS.filter((t) => ["world", "gas-giant", "asteroids"].includes(t.type ?? "")).map((t) => t.name);

	it("maps sector terrain names to bodies", () => {
		expect(mainworldFor("ocean world", bodies)).toBe("ocean planet");
		expect(mainworldFor("garden world", bodies)).toBe("terrestrial planet");
		expect(mainworldFor("gas giant", bodies)).toBe("gas giant");
		expect(mainworldFor("ice world", bodies)).toBe("ice planet");
		expect(mainworldFor("asteroid belt", bodies)).toBe("asteroid belt");
		expect(mainworldFor("nebula", bodies)).toBeUndefined();
		expect(mainworldFor(undefined, bodies)).toBeUndefined();
	});

	it("the system always contains the hinted mainworld, even with few planets", () => {
		const g: ProcGrid = { cols: 13, rows: 13, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
		for (let seed = 1; seed <= 20; seed++) {
			const r = orbits(SPACE_SYSTEM_TERRAINS, g, seed, { bodies: "few" }, undefined, { parent: { terrain: "ocean world", type: "world" } });
			expect([...r.cells.values()]).toContain("ocean planet");
		}
	});
});

describe("Region detail keeps its card's promise (fresh-eyes round 7)", () => {
	// The tester's hex: mixed forest heavy with evergreen heavy to the NE and
	// SE and mixed forest to the SW. Both neighbours are forest-type, so the
	// type blend alone produced no evergreen at all.
	const ctx: GenerationContext = {
		parent: { terrain: "mixed forest heavy" },
		sides: {
			NE: { terrain: "evergreen heavy" },
			SE: { terrain: "evergreen heavy" },
			SW: { terrain: "mixed forest" },
		},
	};
	const g: ProcGrid = { cols: 13, rows: 13, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
	const at = (k: string) => k.split("_").map(Number) as [number, number];

	it("the card promises evergreen heavy on the north-east and south-east", () => {
		expect(regionDetailDescription(ctx)).toMatch(/evergreen heavy on the north-east and south-east/);
	});

	it("puts evergreen heavy in the north-east and south-east corners, and not on the west, for every seed", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const cells = planetSurface(DEFAULT_TERRAIN_PALETTE, g, seed, {}, ctx).cells;
			const ever = [...cells].filter(([, t]) => t === "evergreen heavy").map(([k]) => at(k));
			const ne = ever.filter(([x, y]) => x >= 9 && y <= 4).length;
			const se = ever.filter(([x, y]) => x >= 9 && y >= 8).length;
			const west = ever.filter(([x]) => x <= 5).length;
			expect({ seed, ne: ne > 0, se: se > 0, west }).toEqual({ seed, ne: true, se: true, west: 0 });
		}
	});

	it("leaves the map to the parent terrain away from those edges", () => {
		const cells = planetSurface(DEFAULT_TERRAIN_PALETTE, g, 3, {}, ctx).cells;
		const forest = [...cells.values()].filter((t) => typeOf.get(t) === "forest").length;
		const ever = [...cells.values()].filter((t) => t === "evergreen heavy").length;
		expect(ever).toBeLessThan(forest / 2);
	});
});

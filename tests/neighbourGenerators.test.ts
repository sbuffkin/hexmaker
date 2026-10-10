import { describe, it } from "node:test";
import expect from "expect";
import { LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { edgePulls, planetSurface } from "../src/worldgen/procedural/planetSurface";
import { BLANK_ID, defaultGeneratorFor, kindsForPalette, neighbourFirst, type TerrainGeneratorKind } from "../src/worldgen/registry";
import type { ContextTerrain, ProcGrid } from "../src/worldgen/procedural/common";

/**
 * Fresh-eyes round 3 (G10): a map placed next to another must offer the
 * generators that continue the shared edge, never "zoom into the parent
 * hex" ones, and Overland must actually carry the neighbour's edge on.
 */

const grid: ProcGrid = { cols: 12, rows: 10, offset: { x: 12, y: 0 }, stagger: "odd", orientation: "flat" };
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** A neighbour's border column just west of the grid (x = 11), all one terrain. */
function westBorder(terrain: string, type: string): Map<string, ContextTerrain> {
	const m = new Map<string, ContextTerrain>();
	for (let y = 0; y < grid.rows; y++) m.set(`${grid.offset.x - 1}_${y}`, { terrain, type });
	return m;
}

const overland = (seed: number, options: Record<string, string>, edgeCells?: Map<string, ContextTerrain>) =>
	planetSurface(LIMITED_TERRAIN_PALETTE, grid, seed, options, edgeCells ? { edgeCells } : undefined, "overland").cells;

/** Share of the map's first (west) column with one of `names`, over SEEDS. */
function westColumnShare(gen: (seed: number) => Map<string, string>, names: string[]): number {
	let hit = 0, n = 0;
	for (const seed of SEEDS) {
		const cells = gen(seed);
		for (let y = 0; y < grid.rows; y++) {
			n++;
			if (names.includes(cells.get(`${grid.offset.x}_${y}`) ?? "")) hit++;
		}
	}
	return hit / n;
}

describe("Overland next to a neighbouring region", () => {
	it("carries a mountain border on into its first column", () => {
		// Sea to the north, so the west column isn't high ground by tilt alone.
		const opts = { water: "30", sea: "north" };
		const withEdge = westColumnShare((s) => overland(s, opts, westBorder("mountain", "mountains")), ["mountain", "hill"]);
		const without = westColumnShare((s) => overland(s, opts), ["mountain", "hill"]);
		expect(withEdge).toBeGreaterThan(0.7);
		expect(withEdge).toBeGreaterThan(without + 0.2);
	});

	it("continues a neighbour's sea across the seam, even with its own sea on the far side", () => {
		const share = westColumnShare((s) => overland(s, { water: "30", sea: "east" }, westBorder("ocean", "water")), ["ocean"]);
		expect(share).toBeGreaterThan(0.7);
	});

	it("keeps the sea off a land border when the sea side is the seam", () => {
		const share = westColumnShare((s) => overland(s, { water: "30", sea: "west" }, westBorder("forest", "forest")), ["ocean"]);
		expect(share).toBeLessThan(0.2);
	});

	it("is unchanged without a neighbour (no edge cells)", () => {
		for (const seed of SEEDS.slice(0, 5)) {
			expect([...overland(seed, { sea: "west" }, new Map())]).toEqual([...overland(seed, { sea: "west" })]);
		}
	});

	it("is deterministic with a neighbour", () => {
		const edge = westBorder("hill", "hills");
		expect([...overland(4, {}, edge)]).toEqual([...overland(4, {}, edge)]);
	});
});

describe("edgePulls", () => {
	const hexes: [number, number][] = [[12, 4], [13, 4], [14, 4], [15, 4], [16, 4]];

	it("pulls hardest on the seam and fades out after three hexes", () => {
		const pulls = edgePulls(grid, hexes, westBorder("mountain", "mountains"));
		expect(pulls[0]?.near).toBe(1);
		const alphas = pulls.map((p) => p?.alpha ?? 0);
		expect(alphas[0]).toBeGreaterThan(alphas[1]);
		expect(alphas[1]).toBeGreaterThan(alphas[2]);
		expect(alphas[3]).toBe(0);
		expect(pulls[4]).toBeUndefined();
		expect(pulls[0]?.classWeights[4]).toBe(1);
	});

	it("counts water for the sea and ignores terrain of unknown type", () => {
		const mixed = new Map<string, ContextTerrain>([
			["11_4", { terrain: "ocean", type: "water" }],
			["11_3", { terrain: "Zzyzx" }],
		]);
		const [p] = edgePulls(grid, [[12, 4]], mixed);
		expect(p?.wet).toBe(1);
	});
});

describe("generators offered for a new map", () => {
	const kind = (id: string, extra: Partial<TerrainGeneratorKind> = {}): TerrainGeneratorKind => ({
		id,
		label: id,
		description: "",
		source: "built-in",
		options: [],
		fits: () => true,
		generate: () => ({ ok: true, cells: new Map(), paths: [], warnings: [] }),
		toChains: () => ({ chains: [], missing: [] }),
		...extra,
	});
	const blank = kind(BLANK_ID, { source: "blank" });
	const regionDetail = kind("region-detail", { needsContext: true });
	const overlandK = kind("overland", { continuesNeighbours: true });
	const stars = kind("star-scatter");
	const learned = kind("wfc:valley", { source: "learned", continuesNeighbours: true });
	const all = [blank, stars, regionDetail, overlandK, learned];

	it("hides 'zoom into the parent hex' generators unless there is a parent hex", () => {
		expect(kindsForPalette(all, LIMITED_TERRAIN_PALETTE).map((k) => k.id)).not.toContain("region-detail");
		expect(kindsForPalette(all, LIMITED_TERRAIN_PALETTE, true).map((k) => k.id)).toContain("region-detail");
	});

	it("next to a neighbour: Blank, then edge-continuing built-ins, then learned, then the rest", () => {
		expect(neighbourFirst([stars, learned, blank, overlandK]).map((k) => k.id)).toEqual([BLANK_ID, "overland", "wfc:valley", "star-scatter"]);
	});

	it("starts a neighbour on a generator that continues the edge", () => {
		const offered = kindsForPalette(all, LIMITED_TERRAIN_PALETTE);
		expect(defaultGeneratorFor(offered, { neighbour: true })).toBe("overland");
		expect(defaultGeneratorFor([blank, stars, learned], { neighbour: true })).toBe("wfc:valley");
		expect(defaultGeneratorFor([blank, stars], { neighbour: true })).toBe("star-scatter");
		expect(defaultGeneratorFor([blank], { neighbour: true })).toBe(BLANK_ID);
	});

	it("a submap starts on the zoom-in generator; a stand-alone map on the first built-in", () => {
		expect(defaultGeneratorFor(all, { parentHex: true })).toBe("region-detail");
		expect(defaultGeneratorFor([blank, stars, overlandK], {})).toBe("star-scatter");
	});
});

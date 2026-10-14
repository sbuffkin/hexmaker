import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { edgePulls, planetSurface } from "../src/worldgen/procedural/planetSurface";
import { EDGE_ALPHA, edgeAlpha, edgeReach, neighbourShare, storeNeighbourWeight } from "../src/worldgen/neighbourWeight";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import type { ContextTerrain, ProcGrid } from "../src/worldgen/procedural/common";
import type { MapData } from "../src/types";

/**
 * SF6 (owner 2026-10-14, B): New map → Next to gets the same Neighbour
 * influence weight as Edit region (0–2, ×1 default): Overland's pull from
 * the neighbour's edge reaches further at ×2 and only the seam at ×0;
 * learned generators blend in the neighbours' character by it. Stored as
 * `neighbour-influence:` only when not 1.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const grid: ProcGrid = { cols: 12, rows: 10, offset: { x: 12, y: 0 }, stagger: "odd", orientation: "flat" };
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

function westBorder(terrain: string, type: string): Map<string, ContextTerrain> {
	const m = new Map<string, ContextTerrain>();
	for (let y = 0; y < grid.rows; y++) m.set(`${grid.offset.x - 1}_${y}`, { terrain, type });
	return m;
}

const overland = (seed: number, weight: number | undefined, edgeCells: Map<string, ContextTerrain>) =>
	planetSurface(LIMITED_TERRAIN_PALETTE, grid, seed, { water: "30", sea: "north" }, { edgeCells, neighbourWeight: weight }, "overland").cells;

/** Share of columns `from`..`to` (0 = the seam column) that are mountain or hill, over SEEDS. */
function highShare(weight: number, from: number, to: number): number {
	let hit = 0, n = 0;
	for (const seed of SEEDS) {
		const cells = overland(seed, weight, westBorder("mountain", "mountains"));
		for (let c = from; c <= to; c++)
			for (let y = 0; y < grid.rows; y++) {
				n++;
				if (["mountain", "hill"].includes(cells.get(`${grid.offset.x + c}_${y}`) ?? "")) hit++;
			}
	}
	return hit / n;
}

describe("SF6: the weight on a plain map's neighbour pull", () => {
	it("×1 is exactly the pull as before; ×0 the seam only; ×2 twice as far in", () => {
		expect([1, 2, 3, 4].map((d) => edgeAlpha(d, 1))).toEqual([EDGE_ALPHA[1], EDGE_ALPHA[2], EDGE_ALPHA[3], 0]);
		expect(edgeReach(1)).toBe(3);
		expect(edgeReach(0)).toBe(1);
		expect(edgeReach(2)).toBe(6);
		expect(edgeAlpha(1, 0)).toBe(EDGE_ALPHA[1]);
		expect(edgeAlpha(2, 0)).toBe(0);
		expect(edgeAlpha(3, 2)).toBeCloseTo(EDGE_ALPHA[2]);
		expect(edgeAlpha(6, 2)).toBeGreaterThan(0);
		expect(edgeAlpha(7, 2)).toBe(0);
		// Unreadable weights count as ×1.
		expect(edgeAlpha(2, Number.NaN)).toBe(EDGE_ALPHA[2]);
	});

	it("edgePulls reaches further with more influence", () => {
		const hexes: [number, number][] = [[12, 4], [13, 4], [14, 4], [15, 4], [16, 4], [17, 4]];
		const at = (w: number) => edgePulls(grid, hexes, westBorder("mountain", "mountains"), w).map((p) => p?.alpha ?? 0);
		expect(at(1)).toEqual(edgePulls(grid, hexes, westBorder("mountain", "mountains")).map((p) => p?.alpha ?? 0));
		expect(at(0).filter((a) => a > 0)).toHaveLength(1);
		expect(at(2)[4]).toBeGreaterThan(0);
		expect(at(1)[4]).toBe(0);
	});

	it("Overland at ×1 is the same map as with no weight given", () => {
		for (const seed of SEEDS.slice(0, 4)) {
			const edge = westBorder("hill", "hills");
			const plain = planetSurface(LIMITED_TERRAIN_PALETTE, grid, seed, { water: "30", sea: "north" }, { edgeCells: edge }, "overland").cells;
			expect([...overland(seed, 1, edge)]).toEqual([...plain]);
		}
	});

	it("a mountain neighbour carries further into the map at ×2 than at ×0", () => {
		expect(highShare(2, 2, 4)).toBeGreaterThan(highShare(0, 2, 4) + 0.1);
	});

	it("learned generators blend in 0% / 20% / 40% of the neighbours", () => {
		expect([0, 1, 2].map(neighbourShare)).toEqual([0, 20, 40]);
		expect(neighbourShare(undefined)).toBe(20);
	});

	it("is stored in the new map's note only when not ×1", () => {
		const m = { name: "m" } as MapData;
		storeNeighbourWeight(m, 0.4);
		expect(m.neighbourInfluence).toBe(0.4);
		const note = buildMapNote("m", { settings: { paletteName: "Default", neighbourInfluence: 0.4 }, hexes: new Map(), paths: [] });
		expect(note).toMatch(/^neighbour-influence: 0\.4$/m);
		expect(parseMapNote(note)!.settings.neighbourInfluence).toBe(0.4);
		storeNeighbourWeight(m, 1);
		expect(m.neighbourInfluence).toBeUndefined();
	});
});

describe("SF6: New map → Next to wiring (one control, one code path)", () => {
	const modal = read("src", "worldgen", "NewMapSetupModal.ts");
	const shared = read("src", "ui", "neighbourSlider.ts");

	it("the slider is the shared one Edit region uses", () => {
		expect(shared).toMatch(/renderLabeledSlider\(parent, \{\s*label: "Neighbour influence"/);
		expect(modal).toMatch(/renderNeighbourSlider\(weightRow, this\.neighbourWeight/);
		expect(read("src", "overworld", "EditRegionModal.ts")).toMatch(/renderNeighbourSlider\(biomeSec, draft\.neighbourWeight/);
		expect(read("src", "overworld", "EditRegionModal.ts")).not.toMatch(/label: "Neighbour influence"/);
	});

	it("the preview and the created map both run with the weight, and the map keeps it", () => {
		expect(modal).toMatch(/\.\.\.\(this\.placement \? \{ neighbourWeight: this\.neighbourWeight \} : \{\}\)/);
		expect(modal).toMatch(/storeNeighbourWeight\(made, this\.neighbourWeight\)/);
		// Shown only next to a map, with a generator that follows the neighbour.
		expect(modal).toMatch(/syncWeight = \(\) => weightRow\.toggle\(!!this\.placement && !!this\.kind\(\)\?\.continuesNeighbours\)/);
	});

	it("Overland and the learned generators read it", () => {
		expect(read("src", "modules", "world", "runtime.ts")).toMatch(/neighbourWeight: req\.neighbourWeight/);
		const registry = read("src", "worldgen", "registry.ts");
		expect(registry.match(/leanToNeighbours\(plugin, /g)?.length).toBe(2);
	});
});

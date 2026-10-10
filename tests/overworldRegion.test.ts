import { describe, it } from "node:test";
import expect from "expect";
import { hexDistance } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { BlendField, REGION_WARP } from "../src/overworld/blendField";
import { childNeighbours, parentOf, regionCells, type RegionLayout } from "../src/overworld/layout";
import { generateRegion, interiorAgreement, seamStats, spiralOrder } from "../src/overworld/regionGen";
import { worldBiomes } from "../src/overworld/worldBiomes";
import { profilesFor, typeLookup } from "./overworldFixtures";

const EXP = DEFAULT_TERRAIN_PALETTE;
const profiles = profilesFor(EXP);
const typeOf = typeLookup(EXP);
const BRICK: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
const FLOWER: RegionLayout = { footprint: "hex", size: 4, orientation: "flat", parentStagger: "odd", childStagger: "odd" };

/** Generate every region of an overworld in spiral order, pinning earlier ones. */
function generateAll(l: RegionLayout, biomes: Map<string, string>, seed: number, order?: [number, number][]) {
	const field = new BlendField(l, biomes, "normal", { warp: REGION_WARP, seed });
	const parents = [...biomes.keys()].map((k) => k.split("_").map(Number) as [number, number]);
	const seq = order ?? spiralOrder(parents, [2, 2], (a, b) => hexDistance(a, b, l.orientation, l.parentStagger));
	const all = new Map<string, string>();
	for (const p of seq) {
		const out = generateRegion({ layout: l, parent: p, field, profiles, pinned: all, typeOf, seed });
		for (const [k, v] of out) all.set(k, v);
	}
	return all;
}

const hexWorld = (): Map<string, string> => {
	const m = new Map<string, string>();
	const r = worldBiomes(
		Array.from({ length: 25 }, (_, i) => [i % 5, Math.floor(i / 5)] as [number, number]).filter(([x, y]) => hexDistance([x, y], [2, 2], "flat", "odd") <= 2),
		"flat", "odd", EXP, { seed: 11, climate: "varied", water: 0.25 },
	);
	for (const [k, b] of r.biomes) m.set(k, b);
	return m;
};

describe("region generation", () => {
	it("fills every cell of the region (and only those) with palette terrains", () => {
		for (const l of [BRICK, FLOWER]) {
			const field = new BlendField(l, hexWorld());
			const out = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed: 1 });
			const cells = regionCells(l, 2, 2).map(([x, y]) => `${x}_${y}`);
			expect([...out.keys()].sort()).toEqual([...cells].sort());
			for (const t of out.values()) expect(EXP.some((p) => p.name === t)).toBe(true);
		}
	});

	it("is deterministic and never changes pinned cells", () => {
		const field = new BlendField(FLOWER, hexWorld());
		const a = generateRegion({ layout: FLOWER, parent: [2, 2], field, profiles, typeOf, seed: 5 });
		const b = generateRegion({ layout: FLOWER, parent: [2, 2], field, profiles, typeOf, seed: 5 });
		expect([...a]).toEqual([...b]);
		const pinned = new Map(a);
		const next = generateRegion({ layout: FLOWER, parent: [2, 1], field, profiles, typeOf, seed: 5, pinned });
		for (const k of next.keys()) expect(pinned.has(k)).toBe(false);
		expect([...pinned]).toEqual([...a]);
	});

	it("follows the region's biome: a tundra region is mostly snow / grass / hills", () => {
		const biomes = new Map<string, string>();
		for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) biomes.set(`${x}_${y}`, "tundra");
		const out = generateRegion({ layout: BRICK, parent: [2, 2], field: new BlendField(BRICK, biomes), profiles, typeOf, seed: 3 });
		const types = [...out.values()].map(typeOf);
		expect(types.filter((t) => t === "snow" || t === "grassland" || t === "hills").length / types.length).toBeGreaterThan(0.55);
		expect(types.filter((t) => t === "jungle" || t === "desert").length).toBe(0);
	});

	it("seams agree about as well as region interiors (type agreement)", () => {
		for (const l of [BRICK, FLOWER]) {
			let seamMean = 0, interior = 0;
			const seeds = [7, 8, 9, 10];
			for (const seed of seeds) {
				const all = generateAll(l, hexWorld(), seed);
				const seams = seamStats(l, all, typeOf);
				expect(seams.length).toBeGreaterThan(20);
				seamMean += seams.reduce((s, x) => s + x.typeAgreement * x.pairs, 0) / seams.reduce((s, x) => s + x.pairs, 0) / seeds.length;
				interior += interiorAgreement(l, all, typeOf) / seeds.length;
			}
			// Phase 0 (sampling + smoothing): seams within ~10 points of the interior
			// (seams also cross biome changes, which the interior mostly does not).
			expect(seamMean).toBeGreaterThan(interior - 0.1);
			expect(seamMean).toBeGreaterThan(0.7);
		}
	});

	it("no smear: tundra → transition → forest gives no snow on the forest side of the far seam", () => {
		// Flat-top: columns are straight N–S lines. Column 0 tundra, 1 taiga, 2+ forest.
		const biomes = new Map<string, string>();
		for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) biomes.set(`${x}_${y}`, x === 0 ? "tundra" : x === 1 ? "taiga" : "temperate-forest");
		for (const l of [BRICK, FLOWER]) {
			let snow = 0, n = 0;
			for (const seed of [1, 2, 3, 4, 5]) {
				const all = generateAll(l, biomes, seed);
				for (const [k, t] of all) {
					const [x, y] = k.split("_").map(Number);
					if (parentOf(l, x, y)[0] !== 2) continue;
					if (!childNeighbours(l, x, y).some(([a, b]) => parentOf(l, a, b)[0] === 1)) continue;
					n++;
					if (typeOf(t) === "snow") snow++;
				}
			}
			expect(n).toBeGreaterThan(20);
			expect(snow / n).toBeLessThan(0.02);
		}
	});

	it("seam stats count each facing pair once, per pair of regions", () => {
		const all = generateAll(BRICK, hexWorld(), 2);
		const stats = seamStats(BRICK, all, typeOf);
		for (const s of stats) {
			expect(s.a < s.b).toBe(true);
			expect(s.typeAgreement).toBeGreaterThanOrEqual(s.nameAgreement);
		}
		// 8×8 bricks: a vertical seam has 8 cells a side.
		expect(Math.max(...stats.map((s) => s.pairs))).toBeLessThanOrEqual(8 * 3);
	});
});

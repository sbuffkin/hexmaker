import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { BlendField, REGION_WARP, blendK, namesWithinType, terrainMix, typeMix } from "../src/overworld/blendField";
import { childNeighbours, neighbourRegions, parentOf, regionCells, regionCentreCell, type RegionLayout } from "../src/overworld/layout";
import { profilesFor } from "./overworldFixtures";

const BRICK: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
const FLOWER: RegionLayout = { footprint: "hex", size: 4, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
const LAYOUTS = [BRICK, FLOWER, { ...BRICK, orientation: "pointy" as const, size: 7, parentStagger: "even" as const }, { ...FLOWER, orientation: "pointy" as const, size: 3, childStagger: "even" as const }];

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const grid = (cols: number, rows: number, biomeAt: (x: number, y: number) => string | undefined) => {
	const m = new Map<string, string>();
	for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) { const b = biomeAt(x, y); if (b) m.set(`${x}_${y}`, b); }
	return m;
};

/** Facing cell pairs across the seam between regions p and q. */
function seamPairs(l: RegionLayout, p: [number, number], q: [number, number]): [[number, number], [number, number]][] {
	const out: [[number, number], [number, number]][] = [];
	for (const [x, y] of regionCells(l, p[0], p[1])) {
		for (const [a, b] of childNeighbours(l, x, y)) {
			const o = parentOf(l, a, b);
			if (o[0] === q[0] && o[1] === q[1]) out.push([[x, y], [a, b]]);
		}
	}
	return out;
}

describe("blend field", () => {
	it("is a partition of unity at every cell", () => {
		for (const l of LAYOUTS) {
			const field = new BlendField(l, grid(5, 5, (x, y) => ["tundra", "taiga", "grassland"][(x + 2 * y) % 3]));
			for (const [x, y] of regionCells(l, 2, 2)) expect(sum(field.at(x, y))).toBeCloseTo(1, 9);
		}
	});

	it("depends only on position: same mix whatever order the overworld is listed or cells are asked", () => {
		for (const l of LAYOUTS) {
			const biomes = grid(5, 5, (x, y) => ["tundra", "jungle", "swamp", "alpine"][(x * 3 + y) % 4]);
			const a = new BlendField(l, biomes);
			const b = new BlendField(l, new Map([...biomes].reverse()));
			const cells = [...regionCells(l, 2, 2), ...regionCells(l, 2, 3)];
			const fromA = cells.map(([x, y]) => [...a.at(x, y)].sort());
			const fromB = [...cells].reverse().map(([x, y]) => [...b.at(x, y)].sort()).reverse();
			for (let i = 0; i < cells.length; i++) {
				expect(fromB[i].map(([k]) => k)).toEqual(fromA[i].map(([k]) => k));
				fromB[i].forEach(([, v], j) => expect(v).toBeCloseTo(fromA[i][j][1], 12));
			}
		}
	});

	it("is continuous across a seam and about 50/50 at it", () => {
		for (const l of LAYOUTS) {
			// Two halves: left columns forest, right columns grassland.
			const field = new BlendField(l, grid(6, 6, (x) => (x < 3 ? "temperate-forest" : "grassland")));
			const seam = seamPairs(l, [2, 2], [3, 2]).concat(seamPairs(l, [2, 3], [3, 3]));
			expect(seam.length).toBeGreaterThan(0);
			let mean = 0;
			for (const [[x, y], [a, b]] of seam) {
				const p = field.at(x, y).get("temperate-forest") ?? 0;
				const q = field.at(a, b).get("temperate-forest") ?? 0;
				expect(Math.abs(p - q)).toBeLessThan(0.35);
				mean += (p + q) / 2;
			}
			mean /= seam.length;
			expect(mean).toBeGreaterThan(0.35);
			expect(mean).toBeLessThan(0.65);
		}
	});

	it("is about ⅓ each where three regions meet", () => {
		for (const l of [FLOWER, BRICK]) {
			// (2,2) and two of its neighbours that also neighbour each other.
			const nb = neighbourRegions(l, 2, 2);
			const a = nb[0];
			const b = nb.find((n) => neighbourRegions(l, a[0], a[1]).some(([x, y]) => x === n[0] && y === n[1]))!;
			const tri: [number, number][] = [[2, 2], a, b];
			const names = ["tundra", "jungle", "badlands"];
			const field = new BlendField(l, new Map(tri.map(([x, y], i) => [`${x}_${y}`, names[i]])));
			// Cells of (2,2) that touch both other regions.
			const corner = regionCells(l, 2, 2).filter(([x, y]) => {
				const owners = childNeighbours(l, x, y).map(([p, q]) => parentOf(l, p, q).join("_"));
				return owners.includes(a.join("_")) && owners.includes(b.join("_"));
			});
			expect(corner.length).toBeGreaterThan(0);
			for (const [x, y] of corner) for (const n of names) {
				expect(field.at(x, y).get(n) ?? 0).toBeGreaterThan(0.18);
				expect(field.at(x, y).get(n) ?? 0).toBeLessThan(0.5);
			}
		}
	});

	it("holds ~85–95% of a region's own biome at its centre (normal width), more when narrow", () => {
		for (const l of [BRICK, FLOWER]) {
			const others = grid(5, 5, (x, y) => (x === 2 && y === 2 ? "jungle" : "tundra"));
			const [cx, cy] = regionCentreCell(l, 2, 2);
			const normal = new BlendField(l, others).at(cx, cy).get("jungle")!;
			expect(normal).toBeGreaterThan(0.8);
			expect(normal).toBeLessThan(0.97);
			const narrow = new BlendField(l, others, "narrow").at(cx, cy).get("jungle")!;
			const wide = new BlendField(l, others, "wide").at(cx, cy).get("jungle")!;
			expect(narrow).toBeGreaterThan(normal);
			expect(wide).toBeLessThan(normal);
		}
	});

	it("no smear: tundra → transition → forest leaves 0% tundra on the forest side of the far seam", () => {
		// Bands along the grid's straight lines (columns for flat-top, rows for
		// pointy-top): band 0 tundra, band 1 taiga (the transition), 2+ forest.
		for (const l of LAYOUTS) {
			const band = (x: number, y: number) => (l.orientation === "flat" ? x : y);
			const field = new BlendField(l, grid(6, 6, (x, y) => (band(x, y) === 0 ? "tundra" : band(x, y) === 1 ? "taiga" : "temperate-forest")));
			for (const i of [1, 2, 3]) {
				const at = (b: number, j: number): [number, number] => (l.orientation === "flat" ? [b, j] : [j, b]);
				const forestSide: [number, number][] = [];
				for (const [[cx, cy], [ax, ay]] of [...seamPairs(l, at(2, i), at(1, i)), ...seamPairs(l, at(2, i), at(1, i + 1)), ...seamPairs(l, at(2, i), at(1, i - 1))]) {
					if (parentOf(l, ax, ay)[l.orientation === "flat" ? 0 : 1] === 1) forestSide.push([cx, cy]);
				}
				expect(forestSide.length).toBeGreaterThan(0);
				// Plan §7: smear < 1% at every cell (it rounds to 0%), and ~0 on average.
				const tundra = forestSide.map(([cx, cy]) => field.at(cx, cy).get("tundra") ?? 0);
				expect(Math.max(...tundra)).toBeLessThan(0.01);
				expect(tundra.reduce((a, b) => a + b, 0) / tundra.length).toBeLessThan(0.003);
				// …while the transition region's own tundra edge does blend toward tundra.
				const t = seamPairs(l, at(1, i), at(0, i)).map(([[cx, cy]]) => field.at(cx, cy).get("tundra") ?? 0);
				expect(Math.max(...t)).toBeGreaterThan(0.2);
			}
		}
	});

	it("domain warp: still position-only and a partition of unity, and moves boundaries", () => {
		for (const l of LAYOUTS) {
			const biomes = grid(6, 6, (x) => (x === 0 ? "tundra" : x < 3 ? "taiga" : "temperate-forest"));
			const a = new BlendField(l, biomes, "normal", { warp: REGION_WARP, seed: 9 });
			const b = new BlendField(l, new Map([...biomes].reverse()), "normal", { warp: REGION_WARP, seed: 9 });
			const plain = new BlendField(l, biomes);
			let moved = 0;
			for (const [x, y] of [...regionCells(l, 2, 2), ...regionCells(l, 3, 2)]) {
				expect(sum(a.at(x, y))).toBeCloseTo(1, 9);
				expect(b.at(x, y).get("taiga") ?? 0).toBeCloseTo(a.at(x, y).get("taiga") ?? 0, 12);
				if (Math.abs((a.at(x, y).get("taiga") ?? 0) - (plain.at(x, y).get("taiga") ?? 0)) > 0.05) moved++;
			}
			expect(moved).toBeGreaterThan(0);
			expect(new BlendField(l, biomes, "normal", { warp: REGION_WARP, seed: 10 }).at(5, 5)).not.toEqual(a.at(5, 5));
		}
	});

	it("ignores overworld hexes without a biome and is empty far from any", () => {
		const field = new BlendField(BRICK, new Map([["0_0", "tundra"]]));
		expect(sum(field.at(1, 1))).toBeCloseTo(1, 9);
		expect(field.at(200, 200).size).toBe(0);
	});

	it("blend width: named widths and numbers", () => {
		expect(blendK("narrow")).toBe(6);
		expect(blendK("normal")).toBe(3.5);
		expect(blendK("wide")).toBe(2);
		expect(blendK(undefined)).toBe(3.5);
		expect(blendK(4.2)).toBe(4.2);
		expect(blendK(-1)).toBe(0.5);
	});
});

describe("terrain mix: type first, then name within type", () => {
	const profiles = profilesFor(DEFAULT_TERRAIN_PALETTE);

	it("has a profile for every land biome on Expanded, each summing to 1", () => {
		for (const id of ["tundra", "taiga", "temperate-forest", "grassland", "jungle", "alpine", "open-sea"]) {
			const p = profiles.get(id)!;
			expect(sum(p.types)).toBeCloseTo(1, 9);
			for (const inner of p.names.values()) expect(sum(inner)).toBeCloseTo(1, 9);
		}
		expect(profiles.get("tundra")!.types.get("snow")).toBeGreaterThan(0.2);
	});

	it("sums to 1 and is the biome's own mix when Φ is one biome", () => {
		const mix = terrainMix(new Map([["taiga", 1]]), profiles);
		expect(sum(mix)).toBeCloseTo(1, 9);
		expect([...mix].sort((a, b) => b[1] - a[1])[0][0]).toBe("evergreen");
	});

	it("blends types linearly; the biome supplying most of a type picks its names", () => {
		// 70% temperate forest, 30% taiga: both are mostly forest-type.
		const phi = new Map([["temperate-forest", 0.7], ["taiga", 0.3]]);
		const tau = typeMix(phi, profiles);
		const forestShare = 0.7 * profiles.get("temperate-forest")!.types.get("forest")! + 0.3 * profiles.get("taiga")!.types.get("forest")!;
		expect(tau.get("forest")).toBeCloseTo(forestShare, 2);
		const sharp = namesWithinType(phi, profiles, "forest", 2);
		const linear = namesWithinType(phi, profiles, "forest", 1);
		const broadleaf = (m: Map<string, number>) => (m.get("mixed forest") ?? 0) + (m.get("mixed forest heavy") ?? 0) + (m.get("forest") ?? 0) + (m.get("forest heavy") ?? 0);
		expect(broadleaf(sharp)).toBeGreaterThan(broadleaf(linear));
		expect(broadleaf(sharp)).toBeGreaterThan(0.8);
		expect(sum(sharp)).toBeCloseTo(1, 9);
	});
});

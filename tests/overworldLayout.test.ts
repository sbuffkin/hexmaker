import { describe, it } from "node:test";
import expect from "expect";
import { fromAxial, hexNeighbors, toAxial, type Orientation, type Stagger } from "../packages/hex-wfc/src/grid";
import {
	childNeighbours,
	flowerTwistDegrees,
	fromLocal,
	inRegion,
	layoutProblem,
	neighbourRegions,
	parentOf,
	regionBox,
	regionCellCount,
	regionCells,
	regionCentreCell,
	regionMask,
	regionSpacing,
	toLocal,
	type RegionLayout,
} from "../src/overworld/layout";

const ORIENTS: Orientation[] = ["flat", "pointy"];
const STAGGERS: Stagger[] = ["odd", "even"];

function* layouts(footprint: "hex" | "rect", sizes: number[]): Generator<RegionLayout> {
	for (const orientation of ORIENTS) for (const parentStagger of STAGGERS) for (const childStagger of STAGGERS) {
		for (const size of sizes) yield { footprint, size, orientation, parentStagger, childStagger };
	}
}
const name = (l: RegionLayout) => `${l.footprint} ${l.size} ${l.orientation} parent-${l.parentStagger} child-${l.childStagger}`;

/**
 * Exact tiling over a patch of parents: every child cell in the inner area
 * belongs to exactly one region, parentOf agrees with the region that
 * lists it, and each region's cells touch exactly its parent's six
 * neighbours' regions.
 */
function checkTiling(l: RegionLayout, R = 3): void {
	const owner = new Map<string, string>();
	for (let px = -R; px <= R; px++) for (let py = -R; py <= R; py++) {
		const cells = regionCells(l, px, py);
		expect(cells.length).toBe(regionCellCount(l));
		const box = regionBox(l, px, py);
		for (const [x, y] of cells) {
			const k = `${x}_${y}`;
			if (owner.has(k)) throw new Error(`${name(l)}: ${k} in ${owner.get(k)} and ${px}_${py}`);
			owner.set(k, `${px}_${py}`);
			expect(x >= box.x && x < box.x + box.cols && y >= box.y && y < box.y + box.rows).toBe(true);
			expect(parentOf(l, x, y)).toEqual([px, py]);
		}
	}
	// No gaps: the box of the centre parent and its neighbours is fully covered.
	const b = regionBox(l, 0, 0);
	for (let x = b.x - 2; x < b.x + b.cols + 2; x++) for (let y = b.y - 2; y < b.y + b.rows + 2; y++) {
		if (!owner.has(`${x}_${y}`)) throw new Error(`${name(l)}: gap at ${x}_${y}`);
	}
	// Six-neighbour equivalence for the inner parents.
	for (let px = -1; px <= 1; px++) for (let py = -1; py <= 1; py++) {
		const me = `${px}_${py}`;
		const touching = new Set<string>();
		for (const [x, y] of regionCells(l, px, py)) {
			for (const [a, c] of childNeighbours(l, x, y)) {
				const o = owner.get(`${a}_${c}`);
				if (o && o !== me) touching.add(o);
			}
		}
		const want = new Set(neighbourRegions(l, px, py).map(([a, c]) => `${a}_${c}`));
		expect([...touching].sort()).toEqual([...want].sort());
	}
}

describe("hex-wfc fromAxial", () => {
	it("inverts toAxial for both orientations and staggers, negatives included", () => {
		for (const o of ORIENTS) for (const s of STAGGERS) {
			for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) {
				const [q, r] = toAxial(x, y, o, s);
				expect(fromAxial(q, r, o, s)).toEqual([x, y]);
			}
		}
	});
});

describe("region layout: hex flowers", () => {
	it("has 7/19/37/61/91 cells for r = 1..5", () => {
		const base = { footprint: "hex" as const, orientation: "flat" as const, parentStagger: "odd" as const, childStagger: "odd" as const };
		expect([1, 2, 3, 4, 5].map((size) => regionCellCount({ ...base, size }))).toEqual([7, 19, 37, 61, 91]);
	});

	it("tiles exactly with six-way neighbours: r = 1..5, both orientations and staggers", () => {
		for (const l of layouts("hex", [1, 2, 3, 4, 5])) checkTiling(l, l.size >= 4 ? 2 : 3);
	});

	it("fits the region in [c−r, c+r]² around its centre cell, with a hex-shaped mask", () => {
		for (const l of layouts("hex", [1, 2, 3, 4, 5])) {
			for (const [px, py] of [[0, 0], [1, 0], [-2, 3], [3, -1]] as [number, number][]) {
				const [cx, cy] = regionCentreCell(l, px, py);
				const b = regionBox(l, px, py);
				expect(b).toEqual({ x: cx - l.size, y: cy - l.size, cols: 2 * l.size + 1, rows: 2 * l.size + 1 });
				expect(inRegion(l, px, py, cx, cy)).toBe(true);
				const mask = regionMask(l, px, py);
				expect(mask.flat().filter(Boolean).length).toBe(regionCellCount(l));
				// corners of the box belong to neighbours
				expect(mask[0][0] && mask[0][2 * l.size] && mask[2 * l.size][0] && mask[2 * l.size][2 * l.size]).toBe(false);
			}
		}
	});

	it("twists by about −19° (r=1) to −27° (r=5)", () => {
		const t = [1, 2, 3, 4, 5].map((size) => flowerTwistDegrees({ footprint: "hex", size, orientation: "flat", parentStagger: "odd", childStagger: "odd" }));
		expect(t.map((d) => Math.round(d * 10) / 10)).toEqual([-19.1, -23.4, -25.3, -26.3, -27]);
	});
});

describe("region layout: brick rectangles", () => {
	it("tiles exactly with six-way neighbours: n = 4..12 odd and even, both orientations and staggers", () => {
		for (const l of layouts("rect", [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) checkTiling(l, 3);
	});

	it("box is the n×n block, all cells in the mask", () => {
		for (const l of layouts("rect", [6, 7, 8])) {
			const b = regionBox(l, 2, 3);
			expect(b.cols).toBe(l.size);
			expect(b.rows).toBe(l.size);
			expect(regionMask(l, 2, 3).flat().every(Boolean)).toBe(true);
		}
	});

	it("bricks in shifted parent columns (flat) / rows (pointy) move by floor(n/2)", () => {
		const flat: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		expect(regionBox(flat, 0, 0)).toEqual({ x: 0, y: 0, cols: 8, rows: 8 });
		expect(regionBox(flat, 1, 0)).toEqual({ x: 8, y: 4, cols: 8, rows: 8 });
		const pointy: RegionLayout = { ...flat, orientation: "pointy", size: 7, parentStagger: "even" };
		expect(regionBox(pointy, 0, 0)).toEqual({ x: 3, y: 0, cols: 7, rows: 7 });
		expect(regionBox(pointy, 0, 1)).toEqual({ x: 0, y: 7, cols: 7, rows: 7 });
	});
});

describe("region layout: local cells and helpers", () => {
	it("round-trips child cell ↔ (parent hex, local cell)", () => {
		for (const l of [...layouts("hex", [2, 4]), ...layouts("rect", [5, 8])]) {
			for (let x = -12; x <= 12; x += 3) for (let y = -12; y <= 12; y += 2) {
				const { parent, local } = toLocal(l, x, y);
				expect(fromLocal(l, parent[0], parent[1], local[0], local[1])).toEqual([x, y]);
			}
		}
	});

	it("fromLocal is null outside the mask or the box", () => {
		const l: RegionLayout = { footprint: "hex", size: 3, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		expect(fromLocal(l, 0, 0, 0, 0)).toBeNull();
		expect(fromLocal(l, 0, 0, -1, 3)).toBeNull();
		expect(fromLocal(l, 0, 0, 3, 3)).toEqual(regionCentreCell(l, 0, 0));
	});

	it("neighbourRegions are the parent hex's neighbours", () => {
		const l: RegionLayout = { footprint: "rect", size: 8, orientation: "pointy", parentStagger: "even", childStagger: "odd" };
		expect(neighbourRegions(l, 2, 3)).toEqual(hexNeighbors(2, 3, "pointy", "even"));
	});

	it("region spacing: n·√3 for bricks, √(cells)·√3 for flowers", () => {
		const brick: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		expect(Math.abs(regionSpacing(brick) - 8 * Math.sqrt(3)) / (8 * Math.sqrt(3))).toBeLessThan(0.05);
		const flower: RegionLayout = { ...brick, footprint: "hex", size: 4 };
		expect(regionSpacing(flower)).toBeCloseTo(Math.sqrt(61) * Math.sqrt(3), 6);
	});

	it("validates sizes", () => {
		const base: RegionLayout = { footprint: "hex", size: 3, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		expect(layoutProblem(base)).toBeNull();
		expect(layoutProblem({ ...base, size: 6 })).not.toBeNull();
		expect(layoutProblem({ ...base, size: 2.5 })).not.toBeNull();
		expect(layoutProblem({ ...base, footprint: "rect", size: 8 })).toBeNull();
		expect(layoutProblem({ ...base, footprint: "rect", size: 1 })).not.toBeNull();
	});

	it("the fromAxial import matches the layout's own maths (sanity)", () => {
		expect(fromAxial(0, 0, "flat", "odd")).toEqual([0, 0]);
	});
});

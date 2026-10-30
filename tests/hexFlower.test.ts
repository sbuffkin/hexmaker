import { describe, it } from "node:test";
import expect from "expect";
import {
	applyMove,
	CELL_COORDS,
	CELL_COUNT,
	CENTRE,
	DEFAULT_MOVES,
	diceOdds,
	emptyFlower,
	longRunOdds,
	moveFor,
	neighbour,
	parseDice,
	parseMove,
	step,
	transitionMatrix,
	walk,
	wrapTarget,
	type Flower,
} from "../src/hexflower/flower";
import { cellCounts, defaultShares, fillFromPalette, fillFromShares, pickTerrains, sharesOf } from "../src/hexflower/fromPalette";
import { mulberry32 } from "../packages/hex-wfc/src/rng";

/** plan-hex-flower phase 2: the flower itself (geometry, moves, walking, odds, Fill from palette). */

const flower = (cells?: string[]): Flower => {
	const f = emptyFlower("Test");
	if (cells) f.cells = cells.map((result) => ({ result }));
	return f;
};

describe("flower geometry", () => {
	it("numbers 19 cells down the columns 1–3, 4–7, 8–12, 13–16, 17–19; 10 is the centre", () => {
		expect(CELL_COORDS).toHaveLength(CELL_COUNT);
		expect(CELL_COORDS[CENTRE - 1]).toEqual([0, 0]);
		const byColumn = [[1, 3], [4, 7], [8, 12], [13, 16], [17, 19]];
		byColumn.forEach(([a, b], c) => {
			for (let n = a; n <= b; n++) expect(CELL_COORDS[n - 1][0]).toBe(c - 2);
			// Down the column: r grows by one.
			for (let n = a; n < b; n++) expect(CELL_COORDS[n][1] - CELL_COORDS[n - 1][1]).toBe(1);
		});
	});

	it("the centre's neighbours, and moves off the edge", () => {
		expect(neighbour(10, "up")).toBe(9);
		expect(neighbour(10, "down")).toBe(11);
		expect(neighbour(10, "up-right")).toBe(14);
		expect(neighbour(10, "down-right")).toBe(15);
		expect(neighbour(10, "up-left")).toBe(5);
		expect(neighbour(10, "down-left")).toBe(6);
		expect(neighbour(8, "up")).toBeUndefined();
		expect(neighbour(1, "up-left")).toBeUndefined();
	});

	it("wraps to the far end of the same line (the published rule)", () => {
		expect(wrapTarget(8, "up")).toBe(12);
		expect(wrapTarget(12, "down")).toBe(8);
		expect(wrapTarget(1, "up-left")).toBe(19);
		expect(wrapTarget(19, "down-right")).toBe(1);
		// Every edge move lands on the flower.
		for (let c = 1; c <= CELL_COUNT; c++) for (const d of ["up", "down", "up-right", "down-right", "up-left", "down-left"] as const) {
			const to = neighbour(c, d) ?? wrapTarget(c, d);
			expect(to >= 1 && to <= CELL_COUNT).toBe(true);
		}
	});
});

describe("moves", () => {
	it("the default 2d6 navigation: 2–3 up-right, 4–5 down-right, 6–7 down, 8–9 down-left, 10–11 up-left, 12 up", () => {
		const want: Record<number, string> = { 2: "up-right", 3: "up-right", 4: "down-right", 5: "down-right", 6: "down", 7: "down", 8: "down-left", 9: "down-left", 10: "up-left", 11: "up-left", 12: "up" };
		for (const [t, m] of Object.entries(want)) expect(moveFor(DEFAULT_MOVES, Number(t))).toBe(m);
		expect(moveFor(DEFAULT_MOVES, 13)).toBe("stay");
	});

	it("reads move words and compass points forgivingly", () => {
		expect(parseMove("Up")).toBe("up");
		expect(parseMove(" down left ")).toBe("down-left");
		expect(parseMove("NE")).toBe("up-right");
		expect(parseMove("sw")).toBe("down-left");
		expect(parseMove("stay")).toBe("stay");
		expect(parseMove("sideways")).toBeUndefined();
	});

	it("dice: 2d6 odds sum to 1 with 7 the most likely; other dice read too", () => {
		const odds = diceOdds("2d6");
		expect([...odds.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
		expect(odds.get(7)).toBeCloseTo(6 / 36, 10);
		expect(parseDice("d8")).toEqual({ count: 1, sides: 8 });
		expect(parseDice("3d4")).toEqual({ count: 3, sides: 4 });
		expect(parseDice("lots")).toBeUndefined();
	});
});

describe("walking", () => {
	it("wrap and stay edges; a blocked cell is never entered", () => {
		const f = flower();
		expect(applyMove(f, 8, "up")).toEqual({ cell: 12, move: "up", wrapped: true });
		f.edges = "stay";
		expect(applyMove(f, 8, "up")).toEqual({ cell: 8, move: "up", stayed: true });
		f.edges = "wrap";
		f.cells[9 - 1] = { result: "(blocked)" };
		expect(applyMove(f, 10, "up")).toEqual({ cell: 10, move: "up", stayed: true });
		expect(applyMove(f, 10, "stay")).toEqual({ cell: 10, move: "stay" });
	});

	it("is deterministic for a seed", () => {
		const f = flower();
		const a = walk(f, CENTRE, 30, mulberry32(42)).map((s) => s.cell);
		const b = walk(f, CENTRE, 30, mulberry32(42)).map((s) => s.cell);
		expect(a).toEqual(b);
		expect(step(f, CENTRE, mulberry32(7)).total).toBeGreaterThanOrEqual(2);
	});

	it("each transition row sums to 1", () => {
		for (const row of transitionMatrix(flower())) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
	});

	it("long-run odds match a 100,000-step walk", () => {
		const f = flower();
		f.cells[3 - 1] = { result: "(blocked)" };
		const odds = longRunOdds(f, 4000);
		const counts = new Array<number>(CELL_COUNT).fill(0);
		const N = 100_000;
		for (const s of walk(f, f.start, N, mulberry32(1234))) counts[s.cell - 1]++;
		counts.forEach((n, i) => expect(Math.abs(n / N - odds[i])).toBeLessThan(0.01));
		expect(odds[3 - 1]).toBe(0);
	});
});

describe("Fill from palette", () => {
	const palette = ["grassland", "forest", "hills", "mountains", "swamp", "lake", "desert", "tundra"];

	it("whole cell counts add up and give every share a cell", () => {
		expect(cellCounts([1, 1, 1], 19).reduce((a, b) => a + b, 0)).toBe(19);
		expect(cellCounts([100, 1], 19)).toEqual([18, 1]);
		expect(cellCounts([0, 2], 19)).toEqual([0, 19]);
	});

	it("uses only the palette's terrains, at most six, the same for the same seed", () => {
		const a = fillFromPalette(palette, 99);
		expect(a).toHaveLength(CELL_COUNT);
		expect(a.every((c) => palette.includes(c.result))).toBe(true);
		expect(new Set(a.map((c) => c.result)).size).toBeLessThanOrEqual(6);
		expect(fillFromPalette(palette, 99)).toEqual(a);
		expect(pickTerrains(palette, 99)).toEqual(pickTerrains(palette, 99));
		expect(pickTerrains(["a", "b"], 1)).toEqual(["a", "b"]);
	});

	it("follows the shares, lays patches, starts the first on the centre and keeps blocked cells", () => {
		const keep = emptyFlower("k").cells;
		keep[0] = { result: "(blocked)", notes: "cliff" };
		const cells = fillFromShares([{ terrain: "a", weight: 3 }, { terrain: "b", weight: 1 }], 5, keep);
		expect(cells[0]).toEqual({ result: "(blocked)", notes: "cliff" });
		expect(cells[CENTRE - 1].result).toBe("a");
		const counts = sharesOf(cells);
		expect(counts.find((s) => s.terrain === "a")!.weight + counts.find((s) => s.terrain === "b")!.weight).toBe(18);
		expect(counts.find((s) => s.terrain === "a")!.weight).toBeGreaterThan(counts.find((s) => s.terrain === "b")!.weight);
		expect(defaultShares(["a", "b"], 3).every((s) => s.weight >= 1 && s.weight <= 4)).toBe(true);
	});
});


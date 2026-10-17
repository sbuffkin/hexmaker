import { describe, it } from "node:test";
import expect from "expect";
import { HexNotesService } from "../src/services/HexNotesService";
import { bandKeys, describeGrowth, gridBoxOf, grownGrid, growthFor, NO_ROOM, reachBox, roomNeeded, sameGrid, type GridBox } from "../src/maps/gridGrowth";

/** plan-hf4-map-grows: how far a map must grow for a hex near its edge (pure). */

const FIVE: GridBox = { x: 0, y: 0, cols: 5, rows: 5 };
const ORIENTS = ["flat", "pointy"] as const;
const STAGGERS = ["odd", "even"] as const;

describe("room around a hex (gridGrowth)", () => {
	it("sight 0–3 from the middle of a 5×5 map: short by d − 2 on every side, for every orientation and stagger", () => {
		for (const o of ORIENTS) for (const s of STAGGERS) for (const d of [0, 1, 2, 3]) {
			const short = Math.max(0, d - 2);
			expect({ o, s, d, room: roomNeeded(FIVE, "2_2", d, o, s) }).toEqual({ o, s, d, room: { top: short, bottom: short, left: short, right: short } });
		}
	});

	it("an edge hex: only the sides it is near are short", () => {
		for (const o of ORIENTS) for (const s of STAGGERS) {
			expect(roomNeeded(FIVE, "2_0", 1, o, s).top).toBe(1);
			expect(roomNeeded(FIVE, "2_0", 1, o, s).bottom).toBe(0);
			expect(roomNeeded(FIVE, "4_2", 2, o, s)).toEqual({ top: 0, bottom: 0, left: 0, right: 2 });
		}
	});

	it("flat-top columns stagger by parity: an odd column's lower neighbours reach one row further down", () => {
		// odd stagger: column 1 is pushed down, so from 1_4 the neighbours 0_5 and 2_5 exist as well as 1_5.
		expect(reachBox("1_4", 1, "flat", "odd")).toEqual({ x: 0, y: 3, cols: 3, rows: 3 });
		expect(reachBox("2_4", 1, "flat", "odd")).toEqual({ x: 1, y: 3, cols: 3, rows: 3 });
		expect(reachBox("1_0", 1, "flat", "odd")).toEqual({ x: 0, y: -1, cols: 3, rows: 3 });
	});

	it("corners and negative offsets", () => {
		const grid: GridBox = { x: -3, y: -2, cols: 4, rows: 4 };
		for (const o of ORIENTS) for (const s of STAGGERS) {
			const r = roomNeeded(grid, "-3_-2", 1, o, s);
			expect(r.top).toBe(1);
			expect(r.left).toBe(1);
			expect(r.bottom + r.right).toBe(0);
		}
	});

	it("an already roomy map needs nothing", () => {
		const big: GridBox = { x: -10, y: -10, cols: 30, rows: 30 };
		for (const o of ORIENTS) for (const s of STAGGERS) {
			expect(roomNeeded(big, "4_4", 4, o, s)).toEqual(NO_ROOM);
			expect(growthFor(big, "4_4", 4, 6, o, s)).toEqual(NO_ROOM);
		}
	});

	it("grows in chunks: a side short of what must be seen gets room for sight + 3, the others nothing", () => {
		// Sight 0 at the top edge: the "?" ring (1) is off the map, so grow to 3 rows of room.
		const g = growthFor(FIVE, "2_0", 1, 3, "flat", "odd");
		expect(g).toEqual({ top: 3, bottom: 0, left: 0, right: 0 });
		// The next steps north fit without growing again.
		const next = grownGrid(FIVE, g);
		expect(next).toEqual({ x: 0, y: -3, cols: 5, rows: 8 });
		expect(growthFor(next, "2_-1", 1, 3, "flat", "odd")).toEqual(NO_ROOM);
		expect(growthFor(next, "2_-2", 1, 3, "flat", "odd")).toEqual(NO_ROOM);
		// A corner grows both ways.
		expect(growthFor(FIVE, "0_0", 1, 3, "pointy", "odd")).toEqual({ top: 3, bottom: 0, left: 3, right: 0 });
	});

	it("the band a shrink drops, and the grid of a map", () => {
		expect(bandKeys({ x: 0, y: -2, cols: 2, rows: 4 }, { x: 0, y: 0, cols: 2, rows: 2 })).toEqual(["0_-2", "1_-2", "0_-1", "1_-1"]);
		expect(bandKeys(FIVE, FIVE)).toEqual([]);
		expect(gridBoxOf({ gridSize: { cols: 3, rows: 4 } })).toEqual({ x: 0, y: 0, cols: 3, rows: 4 });
		expect(gridBoxOf({ gridSize: { cols: 3, rows: 4 }, gridOffset: { x: -1, y: 2 } })).toEqual({ x: -1, y: 2, cols: 3, rows: 4 });
		expect(sameGrid(FIVE, { ...FIVE })).toBe(true);
		expect(sameGrid(FIVE, { ...FIVE, y: -1 })).toBe(false);
	});

	it("says what grew, in compass words", () => {
		expect(describeGrowth(NO_ROOM)).toBe("");
		expect(describeGrowth({ top: 3, bottom: 0, left: 0, right: 0 })).toBe("The map grew 3 rows north.");
		expect(describeGrowth({ top: 1, bottom: 0, left: 2, right: 0 })).toBe("The map grew 1 row north and 2 columns west.");
		expect(describeGrowth({ top: 0, bottom: 2, left: 0, right: 1 })).toBe("The map grew 2 rows south and 1 column east.");
	});

	it("hex notes of hexes grown at the top or left have plain negative paths", () => {
		const notes = new HexNotesService({ settings: { hexFolder: "world/hexes" } } as never);
		expect(notes.hexPath(-2, -1, "m")).toBe("world/hexes/m/-2_-1.md");
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import { edgeHex, routeContextPaths } from "../src/worldgen/procedural/contextPaths";
import { centerHex, distance, type ProcGrid } from "../src/worldgen/procedural/common";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";

const flat: ProcGrid = { cols: 13, rows: 9, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
const pointy: ProcGrid = { ...flat, orientation: "pointy" };
const parse = (k: string) => k.split("_").map(Number) as [number, number];

/** All-grass cells, optionally with a band of ocean down the middle columns. */
function cells(grid: ProcGrid, waterCols: number[] = []): Map<string, string> {
	const m = new Map<string, string>();
	for (let x = 0; x < grid.cols; x++)
		for (let y = 0; y < grid.rows; y++) m.set(`${x}_${y}`, waterCols.includes(x) ? "ocean" : "grass");
	return m;
}

describe("edgeHex", () => {
	for (const grid of [flat, pointy]) {
		it(`picks the middle of each edge (${grid.orientation})`, () => {
			const [ex, ey] = edgeHex(grid, "E");
			const [wx, wy] = edgeHex(grid, "W");
			const [nx, ny] = edgeHex(grid, "N");
			const [sx, sy] = edgeHex(grid, "S");
			expect(ex).toBe(grid.cols - 1);
			expect(wx).toBe(0);
			expect(ny).toBe(0);
			expect(sy).toBe(grid.rows - 1);
			// Near the middle of the edge.
			expect(Math.abs(ey - (grid.rows - 1) / 2)).toBeLessThanOrEqual(1);
			expect(Math.abs(wy - (grid.rows - 1) / 2)).toBeLessThanOrEqual(1);
			expect(Math.abs(nx - (grid.cols - 1) / 2)).toBeLessThanOrEqual(1);
			expect(Math.abs(sx - (grid.cols - 1) / 2)).toBeLessThanOrEqual(1);
		});
	}

	it("adjacent submaps meet: one map's east point and the next map's west point sit on the same row", () => {
		// Same-size submaps of two horizontally adjacent parent hexes.
		expect(edgeHex(flat, "E")[1]).toBe(edgeHex(flat, "W")[1]);
		expect(edgeHex(pointy, "E")[1]).toBe(edgeHex(pointy, "W")[1]);
		// …and north/south points share a column.
		expect(edgeHex(flat, "N")[0]).toBe(edgeHex(flat, "S")[0]);
	});

	it("corner sides pick a corner hex", () => {
		const [x, y] = edgeHex(flat, "NE");
		expect(x).toBeGreaterThanOrEqual(flat.cols - 2);
		expect(y).toBeLessThanOrEqual(1);
	});
});

describe("routeContextPaths", () => {
	it("carries a road from the west edge to the east edge as one connected chain", () => {
		const [road] = routeContextPaths(cells(flat), DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", routing: "through", from: "W", to: "E" }], 1);
		expect(road.type).toBe("Road");
		const pts = road.hexes.map(parse);
		expect(pts[0]).toEqual(edgeHex(flat, "W"));
		expect(pts[pts.length - 1]).toEqual(edgeHex(flat, "E"));
		for (let i = 1; i < pts.length; i++) expect(distance(pts[i - 1], pts[i], flat)).toBe(1);
	});

	it("a road that ends in the parent hex runs to the map's centre", () => {
		const [road] = routeContextPaths(cells(flat), DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", from: "S" }], 1);
		expect(parse(road.hexes[road.hexes.length - 1])).toEqual(centerHex(flat));
	});

	it("roads detour around water when they can; rivers go straight into it", () => {
		// A lake in the middle (columns 5–7, rows 2–6), land around it.
		const m = cells(flat);
		for (let x = 5; x <= 7; x++) for (let y = 2; y <= 6; y++) m.set(`${x}_${y}`, "ocean");
		const [road] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", from: "W", to: "E" }], 3);
		expect(road.hexes.filter((k) => m.get(k) === "ocean")).toEqual([]);
		const [river] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "River", routing: "meander", from: "W", to: "E" }], 3);
		expect(river.hexes.some((k) => m.get(k) === "ocean")).toBe(true);
	});

	it("a road crosses water only when there is no way around (a bridge)", () => {
		const m = cells(flat, [6]); // a full-height channel
		const [road] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", from: "W", to: "E" }], 1);
		expect(road.hexes.filter((k) => m.get(k) === "ocean")).toHaveLength(1);
	});

	it("rivers meander (seeded) while roads stay direct", () => {
		const grid: ProcGrid = { ...flat, cols: 21, rows: 15 };
		const m = cells(grid);
		const [road] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, grid, [{ type: "Road", from: "W", to: "E" }], 7);
		const rivers = [1, 2, 3, 4].map((seed) => routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, grid, [{ type: "River", routing: "meander", from: "W", to: "E" }], seed)[0].hexes.join());
		expect(road.hexes.length).toBe(grid.cols); // straight across
		expect(new Set(rivers).size).toBeGreaterThan(1); // seeds differ
		expect(routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, grid, [{ type: "River", routing: "meander", from: "W", to: "E" }], 2)[0].hexes.join()).toBe(rivers[1]);
	});

	it("routes over a blank map (no terrain) and skips paths with no sides", () => {
		const out = routeContextPaths(new Map(), DEFAULT_TERRAIN_PALETTE, flat, [
			{ type: "Road", from: "N", to: "S" },
			{ type: "Road" },
		], 1);
		expect(out).toHaveLength(1);
		expect(parse(out[0].hexes[0])).toEqual(edgeHex(flat, "N"));
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import { edgeHex, pairCrossings, routeContextPaths } from "../src/worldgen/procedural/contextPaths";
import { centerHex, distance, type ProcGrid } from "../src/worldgen/procedural/common";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { generatedToMapPaths, routedBranches } from "../src/paths/fromGenerated";
import { mapRouteContext, pathTypeStyleFor } from "../src/paths/mapContext";
import { stepsOf } from "../src/paths/fromHexes";
import { impassableNames } from "../src/impassable";

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
		const [river] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "River", routing: "meander", avoidImpassable: false, autoRoute: "winding", from: "W", to: "E" }], 3);
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
		const rivers = [1, 2, 3, 4].map((seed) => routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, grid, [{ type: "River", routing: "meander", avoidImpassable: false, autoRoute: "winding", from: "W", to: "E" }], seed)[0].hexes.join());
		expect(road.hexes.length).toBe(grid.cols); // straight across
		expect(new Set(rivers).size).toBeGreaterThan(1); // seeds differ
		expect(routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, grid, [{ type: "River", routing: "meander", avoidImpassable: false, autoRoute: "winding", from: "W", to: "E" }], 2)[0].hexes.join()).toBe(rivers[1]);
	});

	it("goes by the type's options, never its name (PA5)", () => {
		const m = cells(flat);
		for (let x = 5; x <= 7; x++) for (let y = 2; y <= 6; y++) m.set(`${x}_${y}`, "ocean");
		// A "River" set to avoid impassable terrain and route direct is routed like a road…
		const [river] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "River", routing: "meander", avoidImpassable: true, autoRoute: "direct", from: "W", to: "E" }], 3);
		const [road] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", from: "W", to: "E" }], 3);
		expect(river.hexes).toEqual(road.hexes);
		// …and any name with the river options runs into the water.
		const [canal] = routeContextPaths(m, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Ley line", avoidImpassable: false, autoRoute: "winding", from: "W", to: "E" }], 3);
		expect(canal.hexes.some((k) => m.get(k) === "ocean")).toBe(true);
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

describe("pairCrossings (neighbour regions' paths crossing into a new map)", () => {
	it("joins a west and an east crossing of the same type into one path through", () => {
		const out = pairCrossings([
			{ type: "Road", hex: "0_4" },
			{ type: "Road", hex: "12_4" },
		], flat);
		expect(out).toHaveLength(1);
		expect(new Set([out[0].fromHex, out[0].toHex])).toEqual(new Set(["0_4", "12_4"]));
	});

	it("keeps types apart, sends an odd one out to the centre, and dedupes", () => {
		const out = pairCrossings([
			{ type: "Road", hex: "0_4" },
			{ type: "Road", hex: "0_4" },
			{ type: "River", routing: "meander", avoidImpassable: false, autoRoute: "winding", hex: "6_0" },
		], flat);
		expect(out).toHaveLength(2);
		const river = out.find((p) => p.type === "River")!;
		expect(river.fromHex).toBe("6_0");
		expect(river.toHex).toBeUndefined();
		expect(river).toMatchObject({ routing: "meander", avoidImpassable: false, autoRoute: "winding" });
	});

	it("four crossings pair across the map, not around a corner", () => {
		const out = pairCrossings(["0_4", "12_4", "6_0", "6_8"].map((hex) => ({ type: "Road", hex })), flat);
		expect(out).toHaveLength(2);
		const pairs = out.map((p) => [p.fromHex, p.toHex].sort().join(" ")).sort();
		expect(pairs).toEqual(["0_4 12_4", "6_0 6_8"]);
	});

	it("routeContextPaths uses exact entry hexes over sides", () => {
		const [road] = routeContextPaths(cells(flat), DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", fromHex: "0_1", toHex: "12_7", from: "N", to: "S" }], 1);
		expect(road.hexes[0]).toBe("0_1");
		expect(road.hexes[road.hexes.length - 1]).toBe("12_7");
	});
});

// Phase 6: generated paths are stored as anchors; what the map draws (the
// editor router between those anchors, under the map's own routing context)
// must be exactly the hexes the generator produced.
describe("context paths become anchored map paths", () => {
	const styleFor = pathTypeStyleFor(DEFAULT_PATH_TYPES);
	const ctxFor = (grid: ProcGrid, c: Map<string, string>) => mapRouteContext({
		orientation: grid.orientation, stagger: grid.stagger,
		gridSize: { cols: grid.cols, rows: grid.rows }, gridOffset: grid.offset,
		terrainOf: [...c].map(([k, terrain]): [string, { terrain: string }] => [k, { terrain }]),
		impassable: impassableNames(DEFAULT_TERRAIN_PALETTE),
	});
	const sameSteps = (a: readonly (readonly string[])[], b: readonly (readonly string[])[]) => {
		const x = stepsOf(a), y = stepsOf(b);
		return x.size === y.size && [...x].every((k) => y.has(k));
	};

	for (const orientation of ["flat", "pointy"] as const) {
		for (const stagger of ["odd", "even"] as const) {
			it(`resolved chains equal the generated hexes (${orientation}, ${stagger})`, () => {
				const grid: ProcGrid = { ...flat, orientation, stagger };
				const c = cells(grid, [6]); // a sea channel the road has to bridge
				for (let seed = 1; seed <= 8; seed++) {
					const routed = routeContextPaths(c, DEFAULT_TERRAIN_PALETTE, grid, [
						{ type: "Road", avoidImpassable: true, autoRoute: "direct", from: "W", to: "E" },
						{ type: "River", avoidImpassable: false, autoRoute: "winding", from: "N", to: "S" },
					], seed);
					expect(routed).toHaveLength(2);
					const ctx = ctxFor(grid, c);
					const { paths, inexact } = generatedToMapPaths(routed.map((p) => ({ typeName: p.type, hexes: p.hexes })), ctx, { styleFor });
					expect(inexact).toEqual([]);
					expect(paths.map((p) => [p.name, p.typeName, p.branches.length])).toEqual([["Road", "Road", 1], ["River", "River", 1]]);
					for (const p of paths) {
						const gen = routed.find((r) => r.type === p.typeName)!.hexes;
						expect(routedBranches(p, ctx, styleFor)).toEqual([gen]);
						expect(p.branches[0].anchors[0]).toBe(gen[0]);
						expect(p.branches[0].anchors[p.branches[0].anchors.length - 1]).toBe(gen[gen.length - 1]);
						expect(p.branches[0].anchors.length).toBeLessThanOrEqual(gen.length);
					}
				}
			});
		}
	}

	it("roads that meet at the centre become one road with branches, drawing the same steps", () => {
		const c = cells(flat);
		const routed = routeContextPaths(c, DEFAULT_TERRAIN_PALETTE, flat, [
			{ type: "Road", from: "W" },
			{ type: "Road", from: "E" },
			{ type: "Road", from: "N" },
		], 3);
		expect(routed).toHaveLength(3);
		const ctx = ctxFor(flat, c);
		const { paths } = generatedToMapPaths(routed.map((p) => ({ typeName: p.type, hexes: p.hexes })), ctx, { styleFor });
		expect(paths).toHaveLength(1);
		expect(paths[0].name).toBe("Road");
		expect(paths[0].branches.length).toBeGreaterThan(1);
		expect(sameSteps(routedBranches(paths[0], ctx, styleFor), routed.map((r) => r.hexes))).toBe(true);
	});

	it("names new paths around the map's existing ones", () => {
		const c = cells(flat);
		const routed = routeContextPaths(c, DEFAULT_TERRAIN_PALETTE, flat, [{ type: "Road", from: "W", to: "E" }], 1);
		const { paths } = generatedToMapPaths(routed.map((p) => ({ typeName: p.type, hexes: p.hexes })), ctxFor(flat, c), { styleFor, taken: ["road", "Road 2"] });
		expect(paths.map((p) => p.name)).toEqual(["Road 3"]);
	});
});

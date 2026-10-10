import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { ghostPathRuns, ghostRunPoints, seamJoins, seamPoint, type ShadowRef } from "../src/hex-map/ghostPaths";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

/**
 * This map: 4×3 at offset 0,0. Its southern neighbour "south" is 4×3 too,
 * its own hexes 0..3 × 0..2; in this map's frame they sit at y = 3..5.
 * A one-deep strip: this map's keys x_3 → south's x_0.
 */
function strip(depth = 1): Map<string, ShadowRef> {
	const m = new Map<string, ShadowRef>();
	for (let y = 0; y < depth; y++)
		for (let x = 0; x < 4; x++) m.set(`${x}_${3 + y}`, { map: "south", x, y });
	return m;
}

describe("ghostPathRuns (fresh-eyes round 4: neighbour roads in the ghost strip)", () => {
	it("maps a neighbour road crossing the strip into this map's frame, heading off past it", () => {
		// South's road runs north to its top edge: 2_2 → 2_1 → 2_0.
		const runs = ghostPathRuns(strip(), () => [{ typeName: "Road", hexes: ["2_2", "2_1", "2_0"] }]);
		expect(runs).toEqual([
			{ map: "south", typeName: "Road", hexes: ["2_4", "2_3"], stubStart: true, stubEnd: false },
		]);
	});

	it("keeps both ends' direction when a path only passes through the strip", () => {
		const runs = ghostPathRuns(strip(), () => [{ typeName: "River", hexes: ["0_1", "0_0", "1_0", "2_1"] }]);
		expect(runs).toEqual([
			{ map: "south", typeName: "River", hexes: ["0_4", "0_3", "1_3", "2_4"], stubStart: true, stubEnd: true },
		]);
	});

	it("splits a path that leaves the strip and comes back", () => {
		const runs = ghostPathRuns(strip(), () => [{ typeName: "Road", hexes: ["0_0", "0_1", "1_1", "1_0"] }]);
		expect(runs.map((r) => r.hexes)).toEqual([["0_3", "0_4"], ["1_4", "1_3"]]);
	});

	it("skips paths that never reach the strip, and lone strip hexes with nowhere to go", () => {
		expect(ghostPathRuns(strip(), () => [{ typeName: "Road", hexes: ["0_2", "1_2"] }])).toEqual([]);
		expect(ghostPathRuns(strip(), () => [{ typeName: "Road", hexes: ["3_0"] }])).toEqual([]);
	});

	it("handles several neighbours, each with its own offset", () => {
		const shadow = strip();
		// East neighbour (its 0_y sits at this map's 4_y).
		for (let y = 0; y < 3; y++) shadow.set(`4_${y}`, { map: "east", x: 0, y });
		const chains: Record<string, { typeName: string; hexes: string[] }[]> = {
			south: [{ typeName: "Road", hexes: ["1_1", "1_0"] }],
			east: [{ typeName: "River", hexes: ["0_0", "0_1", "1_1"] }],
		};
		const runs = ghostPathRuns(shadow, (m) => chains[m]);
		expect(runs).toContainEqual({ map: "south", typeName: "Road", hexes: ["1_4", "1_3"], stubStart: true, stubEnd: false });
		expect(runs).toContainEqual({ map: "east", typeName: "River", hexes: ["4_0", "4_1", "5_1"], stubStart: false, stubEnd: true });
	});

	it("tolerates a neighbour with no paths", () => {
		expect(ghostPathRuns(strip(), () => undefined)).toEqual([]);
	});
});

describe("ghostRunPoints", () => {
	const centre = (k: string) => {
		const [x, y] = k.split("_").map(Number);
		return { cx: x * 10, cy: y * 10 };
	};
	it("cuts stub ends to the midpoint toward the hex past the strip", () => {
		const pts = ghostRunPoints({ map: "s", typeName: "Road", hexes: ["2_4", "2_3"], stubStart: true, stubEnd: false }, centre);
		expect(pts).toEqual([{ cx: 20, cy: 35 }, { cx: 20, cy: 30 }]);
	});
	it("leaves chain ends at the hex centre", () => {
		const pts = ghostRunPoints({ map: "s", typeName: "Road", hexes: ["0_3", "1_3"], stubStart: false, stubEnd: false }, centre);
		expect(pts).toEqual([{ cx: 0, cy: 30 }, { cx: 10, cy: 30 }]);
	});
});

describe("HexMapView draws them in the strip", () => {
	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
	it("from the neighbours' own path chains, read-only, on the strip layer", () => {
		const m = /private renderNeighbourShadow[\s\S]*?\n {2}\}\n/.exec(view);
		expect(m).not.toBeNull();
		const body = m![0];
		expect(body).toMatch(/ghostPathRuns\(shadow, \(m\) => this\.plugin\.getMap\(m\)\?\.pathChains\)/);
		expect(body).toMatch(/svg\.classList\.add\("duckmage-region-shadow-paths"\)/);
		expect(body).toMatch(/layer\.appendChild\(svg\)/);
		// Reads (place/offsetWidth) before the first write (createDiv).
		expect(body.indexOf("gridContainer.offsetWidth / em")).toBeLessThan(body.indexOf("gridContainer.createDiv"));
	});
});

describe("seamJoins (round 6 U8: roads meeting at a seam left a gap)", () => {
	const touches = (a: string, b: string) => {
		const [x, y] = a.split("_").map(Number);
		return hexNeighbors(x, y, "flat", "odd").some(([nx, ny]) => `${nx}_${ny}` === b);
	};

	it("joins this map's road ending on the edge with the neighbour's road starting across it", () => {
		// Ours runs down to 2_2 (bottom row); south's starts at its 2_0 = our 2_3.
		const ours = [{ typeName: "Road", hexes: ["2_0", "2_1", "2_2"] }];
		const joins = seamJoins(ours, strip(), () => [{ typeName: "Road", hexes: ["2_0", "2_1"] }], touches);
		expect(joins).toEqual([{ map: "south", typeName: "Road", own: "2_2", other: "2_3" }]);
	});

	it("works from either end of either chain", () => {
		const ours = [{ typeName: "Road", hexes: ["2_2", "1_1"] }];
		const joins = seamJoins(ours, strip(), () => [{ typeName: "Road", hexes: ["3_2", "2_1", "2_0"] }], touches);
		expect(joins.map((j) => `${j.own}>${j.other}`)).toEqual(["2_2>2_3"]);
	});

	it("doesn't join different path types, hexes that don't touch, or a path that carries on", () => {
		const ours = [{ typeName: "Road", hexes: ["0_0", "0_1", "0_2"] }];
		expect(seamJoins(ours, strip(), () => [{ typeName: "River", hexes: ["0_0", "0_1"] }], touches)).toEqual([]);
		expect(seamJoins(ours, strip(), () => [{ typeName: "Road", hexes: ["3_0", "3_1"] }], touches)).toEqual([]);
		// South's road only passes along its top row: its ends are deep inside, not at our seam.
		expect(seamJoins(ours, strip(), () => [{ typeName: "Road", hexes: ["0_2", "0_1", "0_0", "1_0", "1_1", "1_2"] }], touches)).toEqual([]);
	});

	it("meets halfway: the shared edge between the two hex centres", () => {
		expect(seamPoint({ cx: 10, cy: 20 }, { cx: 10, cy: 40 })).toEqual({ cx: 10, cy: 30 });
	});
});

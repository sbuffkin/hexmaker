import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MOON_TETHER_STYLE, moonPlanetLinks, moonTethers, tether } from "../src/hex-map/moonLinks";
import { latticeCenter } from "../src/paths/pathGeometry";
import type { TerrainColor } from "../src/types";

const palette: TerrainColor[] = [
	{ name: "void", color: "#000000", type: "void" },
	{ name: "Luna", color: "#cccccc", type: "moon" },
	{ name: "Terra", color: "#33aa55", type: "world" },
	{ name: "Jove", color: "#cc9966", type: "gas-giant" },
	{ name: "moon rock", color: "#999999" }, // untyped: never a moon, whatever its name
	{ name: "planet x", color: "#999999" }, // untyped: never a planet
] as TerrainColor[];

describe("moons tied to their planet (S11)", () => {
	it("ties a moon-typed hex to each planet-typed neighbour, by type not name", () => {
		const t = new Map([["2_2", "Luna"], ["2_1", "Terra"], ["3_2", "void"], ["5_5", "luna"], ["5_6", "Jove"], ["8_8", "moon rock"], ["8_9", "Terra"], ["10_10", "Luna"], ["10_9", "planet x"]]);
		expect(moonPlanetLinks(t, palette, "flat", "odd")).toEqual([["2_2", "2_1"], ["5_5", "5_6"]]);
	});

	it("draws nothing without moons or beside nothing", () => {
		expect(moonPlanetLinks(new Map([["0_0", "Luna"], ["4_4", "Terra"]]), palette, "pointy", "even")).toEqual([]);
	});

	it("follows the grid's orientation and stagger", () => {
		// Flat, odd: (1,0) touches (2,1); pointy, odd: it does not.
		const t = new Map([["1_0", "Luna"], ["2_1", "Terra"]]);
		expect(moonPlanetLinks(t, palette, "flat", "odd")).toEqual([["1_0", "2_1"]]);
		expect(moonPlanetLinks(t, palette, "pointy", "odd")).toEqual([]);
	});

	it("draws the middle of the line between the two centres", () => {
		expect(tether({ cx: 0, cy: 0 }, { cx: 10, cy: 0 })).toEqual([{ cx: 3, cy: 0 }, { cx: 7, cy: 0 }]);
	});
});

describe("moon tethers: the same segments on screen and in the PNG export", () => {
	it("gives each tie's segment in lattice units", () => {
		const t = new Map([["2_2", "Luna"], ["2_1", "Terra"]]);
		const grid = { orientation: "flat", stagger: "odd" } as const;
		const segs = moonTethers(t, palette, grid);
		expect(segs).toEqual([tether(latticeCenter("2_2", grid), latticeCenter("2_1", grid))]);
	});

	it("drops ties with an end outside the drawn range", () => {
		const t = new Map([["2_2", "Luna"], ["2_1", "Terra"], ["5_5", "Luna"], ["5_6", "Jove"]]);
		const grid = { orientation: "flat", stagger: "odd" } as const;
		expect(moonTethers(t, palette, grid, (k) => k !== "5_6")).toHaveLength(1);
		expect(moonTethers(t, palette, grid, () => false)).toEqual([]);
	});

	it("the map view and the PNG export both draw moonTethers with MOON_TETHER_STYLE", () => {
		const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8");
		const png = readFileSync(path.join(process.cwd(), "src", "export", "mapPngRenderer.ts"), "utf8");
		for (const src of [view, png]) {
			expect(src).toMatch(/moonTethers\(/);
			expect(src).toMatch(/MOON_TETHER_STYLE\.width \* /);
		}
		// The export draws them only with the paths.
		const showPaths = png.indexOf("if (showPaths) {");
		expect(showPaths).toBeGreaterThan(-1);
		expect(png.indexOf("moonTethers(", showPaths)).toBeGreaterThan(showPaths);
		expect(png).toMatch(/MOON_TETHER_STYLE\.color/);
		expect(png).toMatch(/globalAlpha = MOON_TETHER_STYLE\.opacity/);
	});

	it("styles.css paints the on-screen tether in the export's colour and opacity", () => {
		const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");
		const rule = /\.duckmage-moon-link \{([^}]*)\}/.exec(css)![1];
		expect(rule).toMatch(new RegExp(`stroke: ${MOON_TETHER_STYLE.color};`));
		expect(rule).toMatch(new RegExp(`opacity: ${MOON_TETHER_STYLE.opacity};`));
	});
});

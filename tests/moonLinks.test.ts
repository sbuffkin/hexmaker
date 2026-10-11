import { describe, it } from "node:test";
import expect from "expect";
import { moonPlanetLinks, tether } from "../src/hex-map/moonLinks";
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

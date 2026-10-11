import { describe, it } from "node:test";
import expect from "expect";
import { paletteSwatchList } from "../src/palettes/paletteOptions";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";

describe("palette preview swatches (E4)", () => {
	it("lists each terrain once, in palette order, with its colour", () => {
		expect(paletteSwatchList([
			{ name: "grass", color: "#88cc66" },
			{ name: " Grass ", color: "#000000" },
			{ name: "sea", color: "#2255aa" },
			{ name: "", color: "#ffffff" },
		])).toEqual([{ name: "grass", color: "#88cc66" }, { name: "sea", color: "#2255aa" }]);
	});

	it("shows a terrain without a usable colour as grey", () => {
		expect(paletteSwatchList([{ name: "fog" }, { name: "ash", color: "red; background: url(x)" }]))
			.toEqual([{ name: "fog", color: "#888888" }, { name: "ash", color: "#888888" }]);
	});

	it("tells Limited from Expanded at a glance", () => {
		const limited = paletteSwatchList(LIMITED_TERRAIN_PALETTE);
		const expanded = paletteSwatchList(DEFAULT_TERRAIN_PALETTE);
		expect(limited.length).toBeGreaterThan(0);
		expect(expanded.length).toBeGreaterThan(limited.length);
	});
});

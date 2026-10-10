import { describe, it } from "node:test";
import expect from "expect";
import { hexHoverLabel } from "../src/hex-map/hexHover";

describe("hexHoverLabel", () => {
	it("names the hex's terrain and coordinates", () => {
		expect(hexHoverLabel(10, 7, "ice planet", "void")).toBe("ice planet · hex 10, 7");
	});

	it("marks the map's base terrain on a hex with none of its own", () => {
		expect(hexHoverLabel(3, 4, null, "void")).toBe("void (map base) · hex 3, 4");
	});

	it("falls back to the coordinates", () => {
		expect(hexHoverLabel(0, 0, null, null)).toBe("Hex 0, 0");
	});
});

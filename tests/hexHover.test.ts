import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { hexHoverLabel, hexKeyCoords } from "../src/hex-map/hexHover";

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

describe("coordinates read \"x, y\" everywhere people see them (fresh-eyes round 5)", () => {
	it("hexKeyCoords turns an x_y key into x, y", () => {
		expect(hexKeyCoords("3_4")).toBe("3, 4");
		expect(hexKeyCoords("-2_10")).toBe("-2, 10");
		expect(hexKeyCoords("not-a-key")).toBe("not-a-key");
	});

	it("titles, cards and notices don't show x_y or x,y", () => {
		const read = (...p: string[]) => readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
		const files = [
			read("hex-map", "HexMapView.ts"),
			read("hex-map", "TokenInfoModal.ts"),
			read("hex-map", "HexEditorModal.ts"),
			read("hex-table", "HexTableView.ts"),
		];
		for (const src of files) {
			expect(src).not.toMatch(/[Hh]ex \$\{[^}]+\},\$\{/); // "Hex 3,4"
			expect(src).not.toMatch(/[Hh]ex \$\{[\w.]*\.hex\}/); // "Hex 3_4"
			expect(src).not.toMatch(/on \$\{x\},\$\{y\}/);
		}
		expect(read("hex-table", "HexTableView.ts")).not.toMatch(/`\$\{x\},\$\{y\}/);
	});
});

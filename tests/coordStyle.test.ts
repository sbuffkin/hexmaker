import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
	coordHaloColor,
	MIN_PNG_COORD_PX,
	parseColor,
	pngCoordFontFamily,
	pngCoordFontPx,
	pngCoordY,
	relativeLuminance,
} from "../src/coordStyle";

const DARK_HALO = "rgba(0, 0, 0, 0.85)";
const LIGHT_HALO = "rgba(255, 255, 255, 0.9)";

describe("coordinate label halo (fresh-eyes round 4: unreadable on ice)", () => {
	it("parses the colour forms the settings and themes use", () => {
		expect(parseColor("#fff")).toEqual([255, 255, 255]);
		expect(parseColor("#1F1C17")).toEqual([31, 28, 23]);
		expect(parseColor("#11223344")).toEqual([17, 34, 51]);
		expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
		expect(parseColor("rgba(10 20 30 / 50%)")).toEqual([10, 20, 30]);
		expect(parseColor("tomato")).toBeNull();
	});

	it("puts a dark halo behind light text and a light halo behind dark text", () => {
		expect(coordHaloColor("#ffffff")).toBe(DARK_HALO); // the default label colour
		expect(coordHaloColor("#bbbbbb")).toBe(DARK_HALO);
		expect(coordHaloColor("#ffeb3b")).toBe(DARK_HALO); // yellow is light
		expect(coordHaloColor("#000000")).toBe(LIGHT_HALO);
		expect(coordHaloColor("#1f1c17")).toBe(LIGHT_HALO);
		expect(coordHaloColor("#3355aa")).toBe(LIGHT_HALO); // mid-dark blue
		expect(coordHaloColor("not a colour")).toBe(DARK_HALO);
	});

	it("uses WCAG luminance", () => {
		expect(relativeLuminance([0, 0, 0])).toBe(0);
		expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1);
	});
});

describe("PNG coordinate labels (round 4: tiny and faint)", () => {
	it("are bigger than the old 11px at the default size, and never below the minimum", () => {
		expect(pngCoordFontPx(50)).toBeGreaterThan(11);
		expect(pngCoordFontPx(50)).toBe(15);
		expect(pngCoordFontPx(10)).toBe(MIN_PNG_COORD_PX);
		expect(pngCoordFontPx(50, 0.1)).toBe(MIN_PNG_COORD_PX);
	});

	it("scale with the coordinate size setting, capped to fit the hex", () => {
		expect(pngCoordFontPx(100, 1.6)).toBe(60);
		expect(pngCoordFontPx(100, 0.4)).toBe(15);
		expect(pngCoordFontPx(100, 0)).toBe(30); // bad setting → default scale
	});

	it("use the coordinate font setting", () => {
		expect(pngCoordFontFamily("monospace")).toBe("monospace");
		expect(pngCoordFontFamily("serif")).toMatch(/serif$/);
		expect(pngCoordFontFamily("interface")).toBe("sans-serif");
		expect(pngCoordFontFamily(undefined)).toBe("sans-serif");
	});

	it("follow the placement setting and stay inside the hex", () => {
		const R = 50;
		expect(pngCoordY("top", 100, R)).toBeLessThan(100);
		expect(pngCoordY("middle", 100, R)).toBe(100);
		expect(pngCoordY(undefined, 100, R)).toBe(pngCoordY("bottom", 100, R));
		for (const p of ["top", "middle", "bottom"] as const) {
			const half = pngCoordFontPx(R) / 2;
			expect(Math.abs(pngCoordY(p, 0, R)) + half).toBeLessThan(R * 0.87);
		}
	});
});

describe("wiring", () => {
	const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

	it("the PNG renderer always draws the halo and reads the coordinate settings", () => {
		const src = read("src", "export", "mapPngRenderer.ts");
		expect(src).toMatch(/opts\.coordHalo \?\? coordHaloColor\(coordColor\)/);
		expect(src).toMatch(/plugin\.settings\.coordFontColor/);
		expect(src).toMatch(/pngCoordFontPx\(R, plugin\.settings\.coordFontSize\)/);
		expect(src).not.toMatch(/if \(opts\.coordHalo\)/);
	});

	it("the map sets the halo variable the label CSS uses", () => {
		expect(read("src", "hex-map", "HexMapView.ts")).toMatch(/"--duckmage-coord-halo": coordHaloColor\(coordFontColor\)/);
		expect(read("styles.css")).toMatch(/\.duckmage-coord-label-html \{\n\s+text-shadow:[^}]*var\(--duckmage-coord-halo/);
	});
});

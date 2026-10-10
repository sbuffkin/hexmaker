import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathClickOutcome } from "../src/hex-map/toolMode";

const viewSrc = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");

/** Source of the HexMapView method `name` (up to its closing brace at two-space indent). */
function method(name: string): string {
	const m = new RegExp(`\\n  private (?:async )?${name}\\(`).exec(viewSrc);
	const start = m ? m.index + 1 : -1;
	expect(start).toBeGreaterThan(-1);
	return viewSrc.slice(start, viewSrc.indexOf("\n  }\n", start));
}

describe("pathClickOutcome (fresh-eyes T7)", () => {
	const around = ["2_1", "3_2", "3_3", "2_3", "1_3", "1_2"]; // neighbours of 2_2

	it("starts a path when none is in progress", () => {
		expect(pathClickOutcome(null, "5_5", [])).toBe("start");
	});

	it("extends the path on a neighbour of its end", () => {
		expect(pathClickOutcome("2_2", "3_2", around)).toBe("extend");
	});

	it("ignores a click on the end itself (no stacked dot)", () => {
		expect(pathClickOutcome("2_2", "2_2", around)).toBe("same");
	});

	it("reports a restart for a distant hex so the caller can explain it", () => {
		expect(pathClickOutcome("2_2", "6_6", around)).toBe("restart");
	});
});

describe("Path tool button (fresh-eyes T7)", () => {
	it("clicking Path while drawing reopens the picker instead of exiting", () => {
		const body = method("handlePathButton");
		expect(body).toMatch(/new PathPickerModal\(/);
		expect(body).not.toMatch(/exitPathMode\(\);\s*this\.drawingMode = null/);
	});

	it("a restart on a non-adjacent hex shows a hint", () => {
		const body = method("onHexPathDrawClick");
		expect(body).toMatch(/outcome === "restart"[\s\S]*new Notice\(/);
	});
});

describe("Path tool right-click and tokens (fresh-eyes T2)", () => {
	it("right-click on a hex of the path being drawn removes it instead of opening the menu", () => {
		const start = viewSrc.indexOf('"contextmenu",');
		const handler = viewSrc.slice(start, viewSrc.indexOf("{ capture: true }", start));
		expect(handler).toMatch(/this\.drawingMode === "path"[\s\S]*pathChainWithHex\([\s\S]*onHexPathDeleteClick\(hexX, hexY, this\.activePathTypeName\)[\s\S]*return;[\s\S]*showPainterContextMenu/);
	});

	it("the delete only touches chains of the given path type", () => {
		expect(method("onHexPathDeleteClick")).toMatch(/typeName !== null && chains\[ci\]\.typeName !== typeName\) continue/);
	});

	it("tokens let clicks through while a drawing tool is active", () => {
		const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\s+/g, " ");
		expect(css).toContain(".duckmage-hex-map-viewport.duckmage-draw-mode .duckmage-token { pointer-events: none; }");
	});
});

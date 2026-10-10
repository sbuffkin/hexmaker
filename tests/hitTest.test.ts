import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { nearestHex, type HexBox } from "../src/hex-map/hitTest";

// Two flat-top hexes, 40×34 boxes, stacked in one column with a 4px gap.
const a: HexBox = { x: 4, y: 6, left: 100, top: 100, right: 140, bottom: 134 };
const b: HexBox = { x: 4, y: 7, left: 100, top: 138, right: 140, bottom: 172 };

describe("clicks between hexes go to the nearest hex (fresh-eyes round 5)", () => {
	it("a click in the gap picks the closer hex", () => {
		expect(nearestHex(120, 135, [a, b])).toEqual({ x: 4, y: 6 });
		expect(nearestHex(120, 137.5, [a, b])).toEqual({ x: 4, y: 7 });
	});

	it("a click on a hex's clipped corner picks that hex", () => {
		expect(nearestHex(102, 168, [a, b])).toEqual({ x: 4, y: 7 });
	});

	it("a click well off the grid stays a miss", () => {
		expect(nearestHex(300, 300, [a, b])).toBeNull();
		expect(nearestHex(120, 135, [])).toBeNull();
	});

	it("the map view routes gap clicks, right-clicks and paint strokes through it", () => {
		const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
		expect(view).toMatch(/this\.registerDomEvent\(clipEl, "click", \(e: MouseEvent\) => \{\n\s+const hex = onGap\(e\);\n\s+if \(hex\) void this\.onHexClick\(hex\.x, hex\.y, e\);/);
		expect(view).toMatch(/this\.registerDomEvent\(clipEl, "contextmenu"[\s\S]{0,200}this\.onHexContextMenu\(e, hex\.x, hex\.y\)/);
		expect(view).toMatch(/Paint the hex under the cursor[\s\S]{0,120}this\.hexElAt\(e\.target, e\.clientX, e\.clientY\)/);
		expect(view).toMatch(/private hexElAt[\s\S]{0,1400}nearestHex\(clientX, clientY, boxes\)/);
	});
});

describe("a token doesn't shrink its hex's click target (fresh-eyes round 5)", () => {
	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
	const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");

	it("a plain left-click on a token opens its hex, like clicking the hex", () => {
		expect(view).toMatch(/this\.startTokenDrag\(snapToken, tokenEl, e, centerMap, \(\) => \{\n\s+const \[hx, hy\] = snapToken\.hex\.split\("_"\)\.map\(Number\);\n\s+if \(Number\.isFinite\(hx\) && Number\.isFinite\(hy\)\) void this\.onHexClick\(hx, hy, e\);/);
	});

	it("the info card moved to the token's right-click menu", () => {
		expect(view).toMatch(/private showTokenContextMenu[\s\S]{0,200}setTitle\("Token info"\)[\s\S]{0,80}this\.openTokenInfo\(token\)/);
	});

	it("with a tool on, clicks go through tokens to the hex", () => {
		expect(css).toMatch(/\.duckmage-hex-map-viewport\.duckmage-draw-mode \.duckmage-token \{\s*pointer-events: none;/);
	});
});

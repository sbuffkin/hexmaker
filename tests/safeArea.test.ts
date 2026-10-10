import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
	fitToSafeArea,
	NO_INSETS,
	OVERLAY_GAP,
	overlayInsets,
	revealDelta,
	uncoverEdgeDelta,
	usableInsets,
} from "../src/hex-map/safeArea";

const clip = { left: 100, top: 50, right: 1100, bottom: 850 }; // 1000 × 800

describe("overlayInsets (fresh-eyes round 4: overlays hid hexes)", () => {
	it("reserves the toolbar band down to its lowest row, plus a gap", () => {
		const rows = [
			{ left: 108, top: 58, right: 140, bottom: 84 }, // row 1
			{ left: 108, top: 92, right: 140, bottom: 118 }, // undo row
		];
		expect(overlayInsets(clip, rows, []).top).toBe(118 - 50 + OVERLAY_GAP);
	});

	it("reserves an open side panel's width on the right", () => {
		const panel = { left: 900, top: 94, right: 1096, bottom: 400 };
		expect(overlayInsets(clip, [], [panel]).right).toBe(1100 - 900 + OVERLAY_GAP);
	});

	it("ignores hidden (empty) boxes, like a hidden mode bar or closed panel", () => {
		const hidden = { left: 0, top: 0, right: 0, bottom: 0 };
		expect(overlayInsets(clip, [hidden], [hidden])).toEqual(NO_INSETS);
	});
});

describe("usableInsets", () => {
	it("drops an inset that would leave less than 40% of the view", () => {
		expect(usableInsets(400, 800, { top: 70, right: 250, bottom: 0, left: 0 })).toEqual({ top: 70, right: 0, bottom: 0, left: 0 });
		expect(usableInsets(1000, 800, { top: 70, right: 250, bottom: 0, left: 0 }).right).toBe(250);
	});
});

describe("fitToSafeArea", () => {
	it("fits the grid inside the uncovered area, centred there", () => {
		const ins = { top: 74, right: 206, bottom: 0, left: 0 };
		const { zoom, panX, panY } = fitToSafeArea(1000, 800, 500, 400, ins);
		const w = 1000 - 206, h = 800 - 74;
		expect(zoom).toBeCloseTo(Math.min(w / 500, h / 400) * 0.92);
		// Grid box after the transform stays inside the safe rect.
		expect(panX).toBeGreaterThanOrEqual(0);
		expect(panX + 500 * zoom).toBeLessThanOrEqual(1000 - 206);
		expect(panY).toBeGreaterThanOrEqual(74);
		expect(panY + 400 * zoom).toBeLessThanOrEqual(800);
		expect(panX + (500 * zoom) / 2).toBeCloseTo(w / 2);
	});

	it("matches the old whole-view fit when nothing covers the map", () => {
		const { zoom, panX, panY } = fitToSafeArea(1000, 800, 500, 400, NO_INSETS);
		expect(zoom).toBeCloseTo(Math.min(1000 / 500, 800 / 400) * 0.92);
		expect(panX).toBeCloseTo((1000 - 500 * zoom) / 2);
		expect(panY).toBeCloseTo((800 - 400 * zoom) / 2);
	});

	it("clamps the zoom", () => {
		expect(fitToSafeArea(1000, 800, 10, 10, NO_INSETS).zoom).toBe(5);
		expect(fitToSafeArea(100, 100, 10000, 10000, NO_INSETS).zoom).toBe(0.2);
	});
});

describe("revealDelta (flash the hex you came back to)", () => {
	it("moves a hex out from under the right-hand panel", () => {
		expect(revealDelta(950, 1000, 0, 794)).toBe(794 - 1000);
	});
	it("moves a hex down from under the toolbar band", () => {
		expect(revealDelta(40, 90, 74, 800)).toBe(34);
	});
	it("leaves a visible hex alone", () => {
		expect(revealDelta(300, 350, 74, 800)).toBe(0);
	});
	it("aligns the start of something too big to fit", () => {
		expect(revealDelta(-50, 2000, 74, 800)).toBe(124);
	});
});

describe("uncoverEdgeDelta (a panel or the mode bar opens over the map)", () => {
	it("pulls the grid's right edge out from under a just-opened panel", () => {
		expect(uncoverEdgeDelta(100, 980, 0, 794, 0, 1000)).toBe(794 - 980);
	});
	it("pushes the grid's top edge below the toolbar band", () => {
		expect(uncoverEdgeDelta(30, 700, 74, 800, 0, 800)).toBe(44);
	});
	it("leaves an edge alone when it's off screen (the user panned there)", () => {
		expect(uncoverEdgeDelta(-500, 1500, 0, 794, 0, 1000)).toBe(0);
		expect(uncoverEdgeDelta(-500, 2000, 74, 800, 0, 800)).toBe(0);
	});
	it("does nothing when the grid isn't on screen at all", () => {
		expect(uncoverEdgeDelta(1200, 1600, 0, 794, 0, 1000)).toBe(0);
	});
	it("does nothing when nothing is covered", () => {
		expect(uncoverEdgeDelta(100, 700, 0, 794, 0, 1000)).toBe(0);
	});
});

describe("the map keeps hexes clear of its overlays", () => {
	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");

	it("fitting, centring, flashing and opening a panel all respect the overlays", () => {
		expect(view).toMatch(/fitToSafeArea\(clipW, clipH, gridW, gridH, this\.measureOverlayInsets\(\)\)/);
		expect(view).toMatch(/private flashHex[\s\S]{0,250}this\.revealHexEl\(hexEl\);/);
		expect(view).toMatch(/toolsPanel\.onAfterOpen = \(\) => this\.uncoverGrid\(\);/);
		expect(view).toMatch(/centerOnHex[\s\S]{0,1400}this\.measureOverlayInsets\(\)/);
	});
});

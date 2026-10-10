import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
	fitToSafeArea,
	mayAutoPan,
	NO_INSETS,
	OVERLAY_GAP,
	overlayInsets,
	revealDelta,
	uncoverEdgeDelta,
	unionBoxes,
	usableInsets,
	zoomForHexWidth,
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

describe("unionBoxes (the map's content box)", () => {
	it("covers the grid, its overhanging edge hexes and the neighbour strip", () => {
		const grid = { left: 539, top: 198, right: 1230, bottom: 886 };
		const lastCol = { left: 1175, top: 200, right: 1245, bottom: 260 };
		const strip = { left: 541, top: 135, right: 1245, bottom: 195 };
		expect(unionBoxes([grid, lastCol, strip])).toEqual({ left: 539, top: 135, right: 1245, bottom: 886 });
	});
	it("ignores empty boxes and returns null for none", () => {
		const empty = { left: 0, top: 0, right: 0, bottom: 0 };
		expect(unionBoxes([empty])).toBeNull();
		expect(unionBoxes([empty, { left: 1, top: 2, right: 3, bottom: 4 }])).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
	});
});

describe("the map keeps hexes clear of its overlays", () => {
	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");

	it("fitting, centring, flashing and opening a panel all respect the overlays", () => {
		expect(view).toMatch(/fitToSafeArea\(clipW, clipH, vw, vh, this\.measureOverlayInsets\(\)\)/);
		// The content box (edge hexes + neighbour strip), not the grid element.
		expect(view).toMatch(/private uncoverGrid[\s\S]{0,400}const g = this\.measureContentBox\(\);/);
		expect(view).toMatch(/private measureContentBox[\s\S]{0,900}duckmage-region-shadow-hex/);
		expect(view).toMatch(/private flashHex[\s\S]{0,250}this\.revealHexEl\(hexEl\);/);
		expect(view).toMatch(/toolsPanel\.onAfterOpen = \(\) => this\.uncoverGrid\(\);/);
		expect(view).toMatch(/centerOnHex[\s\S]{0,1400}this\.measureOverlayInsets\(\)/);
	});
});

describe("the map never moves under a drawing tool (fresh-eyes round 5)", () => {
	const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
	const body = (name: string) => {
		const start = view.indexOf(`private ${name}(`);
		expect(start).toBeGreaterThan(-1);
		return view.slice(start, view.indexOf("\n  }\n", start));
	};

	it("auto-pans only with no tool active", () => {
		expect(mayAutoPan(null)).toBe(true);
		for (const tool of ["path", "terrain", "icon", "tableLink", "submapLink", "factionLink", "regionLink", "swap", "placeToken"])
			expect(mayAutoPan(tool)).toBe(false);
	});

	it("uncovering an edge and revealing a hex are gated on it", () => {
		expect(body("uncoverGrid")).toMatch(/^private uncoverGrid\(\): void \{\n\s+if \(!mayAutoPan\(this\.drawingMode\)\) return;/);
		expect(body("revealHexEl")).toMatch(/^private revealHexEl\(hexEl: HTMLElement\): void \{\n\s+if \(!mayAutoPan\(this\.drawingMode\)\) return;/);
	});

	it("starting or changing a tool (the mode bar) never pans the map", () => {
		// Round 5 regression: the mode bar appearing as Road started ran
		// uncoverGrid, sliding the map 53px out from under the tools panel.
		const modeBar = body("updateModeBar");
		expect(modeBar.length).toBeGreaterThan(100);
		expect(modeBar).not.toMatch(/uncoverGrid|revealHexEl|fitGridToView|centerOnHex|this\.pan[XY]|applyTransform/);
	});
});

describe("crossing into a neighbouring region keeps the zoom (fresh-eyes round 5)", () => {
	it("picks the zoom that shows the arrival hex at the size you were looking at", () => {
		// 30px hexes before; the new map's hex measures 60px at zoom 1 → 0.5.
		expect(zoomForHexWidth(30, 60, 1)).toBeCloseTo(0.5);
		// Same size already: zoom unchanged.
		expect(zoomForHexWidth(48, 48, 1.3)).toBeCloseTo(1.3);
		// Measured at zoom 2 (24px) → 40px needs zoom 2 × 40/24.
		expect(zoomForHexWidth(40, 24, 2)).toBeCloseTo((2 * 40) / 24);
	});

	it("clamps to the wheel range and keeps the zoom when a width is unknown", () => {
		expect(zoomForHexWidth(1000, 10, 1)).toBe(5);
		expect(zoomForHexWidth(1, 100, 1)).toBe(0.2);
		expect(zoomForHexWidth(0, 50, 1.7)).toBe(1.7);
		expect(zoomForHexWidth(30, 0, 1.7)).toBe(1.7);
	});

	it("goToRegionHex measures the hex size before leaving and centres with it", () => {
		const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
		expect(view).toMatch(/private goToRegionHex[\s\S]{0,500}const hexWidth = [^\n]*getBoundingClientRect\(\)\.width;\n\s+this\.navigateToMap\(mapName\);[\s\S]{0,200}this\.centerOnHex\(x, y, hexWidth\);/);
	});
});

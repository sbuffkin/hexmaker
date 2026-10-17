import { describe, it } from "node:test";
import expect from "expect";
import { keepViewStill, measureGridStride, shiftView, strideFromHex, type GridResizeHost } from "../src/hex-map/view/gridResize";
import { readSource } from "./helpers/source";
import type { MapData } from "../src/types";

/** plan-hf4-map-grows step 1: keeping the view still when rows / columns come or go at the top or left. */

function host(stride: { row: number; col: number }, zoom = 2) {
	const view = { panX: 100, panY: 50, zoom, applied: 0, applyTransform() { this.applied++; } };
	const layers: unknown[] = [];
	let saves = 0;
	const h: GridResizeHost = {
		plugin: { settings: { hexOrientation: "flat" }, saveSettings: async () => { saves++; } } as never,
		viewportEl: () => ({ querySelector: () => ({ layer: true }) }) as never,
		viewport: () => view,
		calibration: { applyBgLayerVars: (layer) => { layers.push(layer); } },
		stride: (axis) => stride[axis],
	};
	return { h, view, layers, saves: () => saves };
}

const mapWith = (extra: Partial<MapData> = {}) => ({ gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, ...extra }) as MapData;

describe("keeping the view still (gridResize)", () => {
	it("one row at the top: the same pan and background numbers the edge buttons always gave", () => {
		// The old shiftForGridGrowth: panY -= stride × scaleY × zoom; bg.offsetY += stride × scaleY.
		const s = host({ row: 30, col: 40 });
		const map = mapWith({ gridDisplayScaleY: 1.5, backgroundImage: { offsetX: 0, offsetY: 10 } as never });
		shiftView(s.h, map, 1, 0);
		expect(s.view.panY).toBe(50 - 30 * 1.5 * 2);
		expect(s.view.panX).toBe(100);
		expect(map.backgroundImage!.offsetY).toBe(10 + 30 * 1.5);
		expect(s.view.applied).toBe(1);
		expect(s.layers.length).toBe(1);
		expect(s.saves()).toBe(1);
	});

	it("removing a column at the left is the inverse", () => {
		const s = host({ row: 30, col: 40 }, 1);
		const map = mapWith({ gridDisplayScale: 2 });
		shiftView(s.h, map, 0, 1);
		shiftView(s.h, map, 0, -1);
		expect(s.view.panX).toBe(100);
		// No background image: nothing saved.
		expect(s.saves()).toBe(0);
	});

	it("N rows and columns at once, from the grid before and after", () => {
		const s = host({ row: 30, col: 40 }, 1);
		keepViewStill(s.h, mapWith(), { x: 0, y: 0, cols: 5, rows: 5 }, { x: -2, y: -3, cols: 9, rows: 8 });
		expect(s.view.panY).toBe(50 - 3 * 30);
		expect(s.view.panX).toBe(100 - 2 * 40);
		expect(s.view.applied).toBe(1);
	});

	it("growing at the bottom or right moves nothing", () => {
		const s = host({ row: 30, col: 40 });
		keepViewStill(s.h, mapWith(), { x: 0, y: 0, cols: 5, rows: 5 }, { x: 0, y: 0, cols: 8, rows: 9 });
		expect([s.view.panX, s.view.panY, s.view.applied]).toEqual([100, 50, 0]);
	});

	it("the stride from one hex matches the CSS layout (a 1×1 map has nothing to measure between)", () => {
		// Flat-top: columns overlap by a quarter width; rows stack.
		expect(strideFromHex("row", "flat", 40, 34.64, 2)).toBeCloseTo(38.64);
		expect(strideFromHex("col", "flat", 40, 34.64, 2)).toBe(34);
		// Pointy-top: rows overlap by a quarter height; columns sit side by side.
		expect(strideFromHex("row", "pointy", 34.64, 40, 2)).toBe(34);
		expect(strideFromHex("col", "pointy", 34.64, 40, 2)).toBeCloseTo(38.64);
	});

	it("measured from two hexes when there are two, from one hex when there is one", () => {
		const hex = (top: number, left: number) => ({ offsetTop: top, offsetLeft: left, offsetWidth: 40, offsetHeight: 34 });
		const two = [hex(0, 0), hex(37, 0)];
		const col = { querySelectorAll: () => two };
		const root = (cols: unknown[], first: unknown) => ({
			querySelector: (sel: string) => (sel === ".duckmage-hex-col" ? col : first),
			querySelectorAll: () => cols,
		});
		const flat = { plugin: { settings: { hexOrientation: "flat" } } as never };
		expect(measureGridStride({ ...flat, viewportEl: () => root([col], two[0]) as never }, "row")).toBe(37);
		const g = globalThis as unknown as { activeWindow?: unknown };
		const had = g.activeWindow;
		g.activeWindow = { getComputedStyle: () => ({ marginTop: "3px" }) };
		try {
			const one = { querySelectorAll: () => [hex(0, 0)] };
			const single = { querySelector: (sel: string) => (sel === ".duckmage-hex-col" ? one : hex(0, 0)), querySelectorAll: () => [one] };
			expect(measureGridStride({ ...flat, viewportEl: () => single as never }, "row")).toBe(34 + 6);
			expect(measureGridStride({ ...flat, viewportEl: () => single as never }, "col")).toBe(30 + 6);
			expect(measureGridStride({ ...flat, viewportEl: () => ({ querySelector: () => null, querySelectorAll: () => [] }) as never }, "row")).toBe(0);
		} finally {
			g.activeWindow = had;
		}
	});

	it("the edge buttons use it (one place for the compensation)", () => {
		const edges = readSource("src/hex-map/view/gridEdgeButtons.ts");
		expect(edges).toMatch(/shiftView\(/);
		expect(edges).not.toMatch(/measureGridStride\(axis/);
	});
});

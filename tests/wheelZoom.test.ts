import { describe, it } from "node:test";
import expect from "expect";
import { MAX_ZOOM_PX_PER_EVENT, wheelZoomLog, wheelZoomsMap, ZOOM_PER_PX } from "../src/hex-map/wheelZoom";

describe("wheelZoomLog (fresh-eyes round 3: zoom steps too coarse)", () => {
	it("zooms in on wheel up and out on wheel down", () => {
		expect(wheelZoomLog(-100, 0)).toBeGreaterThan(0);
		expect(wheelZoomLog(100, 0)).toBeLessThan(0);
		expect(wheelZoomLog(0, 0)).toBe(0);
	});

	it("zooms a mouse notch by well under 1.25×", () => {
		const factor = Math.exp(wheelZoomLog(-100, 0));
		expect(factor).toBeGreaterThan(1.1);
		expect(factor).toBeLessThan(1.25);
	});

	it("keeps trackpad steps tiny so they look smooth", () => {
		expect(Math.exp(wheelZoomLog(-4, 0))).toBeLessThan(1.01);
	});

	it("caps one event, so a multi-notch flick can't jump several sizes", () => {
		expect(wheelZoomLog(-600, 0)).toBeCloseTo(MAX_ZOOM_PX_PER_EVENT * ZOOM_PER_PX);
		expect(wheelZoomLog(600, 0)).toBeCloseTo(-MAX_ZOOM_PX_PER_EVENT * ZOOM_PER_PX);
	});

	it("converts line and page deltas before capping", () => {
		expect(wheelZoomLog(-1, 1)).toBeCloseTo(33 * ZOOM_PER_PX);
		expect(wheelZoomLog(-1, 2)).toBeCloseTo(MAX_ZOOM_PX_PER_EVENT * ZOOM_PER_PX);
	});
});

describe("wheelZoomsMap", () => {
	it("zooms only over the map with no modal open", () => {
		expect(wheelZoomsMap(true, false)).toBe(true);
		expect(wheelZoomsMap(true, true)).toBe(false);
		expect(wheelZoomsMap(false, false)).toBe(false);
	});
});

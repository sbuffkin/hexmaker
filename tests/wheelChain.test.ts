import { describe, it } from "node:test";
import expect from "expect";
import { wheelDeltaPx, wheelGoesToOuter, WHEEL_CONTINUE_MS } from "../src/wheelChain";

/** A 132px-tall icon grid holding 400px of tiles, scrolled to `top`. */
const grid = (top: number) => ({ scrollTop: top, scrollHeight: 400, clientHeight: 132 });
const LONG_AGO = Infinity;

describe("wheelGoesToOuter (fresh-eyes E3: nested grids trap the wheel)", () => {
	it("scrolls the grid itself while it has room in the wheel's direction", () => {
		expect(wheelGoesToOuter(grid(0), 100, LONG_AGO)).toBe(false);
		expect(wheelGoesToOuter(grid(100), -100, LONG_AGO)).toBe(false);
	});

	it("passes the wheel to the modal at the grid's bottom (scrolling down)", () => {
		expect(wheelGoesToOuter(grid(268), 100, LONG_AGO)).toBe(true);
		expect(wheelGoesToOuter(grid(267.5), 100, LONG_AGO)).toBe(true); // sub-pixel
	});

	it("passes the wheel to the modal at the grid's top (scrolling up)", () => {
		expect(wheelGoesToOuter(grid(0), -100, LONG_AGO)).toBe(true);
	});

	it("passes it on when the grid can't scroll at all", () => {
		expect(wheelGoesToOuter({ scrollTop: 0, scrollHeight: 120, clientHeight: 132 }, 100, LONG_AGO)).toBe(true);
	});

	it("keeps an ongoing modal scroll going when a grid slides under the pointer", () => {
		expect(wheelGoesToOuter(grid(50), 100, 50)).toBe(true);
		expect(wheelGoesToOuter(grid(50), 100, WHEEL_CONTINUE_MS + 1)).toBe(false);
	});

	it("ignores zero-delta (horizontal-only) wheel events", () => {
		expect(wheelGoesToOuter(grid(268), 0, 0)).toBe(false);
	});
});

describe("wheelDeltaPx", () => {
	it("converts line and page deltas to pixels", () => {
		expect(wheelDeltaPx(100, 0, 500)).toBe(100);
		expect(wheelDeltaPx(3, 1, 500)).toBe(48);
		expect(wheelDeltaPx(1, 2, 500)).toBe(500);
	});
});

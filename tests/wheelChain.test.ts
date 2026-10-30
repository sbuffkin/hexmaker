import { describe, it } from "node:test";
import expect from "expect";
import { canScroll, wheelDeltaPx, wheelTarget, WHEEL_CONTINUE_MS, type WheelChainState } from "../src/wheelChain";

/** A 132px-tall icon grid holding 400px of tiles, scrolled to `top`. */
const grid = (top: number) => ({ scrollTop: top, scrollHeight: 400, clientHeight: 132 });
/** The editor's scroll pane: 700px tall, 1600px of content. */
const modal = (top: number) => ({ scrollTop: top, scrollHeight: 1600, clientHeight: 700 });
const LONG_AGO = Infinity;

const state = (over: Partial<WheelChainState>): WheelChainState => ({
	inner: grid(0),
	outer: modal(0),
	deltaY: 100,
	msSinceOuterScroll: LONG_AGO,
	msSinceInnerScroll: LONG_AGO,
	innerEngaged: false,
	...over,
});

describe("canScroll", () => {
	it("knows when a box has room in the wheel's direction", () => {
		expect(canScroll(grid(0), 100)).toBe(true);
		expect(canScroll(grid(0), -100)).toBe(false);
		expect(canScroll(grid(268), 100)).toBe(false);
		expect(canScroll(grid(267.5), 100)).toBe(false); // sub-pixel end
		expect(canScroll({ scrollTop: 0, scrollHeight: 120, clientHeight: 132 }, 100)).toBe(false);
	});
});

describe("wheelTarget (fresh-eyes round 3: icon grids still ate the wheel)", () => {
	it("scrolls the modal, not the grid, when the pointer just sits over a grid", () => {
		// The round-3 trap: grid at its top, modal at its top, first wheel.
		expect(wheelTarget(state({}))).toBe("outer");
		expect(wheelTarget(state({ inner: grid(100), outer: modal(300), deltaY: -100 }))).toBe("outer");
	});

	it("hands the wheel to the grid once the modal is at its end", () => {
		expect(wheelTarget(state({ outer: modal(900) }))).toBe("inner");
		expect(wheelTarget(state({ inner: grid(100), outer: modal(0), deltaY: -100 }))).toBe("inner");
	});

	it("passes it to the modal when the grid can't move that way", () => {
		expect(wheelTarget(state({ inner: grid(268), innerEngaged: true }))).toBe("outer");
		expect(wheelTarget(state({ inner: { scrollTop: 0, scrollHeight: 120, clientHeight: 132 } }))).toBe("outer");
	});

	it("lets a grid the user clicked into own the wheel", () => {
		expect(wheelTarget(state({ innerEngaged: true }))).toBe("inner");
	});

	it("keeps a gesture on the pane it started on", () => {
		// Scrolling the grid (modal at its end, then the modal moved a hair):
		expect(wheelTarget(state({ inner: grid(50), msSinceInnerScroll: 20 }))).toBe("inner");
		// Scrolling the modal while an engaged grid slides under the pointer:
		expect(wheelTarget(state({ innerEngaged: true, msSinceOuterScroll: 20 }))).toBe("outer");
		// The most recent pane wins when both moved lately.
		expect(wheelTarget(state({ msSinceInnerScroll: 10, msSinceOuterScroll: 200 }))).toBe("inner");
		expect(wheelTarget(state({ msSinceInnerScroll: 200, msSinceOuterScroll: 10 }))).toBe("outer");
		// A gesture older than the window no longer counts.
		expect(wheelTarget(state({ msSinceInnerScroll: WHEEL_CONTINUE_MS + 1 }))).toBe("outer");
	});

	it("does nothing for horizontal-only wheels or when neither pane can move", () => {
		expect(wheelTarget(state({ deltaY: 0 }))).toBe("none");
		expect(wheelTarget(state({ inner: grid(268), outer: modal(900) }))).toBe("none");
	});
});

describe("wheelDeltaPx", () => {
	it("converts line and page deltas to pixels", () => {
		expect(wheelDeltaPx(100, 0, 500)).toBe(100);
		expect(wheelDeltaPx(3, 1, 500)).toBe(48);
		expect(wheelDeltaPx(1, 2, 500)).toBe(500);
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import { whenSized, type SizedElement } from "../src/hex-map/whenSized";

/**
 * A map rendered while its tab isn't laid out (plugin reload with the map in
 * a background tab) measured every hex at 0,0: coordinate labels vanished and
 * hex names sat in the corner until the next redraw. renderGrid now draws the
 * measured layers through whenSized.
 */

class FakeObserver {
	static last: FakeObserver | null = null;
	observed: unknown[] = [];
	disconnected = false;
	constructor(public cb: () => void) { FakeObserver.last = this; }
	observe(el: unknown) { this.observed.push(el); }
	disconnect() { this.disconnected = true; }
	fire() { this.cb(); }
}

function el(w: number, h: number): SizedElement & { offsetWidth: number; offsetHeight: number } {
	return {
		offsetWidth: w,
		offsetHeight: h,
		ownerDocument: { defaultView: { ResizeObserver: FakeObserver as unknown as typeof ResizeObserver } },
	};
}

describe("whenSized", () => {
	it("draws right away when the element is laid out", () => {
		FakeObserver.last = null;
		let n = 0;
		whenSized(el(400, 300), () => n++);
		expect(n).toBe(1);
		expect(FakeObserver.last).toBeNull();
	});

	it("waits for a size when the element isn't laid out, then draws once", () => {
		const e = el(0, 0);
		let n = 0;
		whenSized(e, () => n++);
		expect(n).toBe(0);
		const obs = FakeObserver.last!;
		expect(obs.observed).toEqual([e]);
		obs.fire(); // still 0×0: keep waiting
		expect(n).toBe(0);
		e.offsetWidth = 400;
		e.offsetHeight = 300;
		obs.fire();
		obs.fire();
		expect(n).toBe(1);
		expect(obs.disconnected).toBe(true);
	});

	it("a cancelled wait never draws (the grid was re-rendered meanwhile)", () => {
		const e = el(0, 0);
		let n = 0;
		const cancel = whenSized(e, () => n++);
		const obs = FakeObserver.last!;
		cancel();
		e.offsetWidth = 10;
		e.offsetHeight = 10;
		obs.fire();
		expect(n).toBe(0);
		expect(obs.disconnected).toBe(true);
	});

	it("draws anyway when there is no ResizeObserver", () => {
		let n = 0;
		whenSized({ offsetWidth: 0, offsetHeight: 0, ownerDocument: { defaultView: null } }, () => n++);
		expect(n).toBe(1);
	});
});

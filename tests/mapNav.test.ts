import { describe, it } from "node:test";
import expect from "expect";
import { flowerPetals, MapHistory, navArrows, PAD_SIDES } from "../src/maps/mapNav";

describe("map nav arrows", () => {
	it("are always ← ↑ → in that order, glyphs only, when any applies", () => {
		expect(navArrows({})).toEqual([]);
		const only = navArrows({ up: "parent" });
		expect(only.map((a) => a.glyph)).toEqual(["←", "↑", "→"]);
		expect(only.map((a) => a.target)).toEqual([undefined, "parent", undefined]);
		const all = navArrows({ forward: "f", back: "b", up: "u" });
		expect(all.map((a) => a.id)).toEqual(["back", "up", "forward"]);
		expect(all.map((a) => a.target)).toEqual(["b", "u", "f"]);
	});

	it("the d-pad's four sides keep one order", () => {
		expect(PAD_SIDES.map((s) => s.side)).toEqual(["west", "north", "south", "east"]);
	});
});

describe("MapHistory (back and forward)", () => {
	const all = () => true;
	it("goes back, then forward again, and a new move clears forward", () => {
		const h = new MapHistory();
		h.visit("a"); // a → b
		h.visit("b"); // b → c
		expect(h.peekBack("c", all)).toBe("b");
		expect(h.peekForward("c", all)).toBeUndefined();
		expect(h.goBack("c", all)).toBe("b");
		expect(h.peekForward("b", all)).toBe("c");
		expect(h.goBack("b", all)).toBe("a");
		expect(h.goForward("a", all)).toBe("b");
		expect(h.goForward("b", all)).toBe("c");
		expect(h.goForward("c", all)).toBeUndefined();
		h.goBack("c", all);
		h.visit("b"); // b → d
		expect(h.peekForward("d", all)).toBeUndefined();
	});

	it("skips maps deleted since and the open map", () => {
		const h = new MapHistory();
		h.visit("a");
		h.visit("gone");
		h.visit("c");
		const exists = (m: string) => m !== "gone";
		expect(h.peekBack("c", exists)).toBe("a");
		expect(h.goBack("c", exists)).toBe("a");
	});
});

describe("region hex flower", () => {
	const order = (o: "flat" | "pointy", px: number, py: number) => flowerPetals(o, "odd", px, py).map((p) => p.bearing);

	it("has six petals in fixed directions, clockwise from north, whatever the stagger", () => {
		expect(order("flat", 2, 2)).toEqual(["north", "north-east", "south-east", "south", "south-west", "north-west"]);
		expect(order("flat", 3, 2)).toEqual(order("flat", 2, 2));
		expect(order("pointy", 2, 2)).toEqual(order("pointy", 2, 3));
		expect(order("pointy", 2, 2)).toHaveLength(6);
		expect(new Set(order("pointy", 2, 2)).size).toBe(6);
	});

	it("places each petal one unit from the middle in its direction", () => {
		for (const p of flowerPetals("flat", "odd", 1, 1)) {
			expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 6);
		}
		const north = flowerPetals("flat", "odd", 1, 1)[0];
		expect(north.hex).toEqual([1, 0]);
		expect(north.dx).toBeCloseTo(0, 6);
		expect(north.dy).toBeCloseTo(-1, 6);
	});
});

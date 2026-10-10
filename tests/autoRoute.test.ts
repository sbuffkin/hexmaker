import { describe, it } from "node:test";
import expect from "expect";
import { findRoute, hexCenter, hexDistance, type RouteBounds } from "../src/hex-map/autoRoute";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

type Orientation = "flat" | "pointy";
type Stagger = "odd" | "even";
const CONFIGS: [Orientation, Stagger][] = [["flat", "odd"], ["flat", "even"], ["pointy", "odd"], ["pointy", "even"]];

const bounds = (cols: number, rows: number, x = 0, y = 0): RouteBounds => ({ minX: x, minY: y, maxX: x + cols - 1, maxY: y + rows - 1 });

/** Plain BFS steps on the bounded grid (reference for distance and routes). */
function bfsSteps(from: [number, number], to: [number, number], o: Orientation, s: Stagger, b: RouteBounds, blocked = new Set<string>()): number {
  const start = `${from[0]}_${from[1]}`;
  const goal = `${to[0]}_${to[1]}`;
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) return dist.get(cur)!;
    const [x, y] = cur.split("_").map(Number);
    for (const [nx, ny] of hexNeighbors(x, y, o, s)) {
      const k = `${nx}_${ny}`;
      if (nx < b.minX || nx > b.maxX || ny < b.minY || ny > b.maxY) continue;
      if (dist.has(k) || (k !== goal && blocked.has(k))) continue;
      dist.set(k, dist.get(cur)! + 1);
      queue.push(k);
    }
  }
  return -1;
}

/** Every step of a route goes to a neighbour. */
function isConnected(hexes: string[], o: Orientation, s: Stagger): boolean {
  for (let i = 1; i < hexes.length; i++) {
    const [x, y] = hexes[i - 1].split("_").map(Number);
    if (!hexNeighbors(x, y, o, s).some(([nx, ny]) => `${nx}_${ny}` === hexes[i])) return false;
  }
  return true;
}

describe("hexDistance", () => {
  for (const [o, s] of CONFIGS) {
    it(`matches BFS steps on an open grid (${o}, ${s} stagger, negative coords too)`, () => {
      const b = bounds(14, 14, -4, -5);
      for (let i = 0; i < 300; i++) {
        const a: [number, number] = [b.minX + (i * 7) % 14, b.minY + (i * 3) % 14];
        const c: [number, number] = [b.minX + (i * 5 + 3) % 14, b.minY + (i * 11 + 1) % 14];
        // A 14x14 box is big enough that the shortest route never needs to leave it
        // for these pairs except near corners; compare against an unbounded-ish BFS.
        const wide = bounds(60, 60, -30, -30);
        expect(hexDistance(a, c, o, s)).toBe(bfsSteps(a, c, o, s, wide));
      }
    });
  }
});

describe("findRoute", () => {
  for (const [o, s] of CONFIGS) {
    it(`finds a shortest connected route (${o}, ${s})`, () => {
      const b = bounds(10, 8);
      const r = findRoute("0_0", "9_7", { orientation: o, stagger: s, bounds: b });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.hexes[0]).toBe("0_0");
      expect(r.hexes[r.hexes.length - 1]).toBe("9_7");
      expect(isConnected(r.hexes, o, s)).toBe(true);
      expect(r.hexes.length - 1).toBe(bfsSteps([0, 0], [9, 7], o, s, b));
    });

    it(`goes around blocked hexes (${o}, ${s})`, () => {
      const b = bounds(9, 9);
      // A wall down column/row 4 with one gap at the far end.
      const wall = new Set<string>();
      for (let i = 0; i < 8; i++) wall.add(o === "flat" ? `4_${i}` : `${i}_4`);
      const from = o === "flat" ? "0_0" : "0_0";
      const to = o === "flat" ? "8_0" : "0_8";
      const r = findRoute(from, to, { orientation: o, stagger: s, bounds: b, blocked: (x, y) => wall.has(`${x}_${y}`) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.hexes.some((h) => wall.has(h))).toBe(false);
      expect(isConnected(r.hexes, o, s)).toBe(true);
      const [tx, ty] = to.split("_").map(Number);
      expect(r.hexes.length - 1).toBe(bfsSteps([0, 0], [tx, ty], o, s, b, wall));
    });
  }

  it("stays inside the map bounds", () => {
    const b = bounds(5, 5, 2, 3);
    const r = findRoute("2_3", "6_7", { orientation: "flat", bounds: b });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const h of r.hexes) {
      const [x, y] = h.split("_").map(Number);
      expect(x >= 2 && x <= 6 && y >= 3 && y <= 7).toBe(true);
    }
  });

  it("says when no route exists", () => {
    const b = bounds(6, 6);
    const wall = (x: number) => x === 3;
    expect(findRoute("0_0", "5_5", { orientation: "flat", bounds: b, blocked: (x) => wall(x) })).toEqual({ ok: false, reason: "no-route" });
  });

  it("never blocks the start or end hex (a road may end at a port on the sea)", () => {
    const b = bounds(6, 1);
    const water = (x: number) => x === 0 || x === 5;
    const r = findRoute("0_0", "5_0", { orientation: "pointy", bounds: b, blocked: (x) => water(x) });
    expect(r).toEqual({ ok: true, hexes: ["0_0", "1_0", "2_0", "3_0", "4_0", "5_0"] });
  });

  it("rejects ends outside the map", () => {
    expect(findRoute("0_0", "9_9", { orientation: "flat", bounds: bounds(4, 4) })).toEqual({ ok: false, reason: "out-of-bounds" });
  });

  it("a route to the same hex is just that hex", () => {
    expect(findRoute("2_2", "2_2", { orientation: "flat", bounds: bounds(4, 4) })).toEqual({ ok: true, hexes: ["2_2"] });
  });

  it("handles a big map quickly", () => {
    const b = bounds(70, 55);
    const t0 = Date.now();
    const r = findRoute("0_0", "69_54", { orientation: "flat", bounds: b, blocked: (x, y) => x === 35 && y < 54 });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("findRoute keeps to the straight line on open ground (round 6 R5)", () => {
	/** Distance of a hex centre from the line between two hex centres. */
	const offLine = (k: string, a: string, b: string, o: Orientation, s: Stagger) => {
		const c = (key: string) => {
			const [x, y] = key.split("_").map(Number);
			return hexCenter(x, y, o, s);
		};
		const [ax, ay] = c(a);
		const [bx, by] = c(b);
		const [px, py] = c(k);
		return Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / Math.hypot(bx - ax, by - ay);
	};
	const ONE_HEX = Math.sqrt(3); // centre-to-centre distance

	for (const [o, s] of CONFIGS) {
		it(`stays within one hex of the line, still shortest (${o}/${s})`, () => {
			const b = bounds(30, 30);
			const pairs: [string, string][] = [["2_3", "25_17"], ["1_20", "22_2"], ["4_4", "26_9"], ["3_25", "9_1"], ["0_0", "29_29"]];
			for (const [from, to] of pairs) {
				const r = findRoute(from, to, { orientation: o, stagger: s, bounds: b });
				expect(r.ok).toBe(true);
				if (!r.ok) continue;
				const f = from.split("_").map(Number) as [number, number];
				const t = to.split("_").map(Number) as [number, number];
				expect(r.hexes.length - 1).toBe(hexDistance(f, t, o, s));
				expect(isConnected(r.hexes, o, s)).toBe(true);
				const worst = Math.max(...r.hexes.map((k) => offLine(k, from, to, o, s)));
				expect(worst).toBeLessThanOrEqual(ONE_HEX);
			}
		});
	}
});

// ── Round 7: rivers meander (U17); a new route never joins or reshapes (R11) ──
import { addRoutedLeg, routeExtendTarget, type RouteChain } from "../src/hex-map/autoRoute";
import { pathMeanders } from "../src/impassable";

describe("auto-routed rivers wind (round 7 U17)", () => {
	const sideOf = (k: string, a: string, b: string, o: Orientation, s: Stagger) => {
		const c = (key: string) => {
			const [x, y] = key.split("_").map(Number);
			return hexCenter(x, y, o, s);
		};
		const [ax, ay] = c(a);
		const [bx, by] = c(b);
		const [px, py] = c(k);
		return ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / Math.hypot(bx - ax, by - ay) / Math.sqrt(3);
	};

	for (const [o, s] of CONFIGS) {
		it(`is a valid hex-by-hex route that bends away from the straight line (${o}/${s})`, () => {
			const b = bounds(24, 16);
			for (const [from, to] of [["11_13", "1_13"], ["2_8", "21_8"], ["3_2", "18_13"]] as [string, string][]) {
				const r = findRoute(from, to, { orientation: o, stagger: s, bounds: b, meander: true });
				expect(r.ok).toBe(true);
				if (!r.ok) continue;
				expect(r.hexes[0]).toBe(from);
				expect(r.hexes[r.hexes.length - 1]).toBe(to);
				expect(isConnected(r.hexes, o, s)).toBe(true);
				expect(new Set(r.hexes).size).toBe(r.hexes.length); // never crosses itself
				// Bends: some hex is a hex or more off the line (the tester's was dead straight).
				const off = Math.max(...r.hexes.map((k) => Math.abs(sideOf(k, from, to, o, s))));
				expect(off).toBeGreaterThanOrEqual(0.9);
				// Gently: not much longer than the shortest route.
				const f = from.split("_").map(Number) as [number, number];
				const t = to.split("_").map(Number) as [number, number];
				expect(r.hexes.length - 1).toBeLessThanOrEqual(Math.ceil(hexDistance(f, t, o, s) * 1.6) + 1);
			}
		});
	}

	it("gives the same river for the same two clicks, and honours a seed", () => {
		const opts = { orientation: "flat" as const, bounds: bounds(24, 16), meander: true };
		expect(findRoute("2_8", "21_8", opts)).toEqual(findRoute("2_8", "21_8", opts));
		const a = findRoute("2_8", "21_8", { ...opts, meander: { seed: 1 } });
		const b = findRoute("2_8", "21_8", { ...opts, meander: { seed: 1 } });
		expect(a).toEqual(b);
	});

	it("still goes around blocked hexes and stays on the map", () => {
		const wall = new Set(["10_5", "10_6", "10_7", "10_8", "10_9", "10_10"]);
		const b = bounds(20, 16);
		const r = findRoute("2_8", "18_8", { orientation: "flat", bounds: b, meander: true, blocked: (x, y) => wall.has(`${x}_${y}`) });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hexes.some((k) => wall.has(k))).toBe(false);
		expect(r.hexes.every((k) => { const [x, y] = k.split("_").map(Number); return x >= 0 && x < 20 && y >= 0 && y < 16; })).toBe(true);
	});

	it("roads keep the straight line; only river-like path types meander", () => {
		expect(pathMeanders({ name: "Road" })).toBe(false);
		expect(pathMeanders({ name: "Trail" })).toBe(false);
		expect(pathMeanders({ name: "River" })).toBe(true);
		expect(pathMeanders({ name: "Mountain stream" })).toBe(true);
		expect(pathMeanders({ name: "Creek" })).toBe(true);
		// A type that crosses impassable terrain is river-like too…
		expect(pathMeanders({ name: "Canal" })).toBe(true);
		expect(pathMeanders({ name: "Old way", avoidImpassable: false })).toBe(true);
		expect(pathMeanders({ name: "Road", avoidImpassable: true })).toBe(false);
		// Without meander, the river from the tester's map is the straight shortest route.
		const straight = findRoute("11_13", "6_14", { orientation: "flat", bounds: bounds(20, 16) });
		expect(straight.ok && straight.hexes.length - 1).toBe(hexDistance([11, 13], [6, 14], "flat"));
	});
});

describe("a second auto-route starts a new path (round 7 R11)", () => {
	// The region tester's map: road keep (12_8) → Gullmouth (7_5), then a
	// second road from the keep to the east edge.
	const make = (typeName: string, hexes: string[]): RouteChain => ({ typeName, hexes });
	const first = () => [make("Road", ["12_8", "11_7", "10_7", "9_6", "8_6", "7_5"]), make("River", ["11_13", "10_14", "9_13"])];

	it("starting on the first road's first hex makes a new road and leaves the first untouched", () => {
		const chains = first();
		const before = JSON.parse(JSON.stringify(chains));
		const leg = addRoutedLeg(chains, "Road", ["12_8", "13_8", "14_8", "15_8"], null, make);
		expect(chains).toHaveLength(3);
		expect(chains.slice(0, 2)).toEqual(before);
		expect(leg).toBe(chains[2]);
		expect(leg.hexes).toEqual(["12_8", "13_8", "14_8", "15_8"]);
	});

	it("starting in the middle of a road makes a new road", () => {
		const chains = first();
		expect(routeExtendTarget(chains, "Road", "10_7", null)).toBeNull();
		addRoutedLeg(chains, "Road", ["10_7", "10_8"], chains[0], make);
		expect(chains[0].hexes).toEqual(["12_8", "11_7", "10_7", "9_6", "8_6", "7_5"]);
		expect(chains).toHaveLength(3);
	});

	it("starting exactly on a road's end continues it, adding only new hexes", () => {
		const chains = first();
		const leg = addRoutedLeg(chains, "Road", ["7_5", "7_4", "7_3"], null, make);
		expect(leg).toBe(chains[0]);
		expect(chains).toHaveLength(2);
		expect(chains[0].hexes).toEqual(["12_8", "11_7", "10_7", "9_6", "8_6", "7_5", "7_4", "7_3"]);
	});

	it("a river's end doesn't continue a road", () => {
		const chains = first();
		expect(routeExtendTarget(chains, "Road", "9_13", null)).toBeNull();
		expect(routeExtendTarget(chains, "River", "9_13", null)).toBe(chains[1]);
	});
});

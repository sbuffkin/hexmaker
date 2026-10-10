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

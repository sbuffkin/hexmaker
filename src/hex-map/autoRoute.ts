/**
 * Auto-route for the path tool: the shortest hex-by-hex route between two
 * hexes (A*), inside the map's bounds, around impassable hexes. Pure — no
 * Obsidian imports — so it's unit-tested directly (tests/autoRoute.test.ts).
 *
 * Hex keys are "x_y" offset coordinates, the same as path chains use.
 */

import { hexNeighbors } from "./hexGeometry";

export interface RouteBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RouteOptions {
  orientation: "flat" | "pointy";
  stagger?: "odd" | "even";
  bounds: RouteBounds;
  /** True for hexes the route may not pass through. The start and end hexes
   *  are never blocked (a road may end at a port on the sea). */
  blocked?: (x: number, y: number) => boolean;
  /**
   * Rivers: wind gently instead of taking the straightest shortest route
   * (round 7 U17: an auto-routed river came out ruler-straight). The route
   * follows a seeded wave between the ends, so it may take a few more
   * steps. The seed defaults to one taken from the ends, so the same two
   * clicks give the same river.
   */
  meander?: boolean | { seed: number };
}

export type RouteResult =
  | { ok: true; hexes: string[] }
  | { ok: false; reason: "out-of-bounds" | "no-route" };

/** Axial (q, r) for an offset hex, so hex distance is easy to compute. */
function toAxial(
  x: number,
  y: number,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even",
): [number, number] {
  // hexNeighbors: the "shifted" column (flat) / row (pointy) is odd for
  // "odd" stagger, even for "even". Shifted lines sit half a hex down (flat)
  // or right (pointy).
  const parity = (n: number) => ((n % 2) + 2) % 2;
  if (orientation === "flat") {
    const r = stagger === "odd" ? y - (x - parity(x)) / 2 : y - (x + parity(x)) / 2;
    return [x, r];
  }
  const q = stagger === "odd" ? x - (y - parity(y)) / 2 : x - (y + parity(y)) / 2;
  return [q, y];
}

/** Steps between two hexes on an unbounded grid. */
export function hexDistance(
  a: [number, number],
  b: [number, number],
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): number {
  const [aq, ar] = toAxial(a[0], a[1], orientation, stagger);
  const [bq, br] = toAxial(b[0], b[1], orientation, stagger);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * A hex's centre on the page, in units of the hex's outer radius (so
 * neighbouring centres are √3 apart). Used to keep routes near the straight
 * line between their ends.
 */
export function hexCenter(
  x: number,
  y: number,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): [number, number] {
  const [q, r] = toAxial(x, y, orientation, stagger);
  return orientation === "flat"
    ? [1.5 * q, Math.sqrt(3) * (r + q / 2)]
    : [Math.sqrt(3) * (q + r / 2), 1.5 * r];
}

function inBounds(x: number, y: number, b: RouteBounds): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Minimal binary heap keyed by a number (lowest first). */
class MinHeap<T> {
  private items: { key: number; value: T }[] = [];
  get size(): number { return this.items.length; }
  push(key: number, value: T): void {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0].value;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest route from `from` to `to` (both "x_y"), inclusive of both ends.
 * Every step goes to a neighbouring hex, so the result is a normal path
 * chain and stays editable like a hand-drawn one.
 */
export function findRoute(from: string, to: string, opts: RouteOptions): RouteResult {
  const [fx, fy] = from.split("_").map(Number);
  const [tx, ty] = to.split("_").map(Number);
  const stagger = opts.stagger ?? "odd";
  if (!inBounds(fx, fy, opts.bounds) || !inBounds(tx, ty, opts.bounds)) {
    return { ok: false, reason: "out-of-bounds" };
  }
  if (from === to) return { ok: true, hexes: [from] };
  if (opts.meander) {
    const seed = typeof opts.meander === "object" ? opts.meander.seed : hashString(`${from}>${to}`);
    return meanderRoute(from, to, opts, seed);
  }

  const h = (x: number, y: number) => hexDistance([x, y], [tx, ty], opts.orientation, stagger);
  // Many routes are equally short on a hex grid. Among them, take the one
  // that keeps closest to the straight line between the ends (round 6: on
  // open ground the road bowed off to one side). Each hex entered adds its
  // distance from that line to a secondary cost `p`; routes compare by
  // steps first, then `p`, so the step count is still the shortest.
  const [ax, ay] = hexCenter(fx, fy, opts.orientation, stagger);
  const [bx, by] = hexCenter(tx, ty, opts.orientation, stagger);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const offLine = (x: number, y: number) => {
    const [px, py] = hexCenter(x, y, opts.orientation, stagger);
    return Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / len;
  };
  const g = new Map<string, number>([[from, 0]]);
  const p = new Map<string, number>([[from, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap<string>();
  // Order by f, then by the off-line cost (rounded; f is a whole number of
  // steps, so it dominates).
  const key = (f: number, pv: number) => f * 1e12 + Math.round(pv * 100);
  open.push(key(h(fx, fy), 0), from);

  while (open.size) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue;
    if (cur === to) {
      const hexes = [cur];
      let k = cur;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        hexes.push(k);
      }
      return { ok: true, hexes: hexes.reverse() };
    }
    closed.add(cur);
    const [cx, cy] = cur.split("_").map(Number);
    const gCur = g.get(cur)!;
    const pCur = p.get(cur)!;
    for (const [nx, ny] of hexNeighbors(cx, cy, opts.orientation, stagger)) {
      if (!inBounds(nx, ny, opts.bounds)) continue;
      const nk = `${nx}_${ny}`;
      if (closed.has(nk)) continue;
      if (nk !== to && opts.blocked?.(nx, ny)) continue;
      const gNext = gCur + 1;
      const pNext = pCur + offLine(nx, ny);
      const gOld = g.get(nk) ?? Infinity;
      if (gNext > gOld || (gNext === gOld && pNext >= p.get(nk)!)) continue;
      g.set(nk, gNext);
      p.set(nk, pNext);
      cameFrom.set(nk, cur);
      open.push(key(gNext + h(nx, ny), pNext), nk);
    }
  }
  return { ok: false, reason: "no-route" };
}

/** A small deterministic hash (FNV-1a) for seeding from the route's ends. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG, [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cost per hex (in steps) of being one hex away from the river's wave. */
const MEANDER_PULL = 1.5;

/**
 * A river's route: the cheapest hex-by-hex route where each step costs 1
 * plus how far the hex lies from a seeded wave between the ends (a few
 * half-waves, zero at both ends, about a fifth of the length high, capped).
 * Costs are at least 1 a step, so hex distance stays an admissible A*
 * heuristic and the result is a true shortest route for that cost.
 */
function meanderRoute(from: string, to: string, opts: RouteOptions, seed: number): RouteResult {
  const [fx, fy] = from.split("_").map(Number);
  const [tx, ty] = to.split("_").map(Number);
  const stagger = opts.stagger ?? "odd";
  const SQ3 = Math.sqrt(3);
  const [ax, ay] = hexCenter(fx, fy, opts.orientation, stagger);
  const [bx, by] = hexCenter(tx, ty, opts.orientation, stagger);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const lenHex = len / SQ3;
  const rand = rng(seed);
  const halfWaves = Math.max(1, Math.round(lenHex / 6)) + (rand() < 0.5 ? 0 : 1);
  const amp = Math.min(2.5, Math.max(0.9, lenHex * 0.2)) * (0.8 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1);
  /** How far (hexes) a hex lies from the wave. */
  const offWave = (x: number, y: number) => {
    const [px, py] = hexCenter(x, y, opts.orientation, stagger);
    const along = ((px - ax) * ux + (py - ay) * uy) / len;
    const side = ((px - ax) * -uy + (py - ay) * ux) / SQ3;
    const t = Math.min(1, Math.max(0, along));
    return Math.abs(side - amp * Math.sin(halfWaves * Math.PI * t));
  };

  const h = (x: number, y: number) => hexDistance([x, y], [tx, ty], opts.orientation, stagger);
  const g = new Map<string, number>([[from, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap<string>();
  open.push(h(fx, fy), from);
  while (open.size) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue;
    if (cur === to) {
      const hexes = [cur];
      let k = cur;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        hexes.push(k);
      }
      return { ok: true, hexes: hexes.reverse() };
    }
    closed.add(cur);
    const [cx, cy] = cur.split("_").map(Number);
    const gCur = g.get(cur)!;
    for (const [nx, ny] of hexNeighbors(cx, cy, opts.orientation, stagger)) {
      if (!inBounds(nx, ny, opts.bounds)) continue;
      const nk = `${nx}_${ny}`;
      if (closed.has(nk)) continue;
      if (nk !== to && opts.blocked?.(nx, ny)) continue;
      const gNext = gCur + 1 + MEANDER_PULL * offWave(nx, ny);
      if (gNext >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, gNext);
      cameFrom.set(nk, cur);
      open.push(gNext + h(nx, ny), nk);
    }
  }
  return { ok: false, reason: "no-route" };
}

/** The bits of a path chain auto-route needs. */
export interface RouteChain {
  typeName: string;
  hexes: string[];
}

/**
 * The chain an auto-route starting at `start` continues: one of the same
 * type whose LAST hex is `start` (the active chain first). Anything else,
 * including a start on a chain's first hex or in its middle, starts a new
 * path (round 7 R11: a second road from the keep must not join the first).
 */
export function routeExtendTarget<T extends RouteChain>(
  chains: readonly T[],
  typeName: string,
  start: string,
  active: T | null,
): T | null {
  const endsAtStart = (c: T) => c.typeName === typeName && c.hexes[c.hexes.length - 1] === start;
  if (active && endsAtStart(active)) return active;
  return chains.find(endsAtStart) ?? null;
}

/**
 * Add a routed leg to `chains`: appended to the chain it continues (only new
 * hexes are added; existing ones are never changed), else as a new chain.
 * Returns the chain the leg is now part of.
 */
export function addRoutedLeg<T extends RouteChain>(
  chains: T[],
  typeName: string,
  route: readonly string[],
  active: T | null,
  make: (typeName: string, hexes: string[]) => T,
): T {
  const target = routeExtendTarget(chains, typeName, route[0], active);
  if (target) {
    target.hexes.push(...route.slice(1));
    return target;
  }
  const chain = make(typeName, [...route]);
  chains.push(chain);
  return chain;
}

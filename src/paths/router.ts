/**
 * ROUTER v1: the route between two anchors of a path (A* inside the map's
 * bounds, around blocked hexes), and the total `routeSegment` that falls back
 * to a straight hex line when there's no route. Pure, no Obsidian imports.
 *
 * Anchored paths store only their anchors, so this function is part of the
 * file format: the hexes a map draws are whatever it returns. It is frozen
 * by golden tests (tests/pathRouter.golden.test.ts, tests/fixtures/
 * router-v1.json). Any change to what it returns is a ROUTER v2, which needs
 * a re-anchoring migration (anchorsFor run under v2 keeps every route).
 *
 * The router never sees a path's name or type. Its only style inputs are
 * the explicit `avoid` and `winding` flags of the segment context, which the
 * caller takes from the path type's explicit fields.
 *
 * Hex keys are "x_y" offset coordinates, the same as everywhere else.
 */

import type { HexKey } from "../types";
import { hexNeighbors } from "../hex-map/hexGeometry";
import { hexKey, hexPair, hexXY } from "../hexKey";

/** Bumped (with a re-anchoring migration) whenever routes would change. */
export const ROUTER_VERSION = 1;

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
   * Wind gently instead of taking the straightest shortest route. The route
   * follows a seeded wave between the ends, so it may take a few more steps.
   * The seed defaults to one taken from the ends ("from>to"), so the same two
   * anchors give the same route.
   */
  meander?: boolean | { seed: number };
}

export type RouteResult =
  | { ok: true; hexes: string[] }
  | { ok: false; reason: "out-of-bounds" | "no-route" };

type Orientation = "flat" | "pointy";
type Stagger = "odd" | "even";

const parity = (n: number) => ((n % 2) + 2) % 2;

/** Axial (q, r) for an offset hex, so hex distance is easy to compute. */
function toAxial(x: number, y: number, orientation: Orientation, stagger: Stagger): [number, number] {
  // hexNeighbors: the "shifted" column (flat) / row (pointy) is odd for
  // "odd" stagger, even for "even". Shifted lines sit half a hex down (flat)
  // or right (pointy).
  if (orientation === "flat") {
    const r = stagger === "odd" ? y - (x - parity(x)) / 2 : y - (x + parity(x)) / 2;
    return [x, r];
  }
  const q = stagger === "odd" ? x - (y - parity(y)) / 2 : x - (y + parity(y)) / 2;
  return [q, y];
}

/** The offset hex of an axial (q, r); the inverse of toAxial. */
function fromAxial(q: number, r: number, orientation: Orientation, stagger: Stagger): [number, number] {
  if (orientation === "flat") {
    const y = stagger === "odd" ? r + (q - parity(q)) / 2 : r + (q + parity(q)) / 2;
    return [q, y];
  }
  const x = stagger === "odd" ? q + (r - parity(r)) / 2 : q + (r + parity(r)) / 2;
  return [x, r];
}

/** Steps between two hexes on an unbounded grid. */
export function hexDistance(
  a: [number, number],
  b: [number, number],
  orientation: Orientation,
  stagger: Stagger = "odd",
): number {
  const [aq, ar] = toAxial(a[0], a[1], orientation, stagger);
  const [bq, br] = toAxial(b[0], b[1], orientation, stagger);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * A hex's centre in units of the hex's outer radius (so neighbouring centres
 * are √3 apart). The router's own: it's an input of ROUTER v1, so rendering
 * must not share it (rendering uses hexGeometry.hexCenter).
 */
export function hexCenter(
  x: number,
  y: number,
  orientation: Orientation,
  stagger: Stagger = "odd",
): [number, number] {
  const [q, r] = toAxial(x, y, orientation, stagger);
  return orientation === "flat"
    ? [1.5 * q, Math.sqrt(3) * (r + q / 2)]
    : [Math.sqrt(3) * (q + r / 2), 1.5 * r];
}

function inBounds(x: number, y: number, b: RouteBounds): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/**
 * A binary min-heap whose order is total and explicit: by `f`, then `p`, then
 * the insertion counter `seq`. Ties never fall out of the heap's internals,
 * so the routes don't change if the heap is ever rewritten.
 */
class MinHeap<T> {
  private items: { f: number; p: number; seq: number; value: T }[] = [];
  private seq = 0;
  get size(): number { return this.items.length; }
  private less(i: number, j: number): boolean {
    const a = this.items[i];
    const b = this.items[j];
    if (a.f !== b.f) return a.f < b.f;
    if (a.p !== b.p) return a.p < b.p;
    return a.seq < b.seq;
  }
  private swap(i: number, j: number): void {
    const a = this.items;
    [a[i], a[j]] = [a[j], a[i]];
  }
  push(f: number, p: number, value: T): void {
    const a = this.items;
    a.push({ f, p, seq: this.seq++, value });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
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
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }
}

function walkBack(cameFrom: Map<string, string>, end: string): string[] {
  const hexes = [end];
  let k = end;
  while (cameFrom.has(k)) {
    k = cameFrom.get(k)!;
    hexes.push(k);
  }
  return hexes.reverse();
}

/**
 * Shortest route from `from` to `to` (both "x_y"), inclusive of both ends.
 * Every step goes to a neighbouring hex. Between two neighbours the route is
 * always the direct step (the ends are never blocked).
 */
export function findRoute(from: string, to: string, opts: RouteOptions): RouteResult {
  const [fx, fy] = hexPair(from);
  const [tx, ty] = hexPair(to);
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
  // that keeps closest to the straight line between the ends. Each hex
  // entered adds its distance from that line to a secondary cost `p`; routes
  // compare by steps first, then `p`, so the step count is still the shortest.
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
  // Heap order: f (whole steps), then the off-line cost rounded to 1/100,
  // then insertion order.
  open.push(h(fx, fy), 0, from);

  while (open.size) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue;
    if (cur === to) return { ok: true, hexes: walkBack(cameFrom, cur) };
    closed.add(cur);
    const [cx, cy] = hexPair(cur);
    const gCur = g.get(cur)!;
    const pCur = p.get(cur)!;
    for (const [nx, ny] of hexNeighbors(cx, cy, opts.orientation, stagger)) {
      if (!inBounds(nx, ny, opts.bounds)) continue;
      const nk = hexKey(nx, ny);
      if (closed.has(nk)) continue;
      if (nk !== to && opts.blocked?.(nx, ny)) continue;
      const gNext = gCur + 1;
      const pNext = pCur + offLine(nx, ny);
      const gOld = g.get(nk) ?? Infinity;
      if (gNext > gOld || (gNext === gOld && pNext >= p.get(nk)!)) continue;
      g.set(nk, gNext);
      p.set(nk, pNext);
      cameFrom.set(nk, cur);
      open.push(gNext + h(nx, ny), Math.round(pNext * 100), nk);
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

/** Cost per hex (in steps) of being one hex away from the wave. */
const MEANDER_PULL = 1.5;

/**
 * A winding route: the cheapest hex-by-hex route where each step costs 1
 * plus how far the hex lies from a seeded wave between the ends (a few
 * half-waves, zero at both ends, about a fifth of the length high, capped).
 * Costs are at least 1 a step, so hex distance stays an admissible A*
 * heuristic and the result is a true shortest route for that cost.
 */
function meanderRoute(from: string, to: string, opts: RouteOptions, seed: number): RouteResult {
  const [fx, fy] = hexPair(from);
  const [tx, ty] = hexPair(to);
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
  // Heap order: f, then insertion order.
  open.push(h(fx, fy), 0, from);
  while (open.size) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue;
    if (cur === to) return { ok: true, hexes: walkBack(cameFrom, cur) };
    closed.add(cur);
    const [cx, cy] = hexPair(cur);
    const gCur = g.get(cur)!;
    for (const [nx, ny] of hexNeighbors(cx, cy, opts.orientation, stagger)) {
      if (!inBounds(nx, ny, opts.bounds)) continue;
      const nk = hexKey(nx, ny);
      if (closed.has(nk)) continue;
      if (nk !== to && opts.blocked?.(nx, ny)) continue;
      const gNext = gCur + 1 + MEANDER_PULL * offWave(nx, ny);
      if (gNext >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, gNext);
      cameFrom.set(nk, cur);
      open.push(gNext + h(nx, ny), 0, nk);
    }
  }
  return { ok: false, reason: "no-route" };
}

// ── Hex line (the fallback) ──────────────────────────────────────────────────

function cubeRound(fq: number, fr: number): [number, number] {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q === 0 ? 0 : q, r === 0 ? 0 : r];
}

/**
 * The straight line of hexes from `a` to `b`, inclusive, ignoring bounds and
 * terrain: a cube-coordinate lerp with a fixed nudge, so a line that runs
 * exactly along hex edges always breaks the same way. Consecutive hexes are
 * neighbours.
 */
export function hexLine(a: HexKey, b: HexKey, orientation: Orientation, stagger: Stagger = "odd"): HexKey[] {
  if (a === b) return [a];
  const [ax, ay] = hexPair(a);
  const [bx, by] = hexPair(b);
  const [aq, ar] = toAxial(ax, ay, orientation, stagger);
  const [bq, br] = toAxial(bx, by, orientation, stagger);
  const n = hexDistance([ax, ay], [bx, by], orientation, stagger);
  // The nudge (+1e-6, +2e-6, -3e-6 in q, r, s) keeps the cube sum at zero.
  const nq = aq + 1e-6;
  const nr = ar + 2e-6;
  const out: HexKey[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [q, r] = cubeRound(nq + (bq - aq) * t, nr + (br - ar) * t);
    const [x, y] = fromAxial(q, r, orientation, stagger);
    out.push(hexKey(x, y));
  }
  out[0] = a;
  out[out.length - 1] = b;
  return out;
}

// ── Segments ─────────────────────────────────────────────────────────────────

/** Everything about a map that routes depend on. */
export interface RouteContext {
  orientation: Orientation;
  stagger: Stagger;
  bounds: RouteBounds;
  /** Hexes whose shown terrain (own, else the map's base) is impassable. */
  blocked: ReadonlySet<HexKey>;
}

/**
 * A segment's style flags, from the path type's EXPLICIT fields only (never
 * from its name). Unknown type: DEFAULT_SEGMENT_STYLE.
 *
 * Wiring (when PathType gets them, fix/46-palettes-generators PA5):
 * `avoid` = PathType.avoidImpassable, `winding` = the type's winding
 * auto-route style. Built in one place by the caller's `styleFor`
 * (see resolve.ts `StyleFor`).
 */
export interface SegmentStyle {
  /** Go around blocked hexes (between anchors; anchors themselves never are). */
  avoid: boolean;
  /** Wind (the router's meander) instead of hugging the straight line. */
  winding: boolean;
}

/** For a type not in the palette: fixed values, never guessed from a name. */
export const DEFAULT_SEGMENT_STYLE: Readonly<SegmentStyle> = Object.freeze({ avoid: true, winding: false });

export type SegmentContext = RouteContext & SegmentStyle;

export interface SegmentRoute {
  /** From a to b inclusive; consecutive hexes are neighbours. */
  hexes: HexKey[];
  /** Set when the hex-line fallback was used, and why. */
  fallback?: "out-of-bounds" | "no-route";
}

/** The router options for a segment context. */
export function routeOptions(ctx: SegmentContext): RouteOptions {
  const blocked = ctx.avoid && ctx.blocked.size
    ? (x: number, y: number) => ctx.blocked.has(hexKey(x, y))
    : undefined;
  return { orientation: ctx.orientation, stagger: ctx.stagger, bounds: ctx.bounds, blocked, meander: ctx.winding };
}

/**
 * The route between two consecutive anchors. Total: when the router can't
 * route (an anchor off the map, or walled off), the segment is the straight
 * hex line and `fallback` says why. Depends only on a, b and ctx (locality).
 * `ctx.winding` is the only place the winding style reaches the router.
 */
export function routeSegment(a: HexKey, b: HexKey, ctx: SegmentContext): SegmentRoute {
  const r = findRoute(a, b, routeOptions(ctx));
  if (r.ok) return { hexes: r.hexes };
  return { hexes: hexLine(a, b, ctx.orientation, ctx.stagger), fallback: r.reason };
}

/** cyrb53: a 53-bit string hash (fewer collisions than 32-bit FNV for cache keys). */
function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A signature of the blocked hexes inside the bounds (order-independent). */
export function blockedSignature(blocked: ReadonlySet<HexKey>, bounds: RouteBounds): string {
  const keys: string[] = [];
  for (const k of blocked) {
    const { x, y } = hexXY(k);
    if (inBounds(x, y, bounds)) keys.push(k);
  }
  keys.sort();
  return `${keys.length}:${hash53(keys.join(",")).toString(36)}`;
}

/**
 * The key of a map's routing context: router version, orientation, stagger,
 * bounds and the blocked hexes. Two contexts with the same signature route
 * every segment the same (for the same avoid/winding flags).
 */
export function contextSignature(ctx: RouteContext): string {
  const b = ctx.bounds;
  return `v${ROUTER_VERSION}|${ctx.orientation}|${ctx.stagger}|${b.minX},${b.minY},${b.maxX},${b.maxY}|${blockedSignature(ctx.blocked, b)}`;
}

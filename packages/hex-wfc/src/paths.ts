/**
 * Path features: lines drawn on top of the terrain (rivers, roads) rather
 * than painted as terrain. Learned from an example map's paths and routed
 * over a generated map's terrain afterwards, so they never affect the
 * terrain rules.
 *
 * Each learned path type records what its ends connect to ("edge", a terrain
 * name, "path" = joins another path of the same type, as a tributary does,
 * or "none"), how much it wiggles, how long it runs relative to the map, and
 * which terrains it runs through.
 */

import { hexNeighbors, hexDistance, directionRing, cellKey, parseCellKey, type Orientation, type Stagger } from "./grid";
import type { PathFeature } from "./model";
import type { GridInfo } from "./post";

export interface PathInput {
  /** Path type name, e.g. "River". */
  type: string;
  /** Ordered hex keys "x_y". */
  hexes: string[];
}

export interface PathOutput {
  type: string;
  hexes: string[];
}

const MIN_PATH_HEXES = 3;

/** Remove consecutive duplicates (repeat clicks). */
function clean(hexes: string[]): string[] {
  return hexes.filter((h, i) => i === 0 || h !== hexes[i - 1]);
}

export function learnPaths(
  paths: PathInput[],
  cells: Map<string, string>,
  orientation: Orientation,
  stagger: Stagger = "odd",
): PathFeature[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of cells.keys()) {
    const xy = parseCellKey(k);
    if (!xy) continue;
    minX = Math.min(minX, xy[0]); maxX = Math.max(maxX, xy[0]);
    minY = Math.min(minY, xy[1]); maxY = Math.max(maxY, xy[1]);
  }
  const span = Math.max(maxX - minX + 1, maxY - minY + 1, 1);
  const onBorder = (xy: [number, number]) =>
    xy[0] <= minX || xy[0] >= maxX || xy[1] <= minY || xy[1] >= maxY;
  const ring = directionRing(orientation);

  const usable = paths.map((p) => ({ type: p.type, hexes: clean(p.hexes) })).filter((p) => p.hexes.length >= MIN_PATH_HEXES);
  const groups = new Map<string, { f: PathFeature; turns: number[]; lengths: number[]; through: Map<string, number>; hexes: number }>();

  for (const [i, p] of usable.entries()) {
    const others = new Set<string>();
    for (const [j, q] of usable.entries()) if (j !== i && q.type === p.type) for (const h of q.hexes) others.add(h);
    // Terrain the path mostly runs through, to tell a real destination apart.
    const tally = new Map<string, number>();
    for (const h of p.hexes) {
      const t = cells.get(h);
      if (t) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const main = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    const anchor = (h: string): string => {
      const xy = parseCellKey(h);
      if (!xy) return "none";
      if (onBorder(xy)) return "edge";
      if (others.has(h)) return "path";
      const t = cells.get(h);
      return t && t !== main ? t : "none";
    };
    let from = anchor(p.hexes[0]);
    let to = anchor(p.hexes[p.hexes.length - 1]);
    if (from === "none" && to === "none") continue;
    // Joins at both ends (a link between two branches) isn't something to
    // reproduce on its own.
    if (from === "path" && to === "path") continue;
    // Order: a "path" anchor first (branches start from their parent), then
    // "edge", then a terrain, then "none".
    const rank = (e: string) => (e === "path" ? 0 : e === "edge" ? 1 : e === "none" ? 3 : 2);
    if (rank(to) < rank(from) || (rank(to) === rank(from) && to < from)) [from, to] = [to, from];

    // Wiggle: share of steps that change direction.
    let turns = 0, steps = 0, prevDir = -1;
    for (let k = 1; k < p.hexes.length; k++) {
      const a = parseCellKey(p.hexes[k - 1]), b = parseCellKey(p.hexes[k]);
      if (!a || !b) continue;
      const ns = hexNeighbors(a[0], a[1], orientation, stagger);
      const d = ns.findIndex(([x, y]) => x === b[0] && y === b[1]);
      if (d < 0) continue; // not adjacent (a gap in the drawn path)
      const dir = ring.indexOf(d);
      if (prevDir >= 0) {
        steps++;
        if (dir !== prevDir) turns++;
      }
      prevDir = dir;
    }

    const key = `${p.type}\u0000${from}\u0000${to}`;
    let g = groups.get(key);
    if (!g) {
      g = { f: { type: p.type, from, to, count: 0, turn: 0, length: 0, through: {} }, turns: [], lengths: [], through: new Map(), hexes: 0 };
      groups.set(key, g);
    }
    g.f.count++;
    g.turns.push(steps ? turns / steps : 0.2);
    g.lengths.push(p.hexes.length / span);
    for (const [t, n] of tally) g.through.set(t, (g.through.get(t) ?? 0) + n);
    g.hexes += p.hexes.length;
  }

  const round = (n: number, d = 100) => Math.round(n * d) / d;
  return [...groups.values()].map(({ f, turns, lengths, through, hexes }) => ({
    ...f,
    turn: round(turns.reduce((a, b) => a + b, 0) / turns.length),
    length: round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    through: Object.fromEntries([...through].sort((a, b) => b[1] - a[1]).map(([t, n]) => [t, round(n / hexes)])),
  }));
}

/**
 * Route learned paths over a finished map. Each path is a cheapest route
 * (Dijkstra) between its anchors, where hexes on terrains the example's path
 * ran through are cheap, plus seeded noise for the learned wiggle.
 */
export function routePaths(
  features: PathFeature[],
  cells: Map<string, string>,
  grid: GridInfo,
  rng: () => number,
  sizeScale: number,
): { paths: PathOutput[]; warnings: string[] } {
  const { cols, rows, ox, oy, orientation, stagger } = grid;
  const N = cols * rows;
  const keyOf = (c: number) => cellKey(ox + (c % cols), oy + Math.floor(c / cols));
  const idx = (x: number, y: number) => (y - oy) * cols + (x - ox);
  const inGrid = (x: number, y: number) => x >= ox && x < ox + cols && y >= oy && y < oy + rows;
  const nbr: number[][] = [];
  for (let c = 0; c < N; c++) {
    const x = ox + (c % cols), y = oy + Math.floor(c / cols);
    nbr.push(hexNeighbors(x, y, orientation, stagger).filter(([nx, ny]) => inGrid(nx, ny)).map(([nx, ny]) => idx(nx, ny)));
  }
  const terrainOf = (c: number) => cells.get(keyOf(c)) ?? "";
  const share = new Map<string, number>();
  for (const t of cells.values()) share.set(t, (share.get(t) ?? 0) + 1 / N);
  const border = (c: number) => {
    const i = c % cols, j = Math.floor(c / cols);
    return i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
  };
  const sideOf = (c: number): number => {
    const i = c % cols, j = Math.floor(c / cols);
    const d = [j, cols - 1 - i, rows - 1 - j, i]; // N, E, S, W
    return d.indexOf(Math.min(...d));
  };

  const candidates = (anchor: string, taken: Set<number>, avoidSide: number | null): number[] => {
    const all: number[] = [];
    for (let c = 0; c < N; c++) {
      const ok =
        anchor === "edge" ? border(c) && (avoidSide === null || sideOf(c) !== avoidSide)
        : anchor === "path" ? taken.has(c)
        : anchor === "none" ? !border(c)
        : terrainOf(c) === anchor;
      if (ok) all.push(c);
    }
    return all;
  };

  /** Cheapest route from `start` to the nearest target, avoiding `taken` (no braids). */
  const dijkstra = (cost: Float64Array, start: number, targets: Set<number>, taken: Set<number>): number[] | null => {
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
      const [d, c] = heap.pop();
      if (d > dist[c]) continue;
      if (targets.has(c)) {
        const route: number[] = [];
        for (let k = c; k >= 0; k = prev[k]) route.push(k);
        return route.reverse();
      }
      for (const n of nbr[c]) {
        if (taken.has(n) && !targets.has(n)) continue;
        const nd = d + cost[n];
        if (nd < dist[n]) {
          dist[n] = nd;
          prev[n] = c;
          heap.push(nd, n);
        }
      }
    }
    return null;
  };

  const routeOne = (f: PathFeature, cost: Float64Array, taken: Set<number>): number[] | null => {
    const starts = candidates(f.from, taken, null).filter((c) => f.from === "path" || !taken.has(c));
    if (!starts.length) return null;
    // A few random starts; keep the cheapest.
    let start = starts[Math.floor(rng() * starts.length)];
    for (let t = 0; t < 6; t++) {
      const c = starts[Math.floor(rng() * starts.length)];
      if (cost[c] < cost[start]) start = c;
    }
    const startSide = border(start) ? sideOf(start) : null;
    let targets: Set<number>;
    if (f.to === "none") {
      const want = Math.max(3, Math.round(f.length * Math.max(cols, rows)));
      const sx = ox + (start % cols), sy = oy + Math.floor(start / cols);
      const atLength: number[] = [];
      for (let c = 0; c < N; c++) {
        const d = hexDistance([sx, sy], [ox + (c % cols), oy + Math.floor(c / cols)], orientation, stagger);
        if (Math.abs(d - want) <= 1) atLength.push(c);
      }
      targets = new Set(atLength.length ? [atLength[Math.floor(rng() * atLength.length)]] : []);
    } else {
      targets = new Set(candidates(f.to, taken, f.to === "edge" ? startSide : null));
      // Edge-to-edge: don't let it cut a corner; it should run at least most
      // of the learned length.
      if (f.to === "edge") {
        const minLen = Math.round(0.6 * f.length * Math.max(cols, rows));
        const sx = ox + (start % cols), sy = oy + Math.floor(start / cols);
        const far = [...targets].filter(
          (c) => hexDistance([sx, sy], [ox + (c % cols), oy + Math.floor(c / cols)], orientation, stagger) >= minLen,
        );
        if (far.length) targets = new Set(far);
      }
    }
    if (f.to !== "path") for (const c of taken) targets.delete(c);
    targets.delete(start);
    if (!targets.size) return null;
    const route = dijkstra(cost, start, targets, taken);
    return route && route.length >= MIN_PATH_HEXES ? route : null;
  };

  const out: PathOutput[] = [];
  const warnings: string[] = [];
  const takenByType = new Map<string, Set<number>>();
  // Parents before branches.
  const order = [...features].sort((a, b) => Number(a.from === "path") - Number(b.from === "path"));

  for (const f of order) {
    // Cheap on terrains the example's path ran through (relative to how
    // common they are), plus smooth noise so routes wiggle like the example.
    const pref = (t: string) => Math.log(((f.through[t] ?? 0) + 0.01) / ((share.get(t) ?? 0) + 0.01));
    const noiseAmp = 0.5 + 3 * f.turn;
    const phase = [rng(), rng(), rng()].map((v) => v * Math.PI * 2);
    const freq = 0.6 + rng() * 0.6;
    const cost = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      const i = c % cols, j = Math.floor(c / cols);
      const noise = (Math.sin(i * freq + phase[0]) * Math.cos(j * freq * 0.8 + phase[1]) + Math.sin((i + j) * freq * 0.7 + phase[2])) / 2;
      cost[c] = Math.max(0.05, 1.5 - pref(terrainOf(c)) + noiseAmp * (0.5 + 0.5 * noise));
    }

    const count = Math.max(1, Math.round(f.count * sizeScale));
    const taken = takenByType.get(f.type) ?? new Set<number>();
    takenByType.set(f.type, taken);
    let made = 0;
    for (let k = 0; k < count; k++) {
      const route = routeOne(f, cost, taken);
      if (!route) continue;
      out.push({ type: f.type, hexes: route.map(keyOf) });
      for (const c of route) taken.add(c);
      made++;
    }
    if (made < count) {
      const end = (e: string) => (e === "edge" ? "a map edge" : e === "path" ? `another ${f.type}` : e);
      warnings.push(`Placed ${made} of ${count} ${f.type} paths (${end(f.from)} to ${end(f.to)})`);
    }
  }
  return { paths: out, warnings };
}

/** Minimal binary min-heap of [priority, value]. */
class MinHeap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(priority: number, value: number): void {
    const a = this.items;
    a.push([priority, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

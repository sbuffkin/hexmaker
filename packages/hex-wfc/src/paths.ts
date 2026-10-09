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
import { pathRouteKey, type PathFeature, type PathTweak } from "./model";
import type { GridInfo } from "./post";

export interface PathInput {
  /** Path type name, e.g. "River". */
  type: string;
  /** Ordered hex keys "x_y". */
  hexes: string[];
}

export interface PathOutput {
  type: string;
  /** The learned route it came from (pathRouteKey). */
  route: string;
  hexes: string[];
}

/** How one learned route fared on a map. */
export interface RouteStat {
  route: string;
  /** Learned count scaled to this map: what "auto" means. */
  auto: number;
  /** How many were asked for (0 when the route is off). */
  wanted: number;
  placed: number;
}

const MIN_PATH_HEXES = 3;
/**
 * Cap on how much a path prefers or avoids a terrain (log of how much more
 * often the example's path ran through it than it covers the map). Uncapped,
 * a terrain that's rare on the map but common under the example's paths
 * became nearly free to cross, so rivers ran long detours along a thin strip
 * of it (a coast). At 1.2 a favoured terrain is at most ~5x cheaper.
 */
const PREF_CAP = 1.2;
/**
 * Extra cost of a border hex for routes that avoid impassable terrain (the
 * default): without it, cheap terrain along the edge drew routes into
 * running down the map border.
 */
const BORDER_COST = 3;

/** "edge-N" / "edge-E" / "edge-S" / "edge-W" (any case): which side; null for anything else. */
export function edgeSide(anchor: string): "N" | "E" | "S" | "W" | null {
  const m = /^edge-([nesw])$/i.exec(anchor.trim());
  return m ? (m[1].toUpperCase() as "N" | "E" | "S" | "W") : null;
}
/** Any edge anchor: `edge` or one side of it. */
export const isEdgeAnchor = (anchor: string): boolean => anchor === "edge" || edgeSide(anchor) !== null;

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
  tweaks: Record<string, PathTweak> = {},
  /** Terrains paths may not cross unless their tweak says crossImpassable. */
  impassable: string[] = [],
): { paths: PathOutput[]; warnings: string[]; routes: RouteStat[] } {
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
  const impassableSet = new Set(impassable);
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

  /** Is c on the given side's border row/column? */
  const onSide = (c: number, side: "N" | "E" | "S" | "W"): boolean => {
    const i = c % cols, j = Math.floor(c / cols);
    return side === "N" ? j === 0 : side === "S" ? j === rows - 1 : side === "W" ? i === 0 : i === cols - 1;
  };
  const candidates = (anchor: string, taken: Set<number>, avoidSide: number | null): number[] => {
    const all: number[] = [];
    const side = edgeSide(anchor);
    for (let c = 0; c < N; c++) {
      const ok =
        side ? onSide(c, side)
        : anchor === "edge" ? border(c) && (avoidSide === null || sideOf(c) !== avoidSide)
        : anchor === "path" ? taken.has(c)
        : anchor === "none" ? !border(c)
        : terrainOf(c) === anchor;
      if (ok) all.push(c);
    }
    return all;
  };

  /** Cheapest route from `start` to the nearest target, avoiding `taken` (no braids) and `blocked` hexes. */
  const dijkstra = (cost: Float64Array, start: number, targets: Set<number>, taken: Set<number>, blocked: Uint8Array | null): number[] | null => {
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
        if (blocked?.[n] && !targets.has(n)) continue;
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

  const routeOne = (f: PathFeature, cost: Float64Array, taken: Set<number>, blocked: Uint8Array | null): number[] | null => {
    // An end on impassable terrain is only allowed when that terrain is the
    // anchor itself (a river that ends in the shallows).
    const endOk = (anchor: string) => (c: number) => !blocked?.[c] || terrainOf(c) === anchor;
    const starts = candidates(f.from, taken, null).filter((c) => (f.from === "path" || !taken.has(c)) && endOk(f.from)(c));
    if (!starts.length) return null;
    const dist = (a: number, b: number) =>
      hexDistance([ox + (a % cols), oy + Math.floor(a / cols)], [ox + (b % cols), oy + Math.floor(b / cols)], orientation, stagger);

    /**
     * Route from one start, to ends it can actually reach (land cut off by
     * impassable terrain or other paths doesn't count). If none of those is
     * as far as the learned length asks, the farthest one will do.
     */
    const attempt = (start: number): number[] | null => {
      const reach = new Uint8Array(N);
      reach[start] = 1;
      const stack = [start];
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of nbr[c]) {
          if (reach[n] || blocked?.[n] || taken.has(n)) continue;
          reach[n] = 1;
          stack.push(n);
        }
      }
      // An end can be stepped onto from reachable land (a river into the sea).
      const reachable = (c: number) => reach[c] === 1 || nbr[c].some((n) => reach[n] === 1);
      const startSide = border(start) ? sideOf(start) : null;
      let targets: Set<number>;
      if (f.to === "none") {
        const want = Math.max(3, Math.round(f.length * Math.max(cols, rows)));
        const land: { c: number; d: number }[] = [];
        for (let c = 0; c < N; c++) if (reach[c] && c !== start) land.push({ c, d: dist(start, c) });
        let atLength = land.filter((x) => Math.abs(x.d - want) <= 1);
        if (!atLength.length && land.length) {
          const best = Math.max(...land.filter((x) => x.d <= want).map((x) => x.d), 0);
          atLength = best >= MIN_PATH_HEXES - 1 ? land.filter((x) => x.d === best) : [];
        }
        targets = new Set(atLength.length ? [atLength[Math.floor(rng() * atLength.length)].c] : []);
      } else {
        targets = new Set(candidates(f.to, taken, f.to === "edge" ? startSide : null).filter((c) => endOk(f.to)(c) && reachable(c)));
        // Edge-to-edge: don't let it cut a corner; it should run at least most
        // of the learned length (or as far as the land allows).
        if (isEdgeAnchor(f.to)) {
          const minLen = Math.round(0.6 * f.length * Math.max(cols, rows));
          const far = [...targets].filter((c) => dist(start, c) >= minLen);
          if (far.length) targets = new Set(far);
          else if (targets.size) {
            const longest = Math.max(...[...targets].map((c) => dist(start, c)));
            targets = new Set([...targets].filter((c) => dist(start, c) === longest));
          }
        }
      }
      if (f.to !== "path") for (const c of taken) targets.delete(c);
      targets.delete(start);
      if (!targets.size) return null;
      const route = dijkstra(cost, start, targets, taken, blocked);
      return route && route.length >= MIN_PATH_HEXES ? route : null;
    };

    // A few random starts; try the cheapest first, then others if it fails
    // (it may sit on a scrap of land the route can't leave).
    const tried = new Set<number>();
    let start = starts[Math.floor(rng() * starts.length)];
    for (let t = 0; t < 6; t++) {
      const c = starts[Math.floor(rng() * starts.length)];
      if (cost[c] < cost[start]) start = c;
    }
    for (let k = 0; k < 12 && tried.size < starts.length; k++) {
      tried.add(start);
      const route = attempt(start);
      if (route) return route;
      const left = starts.filter((c) => !tried.has(c));
      if (!left.length) break;
      start = left[Math.floor(rng() * left.length)];
    }
    return null;
  };

  const out: PathOutput[] = [];
  const warnings: string[] = [];
  const takenByType = new Map<string, Set<number>>();
  // Parents before branches.
  const order = [...features].sort((a, b) => Number(a.from === "path") - Number(b.from === "path"));

  const routes: RouteStat[] = [];
  for (const learned of order) {
    const route = pathRouteKey(learned);
    const tw = tweaks[route] ?? {};
    const f: PathFeature = { ...learned, length: learned.length * (tw.length ?? 1) };
    const follow = tw.follow ?? 1;
    // Cheap on terrains the example's path ran through (relative to how
    // common they are), plus smooth noise so routes wiggle like the example.
    const pref = (t: string) =>
      follow * Math.max(-PREF_CAP, Math.min(PREF_CAP, Math.log(((f.through[t] ?? 0) + 0.01) / ((share.get(t) ?? 0) + 0.01))));
    const noiseAmp = (0.5 + 3 * f.turn) * (tw.wiggle ?? 1);
    const phase = [rng(), rng(), rng()].map((v) => v * Math.PI * 2);
    const freq = 0.6 + rng() * 0.6;
    const cost = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      const i = c % cols, j = Math.floor(c / cols);
      const noise = (Math.sin(i * freq + phase[0]) * Math.cos(j * freq * 0.8 + phase[1]) + Math.sin((i + j) * freq * 0.7 + phase[2])) / 2;
      cost[c] = Math.max(0.05, 1.5 - pref(terrainOf(c)) + noiseAmp * (0.5 + 0.5 * noise));
      if (!tw.crossImpassable && border(c)) cost[c] *= BORDER_COST;
    }

    // Impassable hexes this route may not cross (unless it's allowed to).
    let blocked: Uint8Array | null = null;
    if (impassableSet.size && !tw.crossImpassable) {
      blocked = new Uint8Array(N);
      for (let c = 0; c < N; c++) if (impassableSet.has(terrainOf(c))) blocked[c] = 1;
    }

    const auto = Math.max(1, Math.round(f.count * sizeScale));
    const count = tw.off ? 0 : Math.max(0, Math.round(tw.count ?? auto));
    const stat: RouteStat = { route, auto, wanted: count, placed: 0 };
    routes.push(stat);
    if (!count) continue;
    const taken = takenByType.get(f.type) ?? new Set<number>();
    takenByType.set(f.type, taken);
    let made = 0;
    for (let k = 0; k < count; k++) {
      const path = routeOne(f, cost, taken, blocked);
      if (!path) continue;
      out.push({ type: f.type, route: stat.route, hexes: path.map(keyOf) });
      for (const c of path) taken.add(c);
      made++;
    }
    stat.placed = made;
    if (made < count) {
      const sideName = { N: "the north edge", E: "the east edge", S: "the south edge", W: "the west edge" } as const;
      const end = (e: string) => (e === "edge" ? "a map edge" : edgeSide(e) ? sideName[edgeSide(e)!] : e === "path" ? `another ${f.type}` : e);
      warnings.push(`Placed ${made} of ${count} ${f.type} paths (${end(f.from)} to ${end(f.to)})`);
    }
  }
  return { paths: out, warnings, routes };
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

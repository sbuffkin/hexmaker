import { hexNeighbors, hexCenter, cellKey, parseCellKey, toCellMap, type Orientation, type Stagger } from "./grid";
import type { HexWfcModel, GrowthShape } from "./model";

export interface LearnOptions {
  name: string;
  orientation: Orientation;
  stagger?: Stagger;
  meta?: Record<string, string>;
}

/**
 * Build a model from a painted example map.
 *
 * - Terrain weight = how many hexes use it.
 * - Adjacency weight = how many edges join the pair. Pairs that never touch
 *   in the example are left out, so they can never touch in generated maps.
 *
 * Cells that are missing (unpainted) are ignored, along with their edges.
 */
export function learnModel(
  cells: Map<string, string> | Record<string, string>,
  opts: LearnOptions,
): HexWfcModel {
  const map = toCellMap(cells);
  const stagger = opts.stagger ?? "odd";
  const terrainCount = new Map<string, number>();
  // Each undirected edge is seen from both ends, so counts are halved below.
  const edgeCount = new Map<string, { a: string; b: string; n: number }>();

  for (const [key, ta] of map) {
    const xy = parseCellKey(key);
    if (!xy || !ta) continue;
    terrainCount.set(ta, (terrainCount.get(ta) ?? 0) + 1);
    for (const [nx, ny] of hexNeighbors(xy[0], xy[1], opts.orientation, stagger)) {
      const tb = map.get(cellKey(nx, ny));
      if (!tb) continue;
      const [a, b] = ta <= tb ? [ta, tb] : [tb, ta];
      const k = `${a}\u0000${b}`;
      const e = edgeCount.get(k);
      if (e) e.n++;
      else edgeCount.set(k, { a, b, n: 1 });
    }
  }

  const shapes = measurePatches(map, opts.orientation, stagger);
  const layouts = measureLayout(map);
  const terrains = [...terrainCount]
    .map(([name, weight]) => ({ name, weight, ...shapes.get(name), layout: layouts.get(name) }))
    .sort((p, q) => q.weight - p.weight || p.name.localeCompare(q.name));
  const order = new Map(terrains.map((t, i) => [t.name, i]));
  const adjacency = [...edgeCount.values()]
    .map(({ a, b, n }) => {
      // List each row under the more common terrain first; reads better.
      const [p, q] = order.get(a)! <= order.get(b)! ? [a, b] : [b, a];
      return { a: p, b: q, weight: n / 2 };
    })
    .sort((p, q) => order.get(p.a)! - order.get(q.a)! || q.weight - p.weight || p.b.localeCompare(q.b));

  return { name: opts.name, terrains, adjacency, meta: { ...(opts.meta ?? {}) } };
}

/** Thresholds for classifying patch shapes. Exported for tests and tuning. */
export const SHAPE_THRESHOLDS = {
  /** Size-weighted mean patch below this many hexes → "none" (scattered). */
  minPatchHexes: 2.5,
  /** Patch above this share of the map → "none" (it's the background). */
  maxPatchShare: 0.3,
  /** Long axis / short axis at or above this → "line". */
  lineElongation: 2.2,
  /** Mean same-terrain neighbours at or above this → "blob"; below → thin
   *  (shores, rings), left to the neighbour rules. */
  blobThickness: 3.5,
};

/**
 * Measure each terrain's connected patches and turn them into a growth style.
 * Only shape is used, never names, so it works for any palette.
 *
 * - patch: size-weighted mean patch size (Σs² / Σs, so one big lake counts
 *   for more than a few stray specks), as a fraction of all painted hexes.
 * - elongation: √(λ1/λ2) of the covariance of hex centres, per patch.
 * - thickness: mean number of same-terrain neighbours.
 */
export function measurePatches(
  cells: Map<string, string>,
  orientation: Orientation,
  stagger: Stagger = "odd",
): Map<string, { patch: number; shape: GrowthShape; turn?: number }> {
  const seen = new Set<string>();
  const stats = new Map<string, { sumS: number; sumS2: number; elong: number; thick: number; weighted: number }>();
  const total = cells.size;

  for (const [start, t] of cells) {
    if (seen.has(start)) continue;
    // Flood-fill one patch.
    const patch: [number, number][] = [];
    const stack = [start];
    seen.add(start);
    let sameNeighbours = 0;
    while (stack.length) {
      const key = stack.pop()!;
      const xy = parseCellKey(key);
      if (!xy) continue;
      patch.push(xy);
      for (const [nx, ny] of hexNeighbors(xy[0], xy[1], orientation, stagger)) {
        const nk = cellKey(nx, ny);
        if (cells.get(nk) !== t) continue;
        sameNeighbours++;
        if (!seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    const s = patch.length;
    const st = stats.get(t) ?? { sumS: 0, sumS2: 0, elong: 0, thick: 0, weighted: 0 };
    st.sumS += s;
    st.sumS2 += s * s;
    if (s >= 3) {
      // Principal axes of the patch.
      let mx = 0, my = 0;
      const pts = patch.map(([x, y]) => hexCenter(x, y, orientation, stagger));
      for (const [px, py] of pts) { mx += px; my += py; }
      mx /= s; my /= s;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [px, py] of pts) {
        sxx += (px - mx) ** 2; syy += (py - my) ** 2; sxy += (px - mx) * (py - my);
      }
      sxx /= s; syy /= s; sxy /= s;
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
      const elongation = Math.sqrt((l1 + 0.25) / (l2 + 0.25));
      // Weight by size so big patches decide the style.
      st.elong += elongation * s;
      st.thick += (sameNeighbours / s) * s;
      st.weighted += s;
    }
    stats.set(t, st);
  }

  const out = new Map<string, { patch: number; shape: GrowthShape; turn?: number }>();
  const T = SHAPE_THRESHOLDS;
  for (const [t, st] of stats) {
    const meanPatch = st.sumS2 / st.sumS;
    const share = total ? meanPatch / total : 0;
    const patch = Math.round(share * 10000) / 10000;
    if (meanPatch < T.minPatchHexes || share > T.maxPatchShare || st.weighted === 0) {
      out.set(t, { patch, shape: "none" });
      continue;
    }
    const elong = st.elong / st.weighted;
    const thick = st.thick / st.weighted;
    if (elong >= T.lineElongation) {
      // Straighter patches (higher elongation) turn less. Heuristic.
      const turn = Math.round(Math.min(0.5, Math.max(0.05, 1.2 / elong)) * 100) / 100;
      out.set(t, { patch, shape: "line", turn });
    } else if (thick >= T.blobThickness) {
      out.set(t, { patch, shape: "blob" });
    } else {
      out.set(t, { patch, shape: "none" });
    }
  }
  return out;
}

/**
 * Where each terrain sits in the example: relative density in a 3×3 grid over
 * the painted area's bounding box (NW, N, NE, W, C, E, SW, S, SE). 1 means as
 * common as across the whole map. Smoothed toward 1 so a bin with few hexes
 * doesn't forbid a terrain outright.
 */
export function measureLayout(cells: Map<string, string>): Map<string, number[]> {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts: [number, number, string][] = [];
  for (const [key, t] of cells) {
    const xy = parseCellKey(key);
    if (!xy || !t) continue;
    pts.push([xy[0], xy[1], t]);
    minX = Math.min(minX, xy[0]); maxX = Math.max(maxX, xy[0]);
    minY = Math.min(minY, xy[1]); maxY = Math.max(maxY, xy[1]);
  }
  const out = new Map<string, number[]>();
  if (!pts.length) return out;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const bin = (x: number, y: number) =>
    Math.min(2, Math.floor((3 * (y - minY)) / h)) * 3 + Math.min(2, Math.floor((3 * (x - minX)) / w));
  const binTotal = new Array<number>(9).fill(0);
  const counts = new Map<string, number[]>();
  for (const [x, y, t] of pts) {
    const b = bin(x, y);
    binTotal[b]++;
    let c = counts.get(t);
    if (!c) counts.set(t, (c = new Array<number>(9).fill(0)));
    c[b]++;
  }
  const PSEUDO = 4; // pseudo-hexes per bin pulling the estimate toward 1
  for (const [t, c] of counts) {
    const share = c.reduce((a, b) => a + b, 0) / pts.length;
    out.set(
      t,
      c.map((n, b) => {
        const p = (n + PSEUDO * share) / (binTotal[b] + PSEUDO);
        return Math.round(Math.max(0.02, p / share) * 100) / 100;
      }),
    );
  }
  return out;
}

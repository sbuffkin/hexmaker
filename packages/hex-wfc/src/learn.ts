import {
  hexNeighbors,
  hexCenter,
  hexDistance,
  cellKey,
  parseCellKey,
  toCellMap,
  type Orientation,
  type Stagger,
} from "./grid";
import type { HexWfcModel, GrowthShape, LineFeature, TerrainEntry } from "./model";

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
 * - Shape, patch size, line width, spacing, edge preference and layout come
 *   from measuring each terrain's patches (see measurePatches).
 * - Line patches anchored to a map edge or another terrain become guaranteed
 *   features (e.g. a river from the edge to a lake).
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

  const analysis = analysePatches(map, opts.orientation, stagger);
  const layouts = measureLayout(map);
  const terrains: TerrainEntry[] = [...terrainCount]
    .map(([name, weight]) => {
      const a = analysis.terrains.get(name);
      const entry: TerrainEntry = { name, weight };
      if (a) {
        entry.patch = a.patch;
        entry.shape = a.shape;
        if (a.turn !== undefined) entry.turn = a.turn;
        if (a.width !== undefined) entry.width = a.width;
        if (a.spacing !== undefined) entry.spacing = a.spacing;
        if (a.edge !== undefined) entry.edge = a.edge;
      }
      const layout = layouts.get(name);
      if (layout) entry.layout = layout;
      return entry;
    })
    .sort((p, q) => q.weight - p.weight || p.name.localeCompare(q.name));
  const order = new Map(terrains.map((t, i) => [t.name, i]));
  const adjacency = [...edgeCount.values()]
    .map(({ a, b, n }) => {
      // List each row under the more common terrain first; reads better.
      const [p, q] = order.get(a)! <= order.get(b)! ? [a, b] : [b, a];
      return { a: p, b: q, weight: n / 2 };
    })
    .sort((p, q) => order.get(p.a)! - order.get(q.a)! || q.weight - p.weight || p.b.localeCompare(q.b));

  const model: HexWfcModel = {
    name: opts.name,
    terrains,
    adjacency,
    exampleHexes: map.size,
    meta: { ...(opts.meta ?? {}) },
  };
  if (analysis.features.length) model.features = analysis.features;
  return model;
}

/** Thresholds for classifying patch shapes. Exported for tests and tuning. */
export const SHAPE_THRESHOLDS = {
  /** Size-weighted mean patch below this many hexes → "scatter" (single hexes). */
  scatterPatchHexes: 1.5,
  /** Size-weighted mean patch below this many hexes → "none". */
  minPatchHexes: 2.5,
  /** Patch above this share of the map → "none" (it's the background). */
  maxPatchShare: 0.3,
  /** Long axis / short axis at or above this → "line"... */
  lineElongation: 2.2,
  /** ...if also at most this many hexes thick. Thicker long patches (a sea
   *  along one edge) are bands, treated as blobs. */
  maxLineWidth: 3.5,
  /** A thin patch whose second most common neighbouring terrain makes up at
   *  least this share of its border is a boundary (a shore between land and
   *  sea), not a line: it's left to the neighbour rules. */
  boundaryShare: 0.3,
  /** Mean same-terrain neighbours at or above this → "blob"; below → thin
   *  (shores, rings), left to the neighbour rules. */
  blobThickness: 3.5,
  /** Line patches at least this many hexes long can become features. */
  featureMinHexes: 4,
};

interface Patch {
  terrain: string;
  cells: [number, number][];
  /** Principal axis (unit vector) and centroid of hex centres. */
  axis: [number, number];
  centre: [number, number];
  l1: number;
  l2: number;
  sameNeighbours: number;
  /** Neighbouring terrains other than its own, with edge counts. */
  others: Map<string, number>;
}

export interface TerrainAnalysis {
  patch: number;
  shape: GrowthShape;
  turn?: number;
  width?: number;
  spacing?: number;
  edge?: number;
}

/**
 * Measure each terrain's patches and turn them into growth style and the
 * other learned per-terrain values. Only shape is used, never names.
 */
export function measurePatches(
  cells: Map<string, string>,
  orientation: Orientation,
  stagger: Stagger = "odd",
): Map<string, TerrainAnalysis> {
  return analysePatches(cells, orientation, stagger).terrains;
}

function analysePatches(
  cells: Map<string, string>,
  orientation: Orientation,
  stagger: Stagger,
): { terrains: Map<string, TerrainAnalysis>; features: LineFeature[] } {
  const patches = findPatches(cells, orientation, stagger);
  const total = cells.size;
  const TH = SHAPE_THRESHOLDS;

  // Bounding box of the painted area, for edge detection.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const key of cells.keys()) {
    const xy = parseCellKey(key);
    if (!xy) continue;
    minX = Math.min(minX, xy[0]); maxX = Math.max(maxX, xy[0]);
    minY = Math.min(minY, xy[1]); maxY = Math.max(maxY, xy[1]);
  }
  const borderDist = ([x, y]: [number, number]) => Math.min(x - minX, maxX - x, y - minY, maxY - y);

  const byTerrain = new Map<string, Patch[]>();
  for (const p of patches) {
    const list = byTerrain.get(p.terrain);
    if (list) list.push(p);
    else byTerrain.set(p.terrain, [p]);
  }

  // The background (largest share) is ignored when deciding what a line's end touches.
  let background = "";
  let bgCount = -1;
  const countOf = new Map<string, number>();
  for (const t of cells.values()) countOf.set(t, (countOf.get(t) ?? 0) + 1);
  for (const [t, n] of countOf) if (n > bgCount) { bgCount = n; background = t; }

  // Edge preference: share in the outer two rings vs overall.
  const edgeRingTotal = [...cells.keys()].filter((k) => {
    const xy = parseCellKey(k);
    return xy && borderDist(xy) <= 1;
  }).length;
  const bigEnough = maxX - minX >= 5 && maxY - minY >= 5;

  const terrains = new Map<string, TerrainAnalysis>();
  const lineTerrains = new Set<string>();
  for (const [t, list] of byTerrain) {
    let sumS = 0, sumS2 = 0, elongW = 0, thickW = 0, widthW = 0, weighted = 0;
    const others = new Map<string, number>();
    for (const p of list) {
      for (const [u, n] of p.others) others.set(u, (others.get(u) ?? 0) + n);
      const s = p.cells.length;
      sumS += s;
      sumS2 += s * s;
      if (s >= 3) {
        const elongation = Math.sqrt((p.l1 + 0.25) / (p.l2 + 0.25));
        // A uniform segment of length L has variance L²/12; centres are √3 apart.
        const span = Math.sqrt(12 * p.l1) / Math.sqrt(3) + 1;
        elongW += elongation * s;
        thickW += (p.sameNeighbours / s) * s;
        widthW += (s / span) * s;
        weighted += s;
      }
    }
    const meanPatch = sumS2 / sumS;
    const share = total ? meanPatch / total : 0;
    const a: TerrainAnalysis = { patch: Math.round(share * 10000) / 10000, shape: "none" };
    if (meanPatch < TH.scatterPatchHexes) a.shape = "scatter";
    else if (meanPatch < TH.minPatchHexes || share > TH.maxPatchShare || weighted === 0) a.shape = "none";
    else {
      const elong = elongW / weighted;
      const thick = thickW / weighted;
      const width = widthW / weighted;
      const border = [...others.values()].sort((x, y) => y - x);
      const borderTotal = border.reduce((x, y) => x + y, 0);
      const isBoundary = borderTotal > 0 && (border[1] ?? 0) / borderTotal >= TH.boundaryShare;
      if (elong >= TH.lineElongation && width <= TH.maxLineWidth && isBoundary) {
        a.shape = "none";
      } else if (elong >= TH.lineElongation && width <= TH.maxLineWidth) {
        a.shape = "line";
        // Straighter patches (higher elongation) turn less. Heuristic.
        a.turn = Math.round(Math.min(0.5, Math.max(0.05, 1.2 / elong)) * 100) / 100;
        a.width = Math.round(Math.min(3, Math.max(1, width)) * 10) / 10;
        lineTerrains.add(t);
      } else if (thick >= TH.blobThickness || elong >= TH.lineElongation) {
        a.shape = "blob";
      }
    }
    if (a.shape === "scatter" && list.length > 1) a.spacing = minSpacing(list, orientation, stagger);
    if (bigEnough && edgeRingTotal > 0) {
      const all = countOf.get(t) ?? 0;
      const tShare = all / total;
      let onEdge = 0;
      for (const p of list) for (const c of p.cells) if (borderDist(c) <= 1) onEdge++;
      const PSEUDO = 4;
      const density = (onEdge + PSEUDO * tShare) / (edgeRingTotal + PSEUDO) / tShare;
      a.edge = Math.round(Math.max(0.02, density) * 100) / 100;
    }
    terrains.set(t, a);
  }

  // Features: line patches whose ends are anchored to the map edge or to a
  // (non-background) terrain.
  const featureCount = new Map<string, LineFeature>();
  for (const p of patches) {
    if (!lineTerrains.has(p.terrain) || p.cells.length < TH.featureMinHexes) continue;
    const proj = (c: [number, number]) => {
      const [px, py] = hexCenter(c[0], c[1], orientation, stagger);
      return (px - p.centre[0]) * p.axis[0] + (py - p.centre[1]) * p.axis[1];
    };
    let lo = p.cells[0], hi = p.cells[0];
    for (const c of p.cells) {
      if (proj(c) < proj(lo)) lo = c;
      if (proj(c) > proj(hi)) hi = c;
    }
    const anchor = (end: [number, number]): string => {
      if (borderDist(end) <= 1) return "edge";
      const near = new Map<string, number>();
      for (const [k, t] of cells) {
        if (t === p.terrain || t === background) continue;
        const xy = parseCellKey(k);
        if (xy && hexDistance(xy, end, orientation, stagger) <= 1) near.set(t, (near.get(t) ?? 0) + 1);
      }
      // Prefer a blob (a lake) over a thin terrain it passes through (its shore).
      let best = "none", bestScore = 0;
      for (const [t, n] of near) {
        const sc = n + (terrains.get(t)?.shape === "blob" ? 100 : 0);
        if (sc > bestScore) { bestScore = sc; best = t; }
      }
      return best;
    };
    let from = anchor(lo), to = anchor(hi);
    // A feature connects two things: edge to edge, or edge/terrain to terrain.
    if (from === "none" || to === "none") continue;
    // Prefer "edge" first, then a terrain, then "none".
    const rank = (e: string) => (e === "edge" ? 0 : e === "none" ? 2 : 1);
    if (rank(to) < rank(from) || (rank(to) === rank(from) && to < from)) [from, to] = [to, from];
    const key = `${p.terrain}\u0000${from}\u0000${to}`;
    const f = featureCount.get(key);
    if (f) f.count++;
    else featureCount.set(key, { terrain: p.terrain, from, to, count: 1 });
  }

  return { terrains, features: [...featureCount.values()] };
}

/** Flood-fill same-terrain patches and measure each one's shape. */
function findPatches(cells: Map<string, string>, orientation: Orientation, stagger: Stagger): Patch[] {
  const seen = new Set<string>();
  const out: Patch[] = [];
  for (const [start, t] of cells) {
    if (seen.has(start) || !t) continue;
    const list: [number, number][] = [];
    const stack = [start];
    seen.add(start);
    let sameNeighbours = 0;
    const others = new Map<string, number>();
    while (stack.length) {
      const key = stack.pop()!;
      const xy = parseCellKey(key);
      if (!xy) continue;
      list.push(xy);
      for (const [nx, ny] of hexNeighbors(xy[0], xy[1], orientation, stagger)) {
        const nk = cellKey(nx, ny);
        const u = cells.get(nk);
        if (u !== undefined && u !== t) others.set(u, (others.get(u) ?? 0) + 1);
        if (u !== t) continue;
        sameNeighbours++;
        if (!seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    // Principal axes of the hex centres.
    const pts = list.map(([x, y]) => hexCenter(x, y, orientation, stagger));
    const s = pts.length;
    let mx = 0, my = 0;
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
    // Eigenvector for l1.
    let ax = sxy, ay = l1 - sxx;
    if (Math.abs(ax) + Math.abs(ay) < 1e-9) [ax, ay] = sxx >= syy ? [1, 0] : [0, 1];
    const len = Math.hypot(ax, ay);
    out.push({ terrain: t, cells: list, axis: [ax / len, ay / len], centre: [mx, my], l1, l2, sameNeighbours, others });
  }
  return out;
}

/** Smallest distance between two patches of the same scattered terrain (capped). */
function minSpacing(list: Patch[], orientation: Orientation, stagger: Stagger): number {
  const pts = list.slice(0, 400).map((p) => p.cells[0]);
  let min = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) min = Math.min(min, hexDistance(pts[i], pts[j], orientation, stagger));
  return Math.min(12, min);
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

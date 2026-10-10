/**
 * Path geometry in LATTICE units: resolved hex chains → the polylines the
 * map view and the PNG export draw. Pure, no Obsidian or DOM imports.
 *
 * The lattice is the hex grid with cell radius R = 1 (hexGeometry.hexCenter
 * at radius 1, absolute "x_y" coordinates). Everything here (points, stroke
 * widths, dashes, lane gaps, end dots) is in those units, so a polyline is
 * the same at every zoom and in every export; only the final affine differs
 * (screen: lattice → em, measured once per grid; PNG: × the export's R).
 *
 * Nothing here reads the DOM, the zoom or a path's name.
 */

import type { HexKey, PathType } from "../types";
import type { ResolvedBranch } from "./resolve";
import { computeLaneOffsets, hexCenter, offsetPolyline } from "../hex-map/hexGeometry";

export type Pt = { cx: number; cy: number };

/** The map's hex radius on screen at zoom 1, px (2.2em at 16px). Path type
 *  widths are in screen px at that size, so width / this = lattice units. */
export const SCREEN_HEX_RADIUS = 35.2;

/** Ties in geometry compare within this (exact lattice coords + float noise). */
export const GEOM_EPS = 1e-9;

export interface LatticeGrid {
  orientation: "flat" | "pointy";
  stagger: "odd" | "even";
}

/** px at the default zoom → lattice units. */
export function pxToLattice(px: number): number {
  return px / SCREEN_HEX_RADIUS;
}

const parseKey = (key: HexKey): [number, number] => {
  const i = key.indexOf("_");
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
};

/** Centre of hex `key` on the lattice (cell radius 1, absolute coordinates). */
export function latticeCenter(key: HexKey, grid: LatticeGrid): Pt {
  const [x, y] = parseKey(key);
  return hexCenter(x, y, grid.orientation, 1, grid.stagger);
}

/** Where two touching hexes share an edge. */
const mid = (a: Pt, b: Pt): Pt => ({ cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 });

// ── Drawing styles ───────────────────────────────────────────────────────────

/** "through": hex centres. */
export function throughPoints(hexes: readonly HexKey[], grid: LatticeGrid): Pt[] {
  return hexes.map((k) => latticeCenter(k, grid));
}

/** "meander": edge midpoints (curved by the smooth path); centres below 3 hexes. */
export function meanderPoints(hexes: readonly HexKey[], grid: LatticeGrid): Pt[] {
  const c = throughPoints(hexes, grid);
  if (c.length < 3) return c;
  const pts: Pt[] = [];
  for (let i = 0; i < c.length - 1; i++) pts.push(mid(c[i], c[i + 1]));
  return pts;
}

/** Angle of vertex 0: flat-top 0°, pointy-top 30°. Vertices go clockwise (y down). */
const vStartOf = (isFlat: boolean) => (isFlat ? 0 : Math.PI / 6);

function hexVertices(c: Pt, isFlat: boolean, r: number): Pt[] {
  const v0 = vStartOf(isFlat);
  return Array.from({ length: 6 }, (_, i) => ({
    cx: c.cx + r * Math.cos(v0 + (i * Math.PI) / 3),
    cy: c.cy + r * Math.sin(v0 + (i * Math.PI) / 3),
  }));
}

/** Shorter arc of vertex indices on the 6-cycle, both ends included (cw on a tie). */
function shortArc(from: number, to: number): number[] {
  if (from === to) return [from];
  const cw = (to - from + 6) % 6;
  const ccw = (from - to + 6) % 6;
  const out: number[] = [];
  if (cw <= ccw) for (let k = 0; k <= cw; k++) out.push((from + k) % 6);
  else for (let k = 0; k <= ccw; k++) out.push((from - k + 6) % 6);
  return out;
}

/**
 * "edge": along the hex outlines, from centre to centre. `centers` are
 * consecutive neighbours; `r` is the CELL radius (on the lattice 1, so the
 * outline runs down the middle of the gap between hexes and two
 * neighbours' vertices coincide). Ties (equal turn cost, equal distance)
 * compare within GEOM_EPS and the lower index wins, so the same chain gives
 * the same outline at every scale.
 */
export function edgePointsFromCenters(centers: readonly Pt[], isFlat: boolean, r: number): Pt[] {
  if (centers.length < 2) return [...centers];
  const n = centers.length;
  const TAU = 2 * Math.PI;
  const v0 = vStartOf(isFlat);
  const eps = GEOM_EPS * Math.max(1, r * r);

  // Edge of centers[i]'s hex facing centers[i+1] (edge i spans vertex i → i+1).
  const snapEdge = (theta: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 6; i++) {
      const m = v0 + (i + 0.5) * (Math.PI / 3);
      let d = (((theta - m) % TAU) + TAU) % TAU;
      if (d > Math.PI) d = TAU - d;
      if (d < bestD - GEOM_EPS) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const edgeIdx = centers.slice(0, -1).map((A, i) => {
    const B = centers[i + 1];
    return snapEdge(Math.atan2(B.cy - A.cy, B.cx - A.cx));
  });

  // Which of the two shared vertices each edge crossing uses: least turn
  // (look-ahead one edge); the last edge takes the vertex nearer the line so far.
  const choice: number[] = new Array<number>(n - 1).fill(0);
  let prev: Pt = centers[0];
  for (let i = 0; i < n - 1; i++) {
    const vA = hexVertices(centers[i], isFlat, r);
    const Va = vA[edgeIdx[i]];
    const Vb = vA[(edgeIdx[i] + 1) % 6];
    if (i < n - 2) {
      const vB = hexVertices(centers[i + 1], isFlat, r);
      const VaN = vB[edgeIdx[i + 1]];
      const VbN = vB[(edgeIdx[i + 1] + 1) % 6];
      const cost = (v: Pt, vn: Pt) =>
        Math.abs((v.cx - prev.cx) * (vn.cy - v.cy) - (v.cy - prev.cy) * (vn.cx - v.cx));
      let bestCost = Infinity;
      let bestC = 0;
      for (const [v, ci] of [[Va, 0], [Vb, 1]] as [Pt, number][]) {
        for (const vn of [VaN, VbN]) {
          const co = cost(v, vn);
          if (co < bestCost - eps) {
            bestCost = co;
            bestC = ci;
          }
        }
      }
      choice[i] = bestC;
      prev = vA[(edgeIdx[i] + bestC) % 6];
    } else {
      const dA = (Va.cx - prev.cx) ** 2 + (Va.cy - prev.cy) ** 2;
      const dB = (Vb.cx - prev.cx) ** 2 + (Vb.cy - prev.cy) ** 2;
      choice[i] = dA <= dB + eps ? 0 : 1;
    }
  }

  // Each inner hex: the shorter arc of its outline from the entry vertex to
  // the exit vertex. The entry vertex on hex k matching vertex
  // (edgeIdx + choice) of hex k-1 is (edgeIdx + 4 - choice) % 6.
  const result: Pt[] = [centers[0]];
  for (let k = 0; k < n; k++) {
    const verts = hexVertices(centers[k], isFlat, r);
    if (k === 0) {
      result.push(verts[(edgeIdx[0] + choice[0]) % 6]);
    } else if (k === n - 1) {
      result.push(verts[(edgeIdx[n - 2] + 4 - choice[n - 2]) % 6]);
      result.push(centers[k]);
    } else {
      const entry = (edgeIdx[k - 1] + 4 - choice[k - 1]) % 6;
      const exit = (edgeIdx[k] + choice[k]) % 6;
      const arc = shortArc(entry, exit);
      for (let j = 1; j < arc.length; j++) result.push(verts[arc[j]]);
    }
  }
  return result;
}

/** "edge" on the lattice. */
export function edgePoints(hexes: readonly HexKey[], grid: LatticeGrid): Pt[] {
  return edgePointsFromCenters(throughPoints(hexes, grid), grid.orientation === "flat", 1);
}

export type PathRouting = PathType["routing"];

/** One chain's polyline in a drawing style (lattice units). */
export function chainPoints(hexes: readonly HexKey[], routing: PathRouting, grid: LatticeGrid): Pt[] {
  if (routing === "meander") return meanderPoints(hexes, grid);
  if (routing === "edge") return edgePoints(hexes, grid);
  return throughPoints(hexes, grid);
}

/** Smooth (curved through the points) or sharp, per drawing style. */
export function isSmooth(routing: PathRouting): boolean {
  return routing !== "edge";
}

// ── Forks and joins ──────────────────────────────────────────────────────────

const near = (a: Pt, b: Pt, tol = 1e-6) => Math.abs(a.cx - b.cx) <= tol && Math.abs(a.cy - b.cy) <= tol;

/**
 * Where a branch that starts on another branch of its path (a fork) begins,
 * so it leaves the parent's line instead of floating beside it:
 * - through: the fork hex's centre (already shared, nothing to do);
 * - meander: the midpoint between the fork hex and the parent's neighbour
 *   (in the parent chain) whose direction is closest to the fork's first
 *   step: a Y-shaped split;
 * - edge: the vertex of the fork hex on the parent's outline nearest the
 *   fork's own exit vertex, then round the fork hex's outline to it.
 *
 * Returns the fork's points with its start adjusted (a new array), or the
 * points unchanged. `parentIdx` is the fork hex's index in `parentHexes`.
 */
export function joinForkStart(
  forkPts: readonly Pt[],
  forkHexes: readonly HexKey[],
  parentHexes: readonly HexKey[],
  parentIdx: number,
  parentPts: readonly Pt[],
  routing: PathRouting,
  grid: LatticeGrid,
): Pt[] {
  if (forkHexes.length < 2 || forkPts.length < 1) return [...forkPts];
  if (routing === "meander") {
    if (parentHexes.length < 3) return [...forkPts]; // parent drawn through centres
    const c0 = latticeCenter(forkHexes[0], grid);
    const c1 = latticeCenter(forkHexes[1], grid);
    const sx = c1.cx - c0.cx;
    const sy = c1.cy - c0.cy;
    let best: Pt | null = null;
    let bestDot = -Infinity;
    for (const j of [parentIdx - 1, parentIdx + 1]) {
      if (j < 0 || j >= parentHexes.length) continue;
      const c = latticeCenter(parentHexes[j], grid);
      const dx = c.cx - c0.cx;
      const dy = c.cy - c0.cy;
      const len = Math.hypot(dx, dy) || 1;
      const dot = (dx * sx + dy * sy) / len;
      if (dot > bestDot + GEOM_EPS) {
        bestDot = dot;
        best = c;
      }
    }
    return best ? [mid(c0, best), ...forkPts] : [...forkPts];
  }
  if (routing === "edge") {
    const isFlat = grid.orientation === "flat";
    const c0 = latticeCenter(forkHexes[0], grid);
    if (parentPts.some((p) => near(p, c0))) return [...forkPts]; // parent ends here
    if (forkPts.length < 2) return [...forkPts];
    const exit = forkPts[1];
    let best: Pt | null = null;
    let bestD = Infinity;
    for (const p of parentPts) {
      if (Math.abs(Math.hypot(p.cx - c0.cx, p.cy - c0.cy) - 1) > 1e-6) continue;
      const d = (p.cx - exit.cx) ** 2 + (p.cy - exit.cy) ** 2;
      if (d < bestD - GEOM_EPS) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return [...forkPts];
    const v0 = vStartOf(isFlat);
    const idxOf = (p: Pt) => {
      const a = Math.atan2(p.cy - c0.cy, p.cx - c0.cx) - v0;
      return ((Math.round(a / (Math.PI / 3)) % 6) + 6) % 6;
    };
    const verts = hexVertices(c0, isFlat, 1);
    const arc = shortArc(idxOf(best), idxOf(exit));
    return [...arc.slice(0, -1).map((i) => verts[i]), ...forkPts.slice(1)];
  }
  return [...forkPts];
}

// ── Strokes ──────────────────────────────────────────────────────────────────

/** Stroke dash patterns in px at the default zoom (as the map always drew them). */
const DASH_PX: Record<string, number[]> = { dashed: [8, 4], dotted: [2, 4] };

/** The end dot of the path being drawn: radius and outline, px at the default zoom. */
export const END_DOT_PX = { r: 5, stroke: 1.5 };

/** The path tool's anchor handles on the selected path: radius (ends bigger) and outline, px at the default zoom. */
export const HANDLE_PX = { r: 4, end: 6, stroke: 1.5 };

export interface PathStroke {
  /** MapPath.name and branch index (data-path / data-branch on screen). */
  path: string;
  branch: number;
  typeName: string;
  /** Lattice units; lane offset applied. */
  pts: Pt[];
  smooth: boolean;
  color: string;
  /** Stroke width, lattice units. */
  width: number;
  /** Dash pattern, lattice units ([] = solid). */
  dash: number[];
}

export interface StrokeOptions {
  /** For a type not in the palette (drawn plain grey under its own name). */
  unknownType: PathType;
  /**
   * The hex just across the seam (in this map's frame) where a branch end
   * meets a neighbour's path of the same type, if any: that end is drawn on
   * to the shared edge (round 6 U8). Not for the edge style.
   */
  seamEnd?: (typeName: string, hex: HexKey) => HexKey | undefined;
  /** Multiplies lane gaps (an export drawn bolder keeps lanes apart). Default 1. */
  laneScale?: number;
}

/**
 * Resolved branches → strokes, in draw order: the palette's type order,
 * then types not in the palette (first seen first); within a type, the
 * resolver's order. Lanes (computeLaneOffsets) separate different types
 * sharing a route; same-type branches share a lane and merge.
 */
export function buildPathStrokes(
  resolved: readonly ResolvedBranch[],
  types: readonly PathType[],
  grid: LatticeGrid,
  opts: StrokeOptions,
): PathStroke[] {
  const typeByName = new Map<string, PathType>();
  for (const t of types) if (!typeByName.has(t.name)) typeByName.set(t.name, t);
  const order: { rb: ResolvedBranch; pt: PathType }[] = [];
  for (const t of typeByName.values()) {
    for (const rb of resolved) if (rb.typeName === t.name) order.push({ rb, pt: t });
  }
  const unknown: string[] = [];
  for (const rb of resolved) if (!typeByName.has(rb.typeName) && !unknown.includes(rb.typeName)) unknown.push(rb.typeName);
  for (const name of unknown) {
    for (const rb of resolved) if (rb.typeName === name) order.push({ rb, pt: { ...opts.unknownType, name } });
  }

  const lanes = computeLaneOffsets(order.map(({ rb, pt }) => ({ hexes: rb.hexes, width: pt.width, typeName: pt.name })));
  const laneScale = opts.laneScale ?? 1;

  // Each branch's own polyline first (forks need their parent's).
  const own = order.map(({ rb, pt }) => chainPoints(rb.hexes, pt.routing, grid));
  const indexOf = new Map<string, number>();
  order.forEach(({ rb }, i) => indexOf.set(`${rb.path}\u0000${rb.branch}`, i));
  const parentOf = (rb: ResolvedBranch, branch: number) => indexOf.get(`${rb.path}\u0000${branch}`);

  const out: PathStroke[] = [];
  order.forEach(({ rb, pt }, i) => {
    let pts = own[i];
    if (rb.forkFrom) {
      const p = parentOf(rb, rb.forkFrom.branch);
      if (p !== undefined) pts = joinForkStart(pts, rb.hexes, order[p].rb.hexes, rb.forkFrom.hexIdx, own[p], pt.routing, grid);
    }
    if (rb.joinTo) {
      const p = parentOf(rb, rb.joinTo.branch);
      if (p !== undefined) {
        pts = joinForkStart([...pts].reverse(), [...rb.hexes].reverse(), order[p].rb.hexes, rb.joinTo.hexIdx, own[p], pt.routing, grid).reverse();
      }
    }
    if (pt.routing !== "edge" && opts.seamEnd && pts.length >= 1) {
      const head = rb.forkFrom ? undefined : opts.seamEnd(pt.name, rb.hexes[0]);
      const last = rb.hexes[rb.hexes.length - 1];
      const tail = rb.hexes.length > 1 && !rb.joinTo ? opts.seamEnd(pt.name, last) : undefined;
      if (head) pts = [mid(latticeCenter(rb.hexes[0], grid), latticeCenter(head, grid)), ...pts];
      if (tail) pts = [...pts, mid(latticeCenter(last, grid), latticeCenter(tail, grid))];
    }
    if (pts.length < 2) return;
    pts = offsetPolyline(pts, pxToLattice(lanes[i]) * laneScale);
    out.push({
      path: rb.path,
      branch: rb.branch,
      typeName: pt.name,
      pts,
      smooth: isSmooth(pt.routing),
      color: pt.color,
      width: pxToLattice(pt.width),
      dash: (DASH_PX[pt.lineStyle] ?? []).map(pxToLattice),
    });
  });
  return out;
}

// ── Affine (lattice → screen / export) ───────────────────────────────────────

/** An axis-aligned affine: X = tx + x·sx, Y = ty + y·sy. */
export interface LatticeAffine {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export function applyAffine(pts: readonly Pt[], a: LatticeAffine): Pt[] {
  return pts.map((p) => ({ cx: a.tx + p.cx * a.sx, cy: a.ty + p.cy * a.sy }));
}

/**
 * The affine mapping lattice centres onto measured centres: the origin hex
 * `o`, its right neighbour (x+1, same y) and the hex below (same x, y+1).
 * Either neighbour may be missing (a one-column or one-row grid): its scale
 * is then the other one's, else `fallback`.
 */
export function calibrateAffine(
  origin: { key: HexKey; at: { x: number; y: number } },
  right: { key: HexKey; at: { x: number; y: number } } | null,
  below: { key: HexKey; at: { x: number; y: number } } | null,
  grid: LatticeGrid,
  fallback: number,
): LatticeAffine {
  const lo = latticeCenter(origin.key, grid);
  let sx = 0;
  let sy = 0;
  if (right) {
    const lr = latticeCenter(right.key, grid);
    if (Math.abs(lr.cx - lo.cx) > GEOM_EPS) sx = (right.at.x - origin.at.x) / (lr.cx - lo.cx);
  }
  if (below) {
    const lb = latticeCenter(below.key, grid);
    if (Math.abs(lb.cy - lo.cy) > GEOM_EPS) sy = (below.at.y - origin.at.y) / (lb.cy - lo.cy);
  }
  if (!sx) sx = sy || fallback;
  if (!sy) sy = sx;
  return { sx, sy, tx: origin.at.x - lo.cx * sx, ty: origin.at.y - lo.cy * sy };
}

/** Round for SVG output: fixed decimals keep `d` stable and short. */
export function fmt(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
}

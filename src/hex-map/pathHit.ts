/**
 * The path tool's hit test (plan-path-anchors section 4): what's under a
 * pointer in lattice units, anchor handles first, then path lines. Pure
 * math on the same polylines the map draws (tests/pathTool.test.ts).
 */

import type { HexKey } from "../types";
import { latticeCenter, type LatticeGrid, type PathStroke, type Pt } from "../paths/pathGeometry";
import type { ResolvedBranch } from "../paths/resolve";

/** Anchor handle radius, lattice units (a hex's centre-to-corner is 1). */
export const HANDLE_R = 0.24;
/** End handles ("+": continue from here) are drawn a little bigger. */
export const END_HANDLE_R = 0.32;
/** Slack added to half the stroke width when hitting a line (lattice units). */
export const LINE_SLACK = 0.25;

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.cx - a.cx) * dx + (p.cy - a.cy) * dy) / len2)) : 0;
  return Math.hypot(p.cx - (a.cx + t * dx), p.cy - (a.cy + t * dy));
}

export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(p.cx - pts[0].cx, p.cy - pts[0].cy);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** Index of the hex of `hexes` whose centre is nearest `p` (ties: the lower index). */
export function nearestHexIdx(p: Pt, hexes: readonly HexKey[], grid: LatticeGrid): number {
  let best = -1;
  let bestD = Infinity;
  hexes.forEach((h, i) => {
    const c = latticeCenter(h, grid);
    const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Which end of its branch an anchor is: head (first, not a fork's start), tail (last), or neither. */
export function anchorEnd(rb: Pick<ResolvedBranch, "anchorIdx" | "forkFrom">, anchor: number): "head" | "tail" | null {
  const n = rb.anchorIdx.length;
  if (n > 1 && anchor === n - 1) return "tail";
  if (anchor === 0 && !rb.forkFrom) return n > 1 ? "head" : "tail";
  return null;
}

export interface PathHit {
  path: string;
  branch: number;
  /** The branch's routed hex nearest the pointer (the anchor's own hex when `anchor` is set). */
  hexIdx: number;
  /** That routed hex. */
  hex: HexKey;
  /** The anchor whose handle is under the pointer (editable paths only), else null. */
  anchor: number | null;
  /** When `anchor` is a branch end. */
  end: "head" | "tail" | null;
  /** The path is of the tool's type (it can be reshaped); false: another type's, inert. */
  editable: boolean;
}

/**
 * What's under lattice point `p`. Anchor handles of every editable path
 * (`editable(name)`; all paths when null) come first, the nearest within
 * its radius; else the nearest path line within half its stroke plus
 * LINE_SLACK. Where lines overlap, an editable path beats an inert one and
 * the selected path beats the rest. Inert paths are still reported (for
 * the "switch to … to edit it" hint) with `editable: false`. Null when
 * nothing is under the pointer.
 */
export function hitTestPaths(
  p: Pt,
  strokes: readonly PathStroke[],
  resolved: readonly ResolvedBranch[],
  grid: LatticeGrid,
  selected: string | null,
  editable: ((path: string) => boolean) | null = null,
): PathHit | null {
  const canEdit = (path: string) => editable === null || editable(path);
  let best: PathHit | null = null;
  let bestD = Infinity;
  let bestSel = false;
  for (const rb of resolved) {
    if (!canEdit(rb.path)) continue;
    const sel = rb.path === selected;
    rb.anchorIdx.forEach((hexIdx, a) => {
      const end = anchorEnd(rb, a);
      const c = latticeCenter(rb.hexes[hexIdx], grid);
      const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
      if (d > (end ? END_HANDLE_R : HANDLE_R)) return;
      // Stacked handles (paths sharing a hex): the selected path's first, then the nearest.
      if ((sel && !bestSel) || (sel === bestSel && d < bestD - 1e-9)) {
        bestD = d;
        bestSel = sel;
        best = { path: rb.path, branch: rb.branch, hexIdx, hex: rb.hexes[hexIdx], anchor: a, end, editable: true };
      }
    });
  }
  if (best) return best;
  let pick: PathStroke | null = null;
  let pickD = Infinity;
  let pickRank = -1;
  for (const s of strokes) {
    const d = distToPolyline(p, s.pts);
    if (d > s.width / 2 + LINE_SLACK) continue;
    const rank = (canEdit(s.path) ? 2 : 0) + (s.path === selected ? 1 : 0);
    if (rank > pickRank || (rank === pickRank && d < pickD - 1e-9)) {
      pick = s;
      pickD = d;
      pickRank = rank;
    }
  }
  if (!pick) return null;
  const rb = resolved.find((r) => r.path === pick.path && r.branch === pick.branch);
  if (!rb) return null;
  const hexIdx = nearestHexIdx(p, rb.hexes, grid);
  return { path: rb.path, branch: rb.branch, hexIdx, hex: rb.hexes[hexIdx], anchor: null, end: null, editable: canEdit(rb.path) };
}

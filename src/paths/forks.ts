/**
 * Keeping forks attached to the branch they leave (owner decision
 * 2026-10-11). A fork is a branch whose first anchor lies on another
 * branch's route (a join: whose last anchor does); nothing else ties them.
 * So when an edit changes one branch's route, the branches attached to it
 * have to follow, or they're left hanging beside it:
 *
 * - keepForksAttached: a branch's route changed (an anchor moved, added or
 *   deleted). Forks and joins that were on its old route and aren't on the
 *   new one move: onto the moved anchor's new hex when they sat on that
 *   anchor, else onto the nearest hex of the new route.
 * - splitOffOrphans: a branch was removed. Forks that hung off it (and
 *   their own forks) become paths of their own; when the main line went
 *   and nothing else is left, the first of them keeps the path's name.
 *
 * Pure, no Obsidian imports. The caller commits the result as one step.
 */

import type { HexKey, MapPath, PathBranch } from "../types";
import { latticeCenter, type LatticeGrid } from "./pathGeometry";
import { uniquePathName } from "./names";

function cloneBranch(b: PathBranch): PathBranch {
  const out: PathBranch = { anchors: [...b.anchors] };
  if (b.label !== undefined) out.label = b.label;
  if (b.extra) out.extra = { ...b.extra };
  return out;
}

/** The hex of `route` nearest `hex` (first on ties). */
export function nearestOnRoute(hex: HexKey, route: readonly HexKey[], grid: LatticeGrid): HexKey | null {
  const p = latticeCenter(hex, grid);
  let best: HexKey | null = null;
  let bestD = Infinity;
  for (const k of route) {
    const c = latticeCenter(k, grid);
    const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Branch `branch` of `p` was re-routed from `oldRoute` to `newRoute` (p is
 * the path after the edit; branch indices unchanged). Every other branch
 * whose first anchor (fork) or last anchor (join) was on the old route but
 * isn't on the new one is moved back onto it: to `moved.to` when it sat on
 * `moved.from` (the dragged anchor), else to the nearest hex of the new
 * route. An end that lands on its neighbour anchor merges with it; a branch
 * left with fewer than two anchors is dropped. Returns `p` itself when
 * nothing had to move.
 */
export function keepForksAttached(
  p: MapPath,
  branch: number,
  oldRoute: readonly HexKey[],
  newRoute: readonly HexKey[],
  grid: LatticeGrid,
  moved?: { from: HexKey; to: HexKey },
): MapPath {
  if (!newRoute.length) return p;
  const was = new Set(oldRoute);
  const now = new Set(newRoute);
  const target = (hex: HexKey): HexKey | null => {
    if (moved && hex === moved.from) return moved.to;
    if (!was.has(hex) || now.has(hex)) return null;
    return nearestOnRoute(hex, newRoute, grid);
  };
  let changed = false;
  const branches: PathBranch[] = [];
  p.branches.forEach((b, i) => {
    if (i === branch || b.anchors.length < 2) {
      branches.push(b);
      return;
    }
    const a = [...b.anchors];
    const head = target(a[0]);
    const tail = target(a[a.length - 1]);
    if (head === null && tail === null) {
      branches.push(b);
      return;
    }
    changed = true;
    if (head !== null) {
      a[0] = head;
      if (a[1] === head) a.splice(1, 1);
    }
    if (tail !== null) {
      a[a.length - 1] = tail;
      if (a.length > 1 && a[a.length - 2] === tail) a.splice(a.length - 2, 1);
    }
    if (a.length < 2) return; // nothing left of it
    branches.push({ ...cloneBranch(b), anchors: a });
  });
  if (!changed) return p;
  const out: MapPath = { name: p.name, typeName: p.typeName, branches };
  if (p.notes !== undefined) out.notes = p.notes;
  if (p.extra) out.extra = { ...p.extra };
  return out;
}

/**
 * Branch `removed` of `before` is being deleted (`routes[i]` = branch i's
 * route before the edit). The branches that hung off it, and anything
 * hanging off those, can't stay in the path detached: each such group
 * becomes a path of its own (new names from `taken`), its root first so
 * it's the new main line. When nothing but such groups is left, the first
 * group keeps the path (its name, notes and extra columns). Returns the
 * path that's left (null when none) and the new paths.
 */
export function splitOffOrphans(
  before: MapPath,
  removed: number,
  routes: readonly (readonly HexKey[])[],
  taken: Iterable<string>,
): { path: MapPath | null; split: MapPath[] } {
  const n = before.branches.length;
  const onRoute = (hex: HexKey, j: number) => (routes[j] ?? before.branches[j].anchors).includes(hex);
  // Each branch's parent: the first other surviving branch its start is on.
  // Branches whose start was only on the removed branch are orphan roots.
  const parent: (number | null)[] = [];
  const root: boolean[] = [];
  for (let i = 0; i < n; i++) {
    parent.push(null);
    root.push(false);
    if (i === removed || i === 0) continue;
    const start = before.branches[i].anchors[0];
    let p: number | null = null;
    for (let j = 0; j < n && p === null; j++) if (j !== i && j !== removed && onRoute(start, j)) p = j;
    parent[i] = p;
    root[i] = p === null && onRoute(start, removed);
  }
  // Groups: each root and its descendants (by parent chain, in index order).
  const groupOf = (i: number): number | null => {
    const seen = new Set<number>();
    let k: number | null = i;
    while (k !== null && !seen.has(k)) {
      if (root[k]) return k;
      seen.add(k);
      k = parent[k];
    }
    return null;
  };
  const groups = new Map<number, number[]>();
  const stay: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === removed) continue;
    const g = groupOf(i);
    if (g === null) stay.push(i);
    else groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  // Roots first within their group (index order otherwise).
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([g, members]) => [g, ...members.filter((m) => m !== g)]);
  const branchesOf = (idx: number[]) => idx.map((i) => cloneBranch(before.branches[i]));
  const names = [...taken];
  const fresh = (idx: number[]): MapPath => {
    const name = uniquePathName(before.typeName, names);
    names.push(name);
    return { name, typeName: before.typeName, branches: branchesOf(idx) };
  };
  let path: MapPath | null = null;
  if (stay.length) path = { name: before.name, typeName: before.typeName, branches: branchesOf(stay) };
  else if (ordered.length) path = { name: before.name, typeName: before.typeName, branches: branchesOf(ordered.shift()!) };
  if (path) {
    if (before.notes !== undefined) path.notes = before.notes;
    if (before.extra) path.extra = { ...before.extra };
  }
  return { path, split: ordered.map(fresh) };
}

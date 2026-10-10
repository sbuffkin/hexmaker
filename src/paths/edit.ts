/**
 * Edit operations on anchored paths. Pure: every op returns a new MapPath
 * (or list) and never mutates its input, so an undo step is just the
 * before/after values. Ops that would leave a path with no branches return
 * null (the caller removes the path). Pure, no Obsidian imports.
 *
 * Ops that must not move the line (split, reverse, pin) re-anchor the
 * affected hexes with anchorsFor, so the routed hexes stay exactly the same.
 */

import type { HexKey, MapPath, PathBranch } from "../types";
import type { RouteContext, SegmentRoute } from "./router";
import type { SegmentRouter } from "./routeCache";
import { anchorsFor, type RouteFn } from "./fromHexes";
import { styleOf, type ResolvedBranch, type StyleFor } from "./resolve";
import { uniquePathName } from "./names";

export { uniquePathName, pathNameKey } from "./names";

type Grid = Pick<RouteContext, "orientation" | "stagger">;
/** What the ops need of a resolved branch. */
export type BranchRoute = Pick<ResolvedBranch, "branch" | "hexes" | "anchorIdx">;

function cloneBranch(b: PathBranch): PathBranch {
  const out: PathBranch = { anchors: [...b.anchors] };
  if (b.label !== undefined) out.label = b.label;
  if (b.extra) out.extra = { ...b.extra };
  return out;
}

/** A deep copy (anchors, branches and extra columns). */
export function clonePath(p: MapPath): MapPath {
  const out: MapPath = { name: p.name, typeName: p.typeName, branches: p.branches.map(cloneBranch) };
  if (p.notes !== undefined) out.notes = p.notes;
  if (p.extra) out.extra = { ...p.extra };
  return out;
}

export function clonePaths(ps: readonly MapPath[]): MapPath[] {
  return ps.map(clonePath);
}

function checkBranch(p: MapPath, branch: number): void {
  if (!Number.isInteger(branch) || branch < 0 || branch >= p.branches.length) {
    throw new RangeError(`path "${p.name}" has no branch ${branch}`);
  }
}

function checkAnchor(p: MapPath, branch: number, anchor: number): void {
  checkBranch(p, branch);
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= p.branches[branch].anchors.length) {
    throw new RangeError(`branch ${branch} of "${p.name}" has no anchor ${anchor}`);
  }
}

/** `p` with branch `branch` replaced by `make(copy of it)`. */
function withBranch(p: MapPath, branch: number, make: (b: PathBranch) => PathBranch): MapPath {
  checkBranch(p, branch);
  const out = clonePath(p);
  out.branches[branch] = make(out.branches[branch]);
  return out;
}

/** A new path of `typeName` with one anchor, named `<Type>`, `<Type> 2`… unique against `taken`. */
export function newPath(typeName: string, hex: HexKey, taken: Iterable<string>): MapPath {
  return { name: uniquePathName(typeName, taken), typeName, branches: [{ anchors: [hex] }] };
}

/** Add an anchor at the end of a branch (no-op when it's already the last one). */
export function appendAnchor(p: MapPath, branch: number, hex: HexKey): MapPath {
  checkBranch(p, branch);
  const a = p.branches[branch].anchors;
  if (a[a.length - 1] === hex) return p;
  return withBranch(p, branch, (b) => ({ ...b, anchors: [...b.anchors, hex] }));
}

/** Add an anchor at the start of a branch (no-op when it's already the first one). */
export function prependAnchor(p: MapPath, branch: number, hex: HexKey): MapPath {
  checkBranch(p, branch);
  if (p.branches[branch].anchors[0] === hex) return p;
  return withBranch(p, branch, (b) => ({ ...b, anchors: [hex, ...b.anchors] }));
}

/** Start a fork: a new branch whose first anchor is `hex` (a hex on the path). */
export function forkAt(p: MapPath, hex: HexKey, label?: string): { path: MapPath; branch: number } {
  const out = clonePath(p);
  const b: PathBranch = { anchors: [hex] };
  if (label !== undefined) b.label = label;
  out.branches.push(b);
  return { path: out, branch: out.branches.length - 1 };
}

/**
 * Make the routed hex `hexIdx` of a branch an anchor (the start of a drag on
 * the line): inserted between the anchors around it. When that hex already
 * is an anchor, nothing changes and its index is returned.
 */
export function insertAnchorAt(p: MapPath, route: BranchRoute, hexIdx: number): { path: MapPath; anchor: number; inserted: boolean } {
  checkBranch(p, route.branch);
  if (!Number.isInteger(hexIdx) || hexIdx < 0 || hexIdx >= route.hexes.length) {
    throw new RangeError(`hex index ${hexIdx} is not on branch ${route.branch} of "${p.name}"`);
  }
  let k = 0;
  for (let i = 0; i < route.anchorIdx.length; i++) if (route.anchorIdx[i] <= hexIdx) k = i;
  if (route.anchorIdx[k] === hexIdx) return { path: p, anchor: k, inserted: false };
  const hex = route.hexes[hexIdx];
  const path = withBranch(p, route.branch, (b) => {
    const anchors = [...b.anchors];
    anchors.splice(k + 1, 0, hex);
    return { ...b, anchors };
  });
  return { path, anchor: k + 1, inserted: true };
}

/** Move one anchor to another hex. */
export function moveAnchor(p: MapPath, branch: number, anchor: number, hex: HexKey): MapPath {
  checkAnchor(p, branch, anchor);
  if (p.branches[branch].anchors[anchor] === hex) return p;
  return withBranch(p, branch, (b) => {
    const anchors = [...b.anchors];
    anchors[anchor] = hex;
    return { ...b, anchors };
  });
}

/** Remove a branch; null when it was the path's last one. */
export function deleteBranch(p: MapPath, branch: number): MapPath | null {
  checkBranch(p, branch);
  if (p.branches.length === 1) return null;
  const out = clonePath(p);
  out.branches.splice(branch, 1);
  return out;
}

/**
 * Remove an anchor: its two segments become one route. A branch left with
 * fewer than two anchors is removed; null when that was the path's last.
 */
export function deleteAnchor(p: MapPath, branch: number, anchor: number): MapPath | null {
  checkAnchor(p, branch, anchor);
  const anchors = p.branches[branch].anchors.filter((_, i) => i !== anchor);
  if (anchors.length < 2) return deleteBranch(p, branch);
  return withBranch(p, branch, (b) => ({ ...b, anchors }));
}

/**
 * Erase routed hex `hexIdx` from a branch: its two steps go, and the pieces
 * on either side stay branches of the path (the first in place, the second
 * right after it), each keeping its anchors plus just enough new ones that
 * nothing else moves. Pieces of fewer than two hexes vanish; null when
 * nothing is left of the path.
 */
export function splitBranchAt(p: MapPath, route: BranchRoute, hexIdx: number, routeFn: RouteFn, grid?: Grid): MapPath | null {
  checkBranch(p, route.branch);
  const { hexes, anchorIdx } = route;
  if (!Number.isInteger(hexIdx) || hexIdx < 0 || hexIdx >= hexes.length) {
    throw new RangeError(`hex index ${hexIdx} is not on branch ${route.branch} of "${p.name}"`);
  }
  const anchors = p.branches[route.branch].anchors;
  const pieces: HexKey[][] = [];
  if (hexIdx >= 2) {
    // Anchors strictly before the erased hex, then the partial segment up to it.
    let k = 0;
    for (let i = 0; i < anchorIdx.length; i++) if (anchorIdx[i] < hexIdx) k = i;
    const tail = anchorsFor(hexes.slice(anchorIdx[k], hexIdx), routeFn, grid);
    pieces.push([...anchors.slice(0, k + 1), ...tail.slice(1)]);
  }
  if (hexIdx <= hexes.length - 3) {
    let m = anchorIdx.length - 1;
    for (let i = anchorIdx.length - 1; i >= 0; i--) if (anchorIdx[i] > hexIdx) m = i;
    const head = anchorsFor(hexes.slice(hexIdx + 1, anchorIdx[m] + 1), routeFn, grid);
    pieces.push([...head.slice(0, -1), ...anchors.slice(m)]);
  }
  if (!pieces.length) return deleteBranch(p, route.branch);
  const out = clonePath(p);
  const old = out.branches[route.branch];
  const replaced: PathBranch[] = pieces.map((a, i) => (i === 0 ? { ...old, anchors: a } : { anchors: a }));
  out.branches.splice(route.branch, 1, ...replaced);
  return out;
}

/**
 * Reverse a branch without moving it: its anchors in reverse order, plus
 * whatever anchors each reversed segment needs to keep its hexes (a route
 * from b to a may tie-break differently from a to b).
 */
export function reverseBranch(p: MapPath, route: BranchRoute, routeFn: RouteFn, grid?: Grid): MapPath {
  checkBranch(p, route.branch);
  const { hexes, anchorIdx } = route;
  const out: HexKey[] = [];
  for (let i = anchorIdx.length - 1; i >= 1; i--) {
    const seg = hexes.slice(anchorIdx[i - 1], anchorIdx[i] + 1).reverse();
    const a = seg.length ? anchorsFor(seg, routeFn, grid) : [];
    out.push(...(out.length ? a.slice(1) : a));
  }
  if (!out.length) out.push(...p.branches[route.branch].anchors);
  return withBranch(p, route.branch, (b) => ({ ...b, anchors: out }));
}

// ── Pinning (Decision 3: keep the old route) ─────────────────────────────────

/** A segment's route for a path type: (typeName, a, b) → route. */
export type SegmentFn = (typeName: string, a: HexKey, b: HexKey) => SegmentRoute;

/** A SegmentFn from a router (e.g. a RouteCache or its previous()) and the types' styles. */
export function segmentFn(router: SegmentRouter, styleFor?: StyleFor): SegmentFn {
  return (typeName, a, b) => router.route(a, b, styleOf(styleFor, typeName));
}

const sameHexes = (x: readonly HexKey[], y: readonly HexKey[]) => x.length === y.length && x.every((k, i) => k === y[i]);

/**
 * Before a context change (terrain or palette impassability, a resize, a
 * type's avoid/winding style) takes effect: every segment whose route would
 * change gets just enough extra anchors that the new routing reproduces its
 * old hexes. Paths with nothing to pin are returned as the same objects.
 * `pinned` lists each changed path and how many anchors it gained (for the
 * "Kept the route of …" notice; dropping those anchors is "Reroute instead").
 */
export function pinChanged(
  paths: readonly MapPath[],
  oldSeg: SegmentFn,
  newSeg: SegmentFn,
  grid?: Grid,
): { paths: MapPath[]; pinned: { path: string; added: number }[] } {
  const pinned: { path: string; added: number }[] = [];
  const out = paths.map((p) => {
    let added = 0;
    const branches = p.branches.map((b) => {
      const anchors: HexKey[] = b.anchors.length ? [b.anchors[0]] : [];
      for (let i = 1; i < b.anchors.length; i++) {
        const a = b.anchors[i - 1];
        const c = b.anchors[i];
        const before = oldSeg(p.typeName, a, c).hexes;
        if (!sameHexes(before, newSeg(p.typeName, a, c).hexes)) {
          const inner = anchorsFor(before, (x, y) => newSeg(p.typeName, x, y), grid).slice(1, -1);
          anchors.push(...inner);
          added += inner.length;
        }
        anchors.push(c);
      }
      return anchors;
    });
    if (!added) return p;
    pinned.push({ path: p.name, added });
    const q = clonePath(p);
    q.branches.forEach((b, i) => { b.anchors = branches[i]; });
    return q;
  });
  return { paths: out, pinned };
}

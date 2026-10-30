/**
 * Anchored paths → routed hex chains. Pure: the result depends only on the
 * paths, the map's routing context and each type's explicit style flags.
 *
 * Callers must not resolve a map's paths until its terrain AND palette are
 * loaded (otherwise `blocked` is incomplete and routes jump when it arrives).
 */

import type { HexKey, MapPath, PathChain } from "../types";
import { DEFAULT_SEGMENT_STYLE, type RouteContext, type SegmentStyle } from "./router";
import { contextRouter, RouteCache, type SegmentRouter } from "./routeCache";

/**
 * A path type's routing style, looked up by the path's typeName (a
 * reference into the palette; never interpreted). Return undefined for a
 * type that isn't in the palette (DEFAULT_SEGMENT_STYLE is used).
 *
 * WIRING POINT for the explicit PathType fields (fix/46-palettes-generators
 * PA5): the plugin's paths service / the MapStore migration hook builds this
 * from the map's palette as
 *   (name) => { const t = palette.pathTypes.find((p) => p.name === name);
 *               return t && { avoid: t.avoidImpassable, winding: <t's winding style> }; }
 * Nothing else reads avoid or winding.
 */
export type StyleFor = (typeName: string) => SegmentStyle | undefined;

export function styleOf(styleFor: StyleFor | undefined, typeName: string): SegmentStyle {
  return styleFor?.(typeName) ?? DEFAULT_SEGMENT_STYLE;
}

export interface ResolvedBranch {
  /** MapPath.name */
  path: string;
  typeName: string;
  /** Index into the path's branches. */
  branch: number;
  /** Full routed chain, anchors included, joints not duplicated. */
  hexes: HexKey[];
  /** Index into hexes of each anchor (non-decreasing). */
  anchorIdx: number[];
  /** When anchors[0] lies on another branch of the path (a fork). */
  forkFrom?: { branch: number; hexIdx: number };
  /** When the last anchor lies on another branch (a join: loops, reconnecting roads). */
  joinTo?: { branch: number; hexIdx: number };
  /** Segments (i = anchors i → i+1) drawn with the hex-line fallback. */
  fallbackSegments: number[];
}

/** One branch's anchors → its routed hexes. */
export function routeBranch(
  anchors: readonly HexKey[],
  style: SegmentStyle,
  router: SegmentRouter,
): { hexes: HexKey[]; anchorIdx: number[]; fallbackSegments: number[] } {
  const hexes: HexKey[] = [];
  const anchorIdx: number[] = [];
  const fallbackSegments: number[] = [];
  if (!anchors.length) return { hexes, anchorIdx, fallbackSegments };
  hexes.push(anchors[0]);
  anchorIdx.push(0);
  for (let i = 1; i < anchors.length; i++) {
    const seg = router.route(anchors[i - 1], anchors[i], style);
    if (seg.fallback) fallbackSegments.push(i - 1);
    for (let k = 1; k < seg.hexes.length; k++) hexes.push(seg.hexes[k]);
    anchorIdx.push(hexes.length - 1);
  }
  return { hexes, anchorIdx, fallbackSegments };
}

/** Where `hex` lies on another branch (lowest branch, then first index), if anywhere. */
function onOtherBranch(hex: HexKey, self: number, chains: readonly HexKey[][]): { branch: number; hexIdx: number } | undefined {
  for (let b = 0; b < chains.length; b++) {
    if (b === self) continue;
    const i = chains[b].indexOf(hex);
    if (i >= 0) return { branch: b, hexIdx: i };
  }
  return undefined;
}

/** One path's branches, resolved. Empty branches resolve to no hexes (and no entry). */
export function resolvePath(path: MapPath, router: SegmentRouter, styleFor?: StyleFor): ResolvedBranch[] {
  const style = styleOf(styleFor, path.typeName);
  const routed = path.branches.map((b) => routeBranch(b.anchors, style, router));
  const chains = routed.map((r) => r.hexes);
  const out: ResolvedBranch[] = [];
  routed.forEach((r, branch) => {
    if (!r.hexes.length) return;
    const rb: ResolvedBranch = { path: path.name, typeName: path.typeName, branch, ...r };
    const fork = onOtherBranch(r.hexes[0], branch, chains);
    if (fork) rb.forkFrom = fork;
    if (r.hexes.length > 1) {
      const join = onOtherBranch(r.hexes[r.hexes.length - 1], branch, chains);
      if (join) rb.joinTo = join;
    }
    out.push(rb);
  });
  return out;
}

/**
 * Every path's branches, resolved, in path then branch order. Pass the map's
 * RouteCache to reuse segments across calls (its context is switched to
 * `ctx`; a changed context keeps the old routes as cache.previous()).
 */
export function resolvePaths(
  paths: readonly MapPath[],
  ctx: RouteContext,
  styleFor?: StyleFor,
  cache?: RouteCache,
): ResolvedBranch[] {
  let router: SegmentRouter;
  if (cache) {
    cache.setContext(ctx);
    router = cache;
  } else {
    router = contextRouter(ctx);
  }
  return paths.flatMap((p) => resolvePath(p, router, styleFor));
}

/** The resolved branches as the old PathChain shape (for read-only consumers). */
export function resolvedToChains(resolved: readonly ResolvedBranch[]): PathChain[] {
  return resolved.map((r) => ({ typeName: r.typeName, hexes: [...r.hexes] }));
}

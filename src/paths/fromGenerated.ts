/**
 * Generated hex paths → anchored MapPaths (generators: map creation, a new
 * region next to another, regenerating a map). Pure, no Obsidian imports.
 *
 * Generators keep their own routing (terrain-cost Dijkstra, WFC paths), so
 * their hexes are not what the editor router would draw. Each generated
 * chain is turned into the fewest anchors that make the editor router
 * reproduce it exactly (fromHexes.anchorsFor) under the TARGET map's routing
 * context (its terrain, palette, bounds, orientation and stagger), which is
 * exactly what the map draws once the paths are stored.
 *
 * Chains of one type that touch end-on become one path with branches, the
 * same stroke-preserving merge the migration uses (mergeChains). Names are
 * `<Type>`, `<Type> 2`… unique against `taken`.
 *
 * A chain with a step between hexes that aren't neighbours (Star scatter's
 * jump routes link two systems) can't be reproduced hex for hex: its hexes
 * become anchors and the router fills in between (listed in `inexact`).
 */

import type { HexKey, MapPath } from "../types";
import type { RouteContext } from "./router";
import { contextRouter, type SegmentRouter } from "./routeCache";
import { routeBranch, styleOf, type StyleFor } from "./resolve";
import { anchorsFor, dedupeSteps, mergeChains, reproduces, routeFnFor } from "./fromHexes";
import { uniquePathName } from "./names";

/** A generated path already typed as a map path type. */
export interface TypedHexChain {
  typeName: string;
  hexes: readonly HexKey[];
}

export interface GeneratedToPathsOptions {
  /** The types' explicit routing style (avoid impassable, winding). */
  styleFor?: StyleFor;
  /** Names already used on the map (new names avoid them). */
  taken?: Iterable<string>;
  /** A router for `ctx` to reuse (e.g. the map's RouteCache); else an uncached one. */
  router?: SegmentRouter;
}

/**
 * Generated chains → MapPaths (see the module comment). Types come out in
 * order of first appearance; within a type, merged groups in order of their
 * first chain. Chains of fewer than two distinct hexes are dropped (they
 * draw nothing).
 */
export function generatedToMapPaths(
  chains: readonly TypedHexChain[],
  ctx: RouteContext,
  opts: GeneratedToPathsOptions = {},
): { paths: MapPath[]; inexact: string[] } {
  const router = opts.router ?? contextRouter(ctx);
  const taken = [...(opts.taken ?? [])];
  const byType = new Map<string, HexKey[][]>();
  for (const c of chains) {
    const hexes = dedupeSteps(c.hexes);
    if (hexes.length < 2) continue;
    const list = byType.get(c.typeName);
    if (list) list.push(hexes);
    else byType.set(c.typeName, [hexes]);
  }
  const paths: MapPath[] = [];
  const inexact: string[] = [];
  for (const [typeName, list] of byType) {
    const style = styleOf(opts.styleFor, typeName);
    const route = routeFnFor(router, style);
    for (const g of mergeChains(list)) {
      let exact = true;
      const branches = g.branches.map((hexes) => {
        const anchors = anchorsFor(hexes, route, ctx);
        if (reproduces(anchors, hexes, route)) return { anchors };
        exact = false;
        return { anchors: dedupeSteps(hexes) };
      });
      const name = uniquePathName(typeName, taken);
      taken.push(name);
      paths.push({ name, typeName, branches });
      if (!exact) inexact.push(name);
    }
  }
  return { paths, inexact };
}

/** The hex chains a path's branches route to under `ctx` (for checks and tests). */
export function routedBranches(path: MapPath, ctx: RouteContext, styleFor?: StyleFor, router?: SegmentRouter): HexKey[][] {
  const r = router ?? contextRouter(ctx);
  const style = styleOf(styleFor, path.typeName);
  return path.branches.map((b) => routeBranch(b.anchors, style, r).hexes);
}

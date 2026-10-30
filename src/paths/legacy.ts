/**
 * Legacy `| Type | Hexes |` rows (every hex stored) → anchored paths.
 * Lossless and context-free: every hex becomes an anchor, so the path
 * resolves to exactly the old chain (consecutive hexes are neighbours, and
 * the router always returns the direct step between neighbours). Kept forever:
 * the map-note reader uses it for old notes and pasted legacy tables.
 *
 * Compressing the dense anchors (and merging touching chains) needs terrain
 * and the palette, so it's a separate step: compactLegacy in fromHexes.ts.
 */

import type { MapPath, PathChain } from "../types";
import { uniquePathName } from "./names";

/**
 * One path per chain, in order. Names are `<Type>` for the first path of a
 * type, then `<Type> 2`, `<Type> 3`… (unique ignoring case and spacing, also
 * against `taken`). A legacy column named Notes (any case) becomes the
 * path's notes; every other unknown column stays in `extra`.
 */
export function legacyChainsToPaths(chains: readonly PathChain[], taken: Iterable<string> = []): MapPath[] {
  const names = [...taken];
  const out: MapPath[] = [];
  for (const c of chains) {
    const name = uniquePathName(c.typeName, names);
    names.push(name);
    const path: MapPath = { name, typeName: c.typeName, branches: [{ anchors: [...c.hexes] }] };
    if (c.extra) {
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.extra)) {
        if (k.trim().toLowerCase() === "notes" && path.notes === undefined) {
          if (v.trim()) path.notes = v;
        } else {
          extra[k] = v;
        }
      }
      if (Object.keys(extra).length) path.extra = extra;
    }
    out.push(path);
  }
  return out;
}

/**
 * ≤ 1.2 → 1.3: before path types, a map's roads and rivers were two lists
 * of hex chains (`roadChains`, `riverChains`). They become path chains of
 * type Road and River. (This conversion was lost in 5e475da and brought
 * back; maps saved by those builds still carry the old keys.)
 */
import type { MigrationInfo } from "./types";
import type { PathChain } from "../types";

export const info: MigrationInfo = {
  id: "v1.2-road-river-chains-to-path-chains",
  from: "1.2",
  to: "1.3",
  phase: "settings",
  change: "Roads and rivers saved before path types became Road and River paths.",
  recordedBy: "every load (the old keys are gone after the first save)",
};

/** Move a map entry's old chains into `pathChains` (in place). True when it had any old key. */
export function migrate(r: Record<string, unknown> & { pathChains: PathChain[] }): boolean {
  let changed = false;
  for (const [key, typeName] of [["roadChains", "Road"], ["riverChains", "River"]] as const) {
    const old = r[key];
    if (!Array.isArray(old)) continue;
    for (const c of old) {
      if (Array.isArray(c) && c.length) r.pathChains.push({ typeName, hexes: c.map(String) });
    }
    delete r[key];
    changed = true;
  }
  return changed;
}

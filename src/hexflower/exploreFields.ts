/**
 * The map settings exploring keeps in the map note (plan-hex-flower):
 *
 *   explore-with: ["[[Weather]] -> play log, every step", "[[Wilds]] -> terrain"]
 *   hex-flower-at: ["Wilds: 10"]
 *   explore-reveal: entered
 *
 * One plain key each (src/maps/mapNote.ts reads and writes them like the
 * core's, through the module's mapNoteFields). Pure data.
 */

import type { MapData } from "../types";
import type { MapNoteField } from "../modules/types";

/** The fields on a map (MapData) that exploring adds. */
export interface ExploreFields {
  /** Rules: what rolls when the party enters a blank hex (explore.ts parseRule). */
  exploreWith?: string[];
  /** Where each flower's walk stands: "<flower>: <cell>". */
  hexFlowerAt?: string[];
  /** "entered" (default) or "neighbours": which hexes a step fills. */
  exploreReveal?: string;
}

export type ExploreMap = MapData & ExploreFields;

export const EXPLORE_FIELDS: readonly MapNoteField[] = [
  { field: "exploreWith", key: "explore-with", kind: "list" },
  { field: "hexFlowerAt", key: "hex-flower-at", kind: "list" },
  { field: "exploreReveal", key: "explore-reveal", kind: "str" },
];

/** Is `map` explored by the party (it has at least one rule)? */
export function isExploreMap(map: MapData | undefined): map is ExploreMap {
  const rules: unknown = (map as unknown as ExploreFields | undefined)?.exploreWith;
  return Array.isArray(rules) && rules.some((r) => typeof r === "string" && r.trim() !== "");
}

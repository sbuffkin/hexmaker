/**
 * The map settings exploring keeps in the map note (plan-hex-flower; the
 * flower's own `hex-flower-at` is the Hex flower module's, the rest read here):
 *
 *   explore-with: ["[[Weather]] -> play log, every step", "[[Wilds]] -> terrain"]
 *   hex-flower-at: ["Wilds: 10"]
 *   explore-reveal: entered
 *   explore-grow: off        (only when the map shouldn't grow at its edge; HF4)
 *   explore-realms: ["Overland: procedural:overland at 10_10, home"]   (realms.ts)
 *   explore-blend: normal    (the realms' borders: narrow, normal, wide, sharp)
 *   explore-peek: on         (the GM sees the hidden land faintly on blank hexes; world.ts)
 *   explore-fog: on          (HF11: a finished map explored by revealing it; fog.ts)
 *   explore-seen: ["3: 4-9, 12"]  (HF11: the hexes the party has seen, as runs per row)
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
  /** "off": the map doesn't grow as the party nears its edge (unset: it does). */
  exploreGrow?: string;
  /** The generators that power the map, each with its area (realms.ts parseRealm). */
  exploreRealms?: string[];
  /** The realms' borders: narrow, normal (unset), wide or sharp. */
  exploreBlend?: string;
  /** "on": the GM's peek at the hidden land (unset: off). */
  explorePeek?: string;
  /** "on": the map is explored by revealing what's already on it (HF11; unset: off). */
  exploreFog?: string;
  /** The hexes revealed so far, as runs per row ("3: 4-9, 12"; fog.ts). Kept when the fog is lifted. */
  exploreSeen?: string[];
}

export type ExploreMap = MapData & ExploreFields;

export const EXPLORE_FIELDS: readonly MapNoteField[] = [
  { field: "exploreWith", key: "explore-with", kind: "list" },
  { field: "exploreReveal", key: "explore-reveal", kind: "str" },
  { field: "exploreGrow", key: "explore-grow", kind: "str" },
  { field: "exploreRealms", key: "explore-realms", kind: "list" },
  { field: "exploreBlend", key: "explore-blend", kind: "str" },
  { field: "explorePeek", key: "explore-peek", kind: "str" },
  { field: "exploreFog", key: "explore-fog", kind: "str" },
  { field: "exploreSeen", key: "explore-seen", kind: "list" },
];

/** Is `map` explored by the party (it has at least one rule)? */
export function isExploreMap(map: MapData | undefined): map is ExploreMap {
  const rules: unknown = (map as unknown as ExploreFields | undefined)?.exploreWith;
  return Array.isArray(rules) && rules.some((r) => typeof r === "string" && r.trim() !== "");
}

/**
 * Is `map` explored by revealing it (HF11: fog of war over a finished map)?
 * Never a map that's filled as the party goes (isExploreMap): that one is
 * revealed by its own fills.
 */
export function isFogMap(map: MapData | undefined): map is ExploreMap {
  const m = map as unknown as ExploreFields | undefined;
  return m?.exploreFog?.trim().toLowerCase() === "on" && !isExploreMap(map);
}

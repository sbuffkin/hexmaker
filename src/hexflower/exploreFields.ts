/**
 * The map settings exploring keeps in the map note (plan-hex-flower):
 *
 *   explore-with: ["[[Weather]] -> play log, every step", "[[Wilds]] -> terrain"]
 *   hex-flower-at: ["Wilds: 10"]
 *   explore-reveal: entered
 *   explore-grow: off        (only when the map shouldn't grow at its edge; HF4)
 *   explore-realms: ["Overland: procedural:overland at 10_10, home"]   (realms.ts)
 *   explore-blend: normal    (the realms' borders: narrow, normal, wide, sharp)
 *   explore-peek: on         (the GM sees the hidden land faintly on blank hexes; world.ts)
 *
 * One plain key each (src/maps/mapNote.ts reads and writes them like the
 * core's, through the module's mapNoteFields). Pure data.
 */

import type { MapData } from "../types";
import type { MapNoteField, TableConditionDef } from "../modules/types";

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
}

export type ExploreMap = MapData & ExploreFields;

export const EXPLORE_FIELDS: readonly MapNoteField[] = [
  { field: "exploreWith", key: "explore-with", kind: "list" },
  { field: "hexFlowerAt", key: "hex-flower-at", kind: "list" },
  { field: "exploreReveal", key: "explore-reveal", kind: "str" },
  { field: "exploreGrow", key: "explore-grow", kind: "str" },
  { field: "exploreRealms", key: "explore-realms", kind: "list" },
  { field: "exploreBlend", key: "explore-blend", kind: "str" },
  { field: "explorePeek", key: "explore-peek", kind: "str" },
];

/** Is `map` explored by the party (it has at least one rule)? */
export function isExploreMap(map: MapData | undefined): map is ExploreMap {
  const rules: unknown = (map as unknown as ExploreFields | undefined)?.exploreWith;
  return Array.isArray(rules) && rules.some((r) => typeof r === "string" && r.trim() !== "");
}

const lc = (s: string) => s.trim().toLowerCase();

/**
 * A random table's When key: `from: grassland, hills` — the terrain of the
 * hex the party came from (exploring passes it in).
 */
export const FROM_CONDITION: TableConditionDef = {
  key: "from",
  read: (value) => {
    const list = value.split(/\s*,\s*/).map(lc).filter(Boolean);
    return list.length ? list : undefined;
  },
  fits: (read, known) => typeof known === "string" && (read as string[]).includes(lc(known)),
  format: (read) => (read as string[]).join(", "),
};

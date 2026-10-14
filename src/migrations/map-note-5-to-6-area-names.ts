/**
 * Unreleased → 1.6 (owner MG5, O7): a map's named zones are "areas" (maps
 * are regions and locations). Map notes go to format 6:
 *
 * - the Hexes table's Region column is written as Area;
 * - `show-region-overlay` is written as `show-area-overlay`;
 * - the Summary's line is "Areas";
 * - `on-arrival: make places` is written as `make submaps`.
 *
 * Every old name is still read, forever (mapNote.ts aliases; arrival.ts
 * reads any "make …"). A format-5 note is backed up and rewritten by
 * MapStore on load, like every older format; the settings part
 * (`upgradeMapSettings`) runs on the map's settings as read, from data.json
 * (compat.migrateMapData) and from a note older than format 6
 * (MapStore.apply). Nothing else in the note changes.
 */
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "map-note-5-to-6-area-names",
  from: "map-note 5",
  to: "map-note 6",
  phase: "maps",
  change: "Map notes call a map's named zones areas: an Area column, show-area-overlay, and on-arrival: make submaps.",
  recordedBy: "the map note's format (hexmaker-map: 6)",
};

/** How "make on arrival" was written before format 6, and how it's written now. */
const OLD_ARRIVAL = /^\s*make places\s*$/i;
export const ARRIVAL_MAKE_WORDS = "make submaps";

/** A map's settings as read, in place: the old arrival words become the new ones. True when changed. */
export function upgradeMapSettings(m: { arrivalMode?: string }): boolean {
  if (typeof m.arrivalMode === "string" && OLD_ARRIVAL.test(m.arrivalMode)) {
    m.arrivalMode = ARRIVAL_MAKE_WORDS;
    return true;
  }
  return false;
}

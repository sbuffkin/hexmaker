/**
 * Map notes' help box ("How to edit this note") from older formats: each
 * line the plugin wrote, still word for word, becomes this format's line.
 * A line the user edited is kept as they left it. Called from
 * mapNote.updateMapNote when it rewrites a note of an older format (the
 * write is backed up first by MapStore). Format 1's one-line intro becomes
 * the whole help box there (mapNote.ts, OLD_INTRO).
 *
 * - format 2 → 3: the Hexes line (one Submap column → Region map + Locations);
 * - formats 3/4 → 5: the Paths line → the Paths and Path routes lines;
 * - format 5 → 6: the Hexes line's *Region* → *Area* (owner MG5).
 */
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "map-note-1-to-6-help-text",
  from: "map-note 1",
  to: "map-note 6",
  phase: "maps",
  change: "The help box in map notes describes the current columns.",
  recordedBy: "the map note's format (hexmaker-map:)",
};

/** Format 2's Hexes help line (one Submap column). */
const HEX_HELP_LINE_V2 = "> - **Hexes**: one row per hex that has something set. *Hex* is the column and row, like `3_4`. *Terrain* and *Region* use names from the map's palette. *Icon* and *GM icons* are icon file names; separate several with commas. *Submap* is the map that opens from the hex. *Locked* `yes` keeps generators off it.";
/** Formats 3–5's Hexes help line (Region column). */
const HEX_HELP_LINE_V5 = "> - **Hexes**: one row per hex that has something set. *Hex* is the column and row, like `3_4`. *Terrain* uses names from the map's palette; *Region* links the region's note. *Icon* and *GM icons* are icon file names; separate several with commas. *Locations* links the maps that open from the hex (towns, dungeons…), separated by commas; *Region map*, when there is one, is the map of the hex itself. *Locked* `yes` keeps generators off it.";
/** Formats 2–3's and format 4's Paths help lines. */
const PATH_HELP_LINE_V3 = "> - **Paths**: *Type* is a path type (Road, River…). *Hexes* lists its hexes in order, separated by spaces.";
const PATH_HELP_LINE_V4 = "> - **Paths**: *Type* is a path type (Road, River…). *Hexes* lists its hexes in order, separated by spaces. The plugin fills in *Route*, *Warning* and the **Summary** above from the tables; edits to those are replaced.";

/** The note's lines with older help lines (still the plugin's words) replaced by `current`'s. */
export function upgradeHelpLines(lines: string[], current: { hex: string; paths: string[] }): string[] {
  return lines.flatMap((l) => {
    const s = l.trim();
    if (s === HEX_HELP_LINE_V2 || s === HEX_HELP_LINE_V5) return [current.hex];
    if (s === PATH_HELP_LINE_V3 || s === PATH_HELP_LINE_V4) return [...current.paths];
    return [l];
  });
}

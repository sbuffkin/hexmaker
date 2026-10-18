/**
 * New map's fixed words, and the sizes a submap starts on.
 *
 * Pure: no Obsidian imports.
 */

import type { NeighbourSea } from "../procedural/planetSurface";
import type { SizePreset } from "../sizePresets";

/** Submaps are local (a system, a dungeon): smaller, odd sizes so there's a true centre hex. */
export const SUBMAP_SIZE_PRESETS: SizePreset[] = [
  { label: "Small", cols: 9, rows: 9 },
  { label: "Medium", cols: 13, rows: 13 },
  { label: "Large", cols: 19, rows: 19 },
];

/**
 * Base terrain wording. With map notes a hex note is only ever created
 * when a hex first gets content, whatever the base terrain; the base only
 * decides what an unpainted hex shows (fresh-eyes r4: the old "None
 * (create every hex note)" was outdated and alarming).
 */
export const BASE_TERRAIN_NONE_LABEL = "None (unpainted hexes stay blank)";
export const BASE_TERRAIN_HELP =
  "What hexes you haven't painted show: this terrain, or nothing with None. Painting a hex overrides it. Either way a hex only gets its own note when you first add something to it.";

/** Why Overland's Sea starts where it does next to a neighbouring map. */
export function neighbourSeaText(hint: NeighbourSea, anchor: string): string {
  switch (hint.why) {
    case "edge": return `Picked from ${anchor}: its sea reaches the shared edge, so the sea is on the ${hint.side}.`;
    case "end": return `Picked from ${anchor}: its coast meets the shared edge at the ${hint.side} end, so the sea runs along the ${hint.side}.`;
    case "middle": return `Picked from ${anchor}: its shared edge has water only in the middle, so lakes and inlets.`;
    case "dry": return `Picked from ${anchor}: its shared edge has no water, so no sea by default.`;
  }
}

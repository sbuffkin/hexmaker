/**
 * Clicks and the terrain brush on an overworld, the pure part.
 *
 * Clicks (owner report 2026-10-10: a left click on a region brick in Build
 * opened a biome picker full of disabled buttons):
 * - left click on a hex or brick WITH a region enters it, in every mode
 *   and both views;
 * - left click on an empty one places a biome (Build, God) or says how to
 *   unlock it (Play);
 * - a region's right-click item "Edit region…" opens one modal with its
 *   name, biome, facts and notes (#49), in every mode; only God may
 *   change the biome there. The overworld offers no hex editor.
 *
 * The terrain brush (owner: "the terrain brush doesn't work on the
 * overworld map, I would like it to paint + update the submaps as you draw
 * with it") paints the region maps' own hexes under the brush, across
 * seams, written as you draw. Painting counts as Build.
 *
 * Pure: no Obsidian imports.
 */

import { hexNeighbors } from "../../packages/hex-wfc/src/grid";
import { canAdd, canChangeRegion, CHANGE_OPEN_REGION_HINT, isOpenPlace, PLACE_LOCKED_HINT } from "../workMode";
import { parentOf, type RegionLayout } from "./layout";

/** The line under a region's biome in "Edit region…" outside God (shown read-only there). */
export const BIOME_LOCKED_HINT = "Switch to God to change it.";

/** The hint when the terrain brush is used on an overworld in Play. */
export const PAINT_LOCKED_HINT = "Switch to Build to paint the regions.";

/** The terrain tool on an overworld's Biomes view (MM1: that view is biomes only). */
export const TERRAIN_IN_BIOMES_HINT = "The Biomes view shows biomes only: use the Biome tool here, or switch to Regions to paint terrain.";

/** The hint when the brush lands where there's no region. */
export const PAINT_NO_REGION_HINT = "No region here yet; place a biome first.";

type Mode = { workMode?: string } | undefined;

export type OverworldLeftClick =
  | { kind: "enter" }
  | { kind: "place" }
  | { kind: "hint"; hint: string };

/** What a plain left click on an overworld hex or brick does. */
export function overworldLeftClick(map: Mode, hasRegion: boolean): OverworldLeftClick {
  if (hasRegion) return { kind: "enter" };
  return canAdd(map) ? { kind: "place" } : { kind: "hint", hint: PLACE_LOCKED_HINT };
}

export interface OverworldMenuItem {
  id: "enter-region" | "edit-region" | "reroll" | "lock" | "set-biome" | "center" | "locations";
  title: string;
  enabled: boolean;
  /** Why it's disabled (shown with it). */
  hint?: string;
}

/**
 * A hex's right-click menu on an overworld (both views). The overworld is
 * the big-picture view (owner, #49): no hex editor and no per-hex items
 * (notes, tables, swaps, terrain clears), only region-level ones. A hex
 * with a region: Enter region, and Edit region… in every mode (the modal
 * shows what the mode may change). A new region (open, `arrival: open`)
 * also gets Reroll and Lock right there (owner 2026-10-12: "no reroll on
 * right click for session-new blocks"), as Edit region… has them. The map
 * view's mode menu shows Reroll where the mode may change the region
 * (canChangeRegion: Build while it's open) and Lock in every mode. Once
 * locked they're gone; God changes it from Edit region… (the God offer).
 * An empty hex: Set biome… (Build and God; shown disabled with its hint
 * in Play). Then Center on this hex, and the hex's Locations when it has any.
 */
export function overworldMenu(map: Mode, hasRegion: boolean, locations = 0, region?: { arrival?: string }): OverworldMenuItem[] {
  const out: OverworldMenuItem[] = [];
  if (hasRegion) {
    out.push({ id: "enter-region", title: "Enter region", enabled: true });
    out.push({ id: "edit-region", title: "Edit region…", enabled: true });
    if (isOpenPlace(region)) {
      out.push({ id: "reroll", title: "Reroll region", enabled: true });
      out.push({ id: "lock", title: "Lock region", enabled: true });
    }
  } else {
    const add = canAdd(map);
    out.push({ id: "set-biome", title: "Set biome…", enabled: add, ...(add ? {} : { hint: PLACE_LOCKED_HINT }) });
  }
  out.push({ id: "center", title: "Center on this hex", enabled: true });
  if (locations > 0) out.push({ id: "locations", title: `Locations (${locations})…`, enabled: true });
  return out;
}

/**
 * What "Edit region…" offers in this mode, for this region. A new region
 * (open, `arrival: open`) may be changed in Build: the biome as a picker,
 * Reroll, Settings… (generator options, live preview) and Lock. Once
 * locked, only God may change it. Where it can't be changed: the biome
 * shown read-only with one line saying how to change it, never a wall of
 * disabled buttons. Name and notes are editable in every mode (note text
 * is never locked, WM2). The rule is the policy table's (canChangeRegion).
 */
export interface EditRegionPlan {
  biome: "pick" | "show";
  reroll: boolean;
  settings: boolean;
  /** Offer Lock: the region is still open. */
  lock: boolean;
  /** Shown under a read-only biome. */
  hint?: string;
}

export function editRegionPlan(map: Mode, region?: { arrival?: string }): EditRegionPlan {
  const lock = isOpenPlace(region);
  if (canChangeRegion(map, region)) return { biome: "pick", reroll: true, settings: true, lock };
  return { biome: "show", reroll: false, settings: false, lock, hint: lock ? CHANGE_OPEN_REGION_HINT : BIOME_LOCKED_HINT };
}

/**
 * The terrain counts as one short line, most first: "forest 30, hills 12,
 * lake 4 and 2 more". Hexes with no terrain are listed last as "blank".
 */
export function terrainCountsText(counts: ReadonlyMap<string, number>, blank = 0, max = 4): string {
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (blank) rows.push(["blank", blank]);
  if (!rows.length) return "none yet";
  const shown = rows.slice(0, max).map(([t, n]) => `${t} ${n}`).join(", ");
  return rows.length > max ? `${shown} and ${rows.length - max} more` : shown;
}

/** The child cells a brush of `size` (1, 3 or 7) covers around (x, y), same shape as the map's brush. */
export function brushCells(layout: RegionLayout, x: number, y: number, size: number): [number, number][] {
  const out: [number, number][] = [[x, y]];
  if (size > 1) {
    const nb = hexNeighbors(x, y, layout.orientation, layout.childStagger);
    out.push(...(size === 3 ? [nb[2], nb[3]] : nb));
  }
  return out;
}

export interface PaintTarget {
  /** The region map the cell belongs to. */
  map: string;
  /** Shared-grid key "x_y". */
  key: string;
}

/**
 * Which region map each brushed cell is written to (cells reach across
 * seams into the next region). Cells over a slot with no region are
 * skipped and counted in `missed`.
 */
export function paintTargets(
  layout: RegionLayout,
  cells: [number, number][],
  regionAt: (parentHex: string) => string | undefined,
): { targets: PaintTarget[]; missed: number } {
  const targets: PaintTarget[] = [];
  let missed = 0;
  for (const [x, y] of cells) {
    const map = regionAt(parentOf(layout, x, y).join("_"));
    if (map) targets.push({ map, key: `${x}_${y}` });
    else missed++;
  }
  return { targets, missed };
}

/** Shown-vs-now terrain (the core's, src/hex-map/terrainDiff.ts). */
export { terrainDiff } from "../hex-map/terrainDiff";

/** Once-per-frame runs (the core's, src/frameThrottle.ts). */
export { FrameThrottle } from "../frameThrottle";

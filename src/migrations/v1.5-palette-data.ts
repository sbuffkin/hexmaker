/**
 * Unreleased → 1.6: data that used to be worked out from palette names at
 * run time is written into the palettes once (space role types, a preset's
 * child palette and Submap defaults). Runs after the terrain-type seeding.
 * Called from PaletteStore.attach.
 */
import type { TerrainPalette } from "../types";
import { cloneSubmapDefaults, getPreset } from "../palettes/presets";
import { refinedTerrainType } from "../terrainTypes";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-palette-data",
  from: "1.5.x",
  to: "1.6",
  phase: "palettes",
  change: "Palettes named like a built-in palette got its child palette and submap defaults written in.",
  recordedBy: "paletteDataUpgraded",
};

/**
 * One-time upgrade of data that used to be worked out from names at run
 * time, so from now on only what the palette note says counts:
 *  - space terrains typed before the space roles had their own types get
 *    them (a "moon" typed world becomes a moon; see refinedTerrainType);
 *  - an installed palette named like a built-in preset gets that preset's
 *    child palette and Submap defaults rows it doesn't have yet (they used
 *    to be borrowed from the preset by name on every lookup).
 * Returns how many palettes changed.
 */
export function upgradePaletteData(palettes: TerrainPalette[]): number {
  let n = 0;
  for (const pal of palettes) {
    let changed = false;
    for (const t of pal.terrains) {
      const refined = refinedTerrainType(t);
      if (refined) { t.type = refined; changed = true; }
    }
    const preset = getPreset(pal.name);
    if (preset?.childPalette && !pal.childPalette) {
      pal.childPalette = preset.childPalette;
      changed = true;
    }
    if (preset?.submapDefaults) {
      const missing = Object.keys(preset.submapDefaults).filter((k) => !pal.submapDefaults?.[k]);
      if (missing.length) {
        const rows = cloneSubmapDefaults(preset.submapDefaults);
        pal.submapDefaults = { ...(pal.submapDefaults ?? {}) };
        for (const k of missing) pal.submapDefaults[k] = rows[k];
        changed = true;
      }
    }
    if (changed) n++;
  }
  return n;
}

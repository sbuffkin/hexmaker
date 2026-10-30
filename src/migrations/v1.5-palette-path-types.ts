/**
 * 1.5.x → 1.6: path types moved from one plugin-wide list (data.json's
 * `pathTypes`) into each palette. A palette without them gets a copy of the
 * old list (or the defaults). Safe on every load and reload: a palette that
 * has path types is left alone. Called from PaletteStore.attach / reload.
 */
import type { PathType, TerrainPalette } from "../types";
import { DEFAULT_PATH_TYPES } from "../constants";
import { clonePathTypes } from "../palettes/pathTypeTable";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-palette-path-types",
  from: "1.5.x",
  to: "1.6",
  phase: "palettes",
  change: "Each palette got its own copy of your path types (Road, River…).",
  recordedBy: "every load (palettes that have path types are left alone)",
};

/**
 * Give every palette without path types a copy of the old plugin-wide list
 * (settings.pathTypes, else Road and River). Before path types moved into
 * palettes every map could draw every type, so copying them all keeps every
 * map's paths drawable. Returns how many palettes were filled.
 */
export function fillPalettePathTypes(palettes: TerrainPalette[], legacy: PathType[] | undefined): number {
  const source = legacy && legacy.length ? legacy : DEFAULT_PATH_TYPES;
  let n = 0;
  for (const pal of palettes) {
    if (pal.pathTypes) continue;
    pal.pathTypes = clonePathTypes(source);
    n++;
  }
  return n;
}

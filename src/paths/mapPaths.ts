/**
 * The ONE place a map's stored paths are read as anchored MapPaths.
 * Pure, no Obsidian imports.
 */

import type { MapData, MapPath } from "../types";
import { legacyChainsToPaths } from "./legacy";

/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PHASE-3 ADAPTER. Until the map note stores `MapData.paths` (format   │
 * │ with `## Path routes`, built on feat/path-mapnote), a map's paths    │
 * │ are its legacy `pathChains`, each chain one path with every hex as   │
 * │ an anchor (lossless: it resolves to exactly the old chain). Phase 3  │
 * │ replaces ONLY this function's body with `return map.paths ?? [];`.   │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export function storedMapPaths(map: Partial<Pick<MapData, "pathChains">>): MapPath[] {
  return legacyChainsToPaths(map.pathChains ?? []);
}

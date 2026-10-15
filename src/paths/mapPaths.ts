/**
 * The ONE place a map's stored paths are read as anchored MapPaths.
 * Pure, no Obsidian imports.
 */

import type { MapData, MapPath } from "../types";
import { legacyChainsToPaths } from "./legacy";

/**
 * A map's stored paths: `MapData.paths`, which MapStore loads from the map
 * note (format 5) and keeps in step with edits made through `pathChains`.
 * A map the store holds no paths for (its note can't be read, so its paths
 * are still only data.json's chains) falls back to those chains, each one
 * path with every hex as an anchor (lossless: it resolves to the old chain).
 */
export function storedMapPaths(map: Partial<Pick<MapData, "pathChains" | "paths">>): MapPath[] {
  return map.paths ?? legacyChainsToPaths(map.pathChains ?? []);
}

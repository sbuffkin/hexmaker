/**
 * Map-type questions about one map, answered from the map tree: the map,
 * its parent, and so on up. Pure: the host hands over the lookups, so the
 * plugin and the tests ask the same code.
 */

import type { TerrainColor } from "../types";
import { mapAncestors } from "../hex-map/submapNav";
import { getPreset } from "../palettes/presets";
import {
  contextKindsOf,
  kindForChain,
  mapKindInfo,
  sectionWordsFor,
  type ChainPalette,
  type MapKind,
  type SectionWordsFn,
} from "../mapKinds";

export interface MapKindHost {
  getMap(name: string): { paletteName?: string } | undefined;
  parentOf(name: string): { map: string } | undefined;
  getPaletteByName(name: string): { kind?: string; terrains: TerrainColor[] } | undefined;
}

/** The palette names from `mapName` up its parents (nearest first). */
export function paletteChain(host: MapKindHost, mapName: string): (string | undefined)[] {
  const chain = [mapName, ...mapAncestors(mapName, (m) => host.parentOf(m)?.map).reverse()];
  return chain.map((m) => host.getMap(m)?.paletteName);
}

/**
 * The palettes (or presets not installed yet) from `mapName` up, as the
 * map-type rules see them: an installed palette's terrains, and its
 * declared type or else the preset's of the same name.
 */
function chainOf(host: MapKindHost, mapName: string): ChainPalette[] {
  return paletteChain(host, mapName).map((n) => {
    if (!n) return undefined;
    const pal = host.getPaletteByName(n);
    const preset = getPreset(n);
    if (!pal && !preset) return undefined;
    return { kind: pal?.kind ?? preset?.kind, terrains: pal?.terrains ?? preset?.terrains ?? [] };
  });
}

/** The map's type (CM3: the nearest declared type up the map tree); see kindForChain. */
export function kindForIn(host: MapKindHost, mapName: string): MapKind | undefined {
  return host.getMap(mapName) ? kindForChain(chainOf(host, mapName)) : undefined;
}

/**
 * The map types in context on `mapName`: its palette's, and every
 * ancestor map's (a planet submap of a star system is in space).
 */
export function contextKindsIn(host: MapKindHost, mapName: string): Set<MapKind> {
  return contextKindsOf(paletteChain(host, mapName).map((n) => (n ? host.getPaletteByName(n) ?? getPreset(n) : undefined)));
}

/** Display words for link sections on `mapName` (G4b): its map type's (kindForIn). No map = the usual words. */
export function sectionWordsIn(host: MapKindHost, mapName: string | undefined): SectionWordsFn {
  if (!mapName) return sectionWordsFor(undefined);
  return sectionWordsFor(mapKindInfo(kindForIn(host, mapName)));
}

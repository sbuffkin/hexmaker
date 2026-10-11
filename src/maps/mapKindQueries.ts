/**
 * Map-type questions about one map, answered from the map tree: the map,
 * its parent, and so on up. Pure: the host hands over the lookups, so the
 * plugin and the tests ask the same code.
 */

import type { TerrainColor } from "../types";
import { mapAncestors } from "../hex-map/submapNav";
import { getPreset } from "../palettes/presets";
import { paletteKind, sectionKindFor, sectionWordsFor, type SectionWordsFn } from "../mapKinds";

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

const paletteOrPreset = (host: MapKindHost, name: string) => host.getPaletteByName(name) ?? getPreset(name);

/**
 * Is `mapName` in space: its palette, or any ancestor map's (a planet
 * submap of a star system), is a space palette?
 */
export function isSpaceMapIn(host: MapKindHost, mapName: string): boolean {
  return paletteChain(host, mapName).some((n) => !!n && paletteKind(paletteOrPreset(host, n)) === "space");
}

/** Display words for link sections on `mapName` (G4b); see HexmakerPlugin.sectionWordsFor. */
export function sectionWordsIn(host: MapKindHost, mapName: string | undefined): SectionWordsFn {
  if (!mapName || !host.getMap(mapName)) return sectionWordsFor(undefined);
  const palettes = paletteChain(host, mapName);
  const terrains = palettes.map((n) => (n ? host.getPaletteByName(n)?.terrains ?? getPreset(n)?.terrains ?? [] : []));
  // A palette's declared type counts too (a planet map on Space - Planet).
  const declared = palettes.map((n) => (n ? host.getPaletteByName(n)?.kind ?? getPreset(n)?.kind : undefined));
  return sectionWordsFor(sectionKindFor(terrains, undefined, declared));
}

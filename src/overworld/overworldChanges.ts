/**
 * What an open map view must redraw when a map's data changes (owner
 * playtest 2026-10-10: "the parent map doesn't refresh when you paint a
 * child"). Pure: no Obsidian imports.
 *
 * A region's bitmap is cached by every view's overworld layer, whatever map
 * that view shows right now, so a change to ANY region map drops its bitmap
 * everywhere: painting it, generating or rerolling it, or editing its map
 * note by hand. Otherwise going back up to the overworld showed the old one.
 */

export interface ChangedMapInfo {
  name: string;
  submapKind?: string;
  parent?: { map: string; hex: string };
}

export interface OverworldRefresh {
  /** Region whose cached bitmap is stale (rebuilt on the next draw). */
  invalidate?: string;
  /** Redraw the open map's overworld layer now (its regions or biome marks changed). */
  redrawLayer: boolean;
  /** Redraw the minimap and the region flower (the overworld behind them changed). */
  refreshMinimap: boolean;
}

export function overworldRefreshFor(
  changed: ChangedMapInfo | undefined,
  activeName: string,
  /** The overworld the open map is a region of, if it is one. */
  homeOverworld: string | undefined,
): OverworldRefresh {
  const parentMap = changed?.submapKind === "region" ? changed.parent?.map : undefined;
  const isRegion = parentMap !== undefined;
  const name = changed?.name;
  return {
    invalidate: isRegion ? name : undefined,
    redrawLayer: name === activeName || parentMap === activeName,
    refreshMinimap: !!name && (name === activeName || name === homeOverworld),
  };
}

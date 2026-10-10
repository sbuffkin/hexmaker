/**
 * File names for map exports, in one place so the export form's preview
 * and the files actually written always agree (fresh-eyes round 3: the
 * preview said "kerrigan.png", the file was "kerrigan-region.png").
 * Pure: no Obsidian imports.
 */

/** Strip vault-illegal characters from a file name stem. */
export function sanitiseFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

export interface MapExportNameOptions {
  /** What the user typed in "File name" (may be blank). */
  base: string;
  /** The map's name: the stem when `base` is blank. */
  mapName: string;
  showFactionOverlay?: boolean;
  showRegionOverlay?: boolean;
  /** Player version of the hexcrawl manual. */
  player?: boolean;
}

/**
 * The stem the PNG and the map PDF are written under: the typed name (or
 * the map name) plus "-faction" / "-region" for each overlay, in that
 * order, so variants of one map form a predictable family.
 */
export function mapExportStem(o: MapExportNameOptions): string {
  return (o.base.trim() || o.mapName) + mapExportSuffix(o);
}

/**
 * The overlay suffix added after the typed name ("-faction-region"…), or
 * "". Shown next to the File name box so the box and the "Writes:" line
 * agree (fresh-eyes r5).
 */
export function mapExportSuffix(o: Pick<MapExportNameOptions, "showFactionOverlay" | "showRegionOverlay">): string {
  return (o.showFactionOverlay ? "-faction" : "") + (o.showRegionOverlay ? "-region" : "");
}

/** Every file a map export can write, as written to the export folder. */
export function mapExportFileNames(o: MapExportNameOptions): { png: string; pdf: string; manual: string } {
  const stem = sanitiseFilename(mapExportStem(o));
  const base = o.base.trim() || o.mapName;
  return {
    png: `${stem}.png`,
    pdf: `${stem}.pdf`,
    manual: `${sanitiseFilename(`${base} ${o.player ? "player" : "manual"}`)}.pdf`,
  };
}

/** The "On the map" ticks of the export form, in display order. */
export const EXPORT_LAYER_KEYS = [
  "showCoords",
  "showIcons",
  "showPaths",
  "showHexNames",
  "showTokens",
  "showLinkBadges",
  "showLegend",
  "showFactionOverlay",
  "showRegionOverlay",
] as const;
export type ExportLayerKey = typeof EXPORT_LAYER_KEYS[number];

/** The export form's last choices for one map (data.json, per map). */
export interface MapExportPrefs {
  /** What was typed in File name. */
  fileName?: string;
  /** The Output size preset (hex radius in px). */
  hexRadius?: number;
  layers?: Partial<Record<ExportLayerKey, boolean>>;
}

/** The map view's toggles the export form starts from (MapData fields + the legend setting). */
export interface ExportViewState {
  showCoords?: boolean;
  showTerrainIcons?: boolean;
  showIconOverrides?: boolean;
  showPaths?: boolean;
  showHexNames?: boolean;
  showTokens?: boolean;
  showLinkBadges?: boolean;
  showLegend?: boolean;
}

/**
 * The "On the map" ticks the export form opens with (round 6 S9): the
 * user's last choices for this map, else what the map view shows. The
 * faction and region overlays start off unless the user ticked them for
 * this map before: they print names players may not be meant to see.
 */
export function exportLayerDefaults(view: ExportViewState, prefs?: MapExportPrefs): Record<ExportLayerKey, boolean> {
  const fromView: Record<ExportLayerKey, boolean> = {
    showCoords: view.showCoords ?? true,
    showIcons: (view.showTerrainIcons ?? true) || (view.showIconOverrides ?? true),
    showPaths: view.showPaths ?? true,
    showHexNames: view.showHexNames ?? true,
    showTokens: view.showTokens ?? true,
    showLinkBadges: view.showLinkBadges ?? true,
    showLegend: view.showLegend ?? true,
    showFactionOverlay: false,
    showRegionOverlay: false,
  };
  const saved = prefs?.layers ?? {};
  const out = { ...fromView };
  for (const k of EXPORT_LAYER_KEYS) {
    const v = saved[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

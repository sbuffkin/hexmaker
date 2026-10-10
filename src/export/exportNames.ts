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

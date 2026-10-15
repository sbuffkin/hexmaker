import { App, TFile } from "obsidian";
import type { ModeAction } from "../workMode";
import { canDo } from "../modeGate";
import type { HexData } from "./mapNote";
import type { Frontmatter } from "../notes/frontmatterText";
import { getFrontMatter } from "../notes/noteFrontmatter";
import { gmIconsFromFm, iconOverrideFromFm, pendingTerrainOf, terrainFromFm } from "./hexFrontmatter";

/**
 * Per-hex map data (terrain, icon, GM icons, region, submap) lives in map
 * notes (see src/maps/MapStore.ts), not in hex-note frontmatter. Once the
 * store is ready, the hex getters/setters below route to it; before that
 * (startup) and for non-hex paths they fall back to frontmatter.
 */
export interface HexDataSource {
  isReady(): boolean;
  resolve(path: string): { map: string; key: string } | null;
  get(map: string, key: string): HexData | undefined;
  /** `action`: the user action (work-mode gate); false when refused. */
  set(map: string, key: string, patch: Record<string, unknown>, action?: ModeAction): boolean;
}
let hexSource: HexDataSource | null = null;
/** Bound by ports.ts (bindPorts) to the plugin's MapStore. */
export function setHexDataSource(src: HexDataSource | null): void {
  hexSource = src;
}
/** The store location for a hex-note path, when the store is serving it. */
function hexLoc(path: string): { map: string; key: string } | null {
  if (!hexSource?.isReady()) return null;
  return hexSource.resolve(path);
}

export function getTerrainFromFile(app: App, path: string): string | null {
  const loc = hexLoc(path);
  if (loc) return hexSource!.get(loc.map, loc.key)?.terrain ?? null;
  const fm = getFrontMatter(app, path);
  return fm ? terrainFromFm(fm) : pendingTerrainOf(path);
}

/**
 * Write a hex's terrain. `generated`: written by a generator, not by hand,
 * so it's still gated by the work mode but isn't a hand edit (it never
 * locks a new place, modeGate.noteHandEdit).
 */
export async function setTerrainInFile(
  app: App,
  path: string,
  terrainKey: string | null,
  generated = false,
): Promise<boolean> {
  const loc = hexLoc(path);
  if (loc) {
    if (!generated) return hexSource!.set(loc.map, loc.key, { terrain: terrainKey }, "paint-terrain");
    return canDo(loc.map, "paint-terrain") && hexSource!.set(loc.map, loc.key, { terrain: terrainKey });
  }
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (terrainKey === null) {
      delete fm["terrain"];
    } else {
      fm["terrain"] = terrainKey;
    }
  });
  return true;
}

/**
 * A hex's name. Names only exist in the map note (there is no hex-note
 * frontmatter key to fall back to), so before the store is ready, or for a
 * path that isn't a hex, there is no name.
 */
export function getHexNameFromFile(path: string): string | null {
  const loc = hexLoc(path);
  return loc ? hexSource!.get(loc.map, loc.key)?.name ?? null : null;
}

export function getHexRegionFromFile(app: App, path: string): string | null {
  const loc = hexLoc(path);
  if (loc) return hexSource!.get(loc.map, loc.key)?.region ?? null;
  const region = getFrontMatter(app, path)?.["region"];
  return typeof region === "string" ? region : null;
}

export async function setHexRegionInFile(
  app: App,
  path: string,
  regionName: string | null,
): Promise<boolean> {
  const loc = hexLoc(path);
  if (loc) return hexSource!.set(loc.map, loc.key, { region: regionName }, "paint-region-area");
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (regionName === null) {
      delete fm["region"];
    } else {
      fm["region"] = regionName;
    }
  });
  return true;
}

export function getIconOverrideFromFile(app: App, path: string): string | null {
  const loc = hexLoc(path);
  if (loc) return hexSource!.get(loc.map, loc.key)?.icon ?? null;
  return iconOverrideFromFm(getFrontMatter(app, path));
}

export async function setIconOverrideInFile(
  app: App,
  path: string,
  icon: string | null,
  action: ModeAction = "paint-icon",
): Promise<boolean> {
  const loc = hexLoc(path);
  if (loc) return hexSource!.set(loc.map, loc.key, { icon }, action);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (icon === null) {
      delete fm["icon"];
    } else {
      fm["icon"] = icon;
    }
  });
  return true;
}

/**
 * Multi-icon getter — returns the list of GM icons, with duplicates
 * preserved (a user can stack multiple of the same icon for a count).
 *
 * Reads the new array key `gm-icons`. Falls back to the legacy
 * singular key `gm-icon` if present so existing notes Just Work.
 */
export function getGmIconsFromFile(app: App, path: string): string[] {
  const loc = hexLoc(path);
  if (loc) return [...(hexSource!.get(loc.map, loc.key)?.gmIcons ?? [])];
  return gmIconsFromFm(getFrontMatter(app, path));
}

/**
 * Multi-icon writer. Replaces the entire `gm-icons` list with the
 * given array (which may have duplicates for count). Always clears the
 * legacy singular `gm-icon` key when writing — once a note has been
 * touched by the new model, we standardise on the new key.
 */
export async function setGmIconsInFile(
  app: App,
  path: string,
  icons: string[],
): Promise<boolean> {
  const loc = hexLoc(path);
  if (loc) return hexSource!.set(loc.map, loc.key, { gmIcons: [...icons] }, "paint-icon");
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    // Always clean up the legacy key
    delete fm["gm-icon"];
    if (icons.length === 0) {
      delete fm["gm-icons"];
    } else {
      fm["gm-icons"] = icons;
    }
  });
  return true;
}

/**
 * The maps a hex opens into: its Region map (at most one) and its
 * Locations, in order. Hex notes outside a map folder (older notes) read
 * their `duckmage-submap` key as the one location.
 */
export function getHexMapsFromFile(app: App, path: string): { regionMap?: string; locations: string[] } {
  const loc = hexLoc(path);
  if (loc) {
    const h = hexSource!.get(loc.map, loc.key);
    return { regionMap: h?.regionMap, locations: [...(h?.locations ?? [])] };
  }
  const val = getFrontMatter(app, path)?.["duckmage-submap"];
  return { locations: typeof val === "string" && val ? [val] : [] };
}

/** The map a hex opens into first: its region, else its first location. */
export function getSubmapFromFile(app: App, path: string): string | undefined {
  const m = getHexMapsFromFile(app, path);
  return m.regionMap ?? m.locations[0];
}

/** Older hex notes' one-submap key (map-folder hexes: sets the only location). */
export async function setSubmapInFile(
  app: App,
  path: string,
  mapName: string | null,
): Promise<boolean> {
  const loc = hexLoc(path);
  if (loc) return hexSource!.set(loc.map, loc.key, { locations: mapName ? [mapName] : null }, "link-map");
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (mapName === null) delete fm["duckmage-submap"];
    else fm["duckmage-submap"] = mapName;
  });
  return true;
}

import { App, TFile } from "obsidian";
import type { TokenEntry, TokenShape, TokenSize } from "./types";
import {
  type OverlayPatternKey,
  DEFAULT_OVERLAY_PATTERN_KEY,
  DEFAULT_OVERLAY_PATTERN_SCALE,
  DEFAULT_OVERLAY_PATTERN_OPACITY,
  DEFAULT_OVERLAY_OUTLINE_WIDTH,
  normalizeOverlayPatternKey,
  normalizeOverlayPatternScale,
  normalizeOverlayPatternOpacity,
  normalizeOverlayOutlineWidth,
} from "./overlayPatterns";

export interface OverlayStyle {
  pattern: OverlayPatternKey;
  scale: number;
  opacity: number;
  outlineWidth: number;
}

export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  pattern: DEFAULT_OVERLAY_PATTERN_KEY,
  scale: DEFAULT_OVERLAY_PATTERN_SCALE,
  opacity: DEFAULT_OVERLAY_PATTERN_OPACITY,
  outlineWidth: DEFAULT_OVERLAY_OUTLINE_WIDTH,
};

export interface Frontmatter {
  [key: string]: string | string[] | boolean | undefined;
  terrain?: string;
  icon?: string;
  "gm-icon"?: string;
  "gm-icons"?: string[];
  tags?: string[];
  aliases?: string[];
  cssclass?: string;
  publish?: boolean;
  linkedFolder?: string;
  "roll-filter"?: boolean;
  "encounter-filter"?: boolean;
  "faction-color"?: string;
  "faction-pattern"?: string;
  "faction-pattern-scale"?: string;
  "faction-pattern-opacity"?: string;
  "faction-outline-width"?: string;
  "region-color"?: string;
  "region-pattern"?: string;
  "region-pattern-scale"?: string;
  "region-pattern-opacity"?: string;
  "region-outline-width"?: string;
}

/**
 * Set a top-level string field in raw note text before the note is written,
 * adding a frontmatter block if there isn't one. Used when bulk-creating hex
 * notes so each note is written once rather than created then patched.
 */
export function withFrontmatterField(content: string, key: string, value: string): string {
  const yaml = /^[\w][\w .()/-]*$/.test(value) && !value.endsWith(" ") ? value : JSON.stringify(value);
  const line = `${key}: ${yaml}`;
  const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(content);
  if (!m) return `---\n${line}\n---\n${content}`;
  const body = m[1];
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*$`, "m");
  const newBody = keyRe.test(body) ? body.replace(keyRe, line) : body ? `${body}\n${line}` : line;
  return `---\n${newBody}\n---${m[2]}${content.slice(m[0].length)}`;
}

export function getFrontMatter(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter as Frontmatter;
  return frontmatter;
}

/**
 * Pure extractors that read already-fetched frontmatter. The hex-grid render
 * loop fetches frontmatter ONCE per hex (getAbstractFileByPath + getFileCache)
 * and feeds it to all three — instead of calling the three `*FromFile` helpers
 * below, which each re-fetch the same cache (3× the lookups per hex, ~11.5k
 * redundant ops on a 3843-hex map).
 */
export function terrainFromFm(fm: Frontmatter | null | undefined): string | null {
  return typeof fm?.terrain === "string" ? fm.terrain : null;
}

export function iconOverrideFromFm(fm: Frontmatter | null | undefined): string | null {
  return typeof fm?.icon === "string" ? fm.icon : null;
}

export function gmIconsFromFm(fm: Frontmatter | null | undefined): string[] {
  if (!fm) return [];
  const arr = fm["gm-icons"];
  if (Array.isArray(arr)) {
    return arr.filter((v): v is string => typeof v === "string");
  }
  const legacy = fm["gm-icon"];
  return typeof legacy === "string" ? [legacy] : [];
}

/**
 * Terrain of hex notes this plugin just wrote whose frontmatter Obsidian
 * hasn't indexed yet. Creating a map writes thousands of notes and opens it
 * straight away; without this the first render shows most hexes blank and
 * nothing re-renders when the index catches up. Cleared per note when its
 * metadata arrives (HexmakerPlugin listens for "changed").
 */
const pendingTerrain = new Map<string, string>();

export function notePendingTerrain(path: string, terrain: string): void {
  pendingTerrain.set(path, terrain);
}

export function clearPendingTerrain(path?: string): void {
  if (path === undefined) pendingTerrain.clear();
  else pendingTerrain.delete(path);
}

/** Terrain of a just-written note that isn't indexed yet, if any. */
export function pendingTerrainOf(path: string): string | null {
  return pendingTerrain.get(path) ?? null;
}

export function getTerrainFromFile(app: App, path: string): string | null {
  const fm = getFrontMatter(app, path);
  return fm ? terrainFromFm(fm) : pendingTerrainOf(path);
}

export async function setTerrainInFile(
  app: App,
  path: string,
  terrainKey: string | null,
): Promise<boolean> {
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

export function getFactionColorFromFile(app: App, path: string): string | null {
  const color = getFrontMatter(app, path)?.["faction-color"];
  return typeof color === "string" ? color : null;
}

export async function setFactionColorInFile(
  app: App,
  path: string,
  color: string | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (color === null) {
      delete fm["faction-color"];
    } else {
      fm["faction-color"] = color;
    }
  });
  return true;
}

export function getFactionStyleFromFile(app: App, path: string): OverlayStyle {
  const fm = getFrontMatter(app, path);
  return {
    pattern: normalizeOverlayPatternKey(fm?.["faction-pattern"]),
    scale: normalizeOverlayPatternScale(fm?.["faction-pattern-scale"]),
    opacity: normalizeOverlayPatternOpacity(fm?.["faction-pattern-opacity"]),
    outlineWidth: normalizeOverlayOutlineWidth(fm?.["faction-outline-width"]),
  };
}

export async function setFactionStyleInFile(
  app: App,
  path: string,
  style: Partial<OverlayStyle>,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (style.pattern !== undefined) {
      if (style.pattern === DEFAULT_OVERLAY_PATTERN_KEY) delete fm["faction-pattern"];
      else fm["faction-pattern"] = style.pattern;
    }
    if (style.scale !== undefined) {
      if (style.scale === DEFAULT_OVERLAY_PATTERN_SCALE) delete fm["faction-pattern-scale"];
      else fm["faction-pattern-scale"] = String(style.scale);
    }
    if (style.opacity !== undefined) {
      if (style.opacity === DEFAULT_OVERLAY_PATTERN_OPACITY) delete fm["faction-pattern-opacity"];
      else fm["faction-pattern-opacity"] = String(style.opacity);
    }
    if (style.outlineWidth !== undefined) {
      if (style.outlineWidth === DEFAULT_OVERLAY_OUTLINE_WIDTH) delete fm["faction-outline-width"];
      else fm["faction-outline-width"] = String(style.outlineWidth);
    }
  });
  return true;
}

export function getHexRegionFromFile(app: App, path: string): string | null {
  const region = getFrontMatter(app, path)?.["region"];
  return typeof region === "string" ? region : null;
}

export async function setHexRegionInFile(
  app: App,
  path: string,
  regionName: string | null,
): Promise<boolean> {
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

export function getRegionColorFromFile(app: App, path: string): string | null {
  const color = getFrontMatter(app, path)?.["region-color"];
  return typeof color === "string" ? color : null;
}

export async function setRegionColorInFile(
  app: App,
  path: string,
  color: string | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (color === null) {
      delete fm["region-color"];
    } else {
      fm["region-color"] = color;
    }
  });
  return true;
}

export function getRegionStyleFromFile(app: App, path: string): OverlayStyle {
  const fm = getFrontMatter(app, path);
  return {
    pattern: normalizeOverlayPatternKey(fm?.["region-pattern"]),
    scale: normalizeOverlayPatternScale(fm?.["region-pattern-scale"]),
    opacity: normalizeOverlayPatternOpacity(fm?.["region-pattern-opacity"]),
    outlineWidth: normalizeOverlayOutlineWidth(fm?.["region-outline-width"]),
  };
}

export async function setRegionStyleInFile(
  app: App,
  path: string,
  style: Partial<OverlayStyle>,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (style.pattern !== undefined) {
      if (style.pattern === DEFAULT_OVERLAY_PATTERN_KEY) delete fm["region-pattern"];
      else fm["region-pattern"] = style.pattern;
    }
    if (style.scale !== undefined) {
      if (style.scale === DEFAULT_OVERLAY_PATTERN_SCALE) delete fm["region-pattern-scale"];
      else fm["region-pattern-scale"] = String(style.scale);
    }
    if (style.opacity !== undefined) {
      if (style.opacity === DEFAULT_OVERLAY_PATTERN_OPACITY) delete fm["region-pattern-opacity"];
      else fm["region-pattern-opacity"] = String(style.opacity);
    }
    if (style.outlineWidth !== undefined) {
      if (style.outlineWidth === DEFAULT_OVERLAY_OUTLINE_WIDTH) delete fm["region-outline-width"];
      else fm["region-outline-width"] = String(style.outlineWidth);
    }
  });
  return true;
}

export function getIconOverrideFromFile(app: App, path: string): string | null {
  return iconOverrideFromFm(getFrontMatter(app, path));
}

export async function setIconOverrideInFile(
  app: App,
  path: string,
  icon: string | null,
): Promise<boolean> {
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
 * Legacy single-icon getter — returns the first GM icon if any.
 * Kept for back-compat with code that hasn't migrated to the multi-icon
 * model yet (e.g. on-map painter, which is still single-set). Prefer
 * `getGmIconsFromFile` for any new read site.
 */
export function getGmIconFromFile(app: App, path: string): string | null {
  return getGmIconsFromFile(app, path)[0] ?? null;
}

/**
 * Multi-icon getter — returns the list of GM icons, with duplicates
 * preserved (a user can stack multiple of the same icon for a count).
 *
 * Reads the new array key `gm-icons`. Falls back to the legacy
 * singular key `gm-icon` if present so existing notes Just Work.
 */
export function getGmIconsFromFile(app: App, path: string): string[] {
  return gmIconsFromFm(getFrontMatter(app, path));
}

/**
 * Legacy single-icon writer. Replaces the entire GM icon list with
 * `[icon]` (or clears it when `icon === null`). Used by the on-map
 * paint tool, which is still single-set. The editor uses
 * `setGmIconsInFile` to manage the multi-icon list directly.
 */
export async function setGmIconInFile(
  app: App,
  path: string,
  icon: string | null,
): Promise<boolean> {
  return setGmIconsInFile(app, path, icon === null ? [] : [icon]);
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

// ── Token helpers ─────────────────────────────────────────────────────────────

const VALID_SHAPES: TokenShape[] = ["circle", "square", "hexagon"];
const VALID_SIZES:  TokenSize[]  = ["sm", "md", "lg"];

export function getTokenDataFromCache(app: App, file: TFile): TokenEntry | null {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm?.["token"]) return null;
  const rawShape = fm["token-shape"] as string | undefined;
  const rawSize  = fm["token-size"]  as string | undefined;
  const tokenLink = typeof fm["token-link"] === "string" ? fm["token-link"] : undefined;

  // Resolve display title from the linked note if this is a proxy
  let title = file.basename;
  if (tokenLink) {
    const linked = app.vault.getAbstractFileByPath(tokenLink);
    if (linked instanceof TFile) title = linked.basename;
  }

  return {
    filePath: file.path,
    title,
    tokenLink,
    icon: typeof fm["token-icon"] === "string" ? fm["token-icon"] : undefined,
    hex: typeof fm["token-hex"] === "string" ? fm["token-hex"] : "",
    map: typeof fm["token-map"] === "string" ? fm["token-map"] : "",
    visible: fm["token-visible"] !== false,
    shape: VALID_SHAPES.includes(rawShape as TokenShape)
      ? (rawShape as TokenShape)
      : "circle",
    size: VALID_SIZES.includes(rawSize as TokenSize)
      ? (rawSize as TokenSize)
      : "md",
    color: typeof fm["token-color"] === "string" ? fm["token-color"] : undefined,
    border: typeof fm["token-border"] === "string" ? fm["token-border"] : undefined,
    description: typeof fm["token-description"] === "string" ? fm["token-description"] : undefined,
  };
}

export async function setTokenHex(
  app: App,
  path: string,
  hex: string,
  map: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    fm["token-hex"] = hex;
    fm["token-map"] = map;
  });
}

export async function setTokenVisible(
  app: App,
  path: string,
  visible: boolean,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    fm["token-visible"] = visible;
  });
}

export async function removeTokenFrontmatter(
  app: App,
  path: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    delete fm["token"];
    delete fm["token-icon"];
    delete fm["token-hex"];
    delete fm["token-map"];
    delete fm["token-visible"];
    delete fm["token-shape"];
    delete fm["token-size"];
    delete fm["token-color"];
    delete fm["token-border"];
    delete fm["token-link"];
    delete fm["token-description"];
  });
}

export async function applyTokenFrontmatter(
  app: App,
  path: string,
  data: {
    icon?: string;
    hex?: string;
    map?: string;
    visible?: boolean;
    shape?: TokenShape;
    size?: TokenSize;
    color?: string;
    border?: string;
    tokenLink?: string;
    description?: string;
  },
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    fm["token"] = true;
    if (data.icon !== undefined) {
      if (data.icon) fm["token-icon"] = data.icon;
      else delete fm["token-icon"];
    }
    if (data.hex !== undefined) fm["token-hex"] = data.hex;
    if (data.map !== undefined) fm["token-map"] = data.map;
    if (data.visible !== undefined) fm["token-visible"] = data.visible;
    if (data.shape !== undefined) fm["token-shape"] = data.shape;
    if (data.size !== undefined) fm["token-size"] = data.size;
    if (data.color !== undefined) {
      if (data.color) fm["token-color"] = data.color; else delete fm["token-color"];
    }
    if (data.border !== undefined) {
      if (data.border) fm["token-border"] = data.border; else delete fm["token-border"];
    }
    if (data.tokenLink !== undefined) fm["token-link"] = data.tokenLink;
    if (data.description !== undefined) {
      if (data.description) fm["token-description"] = data.description;
      else delete fm["token-description"];
    }
  });
}

export function getSubmapFromFile(app: App, path: string): string | undefined {
  const val = getFrontMatter(app, path)?.["duckmage-submap"];
  return typeof val === "string" ? val : undefined;
}

export async function setSubmapInFile(
  app: App,
  path: string,
  mapName: string | null,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    if (mapName === null) delete fm["duckmage-submap"];
    else fm["duckmage-submap"] = mapName;
  });
  return true;
}

/**
 * The data stamp written by newer versions (1.6+): data.json carries
 *
 *   "dataFormat": 2,
 *   "savedWith": "1.6.0"
 *
 * and map data moves out of hex notes into one map note per map
 * (`{hexFolder}/{map}/_{map}.md`, frontmatter `hexmaker-map: <number>`).
 *
 * This build only knows format 1 (no stamp: map data in hex-note
 * frontmatter, palettes and paths in data.json). If it opens a vault in a
 * newer format it would show blank, roadless maps and could write map data
 * back into hex notes, so the plugin goes read-only instead (see
 * HexmakerPlugin.newerData).
 *
 * Pure: no Obsidian imports.
 */

/** The highest data format this build understands. */
export const KNOWN_DATA_FORMAT = 1;

/** The data.json key holding the stamp. */
export const DATA_FORMAT_KEY = "dataFormat";

/** What says the vault was updated by a newer version. */
export interface NewerData {
  /** The data format found (2 or more; 2 when only map notes were found). */
  format: number;
  /** data.json's `savedWith`, when there is one. */
  savedWith: string | null;
  /** Where it was found. */
  source: "data.json" | "map note";
}

/** The format a data.json is in: its stamp, or 1 when it has none (1.5.x and earlier). */
export function dataFormatOf(data: Record<string, unknown> | null | undefined): number {
  const v = data?.[DATA_FORMAT_KEY];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** The newer-version stamp in a raw data.json, or null when this build can use it. */
export function newerDataFrom(data: Record<string, unknown> | null | undefined): NewerData | null {
  const format = dataFormatOf(data);
  if (format <= KNOWN_DATA_FORMAT) return null;
  const sw = data?.["savedWith"];
  return {
    format,
    savedWith: typeof sw === "string" && sw.trim() ? sw.trim() : null,
    source: "data.json",
  };
}

/**
 * Is this note text a map note written by a newer version? True when its
 * frontmatter has `hexmaker-map:` with a number (hex notes from unreleased
 * builds may hold a `[[link]]` under the same key; that doesn't count).
 */
export function isMapNoteText(text: string): boolean {
  // \s also drops a byte-order mark.
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\s+/, ""));
  if (!m) return false;
  return /^hexmaker-map\s*:\s*["']?\d+["']?\s*$/m.test(m[1]);
}

/** The persistent notice shown once on load (and on every refused write). */
export function newerDataMessage(n: NewerData): string {
  const version = n.savedWith ? ` (version ${n.savedWith})` : "";
  return (
    `This vault was updated by a newer Hexmap World Creator${version}. ` +
    `Update this device's plugin to keep your maps working; this version won't change your map data.`
  );
}

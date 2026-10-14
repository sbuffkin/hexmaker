/**
 * The data stamp (owner MG7, option B): a number in data.json that says
 * which data format this vault is in, so an older build can tell the vault
 * was updated by a newer one and say so instead of showing blank maps.
 *
 * data.json (plain JSON, next to `savedWith`):
 *
 *   "dataFormat": 2,
 *   "savedWith": "1.6.0"
 *
 * - No `dataFormat` key (or 1): what 1.5.x and earlier wrote. Map data in
 *   hex-note frontmatter, palettes and paths in data.json.
 * - 2: map data in map notes (`{hexFolder}/{map}/_{map}.md`, frontmatter
 *   `hexmaker-map: <map note format>`), palettes in palette notes
 *   (`hexmaker-palette: 1`), hex notes linking their map note under `map:`.
 *
 * A build reads the stamp as: a number greater than the formats it knows =
 * "written by a newer version" (savedWith names it). This build never lowers
 * the stamp it finds (a vault opened by an older device again keeps saying
 * it was updated). Bump DATA_FORMAT when an older build would misread the
 * data a new migration writes, and add the format to the list above and to
 * README.md here.
 *
 * Pure: no Obsidian imports.
 */

/** The data format this build writes. */
export const DATA_FORMAT = 2;

/** The data.json key holding it. */
export const DATA_FORMAT_KEY = "dataFormat";

/** The format a data.json is in: its stamp, or 1 when it has none (1.5.x and earlier). */
export function dataFormatOf(data: Record<string, unknown> | null | undefined): number {
  const v = data?.[DATA_FORMAT_KEY];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Was this data written by a build that knows a newer format than `known`? */
export function writtenByNewer(data: Record<string, unknown> | null | undefined, known = DATA_FORMAT): boolean {
  return dataFormatOf(data) > known;
}

/** The stamp to save: this build's format, or the newer one already there. */
export function stampToSave(current: number | undefined): number {
  return Math.max(DATA_FORMAT, typeof current === "number" && Number.isFinite(current) ? Math.floor(current) : 0);
}

/** The notice when data.json was written by a newer version. */
export function newerDataText(savedWith: unknown, format: number): string {
  const who = typeof savedWith === "string" && savedWith ? `version ${savedWith}` : "a newer version";
  return `this vault was updated by ${who} of the plugin (data format ${format}; this version knows up to ${DATA_FORMAT}). Update the plugin on this device so nothing is misread.`;
}

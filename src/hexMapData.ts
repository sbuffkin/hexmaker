/**
 * The "Map data" callout in a hex note: what the map says about this hex
 * (its map and coordinates, terrain, region, name), written into the note
 * so the raw text shows what the plugin shows.
 *
 *   > [!hexmaker] Map data
 *   > Map: [[_the-coast|the-coast]], hex 0, 1
 *   > Terrain: desert rocky
 *   > Region: Dustbowl
 *   > Name: —
 *
 * A hex with a region map or locations gets "Region map:" / "Locations:"
 * lines too (links to those maps' notes); other hexes don't, so their notes
 * stay as they were.
 *
 * The map note is where these live; the callout is a copy the plugin keeps
 * up to date when it creates the note, opens it in the hex editor, or runs
 * "Update map data in hex notes". The built-in hex template has the
 * callout; notes without one only get it from that command, so a user's
 * own notes and templates aren't changed behind their back.
 *
 * Phase 2: a person may edit Terrain, Region or Name inside the callout.
 * Before the plugin rewrites it, those edits go to the map
 * (`planCalloutImport`), unless the map changed since the callout was
 * written (the map is newer) or the work mode locks the field. What isn't
 * applied stays in the callout as a `Not applied:` line, and lines it can't
 * read as `Not read:` lines, so nothing typed is lost. Overworld hexes get
 * a "Biome:" line too.
 */

export const MAP_DATA_CALLOUT = "[!hexmaker]";

/** Placeholder the built-in template carries until the note is filled in. */
export const MAP_DATA_TEMPLATE = `> ${MAP_DATA_CALLOUT} Map data\n> Filled in from the map by Hexmaker.`;

export interface HexMapDataView {
  /** Map (folder) name, for the link to its map note. */
  map: string;
  /** How the map is shown (its display name). */
  mapLabel: string;
  x: number;
  y: number;
  terrain?: string;
  region?: string;
  name?: string;
  /** The hex's Region map, if any. */
  regionMap?: { map: string; label: string };
  /** The hex's Location maps, in order. */
  locations?: { map: string; label: string }[];
  /** Overworld hexes: the hex's biome, linked to its biome note when it has one. */
  biome?: { label: string; note?: string };
}

const NONE = "—";

/** The callout's lines for this hex. */
export function mapDataLines(d: HexMapDataView): string[] {
  return [
    `> ${MAP_DATA_CALLOUT} Map data`,
    `> Map: [[_${d.map}|${d.mapLabel.replace(/[|[\]]/g, "")}]], hex ${d.x}, ${d.y}`,
    `> Terrain: ${d.terrain || NONE}`,
    `> Region: ${d.region || NONE}`,
    `> Name: ${d.name || NONE}`,
    ...(d.biome ? [`> Biome: ${biomeRef(d.biome)}`] : []),
    ...(d.regionMap ? [`> Region map: ${mapRef(d.regionMap)}`] : []),
    ...(d.locations?.length ? [`> Locations: ${d.locations.map(mapRef).join(", ")}`] : []),
  ];
}

/** A link to a map's note, shown by its label. */
const mapRef = (r: { map: string; label: string }) => `[[_${r.map}|${r.label.replace(/[|[\]]/g, "")}]]`;

/** A biome: a link to its note (shown by its label), or just the label. */
function biomeRef(b: { label: string; note?: string }): string {
  const label = b.label.replace(/[|[\]]/g, "");
  return b.note ? `[[${b.note.replace(/\.md$/i, "")}|${label}]]` : label;
}

interface CalloutSpan { start: number; end: number }

/** The callout's line span (start inclusive, end exclusive), or null. */
function findCallout(lines: string[]): CalloutSpan | null {
  const start = lines.findIndex((l) => /^\s*>\s*\[!hexmaker\]/i.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^\s*>/.test(lines[end])) end++;
  return { start, end };
}

/** Does the note have a Map data callout? */
export function hasMapData(content: string): boolean {
  return findCallout(content.replace(/\r\n?/g, "\n").split("\n")) !== null;
}

/**
 * The note with its Map data callout showing `d`. A note without one is
 * returned unchanged unless `insert`, when the callout goes under the
 * title (or the frontmatter). Unchanged content is returned as is.
 *
 * `Not applied:` / `Not read:` lines already in the callout are kept (they
 * hold what a person typed), followed by any new `notes` (each written as
 * a callout line, skipped when an identical one is already there).
 */
export function setMapData(content: string, d: HexMapDataView, insert = false, notes: string[] = []): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findCallout(lines);
  const kept = span ? lines.slice(span.start + 1, span.end).filter(isKeptLine).map((l) => l.trimEnd()) : [];
  for (const n of notes) {
    const line = `> ${n}`;
    if (!kept.some((k) => sameText(k.replace(/^\s*>\s*/, ""), n))) kept.push(line);
  }
  const block = [...mapDataLines(d), ...kept];
  if (span) {
    const current = lines.slice(span.start, span.end);
    if (current.length === block.length && current.every((l, i) => l.trimEnd() === block[i])) return content;
    lines.splice(span.start, span.end - span.start, ...block);
    return lines.join(eol);
  }
  if (!insert) return content;
  let at = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) at = close + 1;
  }
  const title = lines.findIndex((l, i) => i >= at && /^#\s/.test(l));
  if (title >= 0) at = title + 1;
  // A blank line on each side, unless there already is one.
  const before = at > 0 && lines[at - 1]?.trim() !== "" ? [""] : [];
  const after = lines[at] !== undefined && lines[at].trim() !== "" ? [""] : [];
  lines.splice(at, 0, ...before, ...block, ...after);
  return lines.join(eol);
}

/** The values written in the callout (a person may have edited them), or null without one. */
export function readMapData(content: string): { terrain?: string; region?: string; name?: string } | null {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findCallout(lines);
  if (!span) return null;
  const out: { terrain?: string; region?: string; name?: string } = {};
  for (const l of lines.slice(span.start + 1, span.end)) {
    const m = /^\s*>\s*(terrain|region|name)\s*:\s*(.*?)\s*$/i.exec(l);
    if (!m) continue;
    const v = unlink(m[2]);
    if (v && v !== NONE && v !== "-") out[m[1].toLowerCase() as "terrain" | "region" | "name"] = v;
  }
  return out;
}

// ── Phase 2: hand edits in the callout flow back into the map ─────────────

/** Callout fields a hand edit can change on the map (with the write's work-mode action). */
export const IMPORT_FIELDS = ["terrain", "region", "name"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Every line key the callout writes, lower case → how it's written. */
const KEYS: Record<string, string> = {
  map: "Map", terrain: "Terrain", region: "Region", name: "Name", biome: "Biome", "region map": "Region map", locations: "Locations",
};

/** What a callout shows, key (lower case) → value as written. */
export type MapDataShown = Record<string, string>;

/** Lines that hold what a person typed and are kept as they are. */
const KEPT = /^\s*>\s*(not applied|not read)\s*:/i;
const isKeptLine = (l: string) => KEPT.test(l);
/** The built-in template's placeholder line. */
const PLACEHOLDER = /^filled in from the map by hexmaker\.?$/i;

/** `[[target|alias]]` → alias (or target). */
const unlink = (v: string) => v.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_a, t: string, alias?: string) => alias ?? t).trim();
/** A shown value as compared: no links, spacing or case, and "—"/"-"/"" all mean none. */
function norm(v: string | undefined): string {
  const s = unlink(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return s === NONE || s === "-" || s === "none" ? "" : s;
}
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The values of callout lines (`mapDataLines` output, or a note's callout body). */
export function shownValues(lines: string[]): MapDataShown {
  const out: MapDataShown = {};
  for (const l of lines) {
    const m = /^\s*>\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$/.exec(l);
    if (m && KEYS[m[1].toLowerCase()] && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

export interface CalloutImport {
  /** Hand edits to make on the map: field → value (null = cleared). */
  apply: Partial<Record<ImportField, string | null>>;
  /** Edits that weren't applied, each "Terrain: swamp (why)". */
  notApplied: string[];
  /** Callout lines that couldn't be read, as typed. */
  unreadable: string[];
}

/**
 * What to import from a note's Map data callout. `shown` is what the
 * callout showed when the plugin last wrote it (unknown: nothing is
 * imported, the map wins, as before phase 2); `now` is what it would show
 * now (`shownValues(mapDataLines(view))`).
 *
 * A line counts as edited when it no longer says what was shown. An edit
 * is applied only when the map still has what was shown; when the map has
 * changed since, the map's value is newer and the edit is reported instead.
 * Lines the map owns elsewhere (Map, Biome, Region map, Locations) aren't
 * read back. Lines that aren't `Key: value` for a known key are unreadable.
 * Null without a callout.
 */
export function planCalloutImport(content: string, shown: MapDataShown | undefined, now: MapDataShown): CalloutImport | null {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findCallout(lines);
  if (!span) return null;
  const out: CalloutImport = { apply: {}, notApplied: [], unreadable: [] };
  const typed: MapDataShown = {};
  for (const raw of lines.slice(span.start + 1, span.end)) {
    const body = raw.replace(/^\s*>\s?/, "").trim();
    if (!body || isKeptLine(raw) || PLACEHOLDER.test(body)) continue;
    const m = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(body);
    const key = m?.[1].toLowerCase();
    if (!m || !key || !KEYS[key] || key in typed) { out.unreadable.push(body); continue; }
    typed[key] = m[2].trim();
  }
  if (!shown) return out;
  for (const [key, value] of Object.entries(typed)) {
    if (norm(value) === norm(shown[key]) || norm(value) === norm(now[key])) continue;
    const line = `${KEYS[key]}: ${value || NONE}`;
    if (!(IMPORT_FIELDS as readonly string[]).includes(key)) {
      out.notApplied.push(`${line} (change this on the map)`);
    } else if (norm(now[key]) !== norm(shown[key])) {
      out.notApplied.push(`${line} (the map has changed it to ${unlink(now[key] ?? "") || NONE} since)`);
    } else {
      const v = unlink(value);
      out.apply[key as ImportField] = norm(v) ? v : null;
    }
  }
  return out;
}

/** The notice after importing callout edits, or null when there's nothing to say. */
export function mapDataSyncMessage(where: string, r: { applied: string[]; notApplied: string[]; unreadable: string[] }): string | null {
  const parts: string[] = [];
  if (r.applied.length) parts.push(`Put on the map from the note's Map data: ${r.applied.join("; ")}.`);
  if (r.notApplied.length) parts.push(`Not applied: ${r.notApplied.join("; ")}.`);
  if (r.unreadable.length) parts.push(`${r.unreadable.length} line${r.unreadable.length === 1 ? "" : "s"} in Map data couldn't be read; marked "Not read:" in the note.`);
  return parts.length ? `${where}: ${parts.join(" ")}` : null;
}

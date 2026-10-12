import type { SubmapDefault, TerrainColor } from "../types";
import { impassableNoteCell, parseImpassableCell } from "../impassable";
import { isDerivedCell, parseTerrainTypeCell, terrainTypeCell } from "../terrainTypes";
import { colorCell, isCssColor, parseColorCell, readColor, wrapColorCellsInRows, writtenColor } from "./colorCell";
import { findPathTypesTable, splitRow as splitPathRow } from "./pathTypeTable";
import { ALL_MAP_KINDS, type MapKind } from "../mapKinds";
import { pathLink, refBasename } from "../noteFormats";
import { registry } from "../modules";

// Plain-text palette notes.
//
// A palette is a markdown note whose basename is the palette name and whose
// body holds one terrain per table row:
//
//   | Terrain | Color | Icon | Icon color | Category | Type | Impassable |
//   | --- | --- | --- | --- | --- | --- | --- |
//   | ocean | `#29507f` |  |  | sea | water | (yes) |
//   | crags | `#777777` |  |  |  | (mountains) | yes |
//
// Colours are written as inline code so Obsidian doesn't read `#29507f` as
// a tag; plain, bare-hex and any-case spellings read too (colorCell.ts).
//
// Columns are matched by header name (case-insensitive, any order), so a
// hand-edited or shared note only needs the Terrain and Color columns. The
// Impassable column (yes / no) overrides the terrain type's default for the
// path tool's auto-route (water types are impassable).
//
// Values in parentheses are derived, not chosen: the Impassable default of
// a terrain's type (a blank Type is no type; it is never guessed from the
// name, so nothing is shown there). They're
// written so the note shows what the plugin uses, and read back as unset;
// a hand edit that drops the parentheses makes the value the user's own.
// Older builds read them as unset too ("(yes)" isn't a yes/no, "(mountains)"
// isn't a type, so the name is used as before). Text outside the table is the
// user's and is preserved when the plugin rewrites the table after an in-app
// edit.

/** Frontmatter key written into every palette note (informational only). */
export const PALETTE_NOTE_MARKER = "hexmaker-palette";

const HEADERS = ["Terrain", "Color", "Icon", "Icon color", "Category", "Type", "Impassable"] as const;

type Column = "name" | "color" | "icon" | "iconColor" | "category" | "type" | "impassable";

function columnFor(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ");
  if (h === "terrain" || h === "name") return "name";
  if (h === "color" || h === "colour") return "color";
  if (h === "icon") return "icon";
  if (h === "icon color" || h === "icon colour" || h === "tint") return "iconColor";
  if (h === "category") return "category";
  if (h === "type" || h === "terrain type") return "type";
  if (h === "impassable") return "impassable";
  return null;
}

/** Characters Obsidian/Windows/macOS reject (or treat specially) in a note name. */
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Palette name → a basename that is legal on every platform Obsidian runs on. */
export function paletteFileName(name: string): string {
  const cleaned = name
    .replace(UNSAFE_NAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned || "Palette";
}

/** Split a markdown table row into cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

interface TableSpan {
  start: number; // index of the header line
  end: number; // index one past the last body row
  headers: string[];
  columns: (Column | null)[];
}

/** Locate the first table with a Terrain (or Name) and a Color column. */
function findPaletteTable(lines: string[]): TableSpan | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    if (!SEPARATOR_ROW.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]);
    const columns = headers.map(columnFor);
    if (!columns.includes("name") || !columns.includes("color")) continue;
    // A path-types table (Width / Style / Routing) is not the terrain table.
    if (headers.some((h) => /^(width|style|line style|routing)$/i.test(h.trim()))) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, headers, columns };
  }
  return null;
}

/** Columns the plugin doesn't know (the user's own), with each row's cells by terrain name. */
function extraColumns(lines: string[], span: TableSpan): { headers: string[]; rows: Map<string, Record<string, string>> } {
  const headers = span.headers.filter((h, i) => span.columns[i] === null && h !== "");
  const rows = new Map<string, Record<string, string>>();
  if (!headers.length) return { headers, rows };
  const nameAt = span.columns.indexOf("name");
  for (let i = span.start + 2; i < span.end; i++) {
    const cells = splitRow(lines[i]);
    const name = cells[nameAt]?.trim().toLowerCase();
    if (!name) continue;
    const own: Record<string, string> = {};
    span.headers.forEach((h, idx) => { if (span.columns[idx] === null && h && cells[idx]) own[h] = cells[idx]; });
    rows.set(name, own);
  }
  return { headers, rows };
}

/**
 * Parse the terrain table out of a palette note. Returns null when the note
 * has no recognisable palette table (so callers can tell "not a palette"
 * apart from "a palette with zero terrains").
 */
export function parsePaletteNote(content: string): TerrainColor[] | null {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findPaletteTable(lines);
  if (!span) return null;
  const terrains: TerrainColor[] = [];
  for (let i = span.start + 2; i < span.end; i++) {
    const cells = splitRow(lines[i]);
    const row: Partial<Record<Column, string>> = {};
    span.columns.forEach((col, idx) => {
      if (col && cells[idx]) row[col] = cells[idx];
    });
    if (!row.name) continue;
    // A colour that can't be read is drawn grey and kept as typed (unreadColor).
    const entry: TerrainColor = { name: row.name, ...readColor(row.color) };
    if (row.icon) entry.icon = row.icon;
    const iconColor = parseColorCell(row.iconColor);
    if (iconColor) entry.iconColor = iconColor;
    if (row.category) entry.category = row.category;
    // A type typed by hand in any case, or as its label, reads as its id;
    // a derived "(mountains)" is unset; anything else is kept as typed (and
    // shows as untyped).
    const type = parseTerrainTypeCell(row.type);
    if (type) entry.type = type;
    const impassable = parseImpassableCell(row.impassable);
    if (impassable !== undefined) entry.impassable = impassable;
    terrains.push(entry);
  }
  return terrains;
}

function escapeCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Serialize terrains as the canonical markdown table. Unset Type and
 * Impassable cells show the derived value in parentheses.
 */
export function serializePaletteTable(
  terrains: TerrainColor[],
  extra?: { headers: string[]; rows: Map<string, Record<string, string>> },
): string {
  const own = extra?.headers ?? [];
  const headers: string[] = [...HEADERS, ...own];
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const t of terrains) {
    const values = [t.name, colorCell(writtenColor(t)), t.icon, colorCell(t.iconColor), t.category, terrainTypeCell(t), impassableNoteCell(t)];
    const mine = extra?.rows.get(t.name.toLowerCase()) ?? {};
    for (const h of own) values.push(mine[h]);
    const cells = values.map(escapeCell);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;
const CHILD_PALETTE_LINE = /^child-palette:[^\n]*(\n|$)/m;

/** The `child-palette:` frontmatter value (palette suggested for submaps). */
export function readChildPalette(content: string): string | undefined {
  const fm = FRONTMATTER.exec(content.replace(/\r\n?/g, "\n"));
  if (!fm) return undefined;
  const m = /^child-palette:\s*(.*)$/m.exec(fm[1]);
  if (!m) return undefined;
  const raw = m[1].trim();
  const unquoted = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  // A link to the palette's note (`[[world/palettes/Space - System]]`) or its name.
  return refBasename(unquoted) || undefined;
}

/**
 * The `child-palette:` value to write: a link to the palette's note when
 * it has one (`note`, its vault path), else the name as typed.
 */
export function childPaletteValue(value: string, note?: string): string {
  const link = pathLink(note);
  return link && refBasename(link) === value ? link : value;
}

/**
 * Set or clear `child-palette:` in the note's frontmatter (a link when
 * `note`, the child palette's note path, is given). Returns the content
 * untouched when it already holds that value (so a CRLF note isn't
 * rewritten just to normalise line endings).
 */
export function setChildPalette(content: string, value: string | undefined, note?: string): string {
  if (readChildPalette(content) === (value || undefined)) return content;
  const text = content.replace(/\r\n?/g, "\n");
  const line = value ? `child-palette: ${JSON.stringify(childPaletteValue(value, note))}\n` : "";
  const fm = FRONTMATTER.exec(text);
  if (!fm) return value ? `---\n${line}---\n${text}` : text;
  let body = fm[1] + "\n";
  body = CHILD_PALETTE_LINE.test(body) ? body.replace(CHILD_PALETTE_LINE, line) : body + line;
  return `---\n${body}---${fm[2]}${text.slice(fm[0].length)}`;
}

const MAP_KIND_LINE = /^map-kind:[^\n]*(\n|$)/m;

/**
 * The `map-kind:` frontmatter value: the map type the palette is for
 * ("world", "space"; see TerrainPalette.kind). Any other value reads as
 * unset (the type is then worked out from the terrain types).
 */
export function readPaletteKind(content: string): MapKind | undefined {
  const fm = FRONTMATTER.exec(content.replace(/\r\n?/g, "\n"));
  if (!fm) return undefined;
  const m = /^map-kind:\s*(.*)$/m.exec(fm[1]);
  if (!m) return undefined;
  const raw = m[1].trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  return (ALL_MAP_KINDS).includes(raw) ? (raw) : undefined;
}

/** Set or clear `map-kind:` in the note's frontmatter (untouched when it already says so). */
export function setPaletteKind(content: string, value: MapKind | undefined): string {
  if (readPaletteKind(content) === value) return content;
  const text = content.replace(/\r\n?/g, "\n");
  const line = value ? `map-kind: ${value}\n` : "";
  const fm = FRONTMATTER.exec(text);
  if (!fm) return value ? `---\n${line}---\n${text}` : text;
  let body = fm[1] + "\n";
  body = MAP_KIND_LINE.test(body) ? body.replace(MAP_KIND_LINE, line) : body + line;
  return `---\n${body}---${fm[2]}${text.slice(fm[0].length)}`;
}

// ── Submap defaults table ────────────────────────────────────────────────
//
//   ## Submap defaults
//   | Terrain | Palette | Size | Generator | Options | Base terrain |
//   | ocean world | Space - System | 13x13 | procedural:orbits | bodies=normal | void |
//
// Optional per-terrain setup for new submaps (see SubmapDefault). Any cell
// may be blank. Recognised by its Terrain + Generator header columns, so it
// never collides with the terrain table (Terrain + Color).

const SUBMAP_HEADING = "## Submap defaults";
const SUBMAP_HEADERS = ["Terrain", "Palette", "Size", "Generator", "Options", "Base terrain"] as const;

type SubmapColumn = "terrain" | "palette" | "size" | "generator" | "options" | "base";

function submapColumnFor(header: string): SubmapColumn | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ");
  if (h === "terrain") return "terrain";
  if (h === "palette") return "palette";
  if (h === "size") return "size";
  if (h === "generator") return "generator";
  if (h === "options") return "options";
  if (h === "base terrain" || h === "base") return "base";
  return null;
}

function findSubmapTable(lines: string[]): { start: number; end: number; columns: (SubmapColumn | null)[] } | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    if (!SEPARATOR_ROW.test(lines[i + 1])) continue;
    const columns = splitRow(lines[i]).map(submapColumnFor);
    if (!columns.includes("terrain") || !columns.includes("generator")) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, columns };
  }
  return null;
}

function parseOptions(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;,]/)) {
    const m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(part);
    if (m && m[1]) out[m[1]] = m[2];
  }
  return Object.keys(out).length ? out : undefined;
}

/** The "Submap defaults" table, or undefined when the note has none (or it's empty). */
export function readSubmapDefaults(content: string): Record<string, SubmapDefault> | undefined {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findSubmapTable(lines);
  if (!span) return undefined;
  const out: Record<string, SubmapDefault> = {};
  for (let i = span.start + 2; i < span.end; i++) {
    const cells = splitRow(lines[i]);
    const row: Partial<Record<SubmapColumn, string>> = {};
    span.columns.forEach((col, idx) => {
      if (col && cells[idx]) row[col] = cells[idx];
    });
    if (!row.terrain) continue;
    const d: SubmapDefault = {};
    if (row.palette) d.palette = row.palette;
    const size = row.size ? /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(row.size) : null;
    if (size) { d.cols = Number(size[1]); d.rows = Number(size[2]); }
    if (row.generator) d.generator = row.generator;
    const opts = row.options ? parseOptions(row.options) : undefined;
    if (opts) d.options = opts;
    if (row.base) d.baseTerrain = row.base;
    out[row.terrain] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

export function serializeSubmapDefaults(defaults: Record<string, SubmapDefault>): string {
  const lines = [
    `| ${SUBMAP_HEADERS.join(" | ")} |`,
    `| ${SUBMAP_HEADERS.map(() => "---").join(" | ")} |`,
  ];
  for (const [terrain, d] of Object.entries(defaults)) {
    const size = d.cols && d.rows ? `${d.cols}x${d.rows}` : "";
    const opts = d.options ? Object.entries(d.options).map(([k, v]) => `${k}=${v}`).join("; ") : "";
    const cells = [terrain, d.palette, size, d.generator, opts, d.baseTerrain].map(escapeCell);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Order-independent comparison key for defaults (undefined ≡ empty). */
export function submapDefaultsKey(d: Record<string, SubmapDefault> | undefined): string {
  if (!d) return "";
  const norm = Object.keys(d).sort().map((t) => {
    const v = d[t];
    const opts = v.options ? Object.keys(v.options).sort().map((k) => [k, v.options![k]]) : [];
    return [t, v.palette ?? "", v.cols ?? 0, v.rows ?? 0, v.generator ?? "", opts, v.baseTerrain ?? ""];
  });
  const key = JSON.stringify(norm.filter((r) => (r as unknown[]).slice(1).some((x) => x !== "" && x !== 0 && !(Array.isArray(x) && x.length === 0))));
  return key === "[]" ? "" : key;
}

/**
 * Write (or remove) the "Submap defaults" table. Returns the content
 * untouched when it already holds these defaults.
 */
export function setSubmapDefaults(content: string, defaults: Record<string, SubmapDefault> | undefined): string {
  if (submapDefaultsKey(readSubmapDefaults(content)) === submapDefaultsKey(defaults)) return content;
  const text = content.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const span = findSubmapTable(lines);
  const empty = submapDefaultsKey(defaults) === "";
  if (span) {
    if (empty) {
      // Drop the table, plus our heading and intro text when the nearest
      // heading above the table is "## Submap defaults".
      let start = span.start;
      for (let i = span.start - 1; i >= 0; i--) {
        if (!lines[i].startsWith("#")) continue;
        if (lines[i].trim() === SUBMAP_HEADING) start = i;
        break;
      }
      while (start > 0 && lines[start - 1].trim() === "") start--;
      const rest = lines.slice(span.end);
      while (rest.length && rest[0].trim() === "") rest.shift();
      const kept = [...lines.slice(0, start), ...(rest.length ? ["", ...rest] : [""])];
      return kept.join("\n");
    }
    return [...lines.slice(0, span.start), serializeSubmapDefaults(defaults!), ...lines.slice(span.end)].join("\n");
  }
  if (empty) return content;
  const base = text.endsWith("\n") ? text : text + "\n";
  return (
    base +
    `\n${SUBMAP_HEADING}\n\n` +
    `New submaps made from a hex of these terrains start with these choices (generator ids: ${["blank", ...registry.submapGeneratorIds(), "wfc:<generator note path>"].join(", ")}).\n\n` +
    serializeSubmapDefaults(defaults!) +
    "\n"
  );
}

/** A complete new palette note. */
export function buildPaletteNote(terrains: TerrainColor[], childPalette?: string, kind?: MapKind, childNote?: string): string {
  return [
    "---",
    `${PALETTE_NOTE_MARKER}: 1`,
    ...(childPalette ? [`child-palette: ${JSON.stringify(childPaletteValue(childPalette, childNote))}`] : []),
    ...(kind ? [`map-kind: ${kind}`] : []),
    "---",
    "",
    "Hexmap World Creator terrain palette. The note name is the palette name. Each table row is one terrain:",
    "colors are any CSS color (in backticks, like `#3b82f6`, so they aren't read as tags), icons are file names from the icon picker, categories group",
    "terrains in the picker, and the type says what a terrain is (water, forest, star…) for",
    "generators and the hex table. Edit here, in the palette editor, or from the terrain tool on",
    "the hex map. Copy this note into another vault's palettes folder to share it.",
    "",
    serializePaletteTable(terrains),
    "",
  ].join("\n");
}

/**
 * Rewrite only the terrain table inside an existing note, keeping any
 * frontmatter, prose and columns the user added. A note with no terrain
 * table gets one added at the end; only an empty note is built from scratch.
 */
export function updatePaletteNote(content: string, terrains: TerrainColor[]): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return buildPaletteNote(terrains);
  const lines = normalized.split("\n");
  const span = findPaletteTable(lines);
  if (!span) return `${normalized.replace(/\n*$/, "")}\n\n${serializePaletteTable(terrains)}\n`;
  return [
    ...lines.slice(0, span.start),
    serializePaletteTable(terrains, extraColumns(lines, span)),
    ...lines.slice(span.end),
  ].join("\n");
}

/**
 * True when the note's derived cells (blank or parenthesised Type and
 * Impassable values) don't show what the plugin works out now, or the
 * Impassable column is missing: e.g. a note from an older build, or a hand
 * edit that changed a terrain's type. Cells a person filled in are theirs
 * and never count as stale.
 */
export function paletteDerivedStale(content: string): boolean {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findPaletteTable(lines);
  if (!span) return false;
  const typeAt = span.columns.indexOf("type");
  const impassableAt = span.columns.indexOf("impassable");
  if (impassableAt < 0 || typeAt < 0) return true;
  const terrains = parsePaletteNote(content) ?? [];
  const nameAt = span.columns.indexOf("name");
  let k = 0;
  for (let i = span.start + 2; i < span.end; i++) {
    const cells = splitRow(lines[i]);
    if (!cells[nameAt]) continue;
    const t = terrains[k++];
    if (!t) break;
    const derivedOk = (raw: string | undefined, expected: string) => {
      const v = (raw ?? "").trim();
      return (v !== "" && !isDerivedCell(v)) || v === expected;
    };
    if (!derivedOk(cells[typeAt], terrainTypeCell(t))) return true;
    if (!derivedOk(cells[impassableAt], impassableNoteCell(t))) return true;
  }
  return false;
}

/**
 * The note with its derived cells brought up to date (the table rewritten
 * from what it says), or unchanged when they already are.
 */
export function refreshPaletteDerived(content: string): string {
  const wrapped = wrapPaletteColors(content);
  if (!paletteDerivedStale(wrapped)) return wrapped;
  const terrains = parsePaletteNote(wrapped);
  return terrains ? updatePaletteNote(wrapped, terrains) : wrapped;
}

/**
 * The note with the terrain table's Color and Icon color cells written as
 * inline code (`` `#14223d` ``), so Obsidian doesn't read them as tags. Only
 * those cells change: every other character, line endings included, is kept.
 * Unchanged (the same string) when they already are.
 */
export function wrapPaletteColors(content: string): string {
  const lines = content.split("\n");
  const span = findPaletteTable(lines.map((l) => l.replace(/\r$/, "")));
  if (!span) return content;
  const cols = span.columns.flatMap((c, i) => (c === "color" || c === "iconColor" ? [i] : []));
  const rows = Array.from({ length: span.end - span.start - 2 }, (_, k) => span.start + 2 + k);
  return wrapColorCellsInRows(lines, rows, cols) ? lines.join("\n") : content;
}

/** A colour cell in a palette note that isn't a colour as typed. */
export interface PaletteColorIssue {
  /** The terrain or path type the row is for. */
  row: string;
  column: "Color" | "Icon color";
  /** The cell as typed (backticks taken off). */
  text: string;
  /** The colour it was read as (a safe fix), or undefined when it can't be read (drawn grey). */
  fixed?: string;
}

/**
 * Colour cells in the terrain and path types tables that aren't a CSS
 * colour as typed: each one either has a single safe reading (`fixed`,
 * used and written back) or can't be read (kept as typed, drawn grey).
 */
export function paletteColorIssues(content: string): PaletteColorIssue[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: PaletteColorIssue[] = [];
  const check = (row: string, column: PaletteColorIssue["column"], raw: string | undefined) => {
    const text = (raw ?? "").trim().replace(/^`+/, "").replace(/`+$/, "").trim();
    if (!text || isCssColor(text) || /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(text)) return;
    const read = parseColorCell(text);
    out.push(isCssColor(read) ? { row, column, text, fixed: read } : { row, column, text });
  };
  const span = findPaletteTable(lines);
  if (span) {
    const at = (c: Column) => span.columns.indexOf(c);
    for (let i = span.start + 2; i < span.end; i++) {
      const cells = splitRow(lines[i]);
      const name = cells[at("name")]?.trim();
      if (!name) continue;
      check(name, "Color", cells[at("color")]);
      if (at("iconColor") >= 0) check(name, "Icon color", cells[at("iconColor")]);
    }
  }
  const paths = findPathTypesTable(lines);
  if (paths && paths.columns.includes("name") && paths.columns.includes("color")) {
    for (let i = paths.start + 2; i < paths.end; i++) {
      const cells = splitPathRow(lines[i]);
      const name = cells[paths.columns.indexOf("name")]?.trim();
      if (name) check(name, "Color", cells[paths.columns.indexOf("color")]);
    }
  }
  return out;
}

/** "forest: "blu"; Road: "#12g"" (the unreadable ones), for a notice. */
export function colorIssuesText(issues: readonly PaletteColorIssue[]): string {
  return issues.map((i) => `${i.row}${i.column === "Icon color" ? " (icon)" : ""}: "${i.text}"${i.fixed ? ` → ${i.fixed}` : ""}`).join("; ");
}

/** Structural equality used to skip no-op rewrites. */
export function terrainsEqual(a: TerrainColor[], b: TerrainColor[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const u = b[i];
    return (
      t.name === u.name &&
      t.color === u.color &&
      (t.unreadColor ?? "") === (u.unreadColor ?? "") &&
      (t.icon ?? "") === (u.icon ?? "") &&
      (t.iconColor ?? "") === (u.iconColor ?? "") &&
      (t.category ?? "") === (u.category ?? "") &&
      (t.type ?? "") === (u.type ?? "") &&
      t.impassable === u.impassable
    );
  });
}

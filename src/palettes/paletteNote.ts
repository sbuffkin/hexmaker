import type { TerrainColor } from "../types";

// Plain-text palette notes.
//
// A palette is a markdown note whose basename is the palette name and whose
// body holds one terrain per table row:
//
//   | Terrain | Color | Icon | Icon color | Category |
//   | --- | --- | --- | --- | --- |
//   | ocean | #29507f |  |  | sea |
//
// Columns are matched by header name (case-insensitive, any order), so a
// hand-edited or shared note only needs the Terrain and Color columns. Text
// outside the table is the user's and is preserved when the plugin rewrites
// the table after an in-app edit.

/** Frontmatter key written into every palette note (informational only). */
export const PALETTE_NOTE_MARKER = "hexmaker-palette";

const HEADERS = ["Terrain", "Color", "Icon", "Icon color", "Category"] as const;

type Column = "name" | "color" | "icon" | "iconColor" | "category";

function columnFor(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ");
  if (h === "terrain" || h === "name") return "name";
  if (h === "color" || h === "colour") return "color";
  if (h === "icon") return "icon";
  if (h === "icon color" || h === "icon colour" || h === "tint") return "iconColor";
  if (h === "category") return "category";
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
  columns: (Column | null)[];
}

/** Locate the first table with a Terrain (or Name) and a Color column. */
function findPaletteTable(lines: string[]): TableSpan | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    if (!SEPARATOR_ROW.test(lines[i + 1])) continue;
    const columns = splitRow(lines[i]).map(columnFor);
    if (!columns.includes("name") || !columns.includes("color")) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, columns };
  }
  return null;
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
    const entry: TerrainColor = { name: row.name, color: row.color || "#888888" };
    if (row.icon) entry.icon = row.icon;
    if (row.iconColor) entry.iconColor = row.iconColor;
    if (row.category) entry.category = row.category;
    terrains.push(entry);
  }
  return terrains;
}

function escapeCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Serialize terrains as the canonical five-column markdown table. */
export function serializePaletteTable(terrains: TerrainColor[]): string {
  const lines = [
    `| ${HEADERS.join(" | ")} |`,
    `| ${HEADERS.map(() => "---").join(" | ")} |`,
  ];
  for (const t of terrains) {
    const cells = [t.name, t.color, t.icon, t.iconColor, t.category].map(escapeCell);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** A complete new palette note. */
export function buildPaletteNote(terrains: TerrainColor[]): string {
  return [
    "---",
    `${PALETTE_NOTE_MARKER}: 1`,
    "---",
    "",
    "Hexmaker terrain palette. The note name is the palette name. Each table row is one terrain:",
    "colors are any CSS color, icons are file names from the icon picker, and categories group",
    "terrains in the picker. Edit here or from the terrain tool on the hex map. Copy this note",
    "into another vault's palettes folder to share it.",
    "",
    serializePaletteTable(terrains),
    "",
  ].join("\n");
}

/**
 * Rewrite only the terrain table inside an existing note, keeping any
 * frontmatter and prose the user added. Falls back to a fresh note when the
 * existing content has no palette table.
 */
export function updatePaletteNote(content: string, terrains: TerrainColor[]): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const span = findPaletteTable(lines);
  if (!span) return buildPaletteNote(terrains);
  return [
    ...lines.slice(0, span.start),
    serializePaletteTable(terrains),
    ...lines.slice(span.end),
  ].join("\n");
}

/** Structural equality used to skip no-op rewrites. */
export function terrainsEqual(a: TerrainColor[], b: TerrainColor[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const u = b[i];
    return (
      t.name === u.name &&
      t.color === u.color &&
      (t.icon ?? "") === (u.icon ?? "") &&
      (t.iconColor ?? "") === (u.iconColor ?? "") &&
      (t.category ?? "") === (u.category ?? "")
    );
  });
}

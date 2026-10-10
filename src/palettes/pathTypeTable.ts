import type { PathLineStyle, PathRouting, PathType } from "../types";
import { parseImpassableCell } from "../impassable";

// The "Path types" section of a palette note: the kinds of path (roads,
// rivers, jump routes…) that maps using this palette can draw.
//
//   ## Path types
//
//   | Path | Color | Width | Style | Routing | Avoid impassable |
//   | --- | --- | --- | --- | --- | --- |
//   | Road | #a16207 | 4 | solid | through | yes |
//   | River | #3b82f6 | 3 | solid | meander | no |
//
// Read forgivingly, since people edit it by hand: columns by name in any
// order (Path or Name, Color or Colour, Style or Line…), values in any case,
// "dashed"/"dash"/"- -" alike, widths clamped to 1–10, a missing column means
// its default. Columns we don't know are kept, row by row, when the table is
// rewritten. Rows we can't use (no name) are reported, not silently lost.

export const PATH_TYPES_HEADING = "## Path types";

export const PATH_TYPES_INTRO =
  "Paths maps on this palette can draw. Width is 1 (thin) to 10 (thick). Style is solid, dashed or dotted. " +
  "Routing is how a path runs between hexes: through (centre to centre), meander (curving across hex edges, " +
  "like a river) or edge (along the hex borders). Avoid impassable is yes or no: whether auto-route goes " +
  "around impassable terrain (blank = yes, except for rivers). To have no path types, delete the rows but keep " +
  "the header line.";

const HEADERS = ["Path", "Color", "Width", "Style", "Routing", "Avoid impassable"] as const;

type Column = "name" | "color" | "width" | "style" | "routing" | "avoid";

function columnFor(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ");
  if (["path", "paths", "path type", "name", "type"].includes(h)) return "name";
  if (h === "color" || h === "colour") return "color";
  if (h === "width" || h === "thickness" || h === "size") return "width";
  if (h === "style" || h === "line" || h === "line style" || h === "linestyle") return "style";
  if (h === "routing" || h === "route" || h === "runs") return "routing";
  if (h.startsWith("avoid")) return "avoid";
  return null;
}

/** A table row split into cells, honouring `\|` escapes. */
export function splitRow(line: string): string[] {
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
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export interface PathTableSpan {
  start: number;
  end: number;
  headers: string[];
  columns: (Column | null)[];
}

/**
 * The path-types table: the first table under a "Path types" heading, or
 * failing that any table with a Path column and a Width, Style or Routing
 * column (so it never matches the terrain table).
 */
export function findPathTypesTable(lines: string[]): PathTableSpan | null {
  const tableAt = (i: number): PathTableSpan | null => {
    if (!lines[i]?.trim().startsWith("|") || !SEPARATOR_ROW.test(lines[i + 1] ?? "")) return null;
    const headers = splitRow(lines[i]);
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, headers, columns: headers.map(columnFor) };
  };
  for (let h = 0; h < lines.length; h++) {
    if (!/^#{1,6}\s+path\s*types?\s*$/i.test(lines[h].trim())) continue;
    for (let i = h + 1; i < lines.length - 1; i++) {
      if (/^#{1,6}\s/.test(lines[i])) break;
      const span = tableAt(i);
      if (span) return span;
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const span = tableAt(i);
    if (!span) continue;
    const c = span.columns;
    // The terrain table never has Width, Style or Routing columns.
    if (c.includes("name") && (c.includes("width") || c.includes("style") || c.includes("routing"))) return span;
  }
  return null;
}

function parseStyle(raw: string | undefined): PathLineStyle {
  const v = (raw ?? "").trim().toLowerCase();
  if (/dot|\.\s*\./.test(v)) return "dotted";
  if (/dash|-\s*-/.test(v)) return "dashed";
  return "solid";
}

function parseRouting(raw: string | undefined, name: string): PathRouting {
  const v = (raw ?? "").trim().toLowerCase();
  if (/meander|curv|wind|river/.test(v)) return "meander";
  if (/edge|border|side/.test(v)) return "edge";
  if (/through|centre|center|straight/.test(v)) return "through";
  return /\b(river|stream|creek)s?\b/i.test(name) ? "meander" : "through";
}

function parseWidth(raw: string | undefined): number {
  const n = Number.parseFloat((raw ?? "").replace(/px$/i, ""));
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export interface ParsedPathTypes {
  types: PathType[];
  /** Unknown columns, per path name, kept when the table is rewritten. */
  extra: Map<string, Record<string, string>>;
  /** Unknown column headers, in the order they appeared. */
  extraHeaders: string[];
  /** Rows that couldn't be read, as typed, for a notice. */
  skipped: string[];
}

/**
 * The note's path types, or null when it has no path-types table we can
 * read (none, or one with no Path/Name column, e.g. a typo in the header):
 * callers then keep the types they had rather than lose them all.
 */
export function parsePathTypes(content: string): ParsedPathTypes | null {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findPathTypesTable(lines);
  if (!span || !span.columns.includes("name")) return null;
  const types: PathType[] = [];
  const extra = new Map<string, Record<string, string>>();
  const extraHeaders = span.headers.filter((_, i) => span.columns[i] === null && span.headers[i] !== "");
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (let i = span.start + 2; i < span.end; i++) {
    const cells = splitRow(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const row: Partial<Record<Column, string>> = {};
    const own: Record<string, string> = {};
    span.columns.forEach((col, idx) => {
      const v = cells[idx] ?? "";
      if (col) { if (v) row[col] = v; }
      else if (span.headers[idx] && v) own[span.headers[idx]] = v;
    });
    const name = row.name?.trim();
    if (!name || seen.has(name.toLowerCase())) {
      skipped.push(lines[i].trim());
      continue;
    }
    seen.add(name.toLowerCase());
    const t: PathType = {
      name,
      color: row.color?.trim() || "#888888",
      width: parseWidth(row.width),
      lineStyle: parseStyle(row.style),
      routing: parseRouting(row.routing, name),
    };
    const avoid = parseImpassableCell(row.avoid);
    if (avoid !== undefined) t.avoidImpassable = avoid;
    types.push(t);
    if (Object.keys(own).length) extra.set(name, own);
  }
  return { types, extra, extraHeaders, skipped };
}

function escapeCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** The table, keeping unknown columns (after ours) and their cells by path name. */
export function serializePathTypes(
  types: PathType[],
  extra?: { headers: string[]; rows: Map<string, Record<string, string>> },
): string {
  const extraHeaders = extra?.headers ?? [];
  const headers = [...HEADERS, ...extraHeaders];
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const t of types) {
    const avoid = t.avoidImpassable === undefined ? "" : t.avoidImpassable ? "yes" : "no";
    const own = extra?.rows.get(t.name) ?? {};
    const cells = [t.name, t.color, String(t.width), t.lineStyle, t.routing, avoid, ...extraHeaders.map((h) => own[h])];
    lines.push(`| ${cells.map(escapeCell).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Order-sensitive comparison key (order is the picker's order). */
export function pathTypesKey(types: PathType[] | undefined): string {
  return JSON.stringify((types ?? []).map((t) => [t.name, t.color, t.width, t.lineStyle, t.routing, t.avoidImpassable ?? null]));
}

/**
 * Write the path-types table into a palette note, replacing the old one in
 * place (unknown columns and the text around it kept) or adding a "Path
 * types" section at the end. Unchanged content is returned as is.
 */
export function setPathTypes(content: string, types: PathType[]): string {
  const parsed = parsePathTypes(content);
  if (parsed && pathTypesKey(parsed.types) === pathTypesKey(types) && !parsed.skipped.length) return content;
  const text = content.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const span = findPathTypesTable(lines);
  if (span) {
    const table = serializePathTypes(types, parsed ? { headers: parsed.extraHeaders, rows: parsed.extra } : undefined);
    // Whatever we couldn't read stays in the note under the table (as an
    // indented block, so it isn't read as a table), so nothing typed is lost.
    const unread = parsed ? parsed.skipped : lines.slice(span.start, span.end).map((l) => l.trim());
    const kept = unread.length
      ? [
          "",
          parsed
            ? "Rows the plugin couldn't read (each needs a name):"
            : "The path types table as it was (its header needs a Path column):",
          "",
          ...unread.map((r) => `    ${r}`),
        ]
      : [];
    return [...lines.slice(0, span.start), table, ...kept, ...lines.slice(span.end)].join("\n");
  }
  const base = text.endsWith("\n") ? text : text + "\n";
  return `${base}\n${PATH_TYPES_HEADING}\n\n${PATH_TYPES_INTRO}\n\n${serializePathTypes(types)}\n`;
}

export const clonePathTypes = (types: readonly PathType[]): PathType[] => types.map((t) => ({ ...t }));

/**
 * Random table notes: parse, roll, die ranges and a writer that only touches
 * the roll table's own lines.
 *
 * The note format (issue #45) is meant to be rolled by hand from raw text:
 *
 *   | d20   | Result  | Weight |
 *   |-------|---------|--------|
 *   | 1–16  | crabmen | 4 |
 *   | 17–20 | mage    | 1 |
 *   | —     | kraken  | 0 |
 *
 * - Columns are found by header name (aliases below), so extra columns and
 *   text around the table are left alone.
 * - What you see in the roll column is what you get: valid stored ranges are
 *   what the plugin rolls. A blank range cell means "fill in from the
 *   weights". Ranges that can't be used are reported, and the table then
 *   rolls by weight.
 * - Older `| Result | Weight |` tables still parse exactly as before.
 *
 * Extensions (plan-tables-everywhere §2.2), all optional and additive; a
 * table without them reads exactly as before:
 * - frontmatter `rows:` what the rows are (text, note, table, generator,
 *   terrain, biome or any; default any). A constraint for checks and
 *   pickers, never a parser switch. Each cell's own kind is worked out
 *   from what it links to (resolve.ts). `terrain-type:` narrows
 *   `rows: terrain` (`star`, or `world, gas-giant`). `shown-as:` is the
 *   default for the Shown as column. `linked-folder:` is read like
 *   `linkedFolder:`.
 * - weights may be decimals (`3.5`, `0.5`) or percentages (`50%` = 0.5).
 * - every column besides the roll, Result and Weight columns is a row
 *   attribute, returned with the roll ({column → cell}). Four of them mean
 *   the same everywhere: Roll (`now` or `on arrival`), Shown as, Once
 *   (`per world` or `per map`) and When (tableConditions.ts).
 * - frontmatter `pick: each`: every row is rolled on its own `Chance`
 *   column (`always`, `1 in 2`, `60%`), not one row by weight ("roll for
 *   each line"); see resolveEach in resolve.ts.
 * - `parseRandomTableWithReport(content, { heading })` reads the table
 *   under a heading (a link like `[[Tundra#Mix]]`).
 *
 * Pure: no Obsidian imports.
 */

import { parseWhen, unreadableConditions, type TableCondition } from "./tableConditions";

/** What a table's rows are (`rows:` in the frontmatter). */
export type RowType = "text" | "note" | "table" | "generator" | "terrain" | "biome" | "any";
export const ROW_TYPES: readonly RowType[] = ["text", "note", "table", "generator", "terrain", "biome", "any"];

/** The four column names with a shared meaning in every table. */
export const SHARED_COLUMNS = ["Roll", "Shown as", "Once", "When"] as const;

export interface RandomTableEntry {
  result: string;
  weight: number;
  isLink?: boolean; // true when the result is a vault-relative note path (written as [[...]])
  /** The row's roll range as typed in the die column. Absent when blank or there's no die column. */
  range?: string;
}

/**
 * What a row says besides its result, weight and range (parallel to the
 * table's entries, so an entry reads exactly as it always did).
 */
export interface RowInfo {
  /** Every other column's non-blank cell, by header as written (shared columns included). */
  attrs?: Record<string, string>;
  /** Roll column: roll it through now (default) or leave it for arrival. */
  roll?: "now" | "on arrival";
  /** Shown as column: what an on-arrival row shows until it is rolled. */
  shownAs?: string;
  /** Once column: the row fires once per world or once per map. */
  once?: "world" | "map";
  /** When column: the row only fits these contexts. */
  when?: TableCondition[];
  /** Chance column of a `pick: each` table (0..1). */
  chance?: number;
}

export interface RandomTable {
  /** Die size: 0 = no die (show % only), 66 = d66. */
  dice: number;
  entries: RandomTableEntry[];
  linkedFolder?: string;
  description?: string; // user-authored blurb shown above the table
  /** `rows:` (absent = any). */
  rows?: RowType;
  /** `terrain-type:` (lower case). */
  terrainTypes?: string[];
  /** `shown-as:`: the default for the Shown as column. */
  shownAs?: string;
  /** `pick: each`: every row rolls its own Chance (absent: one row by weight). */
  pick?: "each";
  /** Per entry (same order): its other columns. Absent when no row has any. */
  rowInfo?: RowInfo[];
}

/** An entry's other columns (an empty object when it has none). */
export function rowInfoOf(table: RandomTable, index: number): RowInfo {
  return table.rowInfo?.[index] ?? {};
}

export type TableIssueCode =
  | "no-table"
  | "result-column-guessed"
  | "die-from-header"
  | "die-mismatch"
  | "weight-unreadable"
  | "range-unreadable"
  | "range-out-of-die"
  | "range-overlap"
  | "range-gap"
  | "range-weight-mismatch"
  | "too-many-rows"
  | "legacy-roller-link"
  | "rows-unknown"
  | "roll-unknown"
  | "once-unknown"
  | "when-unknown"
  | "pick-unknown"
  | "chance-unknown"
  | "heading-missing";

export interface TableIssue {
  code: TableIssueCode;
  message: string;
  /** 1-based entry number the issue is about, when it's about one row. */
  row?: number;
}

/** Where the roll table sits in the note, for the writer. */
export interface TableBlock {
  /** Offset of the header line's first character. */
  start: number;
  /** Offset just past the last table line (before its line break). */
  end: number;
  eol: string;
  /** The table's lines, without line breaks. lines[0] is the header. */
  lines: string[];
  /** Index in lines of the |---| row, or -1. */
  separator: number;
  /** Header cells (trimmed, unescaped). */
  header: string[];
  /** Column indexes; -1 when the column is absent. */
  cols: { range: number; result: number; weight: number };
  /** Every other column (row attributes, shared columns included). */
  extra: number[];
  /** Line indexes (into lines) of the data rows. */
  rows: number[];
  /** For each entry, the index into rows of the row it came from. */
  entryRows: number[];
  /** True when the header names a result, roll or weight column. */
  recognized: boolean;
}

export interface TableReport {
  table: RandomTable;
  issues: TableIssue[];
  block: TableBlock | null;
}

// ── Dice ────────────────────────────────────────────────────────────────────

/** "d20", "d66", or "" for no die. */
export function dieLabel(dice: number): string {
  return dice > 0 ? `d${dice}` : "";
}

/** Every value the die can show, in order. d66 is 11–16, 21–26 … 61–66. */
export function dieFaces(dice: number): number[] {
  if (!(dice > 0)) return [];
  if (dice === 66) {
    const out: number[] = [];
    for (let t = 1; t <= 6; t++) for (let o = 1; o <= 6; o++) out.push(t * 10 + o);
    return out;
  }
  return Array.from({ length: dice }, (_, i) => i + 1);
}

/** Read a die from `20`, `d20`, `1d20`, `d%` or `d66`. 0 when unreadable. */
export function parseDie(text: string): number {
  const m = /^\s*(?:1?d)?(\d+|%)\s*$/i.exec(text.replace(/^["']|["']$/g, ""));
  if (!m) return 0;
  if (m[1] === "%") return 100;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : 0;
}

// ── Header aliases ──────────────────────────────────────────────────────────

const RANGE_HEADER = /^(?:range|roll|die|dice|#|d%|1?d\d+)$/;
const RESULT_HEADER = /^(?:results?|entry|entries|outcome|item)$/;
const WEIGHT_HEADER = /^(?:weights?|w|wt)$/;

function headerKey(cell: string): string {
  return cell.replace(/[*_`]/g, "").trim().toLowerCase();
}

// ── Cells ───────────────────────────────────────────────────────────────────

/**
 * The raw text spans of a table row's cells (between the pipes), honouring
 * `\|` escapes and `|` inside `[[link|alias]]`, like splitTableRow.
 */
export function cellSpans(line: string): { start: number; end: number }[] {
  const first = line.indexOf("|");
  if (first < 0) return [];
  const spans: { start: number; end: number }[] = [];
  let start = first + 1;
  let depth = 0;
  for (let i = first + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") i++;
    else if (ch === "[" && line[i + 1] === "[") { depth++; i++; }
    else if (ch === "]" && line[i + 1] === "]" && depth > 0) { depth--; i++; }
    else if (ch === "|" && depth === 0) {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  if (line.slice(start).trim()) spans.push({ start, end: line.length });
  return spans;
}

/** A row's cells, trimmed and unescaped. */
function rowCells(line: string): string[] {
  return cellSpans(line).map((s) => line.slice(s.start, s.end).trim().replace(/\\\|/g, "|"));
}

function isSeparator(trimmed: string): boolean {
  return /^\|[\s|:-]+\|?$/.test(trimmed) && trimmed.includes("-");
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function frontmatterOf(content: string): { body: string; length: number } | null {
  const m = FRONTMATTER.exec(content);
  return m ? { body: m[1], length: m[0].length } : null;
}

/** The die named by `dice:` in the frontmatter (0 when absent or unreadable). */
export function frontmatterDie(content: string): number {
  const fm = frontmatterOf(content);
  const m = fm ? /^dice:[ \t]*(.*?)[ \t]*$/m.exec(fm.body) : null;
  return m ? parseDie(m[1]) : 0;
}

/** The die named by the roll column's header (0 when there's no such column or it names none). */
export function rangeHeaderDie(block: TableBlock | null): number {
  if (!block || block.cols.range < 0) return 0;
  return parseDie(headerKey(block.header[block.cols.range] ?? "").replace(/^#$/, ""));
}

// ── Locating the roll table ─────────────────────────────────────────────────

interface TableRun {
  start: number;
  end: number;
  lines: string[];
}

/** Every run of table lines outside frontmatter, code fences and callouts. */
function findTableRuns(content: string): TableRun[] {
  const runs: TableRun[] = [];
  const fm = frontmatterOf(content);
  let pos = fm ? fm.length : 0;
  let fence: string | null = null;
  let run: TableRun | null = null;
  while (pos <= content.length) {
    const nl = content.indexOf("\n", pos);
    const lineEnd = nl < 0 ? content.length : nl;
    const textEnd = lineEnd > pos && content[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = content.slice(pos, textEnd);
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    let isRow = false;
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !trimmed.slice(fenceMatch[1].length).trim()) fence = null;
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else if (trimmed.startsWith("|")) {
      isRow = true;
    }
    if (isRow) {
      if (!run) run = { start: pos, end: textEnd, lines: [] };
      run.lines.push(line);
      run.end = textEnd;
    } else if (run) {
      runs.push(run);
      run = null;
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  if (run) runs.push(run);
  return runs;
}

function blockFromRun(run: TableRun, content: string): TableBlock {
  const firstBreak = content.indexOf("\n", run.start);
  const eol =
    firstBreak > 0 && firstBreak <= run.end + 1
      ? content[firstBreak - 1] === "\r" ? "\r\n" : "\n"
      : content.includes("\r\n") ? "\r\n" : "\n";
  let headerIdx = 0;
  // A stray separator before any header is skipped, as before.
  while (headerIdx < run.lines.length - 1 && isSeparator(run.lines[headerIdx].trim())) headerIdx++;
  const lines = run.lines.slice(headerIdx);
  const header = lines.length ? rowCells(lines[0]) : [];
  const keys = header.map(headerKey);
  // "Roll" is both an old name for the die column and the shared Roll
  // column (now / on arrival): with a die column beside it, it's the latter.
  const dieCol = keys.findIndex((k) => RANGE_HEADER.test(k) && k !== "roll");
  let range = dieCol >= 0 ? dieCol : keys.findIndex((k) => RANGE_HEADER.test(k));
  let result = keys.findIndex((k) => RESULT_HEADER.test(k));
  let weight = keys.findIndex((k) => WEIGHT_HEADER.test(k));
  const recognized = range >= 0 || result >= 0 || weight >= 0;
  if (!recognized) {
    // Unknown header: read by position, as before (result, then weight).
    result = 0;
    weight = header.length > 1 ? 1 : -1;
    range = -1;
  } else if (result < 0) {
    result = keys.findIndex((_, i) => i !== range && i !== weight);
  }
  let separator = -1;
  const rows: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (isSeparator(lines[i].trim())) {
      if (separator < 0) separator = i;
      continue;
    }
    rows.push(i);
  }
  // A lone "Roll" column whose cells all say now / on arrival is the
  // shared Roll column, not the die column.
  if (range >= 0 && dieCol < 0) {
    const cells = rows.map((i) => (rowCells(lines[i])[range] ?? "").trim().toLowerCase()).filter((c) => c !== "");
    if (cells.length && cells.every((c) => c in ROLL_WORDS)) range = -1;
  }
  // Offsets: start at the header line.
  let start = run.start;
  for (let i = 0; i < headerIdx; i++) start = content.indexOf("\n", start) + 1;
  const extra = header.map((_, i) => i).filter((i) => i !== range && i !== result && i !== weight && header[i].trim() !== "");
  return { start, end: run.end, eol, lines, separator, header, cols: { range, result, weight }, extra, rows, entryRows: [], recognized };
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * The span of the section under a heading (any level, any case): from the
 * line after it to the next heading of the same or a higher level. Null
 * when the note has no such heading. Headings in code fences don't count.
 */
export function headingSection(content: string, heading: string): { start: number; end: number } | null {
  const want = heading.trim().toLowerCase();
  let pos = frontmatterOf(content)?.length ?? 0;
  let fence: string | null = null;
  let found: { level: number; start: number } | null = null;
  while (pos <= content.length) {
    const nl = content.indexOf("\n", pos);
    const lineEnd = nl < 0 ? content.length : nl;
    const line = content.slice(pos, lineEnd).replace(/\r$/, "");
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (fence) {
      if (f && f[1][0] === fence[0]) fence = null;
    } else if (f) {
      fence = f[1];
    } else {
      const h = HEADING.exec(t);
      if (h) {
        const level = h[1].length;
        if (found && level <= found.level) return { start: found.start, end: pos };
        if (!found && h[2].trim().toLowerCase() === want) found = { level, start: nl < 0 ? content.length : nl + 1 };
      }
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  return found ? { start: found.start, end: content.length } : null;
}

/**
 * The roll table: the first table naming a result, roll or weight column,
 * else the first table. With a heading, only tables in that heading's
 * section count (null when there's no such heading or no table under it).
 */
export function locateRollTable(content: string, heading?: string): TableBlock | null {
  let runs = findTableRuns(content);
  if (heading !== undefined && heading.trim()) {
    const section = headingSection(content, heading);
    if (!section) return null;
    runs = runs.filter((r) => r.start >= section.start && r.start < section.end);
  }
  if (!runs.length) return null;
  const blocks = runs.map((r) => blockFromRun(r, content));
  const pick =
    blocks.find((b) => b.recognized && b.cols.result >= 0 && RESULT_HEADER.test(headerKey(b.header[b.cols.result] ?? ""))) ??
    blocks.find((b) => b.recognized) ??
    blocks[0];
  return pick;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const LEGACY_ROLLER_LINK = /\[[^\]\n]*\]\(obsidian:\/\/duckmage-roll\?[^)\n]*\)/;
const ROLLER_BLOCK = /```duckmage-roller[\s\S]*?```/;

/** Parse a random-table note into a RandomTable (see parseRandomTableWithReport). */
export function parseRandomTable(content: string, opts: ParseOptions = {}): RandomTable {
  return parseRandomTableWithReport(content, opts).table;
}

export interface ParseOptions {
  /** Read the table under this heading (a `[[Note#Heading]]` link) instead of the note's roll table. */
  heading?: string;
}

/** A frontmatter value with outer quotes taken off. */
function fmValue(body: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*\\r?$`, "m").exec(body);
  if (!m) return undefined;
  const raw = m[1].trim();
  return /^"(.*)"$/.exec(raw)?.[1] ?? /^'(.*)'$/.exec(raw)?.[1] ?? raw;
}

/** "3", "3.5", ".5", "50%" → a weight ≥ 0; NaN when unreadable. */
export function readTableWeight(raw: string): number {
  const t = raw.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)\s*%?$/.test(t)) return NaN;
  const n = Number(t.replace(/\s*%$/, ""));
  return t.endsWith("%") ? n / 100 : n;
}

const ROLL_WORDS: Record<string, "now" | "on arrival"> = {
  now: "now", "": "now", generate: "now", "on generate": "now",
  "on arrival": "on arrival", arrival: "on arrival", "on visit": "on arrival", visit: "on arrival", later: "on arrival",
};
const ONCE_WORDS: Record<string, "world" | "map" | undefined> = {
  "": undefined, no: undefined, never: undefined,
  "per world": "world", world: "world", "once per world": "world", yes: "world",
  "per map": "map", map: "map", "once per map": "map",
};

/**
 * Parse a random-table note and report anything that couldn't be read.
 * Nothing the human typed is dropped: an unreadable weight counts as 1 and
 * its text is kept in the note; unreadable ranges make the table roll by
 * weight. See TableIssueCode for what's reported.
 */
export function parseRandomTableWithReport(content: string, opts: ParseOptions = {}): TableReport {
  const issues: TableIssue[] = [];
  let dice = 0;
  let linkedFolder: string | undefined;
  let rows: RowType | undefined;
  let terrainTypes: string[] | undefined;
  let shownAs: string | undefined;
  let pick: "each" | undefined;
  const fm = frontmatterOf(content);
  let fmDice = 0;
  if (fm) {
    const diceMatch = /^dice:[ \t]*(.*?)[ \t]*$/m.exec(fm.body);
    if (diceMatch) fmDice = parseDie(diceMatch[1]);
    const lf = fmValue(fm.body, "linkedFolder") ?? fmValue(fm.body, "linked-folder");
    if (lf !== undefined && lf !== "") {
      const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(lf);
      linkedFolder = wikiLinkMatch ? wikiLinkMatch[1].trim() : lf;
    }
    const rowsRaw = fmValue(fm.body, "rows");
    if (rowsRaw !== undefined && rowsRaw !== "") {
      const r = rowsRaw.toLowerCase().replace(/s$/, "") as RowType;
      if (ROW_TYPES.includes(r)) {
        if (r !== "any") rows = r;
      } else {
        issues.push({ code: "rows-unknown", message: `"rows: ${rowsRaw}" isn't one of ${ROW_TYPES.join(", ")}; reading the rows as any.` });
      }
    }
    const tt = fmValue(fm.body, "terrain-type");
    if (tt) terrainTypes = tt.replace(/^\[|\]$/g, "").split(/\s*,\s*/).map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
    const sa = fmValue(fm.body, "shown-as");
    if (sa) shownAs = sa;
    const pk = fmValue(fm.body, "pick");
    if (pk && /^(?:each|every|all|each row)$/i.test(pk)) pick = "each";
    else if (pk && !/^(?:one|weight|weighted)$/i.test(pk)) issues.push({ code: "pick-unknown", message: `"pick: ${pk}" should be each or one; rolling one row.` });
  }
  dice = fmDice;

  const heading = opts.heading?.trim() ? opts.heading.trim() : undefined;
  const block = locateRollTable(content, heading);

  // Description: text between frontmatter (or the heading) and the table, minus the roller.
  const section = heading ? headingSection(content, heading) : null;
  const afterFmStart = section ? section.start : fm ? fm.length : 0;
  const preambleEnd = block ? block.start : afterFmStart;
  const preambleText = preambleEnd > afterFmStart ? content.slice(afterFmStart, preambleEnd) : "";
  const descriptionRaw = preambleText
    .replace(new RegExp(LEGACY_ROLLER_LINK.source, "g"), "")
    .replace(new RegExp(ROLLER_BLOCK.source, "g"), "")
    .replace(/\r\n/g, "\n")
    .trim();
  const description = descriptionRaw || undefined;
  if (LEGACY_ROLLER_LINK.test(content)) {
    issues.push({ code: "legacy-roller-link", message: "Has an old \"Open in Duckmage Roller\" link; it can be replaced by the roller block." });
  }

  const extras = (t: RandomTable): RandomTable => {
    if (rows) t.rows = rows;
    if (terrainTypes?.length) t.terrainTypes = terrainTypes;
    if (shownAs) t.shownAs = shownAs;
    if (pick) t.pick = pick;
    return t;
  };

  if (!block) {
    if (heading && !section) issues.push({ code: "heading-missing", message: `No heading "${heading}".` });
    issues.push({ code: "no-table", message: heading ? `No table under "${heading}".` : "No table found." });
    return { table: extras({ dice, entries: [], linkedFolder, description }), issues, block };
  }

  const { cols } = block;
  if (block.recognized && cols.result >= 0 && !RESULT_HEADER.test(headerKey(block.header[cols.result] ?? ""))) {
    issues.push({ code: "result-column-guessed", message: `No "Result" column; reading "${block.header[cols.result] ?? ""}" as the result.` });
  }
  if (cols.range >= 0) {
    const headerDie = parseDie(headerKey(block.header[cols.range] ?? "").replace(/^#$/, ""));
    if (headerDie > 0 && fmDice === 0) {
      dice = headerDie;
      issues.push({ code: "die-from-header", message: `No "dice:" in the frontmatter; using the column header (${dieLabel(headerDie)}).` });
    } else if (headerDie > 0 && fmDice > 0 && headerDie !== fmDice) {
      issues.push({ code: "die-mismatch", message: `The frontmatter says ${dieLabel(fmDice)} but the column header says ${dieLabel(headerDie)}; using ${dieLabel(fmDice)}.` });
    }
  }

  const entries: RandomTableEntry[] = [];
  const info: RowInfo[] = [];
  block.rows.forEach((lineIdx, rowIdx) => {
    const cells = rowCells(block.lines[lineIdx]);
    // Strip wiki-link syntax so [[Note Name]] → "Note Name"
    const rawResult = cols.result >= 0 ? (cells[cols.result] ?? "") : "";
    const linkMatch = /^\[\[(.+?)(?:\|[^\]]+)?\]\]$/.exec(rawResult);
    const result = linkMatch ? linkMatch[1] : rawResult;
    if (!result) return;
    const isLink = linkMatch !== null && !linkedFolder; // linkedFolder entries already tracked separately
    const entry: RandomTableEntry = { result, weight: 1, ...(isLink ? { isLink: true } : {}) };
    const rangeText = cols.range >= 0 ? (cells[cols.range] ?? "").trim() : "";
    if (rangeText) entry.range = rangeText;
    if (cols.weight >= 0) {
      const w = (cells[cols.weight] ?? "").trim();
      const n = w ? readTableWeight(w) : NaN;
      if (Number.isFinite(n)) entry.weight = n;
      else if (w) {
        issues.push({ code: "weight-unreadable", row: entries.length + 1, message: `Row ${entries.length + 1} ("${result}"): weight "${w}" isn't a number; counting it as 1.` });
      }
    }
    info.push(readExtras(result, block.extra.map((i): [string, string] => [block.header[i].trim(), (cells[i] ?? "").trim()]), entries.length + 1, issues, pick === "each"));
    entries.push(entry);
    block.entryRows.push(rowIdx);
  });

  // No weight column: each row weighs what its range covers.
  if (cols.weight < 0 && dice > 0) {
    for (const e of entries) {
      if (e.range === undefined) continue;
      const p = parseRangeCell(e.range, dice);
      if (p === "none") e.weight = 0;
      else if (p && !p.outside) e.weight = p.faces.length;
    }
  }

  const table: RandomTable = extras({ dice, entries, linkedFolder, description });
  if (info.some((i) => Object.keys(i).length)) table.rowInfo = info;
  issues.push(...resolveTable(table).issues);
  return { table, issues, block };
}

/** A row's other columns: attributes, and the shared Roll / Shown as / Once / When. */
function readExtras(result: string, cells: [string, string][], rowNo: number, issues: TableIssue[], each = false): RowInfo {
  const entry: RowInfo = {};
  const name = `Row ${rowNo} ("${result}")`;
  for (const [header, cell] of cells) {
    if (!cell) continue;
    (entry.attrs ??= {})[header] = cell;
    const key = headerKey(header);
    if (key === "roll") {
      const r = ROLL_WORDS[cell.toLowerCase()];
      if (r) {
        if (r !== "now") entry.roll = r;
      } else {
        issues.push({ code: "roll-unknown", row: rowNo, message: `${name}: Roll "${cell}" should be now or on arrival; rolling it now.` });
      }
    } else if (key === "shown as") {
      entry.shownAs = cell;
    } else if (key === "once") {
      const k = cell.toLowerCase();
      if (k in ONCE_WORDS) {
        const o = ONCE_WORDS[k];
        if (o) entry.once = o;
      } else {
        issues.push({ code: "once-unknown", row: rowNo, message: `${name}: Once "${cell}" should be per world or per map; the row can repeat.` });
      }
    } else if (key === "chance" && each) {
      const c = readChance(cell);
      if (c !== undefined) entry.chance = c;
      else issues.push({ code: "chance-unknown", row: rowNo, message: `${name}: can't read Chance "${cell}" (like always, 1 in 2 or 60%), so the row never comes up.` });
    } else if (key === "when") {
      const when = parseWhen(cell);
      if (when.length) entry.when = when;
      const bad = unreadableConditions(when);
      if (bad.length) issues.push({ code: "when-unknown", row: rowNo, message: `${name}: can't read When "${bad.join("; ")}", so the row never comes up.` });
    }
  }
  return entry;
}

/**
 * A Chance cell (`pick: each` tables) → 0..1: `always`/`yes` 1, `never`/`no`
 * 0, `1 in 2` or `1/2`, `60%`, or a fraction like `0.6`. Undefined when it
 * can't be read.
 */
export function readChance(raw: string): number | undefined {
  const t = raw.trim().toLowerCase();
  if (/^(?:always|yes|every time)$/.test(t)) return 1;
  if (/^(?:never|no)$/.test(t)) return 0;
  const inM = /^(\d+(?:\.\d+)?)\s*(?:in|\/|out of)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (inM) {
    const n = Number(inM[1]), d = Number(inM[2]);
    return d > 0 && n <= d ? n / d : undefined;
  }
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (pct) return Number(pct[1]) <= 100 ? Number(pct[1]) / 100 : undefined;
  if (/^(?:0|1|0?\.\d+)$/.test(t)) return Number(t);
  return undefined;
}

// ── Ranges ──────────────────────────────────────────────────────────────────

/**
 * Read one range cell: `1–6`, `7-8`, `9`, `10, 12`, `19+`, d100 `01–05` and
 * `00` (= 100), d10 `0` (= 10), `—` (never rolled). null when unreadable;
 * `outside` when a number isn't on the die.
 */
export function parseRangeCell(text: string, dice: number): { faces: number[]; outside: boolean } | "none" | null {
  const t = text.trim();
  if (!t || /^[—–-]+$/.test(t) || /^(?:none|n\/a)$/i.test(t)) return "none";
  const faces = dieFaces(dice);
  if (!faces.length) return null;
  const max = faces[faces.length - 1];
  const num = (s: string): number => {
    const n = parseInt(s, 10);
    if (dice === 100 && n === 0) return 100;
    if (dice === 10 && n === 0) return 10;
    return n;
  };
  const out: number[] = [];
  let outside = false;
  for (const part of t.split(/\s*[,;]\s*/)) {
    let lo: number, hi: number;
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)\s*(?:[–—-]|to|\.\.)\s*(\d+)$/i.exec(part))) {
      lo = num(m[1]);
      hi = num(m[2]);
    } else if ((m = /^(\d+)\s*\+$/.exec(part))) {
      lo = num(m[1]);
      hi = max;
    } else if ((m = /^(\d+)$/.exec(part))) {
      lo = hi = num(m[1]);
    } else return null;
    if (lo > hi) return null;
    if (!faces.includes(lo) || !faces.includes(hi)) outside = true;
    for (const f of faces) if (f >= lo && f <= hi && !out.includes(f)) out.push(f);
  }
  return { faces: out, outside };
}

/** "3–5", "7", or "3–5, 9" for faces that aren't one run (in die order). */
export function facesLabel(faces: number[], dice: number): string {
  if (!faces.length) return "—";
  const all = dieFaces(dice);
  const idx = faces.map((f) => all.indexOf(f)).sort((a, b) => a - b);
  const parts: string[] = [];
  let a = idx[0];
  let b = idx[0];
  const push = () => parts.push(a === b ? String(all[a]) : `${all[a]}–${all[b]}`);
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === b + 1) b = idx[i];
    else {
      push();
      a = b = idx[i];
    }
  }
  push();
  return parts.join(", ");
}

/**
 * How many faces each row gets on a die with `faceCount` faces, by
 * largest remainder. Never more than faceCount in total. Weight 0 gets 0;
 * every other row gets at least 1. When there are more weighted rows than
 * faces, the first faceCount of them get 1 and the rest get 0.
 */
export function allocateFaces(weights: number[], faceCount: number): number[] {
  const counts = weights.map(() => 0);
  const live = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  if (!live.length || faceCount <= 0) return counts;
  if (live.length > faceCount) {
    for (const i of live.slice(0, faceCount)) counts[i] = 1;
    return counts;
  }
  const total = live.reduce((s, i) => s + weights[i], 0);
  const quota = weights.map((w) => (w > 0 ? (w / total) * faceCount : 0));
  for (const i of live) counts[i] = Math.max(1, Math.floor(quota[i]));
  let used = live.reduce((s, i) => s + counts[i], 0);
  while (used > faceCount) {
    // Take back from the row most over its share (that can spare one).
    let best = -1;
    for (const i of live) {
      if (counts[i] <= 1) continue;
      if (best < 0 || counts[i] - quota[i] >= counts[best] - quota[best]) best = i;
    }
    if (best < 0) break;
    counts[best]--;
    used--;
  }
  while (used < faceCount) {
    // Give to the row most under its share.
    let best = live[0];
    for (const i of live) if (quota[i] - counts[i] > quota[best] - counts[best]) best = i;
    counts[best]++;
    used++;
  }
  return counts;
}

/**
 * Die ranges worked out from the weights alone (ignoring stored ranges), as
 * a parallel array of labels. Never past the die: weight 0 and rows that
 * don't fit get "—".
 */
export function getDieRanges(table: RandomTable): string[] {
  const n = table.entries.length;
  if (n === 0) return [];
  const faces = dieFaces(table.dice);
  const counts = allocateFaces(table.entries.map((e) => e.weight), faces.length);
  const labels: string[] = [];
  let cursor = 0;
  for (const c of counts) {
    labels.push(c ? facesLabel(faces.slice(cursor, cursor + c), table.dice) : "—");
    cursor += c;
  }
  return labels;
}

export interface ResolvedTable {
  /** "ranges": roll the die and read the row; "weight": weighted pick. */
  mode: "ranges" | "weight";
  /** Per entry: the range to show (as typed when stored), "—" for never. Empty strings when there's no die. */
  labels: string[];
  /** Per entry: the faces it covers (empty in weight mode or for "—"). */
  faces: number[][];
  /** Every face that lands on a row (ranges mode). */
  covered: number[];
  issues: TableIssue[];
}

/**
 * Work out what each row rolls on. Stored ranges are used as typed; blank
 * ones are filled from the weights over the faces left. If any stored range
 * can't be used, or the rows don't fit the die, the table rolls by weight.
 */
export function resolveTable(table: RandomTable): ResolvedTable {
  const n = table.entries.length;
  const all = dieFaces(table.dice);
  if (!all.length) {
    return { mode: "weight", labels: table.entries.map(() => ""), faces: table.entries.map(() => []), covered: [], issues: [] };
  }
  const issues: TableIssue[] = [];
  const faces: number[][] = table.entries.map(() => []);
  const labels: string[] = table.entries.map(() => "—");
  const owner = new Map<number, number>();
  const pending: number[] = [];
  const stored: number[] = [];
  let broken = false;
  const name = (i: number) => `Row ${i + 1} ("${table.entries[i].result}")`;

  table.entries.forEach((e, i) => {
    if (e.range === undefined || !e.range.trim()) {
      pending.push(i);
      return;
    }
    labels[i] = e.range.trim();
    const p = parseRangeCell(e.range, table.dice);
    if (p === "none") {
      stored.push(i);
      return;
    }
    if (!p) {
      issues.push({ code: "range-unreadable", row: i + 1, message: `${name(i)}: can't read the range "${e.range.trim()}".` });
      broken = true;
      return;
    }
    if (p.outside) {
      issues.push({ code: "range-out-of-die", row: i + 1, message: `${name(i)}: "${e.range.trim()}" goes past the ${dieLabel(table.dice)}.` });
      broken = true;
      return;
    }
    stored.push(i);
    for (const f of p.faces) {
      const prev = owner.get(f);
      if (prev !== undefined) {
        issues.push({ code: "range-overlap", row: i + 1, message: `${name(i)} and row ${prev + 1} both cover ${f}.` });
        broken = true;
      } else owner.set(f, i);
    }
    faces[i] = p.faces;
  });

  // Blank cells: fill from the weights over the faces nobody claimed.
  const remaining = all.filter((f) => !owner.has(f));
  const counts = allocateFaces(pending.map((i) => table.entries[i].weight), remaining.length);
  const livePending = pending.filter((i) => table.entries[i].weight > 0);
  let cursor = 0;
  pending.forEach((i, k) => {
    const c = counts[k];
    faces[i] = remaining.slice(cursor, cursor + c);
    cursor += c;
    labels[i] = c ? facesLabel(faces[i], table.dice) : "—";
  });
  if (livePending.length > remaining.length) {
    const unfit = livePending.length - remaining.length;
    issues.push({
      code: "too-many-rows",
      message: `${n} rows don't fit on a ${dieLabel(table.dice)}: ${unfit} row${unfit === 1 ? "" : "s"} can't get a number. It rolls by weight until the die is bigger.`,
    });
    broken = true;
  }

  if (broken) return { mode: "weight", labels, faces: table.entries.map(() => []), covered: [], issues };

  const covered = all.filter((f) => faces.some((fs) => fs.includes(f)));
  if (covered.length && covered.length < all.length) {
    const gaps = all.filter((f) => !covered.includes(f));
    issues.push({ code: "range-gap", message: `No row covers ${facesLabel(gaps, table.dice)} on the ${dieLabel(table.dice)}; those rolls are rolled again.` });
  }
  if (stored.length) {
    const expected = allocateFaces(table.entries.map((e) => e.weight), all.length);
    const off = stored.filter((i) => expected[i] !== faces[i].length);
    if (off.length) {
      issues.push({
        code: "range-weight-mismatch",
        message: `The ranges and weights disagree (${off.slice(0, 3).map((i) => `"${table.entries[i].result}" covers ${faces[i].length} but weighs ${table.entries[i].weight}`).join("; ")}${off.length > 3 ? "; …" : ""}). Rolls follow the ranges.`,
      });
    }
  }
  if (!covered.length) return { mode: "weight", labels, faces, covered, issues };
  return { mode: "ranges", labels, faces, covered, issues };
}

/** Per-entry odds as "25%", following how the table actually rolls. */
export function rowOdds(table: RandomTable, resolved: ResolvedTable = resolveTable(table)): string[] {
  if (resolved.mode === "ranges") {
    return resolved.faces.map((f) => `${Math.round((f.length / resolved.covered.length) * 100)}%`);
  }
  const total = table.entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  return table.entries.map((e) => (total > 0 ? `${Math.round((Math.max(0, e.weight) / total) * 100)}%` : "–"));
}

// ── Rolling ─────────────────────────────────────────────────────────────────

export interface RollOutcome {
  entry: RandomTableEntry;
  /** Index of the entry in table.entries. */
  index: number;
  /** The die face rolled, when the table rolls by its ranges. */
  face?: number;
}

/**
 * Roll the table. With a die and usable ranges, rolls the die and returns
 * the row whose range holds the face (what you see is what you get);
 * otherwise a weighted pick. Weight-0 rows are never picked.
 */
export function rollTable(table: RandomTable, rng: () => number = Math.random): RollOutcome | null {
  if (table.entries.length === 0) return null;
  const resolved = resolveTable(table);
  if (resolved.mode === "ranges") {
    const face = resolved.covered[Math.min(resolved.covered.length - 1, Math.floor(rng() * resolved.covered.length))];
    const index = resolved.faces.findIndex((f) => f.includes(face));
    if (index >= 0) return { entry: table.entries[index], index, face };
  }
  const live = table.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.weight > 0);
  if (!live.length) return null;
  const total = live.reduce((s, { e }) => s + e.weight, 0);
  let rand = rng() * total;
  for (const { e, i } of live) {
    rand -= e.weight;
    if (rand < 0) return { entry: e, index: i };
  }
  const last = live[live.length - 1];
  return { entry: last.e, index: last.i };
}

/** Weighted random selection (see rollTable). Returns a random entry. */
export function rollOnTable(table: RandomTable): RandomTableEntry | null {
  return rollTable(table)?.entry ?? null;
}

/** "d20 → 14" for a roll by ranges, "" for a weighted pick. */
export function rollLabel(table: RandomTable, outcome: RollOutcome): string {
  return outcome.face !== undefined ? `${dieLabel(table.dice)} → ${outcome.face}` : "";
}

/** Return "25%" or "1–4" die range label for a single entry. */
export function getOddsLabel(
  entry: RandomTableEntry,
  table: RandomTable,
): string {
  const total = table.entries.reduce((s, e) => s + e.weight, 0);
  if (total === 0) return "–";
  if (table.dice <= 0) {
    return `${Math.round((entry.weight / total) * 100)}%`;
  }
  return ""; // caller uses getDieRanges for full table
}

// ── Other readers ───────────────────────────────────────────────────────────

/**
 * Extract entries from markdown content.
 * Primary: bullet/numbered list items (strips task-list markers).
 * Fallback: when no list markers are found, each non-empty non-structural line
 * (skipping headings, frontmatter, horizontal rules, table rows, code fences).
 */
export function parseMarkdownListItems(content: string): string[] {
  const results: string[] = [];
  const re = /^[ \t]*(?:[-*+]|\d+[.)]) +(.+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    let item = m[1].trim();
    item = item.replace(/^\[[ xX]\] /, "");
    if (item) results.push(item);
  }
  if (results.length > 0) return results;

  // Fallback: plain line-per-entry files (e.g. a word list)
  const noFm = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let inFence = false;
  for (const line of noFm.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence || !t) continue;
    if (t.startsWith("#") || t.startsWith("|") || /^[-*_]{3,}$/.test(t)) continue;
    results.push(t);
  }
  return results;
}

/**
 * What to tell the user when a table has nothing to roll (parseRandomTable
 * found no entries). Setup creates terrain tables with an empty row, so the
 * usual case is "not filled in yet", not a broken format (fresh-eyes E6: the
 * old "Check the table format." read as if the user had broken something).
 */
export function emptyTableMessage(content: string): string {
  return locateRollTable(content)
    ? "This table has no entries yet. Add some results to roll on it."
    : "This note has no table to roll on yet. Add some entries to start one.";
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** Update the `dice` value in a table file's YAML frontmatter. */
export function setDiceInFrontmatter(content: string, dice: number): string {
  const fmRegex = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---)/;
  const diceLine = dice > 0 ? `dice: ${dice}` : "";

  const match = fmRegex.exec(content);
  if (match) {
    const eol = match[1].endsWith("\r\n") ? "\r\n" : "\n";
    const existingFm = match[2];
    const hasDiceLine = /^dice:/m.test(existingFm);
    let newFm: string;
    if (hasDiceLine) {
      newFm = diceLine
        ? existingFm.replace(/^dice:[^\r\n]*/m, diceLine)
        : existingFm.replace(/^dice:[^\r\n]*(?:\r?\n)?/m, "");
    } else {
      newFm = diceLine ? existingFm.trimEnd() + eol + diceLine : existingFm;
    }
    return (
      content.slice(0, match.index) +
      match[1] +
      newFm +
      match[3] +
      content.slice(match.index + match[0].length)
    );
  }
  // No frontmatter — prepend it
  if (diceLine) {
    return `---\n${diceLine}\n---\n\n` + content;
  }
  return content;
}

/** One row to write: an entry, and which parsed entry it came from (if any). */
export interface TableRowWrite {
  entry: RandomTableEntry;
  /** Index into the parsed table's entries this row was read from. */
  source?: number;
}

export interface TableWrite {
  rows: TableRowWrite[];
  /** The die the table is written for. */
  dice: number;
  /**
   * "untouched": range cells are left as they are (no column is added).
   * "keep": stored ranges stay; blank ones are filled from the weights; a
   *   die column is added when missing.
   * "regenerate": every range is worked out from the weights.
   */
  ranges: "untouched" | "keep" | "regenerate";
  /** Write results as [[links]] (linked-folder tables). */
  linkCells?: boolean;
  /** Drop rows with no result and nothing in other columns (template rows). */
  dropPlaceholders?: boolean;
}

/**
 * The text to write in each row's range cell. "keep": stored ranges as
 * typed, blank ones filled from the weights; "regenerate": all from the
 * weights. Rows that don't fit the die stay blank (shown as "—"), so the
 * table keeps rolling by weight until the die is bigger.
 */
export function rangeCellTexts(dice: number, entries: RandomTableEntry[], mode: "keep" | "regenerate"): string[] {
  const faces = dieFaces(dice).length;
  if (mode === "regenerate") {
    const fits = entries.filter((e) => e.weight > 0).length <= faces;
    return fits ? getDieRanges({ dice, entries }) : entries.map((e) => (e.weight > 0 ? "" : "—"));
  }
  const resolved = resolveTable({ dice, entries });
  const overflow = resolved.issues.some((i) => i.code === "too-many-rows");
  return entries.map((e, i) =>
    e.range !== undefined && e.range.trim() ? e.range.trim() : overflow && e.weight > 0 ? "" : resolved.labels[i],
  );
}

function escapeCell(s: string): string {
  return s.replace(/\\?\|/g, "\\|");
}

/** Replace cell contents in a row, leaving every other byte alone. */
function setCells(line: string, edits: Map<number, string>): string {
  if (!edits.size) return line;
  let spans = cellSpans(line);
  let out = line;
  const maxCol = Math.max(...edits.keys());
  if (maxCol >= spans.length) {
    // Pad the row with empty cells up to the column being written.
    const trimmed = out.replace(/\s+$/, "");
    const hasTrailingPipe = trimmed.endsWith("|") && spans.length > 0 && spans[spans.length - 1].end < trimmed.length;
    let tail = hasTrailingPipe ? trimmed : trimmed + " |";
    for (let c = spans.length; c <= maxCol; c++) tail += "  |";
    out = tail;
    spans = cellSpans(out);
  }
  for (const col of [...edits.keys()].sort((a, b) => b - a)) {
    const s = spans[col];
    out = out.slice(0, s.start) + ` ${edits.get(col) ?? ""} ` + out.slice(s.end);
  }
  return out;
}

function prependCell(line: string, text: string): string {
  const i = line.indexOf("|");
  return line.slice(0, i) + `| ${text} ` + line.slice(i);
}

/** Text for an entry's result cell. */
function resultCell(entry: RandomTableEntry, linkCells: boolean): string {
  return escapeCell(linkCells || entry.isLink ? `[[${entry.result}]]` : entry.result);
}

/**
 * Write the roll table back into `content`, replacing only the table's own
 * lines. Text before and after it stays byte for byte. Rows that came from
 * the note keep their raw text (extra columns, `[[x|alias]]`, spacing);
 * only cells whose value changed are rewritten. With no table in the note,
 * one is added at the end.
 */
export function writeRollTable(content: string, write: TableWrite): string {
  const parsed = parseRandomTableWithReport(content);
  const block = parsed.block;
  const dice = write.dice;
  const entries = write.rows.map((r) => r.entry);
  const linkCells = write.linkCells ?? false;

  // Range text per row (null = leave range cells alone).
  const labels = write.ranges !== "untouched" && dice > 0 ? rangeCellTexts(dice, entries, write.ranges) : null;

  if (!block) {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const head = labels ? [dieLabel(dice), "Result", "Weight"] : ["Result", "Weight"];
    const lines = [`| ${head.join(" | ")} |`, `|${head.map((h) => "-".repeat(Math.max(3, h.length + 2))).join("|")}|`];
    write.rows.forEach((r, i) => {
      const cells = [resultCell(r.entry, linkCells), String(r.entry.weight)];
      if (labels) cells.unshift(labels[i]);
      lines.push(`| ${cells.join(" | ")} |`);
    });
    const sep = !content ? "" : content.endsWith(eol + eol) ? "" : content.endsWith(eol) ? eol : eol + eol;
    return content + sep + lines.join(eol) + eol;
  }

  const { cols } = block;
  const origEntries = parsed.table.entries;
  const addRange = labels !== null && cols.range < 0;
  const addWeight =
    cols.weight < 0 &&
    write.rows.some((r) => r.source === undefined || r.entry.weight !== origEntries[r.source]?.weight);
  const shift = addRange ? 1 : 0;
  const rangeCol = addRange ? 0 : cols.range;
  const resultCol = cols.result + shift;
  const weightCol = addWeight ? block.header.length + shift : cols.weight >= 0 ? cols.weight + shift : -1;
  const width = Math.max(block.header.length + shift + (addWeight ? 1 : 0), resultCol + 1, weightCol + 1);

  /** Add the new columns to a line from the note. */
  const widen = (line: string, rangeText: string, weightText: string): string => {
    let l = addRange ? prependCell(line, rangeText) : line;
    if (addWeight) l = setCells(l, new Map([[weightCol, weightText]]));
    return l;
  };

  const out: string[] = [];
  let header = block.lines[0];
  if (labels && cols.range >= 0 && headerKey(block.header[cols.range] ?? "") !== dieLabel(dice)) {
    header = setCells(header, new Map([[cols.range, dieLabel(dice)]]));
  } else if (dice <= 0 && write.ranges !== "untouched" && cols.range >= 0 && parseDie(headerKey(block.header[cols.range] ?? "")) > 0) {
    // No die any more: the column stays (nothing typed is lost) but stops naming one.
    header = setCells(header, new Map([[cols.range, "Roll"]]));
  }
  out.push(widen(header, dieLabel(dice), "Weight"));
  if (block.separator >= 0) {
    let sep = block.lines[block.separator];
    if (addRange) {
      const i = sep.indexOf("|");
      sep = sep.slice(0, i) + "|-----" + sep.slice(i);
    }
    if (addWeight) {
      const t = sep.replace(/\s+$/, "");
      sep = t.endsWith("|") ? t + "--------|" : t + "|--------";
    }
    out.push(sep);
  } else {
    out.push(`|${Array.from({ length: width }, () => "---").join("|")}|`);
  }

  const indent = /^\s*/.exec(block.lines[0])?.[0] ?? "";
  const rowLines: string[] = [];
  write.rows.forEach((r, i) => {
    const rangeText = labels ? labels[i] : "";
    const weightText = String(r.entry.weight);
    const rowIdx = r.source !== undefined ? block.entryRows[r.source] : undefined;
    if (rowIdx !== undefined) {
      const orig = origEntries[r.source as number];
      const edits = new Map<number, string>();
      if (orig.result !== r.entry.result || !!orig.isLink !== !!r.entry.isLink) {
        edits.set(cols.result, resultCell(r.entry, linkCells));
      }
      if (cols.weight >= 0 && orig.weight !== r.entry.weight) edits.set(cols.weight, weightText);
      if (labels && cols.range >= 0 && (orig.range ?? "") !== rangeText) edits.set(cols.range, rangeText);
      rowLines.push(widen(setCells(block.lines[block.rows[rowIdx]], edits), rangeText, weightText));
    } else {
      const cells = Array.from({ length: width }, () => "");
      cells[resultCol] = resultCell(r.entry, linkCells);
      if (weightCol >= 0) cells[weightCol] = weightText;
      if (rangeCol >= 0) cells[rangeCol] = rangeText;
      rowLines.push(`${indent}| ${cells.join(" | ")} |`);
    }
  });

  // Rows that aren't entries (no result) stay where they were, unless
  // they're empty template rows and the caller drops those.
  const used = new Set(block.entryRows);
  let kept = 0;
  block.rows.forEach((lineIdx, rowIdx) => {
    if (used.has(rowIdx)) return;
    const line = block.lines[lineIdx];
    const cells = rowCells(line);
    const extra = cells.some((c, ci) => c && ci !== cols.weight && ci !== cols.range);
    if (write.dropPlaceholders && !extra) return;
    const before = block.entryRows.filter((er) => er < rowIdx).length;
    rowLines.splice(Math.min(before + kept, rowLines.length), 0, widen(line, "", cols.weight >= 0 ? (cells[cols.weight] ?? "") : ""));
    kept++;
  });

  out.push(...rowLines);
  return content.slice(0, block.start) + out.join(block.eol) + content.slice(block.end);
}

/**
 * True when the table's stored ranges (if any) are all usable and agree
 * with its weights, so redoing them from the weights loses nothing typed
 * by hand.
 */
export function rangesFollowWeights(table: RandomTable): boolean {
  if (!table.entries.some((e) => e.range !== undefined)) return true;
  const { mode, issues } = resolveTable(table);
  return mode === "ranges" && !issues.some((i) => i.code === "range-weight-mismatch" || i.code === "range-gap");
}

/** How automatic edits (linked-folder sync) write ranges. */
export function autoRangeMode(table: RandomTable): TableWrite["ranges"] {
  return rangesFollowWeights(table) ? "regenerate" : "keep";
}

/**
 * Bring a linked-folder table in line with its folder's notes: rows for new
 * notes are added (weight 1); a renamed note renames its row in place
 * (keeping its weight); a deleted or retired (`_`) note removes its row.
 * Other rows whose note is missing are kept (and reported elsewhere).
 * Returns the content unchanged when there's nothing to do.
 */
export function syncLinkedRows(
  content: string,
  noteNames: string[],
  change?: { removed?: string; renamed?: [string, string] },
): string {
  const { table, block } = parseRandomTableWithReport(content);
  if (!table.linkedFolder) return content;
  let rows: TableRowWrite[] = table.entries.map((entry, source) => ({ entry, source }));
  let changed = false;
  const removed = change?.removed ?? (change?.renamed && change.renamed[1].startsWith("_") ? change.renamed[0] : undefined);
  if (removed !== undefined) {
    const before = rows.length;
    rows = rows.filter((r) => r.entry.result !== removed);
    changed ||= rows.length !== before;
  } else if (change?.renamed) {
    const [from, to] = change.renamed;
    if (!rows.some((r) => r.entry.result === to)) {
      rows = rows.map((r) => (r.entry.result === from ? { ...r, entry: { ...r.entry, result: to } } : r));
      changed ||= rows.some((r) => r.entry.result === to);
    }
  }
  const have = new Set(rows.map((r) => r.entry.result));
  for (const name of [...noteNames].sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith("_") || have.has(name)) continue;
    rows.push({ entry: { result: name, weight: 1 } });
    have.add(name);
    changed = true;
  }
  if (!changed) return content;
  // New cells follow the table's style: [[links]] if its rows are links.
  const firstRow = block && block.entryRows.length ? rowCells(block.lines[block.rows[block.entryRows[0]]])[block.cols.result] ?? "" : "[[";
  return writeRollTable(content, {
    dice: table.dice,
    rows,
    ranges: autoRangeMode(table),
    linkCells: firstRow.startsWith("[["),
    dropPlaceholders: true,
  });
}

/**
 * Give a table note the ```duckmage-roller``` block: an old
 * "Open in Duckmage Roller" link on its own line is replaced by it (or just
 * removed when the block is already there); otherwise the block goes right
 * after the frontmatter. Returns the content unchanged when there's nothing
 * to do. Links sharing a line with other text are left alone.
 */
export function withRollerBlock(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const block = "```duckmage-roller" + eol + "```";
  const hasBlock = ROLLER_BLOCK.test(content);
  const lineRe = new RegExp(`^[ \\t]*${LEGACY_ROLLER_LINK.source}[ \\t]*(?=\\r?$)`, "m");
  const m = lineRe.exec(content);
  if (m) {
    const end = m.index + m[0].length;
    if (hasBlock) {
      const next = content.startsWith("\r\n", end) ? 2 : content.startsWith("\n", end) ? 1 : 0;
      return content.slice(0, m.index) + content.slice(end + next);
    }
    return content.slice(0, m.index) + block + content.slice(end);
  }
  if (hasBlock || LEGACY_ROLLER_LINK.test(content)) return content;
  const fm = frontmatterOf(content);
  const insertAt = fm ? fm.length : 0;
  const lead = fm && !/\r?\n$/.test(content.slice(0, insertAt)) ? eol : "";
  return content.slice(0, insertAt) + lead + eol + block + eol + eol + content.slice(insertAt);
}

/** True when the note has an old obsidian://duckmage-roll link. */
export function hasLegacyRollerLink(content: string): boolean {
  return LEGACY_ROLLER_LINK.test(content);
}

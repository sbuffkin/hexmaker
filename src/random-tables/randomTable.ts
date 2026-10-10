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
 * Pure: no Obsidian imports.
 */

export interface RandomTableEntry {
  result: string;
  weight: number;
  isLink?: boolean; // true when the result is a vault-relative note path (written as [[...]])
  /** The row's roll range as typed in the die column. Absent when blank or there's no die column. */
  range?: string;
}

export interface RandomTable {
  /** Die size: 0 = no die (show % only), 66 = d66. */
  dice: number;
  entries: RandomTableEntry[];
  linkedFolder?: string;
  description?: string; // user-authored blurb shown above the table
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
  | "legacy-roller-link";

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
  let range = keys.findIndex((k) => RANGE_HEADER.test(k));
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
  // Offsets: start at the header line.
  let start = run.start;
  for (let i = 0; i < headerIdx; i++) start = content.indexOf("\n", start) + 1;
  return { start, end: run.end, eol, lines, separator, header, cols: { range, result, weight }, rows, entryRows: [], recognized };
}

/** The roll table: the first table naming a result, roll or weight column, else the first table. */
export function locateRollTable(content: string): TableBlock | null {
  const runs = findTableRuns(content);
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
export function parseRandomTable(content: string): RandomTable {
  return parseRandomTableWithReport(content).table;
}

/**
 * Parse a random-table note and report anything that couldn't be read.
 * Nothing the human typed is dropped: an unreadable weight counts as 1 and
 * its text is kept in the note; unreadable ranges make the table roll by
 * weight. See TableIssueCode for what's reported.
 */
export function parseRandomTableWithReport(content: string): TableReport {
  const issues: TableIssue[] = [];
  let dice = 0;
  let linkedFolder: string | undefined;
  const fm = frontmatterOf(content);
  let fmDice = 0;
  if (fm) {
    const diceMatch = /^dice:[ \t]*(.*?)[ \t]*$/m.exec(fm.body);
    if (diceMatch) fmDice = parseDie(diceMatch[1]);
    const lfMatch = /^linkedFolder:[ \t]*(.+?)[ \t]*\r?$/m.exec(fm.body);
    if (lfMatch) {
      const raw = lfMatch[1].trim();
      // Strip outer YAML quotes if present ("[[path]]" → [[path]])
      const unquoted = /^"(.*)"$/.exec(raw)?.[1] ?? raw;
      const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(unquoted);
      linkedFolder = wikiLinkMatch ? wikiLinkMatch[1].trim() : unquoted;
    }
  }
  dice = fmDice;

  const block = locateRollTable(content);

  // Description: text between frontmatter and the table, minus the roller.
  const afterFmStart = fm ? fm.length : 0;
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

  if (!block) {
    issues.push({ code: "no-table", message: "No table found." });
    return { table: { dice, entries: [], linkedFolder, description }, issues, block };
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
      if (/^\d+$/.test(w)) entry.weight = parseInt(w, 10);
      else if (w) {
        issues.push({ code: "weight-unreadable", row: entries.length + 1, message: `Row ${entries.length + 1} ("${result}"): weight "${w}" isn't a whole number; counting it as 1.` });
      }
    }
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

  const table: RandomTable = { dice, entries, linkedFolder, description };
  issues.push(...resolveTable(table).issues);
  return { table, issues, block };
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
  let labels: string[] | null = null;
  if (write.ranges !== "untouched" && dice > 0) {
    const faces = dieFaces(dice).length;
    if (write.ranges === "regenerate") {
      const fits = entries.filter((e) => e.weight > 0).length <= faces;
      // Rows that don't fit stay blank in the note (shown as "—"); the
      // table keeps rolling by weight until the die is bigger.
      labels = fits ? getDieRanges({ dice, entries }) : entries.map((e) => (e.weight > 0 ? "" : "—"));
    } else {
      const resolved = resolveTable({ dice, entries });
      const overflow = resolved.issues.some((i) => i.code === "too-many-rows");
      labels = entries.map((e, i) =>
        e.range !== undefined && e.range.trim() ? e.range.trim() : overflow && e.weight > 0 ? "" : resolved.labels[i],
      );
    }
  }

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
  return rangesFollowWeights(table) ? "untouched" : "untouched";
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

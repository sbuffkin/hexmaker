/**
 * The hex flower note (plan-hex-flower): plain Markdown a person can read
 * and edit by hand.
 *
 *   ---
 *   hexmaker-hex-flower: 1
 *   palette: Expanded
 *   start: 10
 *   edges: wrap
 *   dice: 2d6
 *   ---
 *   > [!info] How this hex flower works …
 *
 *   ```duckmage-hex-flower
 *   ```
 *
 *   ## Cells
 *   | Cell | Result | Notes |
 *   | 1 | grassland | |
 *   …
 *   ## Moves
 *   | 2d6 | Move |
 *   | 2–3 | up-right |
 *   …
 *
 * Reading is forgiving: columns in any order (found by their headings),
 * missing cells read as "(nothing)", unreadable rows reported (once per
 * edit, by the store) and skipped. Writing patches only the frontmatter
 * keys it owns and the two tables: prose, other keys and columns it
 * doesn't know are kept as written.
 *
 * Pure: no Obsidian imports.
 */

import { splitLinkRow } from "../md/tableRow";
import {
  CELL_COUNT,
  CENTRE,
  DEFAULT_DICE,
  DEFAULT_MOVES,
  NOTHING,
  isCell,
  parseDice,
  parseMove,
  type Edges,
  type Flower,
  type FlowerCell,
  type MoveRow,
} from "./flower";

export const FLOWER_MARKER = "hexmaker-hex-flower";
export const FLOWER_FORMAT = 1;
/** The code block that draws the flower in the note. */
export const FLOWER_BLOCK = "duckmage-hex-flower";
const CELLS_HEADING = "Cells";
const MOVES_HEADING = "Moves";

/** The callout at the top of a new note. */
export function flowerCallout(): string[] {
  return [
    "> [!info] How this hex flower works",
    "> When the party walks into a blank hex, roll the dice and move on the flower by the **Moves** table; the cell you land on fills the hex. Off the edge you come back in on the far side, in line with the move (`edges: stay`: you stay put). A `(blocked)` cell is never entered; `(nothing)` gives nothing. A cell can name a terrain, any text, a `[[note]]` or a `[[table]]` (rolled).",
    "> The default moves are the published 2d6 navigation hex (Goblin's Henchman's Hex Flower Game Engine): 2–3 up-right, 4–5 down-right, 6–7 down, 8–9 down-left, 10–11 up-left, 12 up.",
  ];
}

export interface FlowerRead {
  flower: Flower;
  /** What couldn't be read (kept in the note as written). */
  problems: string[];
}

// ── frontmatter ──────────────────────────────────────────────────────────

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Is this text a hex flower note (its marker in the frontmatter)? */
export function isFlowerNote(content: string): boolean {
  const fm = FM.exec(content);
  return !!fm && new RegExp(`^${FLOWER_MARKER}\\s*:`, "m").test(fm[1]);
}

function fmValue(fm: string, key: string): string | undefined {
  const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, "mi").exec(fm);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/** A palette link or name → the palette's name. */
function paletteName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /\[\[([^\]|#]+)/.exec(raw);
  const t = (m ? m[1] : raw).trim().replace(/\.md$/i, "");
  return t.split("/").pop()?.trim() || undefined;
}

// ── tables ───────────────────────────────────────────────────────────────

interface TableAt {
  /** Line index of the heading, and of the table's first and last lines. */
  heading: number;
  start: number;
  end: number;
  header: string[];
  rows: { line: number; cells: string[] }[];
}

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** The first table under heading `name` (any level, any case), or undefined. */
function tableUnder(lines: readonly string[], name: string): TableAt | undefined {
  const heading = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${name}\\s*$`, "i").test(l.trim()));
  if (heading < 0) return undefined;
  let i = heading + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (/^#{1,6}\s/.test(lines[i].trim())) return { heading, start: -1, end: -1, header: [], rows: [] };
    i++;
  }
  if (i >= lines.length) return { heading, start: -1, end: -1, header: [], rows: [] };
  const start = i;
  const header = splitLinkRow(lines[i]);
  const rows: { line: number; cells: string[] }[] = [];
  i++;
  for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    if (SEPARATOR.test(lines[i])) continue;
    rows.push({ line: i, cells: splitLinkRow(lines[i]) });
  }
  return { heading, start, end: i - 1, header, rows };
}

const colOf = (header: readonly string[], ...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h.trim())));

/** "2–3", "2-3", "12", "2 to 3" → [from, to]. */
export function parseRange(raw: string): [number, number] | undefined {
  const m = /^\s*(\d+)\s*(?:(?:[-–—]|to)\s*(\d+))?\s*$/i.exec(raw);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  return a <= b ? [a, b] : [b, a];
}

export const rangeText = (r: Pick<MoveRow, "from" | "to">): string => (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`);

// ── reading ──────────────────────────────────────────────────────────────

/** A flower note's text → the flower (null: not a flower note). */
export function parseFlowerNote(content: string, name: string): FlowerRead | null {
  if (!isFlowerNote(content)) return null;
  const fm = FM.exec(content)![1];
  const problems: string[] = [];
  const lines = content.split(/\r?\n/);

  const startRaw = fmValue(fm, "start");
  let start = CENTRE;
  if (startRaw !== undefined && startRaw !== "") {
    const n = Number(startRaw);
    if (isCell(n)) start = n;
    else problems.push(`start: "${startRaw}" isn't a cell (1–19), so the centre (10).`);
  }
  const edgesRaw = (fmValue(fm, "edges") ?? "").toLowerCase();
  let edges: Edges = "wrap";
  if (/stay|stop|block/.test(edgesRaw)) edges = "stay";
  else if (edgesRaw && !/wrap/.test(edgesRaw)) problems.push(`edges: "${edgesRaw}" should be wrap or stay, so wrap.`);
  const diceRaw = fmValue(fm, "dice");
  let dice = DEFAULT_DICE;
  if (diceRaw) {
    if (parseDice(diceRaw)) dice = diceRaw.replace(/\s+/g, "").toLowerCase();
    else problems.push(`dice: "${diceRaw}" isn't dice like 2d6, so 2d6.`);
  }

  // Cells
  const cells: FlowerCell[] = Array.from({ length: CELL_COUNT }, () => ({ result: NOTHING }));
  const cellsTable = tableUnder(lines, CELLS_HEADING);
  if (!cellsTable || cellsTable.start < 0) problems.push("No ## Cells table, so every cell is (nothing).");
  else {
    const h = cellsTable.header;
    const cCell = Math.max(0, colOf(h, /^cell$/i, /^#$/, /^no\.?$/i, /^hex$/i));
    const cResult = colOf(h, /^result$/i, /^terrain$/i, /^what$/i);
    const cNotes = colOf(h, /^notes?$/i);
    const seen = new Set<number>();
    for (const r of cellsTable.rows) {
      const n = Number(r.cells[cCell]);
      if (!isCell(n)) { problems.push(`Cells: "${r.cells[cCell] ?? ""}" isn't a cell (1–19); row skipped.`); continue; }
      if (seen.has(n)) { problems.push(`Cells: cell ${n} is listed twice; the first one counts.`); continue; }
      seen.add(n);
      const result = (cResult >= 0 ? r.cells[cResult] : r.cells[cCell === 0 ? 1 : 0])?.trim() || NOTHING;
      const notes = cNotes >= 0 ? r.cells[cNotes]?.trim() : "";
      cells[n - 1] = { result, ...(notes ? { notes } : {}) };
    }
  }

  // Moves
  let moves: MoveRow[] = DEFAULT_MOVES.map((m) => ({ ...m }));
  const movesTable = tableUnder(lines, MOVES_HEADING);
  if (movesTable && movesTable.start >= 0) {
    const h = movesTable.header;
    const named = colOf(h, /^moves?$/i, /^direction$/i, /^go$/i);
    const cMove = named >= 0 ? named : h.length > 1 ? 1 : 0;
    const cRoll = cMove === 0 ? 1 : 0;
    const read: MoveRow[] = [];
    for (const r of movesTable.rows) {
      const range = parseRange(r.cells[cRoll] ?? "");
      const move = parseMove(r.cells[cMove] ?? "");
      if (!range || !move) { problems.push(`Moves: "${r.cells.join(" | ")}" can't be read; row skipped.`); continue; }
      read.push({ from: range[0], to: range[1], move });
    }
    if (read.length) moves = read;
    // Totals the dice can roll that no row covers: the walk stays put on them.
    const d = parseDice(dice)!;
    const gaps: number[] = [];
    for (let t = d.count; t <= d.count * d.sides; t++) if (!moves.some((m) => t >= m.from && t <= m.to)) gaps.push(t);
    if (read.length && gaps.length) problems.push(`Moves: no row for ${gaps.join(", ")}, so those rolls stay put.`);
  }

  return {
    flower: { name, ...(paletteName(fmValue(fm, "palette")) ? { palette: paletteName(fmValue(fm, "palette")) } : {}), start, edges, dice, cells, moves },
    problems,
  };
}

// ── writing ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

function frontmatterOf(f: Flower): [string, string][] {
  return [
    [FLOWER_MARKER, String(FLOWER_FORMAT)],
    ...(f.palette ? [["palette", f.palette] as [string, string]] : []),
    ["start", String(f.start)],
    ["edges", f.edges],
    ["dice", f.dice],
  ];
}

function cellsTableLines(f: Flower, keep?: TableAt): string[] {
  // Columns the note has that this doesn't write (kept per cell).
  const extra = keep ? keep.header.map((h, i) => ({ h, i })).filter(({ h }) => !/^(cell|#|no\.?|hex|result|terrain|what|notes?)$/i.test(h.trim())) : [];
  const cellCol = keep ? Math.max(0, colOf(keep.header, /^cell$/i, /^#$/, /^no\.?$/i, /^hex$/i)) : 0;
  const old = new Map<number, string[]>();
  for (const r of keep?.rows ?? []) {
    const n = Number(r.cells[cellCol]);
    if (isCell(n) && !old.has(n)) old.set(n, r.cells);
  }
  const head = ["Cell", "Result", "Notes", ...extra.map((e) => e.h)];
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...f.cells.map((c, i) => `| ${[String(i + 1), esc(c.result), esc(c.notes ?? ""), ...extra.map((e) => esc(old.get(i + 1)?.[e.i] ?? ""))].join(" | ")} |`),
  ];
}

function movesTableLines(f: Flower): string[] {
  return [
    `| ${f.dice} | Move |`,
    "| --- | --- |",
    ...f.moves.map((m) => `| ${rangeText(m)} | ${m.move} |`),
  ];
}

/** A new flower note. */
export function buildFlowerNote(f: Flower): string {
  return [
    "---",
    ...frontmatterOf(f).map(([k, v]) => `${k}: ${v}`),
    "---",
    ...flowerCallout(),
    "",
    "```" + FLOWER_BLOCK,
    "```",
    "",
    `## ${CELLS_HEADING}`,
    "",
    ...cellsTableLines(f),
    "",
    `## ${MOVES_HEADING}`,
    "",
    ...movesTableLines(f),
    "",
  ].join("\n");
}

/** Replace table `t` (or add one under its heading, or a new section at the end). */
function putTable(lines: string[], heading: string, t: TableAt | undefined, table: string[]): string[] {
  if (t && t.start >= 0) return [...lines.slice(0, t.start), ...table, ...lines.slice(t.end + 1)];
  if (t) return [...lines.slice(0, t.heading + 1), "", ...table, ...lines.slice(t.heading + 1)];
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return [...out, "", `## ${heading}`, "", ...table, ""];
}

/**
 * `content` with the flower written in: the keys it owns set (others kept),
 * the Cells and Moves tables replaced (other columns kept), everything else
 * as it was. A note that isn't a flower note yet gets the whole layout.
 */
export function updateFlowerNote(content: string, f: Flower): string {
  if (!isFlowerNote(content)) return buildFlowerNote(f);
  const nl = content.includes("\r\n") ? "\r\n" : "\n";
  const fm = FM.exec(content)!;
  const fmLines = fm[1].split(/\r?\n/);
  const own = frontmatterOf(f);
  const ownKeys = new Set([...own.map(([k]) => k), "palette"]);
  const kept = fmLines.filter((l) => { const k = /^([\w-]+)\s*:/.exec(l)?.[1]; return !k || !ownKeys.has(k); });
  // Owned keys first, in their order; the user's after.
  const newFm = ["---", ...own.map(([k, v]) => `${k}: ${v}`), ...kept, "---"];
  let lines = content.slice(fm[0].length).split(/\r?\n/);
  lines = putTable(lines, CELLS_HEADING, tableUnder(lines, CELLS_HEADING), cellsTableLines(f, tableUnder(lines, CELLS_HEADING)));
  lines = putTable(lines, MOVES_HEADING, tableUnder(lines, MOVES_HEADING), movesTableLines(f));
  return [...newFm, ...lines].join(nl);
}

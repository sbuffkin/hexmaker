/**
 * Importing hand edits to a table note (issue #45).
 *
 * The plugin's own UI regenerates the roll column from the weights. When a
 * person edits the raw note instead, the edit is imported: the plugin brings
 * the other columns in line on its next write, and never throws away what
 * was typed. Given the content the plugin last read or wrote (`prev`) and
 * the note now (`cur`):
 *
 * - Die changed (the `| dN |` header or `dice:`): the other one is updated to
 *   match and the ranges are redone from the weights — unless the ranges were
 *   also edited and are valid for the new die, in which case they're kept and
 *   the weights follow them.
 * - Ranges edited and valid (every face once, no overlap or gap): adopted;
 *   each row's weight becomes its face count.
 * - Only weights (or rows) changed, and the old ranges matched the old
 *   weights: the ranges are redone from the new weights.
 * - Anything else (gaps, overlaps, unreadable ranges, more rows than faces,
 *   ranges that never matched the weights): nothing is changed; the table
 *   rolls as resolveTable says and the view shows the problem with its fixes.
 *
 * Pure: no Obsidian imports. TableStore decides when to call it.
 */

import {
  dieFaces,
  frontmatterDie,
  parseRandomTableWithReport,
  rangeHeaderDie,
  rangesFollowWeights,
  resolveTable,
  setDiceInFrontmatter,
  writeRollTable,
  type RandomTable,
  type RandomTableEntry,
  type TableRowWrite,
} from "./randomTable";

export type ImportKind = "none" | "die" | "ranges" | "weights" | "ambiguous";

export interface ImportResult {
  kind: ImportKind;
  /** The note after importing (unchanged for "none" and "ambiguous"). */
  content: string;
}

/** Ranges that can be adopted as typed: usable, every face covered once. */
function cleanRanges(table: RandomTable): boolean {
  const r = resolveTable(table);
  return r.mode === "ranges" && !r.issues.some((i) => i.code === "range-gap");
}

/**
 * Pair each current row with its previous row: same result first (rows
 * moved or deleted), then same position (a result renamed in place).
 */
function matchRows(prev: RandomTableEntry[], cur: RandomTableEntry[]): (RandomTableEntry | undefined)[] {
  const used = new Set<number>();
  const out: (RandomTableEntry | undefined)[] = cur.map((e) => {
    const i = prev.findIndex((p, k) => !used.has(k) && p.result === e.result);
    if (i < 0) return undefined;
    used.add(i);
    return prev[i];
  });
  out.forEach((m, i) => {
    if (m || i >= prev.length || used.has(i)) return;
    used.add(i);
    out[i] = prev[i];
  });
  return out;
}

export function importHandEdit(prev: string, cur: string): ImportResult {
  const none: ImportResult = { kind: "none", content: cur };
  if (prev === cur) return none;
  const p = parseRandomTableWithReport(prev);
  const c = parseRandomTableWithReport(cur);
  if (!c.block?.recognized || c.block.cols.range < 0) return none;

  const entries = c.table.entries;
  const before = matchRows(p.table.entries, entries);
  const rangesEdited = entries.some((e, i) => !!e.range?.trim() && (e.range ?? "") !== (before[i]?.range ?? ""));
  const weightsEdited =
    entries.length !== p.table.entries.length || entries.some((e, i) => !before[i] || before[i]?.weight !== e.weight);

  const rowsAs = (weights?: number[]): TableRowWrite[] =>
    entries.map((entry, source) => ({ entry: weights ? { ...entry, weight: weights[source] } : entry, source }));
  const adopt = (dice: number): string => {
    const faces = resolveTable({ dice, entries }).faces.map((f) => f.length);
    return writeRollTable(cur, { dice, rows: rowsAs(faces), ranges: "keep" });
  };

  // ── Die change: the header and dice: follow each other.
  const pFm = frontmatterDie(prev);
  const cFm = frontmatterDie(cur);
  const pHd = rangeHeaderDie(p.block);
  const cHd = rangeHeaderDie(c.block);
  const fmChanged = pFm !== cFm && cFm > 0;
  const hdChanged = p.block !== null && p.block.cols.range >= 0 && pHd !== cHd && cHd > 0;
  if (fmChanged || hdChanged) {
    if (fmChanged && hdChanged && cFm !== cHd) return { kind: "ambiguous", content: cur };
    const die = fmChanged ? cFm : cHd;
    const keepTyped = rangesEdited && cleanRanges({ dice: die, entries });
    let next = keepTyped
      ? adopt(die)
      : writeRollTable(cur, { dice: die, rows: rowsAs(), ranges: "regenerate" });
    if (frontmatterDie(next) !== die) next = setDiceInFrontmatter(next, die);
    return { kind: "die", content: next };
  }

  const dice = c.table.dice;
  if (dice <= 0) return none;

  // ── Ranges typed by hand: adopt them if they're clean.
  if (rangesEdited) {
    if (!cleanRanges(c.table)) return { kind: "ambiguous", content: cur };
    const next = adopt(dice);
    return { kind: next === cur ? "none" : "ranges", content: next };
  }

  // ── Only weights or rows changed: redo the ranges if they were in step.
  if (weightsEdited) {
    const fits = entries.filter((e) => e.weight > 0).length <= dieFaces(dice).length;
    if (!rangesFollowWeights(p.table) || !fits) return { kind: "ambiguous", content: cur };
    const next = writeRollTable(cur, { dice, rows: rowsAs(), ranges: "regenerate" });
    return { kind: next === cur ? "none" : "weights", content: next };
  }
  return none;
}


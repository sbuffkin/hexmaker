/**
 * Once-only rows and the Events ledger (plan-tables-everywhere §2.7, SP6,
 * GM8).
 *
 * - A table row whose `Once` column says `per world` or `per map` can come
 *   up only once. Repeatable rows simply have no Once value.
 * - When a map roll (arrival, generation) lands on such a row, it is written
 *   as a row of a readable `## Events` table: in the root map's note (the
 *   top of the map tree) for `per world`, in the map's own note for
 *   `per map`. The section is added only when the first event fires.
 * - Rolling then leaves the row out and rescales the odds (the resolver's
 *   `isUsed`): the hand-roller's "roll again if you get it".
 * - The ledger is plain text: deleting a row makes the event possible again.
 * - Rolls by hand (Tables view, roll blocks) have no world, so nothing is
 *   tracked there; the result says so (T7).
 *
 * Pure: no Obsidian imports.
 */

import { cellSpans, rollLabel, rowInfoOf, type RandomTable, type RandomTableEntry, type RollOutcome } from "../random-tables/randomTable";

export type OnceScope = "world" | "map";

export const EVENTS_HEADING = "## Events";
export const EVENTS_HEADERS = ["Event", "Where", "When", "From"] as const;

/** One ledger row, as written (cells keep their text: links stay links). */
export interface LedgerEvent {
  event: string;
  where: string;
  when: string;
  from: string;
}

/** A Once row a roll landed on (Resolved.onces). */
export interface OnceHit {
  /** The table's key (its path, or path#heading). */
  table: string;
  index: number;
  scope: OnceScope;
  /** The row's result as the table has it (a link's target without brackets). */
  result: string;
  /** The result links a note. */
  link: boolean;
}

/** A Once row that fired during a map roll, and where (the hex, "x_y", when known). */
export interface FiredEvent extends OnceHit {
  hex?: string;
}

// ── reading and writing the ## Events table ─────────────────────────────

const COL_ALIASES: Record<string, keyof LedgerEvent> = {
  event: "event", what: "event", events: "event",
  where: "where", place: "where",
  when: "when", date: "when",
  from: "from", table: "from", source: "from",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function cellsOf(line: string): string[] {
  return cellSpans(line).map((s) => line.slice(s.start, s.end).trim().replace(/\\\|/g, "|"));
}

const isTableLine = (l: string) => /^\s*\|/.test(l);
const isSeparator = (l: string) => /^\s*\|?[\s|:-]+\|?\s*$/.test(l) && l.includes("-");

interface Located {
  lines: string[];
  eol: string;
  /** The heading line, or -1. */
  heading: number;
  /** End of the section (exclusive). */
  end: number;
  /** The table: header line, first row line, end (exclusive); null when the section has none. */
  table: { header: number; first: number; end: number; cols: (keyof LedgerEvent | undefined)[] } | null;
}

function locate(content: string): Located {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const heading = lines.findIndex((l) => /^##\s+events\s*$/i.test(l.trim()));
  if (heading < 0) return { lines, eol, heading, end: lines.length, table: null };
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  for (let i = heading + 1; i < end; i++) {
    if (!isTableLine(lines[i]) || isSeparator(lines[i])) continue;
    const cols = cellsOf(lines[i]).map((h) => COL_ALIASES[norm(h)]);
    if (!cols.includes("event")) continue;
    let first = i + 1;
    if (first < end && isSeparator(lines[first])) first++;
    let tEnd = first;
    while (tEnd < end && isTableLine(lines[tEnd])) tEnd++;
    return { lines, eol, heading, end, table: { header: i, first, end: tEnd, cols } };
  }
  return { lines, eol, heading, end, table: null };
}

function rowOf(line: string, cols: (keyof LedgerEvent | undefined)[]): LedgerEvent {
  const cells = cellsOf(line);
  const out: LedgerEvent = { event: "", where: "", when: "", from: "" };
  cols.forEach((c, i) => { if (c) out[c] = cells[i] ?? ""; });
  return out;
}

/** The rows of a note's `## Events` table (empty rows skipped). */
export function readEvents(content: string): LedgerEvent[] {
  const { lines, table } = locate(content);
  if (!table) return [];
  const out: LedgerEvent[] = [];
  for (let i = table.first; i < table.end; i++) {
    if (isSeparator(lines[i])) continue;
    const r = rowOf(lines[i], table.cols);
    if (r.event.trim()) out.push(r);
  }
  return out;
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * The note with `rows` added to its `## Events` table, in the table's own
 * column order (made at the end of the note when there's none yet).
 * Everything else stays as it was. Unchanged when there's nothing to add.
 */
export function withEvents(content: string, rows: readonly LedgerEvent[]): string {
  if (!rows.length) return content;
  const loc = locate(content);
  const { lines, eol } = loc;
  if (loc.table) {
    const cols = loc.table.cols;
    const header = cellsOf(lines[loc.table.header]);
    const line = (r: LedgerEvent) => `| ${header.map((_, i) => { const c = cols[i]; return escapeCell(c ? r[c] : ""); }).join(" | ")} |`;
    lines.splice(loc.table.end, 0, ...rows.map(line));
    return lines.join(eol);
  }
  const table = [
    `| ${EVENTS_HEADERS.join(" | ")} |`,
    `| ${EVENTS_HEADERS.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${[r.event, r.where, r.when, r.from].map(escapeCell).join(" | ")} |`),
  ];
  if (loc.heading >= 0) {
    // A section with no table yet: the table goes right under the heading's text.
    let at = loc.end;
    while (at > loc.heading + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, "", ...table);
    return lines.join(eol);
  }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return [...lines, "", EVENTS_HEADING, "", "Once-only events that have happened. Delete a row to make the event possible again.", "", ...table, ""].join(eol);
}

/** The note without the `## Events` rows `drop` picks. Unchanged when it picks none. */
export function withoutEvents(content: string, drop: (e: LedgerEvent) => boolean): string {
  const loc = locate(content);
  if (!loc.table) return content;
  const { lines, eol, table } = loc;
  const keep: string[] = [];
  let dropped = false;
  for (let i = table.first; i < table.end; i++) {
    if (!isSeparator(lines[i]) && drop(rowOf(lines[i], table.cols))) { dropped = true; continue; }
    keep.push(lines[i]);
  }
  if (!dropped) return content;
  lines.splice(table.first, table.end - table.first, ...keep);
  return lines.join(eol);
}

// ── matching ledger rows to table rows ──────────────────────────────────

/** The name a cell or key stands for: its first link's target (or its text), without folders, `.md` or an alias; any case. */
export function ledgerName(text: string): string {
  const t = text.trim();
  const link = /\[\[([^\]]+)\]\]/.exec(t)?.[1] ?? t;
  const [target, ...heading] = link.split("|")[0].split("#");
  const base = target.trim().replace(/\.md$/i, "").replace(/^.*\//, "");
  return [base, ...heading.map((h) => h.trim())].join("#").toLowerCase();
}

/** Whether the ledger holds the row `result` of table `tableKey` (a blank From matches any table). */
export function ledgerHas(events: readonly LedgerEvent[], tableKey: string, result: string): boolean {
  const want = ledgerName(result);
  const table = ledgerName(tableKey);
  return events.some((e) => ledgerName(e.event) === want && (!e.from.trim() || ledgerName(e.from) === table));
}

/** Whether a ledger row's Where names map `mapName` (`[[_name]] 4, 7`). */
export function eventOnMap(e: LedgerEvent, mapName: string): boolean {
  const link = /\[\[([^\]|#]+)/.exec(e.where)?.[1]?.trim().replace(/^.*\//, "").replace(/\.md$/i, "");
  return !!link && link.toLowerCase() === `_${mapName}`.toLowerCase();
}

// ── the tracker one map roll uses ───────────────────────────────────────

export interface Ledgers {
  /** The root map's ledger (per world). */
  world: readonly LedgerEvent[];
  /** The map's own ledger (per map). */
  map: readonly LedgerEvent[];
}

export const NO_LEDGERS: Ledgers = { world: [], map: [] };

/**
 * What one map roll knows about Once rows: the ledgers as they were when it
 * started, plus what fired during it (so a generator placing a hundred
 * hexes still finds a once-only row at most once).
 */
export class OnceTracker {
  readonly fired: FiredEvent[] = [];
  constructor(private ledgers: Ledgers = NO_LEDGERS) {}

  /** For ResolveContext.isUsed. */
  isUsed = (tableKey: string, _index: number, entry: RandomTableEntry, scope?: OnceScope): boolean => {
    const name = entry.result;
    if (this.fired.some((f) => (!scope || f.scope === scope) && ledgerName(f.table) === ledgerName(tableKey) && ledgerName(f.result) === ledgerName(name))) return true;
    return ledgerHas(scope === "map" ? this.ledgers.map : this.ledgers.world, tableKey, name);
  };

  /** Record the Once rows a roll landed on. */
  fire(hits: readonly OnceHit[] | undefined, hex?: string): void {
    for (const h of hits ?? []) this.fired.push(hex ? { ...h, hex } : { ...h });
  }
}

/** A fired event as a ledger row: `[[The Silent Fleet]] | [[_drift]] 4, 7 | 2026-10-11 | [[Rare events]]`. */
export function eventRow(f: FiredEvent, where: { mapLink: string; date: string }): LedgerEvent {
  const name = f.result.replace(/^.*\//, "");
  const table = f.table.replace(/\.md(?=#|$)/i, "").replace(/^.*\//, "");
  return {
    event: f.link ? `[[${name}]]` : f.result,
    where: f.hex ? `${where.mapLink} ${f.hex.replace("_", ", ")}` : where.mapLink,
    when: where.date,
    from: `[[${table}]]`,
  };
}

// ── rolls by hand (T7) ──────────────────────────────────────────────────

/** The note for a hand roll that landed on a Once row: it isn't tracked there. Undefined for repeatable rows. */
export function untrackedOnceLabel(table: RandomTable, index: number): string | undefined {
  const once = rowInfoOf(table, index).once;
  if (!once) return undefined;
  return `once per ${once}: not tracked here`;
}

/** The label under a hand roll: the die face ("d20 → 14"), and for a Once row that it isn't tracked there. */
export function handRollLabel(table: RandomTable, outcome: RollOutcome): string {
  return [rollLabel(table, outcome), untrackedOnceLabel(table, outcome.index)].filter(Boolean).join(" · ");
}

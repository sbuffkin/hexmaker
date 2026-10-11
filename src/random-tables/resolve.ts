/**
 * One resolver for every table reference (plan-tables-everywhere §2.3):
 * roll a random table, follow a row that links another table (nested
 * rolls), and say what came out — text, a note, a terrain, a generator, or
 * nothing — with the row attributes and the chain of rows taken.
 *
 * - Seeded: the same seed (or random stream) gives the same chain.
 * - Loop guard: a table already on the chain, or a chain deeper than
 *   `maxDepth` (5), stops with a `loop` result shown as ⟲.
 * - When rows (tableConditions.ts) that don't fit the context, rows already
 *   used (`isUsed`, for Once) and, with `onlyTerrains`, rows that can't be
 *   a terrain of the palette are left out, and the rest renormalised: the
 *   hand-roller's "roll again".
 * - `odds()` gives the exact distribution `roll()` samples, so a preview
 *   shows the real odds.
 *
 * Tables come from a TableLookup, so this file never touches the vault:
 * the caller loads the tables (from notes, or from another format through
 * an adapter like space/worldTypesSource.ts).
 *
 * Picker filtering by row type is not done here: tableFitsWant() is the
 * seam the pickers call (plan §2.5).
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { conditionsFit, type ConditionContext } from "./tableConditions";
import { locateRollTable, parseRandomTable, resolveTable, rollTable, rowInfoOf, type RandomTable, type RandomTableEntry, type RowType } from "./randomTable";

/** What a cell turned out to be. */
export type CellKind = "text" | "note" | "table" | "generator" | "terrain" | "nothing";

export interface TableLookup {
  /**
   * The table a link points at (`Note`, `folder/Note` or `Note#Heading`),
   * with a key that names it uniquely (its path; used for the loop guard).
   * Undefined when the link isn't a table.
   */
  table(link: string): { key: string; table: RandomTable } | undefined;
  /** What a link that isn't a table points at. Missing: a note that doesn't exist (yet). */
  kindOf?(link: string): "generator" | "note" | "missing";
}

export interface ResolveContext extends ConditionContext {
  /** The random stream; else one made from `seed` (else Math.random). */
  rand?: () => number;
  seed?: number;
  /** The palette's terrain names: plain text naming one is a terrain (the palette's spelling). */
  terrains?: readonly string[];
  /** Only rows that can come out as a terrain (or nothing) count; the rest are left out and reported. */
  onlyTerrains?: boolean;
  /** Stop at a row whose Roll is "on arrival" instead of rolling it through. */
  deferArrival?: boolean;
  /** Once rows already used (the ledger): those rows are left out. */
  isUsed?: (tableKey: string, index: number, entry: RandomTableEntry) => boolean;
  /** Deepest nesting followed (default 5). */
  maxDepth?: number;
}

export interface ResolveStep {
  /** The table's key. */
  table: string;
  /** The entry's index in the table. */
  index: number;
  result: string;
  /** The die face, when the table rolled by its ranges. */
  face?: number;
}

export interface Resolved {
  /** `loop`: stopped by the loop guard; `deferred`: an on-arrival row; `empty`: no row could come up. */
  kind: CellKind | "loop" | "deferred" | "empty";
  /** The text, note link, terrain, generator ref, or (loop / deferred) the table link. */
  value: string;
  /** The rows' attributes along the chain (an inner row's cell wins). */
  attrs: Record<string, string>;
  chain: ResolveStep[];
  /** The last Once row on the chain, for the caller's ledger. */
  once?: { table: string; index: number; scope: "world" | "map" };
  /** An on-arrival row: what the hex shows until then. */
  shownAs?: string;
}

export const DEFAULT_MAX_DEPTH = 5;
export const LOOP_MARK = "⟲";

const NOTHING = /^\(?nothing\)?$|^\(none\)$/i;

/** Whether a cell is a (nothing) row. */
export const isNothing = (text: string): boolean => NOTHING.test(text.trim());
const GENERATOR_ID = /^(?:procedural|wfc|builtin):\S/;
const lc = (s: string) => s.trim().toLowerCase();

/** The link a row's result stands for (a linked-folder row links a note in that folder), or undefined for plain text. */
export function entryLink(table: RandomTable, entry: RandomTableEntry): string | undefined {
  if (table.linkedFolder) return `${table.linkedFolder}/${entry.result}`;
  return entry.isLink ? entry.result : undefined;
}

/** What one cell is (T3: detected from what it links to). */
export function cellKind(table: RandomTable, entry: RandomTableEntry, lookup: TableLookup, ctx: Pick<ResolveContext, "terrains"> = {}): { kind: CellKind; value: string } {
  const link = entryLink(table, entry);
  if (link !== undefined) {
    if (lookup.table(link)) return { kind: "table", value: link };
    const k = lookup.kindOf?.(link) ?? "note";
    return { kind: k === "generator" ? "generator" : "note", value: link };
  }
  const text = entry.result.trim();
  if (NOTHING.test(text)) return { kind: "nothing", value: "" };
  if (GENERATOR_ID.test(text)) return { kind: "generator", value: text };
  const terrain = ctx.terrains?.find((t) => lc(t) === lc(text));
  if (terrain !== undefined) return { kind: "terrain", value: terrain };
  if (table.rows === "terrain" && !ctx.terrains) return { kind: "terrain", value: text };
  return { kind: "text", value: text };
}

export interface RowSkip {
  /** The table's key. */
  table: string;
  index: number;
  result: string;
  why: "when" | "used" | "not-terrain" | "dead-end";
}

interface Fit {
  weights: number[];
  /** Every row fits with its full weight (so the table can roll its die). */
  whole: boolean;
  skipped: RowSkip[];
}

class Resolver {
  private viable = new Map<string, boolean>();
  constructor(private lookup: TableLookup, private ctx: ResolveContext) {}

  private get maxDepth() {
    return this.ctx.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  /** Each row's weight here (0 = can't come up), and why rows were left out. */
  fit(key: string, table: RandomTable, visited: readonly string[]): Fit {
    const resolved = resolveTable(table);
    const base = table.entries.map((e, i) => (resolved.mode === "ranges" ? resolved.faces[i].length : Math.max(0, e.weight)));
    const skipped: RowSkip[] = [];
    const weights = base.map((w, i) => {
      if (w <= 0) return 0;
      const e = table.entries[i];
      const info = rowInfoOf(table, i);
      if (!conditionsFit(info.when, this.ctx)) { skipped.push({ table: key, index: i, result: e.result, why: "when" }); return 0; }
      if (info.once && this.ctx.isUsed?.(key, i, e)) { skipped.push({ table: key, index: i, result: e.result, why: "used" }); return 0; }
      if (this.ctx.onlyTerrains) {
        const { kind, value } = cellKind(table, e, this.lookup, this.ctx);
        if (kind === "table") {
          if (!this.canYield(value, [...visited, key])) { skipped.push({ table: key, index: i, result: e.result, why: "dead-end" }); return 0; }
        } else if (kind !== "terrain" && kind !== "nothing" && !(this.ctx.deferArrival && info.roll === "on arrival")) {
          skipped.push({ table: key, index: i, result: e.result, why: "not-terrain" });
          return 0;
        }
      }
      return w;
    });
    return { weights, whole: weights.every((w, i) => w === base[i]), skipped };
  }

  /** Whether a linked table can give anything here (not a loop, not too deep, some row fits). */
  private canYield(link: string, visited: readonly string[]): boolean {
    const t = this.lookup.table(link);
    if (!t || visited.includes(t.key) || visited.length >= this.maxDepth) return false;
    const memo = `${t.key}@${visited.length}`;
    const known = this.viable.get(memo);
    if (known !== undefined) return known;
    this.viable.set(memo, false); // a cycle back here can't help
    const ok = this.fit(t.key, t.table, visited).weights.some((w) => w > 0);
    this.viable.set(memo, ok);
    return ok;
  }

  roll(link: string, rand: () => number, visited: string[], chain: ResolveStep[], attrs: Record<string, string>): Resolved {
    const t = this.lookup.table(link);
    if (!t) return { kind: "empty", value: link, attrs, chain };
    if (visited.includes(t.key) || visited.length >= this.maxDepth) {
      return { kind: "loop", value: `${LOOP_MARK} ${link}`, attrs, chain };
    }
    const { table, key } = t;
    const fit = this.fit(key, table, visited);
    let index = -1;
    let face: number | undefined;
    if (fit.whole) {
      const out = rollTable(table, rand);
      if (out) { index = out.index; face = out.face; }
    } else {
      index = pickIndex(rand, fit.weights);
    }
    if (index < 0) return { kind: "empty", value: link, attrs, chain };
    const entry = table.entries[index];
    const info = rowInfoOf(table, index);
    const step: ResolveStep = { table: key, index, result: entry.result };
    if (face !== undefined) step.face = face;
    const nextChain = [...chain, step];
    const nextAttrs = { ...attrs, ...(info.attrs ?? {}) };
    const once = info.once ? { table: key, index, scope: info.once } : undefined;
    const { kind, value } = cellKind(table, entry, this.lookup, this.ctx);
    if (this.ctx.deferArrival && info.roll === "on arrival") {
      const out: Resolved = { kind: "deferred", value: kind === "table" ? value : key, attrs: nextAttrs, chain: nextChain };
      const shown = info.shownAs ?? table.shownAs;
      if (shown) out.shownAs = shown;
      if (once) out.once = once;
      return out;
    }
    if (kind === "table") {
      const inner = this.roll(value, rand, [...visited, key], nextChain, nextAttrs);
      if (!inner.once && once) inner.once = once;
      return inner;
    }
    const out: Resolved = { kind, value, attrs: nextAttrs, chain: nextChain };
    if (once) out.once = once;
    return out;
  }

  odds(link: string, visited: string[], p: number, out: Map<string, ResolvedOdds>): void {
    const t = this.lookup.table(link);
    const add = (kind: ResolvedOdds["kind"], value: string, q: number) => {
      const k = `${kind}:${lc(value)}`;
      const o = out.get(k);
      if (o) o.odds += q;
      else out.set(k, { kind, value, odds: q });
    };
    if (!t) { add("empty", link, p); return; }
    if (visited.includes(t.key) || visited.length >= this.maxDepth) { add("loop", `${LOOP_MARK} ${link}`, p); return; }
    const { weights } = this.fit(t.key, t.table, visited);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) { add("empty", link, p); return; }
    t.table.entries.forEach((e, i) => {
      if (weights[i] <= 0) return;
      const q = (p * weights[i]) / total;
      const info = rowInfoOf(t.table, i);
      const { kind, value } = cellKind(t.table, e, this.lookup, this.ctx);
      if (this.ctx.deferArrival && info.roll === "on arrival") add("deferred", kind === "table" ? value : t.key, q);
      else if (kind === "table") this.odds(value, [...visited, t.key], q, out);
      else add(kind, value, q);
    });
  }

  /** Rows left out here, in this table and the tables it links (loop-guarded). */
  skippedRows(link: string, visited: string[] = []): RowSkip[] {
    const t = this.lookup.table(link);
    if (!t || visited.includes(t.key) || visited.length >= this.maxDepth) return [];
    const own = this.fit(t.key, t.table, visited).skipped;
    const nested = t.table.entries.flatMap((e) => {
      const { kind, value } = cellKind(t.table, e, this.lookup, this.ctx);
      return kind === "table" ? this.skippedRows(value, [...visited, t.key]) : [];
    });
    return [...own, ...nested];
  }
}

/** Weighted pick of an index (one draw); -1 when nothing weighs anything. */
function pickIndex(rand: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return -1;
  let r = rand() * total;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    r -= weights[i];
    if (r < 0) return i;
  }
  return last;
}

function streamOf(ctx: ResolveContext): () => number {
  if (ctx.rand) return ctx.rand;
  if (ctx.seed !== undefined) return mulberry32(ctx.seed >>> 0);
  return Math.random;
}

/**
 * Roll the table a link points at and follow it through: nested tables are
 * rolled in turn (same stream), until a row that is text, a note, a
 * terrain, a generator or nothing.
 */
export function resolveRoll(link: string, lookup: TableLookup, ctx: ResolveContext = {}): Resolved {
  return new Resolver(lookup, ctx).roll(link, streamOf(ctx), [], [], {});
}

export interface ResolvedOdds {
  kind: Resolved["kind"];
  value: string;
  /** 0..1 */
  odds: number;
}

/** The exact odds of every outcome resolveRoll can give for this link and context, most likely first. */
export function resolveOdds(link: string, lookup: TableLookup, ctx: Omit<ResolveContext, "rand" | "seed"> = {}): ResolvedOdds[] {
  const out = new Map<string, ResolvedOdds>();
  new Resolver(lookup, ctx).odds(link, [], 1, out);
  return [...out.values()].sort((a, b) => b.odds - a.odds || a.value.localeCompare(b.value));
}

/** The rows of a table (and the tables it links) that this context leaves out, and why (for warnings: never drop a row silently). */
export function skippedRows(link: string, lookup: TableLookup, ctx: Omit<ResolveContext, "rand" | "seed"> = {}): RowSkip[] {
  return new Resolver(lookup, ctx).skippedRows(link);
}

/**
 * The first row naming `name` (any case) in a table or the tables it links
 * (depth-first, loop-guarded): its attributes along the chain. For a
 * lookup like "what does the sector row of this world say".
 */
export function findRow(link: string, name: string, lookup: TableLookup, maxDepth = DEFAULT_MAX_DEPTH): { attrs: Record<string, string>; chain: ResolveStep[] } | undefined {
  const want = lc(name);
  const walk = (l: string, visited: string[], attrs: Record<string, string>, chain: ResolveStep[]): ReturnType<typeof findRow> => {
    const t = lookup.table(l);
    if (!t || visited.includes(t.key) || visited.length >= maxDepth) return undefined;
    const nested: [string, Record<string, string>, ResolveStep[]][] = [];
    for (let i = 0; i < t.table.entries.length; i++) {
      const e = t.table.entries[i];
      const a = { ...attrs, ...(rowInfoOf(t.table, i).attrs ?? {}) };
      const c = [...chain, { table: t.key, index: i, result: e.result }];
      if (lc(e.result) === want) return { attrs: a, chain: c };
      const link = entryLink(t.table, e);
      if (link !== undefined && lookup.table(link)) nested.push([link, a, c]);
    }
    for (const [l2, a, c] of nested) {
      const hit = walk(l2, [...visited, t.key], a, c);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(link, [], {}, []);
}

/** A readable chain: "Sector hexes → Mainworlds → ocean world". */
export function chainLabel(r: Resolved, nameOf: (key: string) => string = (k) => k.replace(/^.*\//, "").replace(/\.md$/i, "")): string {
  const parts = r.chain.map((s) => nameOf(s.table));
  const last = r.chain[r.chain.length - 1];
  if (last) parts.push(r.kind === "nothing" ? "(nothing)" : r.kind === "loop" ? r.value : last.result);
  return parts.join(" → ");
}

// ── row types (the seam for pickers, plan §2.5) ─────────────────────────────

/** Who made a table, when it isn't the user: "map" for the tables made for every terrain and region. */
export type TableMaker = "map";

/**
 * The `table-type:` values of the tables the map makes for itself: two per
 * terrain (`{tables}/terrain/description|encounters/<terrain>.md`) and one
 * per region (encounters, with `region:`). The starter tables (landmark,
 * weather…) have other types and count as the user's.
 */
export const MAP_MADE_TABLE_TYPES: readonly string[] = ["description", "encounters"];

/**
 * Who made a table, read from its frontmatter (never its name or folder):
 * "map" when `table-type:` is one of MAP_MADE_TABLE_TYPES, else undefined
 * (the user's). Deleting the `table-type:` line makes a table the user's.
 */
export function tableMadeBy(fm: Record<string, unknown> | null | undefined): TableMaker | undefined {
  const t = fm?.["table-type"];
  return typeof t === "string" && MAP_MADE_TABLE_TYPES.includes(lc(t)) ? "map" : undefined;
}

/** What a picker wants: tables whose rows are one of these, optionally of a terrain type. */
export interface TableWant {
  rows?: readonly RowType[];
  terrainType?: string;
  /**
   * Tables the map made (tableMadeBy): "group" puts them in their own
   * section after the user's tables ("Made by the map", collapsed where it
   * can be), "hide" leaves them out. Unset: listed with the rest.
   */
  mapMade?: "group" | "hide";
}

/** Heading of the section the map's own tables are grouped under. */
export const MAP_MADE_GROUP_LABEL = "Made by the map";

/**
 * How well a table fits a picker's want: "exact" (its `rows:` is wanted
 * and, for terrain rows, its terrain-type fits), "any" (`rows: any`, which
 * fits everything but sorts after exact matches) or "no" (with why, so a
 * picker can list it disabled rather than hide it). `group: "map"` when the
 * picker groups the map's own tables apart and this is one.
 */
export function tableFitsWant(
  table: Pick<RandomTable, "rows" | "terrainTypes"> & { madeBy?: TableMaker },
  want: TableWant,
): { fit: "exact" | "any" | "no"; why?: string; group?: "map" } {
  if (table.madeBy === "map" && want.mapMade) {
    if (want.mapMade === "hide") return { fit: "no", why: "the map made it for its terrains and regions" };
    const r = tableFitsWant({ rows: table.rows, terrainTypes: table.terrainTypes }, want);
    return { ...r, group: "map" };
  }
  if (!want.rows?.length) return { fit: table.rows ? "exact" : "any" };
  if (!table.rows) return { fit: "any" };
  if (!want.rows.includes(table.rows)) return { fit: "no", why: `its rows are ${table.rows}, not ${want.rows.join(" or ")}` };
  if (want.terrainType && table.rows === "terrain" && table.terrainTypes?.length && !table.terrainTypes.includes(lc(want.terrainType))) {
    return { fit: "no", why: `its terrain type is ${table.terrainTypes.join(", ")}, not ${want.terrainType}` };
  }
  return { fit: "exact" };
}

/** Which cell kinds a `rows:` type accepts. */
const ACCEPTS: Record<RowType, readonly CellKind[]> = {
  any: ["text", "note", "table", "generator", "terrain", "nothing"],
  text: ["text", "nothing"],
  note: ["note", "table", "nothing"],
  table: ["table", "nothing"],
  generator: ["generator", "nothing"],
  terrain: ["terrain", "table", "nothing"],
  biome: ["note", "table", "nothing"],
};

/**
 * Rows whose cell doesn't fit the table's `rows:` (a constraint, never a
 * parser switch: the row still reads and rolls; this is what the editor
 * and checks report).
 */
export function rowTypeProblems(table: RandomTable, lookup: TableLookup, ctx: Pick<ResolveContext, "terrains"> = {}): { index: number; message: string }[] {
  const rows = table.rows ?? "any";
  const out: { index: number; message: string }[] = [];
  table.entries.forEach((e, i) => {
    const { kind } = cellKind(table, e, lookup, ctx);
    if (ACCEPTS[rows].includes(kind)) return;
    const what = kind === "text" && rows === "terrain" ? "isn't a terrain of the palette" : `is ${kind === "text" ? "plain text" : `a ${kind}`}`;
    out.push({ index: i, message: `Row ${i + 1} ("${e.result}") ${what}, but the table's rows are ${rows}.` });
  });
  return out;
}

const GENERATOR_MARKERS = /^(?:hex-wfc|hexmaker-recipe|hexmaker-generator|template-file|results-folder):/m;

/** What a note is, from its text: a generator (generator note, recipe, workflow), a table, or another note. */
export function noteKind(content: string): "generator" | "table" | "note" {
  const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  if (GENERATOR_MARKERS.test(fm)) return "generator";
  if (/^dice:/m.test(fm) || /^rows:/m.test(fm)) return "table";
  const block = locateRollTable(content);
  return block?.recognized ? "table" : "note";
}

/**
 * A lookup over notes held in memory (path → text). Links resolve by path
 * (with or without `.md`) or by note name; `Note#Heading` reads the table
 * under that heading, so a table inside another note (a biome's Mix) rolls
 * like any table.
 */
export function notesLookup(notes: Record<string, string>): TableLookup {
  const paths = Object.keys(notes);
  const find = (target: string): string | undefined => {
    const t = lc(target).replace(/\.md$/, "");
    return paths.find((p) => lc(p).replace(/\.md$/, "") === t)
      ?? paths.find((p) => lc(p).replace(/\.md$/, "").replace(/^.*\//, "") === t.replace(/^.*\//, ""));
  };
  const split = (link: string) => {
    const i = link.indexOf("#");
    return i < 0 ? { target: link, heading: undefined } : { target: link.slice(0, i), heading: link.slice(i + 1) };
  };
  const cache = new Map<string, { key: string; table: RandomTable } | null>();
  return {
    table(link) {
      const { target, heading } = split(link);
      const path = find(target);
      if (!path) return undefined;
      const key = heading ? `${path}#${heading}` : path;
      if (!cache.has(key)) {
        const content = notes[path];
        const isTable = heading ? !!locateRollTable(content, heading) : noteKind(content) === "table";
        cache.set(key, isTable ? { key, table: parseRandomTable(content, { heading }) } : null);
      }
      return cache.get(key) ?? undefined;
    },
    kindOf(link) {
      const path = find(split(link).target);
      if (!path) return "missing";
      return noteKind(notes[path]) === "generator" ? "generator" : "note";
    },
  };
}

/** A lookup over tables held in memory, by key (names match any case, with or without `.md`). */
export function memoryLookup(tables: Record<string, RandomTable>, kinds: Record<string, "generator" | "note"> = {}): TableLookup {
  const norm = (s: string) => lc(s).replace(/\.md$/, "");
  const byKey = new Map(Object.entries(tables).map(([k, t]) => [norm(k), { key: k, table: t }]));
  return {
    table: (link) => byKey.get(norm(link)),
    kindOf: (link) => kinds[link] ?? (byKey.has(norm(link)) ? "note" : "missing"),
  };
}

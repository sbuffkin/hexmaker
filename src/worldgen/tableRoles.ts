/**
 * Generators roll on tables by role (plan-tables-everywhere §2.4).
 *
 * Each engine has a fixed list of named roles (ENGINE_ROLES, engine
 * schema). Where a role's table comes from is a TableSource: today the
 * World types note (space/worldTypesSource.ts, the SP1 adapter); later
 * plain table notes chosen per map, recipe or module (phase 3), with no
 * change to the engines.
 *
 * Engines and previews both go through rollRole / roleOdds, so the odds a
 * preview shows are the odds the generator rolls (F3). Every roll goes
 * through the table resolver (random-tables/resolve.ts).
 *
 * A role with no table, or whose table has no row that is a terrain of
 * the palette, is honest: equal odds over the palette's terrains of the
 * role's types, and a note saying so (rule 4). Rows that can't be placed
 * (not terrains of the palette) are never dropped silently: they are
 * listed in the notes.
 *
 * Pure: no Obsidian imports.
 */

import type { RandomTable } from "../random-tables/randomTable";
import { layeredLookup, notesLookup, resolveEach, resolveOdds, resolveRoll, skippedRows, type Resolved, type ResolvedOdds, type ResolveContext, type TableLookup } from "../random-tables/resolve";
import type { ConditionContext } from "../random-tables/tableConditions";
import type { OrbitZone } from "../space/worldTypes";
import type { OnceTracker } from "../arrival/eventsLedger";
import type { EngineRoleDef } from "../modules/types";
import { registry } from "../modules";

/** A table role id ("sector-hexes", "inner-orbits"…), from a module's roles. */
export type RoleId = string;

/** An engine's table role (its schema lives with the module; see EngineRoleDef). */
export type EngineRole = EngineRoleDef;

/**
 * Names (plan-tables-everywhere phase 6, F14): the core's own role, for
 * every map type. A map made from a hex of this map (a submap, a region,
 * a place found on arrival) takes its name from this table, rolled with the
 * hex's terrain and type as When context. A hex's own name still wins; with
 * no table the name is the hex's terrain and coordinates, as before.
 */
export const NAMES_ROLE: EngineRole = {
  id: "names",
  engine: "maps",
  name: "Names",
  rows: "text",
  terrainTypes: [],
  help: "Names for maps made from a hex of this map (submaps, regions, places found on arrival). A When column can fit names to the hex (type: forest, terrain: ocean world).",
  fallback: "the hex's terrain and coordinates",
  unsetLabel: "None (terrain and coordinates)",
};

/**
 * The engine role schema: every module's roles (src/modules; Space brings
 * Star scatter's and Orbits'), then the core's (Names). Roles are only
 * added by engines (tests/generatorRoles.test.ts checks coverage).
 */
export const ENGINE_ROLES: readonly EngineRole[] = [...registry.tableRoles(), NAMES_ROLE];

export const ZONE_ROLES: Record<OrbitZone, RoleId> = {
  inner: "inner-orbits",
  habitable: "habitable-orbits",
  outer: "outer-orbits",
};

export function engineRole(id: RoleId): EngineRole {
  const r = ENGINE_ROLES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown role ${id}`);
  return r;
}

export function rolesOf(engine: string): EngineRole[] {
  return ENGINE_ROLES.filter((r) => r.engine === engine);
}

/** Where a generator's roles roll: a table per role, read through the resolver. */
export interface TableSource {
  /** Shown in notes ("World types: Default space"). */
  readonly label: string;
  readonly lookup: TableLookup;
  /** The palette's terrain names (rows naming anything else are never placed). */
  readonly terrains: readonly string[];
  /** The table link a role rolls on; undefined = no table for it (equal odds). */
  tableFor(role: RoleId): string | undefined;
  /** The attributes of the row naming `name` in a role's table (Mainworld, Size, …). */
  rowAttrs(role: RoleId, name: string): Record<string, string> | undefined;
  /** Anything the source itself has to say about a role (rows it couldn't use). */
  notes?(role: RoleId): string[];
  /**
   * Once rows (SP6): what's used already, and where this run's fired ones
   * are recorded. Set by withOnce for one generator run.
   */
  readonly once?: OnceTracker;
}

/** The source with a Once tracker for one run (the tracker's ledgers leave used rows out). */
export function withOnce(source: TableSource | undefined, once: OnceTracker): TableSource | undefined {
  if (!source) return undefined;
  return {
    label: source.label,
    lookup: source.lookup,
    terrains: source.terrains,
    tableFor: (role) => source.tableFor(role),
    rowAttrs: (role, name) => source.rowAttrs(role, name),
    ...(source.notes ? { notes: (role: RoleId) => source.notes!(role) } : {}),
    once,
  };
}

/** What the engine knows where it rolls (conditions), plus its random stream. */
export interface RoleContext extends ConditionContext {
  rand: () => number;
  /**
   * Leave rows whose Roll is "on arrival" for later (Star scatter): the pick
   * then says which table to roll on arrival and what the hex shows until
   * then (plan-tables-everywhere §2.6).
   */
  deferArrival?: boolean;
  /** The hex the roll is for ("x_y"), written with any Once row it fires. */
  where?: string;
}

export interface RolePick {
  /** The terrain to place; "" for a (nothing) row, or an on-arrival row with nothing to show. */
  terrain: string;
  nothing?: boolean;
  attrs: Record<string, string>;
  /** An on-arrival row (deferArrival): the table to roll when someone arrives. */
  arrival?: string;
}

/**
 * The link of the in-memory equal-odds table: the palette's terrains of a
 * role's types, weight 1 each. A source may link it (a remainder row whose
 * own table has nothing for this palette).
 */
export const EQUAL_ODDS = "(equal odds)";

function withEqualOdds(lookup: TableLookup, fallback: readonly string[]): TableLookup {
  const table: RandomTable = { dice: 0, rows: "terrain", entries: fallback.map((n) => ({ result: n, weight: 1 })) };
  return {
    table: (link) => (link === EQUAL_ODDS ? { key: EQUAL_ODDS, table } : lookup.table(link)),
    kindOf: (link) => lookup.kindOf?.(link) ?? "note",
  };
}

const NO_SOURCE: TableLookup = { table: () => undefined };

function resolveCtx(source: TableSource | undefined, fallback: readonly string[], ctx: ConditionContext & { deferArrival?: boolean }): ResolveContext {
  return { ...ctx, terrains: source?.terrains ?? fallback, onlyTerrains: true };
}

/** Whether the role's own table gives anything here (else equal odds). */
function usesTable(source: TableSource | undefined, role: RoleId, fallback: readonly string[], ctx: ConditionContext): string | undefined {
  const link = source?.tableFor(role);
  if (!link || !source) return undefined;
  const odds = resolveOdds(link, withEqualOdds(source.lookup, fallback), resolveCtx(source, fallback, ctx));
  return odds.some((o) => o.kind !== "empty") ? link : undefined;
}

/**
 * Roll a role: its table through the resolver, else equal odds over
 * `fallback` (the palette's terrains of the role's types). Undefined when
 * there is nothing at all to place.
 */
export function rollRole(source: TableSource | undefined, role: RoleId, ctx: RoleContext, fallback: readonly string[]): RolePick | undefined {
  const lookup = withEqualOdds(source?.lookup ?? NO_SOURCE, fallback);
  const { rand, deferArrival, where, ...cond } = ctx;
  const link = usesTable(source, role, fallback, cond) ?? EQUAL_ODDS;
  const once = source?.once;
  const r = resolveRoll(link, lookup, {
    ...resolveCtx(source, fallback, cond),
    rand,
    ...(deferArrival ? { deferArrival } : {}),
    ...(once ? { isUsed: once.isUsed } : {}),
  });
  once?.fire(r.onces, where);
  if (r.kind === "nothing") return { terrain: "", nothing: true, attrs: r.attrs };
  if (r.kind === "deferred") {
    // Shown as a palette terrain (its spelling), else nothing shown yet.
    const terrains = source?.terrains ?? fallback;
    const shown = r.shownAs ? terrains.find((t) => t.trim().toLowerCase() === r.shownAs!.trim().toLowerCase()) : undefined;
    return { terrain: shown ?? "", attrs: r.attrs, arrival: r.value };
  }
  if (r.kind === "terrain") return { terrain: r.value, attrs: r.attrs };
  return undefined;
}

export interface RoleOdds {
  /** Each outcome's exact odds (0..1), most likely first; terrain "" = (nothing). */
  odds: { terrain: string; odds: number }[];
  /** Where the odds come from: the table, or "equal odds". */
  from: string;
  /** Rows that are never placed and why, and the fallback, in plain words. */
  notes: string[];
}

/** The exact odds rollRole samples for this role and context, and what to tell the user. */
export function roleOdds(source: TableSource | undefined, role: RoleId, ctx: ConditionContext, fallback: readonly string[]): RoleOdds {
  const spec = engineRole(role);
  const lookup = withEqualOdds(source?.lookup ?? NO_SOURCE, fallback);
  const notes: string[] = [...(source?.notes?.(role) ?? [])];
  const own = source?.tableFor(role);
  const link = usesTable(source, role, fallback, ctx);
  const rctx = resolveCtx(source, fallback, ctx);
  if (own && source) {
    const skipped = skippedRows(own, lookup, rctx).filter((s) => s.why === "not-terrain");
    if (skipped.length) {
      notes.push(`${source.label}: ${spec.name} ${skipped.length === 1 ? "row" : "rows"} not a terrain of this palette, so never placed: ${[...new Set(skipped.map((s) => s.result))].join(", ")}.`);
    }
  }
  if (!link) {
    notes.push(!source || !own
      ? `${spec.name}: no table, so equal odds over the palette's ${spec.fallback}.`
      : `${source.label}: no ${spec.name} row fits this palette here, so equal odds over its ${spec.fallback}.`);
  }
  const odds = resolveOdds(link ?? EQUAL_ODDS, lookup, rctx)
    .filter((o) => o.kind === "terrain" || o.kind === "nothing")
    .map((o) => ({ terrain: o.kind === "nothing" ? "" : o.value, odds: o.odds }));
  return { odds, from: link && source ? source.label : "equal odds", notes };
}

// ── roles whose rows aren't terrains to place (Moons, System extras, Names) ──

let shippedCache: TableLookup | undefined;

/** Every module's shipped tables, in memory, by their path under the tables folder (and note name). */
export function shippedTablesLookup(): TableLookup {
  shippedCache ??= notesLookup(Object.fromEntries(registry.shippedTables().map((t) => [t.path, t.text])));
  return shippedCache;
}

/**
 * The table a role rolls on and how to read it: the source's (a map's or
 * the setup's), else the role's shipped default (its installed copy is
 * named by the source, see tableSources.ts withShippedRoleTables; else the
 * shipped text). Undefined: no table at all.
 */
export function roleTable(source: TableSource | undefined, role: RoleId): { link: string; lookup: TableLookup; shipped: boolean } | undefined {
  const own = source?.tableFor(role);
  if (own && source?.lookup.table(own)) return { link: own, lookup: layeredLookup(source.lookup, shippedTablesLookup()), shipped: false };
  const def = engineRole(role).defaultTable;
  if (def && shippedTablesLookup().table(def)) return { link: def, lookup: shippedTablesLookup(), shipped: true };
  return undefined;
}

/** What a role's roll needs: the conditions it knows, and its random stream. */
export type RoleValueContext = ConditionContext & { rand: () => number; where?: string };

/**
 * Roll a role whose rows are values, not terrains to place (Moons: a count;
 * Names: a name): one row through the resolver. Undefined when the role
 * has no table, or nothing could come up.
 */
export function rollRoleValue(source: TableSource | undefined, role: RoleId, ctx: RoleValueContext): Resolved | undefined {
  const t = roleTable(source, role);
  if (!t) return undefined;
  const { rand, where, ...cond } = ctx;
  const once = source?.once;
  const r = resolveRoll(t.link, t.lookup, { ...cond, rand, ...(once ? { isUsed: once.isUsed } : {}) });
  once?.fire(r.onces, where);
  return r.kind === "empty" || r.kind === "loop" ? undefined : r;
}

/** The odds of each value a role can give here (empty: no table). */
export function roleValueOdds(source: TableSource | undefined, role: RoleId, ctx: ConditionContext): ResolvedOdds[] {
  const t = roleTable(source, role);
  return t ? resolveOdds(t.link, t.lookup, ctx) : [];
}

/**
 * Roll a role "for each line" (System extras: a `pick: each` table, every
 * row on its own Chance). Empty when the role has no table.
 */
export function rollRoleEach(source: TableSource | undefined, role: RoleId, ctx: RoleValueContext): Resolved[] {
  const t = roleTable(source, role);
  if (!t) return [];
  const { rand, where, ...cond } = ctx;
  const once = source?.once;
  const out = resolveEach(t.link, t.lookup, { ...cond, rand, ...(once ? { isUsed: once.isUsed } : {}) });
  for (const r of out) once?.fire(r.onces, where);
  return out.filter((r) => r.kind !== "empty" && r.kind !== "loop");
}

const COUNT_WORDS: Record<string, number> = { zero: 0, none: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * A count read from a rolled value ("none", "2", "two moons", "(nothing)"
 * → 0, 2, 2, 0). Undefined when it isn't one.
 */
export function readCount(r: Pick<Resolved, "kind" | "value"> | undefined): number | undefined {
  if (!r || r.kind === "nothing") return 0;
  const t = r.value.trim().toLowerCase().replace(/^.*\//, "").replace(/\.md$/, "");
  if (t === "" || /^\(?(?:none|nothing)\)?$/.test(t)) return 0;
  const n = /^(\d+)/.exec(t);
  if (n) return Number(n[1]);
  const w = /^([a-z]+)/.exec(t)?.[1];
  return w !== undefined && w in COUNT_WORDS ? COUNT_WORDS[w] : undefined;
}

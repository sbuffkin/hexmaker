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

import type { RandomTable, RowType } from "../random-tables/randomTable";
import { resolveOdds, resolveRoll, skippedRows, type ResolveContext, type TableLookup } from "../random-tables/resolve";
import type { ConditionContext } from "../random-tables/tableConditions";
import type { OrbitZone } from "../space/worldTypes";

export type RoleId = "sector-hexes" | "star" | "inner-orbits" | "habitable-orbits" | "outer-orbits";

export interface EngineRole {
  id: RoleId;
  /** The generator id that rolls on it. */
  engine: string;
  /** Its name, as shown and as written in a recipe's Tables section. */
  name: string;
  /** What its rows must be. */
  rows: RowType;
  /** Terrain types its rows place, and what equal odds fall back to. */
  terrainTypes: readonly string[];
  /** What the generator does with a roll (help text). */
  help: string;
  /** What equal odds run over when there is no table (plain words). */
  fallback: string;
}

/** The engine role schema. Roles are only added by engines (tests/generatorRoles.test.ts checks coverage). */
export const ENGINE_ROLES: readonly EngineRole[] = [
  {
    id: "sector-hexes",
    engine: "procedural:star-scatter",
    name: "Sector hexes",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids", "station", "starport", "jump-point", "anomaly"],
    help: "What each star system hex of a sector is: its mainworld, or a special hex like a station. A row's Mainworld says which body is that system's mainworld.",
    fallback: "world terrains (no special hexes)",
  },
  {
    id: "star",
    engine: "procedural:orbits",
    name: "Star",
    rows: "terrain",
    terrainTypes: ["star"],
    help: "The star at the centre of a system, when the Star option is Random.",
    fallback: "star terrains",
  },
  {
    id: "inner-orbits",
    engine: "procedural:orbits",
    name: "Inner orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the inner zone (the first 30% of the rings).",
    fallback: "planet terrains",
  },
  {
    id: "habitable-orbits",
    engine: "procedural:orbits",
    name: "Habitable orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the habitable zone (30–60% of the rings).",
    fallback: "planet terrains",
  },
  {
    id: "outer-orbits",
    engine: "procedural:orbits",
    name: "Outer orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the outer zone (the rest of the rings).",
    fallback: "planet terrains",
  },
];

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
}

/** What the engine knows where it rolls (conditions), plus its random stream. */
export interface RoleContext extends ConditionContext {
  rand: () => number;
}

export interface RolePick {
  /** The terrain to place; "" for a (nothing) row. */
  terrain: string;
  nothing?: boolean;
  attrs: Record<string, string>;
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

function resolveCtx(source: TableSource | undefined, fallback: readonly string[], ctx: ConditionContext): ResolveContext {
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
  const { rand, ...cond } = ctx;
  const link = usesTable(source, role, fallback, cond) ?? EQUAL_ODDS;
  const r = resolveRoll(link, lookup, { ...resolveCtx(source, fallback, cond), rand });
  if (r.kind === "nothing") return { terrain: "", nothing: true, attrs: r.attrs };
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

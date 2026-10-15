/**
 * Where a generator's role tables come from (plan-tables-everywhere §2.4,
 * phase 3). First match wins, per role:
 *
 *   1. the map's own Tables (Map properties → Tables, T11), else the
 *      nearest map above it that sets one (inherited down the map tree);
 *   2. the generator's setup: the World types option's table — a
 *      converted note's `## Tables` list (space/spaceTables.ts), or an
 *      unconverted note read as tables (space/worldTypesSource.ts). This
 *      is the recipe seam: a recipe's `## Tables` slots in here later;
 *   3. a bound module's table (modules don't exist yet: nothing here);
 *   4. none: equal odds (tableRoles.ts says so).
 *
 * Pure: no Obsidian imports.
 */

import { findRow, tableFitsWant, type TableLookup } from "../random-tables/resolve";
import type { RandomTable } from "../random-tables/randomTable";
import { ENGINE_ROLES, engineRole, type RoleId, type TableSource } from "./tableRoles";

/** A role's table and where it was set. */
export interface RoleTablePick {
  /** The table note's link target (vault path, with or without .md). */
  link: string;
  /** The map that set it. */
  from: string;
}

/**
 * Each role's table from the map tree: the map's own, else the nearest
 * ancestor's (`parentOf` walks up; cycles stop).
 */
export function inheritedRoleTables(
  mapName: string,
  tablesOf: (map: string) => Record<string, string> | undefined,
  parentOf: (map: string) => string | undefined,
): Partial<Record<RoleId, RoleTablePick>> {
  const out: Partial<Record<RoleId, RoleTablePick>> = {};
  const seen = new Set<string>();
  for (let m: string | undefined = mapName; m && !seen.has(m); m = parentOf(m)) {
    seen.add(m);
    const own = tablesOf(m) ?? {};
    for (const r of ENGINE_ROLES) {
      const link = own[r.id];
      if (link && !out[r.id]) out[r.id] = { link, from: m };
    }
  }
  return out;
}

/** A role's tables straight from notes (a converted set, or a map's Tables). */
export function notesTableSource(
  links: Partial<Record<RoleId, string>>,
  lookup: TableLookup,
  terrains: readonly string[],
  label: string,
): TableSource {
  return {
    label,
    lookup,
    terrains,
    tableFor: (role) => links[role],
    rowAttrs: (role, name) => {
      const link = links[role];
      return link ? findRow(link, name, lookup)?.attrs : undefined;
    },
  };
}

/**
 * The generator setup's source with some roles set elsewhere (a map's
 * Tables): those roles roll on their own table from the notes, the rest
 * as the base says. Links are looked up in the base first (its in-memory
 * tables), then in the notes.
 */
export function layeredSource(
  base: TableSource | undefined,
  overrides: Partial<Record<RoleId, string>>,
  notes: TableLookup,
  terrains: readonly string[],
): TableSource | undefined {
  const lookup: TableLookup = {
    table: (link) => base?.lookup.table(link) ?? notes.table(link),
    kindOf: (link) => {
      const k = base?.lookup.kindOf?.(link);
      return k && k !== "missing" ? k : notes.kindOf?.(link) ?? "note";
    },
  };
  // A role whose table is gone (deleted, renamed) falls through to the base.
  const own: Partial<Record<RoleId, string>> = {};
  for (const [role, link] of Object.entries(overrides) as [RoleId, string][]) if (link && lookup.table(link)) own[role] = link;
  const missing = (Object.keys(overrides)).filter((r) => !own[r]);
  if (!Object.keys(own).length && !missing.length) return base;
  return {
    label: base ? `${base.label} (with this map's tables)` : "This map's tables",
    lookup,
    terrains: base?.terrains ?? terrains,
    tableFor: (role) => own[role] ?? base?.tableFor(role),
    rowAttrs: (role, name) => {
      const link = own[role];
      if (link) return findRow(link, name, lookup)?.attrs ?? base?.rowAttrs(role, name);
      return base?.rowAttrs(role, name);
    },
    notes: (role) => [
      ...(missing.includes(role) ? [`${engineRole(role).name}: the table set for this map (${overrides[role]}) isn't there, so the usual one is used.`] : []),
      ...(own[role] ? [] : base?.notes?.(role) ?? []),
    ],
  };
}

/**
 * The attributes of the row that names `terrain` in any role's table
 * (Sector hexes first): what a hex of that terrain opens into (its Size,
 * Generator, Palette…). Undefined when no table names it.
 */
export function attrsForTerrain(source: TableSource | undefined, terrain: string): Record<string, string> | undefined {
  if (!source || !terrain) return undefined;
  for (const r of ENGINE_ROLES) {
    const attrs = source.rowAttrs(r.id, terrain);
    if (attrs) return attrs;
  }
  return undefined;
}

/**
 * The tables a role can roll on, for a picker (plan §2.5): those whose
 * `rows:` (and terrain type) fit the role exactly, the space folder's
 * first, then by path. Tables with `rows: any` (every older table) are
 * left out: they'd list every table in the vault. A picker offers "Other
 * table…" for those.
 */
export function fittingRoleTables(
  tables: readonly { path: string; table: Pick<RandomTable, "rows" | "terrainTypes"> }[],
  role: RoleId,
  spaceFolder: string,
): string[] {
  const spec = engineRole(role);
  const want = { rows: [spec.rows], terrainType: spec.terrainTypes[0] };
  const inSpace = (p: string) => (spaceFolder && p.startsWith(`${spaceFolder}/`) ? 0 : 1);
  return tables
    .filter((t) => tableFitsWant(t.table, want).fit === "exact")
    .map((t) => t.path)
    .sort((a, b) => inSpace(a) - inSpace(b) || a.localeCompare(b));
}

/**
 * The installed copies of the roles' shipped tables (T12): a role no map
 * or setup names, whose shipped table is installed in the tables folder
 * (`{tables}/<path>`, see EngineRoleDef.defaultTable), rolls on that note,
 * so editing it changes the odds. A role whose copy isn't there rolls on
 * the shipped text (tableRoles.ts roleTable). Undefined in, nothing
 * installed: undefined out.
 */
export function withShippedRoleTables(
  base: TableSource | undefined,
  notes: TableLookup,
  terrains: readonly string[],
  tablesFolder: string,
): TableSource | undefined {
  const installed: Partial<Record<RoleId, string>> = {};
  for (const r of ENGINE_ROLES) {
    if (!r.defaultTable || base?.tableFor(r.id)) continue;
    const path = tablesFolder ? `${tablesFolder}/${r.defaultTable}` : r.defaultTable;
    if (notes.table(path)) installed[r.id] = path;
  }
  if (!Object.keys(installed).length) return base;
  const lookup: TableLookup = {
    table: (link) => base?.lookup.table(link) ?? notes.table(link),
    kindOf: (link) => {
      const k = base?.lookup.kindOf?.(link);
      return k && k !== "missing" ? k : notes.kindOf?.(link) ?? "note";
    },
  };
  return {
    label: base?.label ?? "Shipped tables",
    lookup,
    terrains: base?.terrains ?? terrains,
    tableFor: (role) => base?.tableFor(role) ?? installed[role],
    rowAttrs: (role, name) => {
      const link = base?.tableFor(role) ? undefined : installed[role];
      return link ? findRow(link, name, lookup)?.attrs : base?.rowAttrs(role, name);
    },
    ...(base?.notes ? { notes: (role: RoleId) => base.notes!(role) } : {}),
    ...(base?.once ? { once: base.once } : {}),
  };
}

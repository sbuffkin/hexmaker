/**
 * SP1: the World types note drives Star scatter and Orbits. An adapter
 * that reads a world types table (worldTypes.ts) as the engines' role
 * tables (worldgen/tableRoles.ts), so the generators roll on it through
 * the table resolver today, before the space tables of phase 3 exist.
 *
 * The note's tables become in-memory random tables:
 * - Mainworlds: the worlds rows for a sector (Map sector or blank).
 * - Sector hexes: one row per sector feature (its Chance as the weight,
 *   so a star system hex is that feature with exactly that chance), and
 *   the rest of the odds a row that rolls on Mainworlds. Features that
 *   aren't terrains of the palette are left out (their chance goes to the
 *   systems, as before) and listed in the notes.
 * - Stars: the Stars rows.
 * - Inner / Habitable / Outer orbits: the worlds rows for a system (Map
 *   system or blank) whose Orbit allows that zone; ring, Stars and
 *   Temperature limits become When conditions.
 * Every row keeps its setup columns (Mainworld, Size, Generator, …) as
 * row attributes.
 *
 * The same odds as the old pick functions (pickWorldType, pickStar,
 * pickSectorFeature), different draws (T4).
 *
 * Pure: no Obsidian imports.
 */

import type { RandomTable, RandomTableEntry, RowInfo } from "../random-tables/randomTable";
import { findRow, isNothing, memoryLookup } from "../random-tables/resolve";
import type { TableCondition } from "../random-tables/tableConditions";
import { EQUAL_ODDS, type RoleId, type TableSource } from "../worldgen/tableRoles";
import type { ProcOption } from "../worldgen/procedural/common";
import {
  WORLD_TYPE_COLUMNS,
  worldTypeCells,
  type OrbitZone,
  type WorldTypeRow,
  type WorldTypeTable,
} from "./worldTypes";

const MAINWORLDS = "Mainworlds";
const SECTOR_HEXES = "Sector hexes";
const STARS = "Stars";
const ZONE_TABLES: Record<OrbitZone, string> = { inner: "Inner orbits", habitable: "Habitable orbits", outer: "Outer orbits" };
const ROLE_TABLE: Record<RoleId, string> = {
  "sector-hexes": SECTOR_HEXES,
  star: STARS,
  "inner-orbits": ZONE_TABLES.inner,
  "habitable-orbits": ZONE_TABLES.habitable,
  "outer-orbits": ZONE_TABLES.outer,
};

/** The columns carried as row attributes. */
const ATTR_COLUMNS = ["Mainworld", "Size", "Generator", "Options", "Palette", "Base", "Notes"] as const;

const lc = (s: string) => s.trim().toLowerCase();

export function attrsOf(r: WorldTypeRow): Record<string, string> {
  const cells = worldTypeCells(r);
  const out: Record<string, string> = {};
  for (const c of ATTR_COLUMNS) {
    const v = cells[WORLD_TYPE_COLUMNS.indexOf(c)];
    if (v) out[c] = v;
  }
  return out;
}

/** A worlds row's limits other than map and zone, as When conditions. */
export function conditionsOf(r: WorldTypeRow): TableCondition[] {
  const out: TableCondition[] = [];
  if (r.distance) out.push({ key: "ring", range: { ...r.distance } });
  if (r.stars?.length) out.push({ key: "star", values: r.stars.map(lc) });
  if (r.temperature) out.push({ key: "temperature", range: { ...r.temperature } });
  return out;
}

function worldsTable(rows: readonly WorldTypeRow[]): RandomTable {
  const entries: RandomTableEntry[] = [];
  const rowInfo: RowInfo[] = [];
  for (const r of rows) {
    if (!r.world.trim()) continue;
    entries.push({ result: r.world.trim(), weight: r.weight ?? 1 });
    const info: RowInfo = {};
    const attrs = attrsOf(r);
    if (Object.keys(attrs).length) info.attrs = attrs;
    const when = conditionsOf(r);
    if (when.length) info.when = when;
    rowInfo.push(info);
  }
  return { dice: 0, rows: "terrain", entries, rowInfo };
}

const paletteName = (t: string | { name: string }) => (typeof t === "string" ? t : t.name);

// ── the space generators' "World types" option ────────────────────────────

/** Option key: which World types table Star scatter and Orbits roll on. */
export const WORLD_TYPES_KEY = "worldTypes";
/** The default table: "Default space" if there is one, else the first. */
export const WORLD_TYPES_DEFAULT = "(default)";
/** No table: equal odds (said in the generator's warnings). */
export const WORLD_TYPES_NONE = "(none)";

/** The option, for these table names (`fallbackName` = what "Default" means now). */
export function worldTypesOption(names: readonly string[], fallbackName?: string): ProcOption {
  return {
    key: WORLD_TYPES_KEY,
    label: "World types",
    choices: [
      { value: WORLD_TYPES_DEFAULT, label: fallbackName ? `Default (${fallbackName})` : "Default" },
      ...names.map((n) => ({ value: n, label: n })),
      { value: WORLD_TYPES_NONE, label: "None (equal odds)" },
    ],
    default: WORLD_TYPES_DEFAULT,
  };
}

/** The table name an option value means (undefined = none). */
export function chosenWorldTypes(value: string | undefined, names: readonly string[], fallbackName: string | undefined): string | undefined {
  if (value === WORLD_TYPES_NONE) return undefined;
  if (!value || value === WORLD_TYPES_DEFAULT) return fallbackName;
  return value;
}

/** What "Default" means: the shipped table's name if there is one, else the first table. */
export function defaultWorldTypesName(names: readonly string[], shipped: string): string | undefined {
  return names.find((n) => lc(n) === lc(shipped)) ?? names[0];
}

/**
 * The role tables a world types table gives for a palette. `label` names
 * it in notes (default "World types: <name>").
 */
export function worldTypesSource(table: WorldTypeTable, palette: readonly (string | { name: string })[], label = `World types: ${table.name}`): TableSource {
  const terrains = palette.map(paletteName);
  const inPalette = (n: string) => terrains.some((t) => lc(t) === lc(n));

  const sectorRows = table.rows.filter((r) => r.map !== "system");
  const systemRows = table.rows.filter((r) => r.map !== "sector");
  const mainworlds = worldsTable(sectorRows);
  const anyMainworld = sectorRows.some((r) => (r.weight ?? 1) > 0 && (inPalette(r.world) || isNothing(r.world)));

  // Sector hexes: features by their chance, then the systems.
  const featureNotes: string[] = [];
  const features: RandomTableEntry[] = [];
  let left = 1;
  const seen = new Set<string>();
  for (const f of table.features ?? []) {
    const name = f.feature.trim();
    if (!name || !(f.chance > 0)) continue;
    if (!inPalette(name)) { featureNotes.push(name); continue; }
    const key = lc(name);
    const chance = Math.max(0, Math.min(f.chance, left));
    left -= chance;
    if (seen.has(key)) {
      const e = features.find((x) => lc(x.result) === key);
      if (e) e.weight += chance;
      continue;
    }
    seen.add(key);
    if (chance > 0) features.push({ result: terrains.find((t) => lc(t) === key) ?? name, weight: chance });
  }
  const sectorHexes: RandomTable = {
    dice: 0,
    rows: "terrain",
    entries: [
      ...features,
      ...(left > 1e-12 ? [{ result: anyMainworld ? MAINWORLDS : EQUAL_ODDS, weight: left, isLink: true }] : []),
    ],
  };

  const stars: RandomTable | undefined = table.stars?.length
    ? { dice: 0, rows: "terrain", entries: table.stars.filter((s) => s.star.trim()).map((s) => ({ result: s.star.trim(), weight: s.weight ?? 1 })) }
    : undefined;

  const tables: Record<string, RandomTable> = { [MAINWORLDS]: mainworlds, [SECTOR_HEXES]: sectorHexes };
  if (stars) tables[STARS] = stars;
  for (const z of Object.keys(ZONE_TABLES) as OrbitZone[]) {
    tables[ZONE_TABLES[z]] = worldsTable(systemRows.filter((r) => !r.zones?.length || r.zones.includes(z)));
  }
  const lookup = memoryLookup(tables);

  return {
    label,
    lookup,
    terrains,
    tableFor: (role) => (role === "star" && !stars ? undefined : ROLE_TABLE[role]),
    rowAttrs: (role, name) => findRow(role === "sector-hexes" ? MAINWORLDS : ROLE_TABLE[role], name, lookup)?.attrs,
    notes: (role) => role === "sector-hexes" && featureNotes.length
      ? [`${label}: Sector features not a terrain of this palette, so never placed: ${[...new Set(featureNotes)].join(", ")}.`]
      : [],
  };
}

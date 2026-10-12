import type { MapData } from "./types";

/**
 * Weather and rumours come from tables attached to the region (the map), not
 * to each hex (E2): a map note can name a weather table and a rumours table,
 * and a hex can override either by linking its own table in its note (under
 * "### Weather Table" / "### Rumors Table", like the Encounters Table). With
 * neither, the starter table in the tables folder is used if it exists
 * (shipped as data by the World module, src/modules/world/tables).
 */

export type RolledSection = "weather" | "hooks & rumors";

export interface RolledSectionTables {
  /** MapData field holding the region's table. */
  mapField: "weatherTable" | "rumorsTable";
  /** Link section in the hex note for a per-hex table. */
  hexSection: string;
  /** Starter table file name in the tables folder. */
  starterFile: string;
  /** Plain name used in UI text. */
  noun: string;
}

export const ROLLED_SECTION_TABLES: Record<RolledSection, RolledSectionTables> = {
  weather: { mapField: "weatherTable", hexSection: "Weather Table", starterFile: "weather.md", noun: "weather" },
  "hooks & rumors": { mapField: "rumorsTable", hexSection: "Rumors Table", starterFile: "rumors.md", noun: "rumours" },
};

export function isRolledSection(key: string): key is RolledSection {
  return key === "weather" || key === "hooks & rumors";
}

export type TableSource = "hex" | "map" | "starter";

export interface PickedTable {
  path: string;
  source: TableSource;
}

/**
 * The table to roll for a section: the hex's own link wins, then the map's
 * table, then the starter table. Paths that don't exist are skipped (a
 * renamed or deleted table falls through to the next one).
 */
export function pickSectionTable(
  candidates: { hex?: string | null; map?: string | null; starter?: string | null },
  exists: (path: string) => boolean,
): PickedTable | null {
  for (const source of ["hex", "map", "starter"] as const) {
    const p = candidates[source];
    if (p && exists(p)) return { path: p, source };
  }
  return null;
}

/** The map's table for a section (undefined when unset or blank). */
export function mapSectionTable(map: Pick<MapData, "weatherTable" | "rumorsTable"> | undefined, section: RolledSection): string | undefined {
  const v = map?.[ROLLED_SECTION_TABLES[section].mapField];
  return v && v.trim() ? v : undefined;
}

/** Starter-table path in the tables folder ("" = vault root). */
export function starterTablePath(tablesFolder: string, section: RolledSection): string {
  const file = ROLLED_SECTION_TABLES[section].starterFile;
  return tablesFolder ? `${tablesFolder}/${file}` : file;
}

/** Short "from …" text for the source of a rolled table. */
export function tableSourceLabel(source: TableSource): string {
  return source === "hex" ? "this hex's table" : source === "map" ? "the map's table" : "the starter table";
}

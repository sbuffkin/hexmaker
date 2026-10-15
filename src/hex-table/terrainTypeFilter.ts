import type { TerrainColor } from "../types";
import { TERRAIN_TYPES, terrainTypeInfo } from "../terrainTypes";

/**
 * Pure (Obsidian-free) helpers for the hex table's terrain type column,
 * type filter and type sort.
 */

/**
 * Type id of a terrain via its palette entry. Returns "" when the terrain
 * is unset, not in the palette, has no type, or has an unknown type id.
 * Never infers from the name: an untagged terrain shows no type.
 */
export function resolveTerrainType(
  terrainName: string | null | undefined,
  palette: ReadonlyMap<string, TerrainColor>,
): string {
  if (!terrainName) return "";
  const type = palette.get(terrainName)?.type;
  return terrainTypeInfo(type) ? type! : "";
}

/** Display label for a type id ("" for none/unknown). */
export function terrainTypeLabel(typeId: string): string {
  return terrainTypeInfo(typeId)?.label ?? "";
}

const TYPE_ORDER = new Map(TERRAIN_TYPES.map((t, i) => [t.id, i]));

/**
 * Compare two type ids in vocabulary order (water → land → space), so
 * related types sort together. Untyped ("" or unknown) sorts last.
 */
export function compareTerrainTypes(a: string, b: string): number {
  const ia = TYPE_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
  const ib = TYPE_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
  return ia - ib;
}

export interface TerrainTypeGroup {
  typeId: string;
  label: string;
  entries: TerrainColor[];
}

/**
 * Split a palette into type groups (vocabulary order, only types present)
 * and the entries with no valid type, which keep palette order.
 */
export function groupPaletteByType(palette: readonly TerrainColor[]): {
  groups: TerrainTypeGroup[];
  untyped: TerrainColor[];
} {
  const byType = new Map<string, TerrainColor[]>();
  const untyped: TerrainColor[] = [];
  for (const entry of palette) {
    const info = terrainTypeInfo(entry.type);
    if (!info) {
      untyped.push(entry);
      continue;
    }
    let list = byType.get(info.id);
    if (!list) byType.set(info.id, (list = []));
    list.push(entry);
  }
  const groups = [...byType.entries()]
    .sort(([a], [b]) => compareTerrainTypes(a, b))
    .map(([typeId, entries]) => ({
      typeId,
      label: terrainTypeLabel(typeId),
      entries,
    }));
  return { groups, untyped };
}

export interface TerrainFilterState {
  /** Terrain names to include ("" = no terrain). */
  terrains: ReadonlySet<string>;
  excludeTerrains: ReadonlySet<string>;
  /** Type ids to include / exclude. */
  types: ReadonlySet<string>;
  excludeTypes: ReadonlySet<string>;
}

export interface TerrainFilterRow {
  /** The hex's own terrain ("" when unset). */
  terrain: string;
  /** The terrain the map displays: own terrain, else the map's base terrain. */
  effectiveTerrain: string;
  /** Type id of the effective terrain ("" when none). */
  type: string;
}

/**
 * Whether a row passes the terrain/type filter. Include sets are a union:
 * when any include set is non-empty, the row must match a selected terrain
 * (own or displayed) or a selected type. Any exclude match hides the row.
 */
export function matchesTerrainFilter(
  row: TerrainFilterRow,
  f: TerrainFilterState,
): boolean {
  const names = [row.terrain, row.effectiveTerrain];
  if (names.some((n) => f.excludeTerrains.has(n))) return false;
  if (row.type && f.excludeTypes.has(row.type)) return false;
  if (f.terrains.size === 0 && f.types.size === 0) return true;
  if (names.some((n) => f.terrains.has(n))) return true;
  return !!row.type && f.types.has(row.type);
}

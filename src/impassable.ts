import type { PathType, TerrainColor } from "./types";
import { effectiveTerrainType, terrainTypeGroup, TERRAIN_GROUPS, typesInGroup, type TerrainGroup } from "./terrainTypes";

/**
 * Impassable terrain, for the path tool's auto-route.
 *
 * A terrain is impassable when its palette entry says so (`impassable`), or,
 * when unset, by its terrain type's GROUP (PA4): every type in the water
 * group (deep water, water, shallows) is impassable by default. Defaults go
 * by type, never by terrain name, so any palette (custom ones too) gets
 * them; an untyped terrain counts as the type its name suggests
 * (effectiveTerrainType). Hex-by-hex drawing ignores all of this; only
 * auto-route asks.
 */

/** Type groups that are impassable unless a terrain says otherwise. */
export const IMPASSABLE_BY_DEFAULT_GROUPS: readonly TerrainGroup[] = ["water"];

/** Terrain types that are impassable by default (the types of those groups). */
export const IMPASSABLE_BY_DEFAULT_TYPES: readonly string[] = IMPASSABLE_BY_DEFAULT_GROUPS.flatMap(typesInGroup);

/** Impassable by default for this terrain type (no explicit flag). */
export function impassableByType(type: string | undefined): boolean {
  const group = terrainTypeGroup(type);
  return !!group && IMPASSABLE_BY_DEFAULT_GROUPS.includes(group);
}

/** What a terrain needs for its impassable default. */
type ImpassableInput = Pick<TerrainColor, "impassable" | "type"> & { name?: string; category?: string };

/** Impassable by default for this terrain: by its (effective) type's group. */
export function impassableByDefault(t: Omit<ImpassableInput, "impassable">): boolean {
  return impassableByType(effectiveTerrainType(t));
}

/** Whether auto-routes avoid this terrain. */
export function isImpassable(t: ImpassableInput): boolean {
  return t.impassable ?? impassableByDefault(t);
}

/**
 * Set a terrain's flag. A value equal to its type's default is stored as
 * "unset", so the palette note only records real overrides.
 */
export function setImpassable(t: TerrainColor, value: boolean): void {
  if (value === impassableByDefault(t)) delete t.impassable;
  else t.impassable = value;
}

/** Tooltip for a terrain's impassable box: where its value comes from. */
export function impassableSourceText(t: ImpassableInput): string {
  if (t.impassable !== undefined) return "Set for this terrain";
  const group = terrainTypeGroup(effectiveTerrainType(t));
  const label = TERRAIN_GROUPS.find((g) => g.id === group)?.label;
  const state = impassableByDefault(t) ? "impassable" : "passable";
  return label ? `Default for its type group (${label}: ${state})` : `Default (no type: ${state})`;
}

/** Names of the impassable terrains in a palette. */
export function impassableNames(palette: readonly TerrainColor[]): string[] {
  return palette.filter(isImpassable).map((t) => t.name);
}

/** Path type names that cross water by nature (rivers), when unset. */
const WATERY_PATH = /\b(river|stream|creek|brook|canal|waterway|sea lane|shipping)\b/i;

/**
 * Whether auto-routes of this path type go around impassable terrain.
 * Unset: yes, except for river-like types (a river runs into the sea).
 */
export function pathAvoidsImpassable(pt: Pick<PathType, "name" | "avoidImpassable">): boolean {
  return pt.avoidImpassable ?? !WATERY_PATH.test(pt.name);
}

/** River-like path names (they wind when auto-routed). */
const RIVER_PATH = /\b(river|stream|creek)s?\b/i;

/**
 * Whether auto-routes of this path type meander (rivers) rather than keep to
 * the straight line (roads): types that don't avoid impassable terrain, or
 * that are named like a river (round 7 U17).
 */
export function pathMeanders(pt: Pick<PathType, "name" | "avoidImpassable">): boolean {
  return !pathAvoidsImpassable(pt) || RIVER_PATH.test(pt.name);
}

/** Palette-note cell for the flag: "yes"/"no" for overrides, "" for the type default. */
export function impassableCell(t: Pick<TerrainColor, "impassable">): string {
  return t.impassable === undefined ? "" : t.impassable ? "yes" : "no";
}

/** Parse a palette-note cell: yes/no (and friends), or undefined for blank/unknown. */
export function parseImpassableCell(raw: string | undefined): boolean | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "x", "✓", "impassable"].includes(v)) return true;
  if (["no", "n", "false", "-", "passable"].includes(v)) return false;
  return undefined;
}

/**
 * The message when auto-route finds nothing: what blocked it and what to do.
 */
export function noRouteMessage(blockedNames: readonly string[]): string {
  if (!blockedNames.length) return "No route between those hexes inside the map.";
  return `No route around ${blockedNames.join(", ")}. Tick "Cross impassable" to go through, or change which terrains are impassable in the palette.`;
}

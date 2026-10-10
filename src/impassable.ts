import type { PathType, TerrainColor } from "./types";

/**
 * Impassable terrain, for the path tool's auto-route.
 *
 * A terrain is impassable when its palette entry says so (`impassable`), or,
 * when unset, by its terrain type: water types are impassable by default.
 * Hex-by-hex drawing ignores all of this; only auto-route asks.
 */

/** Terrain types that are impassable unless a terrain says otherwise. */
export const IMPASSABLE_BY_DEFAULT_TYPES: readonly string[] = ["deep-water", "water", "shallows"];

/** Impassable by default for this terrain type (no explicit flag). */
export function impassableByType(type: string | undefined): boolean {
  return !!type && IMPASSABLE_BY_DEFAULT_TYPES.includes(type);
}

/** Whether auto-routes avoid this terrain. */
export function isImpassable(t: Pick<TerrainColor, "impassable" | "type">): boolean {
  return t.impassable ?? impassableByType(t.type);
}

/**
 * Set a terrain's flag. A value equal to its type's default is stored as
 * "unset", so the palette note only records real overrides.
 */
export function setImpassable(t: TerrainColor, value: boolean): void {
  if (value === impassableByType(t.type)) delete t.impassable;
  else t.impassable = value;
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

import { cellKey, hexDistance, type Orientation, type Stagger } from "../../../packages/hex-wfc/src";
import { isTerrainType } from "../../terrainTypes";
import type { TerrainColor } from "../../types";

/**
 * Shared types and helpers for the procedural (non-learned) generators.
 * Pure: no Obsidian imports, deterministic for a given seed.
 */

export interface ProcGrid {
  cols: number;
  rows: number;
  offset: { x: number; y: number };
  stagger: Stagger;
  orientation: Orientation;
}

export interface ProcPath {
  /** Path type name (must exist in the map palette's path types to be drawn). */
  type: string;
  hexes: string[];
}

export interface ProcResult {
  /** Terrain per hex ("x_y"); every hex of the grid is set. */
  cells: Map<string, string>;
  paths: ProcPath[];
  warnings: string[];
}

/** Compass sides of a map, for what lies beyond each edge. */
export type Side = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export const SIDES: Side[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** A terrain as context: its palette name and (when known) its type. */
export interface ContextTerrain {
  terrain?: string;
  type?: string;
}

/**
 * What surrounds the map being generated, so it fits into the bigger map:
 *  - `parent`: the hex a submap zooms into (its terrain fills the map);
 *  - `sides`: the parent hex's neighbours, by compass side (each pulls its
 *    edge of the map toward its own terrain — east *and* west neighbours
 *    both act, each on their side);
 *  - `edgeCells`: exact terrain of hexes just outside the grid, keyed in
 *    this map's coordinates (from neighbouring regions sharing a border).
 * Every field is optional; generators ignore what they can't use.
 */
export interface GenerationContext {
  parent?: ContextTerrain;
  sides?: Partial<Record<Side, ContextTerrain>>;
  edgeCells?: Map<string, ContextTerrain>;
  /** Paths (roads, rivers…) crossing the parent hex, so they continue
   *  across the submap from the side they enter to the side they leave. */
  paths?: ContextPath[];
}

/**
 * A path through the parent hex: its type and the sides it enters / leaves
 * by. A missing side means the path ends in this hex (e.g. a road to a
 * town) and is routed to the middle of the submap.
 */
export interface ContextPath {
  type: string;
  /** The path type's routing; "meander" paths (rivers) wander a little. */
  routing?: "through" | "meander" | "edge";
  from?: Side;
  to?: Side;
  /** Exact entry / exit hex ("x_y" in this map) — e.g. where a neighbouring
   *  region's road crosses the shared border. Wins over `from` / `to`. */
  fromHex?: string;
  toHex?: string;
}

/** Unit vector (screen space: +x east, +y south) for each side. */
export const SIDE_VECTORS: Record<Side, [number, number]> = {
  N: [0, -1],
  NE: [Math.SQRT1_2, -Math.SQRT1_2],
  E: [1, 0],
  SE: [Math.SQRT1_2, Math.SQRT1_2],
  S: [0, 1],
  SW: [-Math.SQRT1_2, Math.SQRT1_2],
  W: [-1, 0],
  NW: [-Math.SQRT1_2, -Math.SQRT1_2],
};

/** The compass side a direction vector points to (8 sectors of 45°). */
export function sideOf(dx: number, dy: number): Side {
  const angle = Math.atan2(dy, dx); // 0 = east, +π/2 = south (screen y down)
  const sector = Math.round(angle / (Math.PI / 4));
  const bySector: Record<number, Side> = { 0: "E", 1: "SE", 2: "S", 3: "SW", 4: "W", [-4]: "W", [-3]: "NW", [-2]: "N", [-1]: "NE" };
  return bySector[sector];
}

export interface ProcOption {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}

/** Every "x_y" key of the grid, column-major like map creation. */
export function gridKeys(grid: ProcGrid): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < grid.cols; i++)
    for (let j = 0; j < grid.rows; j++) out.push([grid.offset.x + i, grid.offset.y + j]);
  return out;
}

export function distance(a: [number, number], b: [number, number], grid: ProcGrid): number {
  return hexDistance(a, b, grid.orientation, grid.stagger);
}

/** The hex nearest the middle of the grid. */
export function centerHex(grid: ProcGrid): [number, number] {
  return [grid.offset.x + Math.floor((grid.cols - 1) / 2), grid.offset.y + Math.floor((grid.rows - 1) / 2)];
}

export { cellKey };

/**
 * Find a palette terrain for a role: the first name match (case-insensitive),
 * else — when `category` is given — the first terrain in that category.
 * Lets the generators run on renamed or user-made palettes, not just the
 * shipped presets.
 */
export function findTerrain(
  terrains: TerrainColor[],
  names: string[],
  category?: string,
): string | undefined {
  const byName = new Map(terrains.map((t) => [t.name.toLowerCase(), t.name]));
  for (const n of names) {
    const hit = byName.get(n.toLowerCase());
    if (hit) return hit;
  }
  if (category) return terrains.find((t) => t.category?.toLowerCase() === category)?.name;
  return undefined;
}

/** All terrains in a category (case-insensitive), in palette order. */
export function inCategory(terrains: TerrainColor[], category: string): string[] {
  return terrains.filter((t) => t.category?.toLowerCase() === category).map((t) => t.name);
}

/*
 * Type-aware lookups. A terrain's `type` (see terrainTypes.ts) is
 * authoritative: a typed terrain fills only the roles of its type, however
 * it is named, so "ocean" typed desert is never used as sea. The name /
 * category guesses above are the fallback for untyped terrains only.
 */

/** Terrains with a known type id. Unknown ids count as untyped. */
function typeOf(t: TerrainColor): string | undefined {
  return isTerrainType(t.type) ? t.type : undefined;
}

/** Terrains without a (known) type: the ones name / category guesses may use. */
export function untyped(terrains: TerrainColor[]): TerrainColor[] {
  return terrains.filter((t) => !typeOf(t));
}

/** Names of all terrains of the given types, in palette order. */
export function ofType(terrains: TerrainColor[], typeIds: string[]): string[] {
  return terrains.filter((t) => typeIds.includes(typeOf(t) ?? "")).map((t) => t.name);
}

/**
 * The terrain for a role among those of the given types: the first name in
 * `preferNames` (case-insensitive) that is of one of the types, else the
 * first terrain of `typeIds[0]`, then `typeIds[1]`, … in palette order.
 * Picks "forest" over "forest heavy" for the base forest role, while a
 * palette whose only forest is "Pinewood" still gets a forest.
 */
export function findByType(
  terrains: TerrainColor[],
  typeIds: string[],
  preferNames: string[] = [],
): string | undefined {
  const typed = terrains.filter((t) => typeIds.includes(typeOf(t) ?? ""));
  if (typed.length === 0) return undefined;
  const hinted = findTerrain(typed, preferNames);
  if (hinted) return hinted;
  for (const id of typeIds) {
    const hit = typed.find((t) => typeOf(t) === id);
    if (hit) return hit.name;
  }
  return undefined;
}

/**
 * Resolve a role: by type first, else by name / category among the
 * untyped terrains (older or hand-made palettes).
 */
export function findRole(
  terrains: TerrainColor[],
  typeIds: string[],
  names: string[],
  category?: string,
): string | undefined {
  return findByType(terrains, typeIds, names) ?? findTerrain(untyped(terrains), names, category);
}

/** Lower-case name → type id, for weight tables keyed by type. */
export function typeIndex(terrains: TerrainColor[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of terrains) {
    const id = typeOf(t);
    if (id) out.set(t.name.toLowerCase(), id);
  }
  return out;
}

/**
 * Weighted pick. `weights` maps lower-case terrain names to weights; names
 * not listed get `fallback`. Returns undefined for an empty list.
 */
export function weightedPick(
  rand: () => number,
  names: string[],
  weights: Record<string, number>,
  fallback = 1,
): string | undefined {
  if (names.length === 0) return undefined;
  const w = names.map((n) => Math.max(0, weights[n.toLowerCase()] ?? fallback));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return names[Math.floor(rand() * names.length)];
  let r = rand() * total;
  for (let i = 0; i < names.length; i++) {
    r -= w[i];
    if (r < 0) return names[i];
  }
  return names[names.length - 1];
}

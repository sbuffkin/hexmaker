import { cellKey, hexDistance, type Orientation, type Stagger } from "../../../packages/hex-wfc/src";
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
  /** Path type name (must exist in settings.pathTypes to be drawn). */
  type: string;
  hexes: string[];
}

export interface ProcResult {
  /** Terrain per hex ("x_y"); every hex of the grid is set. */
  cells: Map<string, string>;
  paths: ProcPath[];
  warnings: string[];
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

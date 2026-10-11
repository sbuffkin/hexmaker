/**
 * Which planet a moon belongs to (S11): on a map, every hex whose terrain
 * is of type moon is tied to each neighbouring hex whose terrain is a
 * planet (type world or gas giant). The map view draws a faint tether
 * across the edge they share. By terrain TYPE only, never names, so a
 * custom palette ("Luna" typed moon) works the same as the shipped one.
 * Pure: no Obsidian imports.
 */
import type { TerrainColor } from "../types";
import { effectiveTerrainType } from "../terrainTypes";
import { hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";

export const MOON_TYPES: readonly string[] = ["moon"];
export const PLANET_TYPES: readonly string[] = ["world", "gas-giant"];

/** [moon hex, planet hex] pairs ("x_y" keys), in a stable order. */
export function moonPlanetLinks(
  terrainAt: ReadonlyMap<string, string>,
  palette: readonly TerrainColor[],
  orientation: Orientation,
  stagger: Stagger,
): [string, string][] {
  const type = new Map(palette.map((t) => [t.name.toLowerCase(), effectiveTerrainType(t)]));
  const typeAt = (key: string) => {
    const t = terrainAt.get(key);
    return t ? type.get(t.toLowerCase()) : undefined;
  };
  const out: [string, string][] = [];
  for (const key of [...terrainAt.keys()].sort()) {
    if (!MOON_TYPES.includes(typeAt(key) ?? "")) continue;
    const [x, y] = key.split("_").map(Number);
    for (const [nx, ny] of hexNeighbors(x, y, orientation, stagger)) {
      const n = `${nx}_${ny}`;
      if (PLANET_TYPES.includes(typeAt(n) ?? "")) out.push([key, n]);
    }
  }
  return out;
}

/** The tether between two hex centres: the middle part of the line joining them (from `t` to 1 - t). */
export function tether(a: { cx: number; cy: number }, b: { cx: number; cy: number }, t = 0.3): [{ cx: number; cy: number }, { cx: number; cy: number }] {
  const at = (f: number) => ({ cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f });
  return [at(t), at(1 - t)];
}

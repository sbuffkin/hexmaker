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
import { latticeCenter, type LatticeGrid, type Pt } from "../paths/pathGeometry";

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

/**
 * How a tether looks, in lattice units (× the hex radius when drawn). The
 * map view sets width and dash from here; its colour and opacity live in
 * styles.css (`.duckmage-moon-link`, kept equal by tests/moonLinks.test.ts).
 * The PNG export draws all four from here, so it matches the screen.
 */
export const MOON_TETHER_STYLE = {
  color: "#d7deff",
  opacity: 0.55,
  width: 0.07,
  dash: [0.1, 0.08] as readonly number[],
} as const;

/**
 * Every moon tether on a map, in lattice units: the segment the map view and
 * the PNG export both draw. `include` drops ties whose ends are not both
 * drawn (an export of part of the map).
 */
export function moonTethers(
  terrainAt: ReadonlyMap<string, string>,
  palette: readonly TerrainColor[],
  grid: LatticeGrid,
  include: (hexKey: string) => boolean = () => true,
): [Pt, Pt][] {
  return moonPlanetLinks(terrainAt, palette, grid.orientation, grid.stagger)
    .filter(([moon, planet]) => include(moon) && include(planet))
    .map(([moon, planet]) => tether(latticeCenter(moon, grid), latticeCenter(planet, grid)));
}

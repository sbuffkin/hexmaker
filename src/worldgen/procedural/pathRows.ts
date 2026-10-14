/**
 * Path-type rows (SF8, owner 2026-10-14: "allow users to add path types (as
 * these are generic) and determine how many show up, same generator rows as
 * other stuff"). A generator that draws paths over its terrain (Overland)
 * gets one option row per path type of the map's palette, whatever their
 * names: how many of that type to draw. On by default ("Auto": one per
 * ~200 hexes, at least one), so a new map has roads and rivers when its
 * palette has path types.
 *
 * How each is laid out comes from the type's own options, never its name:
 * a type that doesn't avoid impassable terrain (a river) runs from high
 * ground down to the nearest water (or off the map's edge); one that does
 * (a road) joins two settlements, or crosses the map between two edges.
 * The route itself is the path routing every generated map uses
 * (contextPaths.routeContextPaths: cheapest way over the terrain, winding
 * or direct by the type's Auto-route).
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../../packages/hex-wfc/src";
import type { PathType, TerrainColor } from "../../types";
import { effectiveTerrainType } from "../../terrainTypes";
import { routeContextPaths } from "./contextPaths";
import { cellKey, distance, gridKeys, type ContextPath, type ProcGrid, type ProcOption, type ProcPath } from "./common";

/** Option keys: `paths.<type name>`. */
export const PATH_ROW_PREFIX = "paths.";
/** "Auto": a count from the map's size. */
export const PATH_COUNT_AUTO = "auto";
/** Hexes per path at Auto. */
const HEXES_PER_PATH = 200;

/** The option key of a path type's row. */
export function pathRowKey(typeName: string): string {
  return `${PATH_ROW_PREFIX}${typeName}`;
}

/** One row per path type (none for a palette without path types). */
export function pathRowOptions(pathTypes: readonly Pick<PathType, "name">[] | undefined): ProcOption[] {
  const seen = new Set<string>();
  const out: ProcOption[] = [];
  for (const t of pathTypes ?? []) {
    if (!t.name || seen.has(t.name)) continue;
    seen.add(t.name);
    out.push({
      key: pathRowKey(t.name),
      label: t.name,
      choices: [
        { value: PATH_COUNT_AUTO, label: "Auto (by map size)" },
        { value: "0", label: "None" },
        ...[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
      ],
      default: PATH_COUNT_AUTO,
    });
  }
  return out;
}

/** How many of a type to draw: the row's value (Auto, unset or unreadable: by map size). */
export function pathRowCount(value: string | undefined, hexCount: number): number {
  const n = value === undefined || value === PATH_COUNT_AUTO ? NaN : Number(value);
  if (Number.isFinite(n)) return Math.max(0, Math.min(20, Math.floor(n)));
  return Math.max(1, Math.round(hexCount / HEXES_PER_PATH));
}

/** How high a terrain type stands, for where rivers rise (water 0 … peaks 5). */
function heightOf(type: string | undefined): number {
  switch (type) {
    case "deep-water": case "water": case "shallows": return 0;
    case "coast": case "wetland": return 1;
    case "hills": case "badlands": return 3;
    case "mountains": case "volcanic": return 4;
    case "peaks": return 5;
    default: return 2;
  }
}

const WATER = new Set(["deep-water", "water", "shallows"]);

/**
 * The paths a generator's path-type rows ask for, routed over its terrain.
 * `options` holds the rows' values (`paths.<type>`); a type without a row
 * value is drawn at Auto.
 */
export function drawPathRows(
  cells: ReadonlyMap<string, string>,
  terrains: readonly TerrainColor[],
  grid: ProcGrid,
  pathTypes: readonly PathType[] | undefined,
  options: Readonly<Record<string, string>>,
  seed: number,
): ProcPath[] {
  const types = (pathTypes ?? []).filter((t, i, all) => t.name && all.findIndex((o) => o.name === t.name) === i);
  if (!types.length || !cells.size) return [];
  const typeByName = new Map(terrains.map((t) => [t.name, effectiveTerrainType(t)]));
  const hexes = gridKeys(grid);
  const typeAt = (x: number, y: number) => {
    const t = cells.get(cellKey(x, y));
    return t ? typeByName.get(t) : undefined;
  };
  const isWater = (x: number, y: number) => WATER.has(typeAt(x, y) ?? "");
  const onEdge = ([x, y]: [number, number]) =>
    x === grid.offset.x || y === grid.offset.y || x === grid.offset.x + grid.cols - 1 || y === grid.offset.y + grid.rows - 1;
  const land = hexes.filter(([x, y]) => !isWater(x, y));
  const water = hexes.filter(([x, y]) => isWater(x, y));
  const out: ProcPath[] = [];
  types.forEach((pt, ti) => {
    const count = pathRowCount(options[pathRowKey(pt.name)], hexes.length);
    if (!count || land.length < 2) return;
    // Its own random stream per type, so one row's count doesn't move another's paths.
    const rand = mulberry32((seed ^ Math.imul(ti + 1, 0x85ebca6b) ^ 0x5bd1e995) >>> 0);
    const pick = <T>(list: readonly T[]): T | undefined => (list.length ? list[Math.floor(rand() * list.length)] : undefined);
    const used: [number, number][] = [];
    const farFromUsed = (h: [number, number], min: number) => used.every((u) => distance(u, h, grid) >= min);
    const spacing = Math.max(2, Math.round(Math.min(grid.cols, grid.rows) / (count + 1)));
    const wanted: ContextPath[] = [];
    const behaviour = { routing: pt.routing, avoidImpassable: pt.avoidImpassable, autoRoute: pt.autoRoute };
    const riverLike = pt.avoidImpassable === false;
    for (let n = 0; n < count; n++) {
      let from: [number, number] | undefined;
      let to: [number, number] | undefined;
      if (riverLike) {
        // Rises on the highest ground there is (inland), runs to the nearest water or off an edge.
        const inland = land.filter((h) => !onEdge(h));
        const pool = inland.length ? inland : land;
        const top = Math.max(...pool.map(([x, y]) => heightOf(typeAt(x, y))));
        const high = pool.filter(([x, y]) => heightOf(typeAt(x, y)) >= Math.min(top, 3));
        from = pick(high.filter((h) => farFromUsed(h, spacing))) ?? pick(high);
        if (!from) break;
        const ends = water.length ? water : hexes.filter(onEdge);
        to = nearest(from, ends, grid);
      } else {
        // Between two settlements when there are any, else across the map, edge to edge.
        const towns = land.filter(([x, y]) => typeAt(x, y) === "settlement");
        if (towns.length >= 2) {
          from = pick(towns.filter((h) => farFromUsed(h, 1))) ?? pick(towns);
          to = from ? pick(towns.filter((h) => h !== from)) : undefined;
        } else {
          const rim = land.filter(onEdge);
          from = pick(rim.filter((h) => farFromUsed(h, spacing))) ?? pick(rim);
          // The far end: on another side, well across the map.
          const across = from ? rim.filter((h) => distance(h, from!, grid) >= Math.max(3, Math.floor(Math.max(grid.cols, grid.rows) / 2))) : [];
          to = pick(across) ?? pick(rim.filter((h) => h !== from));
        }
      }
      if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
      used.push(from, to);
      wanted.push({ type: pt.name, ...behaviour, fromHex: cellKey(from[0], from[1]), toHex: cellKey(to[0], to[1]) });
    }
    const routed = routeContextPaths(new Map(cells), [...terrains], grid, wanted, (seed ^ Math.imul(ti + 7, 0x27d4eb2d)) >>> 0);
    for (const p of routed) if (p.hexes.length >= 2) out.push(p);
  });
  return out;
}

/** The hex of `among` nearest to `from` (by hex steps; first on a tie). */
function nearest(from: [number, number], among: readonly [number, number][], grid: ProcGrid): [number, number] | undefined {
  let best: [number, number] | undefined;
  let bestD = Infinity;
  for (const h of among) {
    if (h[0] === from[0] && h[1] === from[1]) continue;
    const d = distance(from, h, grid);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

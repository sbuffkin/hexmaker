import { hexCenter, hexNeighbors, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import { inferTerrainType, isTerrainType } from "../../terrainTypes";
import { SIDE_VECTORS, cellKey, centerHex, gridKeys, type ContextPath, type ProcGrid, type ProcPath, type Side } from "./common";

/**
 * Continue the parent hex's paths across a submap: each enters at the
 * middle of the edge it comes from and leaves at the middle of the edge it
 * goes to (or ends at the map's centre). Edge points are deterministic, so
 * submaps of two adjacent parent hexes meet at the same spot on their
 * shared edge and the road/river lines up across the seam.
 *
 * Routing is a cheapest path over the generated terrain: roads avoid
 * water (crossing only if they must — a bridge), mountains and swamps;
 * rivers prefer low ground, run into water happily, and meander.
 */

/** Movement cost per terrain type, for roads and for rivers. */
const ROAD_COST: Record<string, number> = {
  "deep-water": 60, water: 40, shallows: 25, wetland: 3, forest: 1.6, jungle: 2.2,
  hills: 2.5, mountains: 7, peaks: 14, snow: 3, desert: 1.4, badlands: 2.5, volcanic: 9,
};
const RIVER_COST: Record<string, number> = {
  "deep-water": 0.4, water: 0.3, shallows: 0.4, wetland: 0.8, hills: 2.5, mountains: 7, peaks: 12,
  badlands: 1.8, volcanic: 6,
};

function isRiver(p: ContextPath): boolean {
  return p.routing === "meander" || /river|stream|creek|brook/i.test(p.type);
}

/**
 * The hex where a path crosses a side of the grid: the middle row of the
 * first/last column (W/E), the middle column of the first/last row (N/S),
 * or the corner hex (NE…). Chosen by grid position, not geometry, so it's
 * the same row on both sides of a seam even where pointy-top edges are
 * ragged — paths in adjacent submaps meet.
 */
export function edgeHex(grid: ProcGrid, side: Side): [number, number] {
  const minX = grid.offset.x, maxX = grid.offset.x + grid.cols - 1;
  const minY = grid.offset.y, maxY = grid.offset.y + grid.rows - 1;
  const midX = grid.offset.x + Math.floor((grid.cols - 1) / 2);
  const midY = grid.offset.y + Math.floor((grid.rows - 1) / 2);
  const [dx, dy] = SIDE_VECTORS[side];
  const x = dx > 0 ? maxX : dx < 0 ? minX : midX;
  const y = dy > 0 ? maxY : dy < 0 ? minY : midY;
  return [x, y];
}

/**
 * Route each context path over the generated cells. `terrains` gives each
 * cell's type (falling back to a name guess); unpainted cells cost 1.
 */
export function routeContextPaths(
  cells: Map<string, string>,
  terrains: TerrainColor[],
  grid: ProcGrid,
  paths: ContextPath[],
  seed: number,
): ProcPath[] {
  const typeByName = new Map(terrains.map((t) => [t.name, isTerrainType(t.type) ? t.type : inferTerrainType(t.name, t.category)]));
  const hexes = gridKeys(grid);
  const inGrid = new Set(hexes.map(([x, y]) => cellKey(x, y)));
  const out: ProcPath[] = [];
  paths.forEach((p, n) => {
    if (!p.from && !p.to) return;
    const start = p.from ? edgeHex(grid, p.from) : centerHex(grid);
    const end = p.to ? edgeHex(grid, p.to) : centerHex(grid);
    const sk = cellKey(start[0], start[1]), ek = cellKey(end[0], end[1]);
    if (sk === ek) return;
    const river = isRiver(p);
    const costs = river ? RIVER_COST : ROAD_COST;
    // Per-path seeded jitter makes rivers wander; roads stay direct.
    const rand = mulberry32((seed ^ (n + 1) * 0x9e3779b9) >>> 0);
    const jitter = new Map<string, number>();
    // Many routes across a hex grid tie on length; a small penalty for
    // straying from the straight line between the edge points keeps roads
    // direct instead of bowing to a map edge and back.
    const [ax, ay] = hexCenter(start[0], start[1], grid.orientation, grid.stagger);
    const [bx, by] = hexCenter(end[0], end[1], grid.orientation, grid.stagger);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const stray = river ? 0.04 : 0.12;
    const cost = (k: string) => {
      const t = cells.get(k);
      const type = t ? typeByName.get(t) : undefined;
      let c = (type ? costs[type] : undefined) ?? 1;
      const [hx, hy] = k.split("_").map(Number);
      const [px, py] = hexCenter(hx, hy, grid.orientation, grid.stagger);
      c += stray * Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len / Math.sqrt(3);
      if (river) {
        if (!jitter.has(k)) jitter.set(k, rand() * 0.9);
        c += jitter.get(k)!;
      }
      return c;
    };
    // Dijkstra over the grid (small maps: a linear-scan frontier is fine).
    const dist = new Map<string, number>([[sk, 0]]);
    const prev = new Map<string, string>();
    const open = new Set([sk]);
    const done = new Set<string>();
    while (open.size) {
      let cur = "", curD = Infinity;
      for (const k of open) {
        const d = dist.get(k)!;
        if (d < curD) { cur = k; curD = d; }
      }
      open.delete(cur);
      if (cur === ek) break;
      done.add(cur);
      const [x, y] = cur.split("_").map(Number);
      for (const [nx, ny] of hexNeighbors(x, y, grid.orientation, grid.stagger)) {
        const nk = cellKey(nx, ny);
        if (!inGrid.has(nk) || done.has(nk)) continue;
        const nd = curD + cost(nk);
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          prev.set(nk, cur);
          open.add(nk);
        }
      }
    }
    if (!prev.has(ek)) return;
    const chain = [ek];
    while (chain[0] !== sk) chain.unshift(prev.get(chain[0])!);
    out.push({ type: p.type, hexes: chain });
  });
  return out;
}

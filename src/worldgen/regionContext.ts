import type HexmakerPlugin from "../HexmakerPlugin";
import { hexNeighbors } from "../../packages/hex-wfc/src";
import { neighbourShadow, type NewRegion } from "./neighbours";
import { pairCrossings } from "./procedural/contextPaths";
import type { ContextTerrain, GenerationContext } from "./procedural/common";

/**
 * Generation context for a new region placed next to existing ones (the
 * world grid from neighbours.ts): the neighbours' terrain just past each
 * border as `edgeCells`, and every neighbour path that reaches the border
 * as a crossing — paired up so roads/rivers continue through the new map
 * from the exact hex where they cross.
 */
export function buildRegionContext(plugin: HexmakerPlugin, region: NewRegion): GenerationContext {
  const shadow = neighbourShadow(plugin, region, 1);
  const typeOf = (mapName: string, terrain: string | undefined) =>
    terrain ? plugin.getMapPalette(mapName).find((t) => t.name === terrain)?.type : undefined;

  const edgeCells = new Map<string, ContextTerrain>();
  for (const [key, cell] of shadow) {
    if (!cell.terrain) continue;
    const type = typeOf(cell.map, cell.terrain);
    edgeCells.set(key, type ? { terrain: cell.terrain, type } : { terrain: cell.terrain });
  }

  // Paths: a neighbour's chain touching a border shadow hex enters this map
  // at the in-grid hex next to it.
  const orientation = plugin.settings.hexOrientation;
  const inGrid = (x: number, y: number) =>
    x >= region.offset.x && x < region.offset.x + region.cols &&
    y >= region.offset.y && y < region.offset.y + region.rows;
  const routingOf = new Map((plugin.settings.pathTypes ?? []).map((p) => [p.name, p.routing]));
  const crossings: { type: string; routing?: "through" | "meander" | "edge"; hex: string }[] = [];
  for (const [key, cell] of shadow) {
    const map = plugin.getMap(cell.map);
    if (!map) continue;
    const there = `${cell.x}_${cell.y}`;
    for (const chain of map.pathChains ?? []) {
      if (!chain.hexes.includes(there)) continue;
      const [sx, sy] = key.split("_").map(Number);
      const inside = hexNeighbors(sx, sy, orientation, region.stagger).find(([nx, ny]) => inGrid(nx, ny));
      if (inside) crossings.push({ type: chain.typeName, routing: routingOf.get(chain.typeName), hex: `${inside[0]}_${inside[1]}` });
    }
  }
  const paths = pairCrossings(crossings, {
    cols: region.cols,
    rows: region.rows,
    offset: region.offset,
    stagger: region.stagger,
    orientation,
  });
  return { edgeCells, paths };
}

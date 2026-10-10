import type HexmakerPlugin from "../HexmakerPlugin";
import { getTerrainFromFile } from "../frontmatter";
import { hexCenter, hexNeighbors } from "../../packages/hex-wfc/src";
import { sideOf, type ContextTerrain, type GenerationContext } from "./procedural/common";

/**
 * Generation context for a submap of hex (x, y) on `mapName`: that hex's
 * terrain as the parent, and its six neighbours by compass side. Hexes
 * outside the parent map's grid are left out; hexes with no terrain count
 * as the map's base terrain (e.g. "void").
 */
export function buildSubmapContext(
  plugin: HexmakerPlugin,
  mapName: string,
  x: number,
  y: number,
): GenerationContext {
  const map = plugin.getMap(mapName);
  if (!map) return {};
  const palette = plugin.getMapPalette(mapName);
  const orientation = plugin.settings.hexOrientation;
  const stagger = map.staggerOffset ?? plugin.settings.staggerOffset ?? "odd";
  const inGrid = (hx: number, hy: number) =>
    hx >= map.gridOffset.x && hx < map.gridOffset.x + map.gridSize.cols &&
    hy >= map.gridOffset.y && hy < map.gridOffset.y + map.gridSize.rows;

  const look = (hx: number, hy: number): ContextTerrain | undefined => {
    const name = getTerrainFromFile(plugin.app, plugin.hexPath(hx, hy, mapName)) ?? map.baseTerrain;
    if (!name) return undefined;
    const type = palette.find((t) => t.name === name)?.type;
    return type ? { terrain: name, type } : { terrain: name };
  };

  const context: GenerationContext = { parent: look(x, y), sides: {}, paths: [] };
  const [cx, cy] = hexCenter(x, y, orientation, stagger);
  const sideTo = (k: string | undefined) => {
    if (!k) return undefined;
    const [nx, ny] = k.split("_").map(Number);
    const [px, py] = hexCenter(nx, ny, orientation, stagger);
    return sideOf(px - cx, py - cy);
  };

  // Paths through this hex: where each comes in and goes out, so the
  // submap can carry the road / river across instead of losing it.
  const key = `${x}_${y}`;
  const routingOf = new Map(plugin.getPathTypes(map.paletteName).map((p) => [p.name, p.routing]));
  for (const chain of map.pathChains ?? []) {
    chain.hexes.forEach((h, i) => {
      if (h !== key) return;
      const from = sideTo(chain.hexes[i - 1]);
      const to = sideTo(chain.hexes[i + 1]);
      if (!from && !to) return;
      context.paths!.push({ type: chain.typeName, routing: routingOf.get(chain.typeName), from, to });
    });
  }
  for (const [nx, ny] of hexNeighbors(x, y, orientation, stagger)) {
    if (!inGrid(nx, ny)) continue;
    const t = look(nx, ny);
    if (!t) continue;
    const [px, py] = hexCenter(nx, ny, orientation, stagger);
    context.sides![sideOf(px - cx, py - cy)] = t;
  }
  return context;
}

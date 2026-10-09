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

  const context: GenerationContext = { parent: look(x, y), sides: {} };
  const [cx, cy] = hexCenter(x, y, orientation, stagger);
  for (const [nx, ny] of hexNeighbors(x, y, orientation, stagger)) {
    if (!inGrid(nx, ny)) continue;
    const t = look(nx, ny);
    if (!t) continue;
    const [px, py] = hexCenter(nx, ny, orientation, stagger);
    context.sides![sideOf(px - cx, py - cy)] = t;
  }
  return context;
}

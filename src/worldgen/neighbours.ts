/**
 * Neighbour regions in the vault: reading and saving where maps sit on their
 * shared grid (see world.ts for the rules), the terrain just past a map's
 * edges, and generating a region that carries on from its neighbours (its
 * edge terrain, and optionally its whole character: blendFromNeighbours).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { getTerrainFromFile } from "../frontmatter";
import { generateTerrain, readMapTerrain, type GridSpec } from "./generators";
import { learnModel, mergeModels, type Compass, type HexWfcModel, type SolveResult } from "../../packages/hex-wfc/src";
import {
  link,
  neighbours,
  newNeighbourSpec,
  shadowDepth,
  shadowHexes,
  SIDES,
  type GridRules,
  type Side,
  type WorldSlot,
} from "./world";

export function gridRules(plugin: HexmakerPlugin): GridRules {
  return { orientation: plugin.settings.hexOrientation, stagger: plugin.settings.staggerOffset ?? "odd" };
}

/** Terrain of a map's hex, or undefined if unpainted. */
export function terrainAt(plugin: HexmakerPlugin, mapName: string, x: number, y: number): string | undefined {
  return getTerrainFromFile(plugin.app, plugin.hexPath(x, y, mapName)) ?? undefined;
}

/** The map on each side of `mapName`. */
export function regionNeighbours(plugin: HexmakerPlugin, mapName: string): Partial<Record<Side, MapData>> {
  const m = plugin.getMap(mapName);
  return m ? neighbours(plugin.settings.maps, m) : {};
}

/** Put `other` on `side` of `mapName` (moving its group along if it has one) and save. */
export async function linkRegions(plugin: HexmakerPlugin, mapName: string, side: Side, other: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = link(plugin.settings.maps, mapName, side, other, gridRules(plugin));
  if (!r.ok) return r;
  for (const [name, slot] of r.changes) {
    const m = plugin.getMap(name);
    if (m) m.world = slot;
  }
  await plugin.saveSettings();
  return { ok: true };
}

/**
 * Take a map off the shared grid (its hexes are untouched). If that leaves a
 * map alone in its group, it's taken off too.
 */
export async function detachRegion(plugin: HexmakerPlugin, mapName: string): Promise<void> {
  const m = plugin.getMap(mapName);
  if (!m?.world) return;
  const id = m.world.id;
  m.world = undefined;
  const left = plugin.settings.maps.filter((o) => o.world?.id === id);
  if (left.length === 1) left[0].world = undefined;
  await plugin.saveSettings();
}

/** Where a region next to `mapName` would go and how it must be made. */
export function neighbourSpec(plugin: HexmakerPlugin, mapName: string, side: Side) {
  const a = plugin.getMap(mapName);
  if (!a) return { ok: false as const, reason: `Map "${mapName}" not found` };
  return newNeighbourSpec(plugin.settings.maps, a, side, gridRules(plugin));
}

export interface NewRegion {
  slot: WorldSlot;
  /** Slot to give the map it's made next to, if that map had none yet. */
  aSlot?: WorldSlot;
  anchor?: string;
  /** Which side of the anchor it goes on. */
  side?: Side;
  cols: number;
  rows: number;
  offset: { x: number; y: number };
  stagger: "odd" | "even";
  paletteName: string;
}

/** A region record for a map that doesn't exist yet, to ask world.ts about. */
function virtualRegion(r: NewRegion): MapData {
  return {
    name: "\u0000new",
    paletteName: r.paletteName,
    gridSize: { cols: r.cols, rows: r.rows },
    gridOffset: { ...r.offset },
    staggerOffset: r.stagger,
    world: r.slot,
    pathChains: [],
  };
}

/** All maps, with the anchor given its slot if it was just placed. */
function mapsWith(plugin: HexmakerPlugin, r: NewRegion): MapData[] {
  return plugin.settings.maps.map((m) => (r.aSlot && m.name === r.anchor && !m.world ? { ...m, world: r.aSlot } : m));
}

/**
 * Neighbours' terrain just past each edge, in the frame of the map (or new
 * region): local "x_y" -> terrain. Depth 0 = the map's own shadow depth.
 */
export function neighbourShadow(plugin: HexmakerPlugin, region: MapData | NewRegion, depth = 0): Map<string, { map: string; x: number; y: number; terrain?: string }> {
  const virtual = "slot" in region ? virtualRegion(region) : region;
  const maps = "slot" in region ? [...mapsWith(plugin, region), virtual] : plugin.settings.maps;
  const d = depth || shadowDepth(virtual.gridSize.cols, virtual.gridSize.rows);
  const out = new Map<string, { map: string; x: number; y: number; terrain?: string }>();
  for (const [key, r] of shadowHexes(maps, virtual, d)) {
    if (r.map.name === virtual.name) continue;
    out.set(key, { map: r.map.name, x: r.x, y: r.y, terrain: terrainAt(plugin, r.map.name, r.x, r.y) });
  }
  return out;
}

/** Which sides of a new region already have a neighbour. */
export function occupiedSides(plugin: HexmakerPlugin, region: NewRegion): Side[] {
  const virtual = virtualRegion(region);
  const n = neighbours([...mapsWith(plugin, region), virtual], virtual);
  return SIDES.filter((s) => n[s]);
}

/** Keep the longest run of a path's hexes that stays inside the region. */
function cropPath(hexes: string[], inside: (key: string) => boolean): string[] {
  let best: string[] = [], run: string[] = [];
  for (const h of hexes) {
    if (inside(h)) run.push(h);
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  return run.length > best.length ? run : best;
}

/**
 * Generate a new region so its terrain carries on from its neighbours: the
 * region is solved with a one-hex ring around it, the ring pinned to the
 * neighbours' edge terrain, then cropped. Pins that clash with the
 * generator's rules are dropped one at a time; if it still can't fit, the
 * region is generated on its own (with a warning).
 */
export function generateConnected(
  plugin: HexmakerPlugin,
  model: HexWfcModel,
  paletteTerrains: string[],
  region: NewRegion,
  seed: number,
): SolveResult & { shadow: Map<string, string> } {
  const shadowInfo = neighbourShadow(plugin, region);
  const shadow = new Map<string, string>();
  for (const [k, v] of shadowInfo) if (v.terrain) shadow.set(k, v.terrain);
  const { cols, rows, offset } = region;
  const inside = (key: string) => {
    const [x, y] = key.split("_").map(Number);
    return x >= offset.x && x < offset.x + cols && y >= offset.y && y < offset.y + rows;
  };
  // The ring one hex out, where a neighbour is.
  const fixed = new Map<string, string>();
  for (const [k, t] of shadow) {
    const [x, y] = k.split("_").map(Number);
    if (x >= offset.x - 1 && x <= offset.x + cols && y >= offset.y - 1 && y <= offset.y + rows) fixed.set(k, t);
  }
  if (!fixed.size) {
    const grid: GridSpec = { cols, rows, offset, stagger: region.stagger };
    return { ...generateTerrain(plugin, model, paletteTerrains, grid, seed), shadow };
  }
  const grid: GridSpec = { cols: cols + 2, rows: rows + 2, offset: { x: offset.x - 1, y: offset.y - 1 }, stagger: region.stagger };
  let dropped = 0;
  let r = generateTerrain(plugin, model, paletteTerrains, grid, seed, fixed);
  while (!r.ok && r.at && fixed.size && dropped < 40) {
    const key = `${r.at.x}_${r.at.y}`;
    if (!fixed.delete(key)) break;
    dropped++;
    r = generateTerrain(plugin, model, paletteTerrains, grid, seed, fixed);
  }
  if (!r.ok) {
    const alone = generateTerrain(plugin, model, paletteTerrains, { cols, rows, offset, stagger: region.stagger }, seed);
    if (alone.ok) alone.warnings.unshift("Couldn't fit this map to its neighbours' edges, so it was generated on its own");
    return { ...alone, shadow };
  }
  const cells = new Map([...r.cells].filter(([k]) => inside(k)));
  const featureCells = new Set([...r.featureCells].filter(inside));
  const paths = r.paths.map((p) => ({ ...p, hexes: cropPath(p.hexes, inside) })).filter((p) => p.hexes.length >= 2);
  const warnings = [...r.warnings];
  if (dropped) warnings.push(`${dropped} edge hex${dropped === 1 ? "" : "es"} couldn't be matched to the neighbouring map's terrain`);
  return { ...r, cells, featureCells, paths, warnings, shadow };
}

/** Name of the map on `side` of a region that's about to be made. */
export function regionNameAt(plugin: HexmakerPlugin, region: NewRegion, side: Side): string {
  const virtual = virtualRegion(region);
  return neighbours([...mapsWith(plugin, region), virtual], virtual)[side]?.name ?? "";
}

/** Give a just-created map its slot (and the map it was made next to, if that had none). */
export async function placeNewRegion(plugin: HexmakerPlugin, mapName: string, region: NewRegion): Promise<void> {
  const anchor = region.anchor ? plugin.getMap(region.anchor) : undefined;
  if (anchor && !anchor.world && region.aSlot) anchor.world = region.aSlot;
  const created = plugin.getMap(mapName);
  if (created) {
    created.world = region.slot;
    created.staggerOffset = region.stagger;
  }
  await plugin.saveSettings();
}

/** How much of a blended region its neighbours make up between them (percent). */
export const NEIGHBOUR_SHARE = 40;

const SIDE_COMPASS: Record<Side, Compass> = { north: "N", east: "E", south: "S", west: "W" };

/**
 * The generator for a region next to others, blended toward them: each
 * neighbour's painted terrain is learned and leans toward its side, the
 * region's own generator covers the rest (see mergeModels). A valley region
 * with deep forest to the east comes out as valley turning to forest in the
 * east. `neighbours` maps a side of the new region to the neighbour there;
 * sides with nothing painted are skipped. Returns `own` when none are left.
 */
export function blendFromNeighbours(
  plugin: HexmakerPlugin,
  own: HexWfcModel,
  neighbours: Partial<Record<Side, string>>,
  share = NEIGHBOUR_SHARE,
): HexWfcModel {
  const models: HexWfcModel[] = [own];
  const dirs: Compass[] = ["C"];
  for (const side of SIDES) {
    const name = neighbours[side];
    const map = name ? plugin.getMap(name) : undefined;
    if (!name || !map) continue;
    const cells = readMapTerrain(plugin, name);
    if (cells.size < 2) continue;
    models.push(learnModel(cells, { name, orientation: plugin.settings.hexOrientation, stagger: map.staggerOffset ?? "odd" }));
    dirs.push(SIDE_COMPASS[side]);
  }
  if (models.length === 1) return own;
  const each = share / (models.length - 1);
  return mergeModels(models, own.name, { ...own.meta }, [100 - share, ...models.slice(1).map(() => each)], dirs);
}

/** The neighbours of a new region by side (see occupiedSides), for blendFromNeighbours. */
export function regionNeighbourNames(plugin: HexmakerPlugin, region: NewRegion): Partial<Record<Side, string>> {
  const out: Partial<Record<Side, string>> = {};
  for (const side of occupiedSides(plugin, region)) out[side] = regionNameAt(plugin, region, side);
  return out;
}

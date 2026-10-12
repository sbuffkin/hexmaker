/**
 * Regions in the vault, the pure part (plan-overworld-regions §1–§4, phase 2a).
 *
 * A Region map sits in one shared child grid with its sibling regions: its
 * gridOffset is its block's place in that grid (layout.ts), its `world` slot
 * is its parent hex, and every region of one overworld shares the world id
 * and child stagger stored in the overworld's region settings. Walking off a
 * region's edge lands in whichever sibling's block holds that cell.
 *
 * Generation reads the overworld: each hex's terrain is its biome signal
 * (biomeForTerrain), the blend field mixes the biomes by position, and cells
 * already generated in neighbouring regions are pinned, so seams join up
 * whatever order regions are made in.
 *
 * Shape-agnostic where cheap: everything goes through RegionLayout. Only
 * `meshes()` says which footprints are placed in the shared grid today
 * (rectangles; hex flowers need the map-shape mask, phase 2b).
 *
 * Pure: no Obsidian imports.
 */

import { hexDistance, hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import type { MapData, RegionBiome, RegionSettings, TerrainColor } from "../types";
import { biomeForTerrain, biomeGeneratorId, biomeParts, biomeRef, ecotoneBetween, isComboId, type BiomeId, type BiomeProfile } from "./biomes";
import { BlendField, REGION_WARP, type BlendWidth } from "./blendField";
import { regionBox, regionCells, regionCentrePoint, type RegionLayout } from "./layout";
import { generateRegion } from "./regionGen";
import { tuned, tunedOrUnset } from "./biomeTuning";
import { hash2 } from "./noise";

export interface GridRules {
  orientation: Orientation;
  /** Plugin-wide stagger, for maps that don't set their own. */
  stagger: Stagger;
}

/** Footprints placed in the shared grid today (the core's, src/maps/submaps.ts). */
import { meshes } from "../maps/submaps";
export { meshes };

/** The regions' tiling for an overworld, or undefined when it has no region settings. */
export function regionLayoutOf(parent: Pick<MapData, "staggerOffset" | "regions"> | undefined, rules: GridRules): RegionLayout | undefined {
  const s = parent?.regions;
  if (!s) return undefined;
  const parentStagger = parent.staggerOffset ?? rules.stagger;
  return {
    footprint: s.footprint,
    size: s.size,
    orientation: rules.orientation,
    parentStagger,
    childStagger: s.stagger ?? parentStagger,
  };
}

/**
 * Settings with the shared-grid fields filled in (world id, child stagger),
 * set once before the first region so every later region reads the same
 * values. Returns the same object when nothing was missing.
 */
export function withMeshFields(s: RegionSettings, parentStagger: Stagger, makeId: () => string): RegionSettings {
  if (s.worldId && s.stagger) return s;
  return { ...s, worldId: s.worldId || makeId(), stagger: s.stagger ?? parentStagger };
}

export interface RegionSlot {
  offset: { x: number; y: number };
  cols: number;
  rows: number;
  stagger: Stagger;
  world: { id: string; cx: number; cy: number };
}

/** Where the region of parent hex (px, py) goes in the shared grid. */
export function regionSlot(layout: RegionLayout, worldId: string, px: number, py: number): RegionSlot {
  const b = regionBox(layout, px, py);
  return {
    offset: { x: b.x, y: b.y },
    cols: b.cols,
    rows: b.rows,
    stagger: layout.childStagger,
    world: { id: worldId, cx: px, cy: py },
  };
}

/**
 * Why a region map doesn't sit where its parent hex says (§1.3 invariant 2),
 * or null when it does. Such a map is shown as a plain map, never moved.
 */
export function slotProblem(
  map: Pick<MapData, "gridOffset" | "gridSize" | "world" | "staggerOffset">,
  layout: RegionLayout,
  worldId: string,
  px: number,
  py: number,
): string | null {
  const want = regionSlot(layout, worldId, px, py);
  if (!map.world || map.world.id !== worldId) return "it isn't in this map's grid of regions";
  if (map.world.cx !== px || map.world.cy !== py) return `its slot is hex ${map.world.cx}, ${map.world.cy}, not ${px}, ${py}`;
  if (map.gridOffset.x !== want.offset.x || map.gridOffset.y !== want.offset.y) return "its hexes are numbered from a different corner";
  if (map.gridSize.cols !== want.cols || map.gridSize.rows !== want.rows) return `it is ${map.gridSize.cols} × ${map.gridSize.rows}, not ${want.cols} × ${want.rows}`;
  if ((map.staggerOffset ?? want.stagger) !== want.stagger) return "its columns are staggered the other way";
  return null;
}

// ── neighbours ───────────────────────────────────────────────────────────

/** Compass word for a direction (the core's, src/maps/compass.ts). */
import { bearingWord } from "../maps/compass";
export { bearingWord };

export interface RegionNeighbour<T> {
  map: T;
  /** Parent hex of the neighbour. */
  hex: [number, number];
  /** True bearing from this region to it ("north-east"). */
  bearing: string;
}

/**
 * The regions next to region `m` of `parentName`: one per neighbouring
 * parent hex that has a region, in clockwise order from north, named by the
 * true child-space bearing (hex flowers are twisted, §2.2).
 */
export function regionNeighbourMaps<T extends Pick<MapData, "name" | "parent" | "submapKind">>(
  maps: T[],
  parentName: string,
  layout: RegionLayout,
  px: number,
  py: number,
): RegionNeighbour<T>[] {
  const [ax, ay] = regionCentrePoint(layout, px, py);
  const out: (RegionNeighbour<T> & { angle: number })[] = [];
  for (const [qx, qy] of hexNeighbors(px, py, layout.orientation, layout.parentStagger)) {
    const hex = `${qx}_${qy}`;
    const map = maps.find((m) => m.submapKind === "region" && m.parent?.map === parentName && m.parent.hex === hex);
    if (!map) continue;
    const [bx, by] = regionCentrePoint(layout, qx, qy);
    const angle = (Math.atan2(by - ay, bx - ax) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    out.push({ map, hex: [qx, qy], bearing: bearingWord(bx - ax, by - ay), angle });
  }
  return out.sort((a, b) => a.angle - b.angle).map(({ map, hex, bearing }) => ({ map, hex, bearing }));
}

// ── biomes from the overworld ────────────────────────────────────────────

/**
 * Each overworld hex's biome, read from its terrain (§4.1: the terrain IS
 * the biome signal). Settlements and other terrains with no biome take the
 * most common biome among their neighbours; hexes with nothing to go on are
 * left out (the field skips them). `placed` (hex → biome) wins over the
 * terrain: biomes set on a hex by name (the Biome column, #50 / BC1). A
 * placed hex with no terrain (a blank biome's) is included too.
 */
export function overworldBiomes(
  terrain: ReadonlyMap<string, string>,
  palette: TerrainColor[],
  orientation: Orientation,
  stagger: Stagger,
  placed?: ReadonlyMap<string, BiomeId>,
): Map<string, BiomeId> {
  const out = new Map<string, BiomeId>();
  const unresolved: string[] = [];
  for (const [k, t] of terrain) {
    const b = placed?.get(k) ?? biomeForTerrain(t, palette);
    if (b) out.set(k, b);
    else unresolved.push(k);
  }
  for (const [k, b] of placed ?? []) if (!terrain.has(k)) out.set(k, b);
  for (const k of unresolved) {
    const [x, y] = k.split("_").map(Number);
    const counts = new Map<BiomeId, number>();
    for (const [a, b] of hexNeighbors(x, y, orientation, stagger)) {
      const nb = out.get(`${a}_${b}`);
      if (nb) counts.set(nb, (counts.get(nb) ?? 0) + 1);
    }
    const best = [...counts].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0];
    if (best) out.set(k, best[0]);
  }
  return out;
}

/**
 * Overworld hexes that are transitions (ecotones): their biome is the one
 * put between two neighbours that shouldn't touch. Derived from the biomes,
 * never stored.
 */
export function ecotoneHexes(biomes: ReadonlyMap<string, BiomeId>, orientation: Orientation, stagger: Stagger): Set<string> {
  const out = new Set<string>();
  for (const [k, own] of biomes) {
    const [x, y] = k.split("_").map(Number);
    const around = hexNeighbors(x, y, orientation, stagger).map(([a, b]) => biomes.get(`${a}_${b}`)).filter((b): b is BiomeId => !!b && b !== own);
    let hit = false;
    for (let i = 0; i < around.length && !hit; i++) {
      for (let j = i + 1; j < around.length && !hit; j++) if (ecotoneBetween(around[i], around[j]) === own) hit = true;
    }
    if (hit) out.add(k);
  }
  return out;
}

// ── generation ───────────────────────────────────────────────────────────

/** A seed shared by every region of one world, from its id (so the field's warp matches at every seam). */
export function worldSeed(worldId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < worldId.length; i++) h = Math.imul(h ^ worldId.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export interface RegionPlanInput {
  layout: RegionLayout;
  parent: [number, number];
  /** Overworld hex → biome (overworldBiomes). */
  biomes: ReadonlyMap<string, BiomeId>;
  profiles: ReadonlyMap<BiomeId, BiomeProfile>;
  /** Cells already painted in neighbouring regions (shared-grid keys). */
  pinned?: ReadonlyMap<string, string>;
  typeOf: (terrain: string) => string | undefined;
  /** World seed (worldSeed): the field's warp. */
  worldSeed: number;
  /** Seed for this region's draws; default the world seed. */
  seed?: number;
  /** Blend width (named, or a falloff k); default the own biome's tuned "blend-k", else normal. */
  blend?: BlendWidth | number;
  /** Domain warp in region spacings; default the own biome's tuned "wiggle" (REGION_WARP). */
  warp?: number;
}

export interface RegionPlan {
  /** Shared-grid key → terrain, for the region's own cells. */
  cells: Map<string, string>;
  /** The region's own biome and the ones it blends toward (≥ 10% mean influence). */
  biome?: RegionBiome;
  /** The region's mean biome mix (for the report / tests). */
  mix: Map<BiomeId, number>;
}

/** Biomes below this mean share don't count as a region's "from". */
export const FROM_SHARE = 0.1;

/** Terrain for one region, blended with the overworld and pinned to its painted neighbours. */
export function planRegion(input: RegionPlanInput): RegionPlan {
  // The region's own biome's tuning shapes the field it's made from (biomeTuning.ts).
  const ownId = input.biomes.get(`${input.parent[0]}_${input.parent[1]}`);
  const t = ownId ? input.profiles.get(ownId)?.tuning : undefined;
  const field = new BlendField(input.layout, input.biomes, input.blend ?? tunedOrUnset(t, "blend-k") ?? "normal", {
    warp: input.warp ?? (t ? tuned(t, "wiggle") : REGION_WARP),
    seed: input.worldSeed,
    warpScale: tuned(t, "wiggle-scale"),
    reach: tuned(t, "reach"),
    // A mixed biome draws from its parts by zone (biomeCombo.ts).
    expand: (b) => (isComboId(b) ? biomeParts(b) : undefined),
  });
  const cells = generateRegion({
    layout: input.layout,
    parent: input.parent,
    field,
    profiles: input.profiles,
    pinned: input.pinned,
    typeOf: input.typeOf,
    seed: input.seed ?? input.worldSeed,
  });
  const mix = field.mean(regionCells(input.layout, input.parent[0], input.parent[1]));
  const ranked = [...mix].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const own = input.biomes.get(`${input.parent[0]}_${input.parent[1]}`) ?? ranked[0]?.[0];
  let biome: RegionBiome | undefined;
  if (own) {
    // A combined biome is written readably ("Alpine 2 + Taiga"), in `from` too.
    const named = (b: BiomeId) => (isComboId(b) ? biomeRef(b) : b);
    const from = ranked.filter(([b, v]) => b !== own && v >= FROM_SHARE).map(([b]) => named(b));
    biome = { generator: biomeGeneratorId(own) ?? named(own), ...(from.length ? { from } : {}) };
  }
  return { cells, biome, mix };
}

/**
 * The terrain a region "is" for its parent hex (K6): the most common terrain
 * type, then the most common terrain of that type. Settlements never win.
 */
export function dominantTerrain(terrains: Iterable<string>, typeOf: (t: string) => string | undefined): string | undefined {
  const byType = new Map<string, Map<string, number>>();
  for (const t of terrains) {
    const ty = typeOf(t) ?? "";
    if (ty === "settlement") continue;
    if (!byType.has(ty)) byType.set(ty, new Map());
    const m = byType.get(ty)!;
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const types = [...byType].sort((a, b) => total(b[1]) - total(a[1]) || (a[0] < b[0] ? -1 : 1));
  const top = types[0]?.[1];
  if (!top) return undefined;
  return [...top].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/** A palette terrain's type lookup: its Type column only (names are never guessed). */
export function paletteTypeOf(palette: TerrainColor[]): (terrain: string) => string | undefined {
  const m = new Map(palette.map((t) => [t.name, t.type]));
  return (name) => m.get(name);
}

/** Overworld hexes in generation order: nearest the centre first (each pins the earlier ones). */
export function regionOrder(hexes: [number, number][], orientation: Orientation, stagger: Stagger): [number, number][] {
  if (!hexes.length) return [];
  const xs = hexes.map((h) => h[0]), ys = hexes.map((h) => h[1]);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  const dist = (a: [number, number]) => hexDistance(a, [cx, cy], orientation, stagger);
  return [...hexes].sort((a, b) => dist(a) - dist(b) || a[1] - b[1] || a[0] - b[0]);
}

/** Region map name for a hex: "<overworld> 3, 4", made unique against `taken` (lower-case slugs or names). */
export function defaultRegionName(parentLabel: string, px: number, py: number, hexName: string | undefined, taken: (name: string) => boolean): string {
  const base = hexName?.trim() || `${parentLabel} ${px}, ${py}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base} ${n}`)) return `${base} ${n}`;
}

/** "2,0 > 2,1 > 3,1" → ["2_0", "2_1", "3_1"] (bad parts dropped). */
export function parseBiomeRiver(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(">").map((p) => /^\s*(-?\d+)\s*[,_ ]\s*(-?\d+)\s*$/.exec(p)).filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]}_${m[2]}`);
}

/** ["2_0", "2_1"] → "2,0 > 2,1". */
export function formatBiomeRiver(keys: string[]): string {
  return keys.map((k) => k.replace("_", ",")).join(" > ");
}

// ── walking into new land ────────────────────────────────────────────────

/**
 * The grid that also holds hex (x, y): the smallest growth of offset/size
 * that takes it in (like the map's + expand buttons), or null when it is
 * inside already. Hex numbers never change, so regions keep their slots.
 */
export function gridToInclude(
  offset: { x: number; y: number },
  size: { cols: number; rows: number },
  x: number,
  y: number,
): { offset: { x: number; y: number }; size: { cols: number; rows: number } } | null {
  const x0 = Math.min(offset.x, x), y0 = Math.min(offset.y, y);
  const x1 = Math.max(offset.x + size.cols - 1, x), y1 = Math.max(offset.y + size.rows - 1, y);
  if (x0 === offset.x && y0 === offset.y && x1 - x0 + 1 === size.cols && y1 - y0 + 1 === size.rows) return null;
  return { offset: { x: x0, y: y0 }, size: { cols: x1 - x0 + 1, rows: y1 - y0 + 1 } };
}

/**
 * Roll a biome from `ids` with `seed`: the same seed always gives the same
 * biome, so a roll can be shown and repeated. Avoids `avoid` (the biome
 * being walked from) when there is any other.
 */
export function rollBiome(ids: readonly string[], seed: number, avoid?: string): string | undefined {
  const others = ids.filter((id) => id !== avoid);
  const pool = others.length ? others : ids;
  if (!pool.length) return undefined;
  return pool[Math.floor(hash2(seed >>> 0, 0x5eed, 0xb10e) * pool.length)];
}

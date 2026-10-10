/**
 * Regions in the vault (plan-overworld-regions phase 2a / 3): making a
 * Region map in its slot of the overworld's shared grid, generating it from
 * the overworld's biomes with its painted neighbours pinned, filling a blank
 * parent hex from it (K6), and making every missing region in one go.
 *
 * The rules live in regionWorld.ts (pure, tested); this file reads and
 * writes the plugin's maps.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData, RegionSettings, TerrainColor } from "../types";
import { slugify } from "../utils";
import { newWorldId } from "../worldgen/world";
import { BUILTIN_GENERATORS, builtinModel } from "../worldgen/builtinGenerators";
import { regionMapAt } from "../maps/submaps";
import { biomeProfiles, representativeTerrain, type BiomeId, type BiomeProfile } from "./biomes";
import { regionCells, type RegionLayout } from "./layout";
import type { BlendWidth } from "./blendField";
import {
  defaultRegionName,
  dominantTerrain,
  meshes,
  overworldBiomes,
  paletteTypeOf,
  planRegion,
  regionLayoutOf,
  regionOrder,
  regionSlot,
  withMeshFields,
  worldSeed,
  type GridRules,
  type RegionPlan,
} from "./regionWorld";
import { hexNeighbors } from "../../packages/hex-wfc/src/grid";

export function gridRulesOf(plugin: HexmakerPlugin): GridRules {
  return { orientation: plugin.settings.hexOrientation, stagger: plugin.settings.staggerOffset ?? "odd" };
}

/** The overworld's layout and shared-grid ids, when it has meshing region settings. */
export function overworldOf(plugin: HexmakerPlugin, parentName: string): { map: MapData; settings: RegionSettings; layout: RegionLayout } | undefined {
  const map = plugin.getMap(parentName);
  if (!map?.regions || !meshes(map.regions)) return undefined;
  const layout = regionLayoutOf(map, gridRulesOf(plugin));
  return layout ? { map, settings: map.regions, layout } : undefined;
}

/** The overworld a region map belongs to, with the region's parent hex. */
export function regionHome(plugin: HexmakerPlugin, regionName: string): { overworld: MapData; layout: RegionLayout; px: number; py: number } | undefined {
  const m = plugin.getMap(regionName);
  if (m?.submapKind !== "region" || !m.parent) return undefined;
  const ow = overworldOf(plugin, m.parent.map);
  if (!ow) return undefined;
  const [px, py] = m.parent.hex.split("_").map(Number);
  return { overworld: ow.map, layout: ow.layout, px, py };
}

const profileCache = new WeakMap<TerrainColor[], { key: string; profiles: Map<BiomeId, BiomeProfile> }>();

/** Biome profiles fitted to a palette (cached until its terrains change). */
export function profilesForPalette(palette: TerrainColor[]): Map<BiomeId, BiomeProfile> {
  const key = palette.map((t) => `${t.name}:${t.type ?? ""}`).join("|");
  const hit = profileCache.get(palette);
  if (hit && hit.key === key) return hit.profiles;
  const models = new Map(BUILTIN_GENERATORS.map((g) => [g.slug, builtinModel(g.slug)]));
  const profiles = biomeProfiles(models, palette);
  profileCache.set(palette, { key, profiles });
  return profiles;
}

/** Overworld hex key → its terrain (own, else the map's base terrain). */
export function overworldTerrain(plugin: HexmakerPlugin, map: MapData): Map<string, string> {
  const out = new Map<string, string>();
  const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
  for (let y = oy; y < oy + rows; y++) for (let x = ox; x < ox + cols; x++) {
    const t = plugin.mapStore.get(map.name, `${x}_${y}`)?.terrain ?? map.baseTerrain;
    if (t) out.set(`${x}_${y}`, t);
  }
  return out;
}

/** Fill the shared-grid fields once (world id, stagger) and save, before the first region. */
async function ensureMeshFields(plugin: HexmakerPlugin, map: MapData): Promise<RegionSettings> {
  const s = map.regions!;
  const next = withMeshFields(s, map.staggerOffset ?? plugin.settings.staggerOffset ?? "odd", newWorldId);
  if (next !== s) {
    map.regions = next;
    // Pin the overworld's own stagger too: changing it would move every slot.
    if (!map.staggerOffset) map.staggerOffset = plugin.settings.staggerOffset ?? "odd";
    await plugin.saveSettings();
  }
  return next;
}

/** Terrain painted in the regions around parent hex (px, py): pinned so seams join. */
function pinnedAround(plugin: HexmakerPlugin, parentName: string, layout: RegionLayout, px: number, py: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const [qx, qy] of hexNeighbors(px, py, layout.orientation, layout.parentStagger)) {
    const r = regionMapAt(plugin.settings.maps, parentName, `${qx}_${qy}`);
    if (!r) continue;
    for (const [k, h] of plugin.mapStore.all(r.name)) if (h.terrain) out.set(k, h.terrain);
  }
  return out;
}

export interface RegionGenOptions {
  /** Seed for this region's draws; default the region's stored seed, else the world's. */
  seed?: number;
  /** Blend width for this region; default the overworld's region settings. */
  blend?: BlendWidth;
  /** Domain warp (0..0.5, in region spacings); default REGION_WARP. */
  warp?: number;
  /** Preview only: treat the region's own overworld hex as this terrain (nothing is written). */
  hexTerrain?: string;
}

/**
 * What the region of hex (px, py) would be: its terrain and biome. When the
 * region exists, its locked (hand-painted) cells are pinned: kept as they
 * are and blended around.
 */
export function planRegionAt(plugin: HexmakerPlugin, parentName: string, px: number, py: number, opts: RegionGenOptions = {}): RegionPlan | undefined {
  const ow = overworldOf(plugin, parentName);
  if (!ow) return undefined;
  const palette = regionPalette(plugin, ow.map);
  const owPalette = plugin.getMapPalette(ow.map.name);
  const terrain = overworldTerrain(plugin, ow.map);
  if (opts.hexTerrain) terrain.set(`${px}_${py}`, opts.hexTerrain);
  const biomes = overworldBiomes(terrain, owPalette, ow.layout.orientation, ow.layout.parentStagger);
  const ws = worldSeed(ow.settings.worldId ?? ow.map.name);
  const pinned = pinnedAround(plugin, parentName, ow.layout, px, py);
  const own = regionMapAt(plugin.settings.maps, parentName, `${px}_${py}`);
  if (own) for (const [k, h] of plugin.mapStore.all(own.name)) if (h.locked && h.terrain) pinned.set(k, h.terrain);
  return planRegion({
    layout: ow.layout,
    parent: [px, py],
    biomes,
    profiles: profilesForPalette(palette),
    pinned,
    typeOf: paletteTypeOf(palette),
    worldSeed: ws,
    seed: opts.seed ?? own?.regionSeed ?? ws,
    blend: opts.blend ?? ow.settings.blend,
    warp: opts.warp,
  });
}

/** The palette regions of this overworld are painted with. */
export function regionPalette(plugin: HexmakerPlugin, overworld: MapData): TerrainColor[] {
  const name = overworld.regions?.palette ?? overworld.paletteName;
  return plugin.getPaletteOrPresetTerrains(name);
}

export interface CreateRegionOptions extends RegionGenOptions {
  name?: string;
  /** "match": blend with the overworld and the painted neighbours; "blank": nothing painted. */
  fill: "match" | "blank";
}

/**
 * Make the Region map of hex (px, py): placed in its slot, generated (or
 * blank), linked as the hex's region, and the parent hex filled from it
 * when it has no terrain (K6). Refused when the hex already has one.
 */
export async function createRegion(plugin: HexmakerPlugin, parentName: string, px: number, py: number, opts: CreateRegionOptions): Promise<{ name: string } | { error: string }> {
  const parent = plugin.getMap(parentName);
  if (!parent?.regions) return { error: "Set up this map's regions first." };
  if (!meshes(parent.regions)) return { error: "Hex-flower regions don't join up yet: make this one from the new-map form." };
  const hex = `${px}_${py}`;
  const existing = regionMapAt(plugin.settings.maps, parentName, hex);
  if (existing) return { error: `This hex's region is ${plugin.mapLabel(existing.name)}.` };
  const settings = await ensureMeshFields(plugin, parent);
  const layout = regionLayoutOf(parent, gridRulesOf(plugin))!;
  const slot = regionSlot(layout, settings.worldId!, px, py);
  const plan = opts.fill === "match" ? planRegionAt(plugin, parentName, px, py, opts) : undefined;
  const paletteName = settings.palette ?? parent.paletteName;
  const taken = (n: string) => plugin.settings.maps.some((m) => m.name === slugify(n));
  const name = opts.name?.trim() || defaultRegionName(plugin.mapLabel(parentName), px, py, plugin.mapStore.get(parentName, hex)?.name, taken);
  const res = await plugin.createNewMap(name, slot.cols, slot.rows, paletteName, slot.offset.x, slot.offset.y, slot.stagger, undefined, plan?.cells, {
    parent: { map: parentName, hex },
    quiet: true,
  });
  if ("error" in res) return res;
  const child = plugin.getMap(res.name)!;
  child.world = slot.world;
  if (plan?.biome) child.biome = plan.biome;
  if (opts.seed !== undefined) child.regionSeed = opts.seed;
  await plugin.linkRegion(parentName, px, py, res.name);
  await fillBlankParent(plugin, parentName, px, py, res.name);
  return res;
}

/**
 * K6: the parent hex gets the region's dominant terrain, but only when it
 * has none (painted hexes are never touched). Returns the terrain set, if any.
 */
export async function fillBlankParent(plugin: HexmakerPlugin, parentName: string, px: number, py: number, regionName: string): Promise<string | undefined> {
  const hex = `${px}_${py}`;
  if (plugin.mapStore.get(parentName, hex)?.terrain) return undefined;
  const region = plugin.getMap(regionName);
  if (!region) return undefined;
  const palette = plugin.getMapPalette(regionName);
  const terrains = [...plugin.mapStore.all(regionName).values()].map((h) => h.terrain).filter((t): t is string => !!t);
  const top = dominantTerrain(terrains, paletteTypeOf(palette));
  const owPalette = plugin.getMapPalette(parentName);
  if (!top || !owPalette.some((t) => t.name === top)) return undefined;
  plugin.mapStore.set(parentName, hex, { terrain: top });
  await plugin.mapStore.flush();
  return top;
}

/** Overworld hexes that could get a region: painted, inside the map, none yet. */
export function missingRegionHexes(plugin: HexmakerPlugin, parentName: string): [number, number][] {
  const map = plugin.getMap(parentName);
  if (!map) return [];
  const out: [number, number][] = [];
  for (const k of overworldTerrain(plugin, map).keys()) {
    if (regionMapAt(plugin.settings.maps, parentName, k)) continue;
    const [x, y] = k.split("_").map(Number);
    out.push([x, y]);
  }
  return out;
}

/**
 * Make a region for every painted hex that has none, centre-out (each pins
 * the ones before it). `onProgress` after each; stops early when
 * `cancelled()` turns true. Returns how many were made and any errors.
 */
export async function generateMissingRegions(
  plugin: HexmakerPlugin,
  parentName: string,
  hooks: { onProgress?: (done: number, total: number, name: string) => void; cancelled?: () => boolean } = {},
): Promise<{ made: string[]; errors: string[] }> {
  const ow = overworldOf(plugin, parentName);
  if (!ow) return { made: [], errors: ["This map has no rectangle region settings."] };
  const order = regionOrder(missingRegionHexes(plugin, parentName), ow.layout.orientation, ow.layout.parentStagger);
  const made: string[] = [];
  const errors: string[] = [];
  for (const [px, py] of order) {
    if (hooks.cancelled?.()) break;
    const res = await createRegion(plugin, parentName, px, py, { fill: "match" });
    if ("error" in res) errors.push(`${px}, ${py}: ${res.error}`);
    else made.push(res.name);
    hooks.onProgress?.(made.length + errors.length, order.length, "name" in res ? res.name : "");
  }
  return { made, errors };
}

/** Every cell of a region map's block (for previews): shared-grid keys. */
export function regionBlockKeys(layout: RegionLayout, px: number, py: number): string[] {
  return regionCells(layout, px, py).map(([x, y]) => `${x}_${y}`);
}

// ── reshaping: set a biome, regenerate, reroll ───────────────────────────

/**
 * Whether reshaping a hex's region (repainting its biome, rerolling,
 * regenerating) may go ahead, and how. The single gate for work modes
 * (plan-work-modes: God mode) to plug into later. Today: making a region
 * for the first time is always allowed; replacing an existing region's
 * generated terrain asks first.
 */
export function canReshape(plugin: HexmakerPlugin, parentName: string, px: number, py: number): "allowed" | "confirm" {
  return regionMapAt(plugin.settings.maps, parentName, `${px}_${py}`) ? "confirm" : "allowed";
}

/**
 * Regenerate an existing region's terrain from the overworld (its biome may
 * have changed) with these options. Locked (hand-painted) cells stay. Saves
 * the seed used. Returns how many cells changed.
 */
export async function regenerateRegion(plugin: HexmakerPlugin, regionName: string, opts: RegionGenOptions = {}): Promise<number> {
  const region = plugin.getMap(regionName);
  if (region?.submapKind !== "region" || !region.parent) return 0;
  const [px, py] = region.parent.hex.split("_").map(Number);
  const plan = planRegionAt(plugin, region.parent.map, px, py, opts);
  if (!plan) return 0;
  const cur = plugin.mapStore.all(regionName);
  const cells: [string, { terrain: string }][] = [];
  for (const [k, t] of plan.cells) if (cur.get(k)?.terrain !== t) cells.push([k, { terrain: t }]);
  plugin.mapStore.setMany(regionName, cells);
  if (plan.biome) region.biome = plan.biome;
  if (opts.seed !== undefined) region.regionSeed = opts.seed;
  await plugin.saveSettings();
  await plugin.mapStore.flush();
  return cells.length;
}

/**
 * Set an overworld hex's biome: paint it with the biome's terrain on the
 * overworld's palette (the terrain IS the biome signal), then make its
 * region (first placement) or regenerate it (callers confirm first; see
 * canReshape). Returns the region's name, or an error.
 */
export async function setBiomeAt(
  plugin: HexmakerPlugin,
  parentName: string,
  px: number,
  py: number,
  biome: BiomeId,
  opts: RegionGenOptions = {},
): Promise<{ name: string } | { error: string }> {
  const parent = plugin.getMap(parentName);
  if (!parent) return { error: "Map not found." };
  const terrain = representativeTerrain(biome, plugin.getMapPalette(parentName));
  if (!terrain) return { error: "This map's palette has no terrain for that biome." };
  const hex = `${px}_${py}`;
  if (plugin.mapStore.get(parentName, hex)?.terrain !== terrain) {
    plugin.mapStore.set(parentName, hex, { terrain });
    await plugin.mapStore.flush();
  }
  const existing = regionMapAt(plugin.settings.maps, parentName, hex);
  if (existing) {
    await regenerateRegion(plugin, existing.name, opts);
    return { name: existing.name };
  }
  return createRegion(plugin, parentName, px, py, { ...opts, fill: "match" });
}

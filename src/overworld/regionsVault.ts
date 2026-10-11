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
import { biomeByRef, biomeForTerrain, biomeNoteOf, biomeProfiles, biomeSourceVersion, noteBiomeProfiles, representativeTerrain, type BiomeId, type BiomeProfile } from "./biomes";
import { regionCells, type RegionLayout } from "./layout";
import type { BlendWidth } from "./blendField";
import { ADD_REGION_LOCKED_HINT, canAdd, canReshape, PLACE_LOCKED_HINT, RESHAPE_LOCKED_HINT } from "../workMode";
import {
  defaultRegionName,
  dominantTerrain,
  gridToInclude,
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

/**
 * Biome profiles fitted to a palette (cached until its terrains or the
 * biome notes change): each biome note's type mix (#50). A biome with no
 * note (the notes haven't loaded, or its note was deleted while the
 * overworld's terrain still reads as it) falls back to the shipped
 * generator's mix, so a region is never left without one.
 */
export function profilesForPalette(palette: TerrainColor[]): Map<BiomeId, BiomeProfile> {
  const key = `${biomeSourceVersion()}#` + palette.map((t) => `${t.name}:${t.type ?? ""}`).join("|");
  const hit = profileCache.get(palette);
  if (hit && hit.key === key) return hit.profiles;
  const models = new Map(BUILTIN_GENERATORS.map((g) => [g.slug, builtinModel(g.slug)]));
  const profiles = biomeProfiles(models, palette);
  for (const [id, p] of noteBiomeProfiles(palette)) profiles.set(id, p);
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

/**
 * Overworld hexes whose region was made from a biome note's biome (#50):
 * hex → biome id. These win over the hex's terrain (a user's biome paints
 * a terrain that reads back as a built-in one). A region whose biome no
 * longer exists isn't listed (its hex goes by its terrain again).
 */
export function placedBiomes(plugin: HexmakerPlugin, overworldName: string): Map<string, BiomeId> {
  const out = new Map<string, BiomeId>();
  for (const m of plugin.settings.maps) {
    if (m.submapKind !== "region" || m.parent?.map !== overworldName) continue;
    const id = biomeByRef(m.biome?.generator);
    if (id) out.set(m.parent.hex, id);
  }
  return out;
}

/** One overworld hex's biome: its placed biome, else read from its terrain. */
export function hexBiomeAt(plugin: HexmakerPlugin, overworldName: string, hex: string): BiomeId | undefined {
  const region = regionMapAt(plugin.settings.maps, overworldName, hex);
  const placed = region ? biomeByRef(region.biome?.generator) : undefined;
  if (placed) return placed;
  const terrain = plugin.mapStore.get(overworldName, hex)?.terrain;
  return terrain ? biomeForTerrain(terrain, plugin.getMapPalette(overworldName)) : undefined;
}

/**
 * What a region says it was made from: its biome's id, or `unknown` (the
 * name it recorded) when that biome's note is gone. Undefined when it
 * recorded none, or a shipped generator (`builtin:…`).
 */
export function regionBiomeStatus(plugin: HexmakerPlugin, regionName: string): { id: BiomeId } | { unknown: string } | undefined {
  const ref = plugin.getMap(regionName)?.biome?.generator;
  if (!ref || ref.startsWith("builtin:")) return undefined;
  const id = biomeByRef(ref);
  return id ? { id } : { unknown: ref };
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
  /** The region's own biome (a hex set to a user's biome, which its terrain can't tell); default read from the overworld. */
  biome?: BiomeId;
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
  const placed = placedBiomes(plugin, parentName);
  if (opts.biome) placed.set(`${px}_${py}`, opts.biome);
  const biomes = overworldBiomes(terrain, owPalette, ow.layout.orientation, ow.layout.parentStagger, placed);
  const ownBiome = biomes.get(`${px}_${py}`);
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
    blend: opts.blend ?? (ownBiome ? biomeNoteOf(ownBiome)?.blend : undefined) ?? ow.settings.blend,
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
  if (!canAdd(parent)) return { error: ADD_REGION_LOCKED_HINT };
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
  if (!canAdd(plugin.getMap(parentName))) return { made: [], errors: [ADD_REGION_LOCKED_HINT] };
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
 * Why setting hex (px, py)'s biome (first placement, or swapping it,
 * rerolling, regenerating, applying region settings) is locked right now,
 * or undefined when it may go ahead. A first placement (no region yet)
 * needs Build or God; changing a region that's already there needs God
 * (src/workMode.ts). No confirm: the mode is the safety catch.
 */
export function reshapeLock(plugin: HexmakerPlugin, parentName: string, px: number, py: number): string | undefined {
  const map = plugin.getMap(parentName);
  if (!regionMapAt(plugin.settings.maps, parentName, `${px}_${py}`)) return canAdd(map) ? undefined : PLACE_LOCKED_HINT;
  return canReshape(map) ? undefined : RESHAPE_LOCKED_HINT;
}

/** reshapeLock as a yes/no. */
export function reshapeGate(plugin: HexmakerPlugin, parentName: string, px: number, py: number): "allowed" | "locked" {
  return reshapeLock(plugin, parentName, px, py) === undefined ? "allowed" : "locked";
}

/**
 * Regenerate an existing region's terrain from the overworld (its biome may
 * have changed) with these options. Locked (hand-painted) cells stay. Saves
 * the seed used. Returns how many cells changed.
 */
export async function regenerateRegion(plugin: HexmakerPlugin, regionName: string, opts: RegionGenOptions = {}): Promise<number> {
  const region = plugin.getMap(regionName);
  if (region?.submapKind !== "region" || !region.parent) return 0;
  if (!canReshape(plugin.getMap(region.parent.map))) return 0; // see reshapeGate
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
 * region (first placement: Build or God) or regenerate it (God only; see
 * reshapeLock). Returns the region's name, or an error.
 */
export async function setBiomeAt(
  plugin: HexmakerPlugin,
  parentName: string,
  px: number,
  py: number,
  biome: BiomeId,
  opts: RegionGenOptions & { name?: string } = {},
): Promise<{ name: string } | { error: string }> {
  const parent = plugin.getMap(parentName);
  if (!parent) return { error: "Map not found." };
  const terrain = representativeTerrain(biome, plugin.getMapPalette(parentName));
  if (!terrain) return { error: "This map's palette has no terrain for that biome." };
  const hex = `${px}_${py}`;
  const lock = reshapeLock(plugin, parentName, px, py);
  if (lock) return { error: lock };
  if (plugin.mapStore.get(parentName, hex)?.terrain !== terrain) {
    plugin.mapStore.set(parentName, hex, { terrain });
    await plugin.mapStore.flush();
  }
  const existing = regionMapAt(plugin.settings.maps, parentName, hex);
  if (existing) {
    await regenerateRegion(plugin, existing.name, { ...opts, biome });
    return { name: existing.name };
  }
  return createRegion(plugin, parentName, px, py, { ...opts, biome, fill: "match" });
}

// ── walking into new land ────────────────────────────────────────────────

/** Is overworld hex (px, py) inside the overworld's grid? */
export function inOverworldGrid(map: Pick<MapData, "gridOffset" | "gridSize">, px: number, py: number): boolean {
  return gridToInclude(map.gridOffset, map.gridSize, px, py) === null;
}

/**
 * Why walking from `fromMap` into new land on overworld `overworldName` is
 * locked, or undefined when it may go ahead. Both maps' work modes count:
 * the one you're on (its mode is on the toolbar) and the overworld the new
 * region is added to. Build and God allow it; Play doesn't.
 */
export function walkLock(plugin: HexmakerPlugin, fromMap: string, overworldName: string): string | undefined {
  if (!canAdd(plugin.getMap(fromMap))) return ADD_REGION_LOCKED_HINT;
  if (!canAdd(plugin.getMap(overworldName))) return `Switch ${plugin.mapLabel(overworldName)} to Build to make a region.`;
  return undefined;
}

/**
 * Walk from a region into new land at overworld hex (px, py) (the region
 * flower's "+"): grow the overworld to take the hex in when it lies past
 * the grid, set the hex's biome and make its region, blended with the
 * overworld and pinned to the regions around it. Build and God only; a hex
 * that already has a region is refused (its biome is God's to change).
 */
export async function walkIntoHex(
  plugin: HexmakerPlugin,
  parentName: string,
  px: number,
  py: number,
  biome: BiomeId,
  opts: RegionGenOptions & { name?: string; from?: string } = {},
): Promise<{ name: string; grew: boolean } | { error: string }> {
  const parent = plugin.getMap(parentName);
  if (!parent) return { error: "Map not found." };
  const lock = walkLock(plugin, opts.from ?? parentName, parentName);
  if (lock) return { error: lock };
  if (!overworldOf(plugin, parentName)) return { error: "This map has no rectangle region settings." };
  const existing = regionMapAt(plugin.settings.maps, parentName, `${px}_${py}`);
  if (existing) return { error: `That hex's region is ${plugin.mapLabel(existing.name)}.` };
  if (!representativeTerrain(biome, plugin.getMapPalette(parentName))) return { error: "This map's palette has no terrain for that biome." };
  const grow = gridToInclude(parent.gridOffset, parent.gridSize, px, py);
  if (grow) {
    parent.gridOffset = grow.offset;
    parent.gridSize = grow.size;
    await plugin.saveSettings();
  }
  const res = await setBiomeAt(plugin, parentName, px, py, biome, opts);
  return "error" in res ? res : { name: res.name, grew: !!grow };
}

/**
 * "Generate overworld" (#50): the first pass. Biome pools in the vault,
 * laying a pool's biomes out with World biomes, and making (or remaking)
 * every region with its biome. Only a first pass: afterwards each region
 * is edited, rerolled or swapped as usual (within the work-mode gates).
 *
 * - Pools: `<biome pools folder>/<name>.md` (biomePool.ts). The shipped
 *   "All biomes" pool is written once (settings.biomePoolSeeded).
 * - Regenerating an existing overworld needs God; locked (hand-painted)
 *   hexes keep their terrain and biome, and their regions are left alone.
 *   Regions are remade in place (their notes, names and locked cells stay).
 * - Every region goes through regionGenerator(biome), the single routing
 *   point (inside createRegion / regenerateRegion, planRegionWithGenerator):
 *   generator-backed biomes are made by their generator, the rest blend.
 */

import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { canAdd, canReshape } from "../workMode";
import { regionMapAt } from "../maps/submaps";
import {
  ALL_BIOMES_POOL,
  allBiomesPool,
  buildBiomePool,
  parseBiomePool,
  poolBiomes,
  updateBiomePool,
  type BiomePoolProblem,
  type BiomePoolRow,
} from "./biomePool";
import { biomeFileName, type BiomeNoteFields } from "./biomeNote";
import { BIOME_PRESETS } from "./biomePresets";
import { biomeByRef, biomeForTerrain, biomeNoteOf, biomeRef, isBlankBiome, type BiomeId } from "./biomes";
import { regionGenerator } from "./biomeForm";
import { biomeColumnFills, firstPassWrites } from "./overworldPass";
import { formatBiomeRiver, regionOrder, withMeshFields } from "./regionWorld";
import { createRegion, hexBiomeAt, overworldBiomeHexes, overworldOf, regenerateRegion } from "./regionsVault";
import { unclimatedText, worldBiomes, type Unclimated, type WorldBiomesOptions, type WorldBiomesResult } from "./worldBiomes";
import { newWorldId } from "../worldgen/world";
import type { MapData, RegionSettings } from "../types";

/** Hint shown where regenerating a whole overworld is locked. */
export const REGENERATE_LOCKED_HINT = "Switch to God to regenerate the whole overworld.";

// ── pools in the vault ───────────────────────────────────────────────────

export function biomePoolsFolder(plugin: HexmakerPlugin): string {
  const configured = normalizeFolder(plugin.settings.biomePoolsFolder ?? "");
  if (configured) return configured;
  const world = normalizeFolder(plugin.settings.worldFolder ?? "");
  return world ? `${world}/biome-pools` : "biome-pools";
}

export interface PoolNote {
  path: string;
  name: string;
  rows: BiomePoolRow[];
  problems: BiomePoolProblem[];
}

async function ensureFolder(plugin: HexmakerPlugin, folder: string): Promise<void> {
  const parts = folder.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    if (!plugin.app.vault.getAbstractFileByPath(p)) {
      try { await plugin.app.vault.createFolder(p); } catch { /* made meanwhile */ }
    }
  }
}

/** Write the shipped "All biomes" pool, once (never over a note, never again once deleted). */
export async function ensureDefaultPool(plugin: HexmakerPlugin): Promise<void> {
  if (plugin.settings.biomePoolSeeded) return;
  const folder = biomePoolsFolder(plugin);
  const path = `${folder}/${ALL_BIOMES_POOL}.md`;
  if (!plugin.app.vault.getAbstractFileByPath(path)) {
    await ensureFolder(plugin, folder);
    try {
      await plugin.app.vault.create(path, buildBiomePool(ALL_BIOMES_POOL, allBiomesPool(BIOME_PRESETS)));
    } catch (e) {
      console.error("Hexmaker: couldn't write the biome pool", path, e);
      return;
    }
  }
  plugin.settings.biomePoolSeeded = true;
  await plugin.saveSettings();
}

/** Every pool note (names starting with "_" left out), by name. Seeds the default first. */
export async function listBiomePools(plugin: HexmakerPlugin): Promise<PoolNote[]> {
  await ensureDefaultPool(plugin);
  const root = plugin.app.vault.getAbstractFileByPath(biomePoolsFolder(plugin));
  if (!(root instanceof TFolder)) return [];
  const files: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const c of f.children) {
      if (c instanceof TFolder) walk(c);
      else if (c instanceof TFile && c.extension === "md" && !c.basename.startsWith("_")) files.push(c);
    }
  };
  walk(root);
  const out: PoolNote[] = [];
  for (const f of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    const { rows, problems } = parseBiomePool(await plugin.app.vault.read(f));
    out.push({ path: f.path, name: f.basename, rows, problems });
  }
  return out;
}

/** Save a pool's rows: into its note (`path`), or a new note named `name`. */
export async function saveBiomePool(plugin: HexmakerPlugin, target: { path: string } | { name: string }, rows: BiomePoolRow[]): Promise<{ path: string } | { error: string }> {
  if ("path" in target) {
    const f = plugin.app.vault.getAbstractFileByPath(target.path);
    if (!(f instanceof TFile)) return { error: "That pool's note is gone." };
    const content = await plugin.app.vault.read(f);
    const next = updateBiomePool(content, rows);
    if (next !== content) await plugin.app.vault.modify(f, next);
    return { path: f.path };
  }
  const name = biomeFileName(target.name.trim());
  if (!target.name.trim()) return { error: "Give the pool a name." };
  const folder = biomePoolsFolder(plugin);
  const path = `${folder}/${name}.md`;
  if (plugin.app.vault.getAbstractFileByPath(path)) return { error: `There's already a pool called ${name}.` };
  await ensureFolder(plugin, folder);
  await plugin.app.vault.create(path, buildBiomePool(name, rows));
  return { path };
}

/** A pool's biomes, looked up in the biome notes. */
export function resolvePool(plugin: HexmakerPlugin, rows: readonly BiomePoolRow[]): { biomes: BiomeNoteFields[]; unknown: string[] } {
  return poolBiomes(rows, (ref) => plugin.biomeStore.get(ref));
}

/** A pool row for a biome (linked by its note's name). */
export function poolRowFor(plugin: HexmakerPlugin, biome: BiomeNoteFields): BiomePoolRow {
  const path = plugin.biomeStore.pathOf(biome.id);
  return { biome: path ? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "") : biomeFileName(biome.label) };
}

// ── the pass ─────────────────────────────────────────────────────────────

/** The hexes an existing overworld covers: painted or with a region (else its whole grid). */
export function overworldCells(plugin: HexmakerPlugin, mapName: string): [number, number][] {
  const map = plugin.getMap(mapName);
  if (!map) return [];
  const keys = new Set<string>();
  for (const [k, h] of plugin.mapStore.all(mapName)) if (h.terrain || h.regionMap || h.biome) keys.add(k);
  for (const m of plugin.settings.maps) if (m.submapKind === "region" && m.parent?.map === mapName) keys.add(m.parent.hex);
  if (!keys.size) {
    for (let y = map.gridOffset.y; y < map.gridOffset.y + map.gridSize.rows; y++) {
      for (let x = map.gridOffset.x; x < map.gridOffset.x + map.gridSize.cols; x++) keys.add(`${x}_${y}`);
    }
  }
  return [...keys].map((k) => k.split("_").map(Number) as [number, number]);
}

/** World biomes for an overworld's cells from a pool. */
export function layOutBiomes(
  plugin: HexmakerPlugin,
  cells: [number, number][],
  palette: Parameters<typeof worldBiomes>[3],
  opts: Omit<WorldBiomesOptions, "biomes">,
  pool: readonly BiomeNoteFields[] | undefined,
  stagger?: "odd" | "even",
): WorldBiomesResult {
  const o = plugin.settings.hexOrientation, s = stagger ?? plugin.settings.staggerOffset ?? "odd";
  return worldBiomes(cells, o, s, palette, { ...opts, biomes: pool });
}

/** Write a result into the overworld (locked hexes kept): terrain and the Biome column. Returns the hexes kept. */
export async function writeOverworldBiomes(plugin: HexmakerPlugin, mapName: string, result: WorldBiomesResult): Promise<{ written: number; kept: string[] }> {
  const current = new Map([...plugin.mapStore.all(mapName)].map(([k, h]) => [k, { terrain: h.terrain, biome: h.biome, locked: h.locked }]));
  const { cells, kept } = firstPassWrites(current, result, biomeRef, isBlankBiome);
  for (const [k, patch] of cells) plugin.mapStore.set(mapName, k, patch);
  await plugin.mapStore.flush();
  return { written: cells.length, kept };
}

/**
 * New overworld…'s starting region settings: each hex opens into an 8 × 8
 * region, normal blend, every region made at once, pool biomes without a
 * climate fill the gaps. The setup wizard's and New map's Biomes maps use
 * the same (with "Make every region now" off: the step stays simple).
 */
export const NEW_OVERWORLD_DEFAULTS: { regionSize: number; blend: NonNullable<RegionSettings["blend"]>; makeAll: boolean; unclimated: Unclimated } = {
  regionSize: 8,
  blend: "normal",
  makeAll: true,
  unclimated: "fill",
};

/** What makes a new map an overworld. */
export interface NewOverworldSetup {
  regionSize: number;
  blend: NonNullable<RegionSettings["blend"]>;
  /** Palette every region uses (the overworld's). */
  palette: string;
  stagger: "odd" | "even";
  seed: number;
  unclimated: Unclimated;
  /** The biome pool note it was laid out from (unset: every biome with a climate). */
  poolPath?: string;
  /** The layout's river (biome data, not a path). */
  river?: readonly string[];
}

/** The map-note fields of a new overworld (its region settings, river, pool, seed, gaps rule). Pure. */
export function newOverworldFields(s: NewOverworldSetup, makeId: () => string = newWorldId): Pick<MapData, "regions" | "biomeRiver" | "biomePool" | "seed" | "biomeGaps"> {
  return {
    regions: withMeshFields({ footprint: "rect", size: s.regionSize, blend: s.blend, palette: s.palette }, s.stagger, makeId),
    ...(s.river && s.river.length > 1 ? { biomeRiver: formatBiomeRiver([...s.river]) } : {}),
    ...(s.poolPath ? { biomePool: s.poolPath } : {}),
    // Saved with the map (`seed:`), so its layout can be made again.
    seed: s.seed,
    biomeGaps: unclimatedText(s.unclimated),
  };
}

/**
 * Make a just-created map an overworld (New overworld…, and a Biomes map
 * from the setup wizard or New map): its region settings and the rest of
 * newOverworldFields, every hex's biome in the Biome column (BC1; blank
 * hexes get no terrain), then, with `makeAll`, every region.
 */
export async function finishNewOverworld(
  plugin: HexmakerPlugin,
  mapName: string,
  result: WorldBiomesResult | undefined,
  setup: NewOverworldSetup & { makeAll: boolean; cells: [number, number][] } & RegionPassHooks,
): Promise<{ made: string[]; errors: string[] } | undefined> {
  const map = plugin.getMap(mapName);
  if (!map) return undefined;
  Object.assign(map, newOverworldFields({ ...setup, river: setup.river ?? result?.river }));
  await plugin.saveSettings();
  if (result) await writeOverworldBiomes(plugin, mapName, result);
  if (!setup.makeAll) return undefined;
  const r = await regionPass(plugin, mapName, setup.cells, { remake: false, onProgress: setup.onProgress, cancelled: setup.cancelled });
  return { made: r.made, errors: r.errors };
}

export interface RegionPassHooks {
  onProgress?: (done: number, total: number, name: string) => void;
  cancelled?: () => boolean;
}

/**
 * Make every missing region, and (God, `remake`) regenerate the existing
 * ones, centre-out, each through regionGenerator(biome). Hexes in `skip`
 * (locked) are left alone. Returns what happened.
 */
export async function regionPass(
  plugin: HexmakerPlugin,
  mapName: string,
  cells: [number, number][],
  opts: { remake: boolean; skip?: ReadonlySet<string> } & RegionPassHooks,
): Promise<{ made: string[]; remade: string[]; waiting: number; errors: string[] }> {
  const out = { made: [] as string[], remade: [] as string[], waiting: 0, errors: [] as string[] };
  const ow = overworldOf(plugin, mapName);
  if (!ow) { out.errors.push("This map has no rectangle region settings."); return out; }
  const order = regionOrder(cells.filter(([x, y]) => !opts.skip?.has(`${x}_${y}`)), ow.layout.orientation, ow.layout.parentStagger);
  let done = 0;
  for (const [px, py] of order) {
    if (opts.cancelled?.()) break;
    const hex = `${px}_${py}`;
    const terrain = plugin.mapStore.get(mapName, hex)?.terrain;
    const existing = regionMapAt(plugin.settings.maps, mapName, hex);
    const biome = biomeOfHex(plugin, mapName, hex, terrain);
    // The routing point: every region of every biome goes through here.
    const route = regionGenerator(biome ? biomeNoteOf(biome) : undefined);
    if (route.kind === "generator" && !route.ready) out.waiting++;
    let name = "";
    if (existing) {
      if (opts.remake) {
        await regenerateRegion(plugin, existing.name, biome ? { biome } : {});
        out.remade.push(existing.name);
        name = existing.name;
      }
    } else if (terrain || biome) {
      const res = await createRegion(plugin, mapName, px, py, { fill: "match", ...(biome ? { biome } : {}) });
      if ("error" in res) out.errors.push(`${px}, ${py}: ${res.error}`);
      else { out.made.push(res.name); name = res.name; }
    }
    opts.onProgress?.(++done, order.length, name);
  }
  return out;
}

function biomeOfHex(plugin: HexmakerPlugin, mapName: string, hex: string, terrain: string | undefined): BiomeId | undefined {
  const own = biomeByRef(plugin.mapStore.get(mapName, hex)?.biome);
  if (own) return own;
  return terrain ? biomeForTerrain(terrain, plugin.getMapPalette(mapName)) : undefined;
}

/**
 * BC1, once per vault: older overworlds wrote the Biome column only for
 * biomes their terrain couldn't say. Fill it for every hex with a biome
 * (its region's, else its terrain's), so every overworld reads the same.
 * Hexes with a Biome cell are left as written. Returns how many were filled.
 */
export async function fillBiomeColumns(plugin: HexmakerPlugin): Promise<number> {
  if (plugin.settings.biomeColumnsFilled) return 0;
  let n = 0;
  for (const map of plugin.settings.maps) {
    if (!overworldOf(plugin, map.name)) continue;
    const fills = biomeColumnFills(
      overworldBiomeHexes(plugin, map),
      (k) => plugin.mapStore.get(map.name, k),
      (k) => hexBiomeAt(plugin, map.name, k),
      biomeRef,
    );
    if (!fills.length) continue;
    plugin.mapStore.setMany(map.name, fills.map(([k, ref]) => [k, { biome: ref }]));
    n += fills.length;
  }
  if (n) await plugin.mapStore.flush();
  plugin.settings.biomeColumnsFilled = true;
  await plugin.saveSettings();
  return n;
}

export interface RegenerateOptions extends Omit<WorldBiomesOptions, "biomes"> {
  /** The pool's note (recorded on the map), and its biomes. */
  poolPath?: string;
  pool?: readonly BiomeNoteFields[];
  /** Make the missing regions and remake the rest (default true). */
  regions?: boolean;
}

/**
 * Regenerate a whole overworld (God only): lay the pool's biomes out again,
 * keep locked hexes, then remake the regions (theirs too, locked cells
 * kept) and make the missing ones.
 */
export async function regenerateOverworld(
  plugin: HexmakerPlugin,
  mapName: string,
  opts: RegenerateOptions,
  hooks: RegionPassHooks = {},
): Promise<{ written: number; kept: number; made: number; remade: number; waiting: number; errors: string[] } | { error: string }> {
  const map = plugin.getMap(mapName);
  if (!map) return { error: "Map not found." };
  if (!canReshape(map)) return { error: REGENERATE_LOCKED_HINT };
  const cells = overworldCells(plugin, mapName);
  const result = layOutBiomes(plugin, cells, plugin.getMapPalette(mapName), opts, opts.pool, map.staggerOffset);
  if (!result.biomes.size) return { error: "No biome in this pool can be placed: give some a climate." };
  const { written, kept } = await writeOverworldBiomes(plugin, mapName, result);
  map.biomeRiver = result.river.length > 1 ? formatBiomeRiver(result.river) : undefined;
  if (opts.poolPath) map.biomePool = opts.poolPath;
  map.biomeGaps = unclimatedText(opts.unclimated ?? "fill");
  await plugin.saveSettings();
  let regions = { made: [] as string[], remade: [] as string[], waiting: 0, errors: [] as string[] };
  if ((opts.regions ?? true) && overworldOf(plugin, mapName) && canAdd(map)) {
    regions = await regionPass(plugin, mapName, cells, { remake: true, skip: new Set(kept), ...hooks });
  }
  plugin.refreshHexMap();
  return { written, kept: kept.length, made: regions.made.length, remade: regions.remade.length, waiting: regions.waiting, errors: regions.errors };
}

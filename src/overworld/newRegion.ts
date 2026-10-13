/**
 * Edit region's new-region mode (owner 2026-10-13: "first region generation
 * shouldn't be 'biome' select->generate, it should be the full suite …
 * preview + confirm"): the draft a new region is made from, its preview,
 * and Create. Nothing is written until Create, and Create makes exactly
 * what the preview showed (same seed, biome, blend, borders and neighbour
 * weight; tests/newRegionMode.test.ts).
 *
 * Entry points: an empty brick (Regions or Biomes view), Set biome… on an
 * empty hex, the hex menu's New region card, and walking into new land
 * (the region flower's "+", the hex editor's neighbour flower). The Biome
 * painter and arrival stay form-free.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import { biomeParts, isComboId, representativeTerrain, type BiomeId } from "./biomes";
import type { BlendWidth } from "./blendField";
import {
  hexBiomeAt,
  inOverworldGrid,
  planRegionAt,
  planRegionWithGenerator,
  setBiomeAt,
  walkFromBiome,
  walkIntoHex,
  walkLock,
  type RegionGenOptions,
  type RegionPlanOut,
} from "./regionsVault";
import { gridToInclude } from "./regionWorld";
import { clampNeighbourWeight, NEIGHBOUR_WEIGHT } from "./neighbourWeight";
import { ADD_REGION_LOCKED_HINT, canAdd } from "../workMode";

/** Walking into new land: where from, and which way ("south-east"). */
export interface NewRegionWalk {
  /** The region map you walk from. */
  from: string;
  bearing: string;
}

/** Everything a new region is made from; the modal edits it, the preview and Create read it. */
export interface NewRegionDraft {
  biome: BiomeId | undefined;
  seed: number;
  /** Blend width; unset: the biome's tuned falloff, else the overworld's. */
  blend?: BlendWidth;
  /** Border wiggle; unset: the biome's tuning. */
  warp?: number;
  /** Weight on the biome's neighbour influence (0–2; 1 = as tuned). */
  neighbourWeight: number;
  /** Typed name; blank: the hex's name, else one rolled, else coordinates. */
  name?: string;
}

/** A fresh seed for a draft (Reroll). */
export const newDraftSeed = (): number => Math.floor(Math.random() * 1e9);

/**
 * The biome a new region starts on: for a walk, the one you walk from
 * ("same as here"); else the hex's own overworld biome. Undefined when
 * neither has one (the first paintable biome is picked by the modal).
 */
export function startBiome(plugin: HexmakerPlugin, overworld: string, px: number, py: number, walk?: NewRegionWalk): BiomeId | undefined {
  return walk ? walkFromBiome(plugin, walk.from) : hexBiomeAt(plugin, overworld, `${px}_${py}`);
}

/** A draft for hex (px, py): its start biome, a seed, the default weight. */
export function newDraft(plugin: HexmakerPlugin, overworld: string, px: number, py: number, walk?: NewRegionWalk, seed = newDraftSeed()): NewRegionDraft {
  return { biome: startBiome(plugin, overworld, px, py, walk), seed, neighbourWeight: NEIGHBOUR_WEIGHT.default };
}

/** The mix parts a draft's biome starts the Mix panel with (a combined biome is already a mix). */
export function draftMix(draft: NewRegionDraft): { id: BiomeId; weight: number }[] | null {
  return draft.biome && isComboId(draft.biome) ? biomeParts(draft.biome) : null;
}

/** Will Create grow the overworld (a walk past its edge)? The grid it grows to, or null. */
export function draftGrowth(plugin: HexmakerPlugin, overworld: string, px: number, py: number): { offset: { x: number; y: number }; size: { cols: number; rows: number } } | null {
  const map = plugin.getMap(overworld);
  if (!map) return null;
  return gridToInclude(map.gridOffset, map.gridSize, px, py);
}

/** The generation options of a draft (the preview's and Create's: the same seed and settings). */
export function draftOptions(plugin: HexmakerPlugin, overworld: string, draft: NewRegionDraft): RegionGenOptions {
  const terrain = draft.biome ? representativeTerrain(draft.biome, plugin.getMapPalette(overworld)) : undefined;
  return {
    seed: draft.seed,
    ...(draft.biome ? { biome: draft.biome } : {}),
    ...(terrain ? { hexTerrain: terrain } : {}),
    ...(draft.blend ? { blend: draft.blend } : {}),
    ...(draft.warp !== undefined ? { warp: draft.warp } : {}),
    neighbourWeight: clampNeighbourWeight(draft.neighbourWeight),
  };
}

/**
 * The preview: the region the draft makes, against its made neighbours.
 * Writes nothing (a walk past the edge reads the overworld as grown).
 */
export async function previewDraft(plugin: HexmakerPlugin, overworld: string, px: number, py: number, draft: NewRegionDraft): Promise<RegionPlanOut | undefined> {
  if (!draft.biome) return undefined;
  const grow = draftGrowth(plugin, overworld, px, py);
  const opts: RegionGenOptions = { ...draftOptions(plugin, overworld, draft), ...(grow ? { previewGrid: grow } : {}) };
  try {
    return await planRegionWithGenerator(plugin, overworld, px, py, opts);
  } catch {
    // A generator that can't make it: the blend's preview (Create reports the generator's error).
    return planRegionAt(plugin, overworld, px, py, opts);
  }
}

/**
 * Why Create is locked right now, or undefined. New regions need Build or
 * God on the overworld (and, for a walk, on the map you walk from).
 */
export function draftLock(plugin: HexmakerPlugin, overworld: string, walk?: NewRegionWalk): string | undefined {
  if (walk) return walkLock(plugin, walk.from, overworld);
  return canAdd(plugin.getMap(overworld)) ? undefined : ADD_REGION_LOCKED_HINT;
}

/**
 * Create: make the region exactly as previewed. A walk grows the overworld
 * first when the hex lies past its edge (walkIntoHex). Returns the new
 * region's name (and whether the overworld grew), or an error.
 */
export async function createFromDraft(
  plugin: HexmakerPlugin,
  overworld: string,
  px: number,
  py: number,
  draft: NewRegionDraft,
  walk?: NewRegionWalk,
): Promise<{ name: string; grew: boolean } | { error: string }> {
  if (!draft.biome) return { error: "Pick a biome first." };
  const lock = draftLock(plugin, overworld, walk);
  if (lock) return { error: lock };
  // The hex is painted for real on Create (setBiomeAt), so no preview stand-in.
  const opts = draftOptions(plugin, overworld, draft);
  delete opts.hexTerrain;
  const name = draft.name?.trim() || undefined;
  if (walk) return walkIntoHex(plugin, overworld, px, py, draft.biome, { ...opts, ...(name ? { name } : {}), from: walk.from });
  const map = plugin.getMap(overworld);
  if (map && !inOverworldGrid(map, px, py)) return { error: "That hex is outside the overworld." };
  const res = await setBiomeAt(plugin, overworld, px, py, draft.biome, { ...opts, ...(name ? { name } : {}) });
  return "error" in res ? res : { name: res.name, grew: false };
}

/**
 * The biome page's edits to a biome's note fields, as pure functions (the
 * page, BiomePanel, calls them on its working copy and autosaves), and the
 * sample region its preview draws.
 */

import type { TerrainColor } from "../../types";
import { cleanTuning, clampTuning, isDefaultValue, type BiomeNoteFields, type TuningParam } from "../biomeNote";
import { withinTypeWeights, OPEN_SEA, profileFromFields, type BiomeId } from "../biomes";
import { percentsToWeights } from "../../ui/shares";
import { profilesForPalette } from "../regionsVault";
import { paletteTypeOf, planRegion } from "../regionWorld";
import { neighbourRegions, type RegionLayout } from "../layout";

/** What the preview puts around the sample region. */
export type PreviewSurround = "same" | "land-west";

/** The note fields the page edits (everything but the id). */
export function biomePagePatch(f: BiomeNoteFields): Partial<Omit<BiomeNoteFields, "id">> {
  return {
    label: f.label,
    color: f.color,
    generator: f.generator,
    blank: f.blank ? true : undefined,
    climate: f.climate,
    terrainWeights: f.terrainWeights?.length ? f.terrainWeights.map((w) => ({ ...w })) : undefined,
    mix: f.mix.map((r) => ({ ...r })),
    transitions: f.transitions.map((t) => ({ ...t })),
    blend: f.blend,
    landShare: f.landShare,
    minIslands: f.minIslands,
    shore: f.shore ? true : undefined,
    tuning: cleanTuning(f.tuning),
  };
}

/** Set (or, at its default, clear) one tuning value on the page's fields. Pure. */
export function setTuningValue(f: BiomeNoteFields, p: TuningParam, value: number | null): void {
  const next = { ...f.tuning };
  if (value === null || !Number.isFinite(value)) delete next[p.key];
  else {
    const v = clampTuning(p, value);
    if (isDefaultValue(p, v)) delete next[p.key];
    else next[p.key] = v;
  }
  if (Object.keys(next).length) f.tuning = next;
  else delete f.tuning;
}

/** Set a type's weight (0 drops it from the mix) or min patches (undefined clears it). Pure. */
export function setMixRow(f: BiomeNoteFields, type: string, change: { weight?: number; minPatches?: number | null }): void {
  let row = f.mix.find((r) => r.type === type);
  if (change.weight !== undefined) {
    const w = Math.max(0, Number.isFinite(change.weight) ? change.weight : 0);
    if (w === 0) { f.mix = f.mix.filter((r) => r.type !== type); return; }
    if (row) row.weight = w;
    else { row = { type, weight: w }; f.mix.push(row); }
  }
  if (change.minPatches !== undefined && row) {
    if (change.minPatches === null || !(change.minPatches > 0)) delete row.minPatches;
    else row.minPatches = Math.round(change.minPatches);
  }
}

/**
 * The weight a type added to the mix starts with (O6's "+ Add type"): the
 * mean of the weights already in, so it gets an equal share; 1 for an
 * empty mix. Pure.
 */
export function addedMixWeight(mix: readonly { weight: number }[]): number {
  const ws = mix.map((r) => r.weight).filter((w) => Number.isFinite(w) && w > 0);
  if (!ws.length) return 1;
  return Math.max(1, Math.round(ws.reduce((a, b) => a + b, 0) / ws.length));
}

/**
 * The type mix from the share sliders: whole percentages (adding up to
 * 100) as each type's weight; 0% drops the type. A type's min patches
 * survive it dipping to 0% mid-drag (`kept`). Pure.
 */
export function setMixShares(f: BiomeNoteFields, types: readonly string[], percents: readonly number[], kept: ReadonlyMap<string, number> = new Map()): void {
  types.forEach((type, i) => {
    setMixRow(f, type, { weight: percents[i] ?? 0 });
    const row = f.mix.find((r) => r.type === type);
    if (row && row.minPatches === undefined && kept.has(type)) row.minPatches = kept.get(type);
  });
}

/**
 * One type's terrain weights from its share sliders (`names`: the
 * palette's terrains of that type): stored as small whole weights that read
 * back as the same percentages, a terrain at 1 left out (1 is the default);
 * an even split stores nothing. Other types' weights are kept. Pure.
 */
export function setTypeTerrainWeights(f: BiomeNoteFields, names: readonly string[], percents: readonly number[]): void {
  const mine = new Set(names.map((n) => n.trim().toLowerCase()));
  const rest = (f.terrainWeights ?? []).filter((w) => !mine.has(w.terrain.trim().toLowerCase()));
  const weights = percentsToWeights(percents);
  const even = weights.every((w) => w === weights[0]);
  const own = even ? [] : names.map((terrain, i) => ({ terrain, weight: weights[i] })).filter((w) => w.weight !== 1);
  const all = [...rest, ...own];
  if (all.length) f.terrainWeights = all;
  else delete f.terrainWeights;
}

/** Each terrain's share of its type (fractions, for the sliders). */
export function typeTerrainShares(f: Pick<BiomeNoteFields, "terrainWeights">, names: readonly string[]): number[] {
  const within = withinTypeWeights(names, f.terrainWeights);
  return names.map((n) => within.get(n) ?? 0);
}

/**
 * A sample region of a biome on a palette: the region of hex (0, 0) with
 * its neighbours the same biome, or (`land-west`) land biomes on its
 * west, open sea on its east and the biome itself north and south (to see
 * a shore biome turn its land toward the land).
 */
export function biomeSamplePlan(
  layout: RegionLayout,
  palette: TerrainColor[],
  fields: BiomeNoteFields,
  seed: number,
  surround: PreviewSurround,
  landBiome: BiomeId,
  others = profilesForPalette(palette),
) {
  const biomes = new Map<string, BiomeId>([["0_0", fields.id]]);
  for (const [x, y] of neighbourRegions(layout, 0, 0)) {
    // West of it land, east of it sea, north and south more of the biome.
    biomes.set(`${x}_${y}`, surround === "same" || x === 0 ? fields.id : x < 0 ? landBiome : OPEN_SEA);
  }
  const profiles = new Map(others);
  profiles.set(fields.id, profileFromFields(fields, palette));
  return planRegion({
    layout,
    parent: [0, 0],
    biomes,
    profiles,
    typeOf: paletteTypeOf(palette),
    worldSeed: seed,
    seed,
    // A tuned falloff is a finer Blend width.
    blend: fields.tuning?.["blend-k"] ?? fields.blend,
  });
}

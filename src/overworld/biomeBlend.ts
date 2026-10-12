/**
 * "Blend into <biome>" without a generator (owner request 2026-10-12: fold
 * a hand-edited map back into the biome it was made from). The map's
 * measured stats are mixed into the biome's own settings at a weight
 * (25% this map / 75% the biome by default):
 *
 * - Mix: each type's share, (1 − w) · biome + w · map, written back on the
 *   biome's own weight scale. Rows keep their order and their Min patches.
 * - Terrain weights: within each type the map uses, how its terrains split,
 *   blended the same way (only types with more than one terrain).
 * - land-share: when the biome sets one, blended with the map's land share.
 * - Tuning: smoothing passes, fitted by generating sample regions at each
 *   pass count and taking the one whose neighbour agreement is closest to
 *   the map's, then blended (rounded) with the biome's.
 *
 * Min islands, transitions, climate and shore are left as they are (one
 * map says little about them).
 *
 * Pure: no Obsidian imports.
 */

import { hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import type { TerrainColor } from "../types";
import { mixShares, type BiomeMixRow, type BiomeNoteFields, type BiomeTerrainWeight } from "./biomeNote";
import { blendTuning, tuned, TUNING_PARAMS } from "./biomeTuning";
import { profileFromFields, WATER_TYPES, withinTypeWeights } from "./biomes";
import { neighbourRegions, type RegionLayout } from "./layout";
import { interiorAgreement } from "./regionGen";
import { paletteTypeOf, planRegion } from "./regionWorld";

/** What a map shows: hexes per terrain, its land share and how often neighbours share a type. */
export interface MapStats {
  counts: Map<string, number>;
  /** Share of typed hexes that are land (not a water type). */
  land?: number;
  /** Share of neighbouring typed hex pairs with the same type (0–1). */
  agreement?: number;
}

/** Measure a map's painted terrain ("x_y" → terrain). */
export function measureMap(cells: ReadonlyMap<string, string>, palette: readonly TerrainColor[], orientation: Orientation, stagger: Stagger): MapStats {
  const typeOf = new Map(palette.map((t) => [t.name, t.type]));
  const counts = new Map<string, number>();
  let typed = 0, land = 0, pairs = 0, same = 0;
  const water = new Set(WATER_TYPES);
  for (const [k, t] of cells) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
    const ty = typeOf.get(t);
    if (!ty || ty === "settlement") continue;
    typed++;
    if (!water.has(ty)) land++;
    const [x, y] = k.split("_").map(Number);
    for (const [a, b] of hexNeighbors(x, y, orientation, stagger)) {
      const nk = `${a}_${b}`;
      if (nk <= k) continue;
      const nt = cells.get(nk);
      const nty = nt ? typeOf.get(nt) : undefined;
      if (!nty || nty === "settlement") continue;
      pairs++;
      if (nty === ty) same++;
    }
  }
  return { counts, ...(typed ? { land: land / typed } : {}), ...(pairs ? { agreement: same / pairs } : {}) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The map's type shares (settlements and untyped terrains left out). */
function mapTypeShares(counts: ReadonlyMap<string, number>, palette: readonly TerrainColor[]): Map<string, number> {
  const typeOf = new Map(palette.map((t) => [t.name, t.type]));
  const out = new Map<string, number>();
  let total = 0;
  for (const [t, n] of counts) {
    const ty = typeOf.get(t);
    if (!ty || ty === "settlement" || n <= 0) continue;
    out.set(ty, (out.get(ty) ?? 0) + n);
    total += n;
  }
  if (total > 0) for (const [k, v] of out) out.set(k, v / total);
  return out;
}

/** Blend a mix with a map's type shares at weight `w` (of the map), on the mix's own weight scale. */
export function blendMix(mix: readonly BiomeMixRow[], counts: ReadonlyMap<string, number>, palette: readonly TerrainColor[], w: number): BiomeMixRow[] {
  const old = mixShares([...mix]);
  const map = mapTypeShares(counts, palette);
  if (!map.size) return mix.map((r) => ({ ...r }));
  const scale = mix.reduce((s, r) => s + Math.max(0, r.weight), 0) || 100;
  const share = (ty: string) => (1 - w) * (old.get(ty) ?? 0) + w * (map.get(ty) ?? 0);
  const out: BiomeMixRow[] = [];
  for (const r of mix) {
    const weight = r1(share(r.type) * scale);
    // A row with Min patches stays, however small it gets.
    if (weight <= 0 && r.minPatches === undefined) continue;
    out.push({ ...r, weight: Math.max(weight, 0.1) });
  }
  const added = [...map.keys()].filter((ty) => !mix.some((r) => r.type === ty)).map((ty) => ({ type: ty, weight: r1(share(ty) * scale) }));
  for (const r of added.sort((a, b) => b.weight - a.weight || (a.type < b.type ? -1 : 1))) if (r.weight > 0) out.push(r);
  return out;
}

/**
 * Blend Terrain weights with how the map splits each type between its
 * terrains (types the map uses with more than one palette terrain). Rows
 * for other terrains are kept as they were.
 */
export function blendTerrainWeights(current: readonly BiomeTerrainWeight[] | undefined, counts: ReadonlyMap<string, number>, palette: readonly TerrainColor[], w: number): BiomeTerrainWeight[] | undefined {
  const byType = new Map<string, string[]>();
  for (const t of palette) if (t.type && t.type !== "settlement") byType.set(t.type, [...(byType.get(t.type) ?? []), t.name]);
  const rows = new Map((current ?? []).map((r) => [r.terrain.toLowerCase(), { ...r }]));
  for (const [, names] of byType) {
    if (names.length < 2) continue;
    const total = names.reduce((s, n) => s + (counts.get(n) ?? 0), 0);
    if (total <= 0) continue;
    const old = withinTypeWeights(names, current);
    for (const n of names) {
      const v = (1 - w) * (old.get(n) ?? 0) + w * ((counts.get(n) ?? 0) / total);
      rows.set(n.toLowerCase(), { terrain: n, weight: r1(v * 10) });
    }
  }
  const out = [...rows.values()];
  return out.length ? out : undefined;
}

/**
 * The smoothing pass count whose sample regions' neighbour agreement is
 * closest to `agreement` (seeded, so the same inputs give the same answer).
 */
export function fitSmoothing(fields: BiomeNoteFields, palette: TerrainColor[], layout: RegionLayout, agreement: number, seeds: readonly number[] = [11, 23, 37]): number {
  const p = TUNING_PARAMS.find((x) => x.key === "smoothing")!;
  const current = tuned(fields.tuning, "smoothing");
  let best = current, bestErr = Infinity;
  for (let s = p.min; s <= p.max; s++) {
    const profile = profileFromFields({ ...fields, tuning: { ...fields.tuning, smoothing: s } }, palette);
    if (!profile.types.size) return current;
    const biomes = new Map<string, string>([["0_0", fields.id]]);
    for (const [x, y] of neighbourRegions(layout, 0, 0)) biomes.set(`${x}_${y}`, fields.id);
    let sum = 0;
    for (const seed of seeds) {
      const plan = planRegion({ layout, parent: [0, 0], biomes, profiles: new Map([[fields.id, profile]]), typeOf: paletteTypeOf(palette), worldSeed: seed, seed });
      sum += interiorAgreement(layout, plan.cells, paletteTypeOf(palette));
    }
    const err = Math.abs(sum / seeds.length - agreement);
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && Math.abs(s - current) < Math.abs(best - current))) { bestErr = err; best = s; }
  }
  return best;
}

/** The note fields a blend writes (Mix, Terrain weights, land-share, Tuning). */
export function blendBiomeFields(
  fields: BiomeNoteFields,
  stats: MapStats,
  palette: TerrainColor[],
  w: number,
  sample?: RegionLayout,
): Pick<BiomeNoteFields, "mix" | "terrainWeights" | "landShare" | "tuning"> {
  const weight = Math.min(1, Math.max(0, w));
  const out: Pick<BiomeNoteFields, "mix" | "terrainWeights" | "landShare" | "tuning"> = {
    mix: blendMix(fields.mix, stats.counts, palette, weight),
    terrainWeights: blendTerrainWeights(fields.terrainWeights, stats.counts, palette, weight),
    landShare: fields.landShare,
    tuning: fields.tuning,
  };
  if (fields.landShare !== undefined && stats.land !== undefined) out.landShare = Math.round(((1 - weight) * fields.landShare + weight * stats.land) * 100) / 100;
  if (sample && stats.agreement !== undefined && weight > 0) {
    const fit = fitSmoothing({ ...fields, mix: out.mix }, palette, sample, stats.agreement);
    out.tuning = blendTuning(fields.tuning, { ...fields.tuning, smoothing: fit }, weight);
  }
  return out;
}

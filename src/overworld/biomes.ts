/**
 * Biomes for overworlds and regions (plan-overworld-regions §4.1).
 *
 * An overworld hex's terrain IS its biome signal: `biomeForTerrain` reads
 * it back, and the World biomes generator paints each hex with its biome's
 * representative terrain, so the two round-trip on any palette whose
 * terrains have types. Each land biome is one of the shipped generators
 * (src/worldgen/builtin); "open-sea" is the one extra, for sea hexes with
 * no islands.
 *
 * Pure: no Obsidian imports.
 */

import type { HexWfcModel, TerrainEntry } from "../../packages/hex-wfc/src/model";
import { mapTerrainsByType, TYPE_FALLBACKS } from "../worldgen/builtinGenerators";
import { biomeSlug, mixShares, type BiomeMixRow, type BiomeNoteFields, type BiomeTerrainWeight } from "./biomeNote";
import type { TerrainColor } from "../types";
import { typesInGroup } from "../terrainTypes";
import { climateCentre, isPlaceable, type BiomeClimate, type ClimateElevation, type ClimateRange } from "./biomeClimate";

export type BiomeId = string;
export const OPEN_SEA = "open-sea";

export interface BiomeInfo {
  id: BiomeId;
  label: string;
  /** Shipped generator slug (src/worldgen/builtin/<slug>.md); none for open sea. */
  slug?: string;
  /** Ideal climate, 0..1 (cold → hot, dry → wet). */
  temp: number;
  moist: number;
  /** Lives on: "sea", "low" (lowland), "high" (hills), "peak". */
  zone: "sea" | "low" | "high" | "peak";
  /** Rare biomes: at most one per ~20 overworld hexes. */
  rare?: boolean;
  /**
   * Watery biomes: the share of land (0..1) a region of this biome gets as
   * islands, counting land already there (regionGen placeIslands).
   * Unset: no land is added beyond `minIslands`.
   */
  landShare?: number;
  /** Fewest islands (separate land patches inside the region) a region of this biome gets. */
  minIslands?: number;
}

/**
 * Terrain types that are water, for islands (landShare / minIslands): the
 * terrain types data's water group, so a new water type counts without a
 * code change. Every other type is land, except settlements. Never names.
 */
export const WATER_TYPES: readonly string[] = typesInGroup("water");
/**
 * Rings round a placed island, inner first: a ring is painted only when the
 * biome's generator has that type on the palette.
 */
export const SHORE_TYPES: readonly string[] = ["coast", "shallows"];

export const BIOMES: BiomeInfo[] = [
  { id: "tundra", label: "Tundra", slug: "biome-tundra", temp: 0.08, moist: 0.4, zone: "low" },
  { id: "taiga", label: "Taiga", slug: "biome-taiga", temp: 0.28, moist: 0.55, zone: "low" },
  { id: "temperate-forest", label: "Temperate forest", slug: "biome-temperate-forest", temp: 0.5, moist: 0.6, zone: "low" },
  { id: "deep-forest", label: "Deep forest", slug: "preset-deep-forest", temp: 0.45, moist: 0.8, zone: "low" },
  { id: "grassland", label: "Grassland", slug: "biome-grassland", temp: 0.52, moist: 0.3, zone: "low" },
  { id: "savanna", label: "Savanna", slug: "biome-savanna", temp: 0.78, moist: 0.35, zone: "low" },
  { id: "jungle", label: "Jungle", slug: "biome-jungle", temp: 0.85, moist: 0.8, zone: "low" },
  { id: "badlands", label: "Badlands", slug: "biome-badlands", temp: 0.8, moist: 0.08, zone: "low" },
  { id: "swamp", label: "Swamp", slug: "biome-swamp", temp: 0.6, moist: 0.92, zone: "low" },
  { id: "river-delta", label: "River delta", slug: "biome-river-delta", temp: 0.6, moist: 0.85, zone: "low", rare: true },
  { id: "valley", label: "Valley", slug: "preset-valley", temp: 0.45, moist: 0.5, zone: "high" },
  { id: "karst", label: "Karst", slug: "biome-karst", temp: 0.75, moist: 0.75, zone: "high", rare: true },
  { id: "alpine", label: "Alpine", slug: "biome-alpine", temp: 0.2, moist: 0.5, zone: "peak" },
  { id: "volcanic", label: "Volcanic", slug: "preset-volcanic", temp: 0.7, moist: 0.3, zone: "peak", rare: true },
  { id: "coastal-fjord", label: "Coastal fjord", slug: "biome-coastal-fjord", temp: 0.2, moist: 0.7, zone: "low" },
  { id: "archipelago", label: "Archipelago", slug: "preset-archipelago", temp: 0.6, moist: 0.7, zone: "sea", landShare: 0.3, minIslands: 2 },
  { id: OPEN_SEA, label: "Open sea", temp: 0.5, moist: 1, zone: "sea" },
];

const BY_ID = new Map(BIOMES.map((b) => [b.id, b]));
export const biomeInfo = (id: BiomeId): BiomeInfo | undefined => noteBiomeInfo(id) ?? BY_ID.get(id);
export const isSeaBiome = (id: BiomeId): boolean => biomeInfo(id)?.zone === "sea";

/** How badly (T, M) suits a biome: 0 = its ideal climate. */
export function climateMisfit(id: BiomeId, temp: number, moist: number): number {
  const b = BY_ID.get(id);
  return b ? Math.hypot(b.temp - temp, b.moist - moist) : 1;
}

/** Biome slug → its generator id in the registry. */
export function biomeGeneratorId(id: BiomeId): string | undefined {
  const s = BY_ID.get(id)?.slug;
  return s ? `builtin:${s}` : undefined;
}

// ── terrain ↔ biome ──────────────────────────────────────────────────────

/**
 * Terrain type → the biomes it stands for (§4.1): the main biome first,
 * then variants that share the type. Types only: a terrain's name is never
 * read (the owner's rule: the Type column drives type-based behaviour).
 */
const TYPE_BIOMES: Record<string, BiomeId[]> = {
  forest: ["temperate-forest", "taiga", "deep-forest"],
  jungle: ["jungle"],
  snow: ["tundra"],
  peaks: ["alpine"],
  mountains: ["alpine"],
  hills: ["valley", "karst"],
  grassland: ["grassland", "savanna"],
  desert: ["badlands"],
  badlands: ["badlands"],
  wetland: ["swamp", "river-delta"],
  water: [OPEN_SEA],
  "deep-water": [OPEN_SEA],
  shallows: ["archipelago"],
  coast: ["coastal-fjord"],
  volcanic: ["volcanic"],
};

/** The types a biome is painted with, best first (alpine: peaks, else mountains). */
const BIOME_TYPES: Record<BiomeId, string[]> = {
  alpine: ["peaks", "mountains"],
  badlands: ["badlands", "desert"],
  [OPEN_SEA]: ["water", "deep-water"],
};

const typeOf = (t: TerrainColor): string | undefined => t.type;

/**
 * Which biome each palette terrain stands for, by type and palette order:
 * among the terrains of one type, the LAST ones stand for the type's
 * variant biomes (in TYPE_BIOMES order) and the rest, the first one
 * included, for its main biome. So on Expanded, the last wetland terrain
 * ("river delta") is the river delta and the others are swamp; reorder the
 * palette to choose. A variant with no terrain left over (a type with one
 * terrain) can't be shown; resolveBiome then picks a similar biome.
 */
function terrainBiomes(palette: TerrainColor[]): Map<string, BiomeId> {
  const byType = new Map<string, TerrainColor[]>();
  for (const t of palette) {
    const ty = typeOf(t);
    if (!ty || !TYPE_BIOMES[ty]) continue;
    byType.set(ty, [...(byType.get(ty) ?? []), t]);
  }
  const out = new Map<string, BiomeId>();
  for (const [ty, terrains] of byType) {
    const [main, ...variants] = TYPE_BIOMES[ty];
    // Variants take the last terrains, never the first (it's the main biome's).
    const k = Math.min(variants.length, terrains.length - 1);
    const firstVariant = terrains.length - k;
    terrains.forEach((t, i) => out.set(t.name, i >= firstVariant ? variants[i - firstVariant] : main));
  }
  return out;
}

const cache = new WeakMap<TerrainColor[], { key: string; map: Map<string, BiomeId> }>();
function biomesOf(palette: TerrainColor[]): Map<string, BiomeId> {
  const key = palette.map((t) => `${t.name}\u0000${t.type ?? ""}`).join("\u0001");
  const hit = cache.get(palette);
  if (hit && hit.key === key) return hit.map;
  const map = terrainBiomes(palette);
  cache.set(palette, { key, map });
  return map;
}

/**
 * The biome a terrain stands for, or undefined (no type, settlements,
 * space terrains, terrains not in the palette). See terrainBiomes.
 */
export function biomeForTerrain(terrain: string, palette: TerrainColor[]): BiomeId | undefined {
  return biomesOf(palette).get(terrain);
}

/**
 * The palette terrain painted for a biome, or undefined if none stands for
 * it: the first terrain (palette order) that reads back as the biome, from
 * the biome's preferred type first.
 */
export function representativeTerrain(biome: BiomeId, palette: TerrainColor[]): string | undefined {
  if (!BY_ID.has(biome)) return noteBiomeTerrain(biome, palette);
  const map = biomesOf(palette);
  const cands = palette.filter((t) => map.get(t.name) === biome);
  if (!cands.length) return undefined;
  for (const ty of BIOME_TYPES[biome] ?? []) {
    const hit = cands.find((t) => typeOf(t) === ty);
    if (hit) return hit.name;
  }
  return cands[0].name;
}

/** Biomes a palette can show (each has a terrain that reads back as it). */
export function representableBiomes(palette: TerrainColor[]): Set<BiomeId> {
  return new Set(allBiomeIds().filter((id) => representativeTerrain(id, palette) !== undefined));
}

/** Nearest biomes in character, best first: used to swap a biome for variety or when a palette can't show it. */
export const SIMILAR: Record<BiomeId, BiomeId[]> = {
  tundra: ["taiga", "coastal-fjord", "alpine"],
  taiga: ["tundra", "temperate-forest", "deep-forest"],
  "temperate-forest": ["deep-forest", "grassland", "valley", "taiga"],
  "deep-forest": ["temperate-forest", "taiga", "swamp"],
  grassland: ["temperate-forest", "savanna", "valley"],
  savanna: ["grassland", "badlands", "jungle"],
  jungle: ["savanna", "swamp", "karst", "temperate-forest"],
  badlands: ["savanna", "grassland"],
  swamp: ["temperate-forest", "deep-forest", "river-delta", "grassland"],
  "river-delta": ["swamp", "grassland"],
  valley: ["grassland", "alpine", "temperate-forest"],
  karst: ["jungle", "valley", "grassland"],
  alpine: ["valley", "tundra", "grassland"],
  volcanic: ["alpine", "badlands", "valley"],
  "coastal-fjord": ["tundra", "taiga", "alpine"],
  archipelago: [OPEN_SEA],
  [OPEN_SEA]: ["archipelago"],
};

/** A biome the palette can show: itself, else the nearest similar one (breadth-first). */
export function resolveBiome(biome: BiomeId, shown: Set<BiomeId>): BiomeId | undefined {
  const seen = new Set<BiomeId>([biome]);
  const queue = [biome];
  while (queue.length) {
    const b = queue.shift()!;
    if (shown.has(b)) return b;
    for (const s of SIMILAR[b] ?? []) if (!seen.has(s)) { seen.add(s); queue.push(s); }
  }
  return undefined;
}

// ── compatibility and ecotones ───────────────────────────────────────────

/** Biome pairs that shouldn't touch, and the transition biome put between them (§4.4 step 6). */
export const ECOTONES: [BiomeId, BiomeId, BiomeId][] = [
  ["tundra", "temperate-forest", "taiga"],
  ["tundra", "deep-forest", "taiga"],
  ["tundra", "grassland", "taiga"],
  ["tundra", "jungle", "grassland"],
  ["tundra", "savanna", "grassland"],
  ["tundra", "badlands", "grassland"],
  ["jungle", "badlands", "savanna"],
  ["grassland", "alpine", "valley"],
  ["savanna", "alpine", "valley"],
  ["alpine", "jungle", "karst"],
  ["swamp", "badlands", "grassland"],
  ["swamp", "alpine", "valley"],
  ["taiga", "jungle", "temperate-forest"],
  ["taiga", "badlands", "grassland"],
];

/** The ecotone between two biomes, or undefined when they may touch. */
export function ecotoneBetween(a: BiomeId, b: BiomeId): BiomeId | undefined {
  for (const [x, y, e] of source ? source.ecotones : ECOTONES) if ((x === a && y === b) || (x === b && y === a)) return e;
  return undefined;
}

export const compatible = (a: BiomeId, b: BiomeId): boolean => ecotoneBetween(a, b) === undefined;

// ── profiles for region generation ───────────────────────────────────────

/**
 * A biome's terrain mix on one palette, split "type first": `types` is the
 * share of each terrain type, `names[type]` the share of each palette
 * terrain within that type. Both sum to 1.
 */
export interface BiomeProfile {
  id: BiomeId;
  types: Map<string, number>;
  names: Map<string, Map<string, number>>;
  /** BiomeInfo.landShare / minIslands, carried for region generation. */
  landShare?: number;
  minIslands?: number;
  /** Type → fewest separate patches of it a region gets (the note's Min patches). */
  minPatches?: Map<string, number>;
  /** Land toward land-heavy neighbours, water toward the rest (the note's `shore`). */
  shore?: boolean;
}

/** Open sea has no shipped generator: deep water with a rim of ocean. */
const OPEN_SEA_TERRAINS: { name: string; weight: number }[] = [
  { name: "ocean", weight: 80 },
  { name: "trench", weight: 20 },
];

/**
 * Profile from a generator's terrain weights, fitted to `palette` by type
 * (the same mapping the built-in generators use). Settlements are dropped:
 * a town scattered at random is noise.
 */
export function profileFromWeights(id: BiomeId, terrains: { name: string; weight: number }[], palette: TerrainColor[]): BiomeProfile {
  // mapTerrainsByType only reads `terrains`.
  const entries: TerrainEntry[] = terrains.map((t) => ({ name: t.name, weight: t.weight }));
  const mapping = mapTerrainsByType({ terrains: entries } as HexWfcModel, palette);
  const byName = new Map(palette.map((t) => [t.name, t]));
  const weights = new Map<string, number>();
  for (const t of terrains) {
    const to = mapping.get(t.name);
    if (!to || t.weight <= 0) continue;
    weights.set(to, (weights.get(to) ?? 0) + t.weight);
  }
  const types = new Map<string, number>();
  const names = new Map<string, Map<string, number>>();
  let total = 0;
  for (const [name, w] of weights) {
    const entry = byName.get(name);
    const type = entry ? typeOf(entry) : undefined;
    if (!type || type === "settlement") continue;
    types.set(type, (types.get(type) ?? 0) + w);
    if (!names.has(type)) names.set(type, new Map());
    names.get(type)!.set(name, w);
    total += w;
  }
  if (total > 0) {
    for (const [type, w] of types) {
      types.set(type, w / total);
      const inner = names.get(type)!;
      for (const [n, v] of inner) inner.set(n, v / w);
    }
  }
  return { id, types, names };
}

/**
 * Profiles for every biome the palette can show. `models` holds the shipped
 * generators by slug (builtinModel(slug) in the plugin; read from disk in
 * tests, where .md imports are stubbed).
 */
export function biomeProfiles(models: Map<string, HexWfcModel | undefined>, palette: TerrainColor[]): Map<BiomeId, BiomeProfile> {
  const out = new Map<BiomeId, BiomeProfile>();
  for (const b of BIOMES) {
    const terrains = b.id === OPEN_SEA ? OPEN_SEA_TERRAINS : b.slug ? models.get(b.slug)?.terrains : undefined;
    if (!terrains) continue;
    const p = profileFromWeights(b.id, terrains, palette);
    if (b.landShare !== undefined) p.landShare = b.landShare;
    if (b.minIslands !== undefined) p.minIslands = b.minIslands;
    if (p.types.size) out.set(b.id, p);
  }
  return out;
}

// ── biomes from notes (#50): the data-loading seam ───────────────────────
//
// BiomeStore loads the biome notes (<worldFolder>/biomes, the built-ins
// seeded into notes once) and hands them here. With a source set: labels,
// transitions (ecotones) and the biome list come from the notes, and
// biomes that aren't in the table above (the user's own) are looked up in
// it. Without one (tests, before the notes load) everything reads the
// table above, as before.

interface BiomeSource {
  biomes: Map<BiomeId, BiomeNoteFields>;
  infos: Map<BiomeId, BiomeInfo>;
  ecotones: [BiomeId, BiomeId, BiomeId][];
  /** id, label or note name (slugged) → id. */
  names: Map<string, BiomeId>;
}

let source: BiomeSource | undefined;
let sourceVersion = 0;

/** Bumped on every setBiomeSource (for cache keys). */
export const biomeSourceVersion = (): number => sourceVersion;

/** The overworld zone a climate's elevation stands for (unset: lowland). */
export function zoneOfElevation(e: ClimateElevation | undefined): BiomeInfo["zone"] {
  return e === "sea" ? "sea" : e === "high" ? "peak" : e === "mid" ? "high" : "low";
}

/**
 * A biome's ideal climate (T, M) for the generator's repairs: the shipped
 * table's tuned value when the climate box still holds it, else the box's
 * middle. Data only: a user's biome always gets its box's middle.
 */
export function climateIdeal(id: BiomeId, c: BiomeClimate): [number, number] {
  const base = BY_ID.get(id);
  const holds = (r: ClimateRange | undefined, v: number) => !r || (v >= r.lo - 1e-9 && v <= r.hi + 1e-9);
  if (base && holds(c.temperature, base.temp) && holds(c.moisture, base.moist)) return [base.temp, base.moist];
  return climateCentre(c);
}

/** Load (or, with undefined, drop) the biomes read from notes. */
export function setBiomeSource(list: readonly BiomeNoteFields[] | undefined): void {
  sourceVersion++;
  if (!list) { source = undefined; return; }
  const biomes = new Map<BiomeId, BiomeNoteFields>();
  const names = new Map<string, BiomeId>();
  for (const b of list) if (!biomes.has(b.id)) biomes.set(b.id, b);
  for (const b of biomes.values()) names.set(b.id, b.id);
  for (const b of biomes.values()) { const k = biomeSlug(b.label); if (k && !names.has(k)) names.set(k, b.id); }
  const infos = new Map<BiomeId, BiomeInfo>();
  for (const b of biomes.values()) {
    const base = BY_ID.get(b.id);
    const info: BiomeInfo = base ? { ...base, label: b.label }
      : { id: b.id, label: b.label, temp: 0.5, moist: 0.5, zone: b.landShare !== undefined && b.landShare < 0.5 ? "sea" : "low" };
    // The note says the islands (land-share / min-islands); unset there = unset.
    delete info.landShare;
    delete info.minIslands;
    if (b.landShare !== undefined) info.landShare = b.landShare;
    if (b.minIslands !== undefined) info.minIslands = b.minIslands;
    // The note's climate (when set) says its zone, rarity and ideal climate.
    if (isPlaceable(b.climate)) {
      const c = b.climate!;
      info.zone = zoneOfElevation(c.elevation);
      if (c.rare) info.rare = true;
      else delete info.rare;
      [info.temp, info.moist] = climateIdeal(b.id, c);
    }
    infos.set(b.id, info);
  }
  const ecotones: [BiomeId, BiomeId, BiomeId][] = [];
  const resolve = (n: string) => names.get(biomeSlug(n));
  for (const b of biomes.values()) {
    for (const t of b.transitions) {
      const next = resolve(t.next), between = resolve(t.between);
      if (next && between && next !== b.id) ecotones.push([b.id, next, between]);
    }
  }
  source = { biomes, infos, ecotones, names };
}

/** Whether biomes come from notes now. */
export const biomeSourceActive = (): boolean => !!source;

/** Every biome id: the notes' (with a source), else the table's. */
export function allBiomeIds(): BiomeId[] {
  return source ? [...source.biomes.keys()] : BIOMES.map((b) => b.id);
}

/** A biome's note fields (with a source). */
export const biomeNoteOf = (id: BiomeId): BiomeNoteFields | undefined => source?.biomes.get(id);

/** The biome a reference names (its id, label or note name), when it's a known biome note. */
export function biomeByRef(ref: string | undefined): BiomeId | undefined {
  return ref && source ? source.names.get(biomeSlug(ref)) : undefined;
}

function noteBiomeInfo(id: BiomeId): BiomeInfo | undefined {
  return source?.infos.get(id);
}

/** A note biome's terrain types, heaviest first, then each one's fallbacks. */
function typesToTry(mix: BiomeMixRow[]): string[] {
  const own = [...mix].sort((a, b) => b.weight - a.weight).map((r) => r.type);
  return [...own, ...own.flatMap((t) => TYPE_FALLBACKS[t] ?? [])];
}

/**
 * The palette terrain painted for a note-only biome: of its heaviest type
 * the palette has, the terrain with the most weight in its Terrain weights
 * (palette order on a tie; the first one without the table).
 */
function noteBiomeTerrain(biome: BiomeId, palette: TerrainColor[]): string | undefined {
  const n = source?.biomes.get(biome);
  if (!n) return undefined;
  for (const ty of typesToTry(n.mix)) {
    if (ty === "settlement") continue;
    const of = palette.filter((t) => typeOf(t) === ty).map((t) => t.name);
    if (!of.length) continue;
    const w = withinTypeWeights(of, n.terrainWeights);
    let best = of[0];
    for (const name of of) if ((w.get(name) ?? 0) > (w.get(best) ?? 0)) best = name;
    return best;
  }
  return undefined;
}

/**
 * How one type's share splits over its palette terrains (`names`), as
 * fractions summing to 1: a terrain listed in `weights` (any case) gets its
 * weight, the others 1; weight 0 leaves a terrain out. All left out (or no
 * weights): an even split, so a type in the mix is never lost.
 */
export function withinTypeWeights(names: readonly string[], weights: readonly BiomeTerrainWeight[] | undefined): Map<string, number> {
  const byName = new Map((weights ?? []).map((w) => [w.terrain.trim().toLowerCase(), w.weight]));
  const raw = names.map((n) => [n, Math.max(0, byName.get(n.toLowerCase()) ?? 1)] as const);
  const total = raw.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return new Map(names.map((n) => [n, 1 / names.length]));
  return new Map(raw.filter(([, v]) => v > 0).map(([n, v]) => [n, v / total]));
}

/**
 * Profile from a type mix (a biome note's): each type's share, split over
 * the palette's terrains of that type by `terrainWeights` (the note's
 * Terrain weights; evenly without them, see withinTypeWeights). A type the palette
 * doesn't have goes to its first fallback type it does (TYPE_FALLBACKS),
 * else is dropped. Settlements never count.
 */
export function profileFromMix(id: BiomeId, mix: BiomeMixRow[], palette: TerrainColor[], terrainWeights?: readonly BiomeTerrainWeight[]): BiomeProfile {
  const byType = new Map<string, string[]>();
  for (const t of palette) {
    const ty = typeOf(t);
    if (!ty || ty === "settlement") continue;
    byType.set(ty, [...(byType.get(ty) ?? []), t.name]);
  }
  const types = new Map<string, number>();
  for (const [ty, share] of mixShares(mix)) {
    const to = [ty, ...(TYPE_FALLBACKS[ty] ?? [])].find((x) => byType.has(x));
    if (to) types.set(to, (types.get(to) ?? 0) + share);
  }
  const total = [...types.values()].reduce((s, v) => s + v, 0);
  const names = new Map<string, Map<string, number>>();
  for (const [ty, v] of types) {
    types.set(ty, v / total);
    // Within the type: the Terrain weights table, else an even split.
    names.set(ty, withinTypeWeights(byType.get(ty)!, terrainWeights));
  }
  const profile: BiomeProfile = { id, types, names };
  // Min patches follow their type to the one the palette has (the same fallback as the mix).
  const minPatches = new Map<string, number>();
  for (const r of mix) {
    if (!r.minPatches || r.weight <= 0) continue;
    const to = [r.type, ...(TYPE_FALLBACKS[r.type] ?? [])].find((x) => types.has(x));
    if (to) minPatches.set(to, Math.max(minPatches.get(to) ?? 0, r.minPatches));
  }
  if (minPatches.size) profile.minPatches = minPatches;
  return profile;
}

/** A biome note's profile on a palette: its mix, islands and shore settings. */
export function profileFromFields(b: BiomeNoteFields, palette: TerrainColor[]): BiomeProfile {
  const p = profileFromMix(b.id, b.mix, palette, b.terrainWeights);
  if (b.landShare !== undefined) p.landShare = b.landShare;
  if (b.minIslands !== undefined) p.minIslands = b.minIslands;
  if (b.shore) p.shore = true;
  return p;
}

/** Profiles of every note biome with a mix the palette can show. */
export function noteBiomeProfiles(palette: TerrainColor[]): Map<BiomeId, BiomeProfile> {
  const out = new Map<BiomeId, BiomeProfile>();
  if (!source) return out;
  for (const b of source.biomes.values()) {
    const p = profileFromFields(b, palette);
    if (p.types.size) out.set(b.id, p);
  }
  return out;
}

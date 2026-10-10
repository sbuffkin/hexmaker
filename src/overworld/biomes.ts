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
import { mapTerrainsByType } from "../worldgen/builtinGenerators";
import { inferTerrainType } from "../terrainTypes";
import type { TerrainColor } from "../types";

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
}

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
  { id: "archipelago", label: "Archipelago", slug: "preset-archipelago", temp: 0.6, moist: 0.7, zone: "sea" },
  { id: OPEN_SEA, label: "Open sea", temp: 0.5, moist: 1, zone: "sea" },
];

const BY_ID = new Map(BIOMES.map((b) => [b.id, b]));
export const biomeInfo = (id: BiomeId): BiomeInfo | undefined => BY_ID.get(id);
export const isSeaBiome = (id: BiomeId): boolean => BY_ID.get(id)?.zone === "sea";

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

/** Terrain type → biome (§4.1 step 2). Water is open sea, shallows archipelago. */
const TYPE_BIOME: Record<string, BiomeId> = {
  forest: "temperate-forest",
  jungle: "jungle",
  snow: "tundra",
  peaks: "alpine",
  mountains: "alpine",
  hills: "valley",
  grassland: "grassland",
  desert: "badlands",
  badlands: "badlands",
  wetland: "swamp",
  water: OPEN_SEA,
  "deep-water": OPEN_SEA,
  shallows: "archipelago",
  coast: "coastal-fjord",
  volcanic: "volcanic",
};

/** Name hints checked before the type (first match wins). */
const NAME_HINTS: [RegExp, BiomeId, (type: string | undefined) => boolean][] = [
  [/volcan|lava|magma/, "volcanic", () => true],
  [/salt/, "badlands", () => true],
  [/evergreen|pine|taiga|conifer/, "taiga", (t) => t !== "mountains" && t !== "peaks"],
  [/heavy|deep|old/, "deep-forest", (t) => t === "forest"],
  [/jungle/, "karst", (t) => t === "hills"],
  [/cactus|savann|scrub|thorn/, "savanna", () => true],
  [/fjord/, "coastal-fjord", () => true],
];

const typeOf = (t: TerrainColor) => t.type ?? inferTerrainType(t.name, t.category, "world");

/**
 * The biome a terrain stands for, or undefined (settlements, space
 * terrains, unknown names). Order: a biome label equal to the name
 * ("Taiga"), then name hints ("evergreen hills" → taiga), then the type.
 */
export function biomeForTerrain(terrain: string, palette: TerrainColor[]): BiomeId | undefined {
  const name = terrain.trim().toLowerCase();
  if (!name) return undefined;
  const label = BIOMES.find((b) => b.label.toLowerCase() === name || b.id === name);
  if (label) return label.id;
  const entry = palette.find((t) => t.name.toLowerCase() === name);
  const type = entry ? typeOf(entry) : inferTerrainType(name, undefined, "world");
  if (type === "settlement") return undefined;
  for (const [re, biome, ok] of NAME_HINTS) if (re.test(name) && ok(type)) return biome;
  return type ? TYPE_BIOME[type] : undefined;
}

/** Preferred representative terrain names per biome (Expanded first). */
const REPRESENTATIVE: Record<BiomeId, string[]> = {
  tundra: ["snow"],
  taiga: ["evergreen", "evergreen heavy"],
  "temperate-forest": ["mixed forest", "forest"],
  "deep-forest": ["forest heavy", "mixed forest heavy"],
  grassland: ["grass"],
  savanna: ["cactus", "cactus heavy"],
  jungle: ["jungle", "jungle heavy"],
  badlands: ["badlands", "desert rocky", "desert"],
  swamp: ["swamp", "marsh", "bog"],
  valley: ["hills", "foothills"],
  karst: ["jungle hills"],
  alpine: ["mountain", "mountains snow", "peak"],
  volcanic: ["volcano", "volcano dormant"],
  "coastal-fjord": ["beach"],
  archipelago: ["shallows"],
  [OPEN_SEA]: ["ocean", "water"],
};

/** The palette terrain painted for a biome, or undefined if none stands for it. */
export function representativeTerrain(biome: BiomeId, palette: TerrainColor[]): string | undefined {
  const cands = palette.filter((t) => biomeForTerrain(t.name, palette) === biome);
  if (!cands.length) return undefined;
  for (const want of REPRESENTATIVE[biome] ?? []) {
    const hit = cands.find((t) => t.name.toLowerCase() === want);
    if (hit) return hit.name;
  }
  return cands[0].name;
}

/** Biomes a palette can show (each has a terrain that reads back as it). */
export function representableBiomes(palette: TerrainColor[]): Set<BiomeId> {
  return new Set(BIOMES.map((b) => b.id).filter((id) => representativeTerrain(id, palette) !== undefined));
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
  for (const [x, y, e] of ECOTONES) if ((x === a && y === b) || (x === b && y === a)) return e;
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
    if (p.types.size) out.set(b.id, p);
  }
  return out;
}

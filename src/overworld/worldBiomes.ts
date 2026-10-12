/**
 * "World biomes": lays out biomes on an overworld (plan-overworld-regions
 * §4.4). Elevation, temperature and moisture fields give each hex a biome
 * (Whittaker-style), then deterministic repairs make it interesting:
 * patches of 1–5 hexes, no biome over 40% of the land, enough distinct
 * biomes, a mountain chain, few rare biomes, and transition biomes
 * (ecotones) between neighbours that shouldn't touch.
 *
 * Which biome a hex gets is data, never a name: each biome's climate
 * (temperature, moisture, elevation, coastal, chance, rare; biomeClimate.ts)
 * from its note, the shipped ones' from biomePresets.ts. Biomes without a
 * climate are only placed by hand (or, in a biome pool, where nothing else
 * fits).
 *
 * Each hex is painted with its biome's representative terrain on the given
 * palette, so the terrain is the biome signal regions read back (§4.1).
 * Biomes the palette can't show fall back to the nearest one it can, so a
 * small palette gives fewer, broader biomes.
 *
 * Seeded and pure: no Obsidian imports. Works on any set of hexes
 * (rectangle or hex-shaped overworld).
 */

import { hexCenter, hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import type { TerrainColor } from "../types";
import { fbm } from "./noise";
import {
  SIMILAR,
  allBiomeIds,
  biomeInfo,
  biomeNoteOf,
  biomeSourceActive,
  climateIdeal,
  compatible,
  ecotoneBetween,
  representableBiomes,
  representativeTerrain,
  resolveBiome,
  zoneOfElevation,
  type BiomeId,
  type BiomeInfo,
} from "./biomes";
import { climateArea, inClimateRange, isPlaceable, type BiomeClimate, type ClimateElevation } from "./biomeClimate";
import type { BiomeNoteFields } from "./biomeNote";
import { BIOME_PRESETS } from "./biomePresets";

export type Climate = "cold" | "temperate" | "warm" | "varied";
export type LandShape = "one" | "two" | "islands";
export type NorthIs = "colder" | "warmer" | "none";

export interface WorldBiomesOptions {
  seed: number;
  climate?: Climate;
  /** Share of hexes that are sea, 0..0.9 (default 0.3). */
  water?: number;
  land?: LandShape;
  north?: NorthIs;
  /** Trace a river from the highest hex down to the sea (default true). */
  river?: boolean;
  /** Tuning sliders (setup wizard Advanced, WORLD_BIOMES_TUNING); unset = the engine's own values. */
  tuning?: Partial<Record<WorldBiomesTuningKey, number>>;
  /**
   * A biome pool: only these are placed (placementPool). Unset: every
   * biome with a climate.
   */
  biomes?: readonly BiomeNoteFields[];
  /**
   * A pool's biomes without a climate (BC2): "fill" (default) puts them
   * only in hexes no climate biome fits; "never" leaves them for hand
   * placement. Biomes outside a pool without a climate are never placed.
   */
  unclimated?: Unclimated;
}

/** What World biomes does with a pool's biomes that have no climate (BC2). */
export type Unclimated = "fill" | "never";
export const UNCLIMATED_CHOICES: { value: Unclimated; label: string }[] = [
  { value: "fill", label: "Fill gaps only" },
  { value: "never", label: "Never place them" },
];

/** A map note's `no-climate-biomes:` value, read forgivingly ("never", "no", "hand only" → never; anything else → fill). */
export function parseUnclimated(raw: string | undefined): Unclimated {
  const t = (raw ?? "").trim().toLowerCase();
  return /^(never|no|none|off|hand)/.test(t) ? "never" : "fill";
}

/** How a choice is written in the map note (readable). */
export const unclimatedText = (u: Unclimated): string => (u === "never" ? "never" : "fill gaps");

export interface WorldBiomesResult {
  /** Hex key → biome. */
  biomes: Map<string, BiomeId>;
  /** Hex key → palette terrain (the biome's representative). */
  terrain: Map<string, string>;
  elevation: Map<string, number>;
  temperature: Map<string, number>;
  moisture: Map<string, number>;
  /** Hex keys that are sea. */
  sea: Set<string>;
  /** River hex keys from source to mouth (empty when none). */
  river: string[];
  /** Hexes turned into transition biomes. */
  ecotones: Set<string>;
}

/** Largest patch (connected same-biome land hexes) the repairs allow. */
export const MAX_PATCH = 5;
/** No land biome may cover more than this share of the land. */
export const MAX_SHARE = 0.4;

const key = (x: number, y: number) => `${x}_${y}`;

// ── generator ────────────────────────────────────────────────────────────

/** World biomes' tuning sliders, each with the value the engine used before it existed. */
export const WORLD_BIOMES_TUNING = [
  { key: "features", label: "Feature size", help: "Smaller, busier landforms (higher) or broad, simple ones (lower).", min: 0.4, max: 2.5, step: 0.1, default: 1 },
  { key: "spread", label: "Continent spread", help: "How far the land reaches from the middle of the map.", min: 0.5, max: 1.8, step: 0.05, default: 1 },
  { key: "ragged", label: "Ragged coasts", help: "More noise in the land's outline: bays, peninsulas and stray islands.", min: -0.4, max: 0.4, step: 0.05, default: 0 },
  { key: "warmth", label: "Warmth", help: "Warmer or colder than the climate picked.", min: -0.4, max: 0.4, step: 0.05, default: 0 },
  { key: "wetness", label: "Wetness", help: "Wetter or drier everywhere.", min: -0.4, max: 0.4, step: 0.05, default: 0 },
  { key: "coastRain", label: "Coastal rain", help: "How much wetter land near the sea is than inland.", min: 0, max: 0.9, step: 0.05, default: 0.45 },
  { key: "patchiness", label: "Climate patchiness", help: "Random warm and cold patches on top of north and south.", min: 0, max: 0.5, step: 0.02, default: 0.16 },
] as const;
export type WorldBiomesTuningKey = (typeof WORLD_BIOMES_TUNING)[number]["key"];

export function worldBiomes(
  cells: Iterable<[number, number]>,
  orientation: Orientation,
  stagger: Stagger,
  palette: TerrainColor[],
  opts: WorldBiomesOptions,
): WorldBiomesResult {
  const seed = opts.seed >>> 0;
  const rng = mulberry32(seed ^ 0x5eed);
  const list = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const keys = list.map(([x, y]) => key(x, y));
  const N = keys.length;
  const inMap = new Set(keys);
  const nbrs = new Map<string, string[]>();
  for (const [x, y] of list) {
    nbrs.set(key(x, y), hexNeighbors(x, y, orientation, stagger).map(([a, b]) => key(a, b)).filter((k) => inMap.has(k)));
  }
  const empty: WorldBiomesResult = {
    biomes: new Map(), terrain: new Map(), elevation: new Map(), temperature: new Map(), moisture: new Map(),
    sea: new Set(), river: [], ecotones: new Set(),
  };
  if (!N) return empty;

  // Positions normalised to the unit square (keeping proportions).
  const pts = list.map(([x, y]) => hexCenter(x, y, orientation, stagger));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const pos = new Map<string, [number, number]>();
  keys.forEach((k, i) => pos.set(k, [(pts[i][0] - minX) / span, (pts[i][1] - minY) / span]));
  const cxm = (maxX - minX) / span / 2, cym = (maxY - minY) / span / 2;
  // Noise frequency grows with map size so a 400-hex map isn't one blob.
  const tune = (k: WorldBiomesTuningKey, def: number): number => opts.tuning?.[k] ?? def;
  const freq = (1.6 + Math.sqrt(N) / 6) * tune("features", 1);

  // 1. Elevation: fBm × continent mask; sea = lowest `water` share.
  const land = opts.land ?? "one";
  const angle = rng() * Math.PI * 2;
  const lobes: [number, number][] = land === "two"
    ? [[cxm + Math.cos(angle) * 0.24, cym + Math.sin(angle) * 0.24], [cxm - Math.cos(angle) * 0.24, cym - Math.sin(angle) * 0.24]]
    : [[cxm, cym]];
  const elevation = new Map<string, number>();
  for (const k of keys) {
    const [u, v] = pos.get(k)!;
    const n = fbm(seed, u * freq, v * freq);
    const d = Math.min(...lobes.map(([a, b]) => Math.hypot(u - a, v - b))) / ((land === "two" ? 0.36 : 0.62) * tune("spread", 1));
    const mask = land === "islands" ? 0.5 : Math.max(0, 1 - d * d);
    const ragged = tune("ragged", 0);
    const w = ragged ? Math.min(1, Math.max(0, (land === "islands" ? 0.85 : 0.5) + ragged)) : land === "islands" ? 0.85 : 0.5;
    elevation.set(k, w * n + (1 - w) * mask);
  }
  const water = Math.min(0.9, Math.max(0, opts.water ?? 0.3));
  const bySea = [...keys].sort((a, b) => elevation.get(a)! - elevation.get(b)! || (a < b ? -1 : 1));
  const seaCount = Math.round(water * N);
  const sea = new Set(bySea.slice(0, seaCount));
  const landKeys = keys.filter((k) => !sea.has(k));
  // Land height as a rank 0..1 (lowest land 0, highest 1).
  const rank = new Map<string, number>();
  bySea.slice(seaCount).forEach((k, i, arr) => rank.set(k, arr.length > 1 ? i / (arr.length - 1) : 0.5));

  // Distance to the sea / to land (BFS over hexes).
  const bfs = (from: Iterable<string>) => {
    const dist = new Map<string, number>();
    const q: string[] = [];
    for (const k of from) { dist.set(k, 0); q.push(k); }
    for (let i = 0; i < q.length; i++) {
      for (const m of nbrs.get(q[i])!) if (!dist.has(m)) { dist.set(m, dist.get(q[i])! + 1); q.push(m); }
    }
    return dist;
  };
  const toSea = bfs(sea);
  const toLand = bfs(landKeys);

  // 2. Temperature: latitude, minus height, plus a little noise.
  const climate = opts.climate ?? "temperate";
  const north = opts.north ?? "colder";
  const temperature = new Map<string, number>();
  const ySpan = Math.max(1e-9, (maxY - minY) / span);
  for (const k of keys) {
    const [, v] = pos.get(k)!;
    const lat = north === "none" ? 0.5 : north === "colder" ? v / ySpan : 1 - v / ySpan;
    let t = climate === "varied" ? 0.05 + lat * 0.9 : 0.5 + (lat - 0.5) * 0.45;
    if (climate === "cold") t -= 0.28;
    if (climate === "warm") t += 0.28;
    t -= 0.3 * Math.max(0, (rank.get(k) ?? 0) - 0.5);
    t += tune("patchiness", 0.16) * (fbm(seed + 77, pos.get(k)![0] * 2, pos.get(k)![1] * 2) - 0.5) * (north === "none" ? 3 : 1);
    t += tune("warmth", 0);
    temperature.set(k, Math.min(1, Math.max(0, t)));
  }

  // 3. Moisture: noise + nearness to the sea − rain shadow (wind from the west).
  const high = (k: string) => (rank.get(k) ?? 0) > 0.8;
  const moisture = new Map<string, number>();
  for (const k of keys) {
    const [x, y] = k.split("_").map(Number);
    let shadow = 0;
    for (let s = 1; s <= 3; s++) if (high(key(x - s, y))) shadow++;
    const nearSea = sea.size ? 1 - Math.min(toSea.get(k) ?? 4, 4) / 4 : 0.4;
    const m = 0.55 * fbm(seed + 991, pos.get(k)![0] * freq, pos.get(k)![1] * freq) + tune("coastRain", 0.45) * nearSea - 0.15 * shadow + tune("wetness", 0);
    moisture.set(k, Math.min(1, Math.max(0, m)));
  }

  // 4. Biome per hex, from the candidates' climates (biomeClimate.ts): the
  //    hex's band (high, mid, low; sea), then the band's biomes that fit its
  //    temperature and moisture, rarest and narrowest first, one roll.
  const pool = placementPool(opts.biomes, opts.unclimated);
  const { cands, byId } = pool;
  const isRare = (b: BiomeId) => byId.get(b)?.rare ?? !!biomeInfo(b)?.rare;
  const zoneOf = (b: BiomeId) => byId.get(b)?.zone ?? biomeInfo(b)?.zone;
  const misfit = (b: BiomeId, t: number, m: number) => {
    const c = byId.get(b);
    return c ? Math.hypot(c.ideal[0] - t, c.ideal[1] - m) : 1;
  };
  const allowed = new Set<BiomeId>([...cands.map((c) => c.id), ...pool.fallback.map((f) => f.id)]);
  const shown = new Set([...representableBiomes(palette)].filter((b) => allowed.has(b)));
  /** A biome the palette can show: itself, else the nearest similar one in the pool; undefined when neither. */
  const ok = (b: BiomeId): BiomeId | undefined => resolveBiome(b, shown) ?? (allowed.has(b) ? b : undefined);
  const band = (e: ClimateElevation) => pool.tryOrder.filter((c) => c.elevation === e);
  const bands = { high: band("high"), mid: band("mid"), low: band("low"), sea: band("sea"), mouth: band("mouth") };
  /** Biomes the palette can paint: shown, or standing in for by a similar one that is. A biome with neither isn't placed. */
  const paintable = (b: BiomeId) => resolveBiome(b, shown) !== undefined;
  /** The band's first biome (rarest, narrowest) that fits and takes the roll. */
  const pickFrom = (list: PlacementCandidate[], t: number, m: number, coast: boolean): BiomeId | undefined => {
    const fit = list.filter((c) => inClimateRange(c.temperature, t) && inClimateRange(c.moisture, m) && (!c.coastal || coast) && paintable(c.id));
    if (!fit.length) return undefined;
    const roll = fit.some((c) => c.chance < 1) ? rng() : 0;
    return fit.find((c) => roll < c.chance)?.id;
  };
  /** Nearest-climate biome of a list (no roll). */
  const nearest = (list: { id: BiomeId }[], t: number, m: number): BiomeId | undefined => {
    let best: BiomeId | undefined, score = Infinity;
    for (const c of list) {
      const s = misfit(c.id, t, m);
      if (s < score) { score = s; best = c.id; }
    }
    return best;
  };
  /** A hex no climate biome fits: the pool's biomes without a climate, else the nearest climate biome. */
  const fallbackFor = (seaHex: boolean, t: number, m: number): BiomeId | undefined => {
    const own = pool.fallback.filter((f) => f.sea === seaHex);
    if (own.length) return own.length === 1 ? own[0].id : own[Math.floor(rng() * own.length)].id;
    const same = cands.filter((c) => (c.zone === "sea") === seaHex && c.elevation !== "mouth");
    return nearest(same.length ? same : cands, t, m) ?? pool.fallback[0]?.id;
  };
  const biomes = new Map<string, BiomeId>();
  const bigLand = landKeys.length >= 8;
  /** Coastal-only biomes (climate `coastal`) stay on hexes by the coast through every repair. */
  const onCoast = (k: string) => (sea.has(k) ? toLand.get(k) === 1 : toSea.get(k) === 1);
  const coastalOnly = (b: BiomeId) => !!byId.get(b)?.coastal;
  for (const k of keys) {
    const t = temperature.get(k)!, m = moisture.get(k)!;
    let b: BiomeId | undefined;
    if (sea.has(k)) {
      b = pickFrom(bands.sea, t, m, toLand.get(k) === 1) ?? fallbackFor(true, t, m);
    } else {
      const r = rank.get(k)!;
      const coast = toSea.get(k) === 1;
      if (bigLand && r > HIGH_RANK) b = pickFrom(bands.high, t, m, coast);
      if (!b && r > MID_RANK) b = pickFrom(bands.mid, t, m, coast);
      if (!b) b = pickFrom(bands.low, t, m, coast) ?? fallbackFor(false, t, m);
    }
    if (b) biomes.set(k, ok(b) ?? b);
  }
  // Nothing in the pool can be placed: no biomes.
  if (biomes.size < N) return { ...empty, elevation, temperature, moisture, sea };

  // River: highest land hex downhill to the sea; its mouth may take a "mouth" biome.
  const river: string[] = [];
  if ((opts.river ?? true) && landKeys.length >= 4 && sea.size) {
    let cur = [...landKeys].sort((a, b) => rank.get(b)! - rank.get(a)!)[0];
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      river.push(cur);
      if (sea.has(cur)) break;
      // Downhill toward the sea: fewest steps to the sea, then lowest.
      const next = nbrs.get(cur)!.filter((n) => !seen.has(n))
        .sort((a, b) => (toSea.get(a)! - toSea.get(b)!) || (elevation.get(a)! - elevation.get(b)!))[0];
      if (!next) break;
      cur = next;
    }
    const mouth = river.filter((k) => !sea.has(k)).pop();
    if (mouth && zoneOf(biomes.get(mouth)!) === "low") {
      const b = pickFrom(bands.mouth, temperature.get(mouth)!, moisture.get(mouth)!, toSea.get(mouth) === 1);
      const resolved = b ? ok(b) : undefined;
      if (resolved) biomes.set(mouth, resolved);
    }
  }

  // 5. Repairs.
  const isLand = (k: string) => !sea.has(k);
  const climateOf = (ks: string[]) => [
    ks.reduce((s, k) => s + temperature.get(k)!, 0) / ks.length,
    ks.reduce((s, k) => s + moisture.get(k)!, 0) / ks.length,
  ];
  const rareCap = Math.max(1, Math.floor(N / 20));
  const rareCount = () => [...biomes.values()].filter((b) => isRare(b)).length;
  /** A common land biome for a hex when a rare one has to go and no similar one will do. */
  const commonNear = (k: string): BiomeId | undefined => nearest(
    cands.filter((c) => !c.rare && c.zone !== "sea" && c.elevation !== "mouth" && shown.has(c.id) && (!c.coastal || onCoast(k))),
    temperature.get(k)!, moisture.get(k)!,
  );

  /** Best replacement biome for a group of hexes now holding `from`. */
  const alternative = (group: string[], from: BiomeId, avoid: Set<BiomeId> = new Set(), inlandCoastal = false): BiomeId | undefined => {
    const [t, m] = climateOf(group);
    const inGroup = new Set(group);
    const around = new Set<BiomeId>();
    for (const k of group) for (const n of nbrs.get(k)!) if (!inGroup.has(n) && isLand(n)) around.add(biomes.get(n)!);
    const fromZone = zoneOf(from);
    const similar = SIMILAR[from] ?? [];
    let best: BiomeId | undefined;
    let bestScore = Infinity;
    for (const c of cands) {
      const b = c.id;
      if (b === from || avoid.has(b) || !shown.has(b) || c.zone === "sea") continue;
      if (c.zone === "peak" && fromZone !== "peak") continue;
      if (c.rare && rareCount() >= rareCap) continue;
      if ([...around].some((a) => !compatible(a, b))) continue;
      const score = misfit(b, t, m) + (similar.includes(b) ? 0 : 0.35) + (around.has(b) ? 0.5 : 0) + rng() * 0.05;
      // Coastal-only biomes stay by the coast (checked after the roll, so other
      // picks don't change), unless nothing else fits (`inlandCoastal`).
      if (c.coastal && !inlandCoastal && !group.every(onCoast)) continue;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  };

  /** Connected same-biome land patches. */
  const patches = (): string[][] => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const k of landKeys) {
      if (seen.has(k)) continue;
      const b = biomes.get(k)!;
      const group = [k];
      seen.add(k);
      for (let i = 0; i < group.length; i++) {
        for (const n of nbrs.get(group[i])!) if (!seen.has(n) && isLand(n) && biomes.get(n) === b) { seen.add(n); group.push(n); }
      }
      out.push(group);
    }
    return out;
  };

  /** 2–4 hexes of a patch, grown from its most exposed hex. */
  const rimChunk = (patch: string[], max: number): string[] => {
    const inPatch = new Set(patch);
    const exposure = (k: string) => nbrs.get(k)!.filter((n) => !inPatch.has(n)).length + (6 - nbrs.get(k)!.length);
    const start = [...patch].sort((a, b) => exposure(b) - exposure(a) || (a < b ? -1 : 1))[0];
    const size = Math.min(max, 2 + Math.floor(rng() * 3));
    const chunk = [start];
    const taken = new Set(chunk);
    for (let i = 0; i < chunk.length && chunk.length < size; i++) {
      for (const n of nbrs.get(chunk[i])!) if (inPatch.has(n) && !taken.has(n) && chunk.length < size) { taken.add(n); chunk.push(n); }
    }
    return chunk;
  };

  const recolour = (group: string[], from: BiomeId, avoid?: Set<BiomeId>): boolean => {
    // Last resort (a patch boxed in by biomes it can't touch): a coastal-only biome inland.
    const alt = alternative(group, from, avoid) ?? alternative(group, from, avoid, true);
    if (!alt) return false;
    for (const k of group) biomes.set(k, alt);
    return true;
  };

  // a. Majority filter: a land hex surrounded (4+ of 6) by one compatible biome joins it.
  for (const k of landKeys) {
    const counts = new Map<BiomeId, number>();
    for (const n of nbrs.get(k)!) if (isLand(n)) counts.set(biomes.get(n)!, (counts.get(biomes.get(n)!) ?? 0) + 1);
    for (const [b, c] of counts) if (c >= 4 && b !== biomes.get(k) && !isRare(b) && (!coastalOnly(b) || onCoast(k))) biomes.set(k, b);
  }

  // b. A mountain chain from the ridge when there's room and none exists:
  //    the commonest "high" biome (the highest chance).
  const chainBiome = [...bands.high].sort((a, b) => b.chance - a.chance || a.order - b.order)[0]?.id;
  if (bigLand && chainBiome !== undefined && shown.has(chainBiome) && ![...biomes.values()].includes(chainBiome)) {
    let cur = [...landKeys].sort((a, b) => rank.get(b)! - rank.get(a)!)[0];
    const chain = new Set<string>();
    const len = 2 + Math.floor(rng() * 2);
    while (cur && chain.size < len) {
      chain.add(cur);
      biomes.set(cur, chainBiome);
      cur = nbrs.get(cur)!.filter((n) => isLand(n) && !chain.has(n)).sort((a, b) => rank.get(b)! - rank.get(a)!)[0];
    }
  }

  // c. Rare biomes: at most one per ~20 hexes.
  for (const k of keys) {
    const b = biomes.get(k)!;
    if (!isRare(b)) continue;
    const before = rareCount();
    if (before <= rareCap) continue;
    biomes.set(k, "__");
    if (!recolour([k], b)) {
      const sim = SIMILAR[b]?.find((s) => !isRare(s));
      biomes.set(k, (sim !== undefined ? ok(sim) : undefined) ?? commonNear(k) ?? b);
    }
  }

  const splitAndSpread = () => {
    // d. No biome above MAX_SHARE of the land.
    for (let guard = 0; guard < 60 && landKeys.length >= 5; guard++) {
      const counts = new Map<BiomeId, number>();
      for (const k of landKeys) counts.set(biomes.get(k)!, (counts.get(biomes.get(k)!) ?? 0) + 1);
      const [top, c] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      if (c / landKeys.length <= MAX_SHARE) break;
      const patch = patches().filter((p) => biomes.get(p[0]) === top).sort((a, b) => b.length - a.length)[0];
      const excess = c - Math.floor(MAX_SHARE * landKeys.length);
      if (!recolour(rimChunk(patch, Math.max(1, excess)), top)) break;
    }
    // e. Patches of at most MAX_PATCH hexes.
    // Generous: without a biome that may touch every other (Coastal fjord
    // used to be one, inland), big maps need more splits to settle.
    for (let guard = 0; guard < 2000; guard++) {
      const big = patches().filter((p) => p.length > MAX_PATCH).sort((a, b) => b.length - a.length)[0];
      if (!big) break;
      if (!recolour(rimChunk(big, Math.min(4, big.length - 1)), biomes.get(big[0])!)) break;
    }
  };
  splitAndSpread();

  // f. Enough distinct land biomes: min(5, N/4).
  const wantDistinct = Math.min(5, Math.floor(N / 4), landKeys.length);
  for (let guard = 0; guard < 20; guard++) {
    const used = new Set(landKeys.map((k) => biomes.get(k)!));
    if (used.size >= wantDistinct) break;
    const counts = new Map<BiomeId, number>();
    for (const k of landKeys) counts.set(biomes.get(k)!, (counts.get(biomes.get(k)!) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const patch = patches().filter((p) => biomes.get(p[0]) === top).sort((a, b) => b.length - a.length)[0];
    if (patch.length < 2 && counts.get(top)! < 2) break;
    if (!recolour(rimChunk(patch, Math.max(1, Math.min(3, patch.length - 1))), top, used)) break;
  }

  // g. Ecotones between neighbours that shouldn't touch: the hex that suits
  //    its own biome less becomes the transition biome.
  const ecotones = new Set<string>();
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const k of landKeys) {
      for (const n of nbrs.get(k)!) {
        if (!isLand(n)) continue;
        const a = biomes.get(k)!, b = biomes.get(n)!;
        const eco = ecotoneBetween(a, b);
        if (!eco) continue;
        let target = ok(eco);
        if (target === undefined) continue; // the transition biome isn't in the pool
        // Rare transitions count toward the rare cap too: past it, the
        // nearest common biome stands in.
        if (isRare(target) && rareCount() > rareCap) {
          const sim = SIMILAR[target]?.find((s) => !isRare(s) && shown.has(s));
          const common = (sim !== undefined ? ok(sim) : undefined) ?? commonNear(k);
          if (common === undefined) continue;
          target = common;
        }
        const fitK = misfit(a, temperature.get(k)!, moisture.get(k)!);
        const fitN = misfit(b, temperature.get(n)!, moisture.get(n)!);
        const which = fitK >= fitN ? k : n;
        if (biomes.get(which) === target) continue;
        if (coastalOnly(target) && !onCoast(which)) continue;
        biomes.set(which, target);
        ecotones.add(which);
        changed = true;
      }
    }
    if (!changed) break;
  }
  splitAndSpread();

  // Seas stay sea biomes whatever the repairs did nearby: the commonest sea biome.
  const seaDefault = [...bands.sea].sort((a, b) => b.chance - a.chance || a.order - b.order)[0]?.id;
  for (const k of sea) {
    if (zoneOf(biomes.get(k)!) === "sea") continue;
    const b = seaDefault !== undefined ? ok(seaDefault) : fallbackFor(true, temperature.get(k)!, moisture.get(k)!);
    if (b !== undefined) biomes.set(k, b);
  }

  const terrain = new Map<string, string>();
  for (const k of keys) {
    const t = representativeTerrain(biomes.get(k)!, palette);
    if (t) terrain.set(k, t);
  }
  return { biomes, terrain, elevation, temperature, moisture, sea, river, ecotones };
}

// ── the biomes it may place ──────────────────────────────────────────────

/** Land height ranks above which a hex is "high" (on land of 8+ hexes) and "mid". */
export const HIGH_RANK = 0.86;
export const MID_RANK = 0.66;

export interface PlacementCandidate extends BiomeClimate {
  id: BiomeId;
  elevation: ClimateElevation;
  chance: number;
  rare: boolean;
  zone: BiomeInfo["zone"];
  /** Ideal (temperature, moisture) for the repairs (biomes.climateIdeal). */
  ideal: [number, number];
  /** The shipped biomes in their preset order first, then the user's by id. */
  order: number;
}

export interface PlacementPool {
  /** Biomes with a climate, in `order` (the repairs walk them in it). */
  cands: PlacementCandidate[];
  /** The same, in the order a band tries them: rarest, then narrowest, then `order`. */
  tryOrder: PlacementCandidate[];
  byId: Map<BiomeId, PlacementCandidate>;
  /** A pool's biomes without a climate: placed only where no climate biome fits. */
  fallback: { id: BiomeId; sea: boolean }[];
}

/**
 * The biomes World biomes may place. With `list` (a biome pool) only those,
 * and the pool's biomes without a climate fill hexes no climate biome fits
 * (`unclimated` "fill"; "never" leaves them out). Blank biomes never.
 * Without one: every biome note with a climate (the shipped presets before
 * the notes load); biomes without a climate are never placed.
 */
export function placementPool(list?: readonly BiomeNoteFields[], unclimated: Unclimated = "fill"): PlacementPool {
  const notes: readonly BiomeNoteFields[] = list
    ?? (biomeSourceActive() ? allBiomeIds().map((id) => biomeNoteOf(id)).filter((b): b is BiomeNoteFields => !!b) : BIOME_PRESETS);
  const presetOrder = new Map(BIOME_PRESETS.map((p, i) => [p.id, i]));
  const users = [...new Set(notes.filter((b) => !presetOrder.has(b.id)).map((b) => b.id))].sort();
  const orderOf = (id: BiomeId) => presetOrder.get(id) ?? BIOME_PRESETS.length + users.indexOf(id);
  const seen = new Set<BiomeId>();
  const cands: PlacementCandidate[] = [];
  const fallback: { id: BiomeId; sea: boolean }[] = [];
  for (const b of notes) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    // Blank biomes (regions painted by hand) are never placed.
    if (b.blank) continue;
    const c = b.climate;
    if (!c || !isPlaceable(c)) {
      if (list && unclimated === "fill") fallback.push({ id: b.id, sea: biomeInfo(b.id)?.zone === "sea" || (b.landShare !== undefined && b.landShare < 0.5) });
      continue;
    }
    const elevation = c.elevation ?? "low";
    cands.push({
      ...c,
      id: b.id,
      elevation,
      chance: c.chance ?? 1,
      rare: !!c.rare,
      zone: zoneOfElevation(elevation),
      ideal: climateIdeal(b.id, c),
      order: orderOf(b.id),
    });
  }
  cands.sort((a, b) => a.order - b.order);
  fallback.sort((a, b) => orderOf(a.id) - orderOf(b.id));
  const tryOrder = [...cands].sort((a, b) => a.chance - b.chance || climateArea(a) - climateArea(b) || a.order - b.order);
  return { cands, tryOrder, byId: new Map(cands.map((c) => [c.id, c])), fallback };
}

// ── as a generator (registry: "World biomes") ───────────────────────────

export const WORLD_BIOMES_ID = "procedural:world-biomes";

export const WORLD_BIOMES_OPTIONS: { key: string; label: string; choices: { value: string; label: string }[]; default: string }[] = [
  { key: "climate", label: "Climate", default: "varied", choices: [
    { value: "varied", label: "Varied" }, { value: "cold", label: "Cold" }, { value: "temperate", label: "Temperate" }, { value: "warm", label: "Warm" },
  ] },
  { key: "water", label: "Water %", default: "25", choices: ["10", "25", "40", "60"].map((v) => ({ value: v, label: `${v}%` })) },
  { key: "land", label: "Land", default: "one", choices: [
    { value: "one", label: "One continent" }, { value: "two", label: "Two" }, { value: "islands", label: "Islands" },
  ] },
  { key: "north", label: "North is", default: "colder", choices: [
    { value: "colder", label: "Colder" }, { value: "warmer", label: "Warmer" }, { value: "none", label: "No gradient" },
  ] },
];

/** worldBiomes from a generator's option strings. */
export function worldBiomesFromOptions(
  cells: Iterable<[number, number]>,
  orientation: Orientation,
  stagger: Stagger,
  palette: TerrainColor[],
  seed: number,
  options: Record<string, string>,
): WorldBiomesResult {
  const pick = <T extends string>(v: string | undefined, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  return worldBiomes(cells, orientation, stagger, palette, {
    seed,
    climate: pick(options.climate, ["cold", "temperate", "warm", "varied"] as const, "varied"),
    water: Math.min(90, Math.max(0, Number(options.water ?? 25) || 0)) / 100,
    land: pick(options.land, ["one", "two", "islands"] as const, "one"),
    north: pick(options.north, ["colder", "warmer", "none"] as const, "colder"),
    ...tuningOf(options),
  });
}

/** The tuning sliders set in a generator's options (tune.<key>), for worldBiomes. */
function tuningOf(options: Record<string, string>): { tuning?: Partial<Record<WorldBiomesTuningKey, number>> } {
  const out: Partial<Record<WorldBiomesTuningKey, number>> = {};
  for (const t of WORLD_BIOMES_TUNING) {
    const raw = options[`tune.${t.key}`];
    const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(n)) out[t.key] = n;
  }
  return Object.keys(out).length ? { tuning: out } : {};
}

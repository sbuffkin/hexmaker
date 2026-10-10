/**
 * "World biomes": lays out biomes on an overworld (plan-overworld-regions
 * §4.4). Elevation, temperature and moisture fields give each hex a biome
 * (Whittaker-style), then deterministic repairs make it interesting:
 * patches of 1–5 hexes, no biome over 40% of the land, enough distinct
 * biomes, a mountain chain, few rare biomes, and transition biomes
 * (ecotones) between neighbours that shouldn't touch.
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
  BIOMES,
  OPEN_SEA,
  SIMILAR,
  biomeInfo,
  climateMisfit,
  compatible,
  ecotoneBetween,
  isSeaBiome,
  representableBiomes,
  representativeTerrain,
  resolveBiome,
  type BiomeId,
} from "./biomes";

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
}

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
  const freq = 1.6 + Math.sqrt(N) / 6;

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
    const d = Math.min(...lobes.map(([a, b]) => Math.hypot(u - a, v - b))) / (land === "two" ? 0.36 : 0.62);
    const mask = land === "islands" ? 0.5 : Math.max(0, 1 - d * d);
    const w = land === "islands" ? 0.85 : 0.5;
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
    t += 0.16 * (fbm(seed + 77, pos.get(k)![0] * 2, pos.get(k)![1] * 2) - 0.5) * (north === "none" ? 3 : 1);
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
    const m = 0.55 * fbm(seed + 991, pos.get(k)![0] * freq, pos.get(k)![1] * freq) + 0.45 * nearSea - 0.15 * shadow;
    moisture.set(k, Math.min(1, Math.max(0, m)));
  }

  // 4. Biome per hex.
  const shown = representableBiomes(palette);
  const ok = (b: BiomeId) => resolveBiome(b, shown) ?? b;
  const biomes = new Map<string, BiomeId>();
  const bigLand = landKeys.length >= 8;
  for (const k of keys) {
    const t = temperature.get(k)!, m = moisture.get(k)!;
    let b: BiomeId;
    if (sea.has(k)) {
      b = toLand.get(k) === 1 && rng() < 0.3 ? "archipelago" : OPEN_SEA;
    } else {
      const r = rank.get(k)!;
      if (bigLand && r > 0.86) b = rng() < 0.12 ? "volcanic" : "alpine";
      else if (r > 0.66 && rng() < 0.55) b = t > 0.62 && m > 0.6 ? "karst" : "valley";
      else if (toSea.get(k) === 1 && t < 0.3 && rng() < 0.5) b = "coastal-fjord";
      else b = lowland(t, m);
    }
    biomes.set(k, ok(b));
  }

  // River: highest land hex downhill to the sea; a wet mouth may be a delta.
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
    if (mouth && moisture.get(mouth)! > 0.55 && biomeInfo(biomes.get(mouth)!)?.zone === "low") biomes.set(mouth, ok("river-delta"));
  }

  // 5. Repairs.
  const isLand = (k: string) => !sea.has(k);
  const climateOf = (ks: string[]) => [
    ks.reduce((s, k) => s + temperature.get(k)!, 0) / ks.length,
    ks.reduce((s, k) => s + moisture.get(k)!, 0) / ks.length,
  ];
  const rareCap = Math.max(1, Math.floor(N / 20));
  const rareCount = () => [...biomes.values()].filter((b) => biomeInfo(b)?.rare).length;

  /** Best replacement biome for a group of hexes now holding `from`. */
  const alternative = (group: string[], from: BiomeId, avoid: Set<BiomeId> = new Set()): BiomeId | undefined => {
    const [t, m] = climateOf(group);
    const inGroup = new Set(group);
    const around = new Set<BiomeId>();
    for (const k of group) for (const n of nbrs.get(k)!) if (!inGroup.has(n) && isLand(n)) around.add(biomes.get(n)!);
    const fromZone = biomeInfo(from)?.zone;
    const similar = SIMILAR[from] ?? [];
    let best: BiomeId | undefined;
    let bestScore = Infinity;
    for (const info of BIOMES) {
      const b = info.id;
      if (b === from || avoid.has(b) || !shown.has(b) || info.zone === "sea") continue;
      if (info.zone === "peak" && fromZone !== "peak") continue;
      if (info.rare && rareCount() >= rareCap) continue;
      if ([...around].some((a) => !compatible(a, b))) continue;
      const score = climateMisfit(b, t, m) + (similar.includes(b) ? 0 : 0.35) + (around.has(b) ? 0.5 : 0) + rng() * 0.05;
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
    const alt = alternative(group, from, avoid);
    if (!alt) return false;
    for (const k of group) biomes.set(k, alt);
    return true;
  };

  // a. Majority filter: a land hex surrounded (4+ of 6) by one compatible biome joins it.
  for (const k of landKeys) {
    const counts = new Map<BiomeId, number>();
    for (const n of nbrs.get(k)!) if (isLand(n)) counts.set(biomes.get(n)!, (counts.get(biomes.get(n)!) ?? 0) + 1);
    for (const [b, c] of counts) if (c >= 4 && b !== biomes.get(k) && !biomeInfo(b)?.rare) biomes.set(k, b);
  }

  // b. A mountain chain from the ridge when there's room and none exists.
  if (bigLand && shown.has("alpine") && ![...biomes.values()].includes("alpine")) {
    let cur = [...landKeys].sort((a, b) => rank.get(b)! - rank.get(a)!)[0];
    const chain = new Set<string>();
    const len = 2 + Math.floor(rng() * 2);
    while (cur && chain.size < len) {
      chain.add(cur);
      biomes.set(cur, "alpine");
      cur = nbrs.get(cur)!.filter((n) => isLand(n) && !chain.has(n)).sort((a, b) => rank.get(b)! - rank.get(a)!)[0];
    }
  }

  // c. Rare biomes: at most one per ~20 hexes.
  for (const k of keys) {
    const b = biomes.get(k)!;
    if (!biomeInfo(b)?.rare) continue;
    const before = rareCount();
    if (before <= rareCap) continue;
    biomes.set(k, "__");
    if (!recolour([k], b)) biomes.set(k, ok(SIMILAR[b]?.find((s) => !biomeInfo(s)?.rare) ?? "grassland"));
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
    for (let guard = 0; guard < 200; guard++) {
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
        const target = ok(eco);
        const fitK = climateMisfit(a, temperature.get(k)!, moisture.get(k)!);
        const fitN = climateMisfit(b, temperature.get(n)!, moisture.get(n)!);
        const which = fitK >= fitN ? k : n;
        if (biomes.get(which) === target) continue;
        biomes.set(which, target);
        ecotones.add(which);
        changed = true;
      }
    }
    if (!changed) break;
  }
  splitAndSpread();

  // Seas stay sea biomes whatever the repairs did nearby.
  for (const k of sea) if (!isSeaBiome(biomes.get(k)!)) biomes.set(k, ok(OPEN_SEA));

  const terrain = new Map<string, string>();
  for (const k of keys) {
    const t = representativeTerrain(biomes.get(k)!, palette);
    if (t) terrain.set(k, t);
  }
  return { biomes, terrain, elevation, temperature, moisture, sea, river, ecotones };
}

/** Lowland biome for a climate (Whittaker-style). */
export function lowland(t: number, m: number): BiomeId {
  if (t < 0.18) return "tundra";
  if (t < 0.36) return m > 0.45 ? "taiga" : "tundra";
  if (t < 0.66) return m < 0.3 ? "grassland" : m < 0.62 ? "temperate-forest" : m < 0.8 ? "deep-forest" : "swamp";
  return m < 0.2 ? "badlands" : m < 0.5 ? "savanna" : m < 0.85 ? "jungle" : "swamp";
}

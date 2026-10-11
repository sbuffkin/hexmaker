/**
 * World types: which worlds space generators place, how often, and what a
 * world's own map (its submap) is made with. One plain note per table at
 * `<world types folder>/<name>.md`:
 *
 *   ---
 *   hexmaker-world-types: 1
 *   ---
 *
 *   # Default space
 *
 *   > [!info] World types
 *   > … (short help)
 *
 *   | World | Weight | Map | Orbit | Stars | Temperature | Size | Generator | Options | Palette | Base | Notes |
 *   | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
 *   | ocean planet | 3 | system | habitable |  |  | 20×14 | procedural:planet-surface | water=85, climate=lush | Expanded | ocean |  |
 *
 * - *World*: the terrain the row places (matched to the palette's terrain
 *   names, any case). The same world may have several rows (different
 *   odds, sizes or generators per zone, star or temperature).
 * - *Weight* (blank = 1): relative odds among the rows that fit. 0 = never
 *   rolled (the row still gives that world's map setup).
 * - Filters, each optional (blank or "any" = no limit). A filter only
 *   applies when the generator knows that thing:
 *   *Map* `sector` (a sector's star systems: Star scatter) or `system`
 *   (an orbit around a star: Orbits); *Orbit* zone words `inner`,
 *   `habitable`, `outer` and/or ring distances like `2–4` (hexes from the
 *   star); *Stars* a list of star terrains (`red dwarf, white dwarf`);
 *   *Temperature* cold, cool, mild, warm, hot or 0.2–0.5 (as on biomes).
 * - Map setup for the world's submap, each optional: *Size* `20×14` or a
 *   range `16–24 × 10–14` (rolled per world); *Generator* a generator note
 *   link (`[[My desert]]`), a generator id (`procedural:planet-surface`,
 *   `wfc:<path>`, `builtin:<slug>`) or a shipped generator's slug
 *   (`preset-volcanic`); *Options* the generator's choices
 *   (`water=85, climate=lush`); *Palette* and *Base* (base terrain).
 * - *Notes*: free text, kept as written.
 *
 * Reading is forgiving: columns by header name in any order, missing
 * columns are fine, en dash / hyphen / "to" in ranges, × / x / "by" in
 * sizes, weights like `2` or `50%`. A row that can't be read is never
 * used, is reported, and stays in the note exactly as written (rewriting
 * keeps it, after the rows the plugin wrote).
 *
 * Picking (pickWorldType) is deterministic for a seed and works like the
 * generators' weighted pick: one draw over the fitting worlds, in palette
 * order when a palette is given, so the shipped "Default space" table
 * gives exactly the odds (and, for the same random stream, the same
 * choices) Star scatter and Orbits had built in.
 *
 * Two more tables follow in the same note, each under its own heading
 * (format 2; found by their header, so the heading is only for people):
 *
 *   ## Stars
 *   | Star | Weight | Notes |
 *   | red dwarf | 6 |  |
 *
 *   ## Sector features
 *   | Feature | Chance | Notes |
 *   | deep-space station | 1 in 50 |  |
 *
 * - *Stars*: which star Orbits puts at a system's centre (when its Star
 *   option is Random), by weight. pickStar.
 * - *Sector features*: Star scatter's special hexes. Each star system hex
 *   has the row's *Chance* (`1 in 50`, `2%`, `0.02`) of being that feature
 *   instead of a system. pickSectorFeature.
 * A format 1 note (no such tables yet) is given the shipped rows once
 * (upgradeWorldTypes); after that a deleted table stays deleted.
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import {
  TEMPERATURE_WORDS,
  formatClimateRange,
  inClimateRange,
  parseClimateRange,
  type ClimateRange,
} from "../overworld/biomeClimate";

export const WORLD_TYPES_MARKER = "hexmaker-world-types";
/** 2: the note also has the Stars and Sector features tables. */
export const WORLD_TYPES_FORMAT = 2;
/** The shipped table's name (and note name). */
export const DEFAULT_WORLD_TYPES = "Default space";

export type OrbitZone = "inner" | "habitable" | "outer";
export const ORBIT_ZONES: readonly OrbitZone[] = ["inner", "habitable", "outer"];

/** Which kind of space map picks: a sector's systems, or a system's orbits. */
export type WorldTypeMap = "sector" | "system";
export const WORLD_TYPE_MAPS: readonly WorldTypeMap[] = ["sector", "system"];

/**
 * The generator a world's submap is made with. Assignable to
 * worldgen/biomeRegion's GeneratorRef (minus the in-memory form):
 * `{ path }` a generator note, `{ builtin }` a shipped generator's slug,
 * `{ id }` a registry id (`procedural:planet-surface`, `wfc:<path>`, …).
 */
export type WorldGeneratorRef = { path: string } | { builtin: string } | { id: string };

/** Inclusive integer range. */
export interface IntRange {
  lo: number;
  hi: number;
}

export interface WorldSizeRange {
  cols: IntRange;
  rows: IntRange;
}

export interface WorldTypeRow {
  /** The terrain this row places, as written ("ocean planet"). */
  world: string;
  /** Relative odds among the fitting rows; default 1; 0 = never rolled. */
  weight?: number;
  /** Only on this kind of map. Unset: any. */
  map?: WorldTypeMap;
  /** Only in these orbit zones. Unset: any. */
  zones?: OrbitZone[];
  /** Only this many hexes from the star (inclusive). Unset: any. */
  distance?: IntRange;
  /** Only around these stars (terrain names, as written). Unset: any. */
  stars?: string[];
  /** Only at this temperature (0 cold … 1 hot). Unset: any. */
  temperature?: ClimateRange;
  /** The world's submap size. Unset: no preference. */
  size?: WorldSizeRange;
  /** The world's submap generator. Unset: no preference. */
  generator?: WorldGeneratorRef;
  /** The generator's options (`water` → `85`). */
  options?: Record<string, string>;
  /** The submap's palette. */
  palette?: string;
  /** The submap's base terrain. */
  baseTerrain?: string;
  notes?: string;
}

/** A row of the Stars table: a star terrain and its odds. */
export interface StarTypeRow {
  /** The star terrain, as written ("red dwarf"). */
  star: string;
  /** Relative odds among the stars; default 1; 0 = never rolled. */
  weight?: number;
  notes?: string;
}

/** A row of the Sector features table: a special hex and its chance per star system hex. */
export interface SectorFeatureRow {
  /** The feature terrain, as written ("black hole"). */
  feature: string;
  /** Chance (0..1) that a star system hex is this feature instead. */
  chance: number;
  notes?: string;
}

export interface WorldTypeTable {
  name: string;
  rows: WorldTypeRow[];
  /** The Stars table (none = the note has none). */
  stars?: StarTypeRow[];
  /** The Sector features table (none = the note has none). */
  features?: SectorFeatureRow[];
}

export interface WorldTypeProblem {
  /** 1-based line in the note, when it's a row. */
  line?: number;
  text: string;
}

export interface ParsedWorldTypes {
  rows: WorldTypeRow[];
  problems: WorldTypeProblem[];
  /** Table rows that couldn't be read, exactly as written (kept on rewrite). */
  unreadable: string[];
  /** The Stars table's rows; undefined when the note has no Stars table. */
  stars?: StarTypeRow[];
  /** The Sector features table's rows; undefined when the note has none. */
  features?: SectorFeatureRow[];
  unreadableStars: string[];
  unreadableFeatures: string[];
  /** The `hexmaker-world-types:` number in the frontmatter, if any. */
  format?: number;
}

/** What the generator knows where it is placing a world. Every field but `seed` is optional. */
export interface WorldTypeContext {
  map?: WorldTypeMap;
  zone?: OrbitZone;
  /** Hexes from the star (the orbit's ring). */
  distance?: number;
  /** The system's star terrain. */
  starType?: string;
  /** 0 (cold) … 1 (hot). */
  temperature?: number;
  seed: number;
  /**
   * The generator's own random stream. When given, the pick takes exactly
   * one draw from it (like weightedPick), so a generator's later rolls are
   * unchanged; sizes and ties between rows use a stream made from `seed`.
   */
  rand?: () => number;
  /**
   * The palette's terrains (names, or terrains with a name): only rows
   * whose world is in it are picked, and the pick runs over them in
   * palette order (the generators' order).
   */
  palette?: readonly (string | { name: string })[];
}

export interface WorldTypePick {
  row: WorldTypeRow;
  /** The palette's own name for the world (its case), else the row's. */
  terrain: string;
  /** Rolled from the row's size range; unset when the row has none. */
  size?: { cols: number; rows: number };
  generator?: WorldGeneratorRef;
  options?: Record<string, string>;
  palette?: string;
  baseTerrain?: string;
}

// ── zones ────────────────────────────────────────────────────────────────

/**
 * The orbit zone of ring `d` when orbits run from ring `first` to `last`:
 * the first 30% inner, up to 60% habitable, the rest outer (Orbits' rule).
 */
export function orbitZone(d: number, first: number, last: number): OrbitZone {
  const t = (d - first) / Math.max(1, last - first);
  return t < 0.3 ? "inner" : t < 0.6 ? "habitable" : "outer";
}

// ── matching and picking ─────────────────────────────────────────────────

const lc = (s: string) => s.trim().toLowerCase();

/** Whether a row's filters allow this context (filters the context doesn't speak to pass). */
export function worldTypeFits(row: WorldTypeRow, ctx: Omit<WorldTypeContext, "seed"> & { seed?: number }): boolean {
  if (row.map && ctx.map && row.map !== ctx.map) return false;
  if (row.zones?.length && ctx.zone && !row.zones.includes(ctx.zone)) return false;
  if (row.distance && ctx.distance !== undefined && (ctx.distance < row.distance.lo || ctx.distance > row.distance.hi)) return false;
  if (row.stars?.length && ctx.starType && !row.stars.some((s) => lc(s) === lc(ctx.starType!))) return false;
  if (row.temperature && ctx.temperature !== undefined && !inClimateRange(row.temperature, ctx.temperature)) return false;
  return true;
}

const paletteNames = (p: WorldTypeContext["palette"]) => p?.map((t) => (typeof t === "string" ? t : t.name));

/**
 * The rows that fit the context (weight > 0), in pick order: palette order
 * of their world when a palette is given (rows of worlds not in it left
 * out), else table order.
 */
export function matchingWorldTypes(table: WorldTypeTable, ctx: Omit<WorldTypeContext, "seed"> & { seed?: number }): WorldTypeRow[] {
  const fit = table.rows.filter((r) => (r.weight ?? 1) > 0 && r.world.trim() && worldTypeFits(r, ctx));
  const names = paletteNames(ctx.palette);
  if (!names) return fit;
  const order = new Map<string, number>();
  names.forEach((n, i) => { if (!order.has(lc(n))) order.set(lc(n), i); });
  return fit
    .filter((r) => order.has(lc(r.world)))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order.get(lc(a.r.world))! - order.get(lc(b.r.world))! || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Each fitting world's total weight (lower-case name → weight), for a
 * generator that mixes the table with its own weights for terrains the
 * table doesn't name.
 */
export function worldTypeWeights(table: WorldTypeTable, ctx: Omit<WorldTypeContext, "seed"> & { seed?: number }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of matchingWorldTypes(table, ctx)) out[lc(r.world)] = (out[lc(r.world)] ?? 0) + (r.weight ?? 1);
  return out;
}

/** Weighted pick of an index, the generators' way (one draw). */
function pickIndex(rand: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(rand() * weights.length);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

const rollInt = (rand: () => number, r: IntRange) => r.lo + Math.floor(rand() * (r.hi - r.lo + 1));

/**
 * Pick a world for the context: one weighted draw over the fitting worlds
 * (a world's rows add up), then, when that world has several fitting rows,
 * one of them by weight, and its size within its range. Null when nothing
 * fits. Deterministic for a seed (or for the given random stream).
 */
export function pickWorldType(table: WorldTypeTable, ctx: WorldTypeContext): WorldTypePick | null {
  const rows = matchingWorldTypes(table, ctx);
  if (!rows.length) return null;
  const worlds: string[] = [];
  const weight = new Map<string, number>();
  for (const r of rows) {
    const k = lc(r.world);
    if (!weight.has(k)) worlds.push(k);
    weight.set(k, (weight.get(k) ?? 0) + (r.weight ?? 1));
  }
  const rand = ctx.rand ?? mulberry32(ctx.seed >>> 0);
  const world = worlds[pickIndex(rand, worlds.map((k) => weight.get(k)!))];
  // Its own stream, so the caller's stream sees exactly one draw.
  const side = mulberry32(((ctx.seed ^ 0x51e3d7a1) >>> 0));
  const own = rows.filter((r) => lc(r.world) === world);
  const row = own.length === 1 ? own[0] : own[pickIndex(side, own.map((r) => r.weight ?? 1))];
  const names = paletteNames(ctx.palette);
  const out: WorldTypePick = { row, terrain: names?.find((n) => lc(n) === world) ?? row.world.trim() };
  if (row.size) out.size = { cols: rollInt(side, row.size.cols), rows: rollInt(side, row.size.rows) };
  if (row.generator) out.generator = { ...row.generator };
  if (row.options) out.options = { ...row.options };
  if (row.palette) out.palette = row.palette;
  if (row.baseTerrain) out.baseTerrain = row.baseTerrain;
  return out;
}

/**
 * The row giving a world's map setup (for a submap made from a hex of that
 * world): the first row naming it that fits the context, weight 0 rows
 * included.
 */
export function worldTypeFor(table: WorldTypeTable, world: string, ctx: Omit<WorldTypeContext, "seed"> & { seed?: number } = {}): WorldTypeRow | undefined {
  return table.rows.find((r) => lc(r.world) === lc(world) && worldTypeFits(r, ctx));
}

/** A generator ref as a registry id (`{ path }` → `wfc:<path>.md`, `{ builtin }` → `builtin:<slug>`). */
export function generatorRefId(ref: WorldGeneratorRef): string {
  if ("id" in ref) return ref.id;
  if ("builtin" in ref) return `builtin:${ref.builtin}`;
  return `wfc:${/\.md$/i.test(ref.path) ? ref.path : `${ref.path}.md`}`;
}

/** A row's map setup in the palette's submap-default shape (types.ts SubmapDefault). */
export function worldTypeSubmapDefault(row: WorldTypeRow, size?: { cols: number; rows: number }): {
  palette?: string; cols?: number; rows?: number; generator?: string; options?: Record<string, string>; baseTerrain?: string;
} {
  const out: ReturnType<typeof worldTypeSubmapDefault> = {};
  if (row.palette) out.palette = row.palette;
  const s = size ?? (row.size ? { cols: row.size.cols.lo, rows: row.size.rows.lo } : undefined);
  if (s) { out.cols = s.cols; out.rows = s.rows; }
  if (row.generator) out.generator = generatorRefId(row.generator);
  if (row.options && Object.keys(row.options).length) out.options = { ...row.options };
  if (row.baseTerrain) out.baseTerrain = row.baseTerrain;
  return out;
}

// ── stars and sector features ────────────────────────────────────────────

/** What a generator passes when picking a star or a sector feature. */
export interface SpacePickContext {
  seed: number;
  /**
   * The generator's own random stream. pickStar takes exactly one draw
   * from it when it returns a star (none when nothing fits);
   * pickSectorFeature always takes exactly one.
   */
  rand?: () => number;
  /**
   * The palette's terrains (names, or terrains with a name): only rows
   * naming one of them count, in palette order.
   */
  palette?: readonly (string | { name: string })[];
}

/**
 * Rows grouped by name (a name's rows add up), in palette order when a
 * palette is given (names not in it left out), else table order. Each
 * group keeps its first row and the palette's spelling of the name.
 */
function groupByName<R>(
  rows: readonly R[],
  nameOf: (r: R) => string,
  amountOf: (r: R) => number,
  palette: SpacePickContext["palette"],
): { key: string; terrain: string; row: R; amount: number }[] {
  const groups = new Map<string, { key: string; terrain: string; row: R; amount: number }>();
  for (const r of rows) {
    const name = nameOf(r).trim();
    const amount = amountOf(r);
    if (!name || !(amount > 0)) continue;
    const k = lc(name);
    const g = groups.get(k);
    if (g) g.amount += amount;
    else groups.set(k, { key: k, terrain: name, row: r, amount });
  }
  const names = paletteNames(palette);
  if (!names) return [...groups.values()];
  const out: { key: string; terrain: string; row: R; amount: number }[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const g = groups.get(lc(n));
    if (!g || seen.has(g.key)) continue;
    seen.add(g.key);
    out.push({ ...g, terrain: n });
  }
  return out;
}

const starGroups = (table: WorldTypeTable, palette?: SpacePickContext["palette"]) =>
  groupByName(table.stars ?? [], (r) => r.star, (r) => r.weight ?? 1, palette);
const featureGroups = (table: WorldTypeTable, palette?: SpacePickContext["palette"]) =>
  groupByName(table.features ?? [], (r) => r.feature, (r) => r.chance, palette);

export interface StarPick {
  row: StarTypeRow;
  /** The palette's own name for the star (its case), else the row's. */
  terrain: string;
}

export interface SectorFeaturePick {
  row: SectorFeatureRow;
  /** The palette's own name for the feature (its case), else the row's. */
  terrain: string;
}

/** Each star's total weight (lower-case name → weight), weight 0 left out. */
export function starWeights(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed"> & { seed?: number } = {}): Record<string, number> {
  return Object.fromEntries(starGroups(table, ctx.palette).map((g) => [g.key, g.amount]));
}

/**
 * Pick the star at a system's centre: one weighted draw over the stars
 * (in palette order when a palette is given). Null when no star row fits;
 * then no draw is taken, so a generator can fall back to its own pick.
 */
export function pickStar(table: WorldTypeTable, ctx: SpacePickContext): StarPick | null {
  const groups = starGroups(table, ctx.palette);
  if (!groups.length) return null;
  const rand = ctx.rand ?? mulberry32(ctx.seed >>> 0);
  const g = groups[pickIndex(rand, groups.map((x) => x.amount))];
  return { row: g.row, terrain: g.terrain };
}

/** Each star's exact odds (0..1), most likely first. */
export function starOdds(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed" | "rand"> = {}): { star: string; odds: number }[] {
  const groups = starGroups(table, ctx.palette);
  const total = groups.reduce((a, g) => a + g.amount, 0);
  if (total <= 0) return [];
  return groups.map((g) => ({ star: g.terrain, odds: g.amount / total })).sort((a, b) => b.odds - a.odds || a.star.localeCompare(b.star));
}

/** Roll `n` stars (seeds `seed`, `seed + 1`, …) and count them, most rolled first. */
export function rollStars(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed" | "rand">, n: number, seed = 1): { star: string; count: number }[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = pickStar(table, { ...ctx, seed: seed + i });
    if (p) counts.set(p.terrain, (counts.get(p.terrain) ?? 0) + 1);
  }
  return [...counts].map(([star, count]) => ({ star, count })).sort((a, b) => b.count - a.count || a.star.localeCompare(b.star));
}

/** Each feature's chance per star system hex (lower-case name → 0..1), chance 0 left out. */
export function sectorFeatureChances(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed"> & { seed?: number } = {}): Record<string, number> {
  return Object.fromEntries(featureGroups(table, ctx.palette).map((g) => [g.key, g.amount]));
}

/**
 * Whether a star system hex is a special feature instead, and which:
 * exactly one draw `u`; the features (in palette order when a palette is
 * given) take consecutive slices of 0..1 as wide as their chance, so `u`
 * below the total chance lands on a feature, anything else is null (an
 * ordinary system). The draw is taken even when no feature fits, so the
 * generator's later rolls don't depend on the palette.
 */
export function pickSectorFeature(table: WorldTypeTable, ctx: SpacePickContext): SectorFeaturePick | null {
  const rand = ctx.rand ?? mulberry32(ctx.seed >>> 0);
  const u = rand();
  let edge = 0;
  for (const g of featureGroups(table, ctx.palette)) {
    edge += g.amount;
    if (u < edge) return { row: g.row, terrain: g.terrain };
  }
  return null;
}

/** Each feature's chance per star system hex, most likely first, and their total (capped at 1). */
export function sectorFeatureOdds(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed" | "rand"> = {}): { features: { feature: string; chance: number }[]; total: number } {
  const groups = featureGroups(table, ctx.palette);
  let left = 1;
  const features = groups.map((g) => {
    const chance = Math.max(0, Math.min(g.amount, left));
    left -= chance;
    return { feature: g.terrain, chance };
  }).filter((f) => f.chance > 0);
  return {
    features: features.sort((a, b) => b.chance - a.chance || a.feature.localeCompare(b.feature)),
    total: features.reduce((a, f) => a + f.chance, 0),
  };
}

/** Roll `n` star system hexes (seeds `seed`, `seed + 1`, …): how many became each feature, most first. */
export function rollSectorFeatures(table: WorldTypeTable, ctx: Omit<SpacePickContext, "seed" | "rand">, n: number, seed = 1): { feature: string; count: number }[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = pickSectorFeature(table, { ...ctx, seed: seed + i });
    if (p) counts.set(p.terrain, (counts.get(p.terrain) ?? 0) + 1);
  }
  return [...counts].map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));
}

// ── cells ────────────────────────────────────────────────────────────────

/** "2", "50%", "0.5" → a weight ≥ 0, or NaN. */
export function readWeight(raw: string): number {
  const t = raw.trim();
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  if (!t || !Number.isFinite(n) || n < 0) return NaN;
  return pct ? n / 100 : n;
}

const RANGE_SPLIT = /\s*(?:–|—|\.\.|\bto\b|-)\s*/;

/** "20", "16–24", "16 to 24" → an integer range ≥ 1 (turned round when backwards). */
export function readIntRange(raw: string): IntRange | undefined {
  const parts = raw.trim().split(RANGE_SPLIT).filter((p) => p !== "");
  if (parts.length < 1 || parts.length > 2) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 1)) return undefined;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return { lo, hi };
}

/** "20×14", "20x14", "16–24 × 10–14", "20 by 14" → a size range. */
export function readSize(raw: string): WorldSizeRange | undefined {
  const parts = raw.trim().toLowerCase().split(/\s*(?:×|\*|\bby\b|(?<=[\d\s])x(?=[\s\d]))\s*/).filter((p) => p !== "");
  if (parts.length !== 2) return undefined;
  const cols = readIntRange(parts[0]), rows = readIntRange(parts[1]);
  return cols && rows ? { cols, rows } : undefined;
}

const fmtInt = (r: IntRange) => (r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);
export const formatSize = (s: WorldSizeRange) => `${fmtInt(s.cols)}×${fmtInt(s.rows)}`;

const ZONE_ALIASES: Record<string, OrbitZone> = {
  inner: "inner", hot: "inner", close: "inner",
  habitable: "habitable", hab: "habitable", middle: "habitable", mid: "habitable", goldilocks: "habitable",
  outer: "outer", cold: "outer", far: "outer",
};

/** "inner, habitable", "2–4", "habitable, 3-5" → zones and/or a ring band. */
export function readOrbit(raw: string): { zones?: OrbitZone[]; distance?: IntRange } | undefined {
  const t = raw.trim().toLowerCase();
  if (!t || t === "any") return {};
  const out: { zones?: OrbitZone[]; distance?: IntRange } = {};
  for (const tok of t.split(/\s*[,;/]\s*|\s+and\s+/).filter((p) => p !== "")) {
    const z = ZONE_ALIASES[tok.replace(/\s*zone$/, "")];
    if (z) {
      out.zones = [...(out.zones ?? []).filter((x) => x !== z), z];
      continue;
    }
    const d = readIntRange(tok.replace(/^(?:rings?|distance)\s*/, ""));
    if (!d || out.distance) return undefined;
    out.distance = d;
  }
  if (out.zones) out.zones = ORBIT_ZONES.filter((z) => out.zones!.includes(z));
  return out;
}

export function formatOrbit(row: Pick<WorldTypeRow, "zones" | "distance">): string {
  const parts: string[] = [...(row.zones ?? [])];
  if (row.distance) parts.push(fmtInt(row.distance));
  return parts.join(", ");
}

/** "sector", "systems", "any", "" → the map kind (undefined = any); null when unreadable. */
export function readMap(raw: string): WorldTypeMap | undefined | null {
  const t = raw.trim().toLowerCase().replace(/s$/, "");
  if (!t || t === "any" || t === "both") return undefined;
  if (t === "sector") return "sector";
  if (t === "system" || t === "star system" || t === "orbit") return "system";
  return null;
}

/** "[[My gen]]" → path; "procedural:x" → id; "preset-volcanic" → builtin; "" / "none" → undefined. */
export function readGenerator(raw: string): WorldGeneratorRef | undefined {
  const t = raw.trim();
  if (!t || /^(none|-|—)$/i.test(t)) return undefined;
  const link = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(t);
  if (link) return { path: link[1].trim() };
  if (t.includes(":")) return { id: t };
  return { builtin: t.toLowerCase() };
}

export function formatGenerator(g: WorldGeneratorRef | undefined): string {
  if (!g) return "";
  if ("path" in g) return `[[${g.path}]]`;
  if ("id" in g) return g.id;
  return g.builtin;
}

/** "water=85, climate=lush" (or "water: 85; climate: lush") → options; undefined when unreadable. */
export function readOptions(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const t = raw.trim();
  if (!t) return out;
  for (const pair of t.split(/\s*[,;]\s*/).filter((p) => p !== "")) {
    const m = /^([^=:]+?)\s*[=:]\s*(.+)$/.exec(pair);
    if (!m) return undefined;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export const formatOptions = (o: Record<string, string> | undefined) =>
  o ? Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ") : "";

/**
 * A chance per star system hex: "1 in 50", "1/50", "2%", "0.02", "never"
 * or "0" → 0..1; NaN when unreadable (blank, over 100%, a bare number
 * above 1, or "0 in 5").
 */
export function readChance(raw: string): number {
  const t = raw.trim().toLowerCase();
  if (!t) return NaN;
  if (t === "never" || t === "none") return 0;
  const inN = /^(\d+(?:\.\d+)?)\s*(?:in|\/|out of)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (inN) {
    const a = Number(inN[1]), b = Number(inN[2]);
    return b > 0 && a <= b ? a / b : NaN;
  }
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  if (!Number.isFinite(n) || n < 0) return NaN;
  const c = pct ? n / 100 : n;
  return c <= 1 ? c : NaN;
}

/** 1/50 → "1 in 50", 0.03 → "3%", 0 → "never". */
export function formatChance(c: number): string {
  if (!(c > 0)) return "never";
  if (c >= 1) return "100%";
  const inv = 1 / c;
  const n = Math.round(inv);
  if (n >= 2 && Math.abs(inv - n) < 1e-9 * n) return `1 in ${n}`;
  return `${String(Math.round(c * 100 * 1000) / 1000)}%`;
}

const readList = (raw: string) => {
  const t = raw.trim();
  if (!t || t.toLowerCase() === "any") return [];
  return t.split(/\s*[,;]\s*/).map((s) => s.trim()).filter((s) => s !== "");
};

// ── the note ─────────────────────────────────────────────────────────────

export const WORLD_TYPES_HELP = [
  "> [!info] World types",
  "> Which worlds the space generators place and how often, and what each world's own map is made with. **World** is a terrain of the palette. **Weight** (1 if blank) is its odds against the other rows that fit; 0 never rolls it. Limits, all optional: **Map** sector (Star scatter's systems) or system (Orbits), **Orbit** inner, habitable, outer or rings like 2–4, **Stars** a list of star terrains, **Temperature** cold, cool, mild, warm, hot or 0.2–0.5. For the world's map: **Size** like 20×14 or 16–24 × 10–14, **Generator** a generator note link or id, **Options** like water=85, climate=lush, **Palette** and **Base** terrain. The same world can have several rows. Add, edit or delete rows freely.",
];

/** The note table's columns, in order (the editor keeps each row as these cells). */
export const WORLD_TYPE_COLUMNS = ["World", "Weight", "Map", "Orbit", "Stars", "Temperature", "Size", "Generator", "Options", "Palette", "Base", "Notes"] as const;
export type WorldTypeColumn = (typeof WORLD_TYPE_COLUMNS)[number];
type Column = WorldTypeColumn;
const COLUMNS = WORLD_TYPE_COLUMNS;
const HEADER_ALIASES: Record<string, Column> = {
  world: "World", worlds: "World", "world type": "World", type: "World", body: "World", terrain: "World",
  weight: "Weight", odds: "Weight", chance: "Weight",
  map: "Map", scale: "Map",
  orbit: "Orbit", zone: "Orbit", orbits: "Orbit", "orbit zone": "Orbit",
  stars: "Stars", star: "Stars", "star types": "Stars",
  temperature: "Temperature", temp: "Temperature",
  size: "Size",
  generator: "Generator", preset: "Generator",
  options: "Options",
  palette: "Palette",
  base: "Base", "base terrain": "Base",
  notes: "Notes", note: "Notes", comment: "Notes",
};

export const STARS_HEADING = "## Stars";
export const STARS_HELP = [
  "> [!info] Stars",
  "> Which star Orbits puts at the centre of a system when its Star option is Random. **Star** is a star terrain of the palette; **Weight** (1 if blank) is its odds against the other stars; 0 never rolls it.",
];
export const FEATURES_HEADING = "## Sector features";
export const FEATURES_HELP = [
  "> [!info] Sector features",
  "> Star scatter's special hexes. **Feature** is a terrain of the palette; **Chance** is how likely each star system hex is to be that feature instead, like 1 in 50, 2% or never.",
];

/** The Stars table's columns, in order. */
export const STAR_COLUMNS = ["Star", "Weight", "Notes"] as const;
export type StarColumn = (typeof STAR_COLUMNS)[number];
const STAR_ALIASES: Record<string, StarColumn> = {
  star: "Star", stars: "Star", "star type": "Star", "star types": "Star", sun: "Star",
  weight: "Weight", odds: "Weight",
  notes: "Notes", note: "Notes", comment: "Notes",
};

/** The Sector features table's columns, in order. */
export const FEATURE_COLUMNS = ["Feature", "Chance", "Notes"] as const;
export type FeatureColumn = (typeof FEATURE_COLUMNS)[number];
const FEATURE_ALIASES: Record<string, FeatureColumn> = {
  feature: "Feature", features: "Feature", "sector feature": "Feature", "sector features": "Feature", special: "Feature", "special hex": "Feature",
  chance: "Chance", odds: "Chance", "chance per system": "Chance", "per system": "Chance", "chance per system hex": "Chance",
  notes: "Notes", note: "Notes", comment: "Notes",
};

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    // A `|` inside [[link|alias]] belongs to the link.
    if (s[i] === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
    if (s[i] === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|" && !depth) { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const normHeader = (h: string) => h.trim().toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ");

interface Span<C extends string = Column> { start: number; end: number; cols: (C | undefined)[] }

type TableKind = "worlds" | "stars" | "features";

/**
 * The note's first table of a kind, told apart by its header: Sector
 * features has a Feature column; Stars a Star column and no World;
 * the worlds table a World column and no Feature.
 */
function findKind<C extends string>(lines: string[], kind: TableKind, aliases: Record<string, C>): Span<C> | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !SEPARATOR_ROW.test(lines[i + 1])) continue;
    const heads = splitRow(lines[i]).map(normHeader);
    const isFeatures = heads.some((h) => FEATURE_ALIASES[h] === "Feature");
    const hasWorld = heads.some((h) => HEADER_ALIASES[h] === "World");
    const fits = kind === "features" ? isFeatures
      : kind === "stars" ? !isFeatures && !hasWorld && heads.some((h) => STAR_ALIASES[h] === "Star")
      : !isFeatures && hasWorld;
    if (!fits) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, cols: heads.map((h) => aliases[h]) };
  }
  return null;
}

const findTable = (lines: string[]) => findKind(lines, "worlds", HEADER_ALIASES);
const findStars = (lines: string[]) => findKind(lines, "stars", STAR_ALIASES);
const findFeatures = (lines: string[]) => findKind(lines, "features", FEATURE_ALIASES);

/** A cell by column name (blank when the column is missing). */
const cellOf = <C extends string>(cells: string[], cols: (C | undefined)[], c: C) => {
  const i = cols.indexOf(c);
  return i >= 0 ? (cells[i] ?? "").trim() : "";
};
/** A name cell: a `[[link]]`'s target, else the text. */
const nameCell = (raw: string) => (/\[\[([^\]|#]+)/.exec(raw)?.[1] ?? raw).trim();

function readStarRow(cells: string[], cols: (StarColumn | undefined)[]): { row?: StarTypeRow; problem?: string } {
  const star = nameCell(cellOf(cells, cols, "Star"));
  if (!star) return { problem: "no star" };
  const row: StarTypeRow = { star };
  const w = cellOf(cells, cols, "Weight");
  if (w) {
    const n = readWeight(w);
    if (!Number.isFinite(n)) return { problem: `weight "${w}" isn't a number` };
    row.weight = n;
  }
  const notes = cellOf(cells, cols, "Notes");
  if (notes) row.notes = notes;
  return { row };
}

function readFeatureRow(cells: string[], cols: (FeatureColumn | undefined)[]): { row?: SectorFeatureRow; problem?: string } {
  const feature = nameCell(cellOf(cells, cols, "Feature"));
  if (!feature) return { problem: "no feature" };
  const c = cellOf(cells, cols, "Chance");
  const chance = readChance(c);
  if (!Number.isFinite(chance)) return { problem: c ? `chance "${c}" should look like 1 in 50 or 2%` : "no chance (like 1 in 50 or 2%)" };
  const row: SectorFeatureRow = { feature, chance };
  const notes = cellOf(cells, cols, "Notes");
  if (notes) row.notes = notes;
  return { row };
}

/** The frontmatter's `hexmaker-world-types:` number. */
function readFormat(lines: string[]): number | undefined {
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = new RegExp(`^\\s*${WORLD_TYPES_MARKER}:\\s*(\\d+)\\s*$`).exec(lines[i]);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** The lines with the frontmatter's format number set to the current one (when it has one). */
function withFormat(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  for (let i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = new RegExp(`^(\\s*${WORLD_TYPES_MARKER}:\\s*)\\d+(\\s*)$`).exec(lines[i]);
    if (!m) continue;
    const out = [...lines];
    out[i] = `${m[1]}${WORLD_TYPES_FORMAT}${m[2]}`;
    return out;
  }
  return lines;
}

/** One table row → a row, or why it can't be read. */
function readRow(cells: string[], cols: (Column | undefined)[]): { row?: WorldTypeRow; problem?: string } {
  const cell = (c: Column) => {
    const i = cols.indexOf(c);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const worldRaw = cell("World");
  const world = (/\[\[([^\]|#]+)/.exec(worldRaw)?.[1] ?? worldRaw).trim();
  if (!world) return { problem: "no world" };
  const row: WorldTypeRow = { world };
  const w = cell("Weight");
  if (w) {
    const n = readWeight(w);
    if (!Number.isFinite(n)) return { problem: `weight "${w}" isn't a number` };
    row.weight = n;
  }
  const m = readMap(cell("Map"));
  if (m === null) return { problem: `map "${cell("Map")}" should be sector or system` };
  if (m) row.map = m;
  const o = readOrbit(cell("Orbit"));
  if (!o) return { problem: `orbit "${cell("Orbit")}" should be inner, habitable, outer or rings like 2–4` };
  if (o.zones?.length) row.zones = o.zones;
  if (o.distance) row.distance = o.distance;
  const stars = readList(cell("Stars"));
  if (stars.length) row.stars = stars;
  const t = cell("Temperature");
  if (t) {
    // Any doubt (even a range written backwards) leaves the row as written.
    const r = parseClimateRange(t, TEMPERATURE_WORDS);
    if (r.problem) return { problem: `temperature ${r.problem}` };
    if (r.range) row.temperature = r.range;
  }
  const s = cell("Size");
  if (s) {
    const size = readSize(s);
    if (!size) return { problem: `size "${s}" should look like 20×14 or 16–24 × 10–14` };
    row.size = size;
  }
  const g = readGenerator(cell("Generator"));
  if (g) row.generator = g;
  const opts = readOptions(cell("Options"));
  if (!opts) return { problem: `options "${cell("Options")}" should look like water=85, climate=lush` };
  if (Object.keys(opts).length) row.options = opts;
  if (cell("Palette")) row.palette = cell("Palette");
  if (cell("Base")) row.baseTerrain = cell("Base");
  if (cell("Notes")) row.notes = cell("Notes");
  return { row };
}

/** Read one table's rows into `rows`; rows that can't be read go to `unreadable` and `problems`. */
function readInto<C extends string, R>(
  lines: string[],
  t: Span<C>,
  read: (cells: string[], cols: (C | undefined)[]) => { row?: R; problem?: string },
  label: string,
  rows: R[],
  problems: WorldTypeProblem[],
  unreadable: string[],
): void {
  for (let i = t.start + 2; i < t.end; i++) {
    const cells = splitRow(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const { row, problem } = read(cells, t.cols);
    if (row) rows.push(row);
    else {
      problems.push({ line: i + 1, text: `${label}row ${i + 1}: ${problem ?? "can't be read"} (left as written, not used)` });
      unreadable.push(lines[i]);
    }
  }
}

/** Read a world types note (worlds, and the Stars and Sector features tables when it has them). Never throws. */
export function parseWorldTypes(content: string): ParsedWorldTypes {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: ParsedWorldTypes = { rows: [], problems: [], unreadable: [], unreadableStars: [], unreadableFeatures: [] };
  const format = readFormat(lines);
  if (format !== undefined) out.format = format;
  const t = findTable(lines);
  if (t) readInto(lines, t, readRow, "", out.rows, out.problems, out.unreadable);
  else out.problems.push({ text: "no table with a World column" });
  const s = findStars(lines);
  if (s) {
    out.stars = [];
    readInto(lines, s, readStarRow, "Stars ", out.stars, out.problems, out.unreadableStars);
  }
  const f = findFeatures(lines);
  if (f) {
    out.features = [];
    readInto(lines, f, readFeatureRow, "Sector features ", out.features, out.problems, out.unreadableFeatures);
    const total = out.features.reduce((a, r) => a + r.chance, 0);
    if (total > 1 + 1e-9) out.problems.push({ text: `Sector features: the chances add up to over 100% (${Math.round(total * 1000) / 10}%), so the last ones come up less` });
  }
  return out;
}

const esc = (s: string) => s.replace(/\|/g, "\\|");
const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** A row as the note's table cells, in COLUMNS order. */
export function worldTypeCells(r: WorldTypeRow): string[] {
  return [
    r.world,
    r.weight === undefined ? "" : fmtNum(r.weight),
    r.map ?? "",
    formatOrbit(r),
    (r.stars ?? []).join(", "),
    r.temperature ? formatClimateRange(r.temperature, TEMPERATURE_WORDS) : "",
    r.size ? formatSize(r.size) : "",
    formatGenerator(r.generator),
    formatOptions(r.options),
    r.palette ?? "",
    r.baseTerrain ?? "",
    r.notes ?? "",
  ];
}

/** A Stars row as the note's cells, in STAR_COLUMNS order. */
export function starCells(r: StarTypeRow): string[] {
  return [r.star, r.weight === undefined ? "" : fmtNum(r.weight), r.notes ?? ""];
}

/** A Sector features row as the note's cells, in FEATURE_COLUMNS order. */
export function featureCells(r: SectorFeatureRow): string[] {
  return [r.feature, formatChance(r.chance), r.notes ?? ""];
}

function markdownTable(columns: readonly string[], rightAligned: string, cells: string[][], keep: readonly string[]): string[] {
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map((c) => (c === rightAligned ? "---:" : "---")).join(" | ")} |`,
    ...cells.map((row) => `| ${row.map((c) => (c.startsWith("[[") ? c : esc(c))).join(" | ")} |`),
    ...keep,
  ];
}

const tableLines = (rows: readonly WorldTypeRow[], keep: readonly string[] = []) =>
  markdownTable(COLUMNS, "Weight", rows.map(worldTypeCells), keep);
const starTableLines = (rows: readonly StarTypeRow[], keep: readonly string[] = []) =>
  markdownTable(STAR_COLUMNS, "Weight", rows.map(starCells), keep);
const featureTableLines = (rows: readonly SectorFeatureRow[], keep: readonly string[] = []) =>
  markdownTable(FEATURE_COLUMNS, "Chance", rows.map(featureCells), keep);

/** The Stars and Sector features tables a note is given (each optional). */
export interface WorldTypeExtras {
  stars?: readonly StarTypeRow[];
  features?: readonly SectorFeatureRow[];
}

/** A fresh table note (Stars and Sector features are written even when empty). */
export function buildWorldTypes(name: string, rows: readonly WorldTypeRow[], extras: WorldTypeExtras = {}): string {
  return [
    "---", `${WORLD_TYPES_MARKER}: ${WORLD_TYPES_FORMAT}`, "---", "",
    `# ${name}`, "",
    ...WORLD_TYPES_HELP, "",
    ...tableLines(rows), "",
    STARS_HEADING, "",
    ...STARS_HELP, "",
    ...starTableLines(extras.stars ?? []), "",
    FEATURES_HEADING, "",
    ...FEATURES_HELP, "",
    ...featureTableLines(extras.features ?? []), "",
  ].join("\n");
}

/** Rows compared as their cells (the name in any case). */
function sameRows<R>(a: readonly R[], b: readonly R[], cellsOf: (r: R) => string[]): boolean {
  const key = (r: R) => JSON.stringify(cellsOf(r).map((c, i) => (i === 0 ? c.toLowerCase() : c)));
  return a.length === b.length && a.every((r, i) => key(r) === key(b[i]));
}

/** `table` in place of the span, or appended at the end after `head` (a heading and help). */
function putTable(lines: string[], span: Span<string> | null, table: string[], head: string[]): string[] {
  if (span) return [...lines.slice(0, span.start), ...table, ...lines.slice(span.end)];
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  out.push("", ...head, ...table, "");
  return out;
}

/**
 * The note with its worlds table set to `rows` and, when given, its Stars
 * and Sector features tables set too (added under their heading when the
 * note has none). Everything else is kept, and so are rows that couldn't
 * be read (after the new rows of their table, as written). A table that
 * didn't change isn't rewritten; same string when nothing changes.
 */
export function updateWorldTypes(content: string, rows: readonly WorldTypeRow[], extras: WorldTypeExtras = {}): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  let lines = content.replace(/\r\n?/g, "\n").split("\n");
  const parsed = parseWorldTypes(content);
  let changed = false;
  const t = findTable(lines);
  if (!t || !sameRows(parsed.rows, rows, worldTypeCells)) {
    lines = putTable(lines, t, tableLines(rows, parsed.unreadable), []);
    changed = true;
  }
  if (extras.stars && !(parsed.stars && sameRows(parsed.stars, extras.stars, starCells))) {
    lines = putTable(lines, findStars(lines), starTableLines(extras.stars, parsed.unreadableStars), [STARS_HEADING, "", ...STARS_HELP, ""]);
    changed = true;
  }
  if (extras.features && !(parsed.features && sameRows(parsed.features, extras.features, featureCells))) {
    lines = putTable(lines, findFeatures(lines), featureTableLines(extras.features, parsed.unreadableFeatures), [FEATURES_HEADING, "", ...FEATURES_HELP, ""]);
    changed = true;
  }
  if (!changed) return content;
  if (findStars(lines) && findFeatures(lines)) lines = withFormat(lines);
  return lines.join(eol);
}

/**
 * A format 1 note (written before stars and sector features were rows)
 * given the shipped Stars and Sector features tables it doesn't have, and
 * marked format 2, so it keeps placing what the generators always did.
 * Anything else (format 2, or a note without the marker) comes back as is.
 */
export function upgradeWorldTypes(content: string, defaults: Required<WorldTypeExtras>): string {
  const p = parseWorldTypes(content);
  if (p.format === undefined || p.format >= WORLD_TYPES_FORMAT) return content;
  const next = updateWorldTypes(content, p.rows, {
    stars: p.stars ? undefined : defaults.stars,
    features: p.features ? undefined : defaults.features,
  });
  const eol = next.includes("\r\n") ? "\r\n" : "\n";
  const marked = withFormat(next.replace(/\r\n?/g, "\n").split("\n")).join(eol);
  return marked;
}

/** A deep copy of rows (callers may change it). */
export function copyWorldTypeRows(rows: readonly WorldTypeRow[]): WorldTypeRow[] {
  return rows.map((r) => {
    const c: WorldTypeRow = { ...r };
    if (r.zones) c.zones = [...r.zones];
    if (r.distance) c.distance = { ...r.distance };
    if (r.stars) c.stars = [...r.stars];
    if (r.temperature) c.temperature = { ...r.temperature };
    if (r.size) c.size = { cols: { ...r.size.cols }, rows: { ...r.size.rows } };
    if (r.generator) c.generator = { ...r.generator };
    if (r.options) c.options = { ...r.options };
    return c;
  });
}

/**
 * Cells in WORLD_TYPE_COLUMNS order → a row, or what's wrong (the
 * editor's check; the same reading as the note's).
 */
export function readWorldTypeCells(cells: readonly string[]): { row?: WorldTypeRow; problem?: string } {
  return readRow([...cells], [...COLUMNS]);
}

/** Cells in STAR_COLUMNS order → a Stars row, or what's wrong. */
export function readStarCells(cells: readonly string[]): { row?: StarTypeRow; problem?: string } {
  return readStarRow([...cells], [...STAR_COLUMNS]);
}

/** Cells in FEATURE_COLUMNS order → a Sector features row, or what's wrong. */
export function readFeatureCells(cells: readonly string[]): { row?: SectorFeatureRow; problem?: string } {
  return readFeatureRow([...cells], [...FEATURE_COLUMNS]);
}

export const copyStarRows = (rows: readonly StarTypeRow[]): StarTypeRow[] => rows.map((r) => ({ ...r }));
export const copyFeatureRows = (rows: readonly SectorFeatureRow[]): SectorFeatureRow[] => rows.map((r) => ({ ...r }));

/** Each fitting world's exact odds (0..1) for a context, most likely first. */
export function worldTypeOdds(table: WorldTypeTable, ctx: Omit<WorldTypeContext, "seed"> & { seed?: number }): { world: string; odds: number }[] {
  const w = worldTypeWeights(table, ctx);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const names = new Map(matchingWorldTypes(table, ctx).map((r) => [lc(r.world), r.world.trim()]));
  return Object.entries(w)
    .map(([k, v]) => ({ world: names.get(k) ?? k, odds: v / total }))
    .sort((a, b) => b.odds - a.odds || a.world.localeCompare(b.world));
}

/** Roll `n` worlds (seeds `seed`, `seed + 1`, …) and count them, most rolled first. */
export function rollWorldTypes(table: WorldTypeTable, ctx: Omit<WorldTypeContext, "seed" | "rand">, n: number, seed = 1): { world: string; count: number }[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = pickWorldType(table, { ...ctx, seed: seed + i });
    if (p) counts.set(p.terrain, (counts.get(p.terrain) ?? 0) + 1);
  }
  return [...counts].map(([world, count]) => ({ world, count })).sort((a, b) => b.count - a.count || a.world.localeCompare(b.world));
}

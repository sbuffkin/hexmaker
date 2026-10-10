/**
 * Built-in biome and preset generators: hand-written hex-wfc generators
 * shipped with the plugin (src/worldgen/builtin/*.md). They were written
 * against the Expanded palette, so each of their terrains has a terrain
 * TYPE there ("mixed forest heavy" is forest, "Mountain Ridge" is
 * mountains). Before running, a generator is fitted to the map's palette by
 * type: same name first, else a palette terrain of the same type, else of a
 * related type (peaks → mountains → hills). Terrains that land on the same
 * palette terrain are merged into one entry. So they work with Limited,
 * Expanded, and custom palettes whose terrains have types.
 */

import {
  isEdgeAnchor,
  parseModelMarkdown,
  pathRouteKey,
  isModelMarkdown,
  type AdjacencyEntry,
  type CountRange,
  type HexWfcModel,
  type NearRule,
  type PathFeature,
  type PathTweak,
  type TerrainEntry,
} from "../../packages/hex-wfc/src";
import type { TerrainColor } from "../types";
import { DEFAULT_TERRAIN_PALETTE } from "../constants";
import { inferTerrainType } from "../terrainTypes";

import biomeAlpine from "./builtin/biome-alpine.md";
import biomeBadlands from "./builtin/biome-badlands.md";
import biomeCoastalFjord from "./builtin/biome-coastal-fjord.md";
import biomeGrassland from "./builtin/biome-grassland.md";
import biomeJungle from "./builtin/biome-jungle.md";
import biomeKarst from "./builtin/biome-karst.md";
import biomeRiverDelta from "./builtin/biome-river-delta.md";
import biomeSavanna from "./builtin/biome-savanna.md";
import biomeSwamp from "./builtin/biome-swamp.md";
import biomeTaiga from "./builtin/biome-taiga.md";
import biomeTemperateForest from "./builtin/biome-temperate-forest.md";
import biomeTundra from "./builtin/biome-tundra.md";
import presetArchipelago from "./builtin/preset-archipelago.md";
import presetDeepForest from "./builtin/preset-deep-forest.md";
import presetValley from "./builtin/preset-valley.md";
import presetVolcanic from "./builtin/preset-volcanic.md";

export const BUILTIN_PREFIX = "builtin:";

export interface BuiltinGeneratorDef {
  /** File name without .md; the generator id is `builtin:<slug>`. */
  slug: string;
  label: string;
  description: string;
}

/** Card label + text for each shipped generator, in display order. */
export const BUILTIN_GENERATORS: BuiltinGeneratorDef[] = [
  { slug: "biome-grassland", label: "Grassland", description: "Biome: open grass and steppe with rolling hills, copses, reedy lakes and a lone ridge." },
  { slug: "biome-temperate-forest", label: "Temperate forest", description: "Biome: mixed woodland, old-growth stands, wooded hills, glades and small lakes." },
  { slug: "biome-taiga", label: "Taiga", description: "Biome: dark evergreen forest dotted with small lakes and bogs." },
  { slug: "biome-tundra", label: "Tundra", description: "Biome: snowfields, low hills and frozen lakes ringed by bog." },
  { slug: "biome-alpine", label: "Alpine", description: "Biome: snowy mountains cut by ridges and cliffs, peaks and high valleys." },
  { slug: "biome-badlands", label: "Badlands", description: "Biome: eroded rock and stony desert cut by canyons, with salt flats." },
  { slug: "biome-savanna", label: "Savanna", description: "Biome: grassland with bare earth, lone trees, thornbush and waterholes." },
  { slug: "biome-jungle", label: "Jungle", description: "Biome: dense jungle with rivers, clearings and the odd settlement." },
  { slug: "biome-swamp", label: "Swamp", description: "Biome: swamp, marsh and bog threaded by channels, with drier wooded hummocks." },
  { slug: "biome-karst", label: "Karst", description: "Biome: green valley floors studded with limestone towers." },
  { slug: "biome-river-delta", label: "River delta", description: "Biome: a great river splitting into channels across marsh to the sea." },
  { slug: "biome-coastal-fjord", label: "Coastal fjord", description: "Biome: sea on the west with long narrow inlets cutting into steep land." },
  { slug: "preset-archipelago", label: "Archipelago", description: "Preset: open ocean with islands of varied size, ringed by beaches." },
  { slug: "preset-deep-forest", label: "Deep forest", description: "Preset: old, heavy woods thinning at the edge, with clearings and a hamlet or two." },
  { slug: "preset-valley", label: "Valley", description: "Preset: a green river valley between ranges of hills and mountains." },
  { slug: "preset-volcanic", label: "Volcanic", description: "Preset: volcanoes ringed by mountains, lava flows and ash." },
];

const SOURCES: Record<string, string> = {
  "biome-alpine": biomeAlpine,
  "biome-badlands": biomeBadlands,
  "biome-coastal-fjord": biomeCoastalFjord,
  "biome-grassland": biomeGrassland,
  "biome-jungle": biomeJungle,
  "biome-karst": biomeKarst,
  "biome-river-delta": biomeRiverDelta,
  "biome-savanna": biomeSavanna,
  "biome-swamp": biomeSwamp,
  "biome-taiga": biomeTaiga,
  "biome-temperate-forest": biomeTemperateForest,
  "biome-tundra": biomeTundra,
  "preset-archipelago": presetArchipelago,
  "preset-deep-forest": presetDeepForest,
  "preset-valley": presetValley,
  "preset-volcanic": presetVolcanic,
};

/** Parse a shipped generator's Markdown; undefined if it isn't one. */
export function parseBuiltin(text: string, slug: string): HexWfcModel | undefined {
  if (!text || !isModelMarkdown(text)) return undefined;
  try {
    return parseModelMarkdown(text, slug).model;
  } catch {
    return undefined;
  }
}

const parsed = new Map<string, HexWfcModel | undefined>();

/** The shipped model for a slug (parsed once). */
export function builtinModel(slug: string): HexWfcModel | undefined {
  if (!parsed.has(slug)) parsed.set(slug, parseBuiltin(SOURCES[slug] ?? "", slug));
  return parsed.get(slug);
}

/** Terrain type of each Expanded terrain (lower-case name → type). */
const REFERENCE_TYPES = new Map(
  DEFAULT_TERRAIN_PALETTE.filter((t) => t.type).map((t) => [t.name.toLowerCase(), t.type!]),
);

/**
 * Types to try, in order, when a palette has no terrain of a generator
 * terrain's own type. Settlements have none: a town scattered as grass is
 * just noise, so it's dropped.
 */
export const TYPE_FALLBACKS: Record<string, string[]> = {
  "deep-water": ["water", "shallows"],
  water: ["shallows", "deep-water"],
  shallows: ["water", "deep-water"],
  coast: ["desert", "grassland"],
  grassland: ["hills", "desert"],
  forest: ["jungle", "grassland"],
  jungle: ["forest", "grassland"],
  wetland: ["grassland", "water"],
  hills: ["mountains", "grassland"],
  mountains: ["peaks", "hills"],
  peaks: ["mountains", "snow", "hills"],
  snow: ["peaks", "mountains"],
  desert: ["badlands", "coast", "grassland"],
  badlands: ["desert", "hills"],
  volcanic: ["mountains", "badlands", "hills"],
  settlement: [],
};

/** A palette terrain's type: its own, else guessed from its name. */
function typeOf(t: TerrainColor): string | undefined {
  return t.type ?? inferTerrainType(t.name, t.category, "world");
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(Boolean));

/**
 * Palette terrain for each generator terrain (generator name → palette
 * name). Generator terrains with no match are left out.
 */
export function mapTerrainsByType(model: HexWfcModel, palette: TerrainColor[]): Map<string, string> {
  const byName = new Map(palette.map((t) => [t.name.toLowerCase(), t.name]));
  const byType = new Map<string, TerrainColor[]>();
  for (const t of palette) {
    const ty = typeOf(t);
    if (!ty) continue;
    byType.set(ty, [...(byType.get(ty) ?? []), t]);
  }
  const out = new Map<string, string>();
  for (const { name } of model.terrains) {
    const exact = byName.get(name.toLowerCase());
    if (exact) { out.set(name, exact); continue; }
    const type = REFERENCE_TYPES.get(name.toLowerCase()) ?? inferTerrainType(name, undefined, "world");
    if (!type) continue;
    for (const ty of [type, ...(TYPE_FALLBACKS[type] ?? [])]) {
      const cands = byType.get(ty);
      if (!cands?.length) continue;
      // Most shared words wins ("mixed forest heavy" → "dark forest" over
      // "pine"), then palette order.
      const want = words(name);
      let best = cands[0];
      let bestScore = -1;
      for (const c of cands) {
        const score = [...words(c.name)].filter((w) => want.has(w)).length;
        if (score > bestScore) { best = c; bestScore = score; }
      }
      out.set(name, best.name);
      break;
    }
  }
  return out;
}

/**
 * The model with its terrains renamed to palette terrains (`mapping`).
 * Terrains mapped to the same palette terrain become one entry: weights add
 * up, sizes and edge preference average by weight, the heaviest one's shape
 * wins. Rules that only made sense for one of them (near rules, counts,
 * mix, impassable) are kept only when every merged terrain agrees.
 * Unmapped terrains are dropped (with their rows).
 */
export function remapModel(model: HexWfcModel, mapping: Map<string, string>): HexWfcModel {
  const to = (n: string) => mapping.get(n);
  const sources = new Map<string, TerrainEntry[]>();
  for (const t of model.terrains) {
    const target = to(t.name);
    if (!target) continue;
    sources.set(target, [...(sources.get(target) ?? []), t]);
  }
  const single = (target: string) => (sources.get(target)?.length ?? 0) === 1;

  const terrains: TerrainEntry[] = [];
  for (const [name, list] of sources) {
    const total = list.reduce((s, t) => s + t.weight, 0);
    const heaviest = list.reduce((a, b) => (b.weight > a.weight ? b : a));
    const avg = (pick: (t: TerrainEntry) => number | undefined): number | undefined => {
      const vals = list.filter((t) => pick(t) !== undefined);
      if (!vals.length) return undefined;
      const w = vals.reduce((s, t) => s + Math.max(t.weight, 1e-6), 0);
      return vals.reduce((s, t) => s + pick(t)! * Math.max(t.weight, 1e-6), 0) / w;
    };
    const entry: TerrainEntry = { name, weight: total };
    const patch = avg((t) => t.patch);
    if (patch !== undefined) entry.patch = patch;
    if (heaviest.shape) entry.shape = heaviest.shape;
    if (heaviest.turn !== undefined) entry.turn = heaviest.turn;
    if (heaviest.width !== undefined) entry.width = heaviest.width;
    if (heaviest.spacing !== undefined) entry.spacing = heaviest.spacing;
    const edge = avg((t) => t.edge);
    if (edge !== undefined) entry.edge = edge;
    const layouts = list.filter((t) => t.layout);
    if (layouts.length === list.length && layouts.every((t) => t.layout!.length === layouts[0].layout!.length)) {
      const w = list.reduce((s, t) => s + Math.max(t.weight, 1e-6), 0);
      entry.layout = layouts[0].layout!.map((_, i) =>
        list.reduce((s, t) => s + t.layout![i] * Math.max(t.weight, 1e-6), 0) / w);
    } else if (list.length === 1 && heaviest.layout) {
      entry.layout = [...heaviest.layout];
    }
    const near = agreedNear(list.map((t) => t.near), to, name);
    if (near) entry.near = near;
    terrains.push(entry);
  }

  const adjacency: AdjacencyEntry[] = [];
  for (const e of model.adjacency) {
    const a = to(e.a);
    const b = to(e.b);
    if (a && b) adjacency.push({ a, b, weight: e.weight });
  }

  const end = (e: string) => (isEdgeAnchor(e) || e === "none" || e === "path" ? e : to(e) ?? e);
  const paths: PathFeature[] | undefined = model.paths?.map((p) => {
    const through: Record<string, number> = {};
    for (const [t, share] of Object.entries(p.through)) {
      const m = to(t);
      if (m) through[m] = (through[m] ?? 0) + share;
    }
    return { ...p, from: end(p.from), to: end(p.to), through };
  });

  const out: HexWfcModel = {
    ...model,
    terrains,
    adjacency,
    meta: { ...model.meta },
  };
  if (model.features) {
    out.features = model.features.map((f) => ({ ...f, terrain: to(f.terrain) ?? f.terrain, from: end(f.from), to: end(f.to) }));
  }
  if (paths) out.paths = paths;

  if (model.settings) {
    const s = { ...model.settings };
    if (s.counts) {
      const counts: Record<string, CountRange> = {};
      for (const [t, c] of Object.entries(s.counts)) {
        const m = to(t);
        if (m && single(m)) counts[m] = { ...c };
      }
      s.counts = counts;
    }
    if (s.mix) {
      const mix: Record<string, number> = {};
      for (const [t, v] of Object.entries(s.mix)) {
        const m = to(t);
        if (m && single(m)) mix[m] = v;
      }
      s.mix = mix;
    }
    if (s.impassable) {
      // Impassable only when everything merged into it was.
      const blocked = new Set(s.impassable);
      const keep = [...sources].filter(([, list]) => list.every((t) => blocked.has(t.name))).map(([n]) => n);
      if (keep.length) s.impassable = keep;
      else delete s.impassable;
    }
    if (s.edgeTerrain) {
      const m = to(s.edgeTerrain);
      if (m) s.edgeTerrain = m;
      else delete s.edgeTerrain;
    }
    if (s.near) {
      const near: Record<string, NearRule | null> = {};
      for (const [t, rule] of Object.entries(s.near)) {
        const m = to(t);
        if (!m || !single(m)) continue;
        if (rule === null) { near[m] = null; continue; }
        const target = to(rule.terrain);
        if (target && target !== m) near[m] = { terrain: target, distance: rule.distance };
      }
      s.near = near;
    }
    if (s.paths && model.paths) {
      const tweaks: Record<string, PathTweak> = {};
      model.paths.forEach((p, i) => {
        const tweak = s.paths![pathRouteKey(p)];
        if (tweak && paths) tweaks[pathRouteKey(paths[i])] = { ...tweak };
      });
      s.paths = tweaks;
    }
    out.settings = s;
  }
  return out;
}

/** A merged terrain's near rule: kept only if every source has the same one. */
function agreedNear(
  rules: (NearRule | undefined)[],
  to: (n: string) => string | undefined,
  self: string,
): NearRule | undefined {
  if (!rules.length || rules.some((r) => !r)) return undefined;
  const targets = new Set(rules.map((r) => to(r!.terrain)));
  if (targets.size !== 1) return undefined;
  const target = [...targets][0];
  if (!target || target === self) return undefined;
  return { terrain: target, distance: Math.max(...rules.map((r) => r!.distance)) };
}

/**
 * Share of the generator's terrain (by weight) the palette must cover, and
 * how many different palette terrains it must spread over, to be offered.
 */
const MIN_COVERED = 0.75;
const MIN_DISTINCT = 3;

/**
 * The generator fitted to a palette, or undefined when the palette can't
 * carry it (space palettes; palettes with too few typed land/water terrains).
 */
export function fitBuiltinModel(model: HexWfcModel, palette: TerrainColor[]): HexWfcModel | undefined {
  const mapping = mapTerrainsByType(model, palette);
  const total = model.terrains.reduce((s, t) => s + t.weight, 0);
  const covered = model.terrains.filter((t) => mapping.has(t.name)).reduce((s, t) => s + t.weight, 0);
  const distinct = new Set(model.terrains.filter((t) => t.weight > 0).map((t) => mapping.get(t.name)).filter(Boolean));
  if (total <= 0 || covered / total < MIN_COVERED || distinct.size < Math.min(MIN_DISTINCT, model.terrains.length)) return undefined;
  return remapModel(model, mapping);
}

/**
 * The map path type a shipped generator's path is drawn as. Shipped
 * generators draw streams, creeks and trails too; vaults that don't have
 * those path types get them as their river / road type instead.
 */
export function builtinPathType(type: string, known: string[]): string {
  if (known.includes(type)) return type;
  const lower = known.map((k) => k.toLowerCase());
  const pick = (re: RegExp) => known[lower.findIndex((k) => re.test(k))];
  if (/stream|creek|brook|river/i.test(type)) return pick(/river/) ?? type;
  if (/trail|track|road|path/i.test(type)) return pick(/road/) ?? type;
  return type;
}

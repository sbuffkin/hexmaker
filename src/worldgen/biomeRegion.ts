/**
 * Regions made by a generator (#50, the generator side of custom biomes):
 * a biome whose note links a generator (`generator: [[…]]`) has its
 * overworld regions made by that generator instead of the blend field.
 * biomeForm.regionGenerator is the routing point; regionsVault calls
 * generateBiomeRegion for such biomes.
 *
 * The region is solved with a one-hex ring around its bounding box, every
 * pinned cell in reach fixed (the neighbouring regions' painted cells and
 * the region's own locked ones), then cropped to the region's mask, so the
 * seams join up the same way a neighbouring map's edge does
 * (neighbours.ts solveWithRing, shared with generateConnected).
 */

import { TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexKey, MapPath, PathType, TerrainPalette } from "../types";
import { isModelMarkdown, type GeneratorSettings, type HexWfcModel } from "../../packages/hex-wfc/src";
import { drawnPathType, generatorFitsPalette, parseGeneratorText, toPathsOn, type GridSpec } from "./generators";
import { BUILTIN_GENERATORS, BUILTIN_PREFIX, builtinModel, builtinPathType, fitBuiltinModel } from "./builtinGenerators";
import { solveWithRing } from "./neighbours";
import { listGeneratorKinds, optionsWithDefaults } from "./registry";
import type { GenerationContext } from "./procedural/common";
import { mapRouteContext } from "../paths/mapContext";
import { impassableNames } from "../impassable";
import { hexXY } from "../hexKey";

/**
 * Which generator makes the region:
 * - `{ path }`: a generator note (learned or blend), by vault path or link
 *   target (`world/generators/My tundra`, with or without `.md`); a shipped
 *   generator's slug or label is accepted too (no file needed);
 * - `{ builtin }`: a shipped preset generator by slug (`preset-volcanic`);
 * - `{ id }`: a generator id from the registry (`wfc:<path>`,
 *   `builtin:<slug>`, or a procedural one such as `overland`);
 * - `{ model, source }`: a generator already in memory (the generator page,
 *   tests). Preset models are fitted to the palette first.
 */
export type GeneratorRef =
  | { path: string }
  | { builtin: string }
  | { id: string }
  | { model: HexWfcModel; source: "learned" | "blend" | "preset" };

export interface BiomeRegionRequest {
  generator: GeneratorRef;
  /** The palette the region is painted with. */
  palette: TerrainPalette;
  /** The region's bounding box in the shared grid (stagger: default the plugin's). */
  bounds: { cols: number; rows: number; offset: { x: number; y: number }; stagger?: "odd" | "even" };
  /** Which cells of the box are the region's (hex flowers); default all. */
  mask?: (key: HexKey) => boolean;
  /** Cells already painted (neighbouring regions, the region's locked cells): never changed. */
  pinned: Map<HexKey, string>;
  seed: number;
  /** Parent hex / neighbours, for procedural generators that read it. */
  context?: GenerationContext;
  /**
   * Engine settings over the generator's own (a biome's Engine tuning,
   * biomeTuning.ts). Only hex-wfc generators read them; empty = as saved.
   */
  settings?: GeneratorSettings;
}

export interface BiomeRegionResult {
  /** The region's cells (pinned ones inside it come out as they were). */
  cells: Map<HexKey, string>;
  /** Paths the generator drew, anchored on the region's own terrain; only when it made some. */
  paths?: MapPath[];
  /** Anything worth telling the user (edge pins dropped, path types missing). */
  note?: string;
}

/** Thrown when a region can't be made; `message` says why, for the user. */
export class BiomeRegionError extends Error {}

interface Loaded {
  name: string;
  /** A hex-wfc model (learned, blend or fitted preset), or a registry kind id. */
  model?: HexWfcModel;
  kindId?: string;
  preset: boolean;
}

const nameOf = (target: string) => target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** A shipped generator by slug or label (case-insensitive). */
function builtinBy(name: string): string | undefined {
  const k = name.trim().toLowerCase();
  return BUILTIN_GENERATORS.find((d) => d.slug === k || d.label.toLowerCase() === k)?.slug;
}

async function load(plugin: HexmakerPlugin, ref: GeneratorRef): Promise<Loaded> {
  if ("model" in ref) return { name: ref.model.name, model: ref.model, preset: ref.source === "preset" };
  if ("builtin" in ref) {
    const model = builtinModel(ref.builtin);
    if (!model) throw new BiomeRegionError(`There's no shipped generator called ${ref.builtin}.`);
    return { name: BUILTIN_GENERATORS.find((d) => d.slug === ref.builtin)?.label ?? ref.builtin, model, preset: true };
  }
  if ("id" in ref) {
    if (ref.id.startsWith("wfc:")) return load(plugin, { path: ref.id.slice(4) });
    if (ref.id.startsWith(BUILTIN_PREFIX)) return load(plugin, { builtin: ref.id.slice(BUILTIN_PREFIX.length) });
    return { name: ref.id, kindId: ref.id, preset: false };
  }
  const target = ref.path.trim();
  const vault = plugin.app.vault;
  const file = vault.getAbstractFileByPath(target) ?? vault.getAbstractFileByPath(`${target}.md`) ?? plugin.app.metadataCache.getFirstLinkpathDest(target, "");
  if (file instanceof TFile) {
    const text = await vault.cachedRead(file);
    if (!isModelMarkdown(text)) throw new BiomeRegionError(`${file.basename} isn't a generator note.`);
    try {
      return { name: file.basename, model: parseGeneratorText(text, file.basename).model, preset: false };
    } catch (e) {
      throw new BiomeRegionError(`Couldn't read generator ${file.basename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const slug = builtinBy(nameOf(target));
  if (slug) return load(plugin, { builtin: slug });
  throw new BiomeRegionError(`Generator ${nameOf(target)} wasn't found.`);
}

/** A generator with some of its engine settings replaced (the file is untouched). */
export function withSettings(model: HexWfcModel, settings: GeneratorSettings): HexWfcModel {
  return { ...model, settings: { ...model.settings, ...settings } };
}

/**
 * Make one overworld region with a generator, joined to the cells already
 * painted around it. Pinned cells come out unchanged; the same seed gives
 * the same region. Throws BiomeRegionError (readable message) when the
 * generator can't be found or doesn't fit the palette.
 */
export async function generateBiomeRegion(plugin: HexmakerPlugin, req: BiomeRegionRequest): Promise<BiomeRegionResult> {
  const loaded = await load(plugin, req.generator);
  const terrains = req.palette.terrains;
  const names = terrains.map((t) => t.name);
  const stagger = req.bounds.stagger ?? plugin.settings.staggerOffset ?? "odd";
  const grid: GridSpec = { cols: req.bounds.cols, rows: req.bounds.rows, offset: { ...req.bounds.offset }, stagger };
  const inBox = (k: string) => {
    const { x, y } = hexXY(k);
    return x >= grid.offset.x && x < grid.offset.x + grid.cols && y >= grid.offset.y && y < grid.offset.y + grid.rows;
  };
  const mine = (k: string) => inBox(k) && (!req.mask || req.mask(k));
  const pathTypes: readonly PathType[] = req.palette.pathTypes ?? plugin.getPathTypes(req.palette.name);

  let cells: Map<string, string>;
  let raw: { type: string; route?: string; hexes: string[] }[] = [];
  let model: HexWfcModel | undefined;
  const warnings: string[] = [];

  if (loaded.kindId) {
    const kind = (await listGeneratorKinds(plugin)).find((k) => k.id === loaded.kindId);
    if (!kind) throw new BiomeRegionError(`There's no generator ${loaded.kindId}.`);
    if (!kind.fits(terrains)) throw new BiomeRegionError(`${kind.label} doesn't fit palette ${req.palette.name}.`);
    const out = kind.generate({ terrains, grid, seed: req.seed, options: optionsWithDefaults(kind), pathTypes, context: req.context });
    if (!out.ok) throw new BiomeRegionError(`${kind.label}: ${out.message}`);
    cells = out.cells;
    raw = out.paths;
    warnings.push(...out.warnings);
  } else {
    model = loaded.model!;
    if (loaded.preset) {
      const fit = fitBuiltinModel(model, terrains);
      if (!fit) throw new BiomeRegionError(`${loaded.name} doesn't fit palette ${req.palette.name}: it has too few terrains with a type for it.`);
      model = fit;
    } else if (!generatorFitsPalette(model, names)) {
      const missing = model.terrains.filter((t) => t.weight > 0 && !names.includes(t.name)).map((t) => t.name);
      throw new BiomeRegionError(
        missing.length
          ? `${loaded.name} doesn't fit palette ${req.palette.name}: it uses ${missing.join(", ")}, which the palette doesn't have.`
          : `${loaded.name} has no terrains to place.`,
      );
    }
    if (req.settings && Object.keys(req.settings).length) model = withSettings(model, req.settings);
    const r = solveWithRing(plugin, model, names, grid, req.pinned, req.seed, req.mask);
    if (!r.ok) throw new BiomeRegionError(`${loaded.name} couldn't make this region: ${r.message}`);
    cells = r.cells;
    raw = r.paths;
    warnings.push(...r.warnings);
  }

  // The region's cells; pinned ones as they were.
  const out = new Map<string, string>();
  for (const [k, t] of cells) if (mine(k)) out.set(k, req.pinned.get(k) ?? t);
  for (const [k, t] of req.pinned) if (mine(k)) out.set(k, t);

  const result: BiomeRegionResult = { cells: out };
  if (raw.length) {
    // Shipped generators' path types draw as the palette's type that behaves like them.
    const typed = loaded.preset ? raw.map((p) => ({ type: builtinPathType(drawnPathType(model, p), pathTypes), hexes: p.hexes })) : raw;
    const route = mapRouteContext({
      orientation: plugin.settings.hexOrientation,
      stagger,
      gridSize: { cols: grid.cols, rows: grid.rows },
      gridOffset: grid.offset,
      terrainOf: [...out].map(([k, t]): [string, { terrain: string }] => [k, { terrain: t }]),
      impassable: impassableNames(terrains),
    });
    const { paths, missing } = toPathsOn(typed, loaded.preset ? undefined : model, { pathTypes, route });
    if (paths.length) result.paths = paths;
    if (missing.length) warnings.push(`No path type named ${missing.join(", ")}, so those paths were skipped`);
  }
  if (warnings.length) result.note = warnings.join(". ") + ".";
  return result;
}

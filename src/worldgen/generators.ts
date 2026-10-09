/**
 * Hexmaker glue for the hex-wfc library: where generator files live, learning
 * a generator from a painted map, generating terrain for a new map, and
 * filling or regenerating an existing one.
 *
 * Generators are Markdown files (see packages/hex-wfc/src/format.ts) under
 * `{worldFolder}/generators`, so users can open and edit them by hand. A
 * palette can have any number of them (one learned from a lakes map, another
 * from a mountain range, ...). Each records the palette and map it came from
 * in its frontmatter, along with its solver settings.
 */

import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getFrontMatter, getTerrainFromFile, setTerrainInFile } from "../frontmatter";
import { normalizeFolder, slugify } from "../utils";
import { VERSION_KEY, pluginVersion } from "../compat";
import {
  learnModel,
  mergeModels,
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  restrictModel,
  solve,
  cellKey,
  encodeSetting,
  SETTING_KEYS,
  type HexWfcModel,
  type SolveResult,
  type GeneratorSettings,
  resolveSettings,
  pathRouteKey,
} from "../../packages/hex-wfc/src";

/** Frontmatter key that keeps a hex's terrain when a map is regenerated. */
export const LOCK_KEY = "locked";

export interface GeneratorFile {
  file: TFile;
  model: HexWfcModel;
  warnings: string[];
}

export function generatorsFolder(plugin: HexmakerPlugin): string {
  const world = normalizeFolder(plugin.settings.worldFolder);
  return world ? `${world}/generators` : "generators";
}

/** Where generator saves (presets with their generated map) are kept. */
export function savesFolder(plugin: HexmakerPlugin): string {
  return `${generatorsFolder(plugin)}/saves`;
}

/** Every generator file in the generators folder (sub-folders included). */
export async function listGenerators(plugin: HexmakerPlugin): Promise<GeneratorFile[]> {
  const folder = generatorsFolder(plugin);
  const saves = savesFolder(plugin) + "/";
  const files = plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + "/") && !f.path.startsWith(saves) && !f.basename.startsWith("_"));
  const out: GeneratorFile[] = [];
  for (const file of files) {
    const text = await plugin.app.vault.cachedRead(file);
    if (!isModelMarkdown(text)) continue;
    try {
      const { model, warnings } = parseModelMarkdown(text, file.basename);
      out.push({ file, model, warnings });
    } catch {
      /* not a generator after all */
    }
  }
  return out.sort((a, b) => a.model.name.localeCompare(b.model.name));
}

/** True when every terrain the generator can place exists in the palette. */
export function generatorFitsPalette(model: HexWfcModel, paletteTerrains: string[]): boolean {
  const names = new Set(paletteTerrains);
  const placeable = model.terrains.filter((t) => t.weight > 0);
  return placeable.length > 0 && placeable.every((t) => names.has(t.name));
}

function mapStagger(plugin: HexmakerPlugin, mapName: string): "odd" | "even" {
  return plugin.getMap(mapName)?.staggerOffset ?? plugin.settings.staggerOffset ?? "odd";
}

/** Painted terrain of every hex on the map, keyed "x_y". Unpainted hexes are left out. */
export function readMapTerrain(plugin: HexmakerPlugin, mapName: string): Map<string, string> {
  const map = plugin.getMap(mapName);
  const cells = new Map<string, string>();
  if (!map) return cells;
  const { cols, rows } = map.gridSize;
  const { x: ox, y: oy } = map.gridOffset;
  for (let x = ox; x < ox + cols; x++) {
    for (let y = oy; y < oy + rows; y++) {
      const terrain = getTerrainFromFile(plugin.app, plugin.hexPath(x, y, mapName));
      if (terrain) cells.set(cellKey(x, y), terrain);
    }
  }
  return cells;
}

/** Hexes whose note has `locked: true` in its frontmatter. */
export function readLockedHexes(plugin: HexmakerPlugin, mapName: string): Set<string> {
  const map = plugin.getMap(mapName);
  const out = new Set<string>();
  if (!map) return out;
  const { cols, rows } = map.gridSize;
  const { x: ox, y: oy } = map.gridOffset;
  for (let x = ox; x < ox + cols; x++) {
    for (let y = oy; y < oy + rows; y++) {
      const fm = getFrontMatter(plugin.app, plugin.hexPath(x, y, mapName)) as Record<string, unknown> | null;
      if (fm?.[LOCK_KEY] === true) out.add(cellKey(x, y));
    }
  }
  return out;
}

/** Path colour per path type name, for previews. */
export function pathColors(plugin: HexmakerPlugin): Map<string, string> {
  return new Map((plugin.settings.pathTypes ?? []).map((t) => [t.name, t.color]));
}

/**
 * Generated paths as map path chains. Path types the vault doesn't have are
 * dropped (and named in the returned warning list).
 */
export function toPathChains(
  plugin: HexmakerPlugin,
  paths: { type: string; route?: string; hexes: string[] }[],
  model?: HexWfcModel,
): { chains: { typeName: string; hexes: string[] }[]; missing: string[] } {
  const known = new Set((plugin.settings.pathTypes ?? []).map((t) => t.name));
  const typed = paths.map((p) => ({ typeName: drawnPathType(model, p), hexes: [...p.hexes] }));
  const missing = [...new Set(typed.map((p) => p.typeName).filter((t) => !known.has(t)))];
  return { chains: typed.filter((p) => known.has(p.typeName)), missing };
}

/** The map path type a generated path is drawn as: its route's "as", else its learned type. */
export function drawnPathType(model: HexWfcModel | undefined, p: { type: string; route?: string }): string {
  return (p.route && model?.settings?.paths?.[p.route]?.as) || p.type;
}

/** Palette colour per terrain name, for previews. */
export function paletteColors(plugin: HexmakerPlugin, paletteName: string | undefined): Map<string, string> {
  const terrains = plugin.getPaletteByName(paletteName ?? "")?.terrains ?? plugin.settings.terrainPalettes[0]?.terrains ?? [];
  return new Map(terrains.map((t) => [t.name, t.color]));
}

/**
 * Meta key listing the regions of a generator learned from several, joined
 * with SOURCE_MAPS_JOIN: `source-maps: the-coast + the-north`.
 */
export const SOURCE_MAPS_KEY = "source-maps";
const SOURCE_MAPS_JOIN = " + ";

/**
 * Meta key with each region's influence on a combined generator, in the
 * order of its regions: `source-influence: 60 + 40` (percent). Missing means
 * each region counts by its size.
 */
export const SOURCE_INFLUENCE_KEY = "source-influence";

/** A combined generator's region influence (percent, one per region), or undefined if by size. */
export function sourceInfluenceOf(model: HexWfcModel): number[] | undefined {
  const raw = model.meta[SOURCE_INFLUENCE_KEY];
  if (!raw) return undefined;
  const list = raw.split(SOURCE_MAPS_JOIN).map((v) => Number(v.trim()));
  if (list.length !== sourceMapsOf(model).length || list.some((v) => !Number.isFinite(v) || v < 0)) return undefined;
  return list.reduce((n, v) => n + v, 0) > 0 ? list : undefined;
}

/**
 * Generators learned from a region, best match first: ones learned from it
 * alone before combined ones, then newest, then by name.
 */
export function generatorsForRegion(generators: GeneratorFile[], mapName: string): GeneratorFile[] {
  return generators
    .filter((g) => sourceMapsOf(g.model).includes(mapName))
    .sort(
      (a, b) =>
        sourceMapsOf(a.model).length - sourceMapsOf(b.model).length ||
        (b.model.meta.created ?? "").localeCompare(a.model.meta.created ?? "") ||
        // `created` is a date only; same-day ones go by when the file was made.
        (b.file.stat?.ctime ?? 0) - (a.file.stat?.ctime ?? 0) ||
        a.model.name.localeCompare(b.model.name),
    );
}

/** How many painted hexes each region has (what influence defaults to). */
export function regionSizes(plugin: HexmakerPlugin, mapNames: string[]): number[] {
  return mapNames.map((m) => readMapTerrain(plugin, m).size);
}

/** The regions a generator was learned from: one, several, or none recorded. */
export function sourceMapsOf(model: HexWfcModel): string[] {
  const many = model.meta[SOURCE_MAPS_KEY]?.split(SOURCE_MAPS_JOIN).map((s) => s.trim()).filter(Boolean);
  if (many?.length) return many;
  const one = model.meta["source-map"];
  return one ? [one] : [];
}

/**
 * Learn from the painted hexes of one or more regions. Several regions are
 * learned one by one and merged (see mergeModels), so nothing is learned
 * from where one region's edge would meet another's.
 */
function learnFromMaps(
  plugin: HexmakerPlugin,
  mapNames: string[],
  name: string,
  meta: Record<string, string>,
  influence?: number[],
): { model: HexWfcModel } | { error: string } {
  const models: HexWfcModel[] = [];
  for (const mapName of mapNames) {
    const map = plugin.getMap(mapName);
    if (!map) return { error: `Region "${mapName}" no longer exists.` };
    const cells = readMapTerrain(plugin, mapName);
    if (cells.size < 2)
      return { error: mapNames.length > 1
        ? `Region "${mapName}" has no painted terrain to learn from.`
        : "Paint some terrain on this map first. The generator learns from painted hexes." };
    models.push(learnModel(cells, {
      name,
      orientation: plugin.settings.hexOrientation,
      stagger: mapStagger(plugin, mapName),
      paths: (map.pathChains ?? []).map((c) => ({ type: c.typeName, hexes: c.hexes })),
      meta,
    }));
  }
  const model = models.length === 1 ? models[0] : mergeModels(models, name, meta, influence);
  if (model.adjacency.length === 0)
    return { error: "No painted hexes touch each other, so there is nothing to learn yet." };
  return { model };
}

/** Meta for a generator learned from these regions. */
function sourceMeta(plugin: HexmakerPlugin, mapNames: string[]): Record<string, string> {
  const meta: Record<string, string> = {
    palette: plugin.getMap(mapNames[0])?.paletteName ?? "",
    created: new Date().toISOString().slice(0, 10),
    [VERSION_KEY]: pluginVersion(plugin),
  };
  if (mapNames.length === 1) meta["source-map"] = mapNames[0];
  else meta[SOURCE_MAPS_KEY] = mapNames.join(SOURCE_MAPS_JOIN);
  return meta;
}

/**
 * Learn a generator from one or more maps' painted hexes and save it as a
 * new file. Never overwrites: a name clash gets a numeric suffix.
 */
export async function saveGeneratorFromMaps(
  plugin: HexmakerPlugin,
  mapNames: string[],
  rawName: string,
): Promise<{ file: TFile; model: HexWfcModel } | { error: string }> {
  if (!mapNames.length) return { error: "Pick a region to learn from." };
  const name = slugify(rawName) || slugify(mapNames.join("-"));
  if (!name) return { error: "Enter a generator name." };
  const learned = learnFromMaps(plugin, mapNames, name, sourceMeta(plugin, mapNames));
  if ("error" in learned) return learned;
  const { model } = learned;

  const folder = generatorsFolder(plugin);
  if (!(plugin.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
    try {
      await plugin.app.vault.createFolder(folder);
    } catch {
      /* exists */
    }
  }
  let path = `${folder}/${name}.md`;
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = `${folder}/${name}-${n}.md`;
    model.name = `${name}-${n}`;
  }
  const file = await plugin.app.vault.create(path, modelToMarkdown(model));
  return { file, model };
}

/** Learn a generator from one map (see saveGeneratorFromMaps). */
export function saveGeneratorFromMap(
  plugin: HexmakerPlugin,
  mapName: string,
  rawName: string,
): Promise<{ file: TFile; model: HexWfcModel } | { error: string }> {
  return saveGeneratorFromMaps(plugin, [mapName], rawName);
}

/** Move generator files to the trash (system or vault, as the user set). */
export async function deleteGenerators(plugin: HexmakerPlugin, files: TFile[]): Promise<void> {
  for (const file of files) await plugin.app.fileManager.trashFile(file);
}

/**
 * Save solver settings into a generator file's frontmatter. Only the
 * frontmatter changes, so the tables and any notes the user wrote are kept.
 * A value of `undefined` removes the setting (back to the default).
 */
/** Set the palette a generator belongs to (its `palette` frontmatter). */
export async function setGeneratorPalette(plugin: HexmakerPlugin, file: TFile, palette: string): Promise<void> {
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    fm.palette = palette;
  });
}

export async function saveGeneratorSettings(
  plugin: HexmakerPlugin,
  file: TFile,
  settings: Partial<Record<keyof GeneratorSettings, unknown>>,
): Promise<void> {
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(settings) as [keyof GeneratorSettings, unknown][]) {
      const key = SETTING_KEYS[field];
      if (value === undefined) delete fm[key];
      else fm[key] = encodeSetting(field, value);
    }
    fm[VERSION_KEY] = pluginVersion(plugin);
  });
}

export interface GridSpec {
  cols: number;
  rows: number;
  offset: { x: number; y: number };
  stagger: "odd" | "even";
}

/** Terrain names treated as impassable until a generator sets its own list. */
export const DEFAULT_IMPASSABLE = ["shallows", "ocean", "trench"];

/**
 * Impassable terrains for a generator that has never saved the setting: its
 * terrains named like DEFAULT_IMPASSABLE (any case), so "Connected land"
 * works out of the box. Once the generator saves a list (even an empty one),
 * that list is used instead.
 */
export function defaultImpassable(model: HexWfcModel): string[] | undefined {
  if (model.settings?.impassable !== undefined) return undefined;
  return model.terrains.map((t) => t.name).filter((n) => DEFAULT_IMPASSABLE.includes(n.toLowerCase()));
}

/** Saved settings with the plugin's defaults filled in (see defaultImpassable). */
export function generatorSettings(model: HexWfcModel): Required<GeneratorSettings> {
  const impassable = defaultImpassable(model);
  return resolveSettings(model, impassable ? { impassable } : {});
}

/**
 * Run a generator on a grid. Terrains the palette lacks are dropped from the
 * generator first. Fixed hexes whose terrain the generator doesn't know are
 * kept, treated as allowed next to anything.
 */
export function generateTerrain(
  plugin: HexmakerPlugin,
  model: HexWfcModel,
  paletteTerrains: string[],
  grid: GridSpec,
  seed: number,
  fixed?: Map<string, string>,
): SolveResult {
  let fitted = restrictModel(model, paletteTerrains);
  const unknown = new Set([...(fixed?.values() ?? [])].filter((t) => !fitted.terrains.some((e) => e.name === t)));
  if (unknown.size) {
    const all = [...fitted.terrains.map((t) => t.name), ...unknown];
    fitted = {
      ...fitted,
      terrains: [...fitted.terrains, ...[...unknown].map((name) => ({ name, weight: 0 }))],
      adjacency: [
        ...fitted.adjacency,
        ...[...unknown].flatMap((u) => all.map((b) => ({ a: u, b, weight: 1 }))),
      ],
    };
  }
  return solve(fitted, {
    cols: grid.cols,
    rows: grid.rows,
    offset: grid.offset,
    orientation: plugin.settings.hexOrientation,
    stagger: grid.stagger,
    seed,
    fixed,
    ...(defaultImpassable(model) ? { impassable: defaultImpassable(model) } : {}),
  });
}

/**
 * Fill an existing map with a generator.
 *  - "unpainted": only hexes without terrain change; every painted hex stays.
 *  - "regenerate": every hex may change except those marked `locked: true`.
 * Returns the number of hexes written, plus any soft-goal warnings.
 */
export async function fillMap(
  plugin: HexmakerPlugin,
  mapName: string,
  model: HexWfcModel,
  mode: "unpainted" | "regenerate",
  seed: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ changed: number; warnings: string[] } | { error: string }> {
  const map = plugin.getMap(mapName);
  if (!map) return { error: `Map "${mapName}" not found.` };
  const painted = readMapTerrain(plugin, mapName);
  let fixed = painted;
  if (mode === "regenerate") {
    const locked = readLockedHexes(plugin, mapName);
    fixed = new Map([...painted].filter(([k]) => locked.has(k)));
  }
  const palette = plugin.getMapPalette(mapName).map((t) => t.name);
  const result = generateTerrain(
    plugin,
    model,
    palette,
    { cols: map.gridSize.cols, rows: map.gridSize.rows, offset: map.gridOffset, stagger: mapStagger(plugin, mapName) },
    seed,
    fixed,
  );
  if (!result.ok) return { error: result.message };
  const changes = [...result.cells].filter(([k, t]) => painted.get(k) !== t);
  await writeTerrain(plugin, mapName, changes, onProgress);
  const warnings = [...result.warnings];
  // Regenerating also redraws the generator's path types (rivers, roads);
  // other path types, and every path when only filling, are left alone.
  if (mode === "regenerate" && model.paths?.length) {
    const learned = new Set(model.paths.map((p) => drawnPathType(model, { type: p.type, route: pathRouteKey(p) })));
    const { chains, missing } = toPathChains(plugin, result.paths, model);
    map.pathChains = [...(map.pathChains ?? []).filter((c) => !learned.has(c.typeName)), ...chains];
    if (missing.length) warnings.push(`No path type named ${missing.join(", ")}, so those paths were skipped`);
    await plugin.saveSettings();
  }
  return { changed: changes.length, warnings };
}

/** Write terrain to hex notes (creating missing ones) and keep encounter links in sync. */
async function writeTerrain(
  plugin: HexmakerPlugin,
  mapName: string,
  changes: [string, string][],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const CHUNK = 20;
  let done = 0;
  for (let i = 0; i < changes.length; i += CHUNK) {
    await Promise.all(
      changes.slice(i, i + CHUNK).map(async ([key, terrain]) => {
        const [x, y] = key.split("_").map(Number);
        const path = plugin.hexPath(x, y, mapName);
        const before = getTerrainFromFile(plugin.app, path);
        if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) {
          await setTerrainInFile(plugin.app, path, terrain);
        } else {
          await plugin.createHexNote(x, y, mapName, undefined, terrain);
        }
        if (plugin.hasTerrainEncounterTable(terrain) || (before && plugin.hasTerrainEncounterTable(before)))
          await plugin.syncHexEncounterTableLink(path, terrain);
        done++;
      }),
    );
    onProgress?.(done, changes.length);
  }
}

/**
 * Re-learn a generator from the region it came from (its `source-map`),
 * keeping its name, settings and other metadata. Rewrites the file.
 */
export async function relearnGenerator(
  plugin: HexmakerPlugin,
  g: GeneratorFile,
  /** New influence per region; null = by region size; omitted = as stored. */
  influence?: number[] | null,
): Promise<{ model: HexWfcModel } | { error: string }> {
  const mapNames = sourceMapsOf(g.model);
  if (!mapNames.length) return { error: "This generator doesn't record the region it came from." };
  const missing = mapNames.filter((m) => !plugin.getMap(m));
  if (missing.length) return { error: `The region this generator came from (${missing.join(", ")}) no longer exists.` };
  const weights = influence === null ? undefined : (influence ?? sourceInfluenceOf(g.model));
  const meta = { ...g.model.meta, ...sourceMeta(plugin, mapNames) };
  if (weights && mapNames.length > 1) meta[SOURCE_INFLUENCE_KEY] = weights.join(SOURCE_MAPS_JOIN);
  else delete meta[SOURCE_INFLUENCE_KEY];
  const learned = learnFromMaps(plugin, mapNames, g.model.name, meta, mapNames.length > 1 ? weights : undefined);
  if ("error" in learned) return learned;
  const { model } = learned;
  if (g.model.settings) model.settings = { ...g.model.settings };
  await plugin.app.vault.modify(g.file, modelToMarkdown(model));
  return { model };
}

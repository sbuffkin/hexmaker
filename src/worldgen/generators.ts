/**
 * Hexmaker glue for the hex-wfc library: where generator files live, learning
 * a generator from a painted map, and generating terrain for a new map.
 *
 * Generators are Markdown files (see packages/hex-wfc/src/format.ts) under
 * `{worldFolder}/generators`, so users can open and edit them by hand. A
 * palette can have any number of them (one learned from a lakes map, another
 * from a mountain range, ...). Each records the palette and map it came from
 * in its frontmatter.
 */

import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getTerrainFromFile } from "../frontmatter";
import { normalizeFolder, slugify } from "../utils";
import {
  learnModel,
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  restrictModel,
  solve,
  cellKey,
  type HexWfcModel,
  type SolveResult,
} from "../../packages/hex-wfc/src";

export interface GeneratorFile {
  file: TFile;
  model: HexWfcModel;
  warnings: string[];
}

export function generatorsFolder(plugin: HexmakerPlugin): string {
  const world = normalizeFolder(plugin.settings.worldFolder);
  return world ? `${world}/generators` : "generators";
}

/** Every generator file in the generators folder (sub-folders included). */
export async function listGenerators(plugin: HexmakerPlugin): Promise<GeneratorFile[]> {
  const folder = generatorsFolder(plugin);
  const files = plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + "/") && !f.basename.startsWith("_"));
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

/**
 * Learn a generator from the map's painted hexes and save it as a new file.
 * Never overwrites: a name clash gets a numeric suffix.
 */
export async function saveGeneratorFromMap(
  plugin: HexmakerPlugin,
  mapName: string,
  rawName: string,
): Promise<{ file: TFile; model: HexWfcModel } | { error: string }> {
  const map = plugin.getMap(mapName);
  if (!map) return { error: `Map "${mapName}" not found.` };
  const name = slugify(rawName) || slugify(mapName);
  if (!name) return { error: "Enter a generator name." };

  const cells = readMapTerrain(plugin, mapName);
  if (cells.size < 2)
    return { error: "Paint some terrain on this map first. The generator learns from painted hexes." };

  const model = learnModel(cells, {
    name,
    orientation: plugin.settings.hexOrientation,
    stagger: mapStagger(plugin, mapName),
    meta: {
      palette: map.paletteName,
      "source-map": mapName,
      "painted-hexes": String(cells.size),
      created: new Date().toISOString().slice(0, 10),
    },
  });
  if (model.adjacency.length === 0)
    return { error: "No painted hexes touch each other, so there is nothing to learn yet." };

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

/**
 * Generate terrain for a whole new map. Terrains the palette lacks are dropped
 * from the generator first.
 */
export function generateMapTerrain(
  plugin: HexmakerPlugin,
  model: HexWfcModel,
  paletteTerrains: string[],
  cols: number,
  rows: number,
  offset: { x: number; y: number },
  stagger: "odd" | "even",
  seed: number,
): SolveResult {
  return solve(restrictModel(model, paletteTerrains), {
    cols,
    rows,
    offset,
    orientation: plugin.settings.hexOrientation,
    stagger,
    seed,
  });
}

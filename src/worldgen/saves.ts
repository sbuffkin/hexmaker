/**
 * Generator saves in the vault: list, write, read, and load one back onto its
 * generator. The file format is in saveFormat.ts.
 */

import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { slugify } from "../utils";
import { VERSION_KEY } from "../compat";
import { generatorsFolder, savesFolder, listGenerators, saveGeneratorSettings, type GeneratorFile } from "./generators";
import { parseSave, serializeSave, SAVE_MARKER, type GeneratorSave } from "./saveFormat";
import { parseModelMarkdown, SETTING_KEYS, type GeneratorSettings } from "../../packages/hex-wfc/src";

/** A save as listed (frontmatter only; the file is parsed on load). */
export interface SaveEntry {
  file: TFile;
  name: string;
  generator: string;
  seed: string;
  size: string;
  version: string;
}

/** A frontmatter value as text, or `fallback` if it isn't a plain value. */
const text = (v: unknown, fallback: string): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : fallback;

export function listSaves(plugin: HexmakerPlugin): SaveEntry[] {
  const folder = savesFolder(plugin) + "/";
  return plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder) && !f.basename.startsWith("_"))
    .map((file) => ({ file, fm: plugin.app.metadataCache.getFileCache(file)?.frontmatter }))
    .filter(({ fm }) => fm?.[SAVE_MARKER] !== undefined)
    .map(({ file, fm }) => ({
      file,
      name: text(fm?.name, file.basename),
      generator: text(fm?.generator, ""),
      seed: text(fm?.seed, ""),
      size: text(fm?.size, ""),
      version: text(fm?.[VERSION_KEY], "unknown"),
    }))
    .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
}

async function ensureFolder(plugin: HexmakerPlugin, path: string): Promise<void> {
  if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
  try {
    await plugin.app.vault.createFolder(path);
  } catch {
    /* exists */
  }
}

/** Write a save. Never overwrites: a name clash gets a numeric suffix. */
export async function writeSave(plugin: HexmakerPlugin, save: GeneratorSave): Promise<TFile> {
  const folder = savesFolder(plugin);
  await ensureFolder(plugin, generatorsFolder(plugin));
  await ensureFolder(plugin, folder);
  const base = slugify(save.name) || "save";
  let name = base;
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(`${folder}/${name}.md`); n++) name = `${base}-${n}`;
  return plugin.app.vault.create(`${folder}/${name}.md`, serializeSave({ ...save, name }));
}

export async function readSave(plugin: HexmakerPlugin, file: TFile): Promise<{ save: GeneratorSave; warnings: string[] } | { error: string }> {
  return parseSave(await plugin.app.vault.read(file), file.basename);
}

/**
 * Put a save's settings back on its generator, so the page shows what was
 * saved. The generator is found by path, then by name; if it's gone, it is
 * recreated from the copy inside the save. Returns the generator file.
 */
export async function applySave(
  plugin: HexmakerPlugin,
  save: GeneratorSave,
): Promise<{ file: TFile; recreated: boolean } | { error: string }> {
  const generators = await listGenerators(plugin);
  let g: GeneratorFile | undefined =
    generators.find((x) => x.file.path === save.generatorPath) ?? generators.find((x) => x.model.name === save.generatorName);
  let recreated = false;
  if (!g) {
    if (!save.generatorMarkdown) return { error: `Generator "${save.generatorName}" no longer exists and the save has no copy of it.` };
    const folder = generatorsFolder(plugin);
    await ensureFolder(plugin, folder);
    const base = slugify(save.generatorName) || "generator";
    let path = `${folder}/${base}.md`;
    for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${base}-${n}.md`;
    const file = await plugin.app.vault.create(path, save.generatorMarkdown);
    const { model, warnings } = parseModelMarkdown(save.generatorMarkdown, file.basename);
    g = { file, model, warnings };
    recreated = true;
  }
  // Replace the generator's settings with the saved ones (keys the save
  // doesn't have go back to their defaults).
  const patch: Partial<Record<keyof GeneratorSettings, unknown>> = {};
  for (const k of Object.keys(SETTING_KEYS) as (keyof GeneratorSettings)[]) patch[k] = save.settings[k];
  await saveGeneratorSettings(plugin, g.file, patch);
  return { file: g.file, recreated };
}

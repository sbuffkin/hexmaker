/**
 * "Make generator from this region…" (PR1, owner round 5): learn a
 * generator from a region's hand-edited terrain, as a new generator or
 * over an existing one, and give it a biome that inherits the region's
 * biome basics (climate, islands, transitions, shore, blend, colour, mix).
 *
 * - rankOverwriteTargets (pure): the generators to offer for "Overwrite
 *   existing", the most fitting first: the region's own biome's generator,
 *   then its parent biomes', then ones learned from this region, then
 *   related biomes' (neighbours it was blended with, similar biomes, its
 *   children and siblings), then the rest by name.
 * - inheritedBiome (pure): the new biome's note fields.
 * - makeRegionGenerator: the glue (learn, back up, write, create the biome).
 */

import { TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { biomeSlug, type BiomeMixRow, type BiomeNoteFields, type BiomeTerrainWeight } from "./biomeNote";
import { copyClimate } from "./biomeClimate";
import { SIMILAR } from "./biomes";
import { blendBiomeFields, hexBiomeAt, measureMap, planBiomePreview, regionBiomeStatus, regionHome, regionPalette } from "./regionsVault";
import { foldMapIntoModel, learnGeneratorFromMap, listGenerators, mapStagger, saveGeneratorFromMap, sourceMapsOf, writeGeneratorInPlace, type GeneratorFile } from "../worldgen/generators";
import { addBlendOfRow } from "../worldgen/generatorNoteUpdate";
import { mapAllows, lockedHint } from "../workMode";
import { mapNoteLink } from "../noteFormats";
import type { HexWfcModel } from "../../packages/hex-wfc/src";

export type OverwriteReason = "own" | "parent" | "learned" | "related" | "other";

export interface OverwriteCandidate {
  /** The generator note's vault path. */
  path: string;
  name: string;
  reason: OverwriteReason;
  /** Short words for the list ("this region's biome: Coast"). */
  why: string;
}

/** A generator as the ranking sees it. */
export interface RankedGenerator {
  path: string;
  name: string;
  sourceMaps: string[];
}

export interface RankContext {
  region: string;
  /** The region's biome (its note), if it has one. */
  biome?: BiomeNoteFields;
  /** Every biome note. */
  biomes: readonly BiomeNoteFields[];
  /** Biomes the region was blended with (MapData.biome.from), as written. */
  blendedWith?: readonly string[];
  /** A biome's `generator` link → the generator note's path (undefined if it doesn't resolve). */
  resolveGenerator: (link: string) => string | undefined;
}

/** A biome by id, label or note name (as biome references are written). */
function findBiome(biomes: readonly BiomeNoteFields[], ref: string | undefined): BiomeNoteFields | undefined {
  if (!ref) return undefined;
  const k = biomeSlug(ref);
  return biomes.find((b) => b.id === k) ?? biomes.find((b) => biomeSlug(b.label) === k);
}

/** The biome's parents, nearest first (cycle-safe). */
export function biomeAncestors(biome: BiomeNoteFields | undefined, biomes: readonly BiomeNoteFields[]): BiomeNoteFields[] {
  const out: BiomeNoteFields[] = [];
  const seen = new Set<string>(biome ? [biome.id] : []);
  let cur = findBiome(biomes, biome?.parent);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = findBiome(biomes, cur.parent);
  }
  return out;
}

/** Biomes related to `biome` but not its parents: blended neighbours, similar biomes, children, siblings. */
export function relatedBiomes(biome: BiomeNoteFields | undefined, biomes: readonly BiomeNoteFields[], blendedWith: readonly string[] = []): BiomeNoteFields[] {
  if (!biome) return blendedWith.map((r) => findBiome(biomes, r)).filter((b): b is BiomeNoteFields => !!b);
  const parent = findBiome(biomes, biome.parent);
  const refs: (BiomeNoteFields | undefined)[] = [
    ...blendedWith.map((r) => findBiome(biomes, r)),
    ...(SIMILAR[biome.id] ?? []).map((id) => findBiome(biomes, id)),
    ...biomes.filter((b) => findBiome(biomes, b.parent)?.id === biome.id),
    ...(parent ? biomes.filter((b) => b.id !== biome.id && findBiome(biomes, b.parent)?.id === parent.id) : []),
  ];
  const out: BiomeNoteFields[] = [];
  for (const b of refs) if (b && b.id !== biome.id && !out.includes(b)) out.push(b);
  return out;
}

/**
 * The generators "Overwrite existing" offers, most fitting first (see the
 * file comment). Each generator once, under its best reason.
 */
export function rankOverwriteTargets(gens: readonly RankedGenerator[], ctx: RankContext): OverwriteCandidate[] {
  const byPath = new Map(gens.map((g) => [g.path, g]));
  const out: OverwriteCandidate[] = [];
  const add = (path: string | undefined, reason: OverwriteReason, why: string) => {
    const g = path ? byPath.get(path) : undefined;
    if (!g || out.some((c) => c.path === g.path)) return;
    out.push({ path: g.path, name: g.name, reason, why });
  };
  const genOf = (b: BiomeNoteFields) => (b.generator ? ctx.resolveGenerator(b.generator) : undefined);
  if (ctx.biome) add(genOf(ctx.biome), "own", `this region's biome: ${ctx.biome.label}`);
  for (const b of biomeAncestors(ctx.biome, ctx.biomes)) add(genOf(b), "parent", `parent biome: ${b.label}`);
  // Learned from this region: alone first, then combined ones.
  const learned = gens.filter((g) => g.sourceMaps.includes(ctx.region)).sort((a, b) => a.sourceMaps.length - b.sourceMaps.length || a.name.localeCompare(b.name));
  for (const g of learned) add(g.path, "learned", "learned from this region");
  for (const b of relatedBiomes(ctx.biome, ctx.biomes, ctx.blendedWith)) add(genOf(b), "related", `related biome: ${b.label}`);
  for (const g of [...gens].sort((a, b) => a.name.localeCompare(b.name))) add(g.path, "other", "");
  return out;
}

/** Hex counts by terrain → a type mix (settlements and untyped terrains left out). */
export function mixFromTerrain(counts: ReadonlyMap<string, number>, palette: readonly TerrainColor[]): BiomeMixRow[] {
  const typeOf = new Map(palette.map((t) => [t.name, t.type]));
  const out: BiomeMixRow[] = [];
  for (const [terrain, n] of counts) {
    const type = typeOf.get(terrain);
    if (!type || type === "settlement" || n <= 0) continue;
    const hit = out.find((r) => r.type === type);
    if (hit) hit.weight += n;
    else out.push({ type, weight: n });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * Terrain weights from the region's hex counts, for the types where the
 * region uses more than one terrain (where the split matters: "different
 * forests go together in different ratios"), limited to `types`.
 */
export function terrainWeightsFromTerrain(counts: ReadonlyMap<string, number>, palette: readonly TerrainColor[], types: readonly string[]): BiomeTerrainWeight[] {
  const typeOf = new Map(palette.map((t) => [t.name, t.type]));
  const byType = new Map<string, [string, number][]>();
  for (const [terrain, n] of counts) {
    const type = typeOf.get(terrain);
    if (!type || !types.includes(type) || n <= 0) continue;
    byType.set(type, [...(byType.get(type) ?? []), [terrain, n]]);
  }
  const out: BiomeTerrainWeight[] = [];
  for (const type of types) {
    const rows = byType.get(type);
    if (!rows || rows.length < 2) continue;
    for (const [terrain, weight] of rows.sort((a, b) => b[1] - a[1])) out.push({ terrain, weight });
  }
  return out;
}

/**
 * The note fields of a biome for a generator made from a region: the
 * source biome's basics (climate, land share, min islands, transitions,
 * shore, blend, colour) and its mix as a starting point; without one, the
 * mix the region's terrain shows. Terrain weights come from the region.
 */
export function inheritedBiome(source: BiomeNoteFields | undefined, opts: { label: string; generator: string; counts: ReadonlyMap<string, number>; palette: readonly TerrainColor[] }): Omit<BiomeNoteFields, "id"> {
  const mix = source?.mix.length ? source.mix.map((r) => ({ ...r })) : mixFromTerrain(opts.counts, opts.palette);
  const f: Omit<BiomeNoteFields, "id"> = {
    label: opts.label,
    mix,
    transitions: (source?.transitions ?? []).map((t) => ({ ...t })),
    generator: opts.generator,
  };
  if (source) {
    f.parent = source.label;
    if (source.color) f.color = source.color;
    if (source.blend) f.blend = source.blend;
    if (source.landShare !== undefined) f.landShare = source.landShare;
    if (source.minIslands !== undefined) f.minIslands = source.minIslands;
    if (source.shore) f.shore = true;
    const climate = copyClimate(source.climate);
    if (climate) f.climate = climate;
  }
  const weights = terrainWeightsFromTerrain(opts.counts, opts.palette, mix.map((r) => r.type));
  if (weights.length) f.terrainWeights = weights;
  return f;
}

// ── glue ─────────────────────────────────────────────────────────────────

/** The biome a region was made from (its own record, else its overworld hex's), as a note. */
export function regionSourceBiome(plugin: HexmakerPlugin, mapName: string): BiomeNoteFields | undefined {
  const status = regionBiomeStatus(plugin, mapName);
  if (status && "id" in status) {
    const b = plugin.biomeStore.get(status.id);
    if (b) return b;
  }
  const map = plugin.getMap(mapName);
  if (map?.submapKind === "region" && map.parent) {
    const id = hexBiomeAt(plugin, map.parent.map, map.parent.hex);
    if (id) return plugin.biomeStore.get(id);
  }
  return undefined;
}

/** A generator link (biome `generator:`) → the note's path. */
export function resolveGeneratorLink(plugin: HexmakerPlugin, link: string): string | undefined {
  const v = plugin.app.vault;
  const hit = v.getAbstractFileByPath(link) ?? v.getAbstractFileByPath(`${link}.md`) ?? plugin.app.metadataCache.getFirstLinkpathDest?.(link, "");
  return hit instanceof TFile ? hit.path : undefined;
}

/** The overwrite list for a region, ranked (see rankOverwriteTargets). */
export async function overwriteTargets(plugin: HexmakerPlugin, mapName: string): Promise<{ candidates: OverwriteCandidate[]; generators: GeneratorFile[]; biome?: BiomeNoteFields }> {
  const generators = await listGenerators(plugin);
  const biome = regionSourceBiome(plugin, mapName);
  const candidates = rankOverwriteTargets(
    generators.map((g) => ({ path: g.file.path, name: g.model.name, sourceMaps: sourceMapsOf(g.model) })),
    {
      region: mapName,
      biome,
      biomes: plugin.biomeStore.list(),
      blendedWith: plugin.getMap(mapName)?.biome?.from,
      resolveGenerator: (link) => resolveGeneratorLink(plugin, link),
    },
  );
  return { candidates, generators, biome };
}

/** Hexes per terrain on a map (from the map note's data). */
function terrainCountsOf(plugin: HexmakerPlugin, mapName: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of plugin.mapStore.all(mapName).values()) if (h.terrain) out.set(h.terrain, (out.get(h.terrain) ?? 0) + 1);
  return out;
}

/** Save `text` under the plugin's backups folder as plain Markdown, never over an earlier one. Returns the path. */
async function backupText(plugin: HexmakerPlugin, base: string, text: string): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const dir = `${plugin.manifest.dir}/backups/generators-${new Date().toISOString().slice(0, 10)}`;
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  let path = `${dir}/${base}.md`;
  for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${base}-${n}.md`;
  await adapter.write(path, text);
  return path;
}

export type MakeTarget = { kind: "new"; name: string } | { kind: "overwrite"; path: string };

export interface MakeResult {
  file: TFile;
  /** Where the overwritten generator was backed up. */
  backup?: string;
  /** The biome made for the generator (label), if one was. */
  biome?: string;
}

/**
 * Learn a generator from `mapName` into `target`. A new generator gets a
 * biome inheriting the region's biome (when the region has one). An
 * overwrite backs the old note up first and keeps the biomes that use it;
 * if none does, it gets an inheriting biome too.
 */
export async function makeRegionGenerator(plugin: HexmakerPlugin, mapName: string, target: MakeTarget): Promise<MakeResult | { error: string }> {
  let file: TFile;
  let backup: string | undefined;
  if (target.kind === "new") {
    const r = await saveGeneratorFromMap(plugin, mapName, target.name);
    if ("error" in r) return r;
    file = r.file;
  } else {
    const f = plugin.app.vault.getAbstractFileByPath(target.path);
    if (!(f instanceof TFile)) return { error: `The generator ${target.path} is gone.` };
    const name = f.basename;
    const learned = learnGeneratorFromMap(plugin, mapName, name);
    if ("error" in learned) return learned;
    const old = await plugin.app.vault.read(f);
    try {
      backup = await backupText(plugin, name, old);
    } catch (e) {
      console.error("Hexmap World Creator: couldn't back up the generator before overwriting it", e);
      return { error: `Couldn't back up ${f.path}, so it wasn't overwritten.` };
    }
    // Tables and keys only: the note's own text stays.
    await writeGeneratorInPlace(plugin, f, learned.model);
    file = f;
  }
  const link = file.path.replace(/\.md$/i, "");
  const usedBy = plugin.biomeStore.list().some((b) => b.generator && resolveGeneratorLink(plugin, b.generator) === file.path);
  const source = regionSourceBiome(plugin, mapName);
  let biome: string | undefined;
  if (source && !usedBy && plugin.biomeStore.isReady()) {
    const label = uniqueBiomeLabel(plugin, target.kind === "new" ? target.name.trim() || file.basename : file.basename);
    const fields = inheritedBiome(source, { label, generator: link, counts: terrainCountsOf(plugin, mapName), palette: plugin.getMapPalette(mapName) });
    const res = await plugin.biomeStore.create(fields);
    if (!("error" in res)) biome = label;
  }
  return { file, backup, biome };
}

/** A biome label not taken yet ("Coast", "Coast 2", …). */
function uniqueBiomeLabel(plugin: HexmakerPlugin, want: string): string {
  const taken = new Set(plugin.biomeStore.list().flatMap((b) => [b.id, biomeSlug(b.label)]));
  let label = want;
  for (let n = 2; taken.has(biomeSlug(label)); n++) label = `${want} ${n}`;
  return label;
}

// ── Blend into <biome> (owner request 2026-10-12) ───────────────────────

/** What "Blend into <biome>" folds a map into. */
export interface BlendTarget {
  /** The biome the map was made from. */
  biome: BiomeNoteFields;
  /** Its generator, when it links one that resolves. */
  generator?: GeneratorFile;
  /** A generator link that doesn't resolve (shown as a problem; nothing is written). */
  missing?: string;
  /** The overworld the map's region belongs to (for previews), if it is a region. */
  overworld?: string;
}

/** The biome (and generator) a map folds into, or undefined when the map wasn't made from a biome. */
export async function blendTarget(plugin: HexmakerPlugin, mapName: string): Promise<BlendTarget | undefined> {
  const biome = regionSourceBiome(plugin, mapName);
  if (!biome || biome.blank) return undefined;
  const overworld = regionHome(plugin, mapName)?.overworld.name;
  if (!biome.generator) return { biome, overworld };
  const path = resolveGeneratorLink(plugin, biome.generator);
  const generator = path ? (await listGenerators(plugin)).find((g) => g.file.path === path) : undefined;
  return generator ? { biome, generator, overworld } : { biome, missing: biome.generator, overworld };
}

/** Why the map can't be blended in its work mode (Build or God), or undefined. */
export function blendLock(plugin: HexmakerPlugin, mapName: string): string | undefined {
  return mapAllows(plugin.getMap(mapName), "edit-biomes") ? undefined : lockedHint("edit-biomes");
}

/** What a blend at weight `w` (of the map) would make: the folded generator, or the biome's new fields. */
export interface BlendPlan {
  weight: number;
  /** Generator path: the merged model (not saved). */
  model?: HexWfcModel;
  /** No-generator path: the biome's note fields after the blend. */
  fields?: BiomeNoteFields;
}

/** Work out a blend (nothing is written). */
export function planBlend(plugin: HexmakerPlugin, mapName: string, target: BlendTarget, w: number): BlendPlan | { error: string } {
  const weight = Math.min(1, Math.max(0, w));
  if (target.generator) {
    const learned = learnGeneratorFromMap(plugin, mapName, target.generator.model.name);
    if ("error" in learned) return learned;
    return { weight, model: foldMapIntoModel(target.generator.model, learned.model, weight) };
  }
  if (target.missing) return { error: `${target.biome.label}'s generator (${target.missing}) wasn't found.` };
  const cells = new Map<string, string>();
  for (const [k, h] of plugin.mapStore.all(mapName)) if (h.terrain) cells.set(k, h.terrain);
  if (cells.size < 2) return { error: "Paint some terrain on this map first." };
  const home = regionHome(plugin, mapName);
  const palette = home ? regionPalette(plugin, home.overworld) : plugin.getMapPalette(mapName);
  const stats = measureMap(cells, palette, plugin.settings.hexOrientation, mapStagger(plugin, mapName));
  const sample = home ? { ...home.layout, footprint: "rect" as const, size: Math.min(10, Math.max(4, home.layout.size)) } : undefined;
  const patch = blendBiomeFields(target.biome, stats, palette, weight, sample);
  return { weight, fields: { ...target.biome, ...patch } };
}

/** A fresh sample region of the blended biome (the modal's live preview). */
export async function previewBlend(plugin: HexmakerPlugin, target: BlendTarget, plan: BlendPlan, seed: number): Promise<Map<string, string> | { error: string }> {
  if (!target.overworld) return { error: "This map isn't a region of an overworld, so there's no sample to show." };
  try {
    const fields = plan.fields ?? target.biome;
    const out = await planBiomePreview(plugin, target.overworld, plan.model ? fields : { ...fields, generator: undefined }, seed, plan.model);
    return out?.cells ?? { error: "Nothing to preview." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fold the map into its biome: the generator's tables and keys, or the
 * biome note's Mix, Terrain weights, land-share and Tuning (prose kept
 * either way). The old note is backed up first, and a Blend of row
 * records the map, its weight and the date.
 */
export async function applyBlend(plugin: HexmakerPlugin, mapName: string, target: BlendTarget, plan: BlendPlan): Promise<{ wrote: string; backup?: string } | { error: string }> {
  const lock = blendLock(plugin, mapName);
  if (lock) return { error: lock };
  const row = {
    map: plugin.mapStore.notePath?.(mapName) && plugin.app.vault.getAbstractFileByPath(plugin.mapStore.notePath(mapName)) ? mapNoteLink(mapName) : plugin.mapLabel(mapName),
    weight: plan.weight,
    date: new Date().toISOString().slice(0, 10),
  };
  if (plan.model && target.generator) {
    const f = target.generator.file;
    let backup: string;
    try {
      backup = await backupText(plugin, f.basename, await plugin.app.vault.read(f));
    } catch (e) {
      console.error("Hexmap World Creator: couldn't back up the generator before blending into it", e);
      return { error: `Couldn't back up ${f.path}, so nothing was changed.` };
    }
    await writeGeneratorInPlace(plugin, f, plan.model, (text) => addBlendOfRow(text, row));
    return { wrote: f.path, backup };
  }
  if (!plan.fields) return { error: "Nothing to blend." };
  const { mix, terrainWeights, landShare, tuning } = plan.fields;
  const ok = await plugin.biomeStore.update(target.biome.id, { mix, terrainWeights, landShare, tuning }, { backup: true });
  if (!ok) return { error: `Couldn't write ${target.biome.label}'s note.` };
  const path = plugin.biomeStore.pathOf(target.biome.id);
  const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
  if (file instanceof TFile) await plugin.app.vault.process(file, (text) => addBlendOfRow(text, row));
  return { wrote: path ?? target.biome.label };
}

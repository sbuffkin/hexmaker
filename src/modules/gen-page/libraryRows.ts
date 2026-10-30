/**
 * Rows for the generator page's file list: one tab of generators, one of the
 * regions (maps) generators are learned from. Filtering matches every typed
 * word against all of a row's columns.
 *
 * The Generators tab is a tree (T4, owner 2026-10-16: "the generator page is
 * already out of hand with all the presets; should be a tree like
 * elsewhere"): your own generators at the top, then the preset families
 * (biome-, blend-, planet-, preset-) and any subfolders as groups that start
 * collapsed. See generatorTree().
 */

export interface LibraryGenerator {
  path: string;
  name: string;
  /** Regions it was learned from (several for a combined generator). */
  sources: string[];
  palette?: string;
  terrains: number;
  created?: string;
  /** Subfolder under the generators folder ("" or unset = directly in it). */
  folder?: string;
}

export interface LibraryRegion {
  name: string;
  cols: number;
  rows: number;
  palette: string;
}

import { generatorGroupOf, groupLabel } from "../../worldgen/generatorTree";

export interface GeneratorRow {
  path: string;
  name: string;
  from: string;
  palette: string;
  terrains: number;
  created: string;
  /** Key of the group it sits in (generatorGroupOf); "" = top level. */
  group: string;
}

export interface RegionRow {
  name: string;
  size: string;
  palette: string;
  /** Generators learned from this region (alone or combined). */
  generators: number;
}

const matches = (columns: (string | number)[], query: string): boolean => {
  const hay = columns.join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

export function generatorRows(generators: LibraryGenerator[], query = ""): GeneratorRow[] {
  return generators
    .map((g) => ({
      path: g.path,
      name: g.name,
      from: g.sources.join(" + "),
      palette: g.palette ?? "",
      terrains: g.terrains,
      created: g.created ?? "",
      group: generatorGroupOf(g),
    }))
    // The group's name counts too: "planets" finds every planet-… preset.
    .filter((r) => matches([r.name, r.from, r.palette, r.created, groupLabel(r.group)], query))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The tree (groups of preset families and folders) is core: New map's generator list uses it too.
export { PRESET_GROUPS, generatorGroupOf, generatorTree, groupLabel, type GeneratorGroup, type GeneratorTree } from "../../worldgen/generatorTree";

export function regionRows(regions: LibraryRegion[], generators: LibraryGenerator[], query = ""): RegionRow[] {
  const learned = new Map<string, number>();
  for (const g of generators) for (const s of new Set(g.sources)) learned.set(s, (learned.get(s) ?? 0) + 1);
  return regions
    .map((r) => ({ name: r.name, size: `${r.cols}×${r.rows}`, palette: r.palette, generators: learned.get(r.name) ?? 0 }))
    .filter((r) => matches([r.name, r.size, r.palette], query))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Default name for a generator learned from these regions (slug-safe). */
export function combinedName(regions: string[]): string {
  return regions.join("-and-");
}

export interface LibrarySave {
  path: string;
  name: string;
  generator: string;
  seed: string;
  size: string;
  /** When it was saved (the file's last change), "YYYY-MM-DD". */
  saved: string;
  /** Last-change time, for the newest-first order. */
  mtime: number;
}

/** The Saves tab: newest first, filtered on every typed word like the others. */
export function saveRows(saves: LibrarySave[], query = ""): LibrarySave[] {
  return saves
    .filter((s) => matches([s.name, s.generator, s.seed, s.size, s.saved], query))
    .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}

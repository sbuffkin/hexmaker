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

/** The preset families, by name prefix, in the order their groups show. */
export const PRESET_GROUPS: readonly { prefix: string; label: string }[] = [
  { prefix: "biome", label: "Biomes" },
  { prefix: "blend", label: "Blends" },
  { prefix: "planet", label: "Planets" },
  { prefix: "preset", label: "Presets" },
];
const FOLDER_GROUP = "folder:";
const PRESET_GROUP = "preset:";

/**
 * The group a generator sits in: its subfolder, else its preset family
 * ("biome-alpine" → Biomes). One you made by blending or combining presets
 * ("biome-tundra-to-preset-archipelago") is yours and stays at the top; the
 * shipped blends are all "blend-…". "" = top level.
 */
export function generatorGroupOf(g: Pick<LibraryGenerator, "name" | "folder">): string {
  const folder = (g.folder ?? "").replace(/^\/+|\/+$/g, "");
  if (folder) return FOLDER_GROUP + folder;
  const m = /^([a-z]+)-./i.exec(g.name);
  const family = m && PRESET_GROUPS.find((p) => p.prefix === m[1].toLowerCase());
  if (!family) return "";
  if (family.prefix !== "blend" && /-to-/i.test(g.name)) return "";
  return PRESET_GROUP + family.prefix;
}

/** A group's name as shown ("Biomes", or the folder's own name). */
export function groupLabel(key: string): string {
  if (key.startsWith(FOLDER_GROUP)) return key.slice(FOLDER_GROUP.length).split("/").pop() ?? "";
  if (key.startsWith(PRESET_GROUP)) return PRESET_GROUPS.find((p) => PRESET_GROUP + p.prefix === key)?.label ?? "";
  return "";
}

export interface GeneratorGroup {
  key: string;
  label: string;
  rows: GeneratorRow[];
  open: boolean;
}

export interface GeneratorTree {
  /** Your own generators, at the top level. */
  top: GeneratorRow[];
  /** Folders (by name), then the preset families (fixed order). */
  groups: GeneratorGroup[];
  /** Rows on screen: the top level and the rows of open groups, in order. */
  visible: GeneratorRow[];
}

/**
 * The Generators tab as a tree, from already filtered rows. A group starts
 * collapsed (`expanded` holds the ones opened or closed this session), opens
 * while it holds the generator shown below the list (`current`), and every
 * group with a match is open while a filter is typed. Groups with no rows
 * don't show.
 */
export function generatorTree(
  rows: readonly GeneratorRow[],
  opts: { query?: string; expanded?: ReadonlyMap<string, boolean>; current?: string } = {},
): GeneratorTree {
  const filtering = !!opts.query?.trim();
  const top = rows.filter((r) => !r.group);
  const byKey = new Map<string, GeneratorRow[]>();
  for (const r of rows) if (r.group) byKey.set(r.group, [...(byKey.get(r.group) ?? []), r]);
  const rank = (key: string) => {
    const i = PRESET_GROUPS.findIndex((p) => PRESET_GROUP + p.prefix === key);
    return i < 0 ? -1 : i;
  };
  const groups = [...byKey]
    .sort(([a], [b]) => rank(a) - rank(b) || groupLabel(a).localeCompare(groupLabel(b)))
    .map(([key, list]) => {
      const holdsCurrent = !!opts.current && list.some((r) => r.path === opts.current);
      const open = filtering || (opts.expanded?.get(key) ?? holdsCurrent);
      return { key, label: groupLabel(key), rows: list, open };
    });
  const visible = [...top, ...groups.flatMap((g) => (g.open ? g.rows : []))];
  return { top, groups, visible };
}

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

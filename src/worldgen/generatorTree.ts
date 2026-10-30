/**
 * Generators as a tree (T4, owner 2026-10-16: "should be a tree like
 * elsewhere"): your own at the top, then folders and the preset families
 * (biome-, blend-, planet-, preset-) as groups that start collapsed. The
 * generator page's Generators tab and New map's generator list (HF8) both
 * draw it.
 *
 * Pure: no Obsidian imports.
 */

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
export function generatorGroupOf(g: { name: string; folder?: string }): string {
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

/** A row of the tree: its key (a path or generator id) and its group (generatorGroupOf; "" = top level). */
export interface TreeRow {
  path: string;
  group: string;
}

export interface GeneratorGroup<R extends TreeRow = TreeRow> {
  key: string;
  label: string;
  rows: R[];
  open: boolean;
}

export interface GeneratorTree<R extends TreeRow = TreeRow> {
  /** Your own generators, at the top level. */
  top: R[];
  /** Folders (by name), then the preset families (fixed order). */
  groups: GeneratorGroup<R>[];
  /** Rows on screen: the top level and the rows of open groups, in order. */
  visible: R[];
}

/**
 * The Generators tab as a tree, from already filtered rows. A group starts
 * collapsed (`expanded` holds the ones opened or closed this session), opens
 * while it holds the generator shown below the list (`current`), and every
 * group with a match is open while a filter is typed. Groups with no rows
 * don't show.
 */
export function generatorTree<R extends TreeRow>(
  rows: readonly R[],
  opts: { query?: string; expanded?: ReadonlyMap<string, boolean>; current?: string } = {},
): GeneratorTree<R> {
  const filtering = !!opts.query?.trim();
  const top = rows.filter((r) => !r.group);
  const byKey = new Map<string, R[]>();
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

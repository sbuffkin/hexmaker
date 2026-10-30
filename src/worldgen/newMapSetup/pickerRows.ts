/**
 * New map's generator list as rows (HF8, owner A1–A4, 2026-10-18: "the
 * generator list is far too big"): the starred ones first, then the ones
 * used last, then the built-in engines and your own generators, then the
 * shipped families (Biomes, Blends, Planets, Presets) and your folders as
 * groups that start collapsed (generatorTree). Each generator shows once.
 * A search matches every typed word against the name, its tag, its group
 * and its description, and opens every group with a match.
 *
 * Pure: no Obsidian imports.
 */

import { generatorGroupOf, generatorTree, groupLabel, type GeneratorTree, type TreeRow } from "../generatorTree";

/** How many generators "Recent" keeps. */
export const RECENT_MAX = 5;

/** What the list needs of a generator (TerrainGeneratorKind). */
export interface PickerKind {
  id: string;
  label: string;
  source: "blank" | "built-in" | "learned";
  generatorPath?: string;
  continuesNeighbours?: boolean;
}

export interface PickerRow extends TreeRow {
  /** The generator id (also the tree's `path`). */
  id: string;
  label: string;
  /** A small word after the name: "learned", "blend", "continues". */
  tags: string[];
}

export interface PickerList {
  starred: PickerRow[];
  recent: PickerRow[];
  tree: GeneratorTree<PickerRow>;
}

const SHIPPED = "builtin:";

/** The tree group of a generator: a shipped family, your folder, or the top level. */
export function pickerGroup(k: PickerKind, generatorsFolder: string): string {
  if (k.id.startsWith(SHIPPED)) return generatorGroupOf({ name: k.id.slice(SHIPPED.length) });
  if (k.source !== "learned" || !k.generatorPath) return "";
  const path = k.generatorPath.replace(/\.md$/i, "");
  const root = generatorsFolder.replace(/^\/+|\/+$/g, "");
  const rel = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const cut = rel.lastIndexOf("/");
  return generatorGroupOf({ name: rel.slice(cut + 1), folder: cut < 0 ? "" : rel.slice(0, cut) });
}

/** The list's rows. `text` adds words a search finds a generator by (its description). */
export function pickerRows(
  kinds: readonly PickerKind[],
  opts: {
    generatorsFolder: string;
    starred?: readonly string[];
    recent?: readonly string[];
    query?: string;
    expanded?: ReadonlyMap<string, boolean>;
    current?: string;
    /** Next to a map: tag the ones that carry its edge on. */
    neighbour?: boolean;
    text?: (k: PickerKind) => string;
  },
): PickerList {
  const words = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const rows: PickerRow[] = [];
  for (const k of kinds) {
    if (k.source === "blank") continue;
    const group = pickerGroup(k, opts.generatorsFolder);
    const tags = [
      ...(k.source === "learned" ? ["learned"] : []),
      ...(group === "preset:blend" ? ["blend"] : []),
      ...(opts.neighbour && k.continuesNeighbours ? ["continues"] : []),
    ];
    const hay = [k.label, ...tags, groupLabel(group), opts.text?.(k) ?? ""].join(" ").toLowerCase();
    if (words.every((w) => hay.includes(w))) rows.push({ id: k.id, path: k.id, label: k.label, tags, group });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pick = (ids: readonly string[] | undefined, skip: ReadonlySet<string>) =>
    [...new Set(ids ?? [])].flatMap((id) => (byId.has(id) && !skip.has(id) ? [byId.get(id)!] : []));
  const starred = pick(opts.starred, new Set());
  const recent = pick(opts.recent, new Set(starred.map((r) => r.id))).slice(0, RECENT_MAX);
  const shown = new Set([...starred, ...recent].map((r) => r.id));
  const rest = rows.filter((r) => !shown.has(r.id));
  return { starred, recent, tree: generatorTree(rest, { query: opts.query, expanded: opts.expanded, current: opts.current }) };
}

/** "Recent" after making a map with `id`: it first, the last RECENT_MAX kept. */
export function withRecent(recent: readonly string[] | undefined, id: string): string[] {
  return [id, ...(recent ?? []).filter((x) => x !== id)].slice(0, RECENT_MAX);
}

/** The starred ids with `id` starred or unstarred. */
export function toggleStar(starred: readonly string[] | undefined, id: string): string[] {
  const list = starred ?? [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

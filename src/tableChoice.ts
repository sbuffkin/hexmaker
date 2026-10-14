/**
 * One section per kind of rolled table in the hex editor (owner SF2,
 * 2026-10-14): instead of separate rolls per source, the hex lists every
 * table that applies to it, most specific first (hex > area > map >
 * terrain > default), and the user switches between them. Pure helpers;
 * the hex editor gathers the data and draws it (random-tables/TableChoice.ts).
 *
 * Where each candidate comes from (the association data as stored):
 * - hex: a link in the hex note's section for the kind ("### Encounters
 *   Table", "### Weather Table", "### Rumors Table").
 * - area: the area's table `{tables}/regions/<area>.md`, linked into the
 *   hex's Encounters Table section when the hex is painted into the area.
 * - map: the map note's `weather-table:` / `rumors-table:`.
 * - terrain: the terrain's table `{tables}/terrain/encounters/<terrain>.md`,
 *   linked into the Encounters Table section when the terrain is painted.
 * - default: the starter table at the root of the tables folder.
 *
 * Once the hex has a note, its section is the truth for hex, area and
 * terrain links (the user may have removed one); a hex with no note yet
 * shows the area and terrain tables its note will get.
 */

import { ROLLED_SECTION_TABLES, type RolledSection, type RolledSectionTables } from "./regionTables";

export type ChoiceSource = "hex" | "area" | "map" | "terrain" | "default";

/** Most specific first. */
export const SOURCE_ORDER: readonly ChoiceSource[] = ["hex", "area", "map", "terrain", "default"];

export interface TableChoiceItem {
  /** Vault path of the table (the link text as written when it doesn't resolve). */
  path: string;
  source: ChoiceSource;
  /** The link as written in the hex note, when the item comes from there (removable). */
  link?: string;
  /** The link doesn't resolve to a note. */
  missing?: boolean;
}

/** Short words for where a table comes from, shown beside its name. */
export function choiceSourceLabel(source: ChoiceSource): string {
  switch (source) {
    case "hex": return "this hex";
    case "area": return "area";
    case "map": return "map";
    case "terrain": return "terrain";
    default: return "default";
  }
}

/** Where a table linked in the hex note comes from, by its folder. */
export function classifyLinkedTable(path: string, folders: { area: string; terrain: string }): ChoiceSource {
  const p = path.toLowerCase();
  const under = (f: string) => !!f && p.startsWith(f.toLowerCase().replace(/\/+$/, "") + "/");
  if (under(folders.area)) return "area";
  if (under(folders.terrain)) return "terrain";
  return "hex";
}

export interface ChoiceInput {
  /** Whether the hex has a note (then its section is the truth for linked tables). */
  noteExists: boolean;
  /** Links in the hex note's section for this kind, resolved (null = no such note). */
  noteLinks: readonly { link: string; path: string | null }[];
  /** The area's table, when the hex is in an area that has one. */
  area?: string | null;
  /** The map's table for this kind. */
  map?: string | null;
  /** The terrain's table for this kind. */
  terrain?: string | null;
  /** The starter table. */
  fallback?: string | null;
  /** Folders that tell area and terrain tables apart among the note's links. */
  folders: { area: string; terrain: string };
  exists: (path: string) => boolean;
}

/** The tables that apply to a hex for one kind, most specific first, each path once. */
export function tableChoices(input: ChoiceInput): TableChoiceItem[] {
  const out: TableChoiceItem[] = [];
  for (const { link, path } of input.noteLinks) {
    if (path) out.push({ path, source: classifyLinkedTable(path, input.folders), link });
    else out.push({ path: link, source: "hex", link, missing: true });
  }
  const add = (path: string | null | undefined, source: ChoiceSource) => {
    if (path && input.exists(path)) out.push({ path, source });
  };
  // A hex with no note yet: the tables its note will get.
  if (!input.noteExists) {
    add(input.area, "area");
    add(input.terrain, "terrain");
  }
  add(input.map, "map");
  add(input.fallback, "default");
  return orderChoices(out);
}

/** Sorted most specific first (stable within a source); a path listed twice keeps its most specific entry. */
export function orderChoices(items: readonly TableChoiceItem[]): TableChoiceItem[] {
  const rank = (s: ChoiceSource) => SOURCE_ORDER.indexOf(s);
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.source) - rank(b.it.source) || a.i - b.i).map((x) => x.it);
  const seen = new Set<string>();
  return sorted.filter((it) => {
    const key = it.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The item to start on: the one chosen before (if still listed), else the most specific usable one. */
export function initialChoice(items: readonly TableChoiceItem[], remembered?: string | null): number {
  if (remembered) {
    const i = items.findIndex((it) => it.path === remembered);
    if (i >= 0) return i;
  }
  const usable = items.findIndex((it) => !it.missing);
  return usable >= 0 ? usable : 0;
}

/**
 * The choice made per hex and kind, for this session (switching is a
 * look at another table, not an edit: nothing is written, so it works in
 * Play). Keyed by map, hex and kind.
 */
const chosen = new Map<string, string>();

export function choiceKey(map: string, x: number, y: number, kind: string): string {
  return `${map}\u0000${x}_${y}\u0000${kind}`;
}

export function rememberChoice(key: string, path: string): void {
  chosen.set(key, path);
}

export function rememberedChoice(key: string): string | undefined {
  return chosen.get(key);
}

/**
 * The kinds of rolled table a hex has, as data: where each kind's tables
 * are linked and where a roll's result goes by default. Weather and
 * rumours take their map field and starter file from ROLLED_SECTION_TABLES.
 */
export interface TableKind {
  id: "encounters" | RolledSection;
  /** Plain name in UI text ("encounter", "weather"). */
  noun: string;
  /** The hex note's link section for a hex's own tables. */
  hexSection: string;
  /** The map note field holding the map's table. */
  mapField?: RolledSectionTables["mapField"];
  /** Starter table file at the root of the tables folder. */
  starterFile?: string;
  /** Area tables (`{tables}/regions/<area>.md`) apply. */
  areaTables?: boolean;
  /** Terrain encounter tables apply. */
  terrainTables?: boolean;
  /** The text section a roll's result goes to first. */
  rollInto: string;
}

export const TABLE_KINDS: Readonly<Record<TableKind["id"], TableKind>> = {
  encounters: { id: "encounters", noun: "encounter", hexSection: "Encounters Table", areaTables: true, terrainTables: true, rollInto: "description" },
  weather: { id: "weather", ...rolled("weather") },
  "hooks & rumors": { id: "hooks & rumors", ...rolled("hooks & rumors") },
};

function rolled(section: RolledSection): Omit<TableKind, "id"> {
  const s = ROLLED_SECTION_TABLES[section];
  return { noun: s.noun, hexSection: s.hexSection, mapField: s.mapField, starterFile: s.starterFile, rollInto: section };
}

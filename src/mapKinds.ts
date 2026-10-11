/**
 * Map types ("kinds"): the genres of map a user works with. Each kind owns
 * palette presets, procedural generators and (optionally) an icon pack.
 * Turning a kind off in settings hides those from menus — it never touches
 * palettes, maps or icons already in use.
 */

import { terrainTypeInfo } from "./terrainTypes";
import { registry } from "./modules";
import type { KindId, SectionWords } from "./modules/types";

export type { SectionWords } from "./modules/types";

/** A map type id: one per module that is a map type (src/modules). */
export type MapKind = KindId;

export interface MapKindInfo {
  id: MapKind;
  label: string;
  description: string;
  /** Bundled icon prefix this kind owns (hidden from pickers when off). */
  iconPrefix?: string;
  /**
   * Display names for link sections on maps of this kind (G4b), keyed by
   * the section's heading ("Towns"). Display only: the note keeps its
   * headings, so links and older notes still read. Sections not listed
   * keep their usual words.
   */
  sectionWords?: Partial<Record<string, SectionWords>>;
}

/** The map types, in module order (src/modules/index.ts). */
export const MAP_KINDS: MapKindInfo[] = registry.kinds().map((k) => {
  const pack = registry.iconPacks().find((p) => p.kind === k.id);
  return {
    id: k.id,
    label: k.label,
    description: k.description,
    ...(pack ? { iconPrefix: pack.prefix } : {}),
    ...(k.sectionWords ? { sectionWords: k.sectionWords } : {}),
  };
});

/** The usual words for each link section (any map without its own). */
export const DEFAULT_SECTION_WORDS: Record<string, SectionWords> = {
  Towns: { label: "Towns", one: "Town", noun: "a town" },
  Dungeons: { label: "Dungeons", one: "Dungeon", noun: "a dungeon" },
  Features: { label: "Features", one: "Feature", noun: "a feature" },
  Quests: { label: "Quests", one: "Quest", noun: "a quest" },
  Factions: { label: "Factions", one: "Faction", noun: "a faction" },
  "Encounters Table": { label: "Encounters Table", one: "Encounter table", noun: "an encounter table" },
};

/** Looks up a link section's display words; `section` is the heading ("Towns"), any case. */
export type SectionWordsFn = (section: string) => SectionWords;

/** Words for `section` under `kind` (undefined = the usual words). */
export function sectionWords(section: string, kind?: MapKindInfo): SectionWords {
  const key = Object.keys(DEFAULT_SECTION_WORDS).find((k) => k.toLowerCase() === section.toLowerCase()) ?? section;
  return kind?.sectionWords?.[key]
    ?? DEFAULT_SECTION_WORDS[key]
    ?? { label: section, one: section, noun: section.toLowerCase() };
}

/** A lookup bound to one map type. */
export function sectionWordsFor(kind?: MapKindInfo): SectionWordsFn {
  return (section) => sectionWords(section, kind);
}

/**
 * The map type whose section words a map uses (G4b). `chain` is the
 * terrain lists of the map's palette, then its parent's, and so on up: the
 * first one using terrain types of a map type that names its sections
 * decides (a planet submap of a star system keeps the system's words).
 * Driven by the types' data, so any map type with `sectionWords` works.
 */
export function sectionKindFor(
  chain: readonly (readonly { type?: string }[])[],
  kinds: readonly MapKindInfo[] = MAP_KINDS,
  /** Each palette's declared map type (TerrainPalette.kind), same order as `chain`. */
  declared: readonly (string | undefined)[] = [],
): MapKindInfo | undefined {
  for (const [i, terrains] of chain.entries()) {
    const used = new Set(terrains.map((t) => terrainTypeInfo(t.type)?.kind).filter(Boolean));
    if (declared[i]) used.add(declared[i]);
    const hit = kinds.find((k) => k.sectionWords && used.has(k.id));
    if (hit) return hit;
  }
  return undefined;
}

export const ALL_MAP_KINDS: MapKind[] = MAP_KINDS.map((k) => k.id);

/** Kinds enabled in settings; unset (older data.json) = all. */
export function enabledKinds(settings: { mapKinds?: string[] }): Set<MapKind> {
  const list = Array.isArray(settings.mapKinds) ? settings.mapKinds : ALL_MAP_KINDS;
  return new Set(list.filter((k): k is MapKind => (ALL_MAP_KINDS).includes(k)));
}

export function isKindEnabled(settings: { mapKinds?: string[] }, kind: MapKind | undefined): boolean {
  return kind === undefined || enabledKinds(settings).has(kind);
}

/** Icon names hidden from pickers because their kind is off. */
export function isIconHiddenByKind(settings: { mapKinds?: string[] }, icon: string): boolean {
  const on = enabledKinds(settings);
  return MAP_KINDS.some((k) => k.iconPrefix && !on.has(k.id) && icon.startsWith(k.iconPrefix));
}

/**
 * Map type of a learned generator, from its note's `map-kind` frontmatter:
 * a map type's id or one of its aliases (Space: "planet"), any case;
 * anything else → none (always shown).
 */
export function generatorMapKind(meta: Record<string, string | undefined> | undefined): MapKind | undefined {
  return registry.kindId(meta?.["map-kind"]);
}

/** A space palette: at least one terrain has a space terrain type ("void", "star"…). */
export function isSpacePalette(terrains: readonly { type?: string }[] | undefined): boolean {
  return (terrains ?? []).some((t) => terrainTypeInfo(t.type)?.kind === "space");
}

/**
 * The map type a palette belongs to: its declared `kind` (the shipped
 * palettes say; a palette note's `map-kind`), else space when any terrain
 * has a space type, else world. Data on the palette decides, never its name.
 */
export function paletteKind(p: { kind?: string; terrains?: readonly { type?: string }[] } | undefined): MapKind {
  const declared = p?.kind;
  if (declared && (ALL_MAP_KINDS).includes(declared)) return declared;
  return isSpacePalette(p?.terrains) ? "space" : "world";
}

/**
 * Terrains that get description / encounter tables: every palette's, but
 * with World off (a Space-only setup), only the space palettes' — no
 * tables for the fantasy palettes that ship installed (G4). Deduplicated
 * by name, in palette order.
 */
export function terrainsForTables<T extends { name: string; type?: string }>(
  palettes: readonly { name?: string; kind?: string; terrains: readonly T[] }[],
  kinds: Iterable<string>,
  /** Palettes a map uses: their terrains always get tables (HG5). */
  inUse: Iterable<string> = [],
): T[] {
  const spaceOnly = !new Set(kinds).has("world");
  const used = new Set(inUse);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of palettes) {
    if (spaceOnly && paletteKind(p) !== "space" && !(p.name !== undefined && used.has(p.name))) continue;
    for (const t of p.terrains) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

/**
 * Terrains in `terrains` that weren't in `known` (by name): the ones that
 * still need their tables (HG5). Deduplicated, in order.
 */
export function newTerrains<T extends { name: string }>(known: ReadonlySet<string>, terrains: readonly T[]): T[] {
  const seen = new Set<string>();
  return terrains.filter((t) => {
    if (known.has(t.name) || seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

export interface GeneratorShowContext {
  /** The map being made is in space: its palette, or a parent map's, is a
   *  space palette (planet submaps of a system still get planet generators). */
  spaceContext?: boolean;
  /** The current / saved choice: always shown so the value stays visible. */
  selected?: boolean;
}

/**
 * Should a generator of map type `kind` be offered? Yes when its type is on
 * (no type = always), when it's a space generator and the map is in space,
 * or when it's the current choice.
 */
export function isGeneratorShown(
  settings: { mapKinds?: string[] },
  kind: MapKind | undefined,
  ctx: GeneratorShowContext = {},
): boolean {
  return !!ctx.selected || isKindEnabled(settings, kind) || (kind === "space" && !!ctx.spaceContext);
}

/**
 * Map types for settings loaded from data.json. A saved list always wins.
 * Missing (new install, or an upgrade from before map types): world, plus
 * space if a palette already has space terrains — space users keep their
 * options, everyone else isn't shown space ones.
 */
export function resolveMapKinds(
  saved: unknown,
  palettes: readonly { kind?: string; terrains: readonly { type?: string }[] }[],
): MapKind[] {
  if (Array.isArray(saved)) return saved.filter((k): k is MapKind => (ALL_MAP_KINDS as unknown[]).includes(k));
  return palettes.some((p) => paletteKind(p) === "space") ? ["world", "space"] : ["world"];
}

/**
 * Map types ("kinds"): the genres of map a user works with. Each kind owns
 * palette presets, procedural generators and (optionally) an icon pack.
 * Turning a kind off in settings hides those from menus — it never touches
 * palettes, maps or icons already in use.
 */

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

/**
 * The map type a palette's terrain types say: the first type, in module
 * order, with a terrain of one of its own terrain types (Space: "void",
 * "star"…). Land and water types are shared (CM5) and say nothing, so a
 * palette of only those, or untyped, gives undefined. Never by names.
 */
export function inferredKind(terrains: readonly { type?: string }[] | undefined): MapKind | undefined {
  const used = new Set((terrains ?? []).map((t) => registry.moduleTypeKind(t.type)).filter((k): k is MapKind => !!k));
  return registry.kindIds().find((k) => used.has(k));
}

/** inferredKind, else the fallback type (World): what a palette with no declared type counts as. */
export function kindOfTerrains(terrains: readonly { type?: string }[] | undefined): MapKind {
  return inferredKind(terrains) ?? registry.fallbackKind() ?? "";
}

/** A known map type id, or undefined. */
function knownKind(raw: string | undefined): MapKind | undefined {
  return raw && ALL_MAP_KINDS.includes(raw) ? raw : undefined;
}

/**
 * The map type a palette belongs to: its declared `kind` (the shipped
 * palettes say; a palette note's `map-kind`), else what its terrain types
 * say (kindOfTerrains). Data on the palette decides, never its name.
 */
export function paletteKind(p: { kind?: string; terrains?: readonly { type?: string }[] } | undefined): MapKind {
  return knownKind(p?.kind) ?? kindOfTerrains(p?.terrains);
}

/** A palette (or preset) in a map's chain, as the map-type rules see it. */
export type ChainPalette = { kind?: string; terrains?: readonly { type?: string }[] } | undefined;

/**
 * One rule for a map's type (owner call CM3): walk from the map up its
 * parents (`chain`: the map's palette first); the nearest palette that
 * says a type decides. A palette says a type by declaring one (`kind`, a
 * palette note's `map-kind`), else by having terrains of a module's own
 * types (inferredKind). Shared land and water types say nothing, so a
 * plain planet-surface palette under a star system is in space. No palette
 * says one: none. Section words, the Region / Location cards and "turn this
 * module on?" all use it.
 */
export function kindForChain(chain: readonly ChainPalette[]): MapKind | undefined {
  for (const p of chain) {
    const k = knownKind(p?.kind) ?? inferredKind(p?.terrains);
    if (k) return k;
  }
  return undefined;
}

/**
 * The map types in context on a map: each palette's type (paletteKind)
 * along the chain. Generators of a type that is offered in context
 * (Space) show on such maps even with the type off (a planet submap of a
 * star system still gets planet generators).
 */
export function contextKindsOf(chain: readonly ChainPalette[]): Set<MapKind> {
  return new Set(chain.filter((p) => p !== undefined).map((p) => paletteKind(p)));
}

/**
 * A generator-note tag (its raw `map-kind:`) offered only from a map made
 * by a generator with the same tag (see KindInfo.contextOnlyTags).
 */
export function isContextOnlyTag(tag: string | undefined): boolean {
  return tag !== undefined && registry.kinds().some((k) => (k.contextOnlyTags ?? []).includes(tag));
}

/** MapKindInfo for a map type id (section words etc.), or undefined. */
export function mapKindInfo(kind: MapKind | undefined): MapKindInfo | undefined {
  return kind ? MAP_KINDS.find((k) => k.id === kind) : undefined;
}

/**
 * Terrains that get description / encounter tables: every palette's,
 * except that the fallback type's palettes (World: the fantasy palettes
 * that ship installed) get none while that type is off (G4: a Space-only
 * setup). Palettes a map uses always do. Deduplicated by name, in palette
 * order.
 */
export function terrainsForTables<T extends { name: string; type?: string }>(
  palettes: readonly { name?: string; kind?: string; terrains: readonly T[] }[],
  kinds: Iterable<string>,
  /** Palettes a map uses: their terrains always get tables (HG5). */
  inUse: Iterable<string> = [],
): T[] {
  const fallback = registry.fallbackKind();
  const fallbackOff = fallback !== undefined && !new Set(kinds).has(fallback);
  const used = new Set(inUse);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of palettes) {
    if (fallbackOff && paletteKind(p) === fallback && !(p.name !== undefined && used.has(p.name))) continue;
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
  /** Map types in context where the map is made (contextKindsOf): its
   *  palette's, its parents' (planet submaps of a system still get planet
   *  generators). */
  context?: ReadonlySet<MapKind>;
  /** The current / saved choice: always shown so the value stays visible. */
  selected?: boolean;
}

/**
 * Should a generator of map type `kind` be offered? Yes when its type is on
 * (no type = always), when its type is offered in context (Space) and is
 * in the map's context, or when it's the current choice.
 */
export function isGeneratorShown(
  settings: { mapKinds?: string[] },
  kind: MapKind | undefined,
  ctx: GeneratorShowContext = {},
): boolean {
  return !!ctx.selected || isKindEnabled(settings, kind)
    || (!!kind && !!registry.kindInfo(kind)?.offerInContext && !!ctx.context?.has(kind));
}

/**
 * Map types for settings loaded from data.json. A saved list always wins.
 * Missing (new install, or an upgrade from before map types): the fallback
 * type (World), plus every type a palette already belongs to — space users
 * keep their options, everyone else isn't shown space ones.
 */
export function resolveMapKinds(
  saved: unknown,
  palettes: readonly { kind?: string; terrains: readonly { type?: string }[] }[],
): MapKind[] {
  if (Array.isArray(saved)) return saved.filter((k): k is MapKind => (ALL_MAP_KINDS as unknown[]).includes(k));
  const fallback = registry.fallbackKind();
  return ALL_MAP_KINDS.filter((k) => k === fallback || palettes.some((p) => paletteKind(p) === k));
}

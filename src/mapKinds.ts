/**
 * Map types ("kinds"): the genres of map a user works with. Each kind owns
 * palette presets, procedural generators and (optionally) an icon pack.
 * Turning a kind off in settings hides those from menus — it never touches
 * palettes, maps or icons already in use.
 */

import { terrainTypeInfo } from "./terrainTypes";

export type MapKind = "world" | "space";

export interface MapKindInfo {
  id: MapKind;
  label: string;
  description: string;
  /** Bundled icon prefix this kind owns (hidden from pickers when off). */
  iconPrefix?: string;
}

export const MAP_KINDS: MapKindInfo[] = [
  {
    id: "world",
    label: "World / fantasy overland",
    description: "Continents, regions and local areas: forests, mountains, coasts. Includes the Limited and Expanded palettes and the Region detail generator.",
  },
  {
    id: "space",
    label: "Space",
    description: "Sector charts, star systems and planets: Space - Sector / Space - System palettes, Star scatter, Orbits and Planet surface generators, planet generators, the space icon pack.",
    iconPrefix: "space-",
  },
];

export const ALL_MAP_KINDS: MapKind[] = MAP_KINDS.map((k) => k.id);

/** Kinds enabled in settings; unset (older data.json) = all. */
export function enabledKinds(settings: { mapKinds?: string[] }): Set<MapKind> {
  const list = Array.isArray(settings.mapKinds) ? settings.mapKinds : ALL_MAP_KINDS;
  return new Set(list.filter((k): k is MapKind => (ALL_MAP_KINDS as string[]).includes(k)));
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
 * "planet" / "space" → space, "world" → world, anything else → none
 * (always shown).
 */
export function generatorMapKind(meta: Record<string, string | undefined> | undefined): MapKind | undefined {
  const raw = meta?.["map-kind"]?.trim().toLowerCase();
  if (raw === "planet" || raw === "space") return "space";
  if (raw === "world") return "world";
  return undefined;
}

/** A space palette: at least one terrain has a space terrain type ("void", "star"…). */
export function isSpacePalette(terrains: readonly { type?: string }[] | undefined): boolean {
  return (terrains ?? []).some((t) => terrainTypeInfo(t.type)?.kind === "space");
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
  palettes: readonly { terrains: readonly { type?: string }[] }[],
): MapKind[] {
  if (Array.isArray(saved)) return saved.filter((k): k is MapKind => (ALL_MAP_KINDS as unknown[]).includes(k));
  return palettes.some((p) => isSpacePalette(p.terrains)) ? ["world", "space"] : ["world"];
}

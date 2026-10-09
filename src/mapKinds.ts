/**
 * Map types ("kinds"): the genres of map a user works with. Each kind owns
 * palette presets, procedural generators and (optionally) an icon pack.
 * Turning a kind off in settings hides those from menus — it never touches
 * palettes, maps or icons already in use.
 */

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
    description: "Continents, regions and local areas: forests, mountains, coasts. Includes the Limited and Expanded palettes and the Planet surface generator.",
  },
  {
    id: "space",
    label: "Space",
    description: "Sector charts and star systems: Space - Sector / Space - System palettes, Star scatter and Orbits generators, the space icon pack.",
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

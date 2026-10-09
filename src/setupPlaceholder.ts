/**
 * The "default" map: DEFAULT_SETTINGS ships one so a fresh install has a
 * map to open, and the map-note store writes its note
 * (`{hexFolder}/default/_default.md`) at startup. Once the setup wizard
 * has made the user's own first map, an untouched "default" is just a
 * mystery entry in the map list, so the wizard removes it.
 */

export const PLACEHOLDER_MAP_NAME = "default";

/**
 * Is this the shipped placeholder, never used? True only when it has no
 * hex data, paths, parent / world slot or background, no other map
 * points at it, and its folder holds nothing but its own map note.
 */
export function isUnusedPlaceholderMap(
  map: {
    name: string;
    pathChains?: unknown[];
    parent?: unknown;
    world?: unknown;
    backgroundImage?: unknown;
  },
  usage: {
    /** Hexes with data in the map store. */
    hexCount: number;
    /** File / folder names directly inside the map's folder. */
    folderEntries: string[];
    /** Another map has it as parent, neighbour or submap. */
    referenced: boolean;
  },
): boolean {
  if (map.name !== PLACEHOLDER_MAP_NAME) return false;
  if (usage.hexCount > 0 || usage.referenced) return false;
  if ((map.pathChains?.length ?? 0) > 0 || map.parent || map.world || map.backgroundImage) return false;
  return usage.folderEntries.every((n) => n === `_${PLACEHOLDER_MAP_NAME}.md`);
}

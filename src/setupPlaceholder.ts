/**
 * The "default" map: DEFAULT_SETTINGS ships one so a fresh install has a
 * map to open, and the map-note store writes its note
 * (`{hexFolder}/default/_default.md`) at startup. Once the setup wizard
 * has made the user's own first map, an untouched "default" is just a
 * mystery entry in the map list, so the wizard removes it.
 */

import type { PathChain } from "./types";
import { storedMapPaths } from "./paths/mapPaths";

export const PLACEHOLDER_MAP_NAME = "default";

/**
 * Is this the shipped placeholder, never used? True only when it has no
 * hex data, paths, parent / world slot or background, no other map
 * points at it, and its folder holds nothing but its own map note.
 */
export function isUnusedPlaceholderMap(
  map: {
    name: string;
    pathChains?: PathChain[];
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
  if (storedMapPaths(map).length > 0 || map.parent || map.world || map.backgroundImage) return false;
  return usage.folderEntries.every((n) => n === `_${PLACEHOLDER_MAP_NAME}.md`);
}

/**
 * When the stores may start (and so write their first notes). A fresh
 * install that is about to show the setup wizard, with no world folder on
 * disk yet, waits until `release()`: the wizard's folder step (once the
 * user confirms the folder), the wizard closing for any reason, or a map
 * view opening. Before this, the palette notes and the placeholder map's
 * note appeared in `world/` while the wizard was still asking where the
 * world should live (fresh-eyes F19). Anything else starts at once.
 */
export function startupWritesWait(
  settings: { setupComplete?: boolean; setupDismissed?: boolean; worldFolder?: string },
  exists: (path: string) => boolean,
): { wait: Promise<void>; release: () => void; held: boolean } {
  const world = (settings.worldFolder ?? "").trim().replace(/^\/+|\/+$/g, "") || "world";
  const fresh = !settings.setupComplete && !settings.setupDismissed && !exists(world);
  if (!fresh) return { wait: Promise.resolve(), release: () => {}, held: false };
  let release = () => {};
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release: () => release(), held: true };
}

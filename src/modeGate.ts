/**
 * THE write gate for work modes (src/workMode.ts). Data writers that carry a
 * user action (MapStore.set with an action, the frontmatter hex setters,
 * token writes, the path gate) ask `guardWrite(map, action)` first; a
 * refused write is dropped with a console warning, never written.
 *
 * The plugin registers how to look a map up (`setModeMapLookup`); with no
 * lookup (tests, early load) or an unknown map, everything is allowed.
 * Pure, no Obsidian imports.
 */
import { lockedHint, mapAllows, type ModeAction } from "./workMode";

type MapLookup = (mapName: string) => { workMode?: string } | undefined;
let lookup: MapLookup | null = null;

/** Tell the gate how to find a map (and so its work mode). */
export function setModeMapLookup(fn: MapLookup | null): void {
  lookup = fn;
}

/** May `action` be done on map `mapName` in its current mode? */
export function canDo(mapName: string, action: ModeAction): boolean {
  if (!lookup) return true;
  const map = lookup(mapName);
  if (!map) return true;
  return mapAllows(map, action);
}

/** `canDo`, and a console warning when it refuses (the write is dropped). */
export function guardWrite(mapName: string, action: ModeAction): boolean {
  if (canDo(mapName, action)) return true;
  console.warn(`[hexmaker] refused a ${action} write on "${mapName}": ${lockedHint(action)}`);
  return false;
}

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

/**
 * Actions that are a hand edit of a map's hexes or paths: painting terrain
 * or icons, region areas, swapping hexes, drawing paths. The first one on a
 * new (open) place locks it (owner 2026-10-12: "rerolls NEED to work on
 * build mode until the user locks the region by painting their own stuff
 * on it"). Navigating, viewing, notes, tokens and generated writes (reroll,
 * generation, keep-the-route pins) never count.
 */
export const HAND_EDIT_ACTIONS: ReadonlySet<ModeAction> = new Set<ModeAction>(["paint-terrain", "paint-icon", "paint-region-area", "edit-path", "swap-hexes"]);

type HandEditListener = (mapName: string, action: ModeAction) => void;
let handEdit: HandEditListener | null = null;

/** Hear about every allowed hand edit (the plugin locks open places on the first). */
export function setHandEditListener(fn: HandEditListener | null): void {
  handEdit = fn;
}

/** Report a hand edit to map `mapName` (only HAND_EDIT_ACTIONS count). */
export function noteHandEdit(mapName: string, action: ModeAction): void {
  if (HAND_EDIT_ACTIONS.has(action)) handEdit?.(mapName, action);
}

/**
 * `canDo`, and a console warning when it refuses (the write is dropped).
 * An allowed hand edit is reported (noteHandEdit): every gated writer
 * passes here, so this is the one place hand edits are seen.
 */
export function guardWrite(mapName: string, action: ModeAction): boolean {
  if (canDo(mapName, action)) {
    noteHandEdit(mapName, action);
    return true;
  }
  console.warn(`[hexmaker] refused a ${action} write on "${mapName}": ${lockedHint(action)}`);
  return false;
}

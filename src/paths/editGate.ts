/**
 * THE GATE for path edits. Every change to a map's stored paths made by
 * the plugin at runtime goes through `canEditPaths` first: the path tool's
 * edits (pathTool.ts applyEdit, including undo/redo of path steps), the
 * keep-the-route pins when terrain, the palette, the map's size or a type's
 * routing changes (routePins.ts), and "Reroute instead".
 *
 * It answers "is this allowed in this map's work mode?" (src/workMode.ts:
 * Play / Build / God). Drawing, reshaping, undo/redo and "Reroute instead"
 * count as Build, so they need Build or God. Keep-the-route pins only
 * preserve what is already drawn, so they are allowed in every mode.
 * The plugin registers how to look a map up (`setPathEditMapLookup`); with
 * no lookup (tests, early load) everything is allowed.
 * Pure, no Obsidian imports.
 */
import { canAdd } from "../workMode";

/** What kind of path edit is being asked for. */
export type PathEditAction =
  /** The path tool: draw, extend, fork, drag, delete, split, rename, retype, reverse. */
  | "draw"
  /** Undo or redo of a path step. */
  | "history"
  /** Keep a route where it was after its routing inputs changed (Decision 3). */
  | "pin"
  /** "Reroute instead": drop the anchors a pin added. */
  | "reroute";

type MapLookup = (mapName: string) => { workMode?: string } | undefined;
let lookup: MapLookup | null = null;

/** Tell the gate how to find a map (and so its work mode). */
export function setPathEditMapLookup(fn: MapLookup | null): void {
  lookup = fn;
}

/** Shown when a path edit is refused because of the map's mode. */
export const PATH_EDIT_LOCKED_HINT = "Switch to Build to change paths on this map.";

/** May `action` change the stored paths of map `mapName`? */
export function canEditPaths(mapName: string, action: PathEditAction): boolean {
  if (action === "pin") return true; // keeps what is drawn; never a user change
  if (!lookup) return true;
  return canAdd(lookup(mapName));
}

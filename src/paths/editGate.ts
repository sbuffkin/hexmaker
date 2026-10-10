/**
 * THE GATE for path edits. Every change to a map's stored paths made by
 * the plugin at runtime goes through `canEditPaths` first: the path tool's
 * edits (pathTool.ts applyEdit, including undo/redo of path steps), the
 * keep-the-route pins when terrain, the palette, the map's size or a type's
 * routing changes (routePins.ts), and "Reroute instead".
 *
 * Today it always allows. It is the one place a per-map mode (Play / Build /
 * God, being added on fix/ow-playtest) will answer "is this allowed in this
 * map's mode?": drawing and reshaping paths count as Build. Whether pins
 * over regenerated terrain are allowed outside Build is still undecided.
 * Pure, no Obsidian imports.
 */

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

/** May `action` change the stored paths of map `mapName`? (Always yes, for now.) */
export function canEditPaths(mapName: string, action: PathEditAction): boolean {
  void mapName;
  void action;
  return true;
}

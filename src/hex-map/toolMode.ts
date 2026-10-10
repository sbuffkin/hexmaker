/**
 * Pure helpers for the map's drawing tools (the on-map mode indicator).
 * Kept free of Obsidian imports so they're unit-testable. What a path-tool
 * click does is pathClickOutcome in pathTool.ts.
 */

export type DrawingMode =
  | "path"
  | "terrain"
  | "icon"
  | "tableLink"
  | "submapLink"
  | "factionLink"
  | "regionLink"
  | "swap"
  | "placeToken";

export interface ToolModeState {
  mode: DrawingMode | null;
  erasing: boolean;
  terrainName?: string | null;
  terrainPick?: boolean;
  iconName?: string | null;
  iconGmOnly?: boolean;
  pathTypeName?: string | null;
  /** Path tool in auto-route mode (far clicks are routed). */
  pathAuto?: boolean;
  /** A branch is being drawn (clicks add anchors). */
  pathDrawing?: boolean;
  /** The selected path's name, and "Road, 2 forks". */
  pathSelected?: string | null;
  pathSummary?: string | null;
  /** "New path" pressed: the next click starts one. */
  pathNew?: boolean;
  /** A short note about the last click. */
  pathNote?: string | null;
  tablePath?: string | null;
  submapName?: string | null;
  factionPath?: string | null;
  regionPath?: string | null;
}

/** "world/factions/Red Hand.md" → "Red Hand"; icon file → its name. */
function baseName(p: string | null | undefined): string {
  if (!p) return "";
  return (p.split("/").pop() ?? p).replace(/\.(md|png|svg|jpe?g|webp)$/i, "");
}

/**
 * Text for the on-map mode indicator ("Painting terrain: forest"), or null
 * when no tool is active. Paint modes are sticky, so the map says which one
 * is on (fresh-eyes T3).
 */
export function toolModeLabel(s: ToolModeState): string | null {
  const { mode, erasing } = s;
  switch (mode) {
    case null:
      return null;
    case "terrain":
      if (s.terrainPick) return "Picking terrain: click a hex to copy its terrain";
      if (erasing || !s.terrainName) return "Clearing terrain";
      return `Painting terrain: ${s.terrainName}`;
    case "icon": {
      const what = s.iconGmOnly ? "GM icon" : "icon";
      if (erasing || !s.iconName) return `Erasing ${what}s`;
      return `Painting ${what}: ${baseName(s.iconName)}`;
    }
    case "path": {
      if (erasing) return "Erasing paths: click a path to split it there";
      const type = s.pathTypeName ?? "Path";
      const how = s.pathAuto ? "auto-routes" : "hex by hex";
      const note = s.pathNote ? ` · ${s.pathNote}` : "";
      if (s.pathNew) return `New ${type}: click where it starts`;
      if (s.pathDrawing) {
        const name = s.pathSelected ?? `New ${type}`;
        return `${name}: click to add (${how}) · Esc to finish${note}`;
      }
      if (s.pathSelected) {
        const what = s.pathSummary ? ` (${s.pathSummary})` : "";
        return `${s.pathSelected}${what}: drag the line to reshape · click an end to continue · click the line to fork${note}`;
      }
      return `${type}: click to start a path · click a path to edit it${note}`;
    }
    case "tableLink":
      return erasing ? "Unlinking tables" : `Linking table: ${baseName(s.tablePath) || "…"}`;
    case "submapLink":
      return erasing ? "Unlinking submaps" : `Linking submap: ${s.submapName ?? "…"}`;
    case "factionLink":
      return erasing ? "Erasing factions" : `Painting faction: ${baseName(s.factionPath) || "…"}`;
    case "regionLink":
      return erasing ? "Erasing regions" : `Painting region: ${baseName(s.regionPath) || "…"}`;
    case "swap":
      return "Swapping hexes: click two hexes";
    case "placeToken":
      return "Placing token: click a hex";
  }
}

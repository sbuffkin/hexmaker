/**
 * Pure helpers for the map's drawing tools (path clicks, the on-map mode
 * indicator). Kept free of Obsidian imports so they're unit-testable.
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

/**
 * What a left-click on hex `key` does while drawing a path:
 * - "start": no path in progress, so start one here;
 * - "extend": `key` neighbours the end of the path in progress;
 * - "same": `key` IS the end of the path (ignore — don't stack a dot);
 * - "restart": `key` isn't next to the end, so a new path starts there.
 *   Paths go hex by hex, so the caller should say so (fresh-eyes T7: two
 *   distant clicks silently gave a single dot).
 */
export function pathClickOutcome(
  activeEnd: string | null,
  key: string,
  neighbourKeysOfEnd: readonly string[],
): "start" | "extend" | "same" | "restart" {
  if (activeEnd === null) return "start";
  if (key === activeEnd) return "same";
  return neighbourKeysOfEnd.includes(key) ? "extend" : "restart";
}

export interface ToolModeState {
  mode: DrawingMode | null;
  erasing: boolean;
  terrainName?: string | null;
  terrainPick?: boolean;
  iconName?: string | null;
  iconGmOnly?: boolean;
  pathTypeName?: string | null;
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
    case "path":
      if (erasing) return "Erasing paths: click a path hex to remove it";
      return `Drawing ${s.pathTypeName ?? "path"}: click neighbouring hexes`;
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

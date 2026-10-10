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

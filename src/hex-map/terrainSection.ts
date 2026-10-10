/**
 * The hex editor's Terrain section (fresh-eyes round 5): it reopened with
 * the whole 50-swatch grid expanded on every hex (it only remembered being
 * collapsed), in a small nested scroll box with no filter. Pure helpers so
 * the rules are unit-testable; HexEditorModal renders them.
 */

/**
 * Whether the Terrain section starts collapsed to its one-line summary
 * ("Terrain: forest ▸ change"). Collapsing it once keeps it collapsed
 * everywhere (`collapsedFlag`); expanding it once keeps it expanded
 * (`userExpanded`). Otherwise a hex that already has its own terrain opens
 * collapsed (you came for something else) and a bare hex opens expanded
 * (picking a terrain is likely why you're here).
 */
export function terrainStartsCollapsed(hasTerrain: boolean, collapsedFlag: boolean, userExpanded: boolean | undefined): boolean {
  if (collapsedFlag) return true;
  if (userExpanded === true) return false;
  return hasTerrain;
}

/** Palettes longer than this get a filter box above the swatches. */
export const TERRAIN_FILTER_MIN = 12;

/** Whether a terrain name matches the filter text (case-insensitive substring; blank matches all). */
export function terrainMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}

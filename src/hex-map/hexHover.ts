/**
 * Hover text for a map hex: its terrain and coordinates, so bodies on a
 * system map (or terrain on any map) can be told apart without opening each
 * hex (fresh-eyes round 3: "hovering the map tells you nothing").
 */
export function hexHoverLabel(
  x: number,
  y: number,
  ownTerrain: string | null,
  baseTerrain: string | null,
): string {
  const where = `hex ${x}, ${y}`;
  if (ownTerrain) return `${ownTerrain} · ${where}`;
  if (baseTerrain) return `${baseTerrain} (map base) · ${where}`;
  return `Hex ${x}, ${y}`;
}

/**
 * A hex key ("x_y", as used in file names and data) written for people:
 * "x, y", like every title, tooltip and notice (round 5: a token card said
 * "Hex 3_4" while the editor said "Hex 3, 5"). Non-keys pass through.
 */
export function hexKeyCoords(key: string): string {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key.trim());
  return m ? `${m[1]}, ${m[2]}` : key;
}

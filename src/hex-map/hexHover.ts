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

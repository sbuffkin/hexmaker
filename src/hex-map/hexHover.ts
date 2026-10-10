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

/**
 * Whether removed DOM nodes include a modal or a menu. When one closes over
 * the map, the hex under the (unmoved) pointer lights up as if hovered
 * (round 5: "a stray olive highlight on 8,12" after Create token), so the
 * map pauses its hover highlight until the pointer really moves.
 */
export function overlayClosed(removed: Iterable<Node>): boolean {
  for (const n of removed) {
    if (n.nodeType !== 1) continue;
    const cl = (n as Element).classList;
    if (cl.contains("modal-container") || cl.contains("menu")) return true;
  }
  return false;
}

/** The pointer moved away from where it was when hover was paused. */
export function pointerMovedFrom(at: { x: number; y: number } | null, x: number, y: number): boolean {
  return at !== null && (at.x !== x || at.y !== y);
}

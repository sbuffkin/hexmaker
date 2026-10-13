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
  name: string | null = null,
  linked = "",
  region: string | null = null,
): string {
  const where = `hex ${x}, ${y}`;
  const label = ownTerrain
    ? `${ownTerrain} · ${where}`
    : baseTerrain
      ? `${baseTerrain} (map base) · ${where}`
      : `Hex ${x}, ${y}`;
  // A named hex leads with its name (N1).
  const named = name ? `${name} · ${label}` : label;
  // An overworld hex in the Biomes view: its region (it has no outline there).
  const full = region ? `${named} · Region: ${region}` : named;
  // Then what it links: "· Town: Gullmouth" (round 6 S3).
  return linked ? `${full} · ${linked}` : full;
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

/**
 * Hover text on an overworld's Regions view: the region under the pointer,
 * or an empty slot ("brick") of the overworld, or nothing (blank map area,
 * off the bricks). `cell` is the layer's hit (null off the grid);
 * `emptySlot` says whether its slot is an empty one on the map. `path`:
 * the name of a path line under the pointer, shown first.
 */
export function regionsViewTip(
  cell: { region?: string; parentHex: string } | null,
  opts: { label: (region: string) => string; emptySlot: (parentHex: string) => boolean; canAdd: boolean; path?: string },
): string {
  const base = regionTip(cell, opts);
  if (!opts.path) return base;
  return base ? `${opts.path}
${base}` : opts.path;
}

function regionTip(
  cell: { region?: string; parentHex: string } | null,
  opts: { label: (region: string) => string; emptySlot: (parentHex: string) => boolean; canAdd: boolean },
): string {
  if (!cell) return "";
  if (cell.region) return `${opts.label(cell.region)}: click to go there`;
  if (!opts.emptySlot(cell.parentHex)) return "";
  return `No region yet (hex ${hexKeyCoords(cell.parentHex)})` + (opts.canAdd ? ": click to set its biome" : "");
}

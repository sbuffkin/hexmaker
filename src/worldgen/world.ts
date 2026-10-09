/**
 * Neighbour regions: maps placed side by side on one shared sheet of hex
 * grid paper (a "world").
 *
 * Every map in a world has the same width and height and sits in a slot
 * (cx, cy); its neighbours are whatever maps sit in the slots around it. A
 * hex's world position is its slot times the map size plus its place in the
 * map, so walking off one map's edge lands on the right hex of the next, and
 * going east then south reaches the same map as south then east.
 *
 * Hex grids also stagger every other column (flat-top) or row (pointy-top).
 * Across a border the stagger has to carry on as if it were one map, or the
 * hexes along the seam wouldn't line up. Each map's own stagger setting is
 * chosen (new maps) or checked (existing maps) so it does.
 *
 * Pure: works on map-like records; callers save the changes.
 */

export type Side = "north" | "south" | "east" | "west";
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];
export const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };
const DELTA: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export interface WorldSlot {
  /** Shared by every map in the world. */
  id: string;
  cx: number;
  cy: number;
}

export interface RegionLike {
  name: string;
  paletteName: string;
  gridSize: { cols: number; rows: number };
  gridOffset: { x: number; y: number };
  staggerOffset?: "odd" | "even";
  world?: WorldSlot;
}

export type Orientation = "flat" | "pointy";
export type Stagger = "odd" | "even";

export interface GridRules {
  orientation: Orientation;
  /** The plugin-wide stagger, for maps that don't set their own. */
  stagger: Stagger;
}

const staggerOf = (m: RegionLike, rules: GridRules): Stagger => m.staggerOffset ?? rules.stagger;

/** Whether a column (flat) / row (pointy) at coordinate n is the shifted one. */
export const isShifted = (stagger: Stagger, n: number): boolean => (stagger === "odd" ? Math.abs(n) % 2 === 1 : Math.abs(n) % 2 === 0);

/** World position of a map's local hex (the hex may lie outside the map). */
export function toWorld(m: RegionLike, x: number, y: number): { wx: number; wy: number } | null {
  if (!m.world) return null;
  return { wx: m.world.cx * m.gridSize.cols + (x - m.gridOffset.x), wy: m.world.cy * m.gridSize.rows + (y - m.gridOffset.y) };
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export function mapAt<T extends RegionLike>(maps: T[], worldId: string, cx: number, cy: number): T | undefined {
  return maps.find((m) => m.world?.id === worldId && m.world.cx === cx && m.world.cy === cy);
}

export function neighbour<T extends RegionLike>(maps: T[], m: RegionLike, side: Side): T | undefined {
  if (!m.world) return undefined;
  const [dx, dy] = DELTA[side];
  return mapAt(maps, m.world.id, m.world.cx + dx, m.world.cy + dy);
}

export function neighbours<T extends RegionLike>(maps: T[], m: RegionLike): Partial<Record<Side, T>> {
  const out: Partial<Record<Side, T>> = {};
  for (const s of SIDES) {
    const n = neighbour(maps, m, s);
    if (n) out[s] = n;
  }
  return out;
}

/**
 * Which map and local hex a hex of `m` really is: itself if it's inside, the
 * neighbouring map's hex if it's past an edge (any distance, any direction),
 * or null if no map sits there.
 */
export function resolveHex<T extends RegionLike>(maps: T[], m: T, x: number, y: number): { map: T; x: number; y: number } | null {
  const { cols, rows } = m.gridSize;
  const inside = x >= m.gridOffset.x && x < m.gridOffset.x + cols && y >= m.gridOffset.y && y < m.gridOffset.y + rows;
  if (inside) return { map: m, x, y };
  const w = toWorld(m, x, y);
  if (!w || !m.world) return null;
  const cx = floorDiv(w.wx, cols), cy = floorDiv(w.wy, rows);
  const other = mapAt(maps, m.world.id, cx, cy);
  if (!other) return null;
  return { map: other, x: other.gridOffset.x + (w.wx - cx * cols), y: other.gridOffset.y + (w.wy - cy * rows) };
}

/**
 * The stagger a map in slot (cx, cy) with this offset must use so that its
 * stagger carries on from `ref`'s (another map in the same world).
 */
export function staggerToMatch(ref: RegionLike, refStagger: Stagger, cx: number, cy: number, offset: { x: number; y: number }, rules: GridRules): Stagger {
  if (!ref.world) return refStagger;
  const flat = rules.orientation === "flat";
  // The world coordinate along the stagger axis at the new map's first local
  // column/row, and the same world coordinate seen from ref's local frame.
  const size = flat ? ref.gridSize.cols : ref.gridSize.rows;
  const newOrigin = flat ? offset.x : offset.y;
  const refOrigin = flat ? ref.gridOffset.x : ref.gridOffset.y;
  const refSlot = flat ? ref.world.cx : ref.world.cy;
  const newSlot = flat ? cx : cy;
  const worldAtNew = newSlot * size; // world coord of the new map's first column/row
  const refLocal = refOrigin + (worldAtNew - refSlot * size);
  const shifted = isShifted(refStagger, refLocal);
  // Pick the stagger under which the new map's first column/row has that shift.
  return isShifted("odd", newOrigin) === shifted ? "odd" : "even";
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

/** Whether `m` could sit in (cx, cy) of the world `members` belong to. */
export function canPlace(members: RegionLike[], m: RegionLike, cx: number, cy: number, rules: GridRules, ignore: Set<string> = new Set()): PlaceCheck {
  const others = members.filter((o) => o.name !== m.name && !ignore.has(o.name));
  const ref = others[0];
  if (!ref) return { ok: true };
  const taken = others.find((o) => o.world && o.world.cx === cx && o.world.cy === cy);
  if (taken) return { ok: false, reason: `"${taken.name}" is already there` };
  if (m.paletteName !== ref.paletteName)
    return { ok: false, reason: `"${m.name}" uses palette "${m.paletteName}"; neighbouring regions must all use "${ref.paletteName}"` };
  if (m.gridSize.cols !== ref.gridSize.cols || m.gridSize.rows !== ref.gridSize.rows)
    return { ok: false, reason: `"${m.name}" is ${m.gridSize.cols}×${m.gridSize.rows}; neighbouring regions must all be ${ref.gridSize.cols}×${ref.gridSize.rows}` };
  const need = staggerToMatch(ref, staggerOf(ref, rules), cx, cy, m.gridOffset, rules);
  if (need !== staggerOf(m, rules))
    return {
      ok: false,
      reason: `"${m.name}"'s ${rules.orientation === "flat" ? "columns" : "rows"} are staggered the other way, so its hexes wouldn't line up along the border. Changing that would shift every hex already painted; make a new region instead`,
    };
  return { ok: true };
}

/** A new world id. */
export const newWorldId = (): string => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export type LinkResult = { ok: true; changes: Map<string, WorldSlot> } | { ok: false; reason: string };

/**
 * Put `b` on `side` of `a`. If `b` is in a world of its own, that whole world
 * moves along with it (keeping its layout), as long as nothing overlaps.
 * Returns the new slot for every map that changes; nothing is changed here.
 */
export function link(maps: RegionLike[], aName: string, side: Side, bName: string, rules: GridRules, makeId = newWorldId): LinkResult {
  const a = maps.find((m) => m.name === aName), b = maps.find((m) => m.name === bName);
  if (!a || !b) return { ok: false, reason: "Map not found" };
  if (a.name === b.name) return { ok: false, reason: "A region can't neighbour itself" };
  const changes = new Map<string, WorldSlot>();
  const aSlot: WorldSlot = a.world ?? { id: makeId(), cx: 0, cy: 0 };
  if (!a.world) changes.set(a.name, aSlot);
  const [dx, dy] = DELTA[side];
  const tx = aSlot.cx + dx, ty = aSlot.cy + dy;
  const aWorld = maps.filter((m) => m.world?.id === aSlot.id || m.name === a.name).map((m) => (m.name === a.name ? { ...m, world: aSlot } : m));

  if (b.world && b.world.id === aSlot.id) {
    if (b.world.cx === tx && b.world.cy === ty) return { ok: true, changes };
    return { ok: false, reason: `"${b.name}" is already elsewhere in this group of regions` };
  }
  // Everything that moves: b alone, or b's whole world shifted so b lands on the target.
  const moving = b.world ? maps.filter((m) => m.world?.id === b.world!.id) : [b];
  const sx = tx - (b.world?.cx ?? 0), sy = ty - (b.world?.cy ?? 0);
  for (const m of moving) {
    const cx = (m.world?.cx ?? 0) + sx, cy = (m.world?.cy ?? 0) + sy;
    const check = canPlace(aWorld, m, cx, cy, rules);
    if (!check.ok) return { ok: false, reason: check.reason };
  }
  for (const m of moving) changes.set(m.name, { id: aSlot.id, cx: (m.world?.cx ?? 0) + sx, cy: (m.world?.cy ?? 0) + sy });
  return { ok: true, changes };
}

/**
 * Where a new region on `side` of `a` goes: its slot, and the offset and
 * stagger it should be made with (same offset as `a`; stagger to match).
 */
export function newNeighbourSpec(
  maps: RegionLike[],
  a: RegionLike,
  side: Side,
  rules: GridRules,
  makeId = newWorldId,
): { ok: true; slot: WorldSlot; aSlot: WorldSlot; cols: number; rows: number; offset: { x: number; y: number }; stagger: Stagger; paletteName: string } | { ok: false; reason: string } {
  const aSlot: WorldSlot = a.world ?? { id: makeId(), cx: 0, cy: 0 };
  const [dx, dy] = DELTA[side];
  const slot = { id: aSlot.id, cx: aSlot.cx + dx, cy: aSlot.cy + dy };
  const taken = mapAt(maps, aSlot.id, slot.cx, slot.cy);
  if (taken && a.world) return { ok: false, reason: `"${taken.name}" is already ${side} of "${a.name}"` };
  const placed = { ...a, world: aSlot };
  const stagger = staggerToMatch(placed, staggerOf(a, rules), slot.cx, slot.cy, a.gridOffset, rules);
  return { ok: true, slot, aSlot, cols: a.gridSize.cols, rows: a.gridSize.rows, offset: { ...a.gridOffset }, stagger, paletteName: a.paletteName };
}

/** Depth of the neighbour "shadow" shown past each edge: 1 for small maps, 2 medium, 3 large. */
export function shadowDepth(cols: number, rows: number): number {
  const n = Math.max(cols, rows);
  return n <= 20 ? 1 : n <= 30 ? 2 : 3;
}

/**
 * Hexes past `m`'s edges that belong to a neighbour, up to `depth` deep (the
 * corners too, when a diagonal map exists): local key of the hex in `m`'s
 * frame → which map and hex it is.
 */
export function shadowHexes<T extends RegionLike>(maps: T[], m: T, depth: number): Map<string, { map: T; x: number; y: number }> {
  const out = new Map<string, { map: T; x: number; y: number }>();
  if (!m.world) return out;
  const { x: ox, y: oy } = m.gridOffset, { cols, rows } = m.gridSize;
  for (let y = oy - depth; y < oy + rows + depth; y++)
    for (let x = ox - depth; x < ox + cols + depth; x++) {
      if (x >= ox && x < ox + cols && y >= oy && y < oy + rows) continue;
      const r = resolveHex(maps, m, x, y);
      if (r) out.set(`${x}_${y}`, r);
    }
  return out;
}

/**
 * Growing a map as something nears its edge (plan-hf4-map-grows): how many
 * rows and columns each side is short of a hex's surroundings, and the grid
 * grown by that. Nothing here knows about exploring; the hex flower module
 * decides when to ask.
 *
 * Coordinates are absolute ("x_y" keys), so growing at the top or left is a
 * smaller offset and shifts no hex. Distances are walked over the real
 * neighbours (hexKey.neighbourKeys), so every orientation and stagger is
 * right without cube maths.
 *
 * Pure: no Obsidian imports.
 */
import { hexKey, hexPair, neighbourKeys } from "../hexKey";

/** A map's grid: its top-left hex (offset) and size. */
export interface GridBox {
  x: number;
  y: number;
  cols: number;
  rows: number;
}

/** Rows (top, bottom) and columns (left, right) to add on each side. */
export interface GridRoom {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const NO_ROOM: GridRoom = { top: 0, bottom: 0, left: 0, right: 0 };

/** A map's grid as a box (a missing offset is 0, 0). */
export function gridBoxOf(map: { gridSize: { cols: number; rows: number }; gridOffset?: { x: number; y: number } }): GridBox {
  return { x: map.gridOffset?.x ?? 0, y: map.gridOffset?.y ?? 0, cols: map.gridSize.cols, rows: map.gridSize.rows };
}

export function sameGrid(a: GridBox, b: GridBox): boolean {
  return a.x === b.x && a.y === b.y && a.cols === b.cols && a.rows === b.rows;
}

/** The bounding box of every hex within `distance` steps of `hex` (unclipped). */
export function reachBox(hex: string, distance: number, orientation: "flat" | "pointy", stagger: "odd" | "even"): GridBox {
  const [hx, hy] = hexPair(hex);
  let minX = hx, maxX = hx, minY = hy, maxY = hy;
  const seen = new Set([hexKey(hx, hy)]);
  let ring = [hexKey(hx, hy)];
  for (let d = 0; d < distance; d++) {
    const next: string[] = [];
    for (const k of ring) {
      for (const n of neighbourKeys(k, orientation, stagger)) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
        const [x, y] = hexPair(n);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    ring = next;
  }
  return { x: minX, y: minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
}

/** How many rows / columns each side of `grid` is short of every hex within `distance` of `hex`. */
export function roomNeeded(grid: GridBox, hex: string, distance: number, orientation: "flat" | "pointy", stagger: "odd" | "even"): GridRoom {
  const r = reachBox(hex, Math.max(0, distance), orientation, stagger);
  return {
    top: Math.max(0, grid.y - r.y),
    bottom: Math.max(0, r.y + r.rows - (grid.y + grid.rows)),
    left: Math.max(0, grid.x - r.x),
    right: Math.max(0, r.x + r.cols - (grid.x + grid.cols)),
  };
}

export function hasRoom(room: GridRoom): boolean {
  return room.top + room.bottom + room.left + room.right === 0;
}

/**
 * The growth for a hex near the edge: a side grows only when it is short of
 * `need` (the hexes that must be on the map), and then by enough for `room`
 * (a few rows at a time, so the map isn't redrawn every step).
 */
export function growthFor(
  grid: GridBox, hex: string, need: number, room: number, orientation: "flat" | "pointy", stagger: "odd" | "even",
): GridRoom {
  const short = roomNeeded(grid, hex, need, orientation, stagger);
  if (hasRoom(short)) return NO_ROOM;
  const wide = roomNeeded(grid, hex, Math.max(need, room), orientation, stagger);
  return {
    top: short.top ? wide.top : 0,
    bottom: short.bottom ? wide.bottom : 0,
    left: short.left ? wide.left : 0,
    right: short.right ? wide.right : 0,
  };
}

/** `grid` with `room` added on each side. */
export function grownGrid(grid: GridBox, room: GridRoom): GridBox {
  return {
    x: grid.x - room.left,
    y: grid.y - room.top,
    cols: grid.cols + room.left + room.right,
    rows: grid.rows + room.top + room.bottom,
  };
}

/** The hexes in `bigger` that aren't in `smaller` (the band a shrink would drop). */
export function bandKeys(bigger: GridBox, smaller: GridBox): string[] {
  const out: string[] = [];
  for (let y = bigger.y; y < bigger.y + bigger.rows; y++) {
    for (let x = bigger.x; x < bigger.x + bigger.cols; x++) {
      const inside = x >= smaller.x && y >= smaller.y && x < smaller.x + smaller.cols && y < smaller.y + smaller.rows;
      if (!inside) out.push(hexKey(x, y));
    }
  }
  return out;
}

/** "The map grew 3 rows north and 2 columns west." (empty when nothing grew). */
export function describeGrowth(room: GridRoom): string {
  const parts: string[] = [];
  const say = (n: number, what: "row" | "column", side: string) => { if (n) parts.push(`${n} ${what}${n === 1 ? "" : "s"} ${side}`); };
  say(room.top, "row", "north");
  say(room.bottom, "row", "south");
  say(room.left, "column", "west");
  say(room.right, "column", "east");
  if (!parts.length) return "";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `The map grew ${list}.`;
}

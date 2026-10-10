/**
 * Region tiling: how the regions of an overworld cover one shared child
 * grid, one region per parent hex (plan-overworld-regions §2).
 *
 * - **rect** ("brick"): an n×n block per parent hex. Blocks in shifted
 *   parent columns (flat) / rows (pointy) move by floor(n/2), so each block
 *   touches exactly the six blocks of its parent hex's neighbours.
 * - **hex** ("hex flower"): a hex of radius r (3r²+3r+1 cells) per parent
 *   hex. Centres sit on the lattice A = (2r+1, −r), B = (r, r+1) in child
 *   axial coordinates, which tiles the plane exactly.
 *
 * Pure: no Obsidian imports. Coordinates are offset coordinates ("x_y"),
 * parent ones in the overworld's grid, child ones in the regions' shared
 * grid (a region's gridOffset is the top-left of its bounding box).
 */

import { fromAxial, hexCenter, hexNeighbors, toAxial, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";

export type Footprint = "hex" | "rect";

export interface RegionLayout {
  footprint: Footprint;
  /** hex: radius r (1..5 → 7/19/37/61/91 cells); rect: n (n×n). */
  size: number;
  /** Plugin-wide hex orientation (parent and child grids share it). */
  orientation: Orientation;
  /** The overworld's own stagger. */
  parentStagger: Stagger;
  /** Stagger of the regions' shared child grid. */
  childStagger: Stagger;
}

export const FLOWER_RADII = [1, 2, 3, 4, 5];
export const RECT_SIZES = { min: 2, max: 32 };

export interface Box { x: number; y: number; cols: number; rows: number }

/** Why a layout is unusable, or null when it's fine. */
export function layoutProblem(l: RegionLayout): string | null {
  if (!Number.isInteger(l.size)) return "Size must be a whole number.";
  if (l.footprint === "hex" && !FLOWER_RADII.includes(l.size)) return "Hex regions have a radius of 1 to 5.";
  if (l.footprint === "rect" && (l.size < RECT_SIZES.min || l.size > RECT_SIZES.max)) {
    return `Rectangle regions are ${RECT_SIZES.min} to ${RECT_SIZES.max} hexes across.`;
  }
  return null;
}

/** Cells in one region. */
export function regionCellCount(l: RegionLayout): number {
  const n = l.size;
  return l.footprint === "hex" ? 3 * n * n + 3 * n + 1 : n * n;
}

const shifted = (s: Stagger, n: number) => (s === "odd" ? Math.abs(n) % 2 === 1 : Math.abs(n) % 2 === 0);
const axialDist = (aq: number, ar: number, bq: number, br: number) => {
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
const AXIAL_DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

// ── hex flower ───────────────────────────────────────────────────────────

/** Flower centre in child axial coords for parent axial (Q, R). */
function flowerCentreAxial(Q: number, R: number, r: number): [number, number] {
  return [Q * (2 * r + 1) + R * r, -Q * r + R * (r + 1)];
}

/** Parent axial (Q, R) of the flower holding child axial (q, s). */
function flowerOwnerAxial(q: number, s: number, r: number): [number, number] {
  const det = 3 * r * r + 3 * r + 1;
  // Inverse of [[2r+1, r], [−r, r+1]] (columns A, B).
  const Qf = ((r + 1) * q - r * s) / det;
  const Rf = (r * q + (2 * r + 1) * s) / det;
  const Q0 = Math.round(Qf), R0 = Math.round(Rf);
  for (const [dq, dr] of [[0, 0] as [number, number], ...AXIAL_DIRS]) {
    const [cq, cr] = flowerCentreAxial(Q0 + dq, R0 + dr, r);
    if (axialDist(q, s, cq, cr) <= r) return [Q0 + dq, R0 + dr];
  }
  // Unreachable: the lattice tiles the plane (tests check this).
  throw new Error(`hex flower: no owner for ${q},${s}`);
}

// ── brick ────────────────────────────────────────────────────────────────

function brickOrigin(l: RegionLayout, px: number, py: number): [number, number] {
  const n = l.size, h = Math.floor(n / 2);
  return l.orientation === "flat"
    ? [px * n, py * n + (shifted(l.parentStagger, px) ? h : 0)]
    : [px * n + (shifted(l.parentStagger, py) ? h : 0), py * n];
}

// ── public API ───────────────────────────────────────────────────────────

/** The region's centre cell (child offset coords). For rect, the block's middle cell. */
export function regionCentreCell(l: RegionLayout, px: number, py: number): [number, number] {
  if (l.footprint === "hex") {
    const [Q, R] = toAxial(px, py, l.orientation, l.parentStagger);
    const [cq, cr] = flowerCentreAxial(Q, R, l.size);
    return fromAxial(cq, cr, l.orientation, l.childStagger);
  }
  const [ox, oy] = brickOrigin(l, px, py);
  const h = Math.floor(l.size / 2);
  return [ox + h, oy + h];
}

/** The region's bounding box: its map's gridOffset and gridSize. */
export function regionBox(l: RegionLayout, px: number, py: number): Box {
  if (l.footprint === "hex") {
    const [cx, cy] = regionCentreCell(l, px, py);
    const r = l.size;
    return { x: cx - r, y: cy - r, cols: 2 * r + 1, rows: 2 * r + 1 };
  }
  const [x, y] = brickOrigin(l, px, py);
  return { x, y, cols: l.size, rows: l.size };
}

/** Parent hex whose region holds child cell (x, y). */
export function parentOf(l: RegionLayout, x: number, y: number): [number, number] {
  if (l.footprint === "hex") {
    const [q, s] = toAxial(x, y, l.orientation, l.childStagger);
    const [Q, R] = flowerOwnerAxial(q, s, l.size);
    return fromAxial(Q, R, l.orientation, l.parentStagger);
  }
  const n = l.size, h = Math.floor(n / 2);
  if (l.orientation === "flat") {
    const px = Math.floor(x / n);
    return [px, Math.floor((y - (shifted(l.parentStagger, px) ? h : 0)) / n)];
  }
  const py = Math.floor(y / n);
  return [Math.floor((x - (shifted(l.parentStagger, py) ? h : 0)) / n), py];
}

/** Is child cell (x, y) part of parent (px, py)'s region? */
export function inRegion(l: RegionLayout, px: number, py: number, x: number, y: number): boolean {
  if (l.footprint === "hex") {
    const [Q, R] = toAxial(px, py, l.orientation, l.parentStagger);
    const [cq, cr] = flowerCentreAxial(Q, R, l.size);
    const [q, s] = toAxial(x, y, l.orientation, l.childStagger);
    return axialDist(q, s, cq, cr) <= l.size;
  }
  const b = regionBox(l, px, py);
  return x >= b.x && x < b.x + b.cols && y >= b.y && y < b.y + b.rows;
}

/** The region's cells in reading order (row, then column). */
export function regionCells(l: RegionLayout, px: number, py: number): [number, number][] {
  const b = regionBox(l, px, py);
  const out: [number, number][] = [];
  for (let y = b.y; y < b.y + b.rows; y++) {
    for (let x = b.x; x < b.x + b.cols; x++) if (inRegion(l, px, py, x, y)) out.push([x, y]);
  }
  return out;
}

/**
 * Mask over the bounding box, `mask[row][col]`: true for the region's own
 * cells. All true for rect; the flower's corners are false (they belong to
 * neighbouring regions).
 */
export function regionMask(l: RegionLayout, px: number, py: number): boolean[][] {
  const b = regionBox(l, px, py);
  const mask: boolean[][] = [];
  for (let j = 0; j < b.rows; j++) {
    const row: boolean[] = [];
    for (let i = 0; i < b.cols; i++) row.push(inRegion(l, px, py, b.x + i, b.y + j));
    mask.push(row);
  }
  return mask;
}

/** Child cell → its parent hex and its position inside that region's box. */
export function toLocal(l: RegionLayout, x: number, y: number): { parent: [number, number]; local: [number, number] } {
  const parent = parentOf(l, x, y);
  const b = regionBox(l, parent[0], parent[1]);
  return { parent, local: [x - b.x, y - b.y] };
}

/** A region's local cell → child cell, or null when (lx, ly) is outside its mask. */
export function fromLocal(l: RegionLayout, px: number, py: number, lx: number, ly: number): [number, number] | null {
  const b = regionBox(l, px, py);
  if (lx < 0 || ly < 0 || lx >= b.cols || ly >= b.rows) return null;
  const x = b.x + lx, y = b.y + ly;
  return inRegion(l, px, py, x, y) ? [x, y] : null;
}

/** The six regions next to parent (px, py)'s: its parent hex's neighbours. */
export function neighbourRegions(l: RegionLayout, px: number, py: number): [number, number][] {
  return hexNeighbors(px, py, l.orientation, l.parentStagger);
}

/** Child-grid neighbours of a child cell. */
export function childNeighbours(l: RegionLayout, x: number, y: number): [number, number][] {
  return hexNeighbors(x, y, l.orientation, l.childStagger);
}

/** Centre of a child cell in the plane where neighbouring cells are √3 apart. */
export function childPoint(l: RegionLayout, x: number, y: number): [number, number] {
  return hexCenter(x, y, l.orientation, l.childStagger);
}

/** The region's centre point (mean of its cells' centres), in the child plane. */
export function regionCentrePoint(l: RegionLayout, px: number, py: number): [number, number] {
  if (l.footprint === "hex") {
    const [cx, cy] = regionCentreCell(l, px, py);
    return childPoint(l, cx, cy);
  }
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of regionCells(l, px, py)) {
    const [a, b] = childPoint(l, x, y);
    sx += a; sy += b; n++;
  }
  return [sx / n, sy / n];
}

/**
 * Mean distance between neighbouring region centres (child-plane units),
 * averaged over a shifted and an unshifted parent so it doesn't depend on
 * where you measure.
 */
export function regionSpacing(l: RegionLayout): number {
  let sum = 0, n = 0;
  for (const [px, py] of [[0, 0], [1, 1]] as [number, number][]) {
    const [ax, ay] = regionCentrePoint(l, px, py);
    for (const [qx, qy] of neighbourRegions(l, px, py)) {
      const [bx, by] = regionCentrePoint(l, qx, qy);
      sum += Math.hypot(bx - ax, by - ay);
      n++;
    }
  }
  return sum / n;
}

/**
 * Hex-flower twist: the angle (degrees) between a parent direction and the
 * child grid's same direction. Regions are drawn upright, so the region a
 * parent calls "north" sits this far round from the region's own north.
 * 0 for rect.
 */
export function flowerTwistDegrees(l: RegionLayout): number {
  if (l.footprint !== "hex") return 0;
  const r = l.size;
  // In flat-top axial pixel space: (q, r) → (1.5q, √3(r + q/2)).
  const px = (q: number, s: number) => [1.5 * q, Math.sqrt(3) * (s + q / 2)];
  const [ax, ay] = px(2 * r + 1, -r);
  const [ux, uy] = px(1, 0);
  return ((Math.atan2(ay, ax) - Math.atan2(uy, ux)) * 180) / Math.PI;
}

/**
 * Drawing the overworld the way the overworld preview page does
 * (dev/overworld-preview.ts, which the owner signed off on): the same hex
 * shapes, the same 1.02 overdraw so stitched regions show no hairlines, the
 * same seam lines between regions, and the same minimap (biome colours,
 * labels, white outlines on transition hexes, a blue river line).
 *
 * Used by the map view's region layer (the full view), its minimap panel
 * and the previews in the overworld modals. Pure: works on any 2D context
 * shaped like CanvasRenderingContext2D, so tests can record the calls.
 */

import { hexCenter, hexNeighbors, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import { childNeighbours, childPoint, parentOf, regionCentrePoint, type RegionLayout } from "./layout";
import { hexKey, hexXY } from "../hexKey";

/** The bits of CanvasRenderingContext2D the drawing uses. */
export interface Ctx2D {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
}

/** Hex outline at (cx, cy), corner radius s (the preview's hexPath). */
export function hexPath(ctx: Ctx2D, cx: number, cy: number, s: number, o: Orientation): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + (o === "pointy" ? Math.PI / 6 : 0);
    const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// ── affine maps between planes ───────────────────────────────────────────

/** x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

export const applyAffine = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** a then b: x ↦ b(a(x)). */
export function composeAffine(a: Affine, b: Affine): Affine {
  return [
    b[0] * a[0] + b[2] * a[1], b[1] * a[0] + b[3] * a[1],
    b[0] * a[2] + b[2] * a[3], b[1] * a[2] + b[3] * a[3],
    b[0] * a[4] + b[2] * a[5] + b[4], b[1] * a[4] + b[3] * a[5] + b[5],
  ];
}

/** Linear scale of an affine map (√|det|): how much lengths grow. */
export const affineScale = (m: Affine): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** Least-squares affine map taking each `from` point to its `to` point (≥ 3 points, not all on a line). */
export function fitAffine(pairs: [[number, number], [number, number]][]): Affine {
  // Normal equations for [x y 1]·[a c e]ᵀ = X and the same for Y.
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0;
  let sXx = 0, sXy = 0, sX = 0, sYx = 0, sYy = 0, sY = 0;
  for (const [[x, y], [X, Y]] of pairs) {
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; n++;
    sXx += X * x; sXy += X * y; sX += X; sYx += Y * x; sYy += Y * y; sY += Y;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const solve = (r: number[]) => {
    const A = M.map((row, i) => [...row, r[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]];
      for (let k = 0; k < 3; k++) {
        if (k === i) continue;
        const f = A[k][i] / A[i][i];
        for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
      }
    }
    return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  };
  const [a, c, e] = solve([sXx, sXy, sX]);
  const [b, d, f] = solve([sYx, sYy, sY]);
  return [a, b, c, d, e, f];
}

/**
 * Child plane → parent plane (both hexCenter units): fitted on the region
 * centres of a patch of parent hexes. Exact for hex flowers and even-sized
 * bricks; odd bricks are off by under half a child hex.
 */
export function childToParentPlane(layout: RegionLayout): Affine {
  const pairs: [[number, number], [number, number]][] = [];
  for (let px = 0; px < 4; px++) for (let py = 0; py < 4; py++) {
    pairs.push([regionCentrePoint(layout, px, py), hexCenter(px, py, layout.orientation, layout.parentStagger)]);
  }
  return fitAffine(pairs);
}

/**
 * A grid-px point (measured now) → the child plane, through `c2g` measured
 * when the grid's font size was `emThen`. The grid is sized in em, so a
 * zoom bake (which changes the font size, not a transform) grows every grid
 * px by emNow / emThen: undo that before inverting, or the point lands
 * that many times too far from the grid's corner (owner bug 2026-10-12: a
 * click on a top-right brick made the region of hex 7, 0, and hovering
 * drawn regions said "No region yet").
 */
export function gridPointToChild(c2g: Affine, emThen: number, emNow: number, gx: number, gy: number): [number, number] {
  const k = emThen > 0 && emNow > 0 ? emThen / emNow : 1;
  return applyAffine(invertAffine(c2g), gx * k, gy * k);
}

/** The child cell under a grid-px point and its region's parent hex ("x_y"): the layer's hit test (see gridPointToChild). */
export function cellAtGridPoint(layout: RegionLayout, c2g: Affine, emThen: number, emNow: number, gx: number, gy: number): { x: number; y: number; parentHex: string } {
  const [cx, cy] = gridPointToChild(c2g, emThen, emNow, gx, gy);
  const [x, y] = nearestChildCell(layout, cx, cy);
  return { x: x || 0, y: y || 0, parentHex: parentOf(layout, x, y).join("_") };
}

/** The child cell whose centre is nearest a child-plane point. */
export function nearestChildCell(layout: RegionLayout, x: number, y: number): [number, number] {
  const r3 = Math.sqrt(3);
  const shifted = (n: number) => (layout.childStagger === "odd" ? Math.abs(n) % 2 === 1 : Math.abs(n) % 2 === 0);
  let gx: number, gy: number;
  if (layout.orientation === "flat") {
    gx = Math.round(x / 1.5);
    gy = Math.round((y - (shifted(gx) ? r3 / 2 : 0)) / r3);
  } else {
    gy = Math.round(y / 1.5);
    gx = Math.round((x - (shifted(gy) ? r3 / 2 : 0)) / r3);
  }
  let best: [number, number] = [gx, gy];
  let bd = Infinity;
  for (const [cx, cy] of [[gx, gy] as [number, number], ...hexNeighbors(gx, gy, layout.orientation, layout.childStagger)]) {
    const [px, py] = childPoint(layout, cx, cy);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}

// ── per-region bitmap cache ──────────────────────────────────────────────

/**
 * Cache of one built thing (a region's bitmap) per name. An entry is
 * rebuilt when its key changes (scale, palette) or after invalidate(name)
 * (the region's map changed). Counts builds, for tests and timings.
 */
export class RegionBitmapCache<T> {
  private entries = new Map<string, { key: string; value: T }>();
  private dirty = new Set<string>();
  builds = 0;

  get(name: string, key: string, build: () => T): T {
    const hit = this.entries.get(name);
    if (hit && hit.key === key && !this.dirty.has(name)) return hit.value;
    const value = build();
    this.builds++;
    this.entries.set(name, { key, value });
    this.dirty.delete(name);
    return value;
  }

  invalidate(name: string): void {
    if (this.entries.has(name)) this.dirty.add(name);
  }

  /** Drop entries for names not in `keep` (deleted regions). */
  retain(keep: Set<string>): void {
    for (const n of [...this.entries.keys()]) if (!keep.has(n)) { this.entries.delete(n); this.dirty.delete(n); }
  }

  clear(): void {
    this.entries.clear();
    this.dirty.clear();
  }

  has(name: string): boolean {
    return this.entries.has(name) && !this.dirty.has(name);
  }

  get size(): number {
    return this.entries.size;
  }
}

// ── the full view: every region's hexes ──────────────────────────────────

export interface RegionCell {
  x: number;
  y: number;
  color: string;
}

/** Region seams in the full view: a dark line, the width the preview uses. */
export const SEAM_COLOUR = "rgba(20, 20, 20, 0.55)";

/**
 * Draw a region's cells (shared-grid coords) with `toCanvas` mapping the
 * child plane onto the canvas: each cell a hex at 1.02× its size (no
 * hairlines between cells), then the region's outline where its cells meet
 * another region's (the preview's seam lines). Returns the canvas-space
 * bounding box of what was drawn.
 */
export function drawRegionCells(
  ctx: Ctx2D,
  layout: RegionLayout,
  cells: RegionCell[],
  toCanvas: Affine,
  opts: { seams?: boolean; seamColour?: string; seamWidth?: number } = {},
): void {
  const s = affineScale(toCanvas);
  const own = new Set(cells.map((c) => hexKey(c.x, c.y)));
  for (const c of cells) {
    const [px, py] = childPoint(layout, c.x, c.y);
    const [X, Y] = applyAffine(toCanvas, px, py);
    hexPath(ctx, X, Y, s * 1.02, layout.orientation);
    ctx.fillStyle = c.color;
    ctx.fill();
  }
  if (opts.seams === false) return;
  ctx.strokeStyle = opts.seamColour ?? SEAM_COLOUR;
  ctx.lineWidth = Math.max(1, s * (opts.seamWidth ?? 0.18));
  for (const c of cells) {
    const [ax, ay] = childPoint(layout, c.x, c.y);
    for (const [nx, ny] of childNeighbours(layout, c.x, c.y)) {
      if (own.has(hexKey(nx, ny))) continue;
      const [bx, by] = childPoint(layout, nx, ny);
      // The shared edge: through the midpoint, perpendicular, one hex side long.
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      const ux = -dy / len / 2, uy = dx / len / 2;
      const [x1, y1] = applyAffine(toCanvas, mx - ux, my - uy);
      const [x2, y2] = applyAffine(toCanvas, mx + ux, my + uy);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}

/** Canvas-space box around a set of cells drawn with `toCanvas` (with a hex of margin). */
export function cellsBox(layout: RegionLayout, cells: { x: number; y: number }[], toCanvas: Affine): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    const [px, py] = childPoint(layout, c.x, c.y);
    const [X, Y] = applyAffine(toCanvas, px, py);
    minX = Math.min(minX, X); maxX = Math.max(maxX, X);
    minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
  }
  const m = affineScale(toCanvas) * 1.2;
  return { x: minX - m, y: minY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m };
}

// ── the minimap: the overworld's own hexes ───────────────────────────────

export interface MiniHex {
  x: number;
  y: number;
  color: string;
  /** Biome label (the preview shows its first 10 letters). */
  label?: string;
  /** A transition hex: white outline. */
  ecotone?: boolean;
}

export interface MiniLayout {
  orientation: Orientation;
  stagger: Stagger;
  /** Hex corner radius in canvas px. */
  size: number;
  /** Canvas px of the top-left hex centre. */
  margin: number;
  minX: number;
  minY: number;
}

/** Fit an overworld's hexes into a w×h canvas (the preview's 20 px hexes, scaled down when needed). */
export function miniLayout(hexes: { x: number; y: number }[], orientation: Orientation, stagger: Stagger, w: number, h: number, maxSize = 20): MiniLayout {
  const pts = hexes.map((c) => hexCenter(c.x, c.y, orientation, stagger));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const size = Math.max(2, Math.min(maxSize, (w - 8) / (maxX - minX + 2.2), (h - 8) / (maxY - minY + 2.2)));
  return { orientation, stagger, size, margin: size * 1.1 + 4, minX, minY };
}

export const miniPoint = (l: MiniLayout, x: number, y: number): [number, number] => {
  const [px, py] = hexCenter(x, y, l.orientation, l.stagger);
  return [(px - l.minX) * l.size + l.margin, (py - l.minY) * l.size + l.margin];
};

/** The hex under a canvas point, or null. */
export function miniHexAt(l: MiniLayout, hexes: { x: number; y: number }[], X: number, Y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const h of hexes) {
    const [cx, cy] = miniPoint(l, h.x, h.y);
    const d = (cx - X) ** 2 + (cy - Y) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best && bd <= (l.size * 1.05) ** 2 ? best : null;
}

/**
 * The preview's overworld: biome-coloured hexes with dark outlines (white
 * and thicker on transition hexes), biome labels, the river as a blue
 * line, and an optional highlighted hex (the region you're in).
 */
export function drawMiniOverworld(ctx: Ctx2D, l: MiniLayout, hexes: MiniHex[], river: string[], highlight?: string): void {
  for (const h of hexes) {
    const [cx, cy] = miniPoint(l, h.x, h.y);
    hexPath(ctx, cx, cy, l.size, l.orientation);
    ctx.fillStyle = h.color;
    ctx.fill();
    ctx.strokeStyle = h.ecotone ? "#fff" : "#111";
    ctx.lineWidth = h.ecotone ? 2.5 : 1;
    ctx.stroke();
    if (h.label && l.size >= 14) {
      ctx.fillStyle = "#000";
      ctx.font = `${Math.round(9 * Math.min(1.4, l.size / 20))}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(h.label.slice(0, 10), cx, cy + 3);
    }
  }
  drawRiver(ctx, river, (x, y) => miniPoint(l, x, y), 3);
  if (highlight) {
    const { x, y } = hexXY(highlight);
    const [cx, cy] = miniPoint(l, x, y);
    hexPath(ctx, cx, cy, l.size * 0.92, l.orientation);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

/** The river through hex centres (the preview's blue line). */
export function drawRiver(ctx: Ctx2D, river: string[], at: (x: number, y: number) => [number, number], width: number): void {
  if (river.length < 2) return;
  ctx.beginPath();
  river.forEach((k, i) => {
    const { x, y } = hexXY(k);
    const [X, Y] = at(x, y);
    if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  });
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = width;
  ctx.stroke();
}

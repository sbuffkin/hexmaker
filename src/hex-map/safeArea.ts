/**
 * The map's "safe area": the part of the view not covered by its overlays
 * (the toolbar rows with the tool mode bar, and an open side panel). Round 4:
 * the drawing tools panel hid the very hex a tester came back to, and the
 * mode bar (then at the bottom) covered the bottom row. Fitting, centring and
 * flashing a hex now keep hexes inside the safe area, and opening a panel or
 * the mode bar nudges a covered map edge out from under it. Pure (numbers in,
 * numbers out) so it's unit-testable; HexMapView measures the rectangles.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Gap kept between an overlay and the hexes, px. */
export const OVERLAY_GAP = 6;

/**
 * Insets from the clip box's edges: `topBand` boxes (toolbar rows, mode bar)
 * push the top edge down to below the lowest of them; `rightBand` boxes (an
 * open side panel) push the right edge left of the leftmost. Boxes are in
 * the same (screen) coordinates as `clip`; empty boxes are ignored.
 */
export function overlayInsets(clip: Box, topBand: readonly Box[], rightBand: readonly Box[], gap = OVERLAY_GAP): Insets {
  const real = (b: Box) => b.right > b.left && b.bottom > b.top;
  let top = 0;
  for (const b of topBand) if (real(b)) top = Math.max(top, b.bottom - clip.top + gap);
  let right = 0;
  for (const b of rightBand) if (real(b)) right = Math.max(right, clip.right - b.left + gap);
  return { top: Math.max(0, top), right: Math.max(0, right), bottom: 0, left: 0 };
}

/** The usable insets for a view of this size: an inset that would leave
 *  less than 40% of the view is dropped (a narrow view with a panel open
 *  is better fitted under the panel than squeezed into a sliver). */
export function usableInsets(viewW: number, viewH: number, insets: Insets): Insets {
  const out = { ...insets };
  if (viewW - out.left - out.right < viewW * 0.4) {
    out.left = 0;
    out.right = 0;
  }
  if (viewH - out.top - out.bottom < viewH * 0.4) {
    out.top = 0;
    out.bottom = 0;
  }
  return out;
}

/** Zoom and pan that fit a `gridW`×`gridH` grid (unzoomed px) into the safe
 *  area of a `viewW`×`viewH` view, filling `fill` of it, centred. */
export function fitToSafeArea(
  viewW: number,
  viewH: number,
  gridW: number,
  gridH: number,
  insets: Insets,
  fill = 0.92,
  minZoom = 0.2,
  maxZoom = 5,
): { zoom: number; panX: number; panY: number } {
  const ins = usableInsets(viewW, viewH, insets);
  const w = viewW - ins.left - ins.right;
  const h = viewH - ins.top - ins.bottom;
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(w / gridW, h / gridH) * fill));
  return {
    zoom,
    panX: ins.left + (w - gridW * zoom) / 2,
    panY: ins.top + (h - gridH * zoom) / 2,
  };
}

/** Pan delta (one axis) that brings a span [start, end] fully inside
 *  [safeStart, safeEnd]; when it can't fit, its start is aligned. */
export function revealDelta(start: number, end: number, safeStart: number, safeEnd: number): number {
  if (end - start > safeEnd - safeStart) return safeStart - start;
  if (start < safeStart) return safeStart - start;
  if (end > safeEnd) return safeEnd - end;
  return 0;
}

/**
 * Pan delta (one axis) that moves the grid's edge out from under an overlay
 * when that edge is on screen but covered. An edge that's off screen means
 * the user panned there on purpose: leave it alone. (A grid that fits the
 * safe span ends up fully inside it, since only one edge can be covered.)
 */
export function uncoverEdgeDelta(
  start: number,
  end: number,
  safeStart: number,
  safeEnd: number,
  viewStart: number,
  viewEnd: number,
): number {
  if (end <= viewStart || start >= viewEnd) return 0; // not on screen at all
  if (start >= viewStart && start < safeStart) return safeStart - start;
  if (end <= viewEnd && end > safeEnd) return safeEnd - end;
  return 0;
}

/** The smallest box around all non-empty boxes, or null if there are none.
 *  The map's content box: its edge hexes (a flat-top grid's last column
 *  pokes out of the grid element by a quarter hex) plus the neighbour strip. */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  let out: Box | null = null;
  for (const b of boxes) {
    if (!(b.right > b.left && b.bottom > b.top)) continue;
    out = out
      ? {
          left: Math.min(out.left, b.left),
          top: Math.min(out.top, b.top),
          right: Math.max(out.right, b.right),
          bottom: Math.max(out.bottom, b.bottom),
        }
      : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }
  return out;
}

/**
 * Whether the map may move on its own (uncover an edge, reveal a hex). Never
 * while a drawing tool is on: the user is aiming at hexes, and a slide
 * between two clicks sends the next click to the wrong hex (round 5: the mode
 * bar appearing as Road started slid the map 53px, so a road zig-zagged).
 * Only the user's own pan/zoom moves the map then.
 */
export function mayAutoPan(drawingTool: string | null): boolean {
  return drawingTool === null;
}

/**
 * Placement of hex names and tokens in the PNG export (X1), kept pure for
 * tests. Matches the on-screen map: a hex name sits on the side of the hex
 * away from the coordinates, tokens use the map's group offsets.
 */

import type { CoordPlacement } from "../coordStyle";
import type { TokenSize } from "../types";

/**
 * Y of a hex name's baseline centre. Coordinates default to the bottom, so
 * the name goes to the top; with coordinates at the top (or the manual's hex
 * numbers, always at the top) it goes to the bottom.
 */
export function pngHexNameY(
  coordPlacement: CoordPlacement | undefined,
  coordsAtTop: boolean,
  cy: number,
  hexRadius: number,
): number {
  const placement = coordsAtTop ? "top" : coordPlacement ?? "bottom";
  return placement === "top" || placement === "middle"
    ? cy + hexRadius * 0.55
    : cy - hexRadius * 0.55;
}

/** Hex name font size in the PNG, in pixels (readable at every output size). */
export function pngHexNamePx(hexRadius: number): number {
  return Math.max(11, Math.round(hexRadius * 0.27));
}

/** A token's radius in the PNG: the on-screen size relative to the hex. */
export function pngTokenRadius(size: TokenSize, hexRadius: number): number {
  // On screen: tokens are 1.35 / 2 / 2.85em across, hexes 2.2em in radius.
  const across = size === "sm" ? 1.35 : size === "lg" ? 2.85 : 2;
  return (across / 2 / 2.2) * hexRadius;
}

/** Distance between tokens sharing a hex (the on-screen 0.28 × short side). */
export function pngTokenSpread(hexRadius: number): number {
  // The short side is √3·R for both orientations.
  return 0.28 * Math.sqrt(3) * hexRadius;
}

/**
 * X for a centred label `width` wide so it stays inside a canvas
 * `canvasWidth` wide with `margin` to spare (round 6 S5: token names were cut
 * at the image edge, "CSV Meridian Reso"). A label wider than the canvas
 * stays centred on the canvas.
 */
export function clampLabelX(x: number, width: number, canvasWidth: number, margin: number): number {
  const lo = margin + width / 2;
  const hi = canvasWidth - margin - width / 2;
  if (lo > hi) return canvasWidth / 2;
  return Math.min(hi, Math.max(lo, x));
}

/** Top Y for a label `height` tall so it ends inside the canvas (see clampLabelX). */
export function clampLabelTop(y: number, height: number, canvasHeight: number, margin: number): number {
  return Math.max(margin, Math.min(y, canvasHeight - margin - height));
}

/**
 * Split a hex name onto at most two lines no wider than `maxWidth` (as
 * measured by `measure`), breaking at the space that best balances the
 * lines; a name with no space, or that fits, stays on one line. Mirrors the
 * on-screen labels (round 6 U5).
 */
export function wrapHexName(name: string, maxWidth: number, measure: (s: string) => number): string[] {
  const text = name.trim();
  if (measure(text) <= maxWidth) return [text];
  const words = text.split(/\s+/);
  if (words.length < 2) return [text];
  let best: string[] = [text];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(measure(a), measure(b));
    if (w < bestWidth) { bestWidth = w; best = [a, b]; }
  }
  return best;
}


/**
 * Link badges in the PNG: circles (centre + radius) for `count` badges at a
 * hex's right side, laid out like the on-screen badges: one column centred
 * on the hex's middle row (clear of the name above and the coordinates
 * below), two columns for four or five kinds. Units follow the map: the
 * on-screen hex radius is 2.2em, a badge 0.8em across.
 */
export function pngBadgeCircles(
  cx: number,
  cy: number,
  hexRadius: number,
  isFlat: boolean,
  count: number,
): { x: number; y: number; r: number }[] {
  const em = hexRadius / 2.2;
  const r = 0.4 * em;
  const gap = 0.06 * em;
  const right = cx + (isFlat ? 1.95 : 1.75) * em;
  const cols = count > 3 ? 2 : 1;
  const rows = Math.ceil(count / cols);
  const top = cy - (rows * 2 * r + (rows - 1) * gap) / 2;
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = right - (cols - col) * 2 * r - (cols - 1 - col) * gap + r;
    out.push({ x, y: top + r + row * (2 * r + gap), r });
  }
  return out;
}

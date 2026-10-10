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

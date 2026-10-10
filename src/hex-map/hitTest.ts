/**
 * Clicks that miss a hex by a hair. Each hex is a clip-path hexagon inside
 * a rectangular column (or row) box, with a small gap between hexes, so a
 * click in the gap or on a clipped corner lands on the column, not a hex,
 * and used to do nothing (fresh-eyes round 5: "two dead clicks before the
 * first hex editor opened"). Such a click goes to the nearest hex instead,
 * as long as it's within that hex's reach. Pure: boxes in, hex out.
 */

export interface HexBox {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The hex whose centre is nearest the point, if the point is within
 * `reach` × that hex's circumradius (half its larger side) of the centre
 * (1.35 takes in the corners of its box, which the hexagon clips off);
 * otherwise null (a click well off the grid stays a miss).
 */
export function nearestHex(px: number, py: number, hexes: readonly HexBox[], reach = 1.35): { x: number; y: number } | null {
  let best: HexBox | null = null;
  let bestD = Infinity;
  for (const h of hexes) {
    const w = h.right - h.left;
    const ht = h.bottom - h.top;
    if (!(w > 0 && ht > 0)) continue;
    const d = Math.hypot(px - (h.left + w / 2), py - (h.top + ht / 2));
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (!best) return null;
  const r = Math.max(best.right - best.left, best.bottom - best.top) / 2;
  return bestD <= r * reach ? { x: best.x, y: best.y } : null;
}

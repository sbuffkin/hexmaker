/**
 * "Neighbour influence" (owner 2026-10-13: "Neighbor influence as a weight
 * would be good too"): how strongly the maps already made around a new one
 * steer it, for that map only. 1 is as tuned; 0 leaves only the seam; 2
 * doubles it. Stored in the map's note as `neighbour-influence:` only when
 * it isn't 1.
 *
 * - Overworld regions (Edit region): a weight on the biome's neighbour
 *   influence tuning (biomeTuning.ts "neighbour-influence").
 * - Plain maps (New map → Next to, SF6): how far the neighbour's edge pulls
 *   Overland's terrain in (edgeReach / edgeAlpha), and how much of the
 *   neighbours' character a learned generator blends in (neighbourShare).
 *
 * Pure, no imports.
 */

/** The slider's range and the default. */
export const NEIGHBOUR_WEIGHT = { min: 0, max: 2, step: 0.1, default: 1 } as const;

/** A weight in range, rounded to hundredths (1 for anything unreadable). */
export function clampNeighbourWeight(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return NEIGHBOUR_WEIGHT.default;
  const c = Math.min(NEIGHBOUR_WEIGHT.max, Math.max(NEIGHBOUR_WEIGHT.min, v));
  return Math.round(c * 100) / 100;
}

/** Store a map's weight readably: only when it isn't 1. */
export function storeNeighbourWeight(region: { neighbourInfluence?: number }, v: number | undefined): void {
  const w = clampNeighbourWeight(v);
  if (w === NEIGHBOUR_WEIGHT.default) delete region.neighbourInfluence;
  else region.neighbourInfluence = w;
}

// ── plain maps next to a neighbour (SF6) ─────────────────────────────────

/** How far (hexes) a neighbour's edge pulls Overland's terrain at weight 1. */
export const EDGE_REACH = 3;
/** The pull at 1, 2 and 3 hexes in, at weight 1 (index = distance). */
export const EDGE_ALPHA: readonly number[] = [0, 0.85, 0.55, 0.25];

/**
 * How far in the neighbour's edge reaches at this weight: 3 hexes at ×1,
 * 6 at ×2, and only the seam row (1) at ×0.
 */
export function edgeReach(weight: number | undefined): number {
  const w = clampNeighbourWeight(weight);
  return Math.max(1, Math.round(EDGE_REACH * w));
}

/**
 * The pull on a hex `d` steps in from the neighbour's edge (0..1). ×1 is
 * EDGE_ALPHA exactly; other weights stretch it (×2: as strong twice as far
 * in) or shrink it (×0: the seam row only, at its ×1 strength).
 */
export function edgeAlpha(d: number, weight: number | undefined): number {
  if (d < 1) return 0;
  const w = clampNeighbourWeight(weight);
  if (d === 1) return EDGE_ALPHA[1];
  if (w <= 0) return 0;
  // Distance as it would be at ×1, read off the table between its points.
  const at = 1 + (d - 1) / w;
  if (at >= EDGE_ALPHA.length) return 0;
  const lo = Math.floor(at), hi = Math.min(EDGE_ALPHA.length - 1, lo + 1);
  const f = at - lo;
  const next = hi === lo ? 0 : EDGE_ALPHA[hi];
  return EDGE_ALPHA[lo] + (next - EDGE_ALPHA[lo]) * f;
}

/** How much of a new map its neighbours make up at ×2 (percent), for learned generators. */
export const NEIGHBOUR_SHARE_MAX = 40;

/**
 * The neighbours' share (percent) a learned generator blends in at this
 * weight: 0 at ×0 (only the seam is matched), 20% at ×1, 40% at ×2.
 */
export function neighbourShare(weight: number | undefined): number {
  return Math.round((NEIGHBOUR_SHARE_MAX / NEIGHBOUR_WEIGHT.max) * clampNeighbourWeight(weight));
}

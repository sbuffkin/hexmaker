/**
 * A region's "Neighbour influence" (owner 2026-10-13: "Neighbor influence
 * as a weight would be good too"): a weight on its biome's neighbour
 * influence tuning (biomeTuning.ts "neighbour-influence"), for that region
 * only. 1 is the biome as tuned; 0 leaves only the seam cells; 2 doubles
 * it. Stored in the region's map note as `neighbour-influence:` only when
 * it isn't 1. Pure, no imports (Edit region reads it at load time).
 */

/** The slider's range and the default. */
export const NEIGHBOUR_WEIGHT = { min: 0, max: 2, step: 0.1, default: 1 } as const;

/** A weight in range, rounded to hundredths (1 for anything unreadable). */
export function clampNeighbourWeight(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return NEIGHBOUR_WEIGHT.default;
  const c = Math.min(NEIGHBOUR_WEIGHT.max, Math.max(NEIGHBOUR_WEIGHT.min, v));
  return Math.round(c * 100) / 100;
}

/** Store a region's weight readably: only when it isn't 1. */
export function storeNeighbourWeight(region: { neighbourInfluence?: number }, v: number | undefined): void {
  const w = clampNeighbourWeight(v);
  if (w === NEIGHBOUR_WEIGHT.default) delete region.neighbourInfluence;
  else region.neighbourInfluence = w;
}

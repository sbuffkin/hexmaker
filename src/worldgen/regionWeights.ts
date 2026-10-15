/**
 * Region influence for generators learned from several regions: whole
 * percentages that always add up to 100. The logic is the shared zero-sum
 * sliders' (src/ui/shares.ts); these are its whole-number forms.
 */

import { rebalanceShares, toPercents } from "../ui/shares";

export { toPercents };

/**
 * Set one region's influence to `value` (0–100). The others share what's left
 * in their current proportions (equally if they were all 0), so the total
 * stays 100.
 */
export function rebalance(weights: number[], index: number, value: number): number[] {
  if (weights.length <= 1) return weights.length ? [100] : [];
  return toPercents(rebalanceShares(weights, index, Math.round(value), "split"));
}

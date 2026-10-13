/**
 * The % column beside free weights (owner Q1, 2026-10-13: random tables and
 * world types keep free weights, with a % column that updates live whenever
 * a weight changes, a row is added or removed, or the note is edited by
 * hand). Odds are not zero-sum sliders: the weights stay as typed, and
 * this only says what share each row gets.
 *
 * Pure: no Obsidian imports.
 */

import { toPercents } from "./shares";

/** A typed weight cell: blank means `blank` (1 by default); anything unreadable or negative counts 0. */
export function readOddsWeight(text: string, blank = 1): number {
  const t = text.trim();
  if (!t) return blank;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Each row's share of the total weight, as whole percentages that add up
 * to 100 ("34%"); a row with weight but under half a percent reads "<1%";
 * weight 0 reads "0%". No weight at all: "–" for every row.
 */
export function oddsText(weights: readonly number[]): string[] {
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  if (!clean.some((w) => w > 0)) return clean.map(() => "–");
  const whole = toPercents(clean);
  return whole.map((p, i) => (clean[i] > 0 && p === 0 ? "<1%" : `${p}%`));
}

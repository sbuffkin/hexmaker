/**
 * Region influence for generators learned from several regions: whole
 * percentages that always add up to 100.
 */

/** Whole percentages in proportion to `values`, adding up to exactly 100 (largest remainder). */
export function toPercents(values: number[], total = 100): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((n, v) => n + v, 0);
  if (!clean.length) return [];
  const raw = sum > 0 ? clean.map((v) => (v / sum) * total) : clean.map(() => total / clean.length);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

/**
 * Set one region's influence to `value` (0–100). The others share what's left
 * in their current proportions (equally if they were all 0), so the total
 * stays 100.
 */
export function rebalance(weights: number[], index: number, value: number): number[] {
  const n = weights.length;
  if (n <= 1) return n ? [100] : [];
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = weights.map((w, i) => (i === index ? 0 : Math.max(0, w)));
  const othersSum = others.reduce((s, w) => s + w, 0);
  const share = toPercents(othersSum > 0 ? others : weights.map((_, i) => (i === index ? 0 : 1)), 100 - v);
  return share.map((w, i) => (i === index ? v : w));
}

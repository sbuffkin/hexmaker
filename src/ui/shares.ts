/**
 * Zero-sum shares: the logic behind ShareSliders, the shared slider control
 * (src/ui/shareSliders.ts). Every "how much of each" input that sums to a
 * whole uses it (owner 2026-10-12: "when mixing the weights should be zero
 * sum sliders like in the generator tab, make sure that we keep consistent
 * UX for things like this in the future"): the generator page's map
 * influence / blend, Edit region's Mix biomes, and Blend into <biome>'s
 * this-map share.
 *
 * Shares are percentages (floats) that add up to 100. Moving one sets it
 * and the others share what's left in the proportions they had when the
 * drag started, so dragging one to 100 and back gives the others their old
 * split again. Readouts are whole percentages that add up to exactly 100.
 *
 * Pure: no Obsidian imports.
 */

/**
 * What happens when every other share is 0 and one is moved:
 * - "split": the rest is shared equally among the others (each item must
 *   count for something: a generator's sources, a region's biomes);
 * - "hold": 0 means "not in it" (e.g. a type mix), so the moved one
 *   takes everything (100%) until another is raised.
 */
export type EmptyOthers = "split" | "hold";

const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Whole percentages in proportion to `values`, adding up to exactly `total` (largest remainder). All 0: an equal split. */
export function toPercents(values: readonly number[], total = 100): number[] {
  const c = values.map(clean);
  const sum = c.reduce((n, v) => n + v, 0);
  if (!c.length) return [];
  const raw = sum > 0 ? c.map((v) => (v / sum) * total) : c.map(() => total / c.length);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

/**
 * Weights (any scale) as shares adding up to 100. All 0: an equal split
 * ("split"), or all 0 ("hold": nothing in it yet).
 */
export function toShares(weights: readonly number[], empty: EmptyOthers = "split"): number[] {
  const c = weights.map(clean);
  const sum = c.reduce((n, v) => n + v, 0);
  if (!c.length) return [];
  if (sum > 0) return c.map((v) => (v / sum) * 100);
  return empty === "split" ? c.map(() => 100 / c.length) : c.map(() => 0);
}

/**
 * Set share `index` to `value` (clamped 0–100); the others share what's
 * left in their proportions in `start`. With every other share at 0:
 * "split" shares it equally, "hold" keeps the moved one at 100 (there's
 * nothing to give the rest to). One item is always 100.
 */
export function rebalanceShares(start: readonly number[], index: number, value: number, empty: EmptyOthers = "split"): number[] {
  const n = start.length;
  if (n <= 1) return n ? [100] : [];
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const others = start.map((w, i) => (i === index ? 0 : clean(w)));
  const othersSum = others.reduce((s, w) => s + w, 0);
  if (othersSum <= 0) {
    if (empty === "hold") return start.map((_, i) => (i === index ? 100 : 0));
    return start.map((_, i) => (i === index ? v : (100 - v) / (n - 1)));
  }
  return others.map((w, i) => (i === index ? v : (w / othersSum) * (100 - v)));
}

/** What a readout says: "34%", or "<1%" for a share that's there but rounds to 0. */
export function shareText(share: number, whole: number): string {
  return share > 0 && whole === 0 ? "<1%" : `${whole}%`;
}

/**
 * The state of one set of zero-sum sliders. `set` during a gesture
 * rebalances from the shares at the gesture's start; `settle` ends it.
 */
export class ShareState {
  private shares: number[];
  private start: number[] | null = null;

  constructor(weights: readonly number[], readonly empty: EmptyOthers = "split") {
    this.shares = toShares(weights, empty);
  }

  /** Shares (floats, adding up to 100; all 0 for an empty "hold" set). */
  values(): number[] {
    return [...this.shares];
  }

  /** Whole percentages for the sliders and readouts (adding up to 100, or all 0). */
  percents(): number[] {
    return this.shares.some((s) => s > 0) ? toPercents(this.shares) : this.shares.map(() => 0);
  }

  /** Move one slider (part of a gesture: the others keep their split from its start). */
  set(index: number, value: number): void {
    if (!this.start) this.start = [...this.shares];
    this.shares = rebalanceShares(this.start, index, value, this.empty);
  }

  /** The gesture ended (slider let go, wheel settled, key released). */
  settle(): void {
    this.start = null;
  }

  /** Replace every share (weights, any scale). */
  reset(weights: readonly number[]): void {
    this.shares = toShares(weights, this.empty);
    this.start = null;
  }
}

/** Greatest common divisor of whole numbers. */
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Small whole-number weights that read back as exactly these whole
 * percentages (toPercents(result) equals `percents`): 67/33 → 2/1, 50/50 →
 * 1/1, 70/30 → 7/3, 60/25/15 → 12/5/3. For storing a mix readably ("Alpine 2 +
 * Taiga 1"). A 0% item gets weight 0. Totals up to `maxTotal` are tried;
 * past that, the percentages over their common divisor.
 */
export function percentsToWeights(percents: readonly number[], maxTotal = 12): number[] {
  const p = percents.map((v) => Math.max(0, Math.round(v)));
  const sum = p.reduce((s, v) => s + v, 0);
  if (!p.length || sum === 0) return p.map(() => 0);
  const target = toPercents(p);
  const nonZero = p.filter((v) => v > 0).length;
  for (let total = nonZero; total <= maxTotal; total++) {
    const w = toPercents(p, total);
    if (w.some((v, i) => (v > 0) !== (p[i] > 0))) continue;
    const back = toPercents(w);
    if (back.every((v, i) => v === target[i])) return w;
  }
  const g = p.reduce((a, v) => gcd(a, v), 0) || 1;
  return p.map((v) => v / g);
}


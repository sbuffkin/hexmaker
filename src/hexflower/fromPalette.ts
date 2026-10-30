/**
 * "Fill from palette" (plan-hex-flower): a flower made from the user's own
 * palette, never from shipped content. Seeded, so the same palette and seed
 * give the same flower. A few of the palette's terrains are picked (or the
 * ones given, with their shares) and laid out as patches: each terrain
 * grows from one cell into its neighbours, so walking the flower drifts
 * through one terrain before the next. Nothing is chosen by name: every
 * terrain is just a name on the palette. "(blocked)" cells are kept.
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { CELL_COUNT, CENTRE, DIRS, isBlocked, neighbour, type FlowerCell } from "./flower";

/** How many of a palette's terrains a new flower uses at most. */
export const MAX_FLOWER_TERRAINS = 6;

/** One terrain and its share of the cells (any scale). */
export interface CellShare {
  terrain: string;
  weight: number;
}

/**
 * Whole cell counts for `weights` adding up to `total` (largest remainder).
 * Every positive weight gets at least one cell while there are enough.
 */
export function cellCounts(weights: readonly number[], total: number): number[] {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return w.map(() => 0);
  const raw = w.map((x) => (x / sum) * total);
  const out = raw.map(Math.floor);
  // At least one cell each (while there are cells to give).
  for (let i = 0; i < out.length; i++) if (w[i] > 0 && out[i] === 0 && out.reduce((a, b) => a + b, 0) < total) out[i] = 1;
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length) {
    if (w[order[k].i] > 0) { out[order[k].i]++; left--; }
  }
  // Too many (more terrains than cells): take from the largest.
  while (left < 0) {
    const big = out.indexOf(Math.max(...out));
    out[big]--;
    left++;
  }
  return out;
}

/** Up to `max` of the palette's terrains, picked by `seed` (in palette order). */
export function pickTerrains(palette: readonly string[], seed: number, max = MAX_FLOWER_TERRAINS): string[] {
  const names = [...new Set(palette.map((t) => t.trim()).filter(Boolean))];
  if (names.length <= max) return names;
  const rand = mulberry32(seed ^ 0x5eed);
  const idx = names.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, max).sort((a, b) => a - b).map((i) => names[i]);
}

/** Default shares for picked terrains: uneven, by seed, so some terrains are common and some rare. */
export function defaultShares(terrains: readonly string[], seed: number): CellShare[] {
  const rand = mulberry32(seed ^ 0xa11);
  return terrains.map((terrain) => ({ terrain, weight: 1 + Math.floor(rand() * 4) }));
}

/**
 * The flower's cells filled from `shares` as patches. Cells holding
 * "(blocked)" in `keep` stay as they are. The first share's patch starts
 * on `start` (default the centre), the rest on random free cells.
 */
export function fillFromShares(shares: readonly CellShare[], seed: number, keep?: readonly FlowerCell[], start = CENTRE): FlowerCell[] {
  const rand = mulberry32(seed);
  const cells: (string | null)[] = Array.from({ length: CELL_COUNT }, (_, i) => (keep && isBlocked(keep[i]?.result ?? "") ? keep[i].result : null));
  const free = () => cells.flatMap((c, i) => (c === null ? [i + 1] : []));
  const live = shares.filter((s) => s.weight > 0 && s.terrain.trim());
  const counts = cellCounts(live.map((s) => s.weight), free().length);
  const frontier: number[][] = live.map(() => []);
  const left = [...counts];
  // Seed each patch.
  live.forEach((s, i) => {
    if (left[i] <= 0) return;
    const options = free();
    if (!options.length) return;
    const at = i === 0 && options.includes(start) ? start : options[Math.floor(rand() * options.length)];
    cells[at - 1] = s.terrain;
    left[i]--;
    frontier[i].push(at);
  });
  // Grow round robin: each patch takes a free neighbour of one of its cells.
  for (let guard = 0; left.some((n) => n > 0) && guard < CELL_COUNT * 8; guard++) {
    for (let i = 0; i < live.length; i++) {
      if (left[i] <= 0) continue;
      const near = [...new Set(frontier[i].flatMap((c) => DIRS.map((d) => neighbour(c, d)).filter((n): n is number => n !== undefined && cells[n - 1] === null)))];
      // Boxed in: start again on any free cell.
      const pool = near.length ? near : free();
      if (!pool.length) { left[i] = 0; continue; }
      const at = pool[Math.floor(rand() * pool.length)];
      cells[at - 1] = live[i].terrain;
      frontier[i].push(at);
      left[i]--;
    }
  }
  // A kept (blocked) cell keeps its notes; a refilled one starts clean.
  return cells.map((c, i) => {
    const kept = keep && isBlocked(keep[i]?.result ?? "");
    return { result: c ?? "(nothing)", ...(kept && keep[i].notes ? { notes: keep[i].notes } : {}) };
  });
}

/** A whole flower's cells from a palette's terrain names (Fill from palette). */
export function fillFromPalette(palette: readonly string[], seed: number, keep?: readonly FlowerCell[], start = CENTRE): FlowerCell[] {
  const picked = pickTerrains(palette, seed);
  return fillFromShares(defaultShares(picked, seed), seed, keep, start);
}

/** How many cells show each result (shares for the share sliders), in first-seen order. */
export function sharesOf(cells: readonly FlowerCell[]): CellShare[] {
  const out = new Map<string, number>();
  for (const c of cells) {
    const r = c.result.trim();
    if (!r || isBlocked(r) || /^\(?\s*nothing\s*\)?$/i.test(r)) continue;
    out.set(r, (out.get(r) ?? 0) + 1);
  }
  return [...out].map(([terrain, weight]) => ({ terrain, weight }));
}

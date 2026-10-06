/**
 * Passes that run on a finished map. Every change keeps all adjacency rules:
 * a hex only changes to a terrain allowed next to all of its neighbours.
 * Protected hexes (fixed / painted, and guaranteed features) never change.
 */

import { hexNeighbors, cellKey, parseCellKey, type Orientation, type Stagger } from "./grid";
import { adjacencyLookup, type HexWfcModel, type CountRange } from "./model";

export interface GridInfo {
  cols: number;
  rows: number;
  ox: number;
  oy: number;
  orientation: Orientation;
  stagger: Stagger;
}

const neighbourKeys = (key: string, grid: GridInfo, cells: Map<string, string>): string[] => {
  const xy = parseCellKey(key);
  if (!xy) return [];
  return hexNeighbors(xy[0], xy[1], grid.orientation, grid.stagger)
    .map(([x, y]) => cellKey(x, y))
    .filter((k) => cells.has(k));
};

/** Deterministic shuffle. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Can `key` become terrain u without breaking a rule with any neighbour? */
function fits(
  key: string,
  u: string,
  cells: Map<string, string>,
  grid: GridInfo,
  adj: (a: string, b: string) => number,
): boolean {
  return neighbourKeys(key, grid, cells).every((n) => adj(u, cells.get(n)!) > 0);
}

/**
 * Clean up lone specks and ragged edges: a hex with too few same-terrain
 * neighbours takes its most common neighbouring terrain (if the rules allow).
 * Strength 0–1 sets the number of passes and how lonely a hex must be.
 * Scattered and line terrains are left alone (thin by nature).
 * Returns the number of hexes changed.
 */
export function smooth(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  strength: number,
  protect: Set<string>,
  rng: () => number,
): number {
  if (!(strength > 0)) return 0;
  const adj = adjacencyLookup(model);
  const keepShape = new Set(model.terrains.filter((t) => t.shape === "scatter" || t.shape === "line").map((t) => t.name));
  const passes = Math.ceil(Math.min(1, strength) * 3);
  const lonely = strength >= 0.5 ? 1 : 0; // max same-terrain neighbours to count as a speck
  let changed = 0;
  for (let p = 0; p < passes; p++) {
    let changedThisPass = 0;
    for (const key of shuffled([...cells.keys()], rng)) {
      const t = cells.get(key)!;
      if (protect.has(key) || keepShape.has(t)) continue;
      const ns = neighbourKeys(key, grid, cells);
      let same = 0;
      const tally = new Map<string, number>();
      for (const n of ns) {
        const u = cells.get(n)!;
        if (u === t) same++;
        else tally.set(u, (tally.get(u) ?? 0) + 1);
      }
      if (same > lonely) continue;
      const candidates = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [u, n] of candidates) {
        if (n < 2) break; // need a real majority to switch to
        if (fits(key, u, cells, grid, adj)) {
          cells.set(key, u);
          changed++;
          changedThisPass++;
          break;
        }
      }
    }
    if (!changedThisPass) break;
  }
  return changed;
}

/** Connected groups of hexes for which `inGroup` is true. */
function components(cells: Map<string, string>, grid: GridInfo, inGroup: (t: string) => boolean): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const [key, t] of cells) {
    if (seen.has(key) || !inGroup(t)) continue;
    const comp: string[] = [];
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      for (const n of neighbourKeys(k, grid, cells)) {
        if (!seen.has(n) && inGroup(cells.get(n)!)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/**
 * Make all land (terrain not in `impassable`) one connected area by filling
 * cut-off pockets with impassable terrain, working inward from their edges.
 * Returns how many hexes changed and how many land hexes are still cut off
 * (when the rules allowed no valid fill).
 */
export function connectLand(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  impassable: Set<string>,
  protect: Set<string>,
): { changed: number; stranded: number } {
  const adj = adjacencyLookup(model);
  const isLand = (t: string) => !impassable.has(t);
  const blockers = model.terrains.filter((t) => impassable.has(t.name)).map((t) => t.name);
  let changed = 0;
  for (let round = 0; round < 50; round++) {
    const land = components(cells, grid, isLand).sort((a, b) => b.length - a.length);
    if (land.length <= 1) return { changed, stranded: 0 };
    let progress = false;
    for (const pocket of land.slice(1)) {
      for (const key of pocket) {
        if (protect.has(key)) continue;
        // Prefer the blocker most common around this hex.
        const tally = new Map<string, number>();
        for (const n of neighbourKeys(key, grid, cells)) {
          const u = cells.get(n)!;
          if (impassable.has(u)) tally.set(u, (tally.get(u) ?? 0) + 1);
        }
        const order = [...blockers].sort((a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0));
        for (const u of order) {
          if (fits(key, u, cells, grid, adj)) {
            cells.set(key, u);
            changed++;
            progress = true;
            break;
          }
        }
      }
    }
    if (!progress) break;
  }
  const land = components(cells, grid, isLand).sort((a, b) => b.length - a.length);
  return { changed, stranded: land.slice(1).reduce((n, c) => n + c.length, 0) };
}

/** Number of separate patches per terrain. */
export function countPatches(cells: Map<string, string>, grid: GridInfo): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const [key, t] of cells) {
    if (seen.has(key)) continue;
    out.set(t, (out.get(t) ?? 0) + 1);
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop()!;
      for (const n of neighbourKeys(k, grid, cells)) {
        if (!seen.has(n) && cells.get(n) === t) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  }
  return out;
}

/** How far the patch counts are from the requested ranges (0 = all met). */
export function countsPenalty(counted: Map<string, number>, counts: Record<string, CountRange>): number {
  let p = 0;
  for (const [t, r] of Object.entries(counts)) {
    const n = counted.get(t) ?? 0;
    if (r.min !== undefined && n < r.min) p += r.min - n;
    if (r.max !== undefined && n > r.max) p += n - r.max;
  }
  return p;
}

/**
 * Add single-hex patches of terrains below their minimum count, on hexes
 * where the rules allow it and the hex isn't next to the same terrain.
 * Doesn't take a hex from a terrain that would then drop below its own
 * minimum. Returns the number of hexes changed.
 */
export function topUpCounts(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  counts: Record<string, CountRange>,
  protect: Set<string>,
  rng: () => number,
): number {
  const adj = adjacencyLookup(model);
  const known = new Set(model.terrains.map((t) => t.name));
  let changed = 0;
  for (const [t, r] of Object.entries(counts)) {
    if (r.min === undefined || !known.has(t)) continue;
    let n = countPatches(cells, grid).get(t) ?? 0;
    if (n >= r.min) continue;
    for (const key of shuffled([...cells.keys()], rng)) {
      if (n >= r.min) break;
      const current = cells.get(key)!;
      if (protect.has(key) || current === t) continue;
      if (neighbourKeys(key, grid, cells).some((k) => cells.get(k) === t)) continue;
      if (!fits(key, t, cells, grid, adj)) continue;
      const own = counts[current];
      if (own?.min !== undefined) {
        cells.set(key, t);
        const after = countPatches(cells, grid).get(current) ?? 0;
        if (after < own.min) {
          cells.set(key, current);
          continue;
        }
      } else {
        cells.set(key, t);
      }
      changed++;
      n++;
    }
  }
  return changed;
}

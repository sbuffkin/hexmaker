/**
 * Passes that run on a finished map. Every change keeps all adjacency rules:
 * a hex only changes to a terrain allowed next to all of its neighbours.
 * Protected hexes (fixed / painted, and guaranteed features) never change.
 */

import { hexNeighbors, cellKey, parseCellKey, type Orientation, type Stagger } from "./grid";
import { adjacencyLookup, type HexWfcModel, type CountRange, type NearRule } from "./model";

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
 * Terrains the clean-up passes never touch: scattered and line terrains
 * (thin by nature), plus any terrain whose share of the example is below
 * `keepRare`, so the odd rare hex survives smoothing.
 */
export function untouchableTerrains(model: HexWfcModel, keepRare = 0): Set<string> {
  const total = model.terrains.reduce((sum, t) => sum + Math.max(0, t.weight), 0) || 1;
  return new Set(
    model.terrains
      .filter((t) => t.shape === "scatter" || t.shape === "line" || (keepRare > 0 && Math.max(0, t.weight) / total < keepRare))
      .map((t) => t.name),
  );
}

/** Neighbour terrains around `key`, most common first, and how many match its own. */
function neighbourTally(key: string, cells: Map<string, string>, grid: GridInfo) {
  const t = cells.get(key)!;
  let same = 0;
  const tally = new Map<string, number>();
  for (const n of neighbourKeys(key, grid, cells)) {
    const u = cells.get(n)!;
    if (u === t) same++;
    else tally.set(u, (tally.get(u) ?? 0) + 1);
  }
  return { same, others: [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}

/**
 * Tidy patch edges. A hex that belongs to a patch but sticks out of it
 * (one same-terrain neighbour) or, from strength 0.5, sits in a notch (two)
 * takes the surrounding terrain when that terrain outnumbers its own by two
 * and the rules allow. Lone hexes (no same-terrain neighbour) are left to
 * `removeSpecks`. Strength 0–1 also sets the number of passes (1–3).
 * Returns the number of hexes changed.
 */
export function smoothEdges(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  strength: number,
  protect: Set<string>,
  keep: Set<string>,
  rng: () => number,
): number {
  if (!(strength > 0)) return 0;
  const adj = adjacencyLookup(model);
  const passes = Math.ceil(Math.min(1, strength) * 3);
  const maxSame = strength >= 0.5 ? 2 : 1;
  let changed = 0;
  for (let p = 0; p < passes; p++) {
    let changedThisPass = 0;
    for (const key of shuffled([...cells.keys()], rng)) {
      if (protect.has(key) || keep.has(cells.get(key)!)) continue;
      const { same, others } = neighbourTally(key, cells, grid);
      if (same < 1 || same > maxSame) continue;
      for (const [u, n] of others) {
        if (n < same + 2) break;
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

/**
 * Remove small patches: every patch of `maxSize` hexes or fewer is filled in
 * from outside, hex by hex, with its most common neighbouring terrain the
 * rules allow (at least two neighbours of it for a lone hex). Hexes that
 * can't change are left. Returns the number of hexes changed.
 */
export function removeSpecks(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  maxSize: number,
  protect: Set<string>,
  keep: Set<string>,
): number {
  if (!(maxSize >= 1)) return 0;
  const adj = adjacencyLookup(model);
  let changed = 0;
  for (let round = 0; round < 3; round++) {
    let changedThisRound = 0;
    for (const patch of patchesOf(cells, grid)) {
      if (patch.keys.length > maxSize || keep.has(patch.terrain)) continue;
      const inPatch = new Set(patch.keys);
      for (const key of patch.keys) {
        if (protect.has(key) || cells.get(key) !== patch.terrain) continue;
        const tally = new Map<string, number>();
        for (const n of neighbourKeys(key, grid, cells)) {
          const u = cells.get(n)!;
          if (!inPatch.has(n) && u !== patch.terrain) tally.set(u, (tally.get(u) ?? 0) + 1);
        }
        const others = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        for (const [u, n] of others) {
          if (patch.keys.length === 1 && n < 2) break;
          if (fits(key, u, cells, grid, adj)) {
            cells.set(key, u);
            changed++;
            changedThisRound++;
            break;
          }
        }
      }
    }
    if (!changedThisRound) break;
  }
  return changed;
}

/** Every same-terrain patch on the map. */
function patchesOf(cells: Map<string, string>, grid: GridInfo): { terrain: string; keys: string[] }[] {
  const out: { terrain: string; keys: string[] }[] = [];
  const seen = new Set<string>();
  for (const [key, t] of cells) {
    if (seen.has(key)) continue;
    const keys: string[] = [];
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop()!;
      keys.push(k);
      for (const n of neighbourKeys(k, grid, cells)) {
        if (!seen.has(n) && cells.get(n) === t) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push({ terrain: t, keys });
  }
  return out;
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

/**
 * Near rules: a hex of a ruled terrain with no hex of its anchor terrain
 * within the rule's distance is repainted with the commonest neighbouring
 * terrain that fits (or, failing that, any terrain that fits, most common
 * first). Replacements never use a ruled terrain, so they can't break a
 * rule themselves. Returns how many hexes changed.
 */
export function enforceNear(
  cells: Map<string, string>,
  model: HexWfcModel,
  grid: GridInfo,
  rules: Map<string, NearRule>,
  protect: Set<string>,
): number {
  if (!rules.size) return 0;
  const adj = adjacencyLookup(model);
  const byWeight = [...model.terrains].sort((a, b) => b.weight - a.weight).map((t) => t.name);
  /** Hexes within `distance` of any hex of `anchor`. */
  const covered = (anchor: string, distance: number): Set<string> => {
    const seen = new Set<string>();
    let frontier: string[] = [];
    for (const [k, t] of cells) if (t === anchor) { seen.add(k); frontier.push(k); }
    for (let d = 0; d < distance && frontier.length; d++) {
      const next: string[] = [];
      for (const k of frontier)
        for (const n of neighbourKeys(k, grid, cells))
          if (!seen.has(n)) { seen.add(n); next.push(n); }
      frontier = next;
    }
    return seen;
  };
  let changed = 0;
  for (let round = 0; round < 4; round++) {
    let changedThisRound = 0;
    for (const [terrain, rule] of rules) {
      const ok = covered(rule.terrain, rule.distance);
      for (const [key, t] of cells) {
        if (t !== terrain || ok.has(key) || protect.has(key)) continue;
        const tally = new Map<string, number>();
        for (const n of neighbourKeys(key, grid, cells)) {
          const u = cells.get(n)!;
          if (!rules.has(u)) tally.set(u, (tally.get(u) ?? 0) + 1);
        }
        const candidates = [
          ...[...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([u]) => u),
          ...byWeight.filter((u) => !rules.has(u) && !tally.has(u)),
        ];
        const u = candidates.find((c) => fits(key, c, cells, grid, adj));
        if (u) {
          cells.set(key, u);
          changed++;
          changedThisRound++;
        }
      }
    }
    if (!changedThisRound) break;
  }
  return changed;
}

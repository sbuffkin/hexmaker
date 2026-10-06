/**
 * Hex Wave Function Collapse (simple tiled model) with neighbour-weighted
 * choices.
 *
 * Hard rules: a pair with adjacency weight 0 can never touch (enforced by
 * arc-consistency propagation plus backtracking).
 *
 * Soft rules: when a hex is collapsed, each candidate terrain t is scored
 *   weight(t) × (geometric mean over decided neighbours u of adj(t,u) / Σ_v adj(t,v))^influence
 * A model learned from a map with a lake therefore grows lake next to lake
 * rather than scattering it. (A plain product over neighbours overcounts,
 * because neighbours are correlated, and lets one terrain swallow the map.)
 * The same scores drive the entropy used to pick the next hex.
 *
 * Two more terms keep the result looking like the example:
 *   - frequency feedback nudges each choice toward the model's terrain mix;
 *   - scatter adds randomness to the order hexes are decided in, so
 *     features start in many places instead of one frontier swallowing all.
 *
 * Deterministic for a given model, options and seed.
 */

import { hexNeighbors, cellKey, parseCellKey, toCellMap, type Orientation, type Stagger } from "./grid";
import { adjacencyLookup, type HexWfcModel } from "./model";
import { mulberry32 } from "./rng";

export interface SolveOptions {
  cols: number;
  rows: number;
  /** Coordinate of the top-left hex. Stagger parity uses absolute coords, so this matters. */
  offset?: { x: number; y: number };
  orientation: Orientation;
  stagger?: Stagger;
  /** Hexes that must keep their terrain, keyed "x_y" in absolute coords. */
  fixed?: Map<string, string> | Record<string, string>;
  seed: number;
  /**
   * How strongly decided neighbours steer each choice (clumping). 0 uses only
   * the hard rules and terrain weights, which gives speckled noise. Default 3.
   */
  neighbourInfluence?: number;
  /**
   * How hard the solver steers the overall terrain mix toward the model's
   * terrain weights. Without it, the most common terrain tends to swallow the
   * map, because every new hex copies its neighbours. 0 turns it off.
   * Default 1.
   */
  frequencyFeedback?: number;
  /**
   * Randomness in which hex is decided next. Low values grow one region
   * outward from a single start; higher values start features in many
   * places, which lets enclosed features (a lake inside its shore) form.
   * Default 3.
   */
  scatter?: number;
  /** Backtracks allowed per attempt before restarting. Default 2000. */
  maxBacktracks?: number;
  /** Fresh attempts after the first. Default 5. */
  maxRestarts?: number;
}

export interface SolveStats {
  attempts: number;
  backtracks: number;
  decisions: number;
  ms: number;
}

export type SolveResult =
  | { ok: true; cells: Map<string, string>; stats: SolveStats }
  | {
      ok: false;
      reason: "invalid-input" | "fixed-conflict" | "contradiction";
      message: string;
      at?: { x: number; y: number };
      stats: SolveStats;
    };

/** First pair of neighbouring cells the model forbids, or null. */
export function findViolation(
  model: HexWfcModel,
  cells: Map<string, string> | Record<string, string>,
  orientation: Orientation,
  stagger: Stagger = "odd",
): { a: [number, number]; b: [number, number]; ta: string; tb: string } | null {
  const adj = adjacencyLookup(model);
  const map = toCellMap(cells);
  for (const [key, ta] of map) {
    const xy = parseCellKey(key);
    if (!xy) continue;
    for (const [nx, ny] of hexNeighbors(xy[0], xy[1], orientation, stagger)) {
      const tb = map.get(cellKey(nx, ny));
      if (tb !== undefined && adj(ta, tb) <= 0) return { a: xy, b: [nx, ny], ta, tb };
    }
  }
  return null;
}

/** Feedback never boosts or damps a terrain by more than this factor per choice. */
const FEEDBACK_CAP = 8;

export function solve(model: HexWfcModel, opts: SolveOptions): SolveResult {
  const t0 = Date.now();
  const stats: SolveStats = { attempts: 0, backtracks: 0, decisions: 0, ms: 0 };
  const fail = (
    reason: "invalid-input" | "fixed-conflict" | "contradiction",
    message: string,
    at?: { x: number; y: number },
  ): SolveResult => {
    stats.ms = Date.now() - t0;
    return { ok: false, reason, message, at, stats };
  };

  const { cols, rows, orientation } = opts;
  const stagger = opts.stagger ?? "odd";
  const ox = opts.offset?.x ?? 0;
  const oy = opts.offset?.y ?? 0;
  const influence = opts.neighbourInfluence ?? 3;
  const feedback = opts.frequencyFeedback ?? 1;
  const scatter = opts.scatter ?? 3;
  const terrains = [...new Set(model.terrains.map((t) => t.name))];
  const T = terrains.length;
  if (!(cols > 0 && rows > 0)) return fail("invalid-input", "Grid must be at least 1×1");
  if (T === 0) return fail("invalid-input", "The model has no terrains");
  const tIndex = new Map(terrains.map((t, i) => [t, i]));

  const N = cols * rows;
  const W = (T + 31) >>> 5; // 32-bit words per domain bitset
  const idx = (x: number, y: number) => (y - oy) * cols + (x - ox);
  const inGrid = (x: number, y: number) => x >= ox && x < ox + cols && y >= oy && y < oy + rows;
  const cellXY = (c: number) => ({ x: ox + (c % cols), y: oy + Math.floor(c / cols) });

  // Neighbour table (−1 = off-grid), 6 per cell.
  const nbr = new Int32Array(N * 6).fill(-1);
  for (let c = 0; c < N; c++) {
    const { x, y } = cellXY(c);
    const ns = hexNeighbors(x, y, orientation, stagger);
    for (let d = 0; d < 6; d++) if (inGrid(ns[d][0], ns[d][1])) nbr[c * 6 + d] = idx(ns[d][0], ns[d][1]);
  }

  // Adjacency: hard compat bitsets + soft log-likelihoods.
  const adj = adjacencyLookup(model);
  const compat = new Uint32Array(T * W);
  const logP = new Float64Array(T * T);
  for (let a = 0; a < T; a++) {
    let deg = 0;
    for (let b = 0; b < T; b++) deg += adj(terrains[a], terrains[b]);
    for (let b = 0; b < T; b++) {
      const w = adj(terrains[a], terrains[b]);
      if (w > 0) {
        compat[a * W + (b >>> 5)] |= 1 << (b & 31);
        logP[a * T + b] = influence * Math.log(w / deg);
      }
    }
  }

  const logW = new Float64Array(T);
  const share = new Float64Array(T); // target fraction of the map per terrain
  const solverMask = new Uint32Array(W); // terrains the solver may place
  let weightSum = 0;
  for (const entry of model.terrains) {
    const t = tIndex.get(entry.name)!;
    if (Number.isFinite(entry.weight) && entry.weight > 0) {
      logW[t] = Math.log(entry.weight);
      share[t] = entry.weight;
      weightSum += entry.weight;
      solverMask[t >>> 5] |= 1 << (t & 31);
    }
  }
  for (let t = 0; t < T; t++) share[t] /= weightSum || 1;

  // Fixed cells (only those inside the grid matter).
  const fixedAt = new Int32Array(N).fill(-1);
  const fixedCells: number[] = [];
  for (const [key, terr] of toCellMap(opts.fixed ?? {})) {
    const xy = parseCellKey(key);
    if (!xy || !inGrid(xy[0], xy[1])) continue;
    const ti = tIndex.get(terr);
    if (ti === undefined)
      return fail("invalid-input", `Hex ${key} is "${terr}", which the model doesn't know`, { x: xy[0], y: xy[1] });
    const c = idx(xy[0], xy[1]);
    fixedAt[c] = ti;
    fixedCells.push(c);
  }
  for (const c of fixedCells) {
    const t = fixedAt[c];
    for (let d = 0; d < 6; d++) {
      const n = nbr[c * 6 + d];
      if (n < 0 || fixedAt[n] < 0) continue;
      const u = fixedAt[n];
      if (!((compat[t * W + (u >>> 5)] >>> (u & 31)) & 1)) {
        const a = cellXY(c), b = cellXY(n);
        return fail(
          "fixed-conflict",
          `Fixed hexes ${cellKey(a.x, a.y)} (${terrains[t]}) and ${cellKey(b.x, b.y)} (${terrains[u]}) may not touch`,
          a,
        );
      }
    }
  }
  if (fixedCells.length < N && solverMask.every((v) => v === 0))
    return fail("invalid-input", "Every terrain has weight 0, so empty hexes cannot be filled");

  const maxBacktracks = opts.maxBacktracks ?? 2000;
  const maxRestarts = opts.maxRestarts ?? 5;
  const masterRng = mulberry32(opts.seed);

  // ── Domain state with an undo trail ──────────────────────────────────────
  const dom = new Uint32Array(N * W);
  let trailIdx: number[] = [];
  let trailVal: number[] = [];
  const dirty = new Uint8Array(N).fill(1);
  const markDirty = (c: number) => {
    // A cell's scores depend on its decided neighbours, so they go stale too.
    dirty[c] = 1;
    for (let d = 0; d < 6; d++) {
      const n = nbr[c * 6 + d];
      if (n >= 0) dirty[n] = 1;
    }
  };
  const setWord = (i: number, v: number) => {
    if (dom[i] === v) return;
    trailIdx.push(i);
    trailVal.push(dom[i]);
    dom[i] = v;
    markDirty((i / W) | 0);
  };
  const undoTo = (mark: number) => {
    for (let k = trailIdx.length - 1; k >= mark; k--) {
      dom[trailIdx[k]] = trailVal[k];
      markDirty((trailIdx[k] / W) | 0);
    }
    trailIdx.length = mark;
    trailVal.length = mark;
  };
  const has = (c: number, t: number) => ((dom[c * W + (t >>> 5)] >>> (t & 31)) & 1) === 1;
  /** Terrain index if the cell is decided, −1 if open, −2 if empty. */
  const single = (c: number): number => {
    let found = -2;
    for (let w = 0; w < W; w++) {
      const bits = dom[c * W + w];
      if (!bits) continue;
      if (found !== -2 || (bits & (bits - 1)) !== 0) return -1;
      found = (w << 5) + (31 - Math.clz32(bits));
    }
    return found;
  };

  // ── Propagation (AC-3) ───────────────────────────────────────────────────
  const queue = new Int32Array(N);
  const inQueue = new Uint8Array(N);
  const support = new Uint32Array(W);
  /** Returns the cell whose domain emptied, or −1. */
  const propagate = (seeds: number[]): number => {
    let head = 0, tail = 0, size = 0;
    for (const s of seeds) if (!inQueue[s]) { inQueue[s] = 1; queue[tail++ % N] = s; size++; }
    while (size > 0) {
      const c = queue[head++ % N];
      size--;
      inQueue[c] = 0;
      support.fill(0);
      for (let w = 0; w < W; w++) {
        let bits = dom[c * W + w];
        while (bits) {
          const low = bits & -bits;
          const t = (w << 5) + (31 - Math.clz32(low));
          for (let v = 0; v < W; v++) support[v] |= compat[t * W + v];
          bits ^= low;
        }
      }
      for (let d = 0; d < 6; d++) {
        const n = nbr[c * 6 + d];
        if (n < 0) continue;
        let changed = false, empty = true;
        for (let w = 0; w < W; w++) {
          const i = n * W + w;
          const nv = dom[i] & support[w];
          if (nv !== dom[i]) { setWord(i, nv); changed = true; }
          if (nv) empty = false;
        }
        if (empty) {
          while (size > 0) { inQueue[queue[head++ % N]] = 0; size--; }
          return n;
        }
        if (changed && !inQueue[n]) { inQueue[n] = 1; queue[tail++ % N] = n; size++; }
      }
    }
    return -1;
  };

  // ── Scoring ──────────────────────────────────────────────────────────────
  const scores = new Float64Array(T);
  /** Fill `scores` with relative probabilities for an open cell; returns their sum. */
  const score = (c: number): number => {
    const decided: number[] = [];
    for (let d = 0; d < 6; d++) {
      const n = nbr[c * 6 + d];
      if (n >= 0) {
        const u = single(n);
        if (u >= 0) decided.push(u);
      }
    }
    let max = -Infinity;
    for (let t = 0; t < T; t++) {
      if (!has(c, t)) { scores[t] = -Infinity; continue; }
      let s = logW[t];
      if (decided.length) {
        let e = 0;
        for (const u of decided) e += logP[t * T + u];
        s += e / decided.length;
      }
      scores[t] = s;
      if (s > max) max = s;
    }
    let sum = 0;
    for (let t = 0; t < T; t++) {
      scores[t] = scores[t] === -Infinity ? 0 : Math.exp(scores[t] - max);
      sum += scores[t];
    }
    return sum;
  };
  const placed = new Int32Array(T); // decided hexes per terrain, refreshed each step
  const entropy = new Float64Array(N);
  const open = new Uint8Array(N);
  const noise = new Float64Array(N);

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    stats.attempts++;
    const rng = mulberry32(Math.floor(masterRng() * 4294967296));
    trailIdx = [];
    trailVal = [];
    for (let c = 0; c < N; c++) noise[c] = rng() * scatter;
    for (let c = 0; c < N; c++) {
      const ft = fixedAt[c];
      for (let w = 0; w < W; w++) dom[c * W + w] = ft >= 0 ? (ft >>> 5 === w ? 1 << (ft & 31) : 0) : solverMask[w];
    }
    dirty.fill(1);
    const all: number[] = [];
    for (let c = 0; c < N; c++) all.push(c);
    const bad = propagate(all);
    if (bad >= 0)
      return fail("fixed-conflict", "The fixed hexes can't be completed under these rules", cellXY(bad));
    trailIdx = [];
    trailVal = [];

    const stack: [number, number, number][] = []; // [trailMark, cell, terrain]
    let backtracks = 0;
    let gaveUp = false;

    for (;;) {
      let best = -1, bestH = Infinity, decidedCount = 0;
      placed.fill(0);
      for (let c = 0; c < N; c++) {
        const s = single(c);
        if (s >= 0) { placed[s]++; decidedCount++; }
        if (dirty[c]) {
          dirty[c] = 0;
          open[c] = s === -1 ? 1 : 0;
          if (open[c]) {
            const sum = score(c);
            let h = Math.log(sum);
            for (let t = 0; t < T; t++) if (scores[t] > 0) h -= (scores[t] / sum) * Math.log(scores[t]);
            entropy[c] = h + noise[c];
          }
        }
        if (open[c] && entropy[c] < bestH) { bestH = entropy[c]; best = c; }
      }
      if (best < 0) break; // everything decided

      // Frequency feedback is applied to the choice only, not to the entropy
      // cache: it changes after every step, and rescoring every hex each
      // step would make the solver quadratic in a much worse way.
      let sum = score(best);
      if (feedback > 0) {
        sum = 0;
        for (let t = 0; t < T; t++) {
          if (scores[t] <= 0) continue;
          const ratio = Math.min(FEEDBACK_CAP, Math.max(1 / FEEDBACK_CAP, (share[t] * decidedCount + 1) / (placed[t] + 1)));
          scores[t] *= Math.pow(ratio, feedback);
          sum += scores[t];
        }
      }
      let r = rng() * sum, choice = -1;
      for (let t = 0; t < T; t++) {
        if (scores[t] <= 0) continue;
        choice = t;
        r -= scores[t];
        if (r < 0) break;
      }

      stats.decisions++;
      stack.push([trailIdx.length, best, choice]);
      for (let w = 0; w < W; w++) setWord(best * W + w, choice >>> 5 === w ? 1 << (choice & 31) : 0);
      let contradiction = propagate([best]) >= 0;

      // Undo the last decision and ban that choice; repeat while the ban
      // itself leads to a contradiction.
      while (contradiction) {
        const top = stack.pop();
        if (!top || backtracks >= maxBacktracks) { gaveUp = true; break; }
        backtracks++;
        stats.backtracks++;
        const [mark, cell, t] = top;
        undoTo(mark);
        const wi = cell * W + (t >>> 5);
        setWord(wi, dom[wi] & ~(1 << (t & 31)));
        contradiction = single(cell) === -2 || propagate([cell]) >= 0;
      }
      if (gaveUp) break;
    }

    if (!gaveUp) {
      const cells = new Map<string, string>();
      for (let c = 0; c < N; c++) {
        const { x, y } = cellXY(c);
        cells.set(cellKey(x, y), terrains[single(c)]);
      }
      stats.ms = Date.now() - t0;
      return { ok: true, cells, stats };
    }
  }

  return fail(
    "contradiction",
    `No valid map found after ${stats.attempts} attempt(s) and ${stats.backtracks} backtrack(s); the rules may be too strict for this grid`,
  );
}

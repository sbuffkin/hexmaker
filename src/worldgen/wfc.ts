/**
 * Hex-grid Wave Function Collapse (simple tiled model) — PROTOTYPE.
 *
 * Pure, DOM-free, Obsidian-free. Not wired into any UI yet; see the KB plan
 * note `plan-wfc-worldgen` for the design this module is a spike for.
 *
 * Model: each hex is a cell whose domain is a set of terrain names taken from
 * the user's palette. Adjacency is undirected and the same in all six
 * directions (terrain hexes have no rotation or edge sockets), so a single
 * symmetric compatibility matrix is enough.
 *
 * Invariants:
 *   - Palette-agnostic: terrains are opaque strings; nothing is hardcoded.
 *   - Fixed cells (hexes the user already painted) are never changed. If they
 *     are mutually inconsistent the solver reports `fixed-conflict` instead of
 *     silently overwriting them.
 *   - Deterministic: the same input (including `seed`) gives the same output.
 *   - Neighbour topology is delegated to `hexNeighbors` from hexGeometry so it
 *     can never drift from the map renderer (odd-q / odd-r with stagger).
 */

import { hexNeighbors } from "../hex-map/hexGeometry";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Adjacency "deck".
 *  - `default: "allow"` → every pair may touch except those in `pairs`
 *    (the "ocean is never next to desert" style; an empty list = no constraints).
 *  - `default: "deny"`  → only the pairs in `pairs` may touch (classic WFC).
 *    Self-adjacency must then be listed explicitly, e.g. ["forest", "forest"].
 * Pairs are unordered: ["a","b"] also covers ["b","a"].
 */
export interface AdjacencyRules {
  default: "allow" | "deny";
  pairs: [string, string][];
}

export interface WfcInput {
  cols: number;
  rows: number;
  /** Absolute coordinate of the top-left cell (MapData.gridOffset). Parity of
   *  absolute coords drives the stagger, so this matters for neighbours. */
  offset?: { x: number; y: number };
  orientation: "flat" | "pointy";
  stagger?: "odd" | "even";
  terrains: string[];
  rules: AdjacencyRules;
  /** Relative frequency per terrain. Missing = 1. 0 = never chosen by the
   *  solver (still allowed in fixed cells). */
  weights?: Record<string, number>;
  /** Pre-painted hexes keyed by "x_y" (absolute coords). Never changed. */
  fixed?: Record<string, string>;
  seed: number;
  /** Backtracks allowed per attempt before restarting. Default 2000. */
  maxBacktracks?: number;
  /** Fresh attempts (re-seeded) after the first one. Default 5. */
  maxRestarts?: number;
}

export interface WfcStats {
  attempts: number;
  backtracks: number;
  decisions: number;
  ms: number;
}

export type WfcResult =
  | { ok: true; cells: Map<string, string>; stats: WfcStats }
  | {
      ok: false;
      reason: "invalid-input" | "fixed-conflict" | "contradiction";
      message: string;
      /** Cell where the problem was detected, when known. */
      at?: { x: number; y: number };
      stats: WfcStats;
    };

// ── Seeded RNG ───────────────────────────────────────────────────────────────

/** mulberry32 — tiny, fast, good enough for map generation. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const cellKey = (x: number, y: number): string => `${x}_${y}`;

/** Build the symmetric allowed-pair lookup used by both solver and validator. */
export function buildAllowed(terrains: string[], rules: AdjacencyRules): (a: string, b: string) => boolean {
  const listed = new Set<string>();
  for (const [a, b] of rules.pairs) {
    listed.add(`${a}\u0000${b}`);
    listed.add(`${b}\u0000${a}`);
  }
  const allowByDefault = rules.default === "allow";
  return (a, b) => {
    const inList = listed.has(`${a}\u0000${b}`);
    return allowByDefault ? !inList : inList;
  };
}

/**
 * Check a finished map against the rules. Returns the first violating
 * neighbour pair, or null if everything is consistent. Used by tests and
 * would be used to validate a hand-painted map in the UI.
 */
export function findViolation(
  cells: Map<string, string>,
  input: Pick<WfcInput, "orientation" | "stagger" | "terrains" | "rules">,
): { a: [number, number]; b: [number, number]; ta: string; tb: string } | null {
  const allowed = buildAllowed(input.terrains, input.rules);
  for (const [key, ta] of cells) {
    const [x, y] = key.split("_").map(Number);
    for (const [nx, ny] of hexNeighbors(x, y, input.orientation, input.stagger ?? "odd")) {
      const tb = cells.get(cellKey(nx, ny));
      if (tb !== undefined && !allowed(ta, tb)) return { a: [x, y], b: [nx, ny], ta, tb };
    }
  }
  return null;
}

/**
 * Learn a rule deck + weights from an already-painted map ("example-based"
 * authoring): any pair seen adjacent is allowed, everything else denied, and
 * weights follow observed frequency. One answer to "the palette has no rules
 * yet" — paint a small sample, then derive the deck from it.
 */
export function learnRulesFromSample(
  cells: Map<string, string>,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): { rules: AdjacencyRules; weights: Record<string, number> } {
  const pairs = new Map<string, [string, string]>();
  const weights: Record<string, number> = {};
  for (const [key, ta] of cells) {
    weights[ta] = (weights[ta] ?? 0) + 1;
    const [x, y] = key.split("_").map(Number);
    for (const [nx, ny] of hexNeighbors(x, y, orientation, stagger)) {
      const tb = cells.get(cellKey(nx, ny));
      if (tb === undefined) continue;
      const [p, q] = ta < tb ? [ta, tb] : [tb, ta];
      pairs.set(`${p}\u0000${q}`, [p, q]);
    }
  }
  return { rules: { default: "deny", pairs: [...pairs.values()] }, weights };
}

// ── Solver ───────────────────────────────────────────────────────────────────

export function solveHexWfc(input: WfcInput): WfcResult {
  const t0 = Date.now();
  const stats: WfcStats = { attempts: 0, backtracks: 0, decisions: 0, ms: 0 };
  const fail = (
    reason: "invalid-input" | "fixed-conflict" | "contradiction",
    message: string,
    at?: { x: number; y: number },
  ): WfcResult => {
    stats.ms = Date.now() - t0;
    return { ok: false, reason, message, at, stats };
  };

  const { cols, rows, orientation } = input;
  const stagger = input.stagger ?? "odd";
  const ox = input.offset?.x ?? 0;
  const oy = input.offset?.y ?? 0;
  const terrains = [...new Set(input.terrains)];
  const T = terrains.length;
  if (cols <= 0 || rows <= 0) return fail("invalid-input", "Grid must be at least 1×1");
  if (T === 0) return fail("invalid-input", "No terrains supplied");
  const tIndex = new Map(terrains.map((t, i) => [t, i]));

  const N = cols * rows;
  const W = (T + 31) >>> 5; // 32-bit words per domain bitset
  const idx = (x: number, y: number) => (y - oy) * cols + (x - ox);
  const inGrid = (x: number, y: number) => x >= ox && x < ox + cols && y >= oy && y < oy + rows;

  // Neighbour table (−1 = off-grid), 6 per cell.
  const nbr = new Int32Array(N * 6).fill(-1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ox + i, y = oy + j, c = j * cols + i;
      const ns = hexNeighbors(x, y, orientation, stagger);
      for (let d = 0; d < ns.length; d++) {
        const [nx, ny] = ns[d];
        if (inGrid(nx, ny)) nbr[c * 6 + d] = idx(nx, ny);
      }
    }
  }

  // Compatibility bitsets: compat[t] = set of terrains allowed next to t.
  const allowed = buildAllowed(terrains, input.rules);
  const compat = new Uint32Array(T * W);
  for (let a = 0; a < T; a++)
    for (let b = 0; b < T; b++)
      if (allowed(terrains[a], terrains[b])) compat[a * W + (b >>> 5)] |= 1 << (b & 31);

  const weight = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const w = input.weights?.[terrains[t]] ?? 1;
    weight[t] = Number.isFinite(w) && w > 0 ? w : 0;
  }
  const solverMask = new Uint32Array(W); // terrains the solver may pick
  for (let t = 0; t < T; t++) if (weight[t] > 0) solverMask[t >>> 5] |= 1 << (t & 31);

  // Fixed cells (only those inside the grid matter).
  const fixedCells: [number, number][] = []; // [cellIndex, terrainIndex]
  for (const [key, terr] of Object.entries(input.fixed ?? {})) {
    const [x, y] = key.split("_").map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inGrid(x, y)) continue;
    const ti = tIndex.get(terr);
    if (ti === undefined)
      return fail("invalid-input", `Fixed hex ${key} uses terrain "${terr}" which is not in the generator's terrain list`, { x, y });
    fixedCells.push([idx(x, y), ti]);
  }
  // Direct fixed–fixed conflicts give the clearest message, so check first.
  const fixedAt = new Int32Array(N).fill(-1);
  for (const [c, t] of fixedCells) fixedAt[c] = t;
  for (const [c, t] of fixedCells) {
    for (let d = 0; d < 6; d++) {
      const n = nbr[c * 6 + d];
      if (n < 0 || fixedAt[n] < 0) continue;
      const u = fixedAt[n];
      if (!((compat[t * W + (u >>> 5)] >>> (u & 31)) & 1)) {
        const x = ox + (c % cols), y = oy + Math.floor(c / cols);
        return fail("fixed-conflict", `Painted hexes ${cellKey(x, y)} (${terrains[t]}) and ${cellKey(ox + (n % cols), oy + Math.floor(n / cols))} (${terrains[u]}) break the adjacency rules`, { x, y });
      }
    }
  }

  if (fixedCells.length < N && solverMask.every((v) => v === 0))
    return fail("invalid-input", "Every terrain has weight 0, so unpainted hexes cannot be filled");

  const maxBacktracks = input.maxBacktracks ?? 2000;
  const maxRestarts = input.maxRestarts ?? 5;
  const masterRng = mulberry32(input.seed);

  const dom = new Uint32Array(N * W);
  // Trail of [wordIndex, previousValue] for cheap undo.
  let trailIdx: number[] = [];
  let trailVal: number[] = [];
  const popcount = (v: number) => {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  const count = (c: number) => {
    let s = 0;
    for (let w = 0; w < W; w++) s += popcount(dom[c * W + w]);
    return s;
  };
  // Entropy cache: recomputed only for cells whose domain changed.
  const dirty = new Uint8Array(N).fill(1);
  const hCache = new Float64Array(N);
  const cntCache = new Int32Array(N);
  const noise = new Float64Array(N); // per-attempt tie-breaker
  const setWord = (i: number, v: number) => {
    if (dom[i] === v) return;
    trailIdx.push(i);
    trailVal.push(dom[i]);
    dom[i] = v;
    dirty[(i / W) | 0] = 1;
  };
  const undoTo = (mark: number) => {
    for (let k = trailIdx.length - 1; k >= mark; k--) {
      dom[trailIdx[k]] = trailVal[k];
      dirty[(trailIdx[k] / W) | 0] = 1;
    }
    trailIdx.length = mark;
    trailVal.length = mark;
  };

  const queue = new Int32Array(N);
  const inQueue = new Uint8Array(N);
  const support = new Uint32Array(W);
  /** AC-3 style propagation from `seeds`. Returns the emptied cell or −1. */
  const propagate = (seeds: number[]): number => {
    let head = 0, tail = 0;
    for (const s of seeds) if (!inQueue[s]) { inQueue[s] = 1; queue[tail++ % N] = s; }
    let size = tail;
    while (size > 0) {
      const c = queue[head++ % N];
      size--;
      inQueue[c] = 0;
      // Union of what c's remaining terrains allow next to them.
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
          // Drain queue flags so the next propagate starts clean.
          while (size > 0) { inQueue[queue[head++ % N]] = 0; size--; }
          return n;
        }
        if (changed && !inQueue[n]) { inQueue[n] = 1; queue[tail++ % N] = n; size++; }
      }
    }
    return -1;
  };

  const cellXY = (c: number) => ({ x: ox + (c % cols), y: oy + Math.floor(c / cols) });

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    stats.attempts++;
    const rng = mulberry32(Math.floor(masterRng() * 4294967296));
    trailIdx = [];
    trailVal = [];
    for (let c = 0; c < N; c++) noise[c] = rng() * 1e-6;
    dirty.fill(1);
    // Init domains: fixed cells are singletons, others get the solver mask.
    for (let c = 0; c < N; c++) {
      const ft = fixedAt[c];
      for (let w = 0; w < W; w++) dom[c * W + w] = ft >= 0 ? (ft >>> 5 === w ? 1 << (ft & 31) : 0) : solverMask[w];
    }
    const allCells: number[] = [];
    for (let c = 0; c < N; c++) allCells.push(c);
    const bad = propagate(allCells);
    if (bad >= 0)
      return fail("fixed-conflict", "The painted hexes cannot be completed under these rules (or every terrain has weight 0)", cellXY(bad));
    trailIdx = [];
    trailVal = [];

    // Decision stack: [trailMark, cell, terrain]
    const stack: [number, number, number][] = [];
    let backtracksThisAttempt = 0;
    let gaveUp = false;

    for (;;) {
      // Pick the undecided cell with minimum weighted entropy (+ tiny noise).
      let best = -1, bestH = Infinity;
      for (let c = 0; c < N; c++) {
        if (dirty[c]) {
          dirty[c] = 0;
          const k = count(c);
          cntCache[c] = k;
          if (k > 1) {
            let sw = 0, swl = 0;
            for (let w = 0; w < W; w++) {
              let bits = dom[c * W + w];
              while (bits) {
                const low = bits & -bits;
                const t = (w << 5) + (31 - Math.clz32(low));
                const wt = weight[t] > 0 ? weight[t] : 1e-9;
                sw += wt; swl += wt * Math.log(wt);
                bits ^= low;
              }
            }
            hCache[c] = Math.log(sw) - swl / sw + noise[c];
          }
        }
        if (cntCache[c] <= 1) continue;
        if (hCache[c] < bestH) { bestH = hCache[c]; best = c; }
      }
      if (best < 0) break; // all collapsed

      // Weighted pick among the remaining terrains.
      let total = 0;
      for (let t = 0; t < T; t++) if ((dom[best * W + (t >>> 5)] >>> (t & 31)) & 1) total += weight[t];
      let r = rng() * total, choice = -1;
      for (let t = 0; t < T; t++) {
        if (!((dom[best * W + (t >>> 5)] >>> (t & 31)) & 1)) continue;
        choice = t;
        r -= weight[t];
        if (r < 0) break;
      }

      stats.decisions++;
      stack.push([trailIdx.length, best, choice]);
      for (let w = 0; w < W; w++) setWord(best * W + w, choice >>> 5 === w ? 1 << (choice & 31) : 0);
      let contradiction = propagate([best]) >= 0;

      // Backtrack: undo the last decision and ban that choice; repeat while
      // the ban itself causes a contradiction.
      while (contradiction) {
        const top = stack.pop();
        if (!top || backtracksThisAttempt >= maxBacktracks) { gaveUp = true; break; }
        backtracksThisAttempt++;
        stats.backtracks++;
        const [mark, cell, t] = top;
        undoTo(mark);
        const wi = cell * W + (t >>> 5);
        setWord(wi, dom[wi] & ~(1 << (t & 31)));
        contradiction = count(cell) === 0 || propagate([cell]) >= 0;
      }
      if (gaveUp) break;
    }

    if (!gaveUp) {
      const cells = new Map<string, string>();
      for (let c = 0; c < N; c++) {
        const { x, y } = cellXY(c);
        for (let t = 0; t < T; t++) {
          if ((dom[c * W + (t >>> 5)] >>> (t & 31)) & 1) { cells.set(cellKey(x, y), terrains[t]); break; }
        }
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

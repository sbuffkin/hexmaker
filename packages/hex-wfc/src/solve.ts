/**
 * Hex Wave Function Collapse (simple tiled model) with neighbour-weighted
 * choices, growth moves and map-level constraints.
 *
 * Hard rules: a pair with adjacency weight 0 can never touch (enforced by
 * arc-consistency propagation plus backtracking). Post passes (smoothing,
 * connected land, counts) only make changes that keep every rule.
 *
 * Soft rules: each candidate terrain t for a hex is scored
 *   weight(t) × (geometric mean over decided neighbours u of P(u | t))^influence
 *   × layout and edge preferences
 * A plain product over neighbours overcounts (neighbours are correlated) and
 * lets one terrain swallow the map. The same scores drive the entropy used
 * to pick the next hex. On top of that:
 *   - frequency feedback nudges each choice toward the model's terrain mix;
 *   - scatter adds randomness to the order hexes are decided in, so
 *     features start in many places instead of one frontier swallowing all;
 *   - growth moves let blob/line terrains spread from where a patch starts;
 *   - randomness mixes in plain weight-only picks (peppers rare terrain).
 *
 * Deterministic for a given model, options and seed.
 */

import { hexNeighbors, directionRing, cellKey, parseCellKey, toCellMap, type Orientation, type Stagger } from "./grid";
import {
  adjacencyLookup,
  effectivePathTweaks,
  resolveSettings,
  type HexWfcModel,
  type GeneratorSettings,
} from "./model";
import { mulberry32 } from "./rng";
import { placeFeatures, placeEdgeBorder } from "./features";
import { routePaths, type PathOutput, type RouteStat } from "./paths";
import {
  smoothEdges,
  removeSpecks,
  untouchableTerrains,
  connectLand,
  countPatches,
  countsPenalty,
  topUpCounts,
  type GridInfo,
} from "./post";

/**
 * Edge smoothing and speck size to apply. A generator saved before these were
 * split only has the legacy `smoothing` knob: any value removed lone specks,
 * and 0.5 or more also tidied edges.
 */
export function cleanupStrengths(s: Required<GeneratorSettings>): { edges: number; speckSize: number } {
  if (s.edgeSmoothing > 0 || s.speckSize > 0 || !(s.smoothing > 0)) {
    return { edges: s.edgeSmoothing, speckSize: Math.floor(s.speckSize) };
  }
  return { edges: s.smoothing >= 0.5 ? s.smoothing : 0, speckSize: 1 };
}

export interface SolveOptions extends GeneratorSettings {
  cols: number;
  rows: number;
  /** Coordinate of the top-left hex. Stagger parity uses absolute coords, so this matters. */
  offset?: { x: number; y: number };
  orientation: Orientation;
  stagger?: Stagger;
  /** Hexes that must keep their terrain, keyed "x_y" in absolute coords. */
  fixed?: Map<string, string> | Record<string, string>;
  seed: number;
  /** Backtracks allowed per attempt before restarting. Default 2000. */
  maxBacktracks?: number;
  /** Fresh attempts after the first. Default 5. */
  maxRestarts?: number;
  /**
   * Whole-map tries when counts or connected land are set; the best result
   * is kept. Default 8.
   */
  maxTries?: number;
}

export interface SolveStats {
  attempts: number;
  backtracks: number;
  decisions: number;
  /** Hexes placed by growth moves (blob/line spreading). */
  grown: number;
  /** Hexes changed by smoothing / connected land / count top-ups. */
  postChanges: number;
  /** Whole-map tries (more than 1 when counts or connected land need it). */
  tries: number;
  ms: number;
}

export type SolveResult =
  | {
      ok: true;
      cells: Map<string, string>;
      /** Hexes laid down as guaranteed features (rivers), keyed "x_y". */
      featureCells: Set<string>;
      /** Paths routed over the terrain (rivers, roads drawn as paths). */
      paths: PathOutput[];
      /** Per learned route: how many were wanted and placed. */
      pathRoutes: RouteStat[];
      /** Soft goals that weren't fully met (counts, connected land, features). */
      warnings: string[];
      stats: SolveStats;
    }
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

const emptyStats = (): SolveStats => ({
  attempts: 0, backtracks: 0, decisions: 0, grown: 0, postChanges: 0, tries: 0, ms: 0,
});

/**
 * Generate a map. Lays down guaranteed features, runs the solver, then the
 * post passes. When counts or connected land are requested, it makes several
 * whole-map tries and keeps the best.
 */
export function solve(model: HexWfcModel, opts: SolveOptions): SolveResult {
  const t0 = Date.now();
  const s = resolveSettings(model, opts);
  const stagger = opts.stagger ?? "odd";
  const grid: GridInfo = {
    cols: opts.cols,
    rows: opts.rows,
    ox: opts.offset?.x ?? 0,
    oy: opts.offset?.y ?? 0,
    orientation: opts.orientation,
    stagger,
  };

  // Per-terrain mix multiplies the learned weights.
  let working: HexWfcModel = {
    ...model,
    terrains: model.terrains.map((t) => ({ ...t, weight: t.weight * (s.mix[t.name] ?? 1) })),
  };
  const features = s.features ? (model.features ?? []).filter((f) => f.count > 0) : [];
  // Feature terrain is only laid down by the features, never by the solver.
  const featureTerrains = new Set(features.map((f) => f.terrain));
  if (featureTerrains.size)
    working = { ...working, terrains: working.terrains.map((t) => (featureTerrains.has(t.name) ? { ...t, weight: 0 } : t)) };

  const hasCounts = Object.values(s.counts).some((c) => c.min !== undefined || c.max !== undefined);
  const tries = hasCounts || s.connected ? Math.max(1, opts.maxTries ?? 8) : 1;
  const masterRng = mulberry32(opts.seed ^ 0x9e3779b9);
  const total = emptyStats();
  const impassable = new Set(s.impassable);

  type Candidate = { cells: Map<string, string>; featureCells: Set<string>; warnings: string[]; penalty: number };
  let best: Candidate | null = null;
  let lastFail: SolveResult | null = null;

  for (let k = 0; k < tries; k++) {
    total.tries++;
    const seed = k === 0 ? opts.seed : Math.floor(masterRng() * 4294967296);
    const rng = mulberry32(seed ^ 0x51ed270b);
    const fixed = new Map(toCellMap(opts.fixed ?? {}));
    const warnings: string[] = [];
    const featureCells = new Set<string>();
    for (const [key, t] of placeEdgeBorder(model, s, grid, fixed, rng)) {
      fixed.set(key, t);
      featureCells.add(key);
    }
    if (features.length) {
      const placed = placeFeatures(model, features, s, grid, fixed, rng);
      warnings.push(...placed.warnings);
      for (const [key, t] of placed.cells) {
        fixed.set(key, t);
        featureCells.add(key);
      }
    }

    let core = solveOnce(working, { ...opts, fixed, seed }, s);
    if (!core.ok && featureCells.size) {
      // The guaranteed features (or edge border) couldn't be fitted; try the
      // map without them rather than failing outright.
      const plain = new Map(toCellMap(opts.fixed ?? {}));
      const retry = solveOnce(model, { ...opts, fixed: plain, seed }, s);
      if (retry.ok) {
        warnings.push("Guaranteed features or the edge border didn't fit this map, so they were left out");
        featureCells.clear();
        core = retry;
      }
    }
    for (const key of ["attempts", "backtracks", "decisions", "grown"] as const) total[key] += core.stats[key];
    if (!core.ok) {
      lastFail = core;
      continue;
    }

    const protect = new Set<string>([...toCellMap(opts.fixed ?? {}).keys(), ...featureCells]);
    const cells = core.cells;
    const keep = untouchableTerrains(model, s.keepRare);
    const { edges, speckSize } = cleanupStrengths(s);
    total.postChanges += smoothEdges(cells, model, grid, edges, protect, keep, rng);
    total.postChanges += removeSpecks(cells, model, grid, speckSize, protect, keep);
    let penalty = 0;
    if (s.connected && impassable.size) {
      const { changed, stranded } = connectLand(cells, model, grid, impassable, protect);
      total.postChanges += changed;
      penalty += stranded;
      if (stranded) warnings.push(`${stranded} land hexes are still cut off from the main landmass`);
    }
    if (hasCounts) penalty += countsPenalty(countPatches(cells, grid), s.counts);

    if (!best || penalty < best.penalty) best = { cells, featureCells, warnings, penalty };
    if (penalty === 0) break;
  }

  if (!best) {
    const fail = lastFail ?? { ok: false as const, reason: "contradiction" as const, message: "No valid map found", stats: total };
    fail.stats = { ...total, ms: Date.now() - t0 };
    return fail;
  }

  if (hasCounts) {
    const protect = new Set<string>([...toCellMap(opts.fixed ?? {}).keys(), ...best.featureCells]);
    total.postChanges += topUpCounts(best.cells, model, grid, s.counts, protect, mulberry32(opts.seed ^ 0x2545f491));
    const counted = countPatches(best.cells, grid);
    for (const [t, range] of Object.entries(s.counts)) {
      const n = counted.get(t) ?? 0;
      if (range.min !== undefined && n < range.min) best.warnings.push(`Only ${n} ${t} (wanted at least ${range.min})`);
      if (range.max !== undefined && n > range.max) best.warnings.push(`${n} ${t} (wanted at most ${range.max})`);
    }
  }
  let paths: PathOutput[] = [];
  let pathRoutes: RouteStat[] = [];
  if (pathsEnabled(model, opts) && model.paths?.length) {
    const N = grid.cols * grid.rows;
    const scale = model.exampleHexes ? Math.sqrt(N / model.exampleHexes) : 1;
    const routed = routePaths(model.paths, best.cells, grid, mulberry32(opts.seed ^ 0x7f4a7c15), scale, effectivePathTweaks(model.paths, s.paths, s.pathTypes), s.impassable);
    paths = routed.paths;
    pathRoutes = routed.routes;
    best.warnings.push(...routed.warnings);
  }
  total.ms = Date.now() - t0;
  return { ok: true, cells: best.cells, featureCells: best.featureCells, paths, pathRoutes, warnings: best.warnings, stats: total };
}

/**
 * Whether learned paths are drawn. `drawPaths` decides when set; generators
 * saved before it existed only had `features`, which used to cover paths too.
 */
export function pathsEnabled(model: HexWfcModel, override: GeneratorSettings = {}): boolean {
  const own = override.drawPaths ?? model.settings?.drawPaths;
  if (own !== undefined) return own;
  return override.features ?? model.settings?.features ?? true;
}

/** Feedback never boosts or damps a terrain by more than this factor per choice. */
const FEEDBACK_CAP = 8;

type CoreResult =
  | { ok: true; cells: Map<string, string>; stats: SolveStats }
  | {
      ok: false;
      reason: "invalid-input" | "fixed-conflict" | "contradiction";
      message: string;
      at?: { x: number; y: number };
      stats: SolveStats;
    };

/** One run of the collapse itself (with restarts and backtracking). */
function solveOnce(model: HexWfcModel, opts: SolveOptions, s: Required<GeneratorSettings>): CoreResult {
  const t0 = Date.now();
  const stats = emptyStats();
  const fail = (
    reason: "invalid-input" | "fixed-conflict" | "contradiction",
    message: string,
    at?: { x: number; y: number },
  ): CoreResult => {
    stats.ms = Date.now() - t0;
    return { ok: false, reason, message, at, stats };
  };

  const { cols, rows, orientation } = opts;
  const stagger = opts.stagger ?? "odd";
  const ox = opts.offset?.x ?? 0;
  const oy = opts.offset?.y ?? 0;
  const influence = s.neighbourInfluence;
  const feedback = s.frequencyFeedback;
  const scatter = s.scatter;
  const featureSize = s.featureSize;
  const bias = s.directionalBias;
  const randomness = Math.min(1, Math.max(0, s.randomness));
  const terrains = [...new Set(model.terrains.map((t) => t.name))];
  const T = terrains.length;
  if (!(cols > 0 && rows > 0)) return fail("invalid-input", "Grid must be at least 1×1");
  if (T === 0) return fail("invalid-input", "The model has no terrains");
  const tIndex = new Map(terrains.map((t, i) => [t, i]));
  const entryOf = new Map(model.terrains.map((e) => [e.name, e]));

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

  // Position preferences per hex: directional bias (learned 3×3 layout,
  // bilinear between bin centres) and edge style (border preference that
  // fades out over the outer ~15% of the map).
  let logPos: Float32Array | null = null;
  const ensurePos = () => (logPos ??= new Float32Array(N * T));
  if (bias > 0 && model.terrains.some((e) => e.layout?.length === 9)) {
    const pos = ensurePos();
    const centre = [1 / 6, 1 / 2, 5 / 6];
    const axis = (f: number): [number, number, number] => {
      if (f <= centre[0]) return [0, 0, 0];
      if (f >= centre[2]) return [2, 2, 0];
      const i = f < centre[1] ? 0 : 1;
      return [i, i + 1, (f - centre[i]) * 3];
    };
    for (const entry of model.terrains) {
      const lay = entry.layout;
      if (lay?.length !== 9) continue;
      const t = tIndex.get(entry.name)!;
      for (let c = 0; c < N; c++) {
        const [cx0, cx1, fx] = axis(((c % cols) + 0.5) / cols);
        const [cy0, cy1, fy] = axis((Math.floor(c / cols) + 0.5) / rows);
        const top = lay[cy0 * 3 + cx0] * (1 - fx) + lay[cy0 * 3 + cx1] * fx;
        const bottom = lay[cy1 * 3 + cx0] * (1 - fx) + lay[cy1 * 3 + cx1] * fx;
        pos[c * T + t] += bias * Math.log(Math.max(0.02, top * (1 - fy) + bottom * fy));
      }
    }
  }
  // Learned edge preference (soft). An explicit edge terrain is laid down as
  // a fixed border before solving instead (see placeEdgeBorder).
  if (s.edgeStrength > 0 && !s.edgeTerrain) {
    const logEdge = new Float64Array(T);
    // Doubled so strength 1 roughly reproduces the example's border mix
    // (measured on real maps with dev/wfc-edge.mts).
    for (let t = 0; t < T; t++) logEdge[t] = 2 * Math.log(Math.max(0.02, entryOf.get(terrains[t])?.edge ?? 1));
    if (logEdge.some((v) => v !== 0)) {
      const pos = ensurePos();
      const depth = Math.max(2, 0.15 * Math.min(cols, rows));
      for (let c = 0; c < N; c++) {
        const i = c % cols, j = Math.floor(c / cols);
        const d = Math.min(i, cols - 1 - i, j, rows - 1 - j);
        const f = Math.max(0, 1 - d / depth);
        if (f > 0) for (let t = 0; t < T; t++) pos[c * T + t] += s.edgeStrength * f * logEdge[t];
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
    // Bit operators give signed 32-bit results; dom holds unsigned words. With
    // 32+ terrains the top bit is used, so compare and store as unsigned (a
    // signed/unsigned mismatch here once made propagation loop forever).
    v >>>= 0;
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
    for (const sd of seeds) if (!inQueue[sd]) { inQueue[sd] = 1; queue[tail++ % N] = sd; size++; }
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
          const nv = (dom[i] & support[w]) >>> 0;
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

  // ── Growth setup ─────────────────────────────────────────────────────────
  // After the solver chooses a terrain for a hex that starts a new patch, a
  // "blob" or "line" terrain spreads into nearby open hexes. Every move is a
  // normal place + propagate, undone on its own if it breaks a rule.
  const growShape = new Uint8Array(T); // 0 none, 1 blob, 2 line
  const isScatter = new Uint8Array(T);
  // Learned self-adjacency of growth terrains, used only to fill holes: a hex
  // mostly surrounded by one growth terrain (e.g. a gap inside a lake) should
  // still become that terrain.
  const learnedSelf = new Float64Array(T);
  const growMoves = new Int32Array(T);
  const growTurn = new Float64Array(T);
  const lineWidth = new Int32Array(T).fill(1);
  const spacingOf = new Int32Array(T); // min hex distance between scattered hexes; 0/1 = none
  const sizeScale = model.exampleHexes ? Math.sqrt(N / model.exampleHexes) : 1;
  for (const entry of model.terrains) {
    const t = tIndex.get(entry.name)!;
    if (entry.shape === "scatter") {
      isScatter[t] = 1;
      if (entry.spacing && s.spacing > 0) spacingOf[t] = Math.max(1, Math.round(entry.spacing * s.spacing * sizeScale));
    }
    const shape = entry.shape === "blob" ? 1 : entry.shape === "line" ? 2 : 0;
    const moves = Math.min(Math.floor(N / 2), Math.round((entry.patch ?? 0) * N * featureSize) - 1);
    if (shape && moves > 0) {
      growShape[t] = shape;
      growMoves[t] = moves;
      growTurn[t] = entry.turn ?? 0.2;
      lineWidth[t] = Math.max(1, Math.min(3, Math.round(s.lineWidth > 0 ? s.lineWidth : (entry.width ?? 1))));
      // Growth owns this terrain's clumping. If the neighbour score also
      // rewarded "same terrain next door", every patch would keep spreading
      // past its learned size. Score self-adjacency at chance level instead.
      if ((compat[t * W + (t >>> 5)] >>> (t & 31)) & 1) {
        learnedSelf[t] = logP[t * T + t];
        logP[t * T + t] = influence * Math.log(share[t] || 1e-9);
      }
      // Likewise, judge other neighbours by what lines this terrain's
      // border, not by all its edges: most edges of a learned patch are
      // interior (forest–forest), which would make "forest next to grass"
      // look rare and stop new patches from ever starting.
      let border = 0;
      for (let u = 0; u < T; u++) if (u !== t) border += adj(terrains[t], terrains[u]);
      for (let u = 0; u < T; u++) {
        const w = adj(terrains[t], terrains[u]);
        if (u !== t && w > 0) logP[t * T + u] = influence * Math.log(w / border);
      }
    }
  }
  const maxPatches = new Int32Array(T).fill(-1);
  for (const [name, range] of Object.entries(s.counts)) {
    const t = tIndex.get(name);
    if (t !== undefined && range.max !== undefined) maxPatches[t] = range.max;
  }

  // Mirror partners of a hex (relative to the grid), for symmetry.
  const mirrorsOf = (c: number): number[] => {
    if (s.symmetry === "none") return [];
    const i = c % cols, j = Math.floor(c / cols);
    const out: number[] = [];
    const lr = s.symmetry === "left-right" || s.symmetry === "both";
    const tb = s.symmetry === "top-bottom" || s.symmetry === "both";
    if (lr) out.push(j * cols + (cols - 1 - i));
    if (tb) out.push((rows - 1 - j) * cols + i);
    if (lr && tb) out.push((rows - 1 - j) * cols + (cols - 1 - i));
    return out.filter((m) => m !== c);
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
      let sc = logW[t] + (logPos ? logPos[c * T + t] : 0);
      if (decided.length) {
        let e = 0, same = 0;
        for (const u of decided) if (u === t) same++;
        const enclosed = growShape[t] !== 0 && same >= 3;
        for (const u of decided) e += u === t && enclosed ? learnedSelf[t] : logP[t * T + u];
        sc += e / decided.length;
      }
      scores[t] = sc;
      if (sc > max) max = sc;
    }
    let sum = 0;
    for (let t = 0; t < T; t++) {
      scores[t] = scores[t] === -Infinity ? 0 : Math.exp(scores[t] - max);
      sum += scores[t];
    }
    return sum;
  };

  const ring = directionRing(orientation);
  const touchesTerrain = (c: number, t: number): boolean => {
    for (let d = 0; d < 6; d++) {
      const n = nbr[c * 6 + d];
      if (n >= 0 && single(n) === t) return true;
    }
    return false;
  };
  /** Is there a decided hex of terrain t within `radius` steps of c? */
  const visit = new Int32Array(N);
  let visitStamp = 0;
  const nearTerrain = (c: number, t: number, radius: number): boolean => {
    visitStamp++;
    let frontier = [c];
    visit[c] = visitStamp;
    for (let r = 0; r < radius; r++) {
      const next: number[] = [];
      for (const f of frontier)
        for (let d = 0; d < 6; d++) {
          const n = nbr[f * 6 + d];
          if (n < 0 || visit[n] === visitStamp) continue;
          visit[n] = visitStamp;
          if (single(n) === t) return true;
          next.push(n);
        }
      frontier = next;
    }
    return false;
  };

  // Patches often stop short (rules, map edge, other patches), so track the
  // size patches actually reach this attempt and use that as the divisor.
  const patchesStarted = new Int32Array(T);
  const patchHexes = new Int32Array(T);
  const expectedPatch = (t: number) =>
    patchesStarted[t] >= 3 ? Math.max(1, patchHexes[t] / patchesStarted[t]) : growMoves[t] + 1;
  const patchCount = new Int32Array(T); // patches started this attempt (for max counts)

  /** Decide open cell c as t and propagate; undo just this move on contradiction. */
  const tryPlaceOne = (c: number, t: number): boolean => {
    if (c < 0 || single(c) !== -1 || !has(c, t)) return false;
    const mark = trailIdx.length;
    for (let w = 0; w < W; w++) setWord(c * W + w, t >>> 5 === w ? 1 << (t & 31) : 0);
    if (propagate([c]) >= 0) {
      undoTo(mark);
      return false;
    }
    stats.grown++;
    return true;
  };
  /** tryPlaceOne plus the hex's mirror partners (symmetric where the rules allow). */
  const tryPlace = (c: number, t: number): boolean => {
    if (!tryPlaceOne(c, t)) return false;
    for (const m of mirrorsOf(c)) tryPlaceOne(m, t);
    return true;
  };

  const growBlob = (seed: number, t: number, rng: () => number) => {
    let budget = growMoves[t];
    const inPatch = new Set<number>([seed]);
    const rejected = new Set<number>();
    const frontier: number[] = [];
    const addNeighbours = (c: number) => {
      for (let d = 0; d < 6; d++) {
        const n = nbr[c * 6 + d];
        if (n >= 0 && !inPatch.has(n) && !rejected.has(n)) frontier.push(n);
      }
    };
    const touching = (c: number) => {
      let k = 0;
      for (let d = 0; d < 6; d++) if (inPatch.has(nbr[c * 6 + d])) k++;
      return k;
    };
    addNeighbours(seed);
    while (budget > 0 && frontier.length) {
      // Best of three random frontier hexes, favouring ones that touch more
      // of the patch (keeps blobs compact without being perfectly round) and
      // ones where directional bias / edge style want this terrain.
      let bi = 0, bs = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(rng() * frontier.length);
        const sc = touching(frontier[i]) + rng() + (logPos ? logPos[frontier[i] * T + t] : 0);
        if (sc > bs) { bs = sc; bi = i; }
      }
      const n = frontier[bi];
      frontier[bi] = frontier[frontier.length - 1];
      frontier.pop();
      if (inPatch.has(n) || rejected.has(n)) continue;
      if (tryPlace(n, t)) {
        inPatch.add(n);
        budget--;
        addNeighbours(n);
      } else {
        rejected.add(n);
      }
    }
  };

  const growLine = (seed: number, t: number, rng: () => number) => {
    let budget = growMoves[t];
    const width = lineWidth[t];
    // Extra width: the hexes behind-left / behind-right of each step.
    const widen = (c: number, h: number) => {
      if (width >= 2 && budget > 0 && tryPlace(nbr[c * 6 + ring[(h + 2) % 6]], t)) budget--;
      if (width >= 3 && budget > 0 && tryPlace(nbr[c * 6 + ring[(h + 4) % 6]], t)) budget--;
    };
    const h0 = Math.floor(rng() * 6);
    widen(seed, h0);
    // Grow from both ends so the seed sits mid-line.
    const ends = [
      { c: seed, h: h0, alive: true },
      { c: seed, h: (h0 + 3) % 6, alive: true },
    ];
    let e = 0;
    while (budget > 0 && (ends[0].alive || ends[1].alive)) {
      const end = ends[e];
      e ^= 1;
      if (!end.alive) continue;
      let h = end.h;
      if (rng() < growTurn[t]) h = (h + (rng() < 0.5 ? 1 : 5)) % 6;
      end.alive = false;
      for (const hh of [h, (h + 1) % 6, (h + 5) % 6]) {
        const n = nbr[end.c * 6 + ring[hh]];
        if (n >= 0 && tryPlace(n, t)) {
          end.c = n;
          end.h = hh;
          end.alive = true;
          budget--;
          widen(n, hh);
          break;
        }
      }
    }
  };

  const placed = new Int32Array(T); // decided hexes per terrain, refreshed each step
  const entropy = new Float64Array(N);
  const open = new Uint8Array(N);
  const noise = new Float64Array(N);
  const saved = new Float64Array(T);

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    stats.attempts++;
    const rng = mulberry32(Math.floor(masterRng() * 4294967296));
    trailIdx = [];
    trailVal = [];
    patchesStarted.fill(0);
    patchHexes.fill(0);
    patchCount.fill(0);
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
        const sg = single(c);
        if (sg >= 0) { placed[sg]++; decidedCount++; }
        if (dirty[c]) {
          dirty[c] = 0;
          open[c] = sg === -1 ? 1 : 0;
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

      // Frequency feedback, growth seed odds, spacing and counts apply to the
      // choice only, not to the entropy cache: they change after every step,
      // and rescoring every hex each step would be far slower.
      const contextSum = score(best);
      if (randomness > 0) {
        // Mix in a pick that ignores neighbours: terrain weight plus position
        // preferences (directional bias, edge style), still only among the
        // terrains the hard rules allow here.
        const base = (t: number) => Math.exp(logW[t] + (logPos ? logPos[best * T + t] : 0));
        let baseSum = 0;
        for (let t = 0; t < T; t++) if (scores[t] > 0) baseSum += base(t);
        for (let t = 0; t < T; t++)
          if (scores[t] > 0) scores[t] = (1 - randomness) * (scores[t] / contextSum) + (randomness * base(t)) / baseSum;
      }
      saved.set(scores);
      let sum = 0;
      for (let t = 0; t < T; t++) {
        if (scores[t] <= 0) continue;
        const startsNew = !touchesTerrain(best, t);
        // Choosing a growth terrain here starts a whole patch, so it must
        // start (patch size) times less often. Otherwise coverage grows
        // with map size: patches scale with the map, and so would the
        // number of patches.
        if (growShape[t] && startsNew) scores[t] /= expectedPatch(t);
        if (startsNew && maxPatches[t] >= 0 && patchCount[t] >= maxPatches[t]) scores[t] = 0;
        if (spacingOf[t] > 1 && scores[t] > 0 && nearTerrain(best, t, spacingOf[t] - 1)) scores[t] = 0;
        if (feedback > 0 && scores[t] > 0) {
          const ratio = Math.min(FEEDBACK_CAP, Math.max(1 / FEEDBACK_CAP, (share[t] * decidedCount + 1) / (placed[t] + 1)));
          scores[t] *= Math.pow(ratio, feedback);
        }
        sum += scores[t];
      }
      if (sum <= 0) {
        // Spacing / counts ruled everything out here; fall back to the rules alone.
        scores.set(saved);
        for (let t = 0; t < T; t++) sum += scores[t];
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
      // Grow only from a hex that starts a new patch. A hex joining an
      // existing patch of the same terrain must not trigger another full
      // growth, or the terrain cascades across the whole map.
      const startsPatch = !touchesTerrain(best, choice);
      for (let w = 0; w < W; w++) setWord(best * W + w, choice >>> 5 === w ? 1 << (choice & 31) : 0);
      let contradiction = propagate([best]) >= 0;
      if (!contradiction) {
        for (const m of mirrorsOf(best)) tryPlaceOne(m, choice);
        if (startsPatch) {
          patchCount[choice] += 1 + mirrorsOf(best).length;
          if (growShape[choice]) {
            const before = stats.grown;
            if (growShape[choice] === 1) growBlob(best, choice, rng);
            else growLine(best, choice, rng);
            patchesStarted[choice]++;
            patchHexes[choice] += 1 + stats.grown - before;
          }
        }
      }

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

/**
 * The generator model ("solver"): which terrains exist, how common each is,
 * and which pairs may sit next to each other.
 *
 * Terrains are opaque strings, so any palette works. Adjacency is undirected
 * and the same in all six directions. A pair that is not listed (or is listed
 * with weight 0) may never touch. That includes a terrain next to itself.
 */

/**
 * How a terrain spreads when the solver places it:
 *  - "blob": grows outward into a compact patch (lakes, forests);
 *  - "line": pushes forward in a heading, turning now and then (ranges, ridges);
 *  - "none": no growth; its shape comes from the neighbour rules alone
 *    (backgrounds, shores, scattered single hexes).
 */
export type GrowthShape = "blob" | "line" | "none";

export interface TerrainEntry {
  name: string;
  /** Relative frequency. 0 = never placed by the solver (still valid in fixed cells). */
  weight: number;
  /**
   * Typical patch size as a fraction of the whole map (0.05 = 5%). Stored
   * relative to map area so a generator learned on a 50×50 map produces the
   * same-looking terrain on a 20×20 one.
   */
  patch?: number;
  /** Growth style. Missing = "none". */
  shape?: GrowthShape;
  /** For "line": chance per step of turning (0–1). Missing = 0.2. */
  turn?: number;
  /**
   * Where the terrain sat in the example, as relative density in a 3×3 grid
   * (row-major: NW, N, NE, W, C, E, SW, S, SE). 1 = as common as anywhere,
   * 3 = three times as common there. Used by directional bias.
   */
  layout?: number[];
}

/** Layout bin names, in the order of TerrainEntry.layout. */
export const LAYOUT_BINS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"] as const;

/**
 * Solver settings saved with a generator. Each maps to the SolveOptions
 * field of the same name; options passed to solve() win over these.
 */
export interface GeneratorSettings {
  featureSize?: number;
  directionalBias?: number;
  neighbourInfluence?: number;
  frequencyFeedback?: number;
  scatter?: number;
  randomness?: number;
}

export const DEFAULT_SETTINGS: Required<GeneratorSettings> = {
  featureSize: 1,
  directionalBias: 0,
  neighbourInfluence: 3,
  frequencyFeedback: 2,
  scatter: 3,
  randomness: 0.1,
};

export interface AdjacencyEntry {
  a: string;
  b: string;
  /** How often this pair touches. Higher = more likely. 0 = forbidden. */
  weight: number;
}

export interface HexWfcModel {
  name: string;
  terrains: TerrainEntry[];
  adjacency: AdjacencyEntry[];
  /** Free-form string metadata (palette, source map, ...). Preserved by the file format. */
  meta: Record<string, string>;
  /** Saved solver settings. Missing fields use DEFAULT_SETTINGS. */
  settings?: GeneratorSettings;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Symmetric lookup of adjacency weights. Duplicate rows (in either order) are
 * summed, so a hand-edited file that lists "A | B" and "B | A" still works.
 */
export function adjacencyLookup(model: HexWfcModel): (a: string, b: string) => number {
  const m = new Map<string, number>();
  for (const { a, b, weight } of model.adjacency) {
    if (!(weight > 0)) continue;
    const k = pairKey(a, b);
    m.set(k, (m.get(k) ?? 0) + weight);
  }
  return (a, b) => m.get(pairKey(a, b)) ?? 0;
}

/** Problems that make a model unusable or surprising. Empty = fine. */
export function validateModel(model: HexWfcModel): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const t of model.terrains) {
    if (!t.name) problems.push("A terrain has an empty name");
    else if (names.has(t.name)) problems.push(`Terrain "${t.name}" is listed twice`);
    names.add(t.name);
    if (!Number.isFinite(t.weight) || t.weight < 0)
      problems.push(`Terrain "${t.name}" has an invalid weight`);
    if (t.patch !== undefined && !(t.patch >= 0 && t.patch <= 1))
      problems.push(`Terrain "${t.name}" has a patch size outside 0–100%`);
    if (t.shape !== undefined && !["blob", "line", "none"].includes(t.shape))
      problems.push(`Terrain "${t.name}" has unknown shape "${String(t.shape)}"`);
    if (t.turn !== undefined && !(t.turn >= 0 && t.turn <= 1))
      problems.push(`Terrain "${t.name}" has a turn rate outside 0–1`);
    if (t.layout !== undefined && (t.layout.length !== 9 || t.layout.some((v) => !(v >= 0))))
      problems.push(`Terrain "${t.name}" needs 9 layout values ≥ 0`);
  }
  if (model.terrains.length === 0) problems.push("No terrains listed");
  for (const { a, b, weight } of model.adjacency) {
    for (const n of [a, b])
      if (!names.has(n)) problems.push(`Adjacency row "${a} | ${b}" uses unknown terrain "${n}"`);
    if (!Number.isFinite(weight) || weight < 0)
      problems.push(`Adjacency row "${a} | ${b}" has an invalid weight`);
  }
  const adj = adjacencyLookup(model);
  for (const t of model.terrains) {
    if (t.weight > 0 && !model.terrains.some((u) => adj(t.name, u.name) > 0))
      problems.push(`Terrain "${t.name}" is not allowed next to anything, so it can only appear alone`);
  }
  return problems;
}

/**
 * Drop terrains that aren't in `allowed` (and their adjacency rows). Use it to
 * fit a model to a palette that lacks some of its terrains.
 */
export function restrictModel(model: HexWfcModel, allowed: Iterable<string>): HexWfcModel {
  const keep = new Set(allowed);
  return {
    ...model,
    terrains: model.terrains.filter((t) => keep.has(t.name)),
    adjacency: model.adjacency.filter((e) => keep.has(e.a) && keep.has(e.b)),
    meta: { ...model.meta },
    ...(model.settings ? { settings: { ...model.settings } } : {}),
  };
}

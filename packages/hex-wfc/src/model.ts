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
 *  - "scatter": single hexes dotted around (towns, ruins); kept apart by
 *    spacing and never removed by smoothing;
 *  - "none": no growth; its shape comes from the neighbour rules alone
 *    (backgrounds, shores).
 */
export type GrowthShape = "blob" | "line" | "scatter" | "none";

export const GROWTH_SHAPES: readonly GrowthShape[] = ["blob", "line", "scatter", "none"];

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
  /** For "line": thickness in hexes (1–3). Missing = 1. */
  width?: number;
  /**
   * For "scatter": minimum distance in hexes between two hexes of this
   * terrain, as seen in the example. Scaled with map size when solving.
   */
  spacing?: number;
  /**
   * How common the terrain is along the map border compared with overall
   * (1 = no preference, 3 = three times as common at the edge).
   */
  edge?: number;
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
 * A guaranteed line feature, e.g. a river from a map edge to a lake. Placed
 * before the solver runs, so it always exists. `from`/`to` are "edge", "none"
 * (just stops) or a terrain name it must end at.
 */
export interface LineFeature {
  terrain: string;
  from: string;
  to: string;
  /** How many the example had. Scaled with map size when solving. */
  count: number;
}

export type Symmetry = "none" | "left-right" | "top-bottom" | "both";
export const SYMMETRIES: readonly Symmetry[] = ["none", "left-right", "top-bottom", "both"];

/** Min/max number of separate patches of a terrain (a town is a 1-hex patch). */
export interface CountRange {
  min?: number;
  max?: number;
}

/**
 * Solver settings saved with a generator. Options passed to solve() win over
 * these, and missing ones use DEFAULT_SETTINGS.
 */
export interface GeneratorSettings {
  /** Multiplier on learned patch sizes. 0 turns growth off. */
  featureSize?: number;
  /** 0–1: keep terrain where it sat in the example (an ocean along the bottom stays there). */
  directionalBias?: number;
  /** How strongly decided neighbours steer each choice (clumping). */
  neighbourInfluence?: number;
  /** How hard the overall terrain mix is pulled toward the model's weights. */
  frequencyFeedback?: number;
  /** Randomness in which hex is decided next; lets enclosed features start. */
  scatter?: number;
  /** 0–1 share of each choice made by terrain weight alone (peppers rare terrain). */
  randomness?: number;
  /** 0–1: how strongly the border follows `edgeTerrain` (or the learned edge preference). */
  edgeStrength?: number;
  /** Terrain the border should prefer ("" = as learned), e.g. water for islands. */
  edgeTerrain?: string;
  /** Thickness of line terrains: 0 = as learned, otherwise 1–3. */
  lineWidth?: number;
  /** 0–1: clean up lone specks and ragged edges after generating. */
  smoothing?: number;
  /** Mirror the map. Symmetric where the rules allow. */
  symmetry?: Symmetry;
  /** Multiplier on learned spacing between scattered terrain (towns). 0 = off. */
  spacing?: number;
  /** Make all land (terrain not in `impassable`) one connected area. */
  connected?: boolean;
  /** Terrains that count as impassable for `connected` (water, peaks, ...). */
  impassable?: string[];
  /** Per-terrain multiplier on weight, e.g. { Forest: 1.5, Water: 0.5 }. */
  mix?: Record<string, number>;
  /** Per-terrain min/max number of separate patches. */
  counts?: Record<string, CountRange>;
  /** Lay down the model's guaranteed line features (rivers). */
  features?: boolean;
}

export const DEFAULT_SETTINGS: Required<GeneratorSettings> = {
  featureSize: 1,
  directionalBias: 0,
  neighbourInfluence: 3,
  frequencyFeedback: 2,
  scatter: 3,
  randomness: 0.1,
  edgeStrength: 0,
  edgeTerrain: "",
  lineWidth: 0,
  smoothing: 0,
  symmetry: "none",
  spacing: 1,
  connected: false,
  impassable: [],
  mix: {},
  counts: {},
  features: true,
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
  /** Guaranteed line features (rivers). */
  features?: LineFeature[];
  /** Number of painted hexes in the example. Used to scale counts and spacing. */
  exampleHexes?: number;
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
    if (t.shape !== undefined && !GROWTH_SHAPES.includes(t.shape))
      problems.push(`Terrain "${t.name}" has unknown shape "${String(t.shape)}"`);
    if (t.turn !== undefined && !(t.turn >= 0 && t.turn <= 1))
      problems.push(`Terrain "${t.name}" has a turn rate outside 0–1`);
    if (t.width !== undefined && !(t.width >= 1 && t.width <= 3))
      problems.push(`Terrain "${t.name}" has a width outside 1–3`);
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
  for (const f of model.features ?? []) {
    if (!names.has(f.terrain)) problems.push(`Feature uses unknown terrain "${f.terrain}"`);
    for (const end of [f.from, f.to])
      if (end !== "edge" && end !== "none" && !names.has(end))
        problems.push(`Feature "${f.terrain}" ends at unknown terrain "${end}"`);
  }
  const adj = adjacencyLookup(model);
  for (const t of model.terrains) {
    if (t.weight > 0 && !model.terrains.some((u) => adj(t.name, u.name) > 0))
      problems.push(`Terrain "${t.name}" is not allowed next to anything, so it can only appear alone`);
  }
  return problems;
}

/**
 * Drop terrains that aren't in `allowed` (and their adjacency rows and
 * features). Use it to fit a model to a palette that lacks some terrains.
 */
export function restrictModel(model: HexWfcModel, allowed: Iterable<string>): HexWfcModel {
  const keep = new Set(allowed);
  const ok = (end: string) => end === "edge" || end === "none" || keep.has(end);
  return {
    ...model,
    terrains: model.terrains.filter((t) => keep.has(t.name)),
    adjacency: model.adjacency.filter((e) => keep.has(e.a) && keep.has(e.b)),
    ...(model.features
      ? { features: model.features.filter((f) => keep.has(f.terrain) && ok(f.from) && ok(f.to)) }
      : {}),
    meta: { ...model.meta },
    ...(model.settings ? { settings: { ...model.settings } } : {}),
  };
}

/** Settings with defaults filled in; `override` wins over the model's saved ones. */
export function resolveSettings(model: HexWfcModel, override: GeneratorSettings = {}): Required<GeneratorSettings> {
  const out: Required<GeneratorSettings> = { ...DEFAULT_SETTINGS };
  for (const src of [model.settings ?? {}, override]) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

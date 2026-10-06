export {
  hexNeighbors,
  hexCenter,
  hexDistance,
  toAxial,
  directionRing,
  cellKey,
  parseCellKey,
  type Orientation,
  type Stagger,
} from "./grid";
export {
  adjacencyLookup,
  validateModel,
  restrictModel,
  resolveSettings,
  DEFAULT_SETTINGS,
  LAYOUT_BINS,
  GROWTH_SHAPES,
  SYMMETRIES,
  type HexWfcModel,
  type TerrainEntry,
  type AdjacencyEntry,
  type GrowthShape,
  type GeneratorSettings,
  type LineFeature,
  type Symmetry,
  type CountRange,
} from "./model";
export { learnModel, measurePatches, measureLayout, SHAPE_THRESHOLDS, type LearnOptions, type TerrainAnalysis } from "./learn";
export { solve, findViolation, type SolveOptions, type SolveResult, type SolveStats } from "./solve";
export { countPatches, type GridInfo } from "./post";
export {
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  encodeSetting,
  decodeSetting,
  FORMAT_VERSION,
  SETTING_KEYS,
  type ParseResult,
} from "./format";
export { mulberry32, randomSeed } from "./rng";

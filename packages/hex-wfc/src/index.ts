export { hexNeighbors, hexCenter, directionRing, cellKey, parseCellKey, type Orientation, type Stagger } from "./grid";
export {
  adjacencyLookup,
  validateModel,
  restrictModel,
  type HexWfcModel,
  type TerrainEntry,
  type AdjacencyEntry,
  type GrowthShape,
  type GeneratorSettings,
  DEFAULT_SETTINGS,
  LAYOUT_BINS,
} from "./model";
export { learnModel, measurePatches, measureLayout, SHAPE_THRESHOLDS, type LearnOptions } from "./learn";
export { solve, findViolation, type SolveOptions, type SolveResult, type SolveStats } from "./solve";
export {
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  FORMAT_VERSION,
  SETTING_KEYS,
  type ParseResult,
} from "./format";
export { mulberry32, randomSeed } from "./rng";

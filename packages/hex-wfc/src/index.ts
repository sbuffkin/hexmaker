export { hexNeighbors, cellKey, parseCellKey, type Orientation, type Stagger } from "./grid";
export {
  adjacencyLookup,
  validateModel,
  restrictModel,
  type HexWfcModel,
  type TerrainEntry,
  type AdjacencyEntry,
} from "./model";
export { learnModel, type LearnOptions } from "./learn";
export { solve, findViolation, type SolveOptions, type SolveResult, type SolveStats } from "./solve";
export {
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  FORMAT_VERSION,
  type ParseResult,
} from "./format";
export { mulberry32, randomSeed } from "./rng";

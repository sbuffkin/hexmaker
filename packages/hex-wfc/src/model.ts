/**
 * The generator model ("solver"): which terrains exist, how common each is,
 * and which pairs may sit next to each other.
 *
 * Terrains are opaque strings, so any palette works. Adjacency is undirected
 * and the same in all six directions. A pair that is not listed (or is listed
 * with weight 0) may never touch. That includes a terrain next to itself.
 */

export interface TerrainEntry {
  name: string;
  /** Relative frequency. 0 = never placed by the solver (still valid in fixed cells). */
  weight: number;
}

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
  };
}

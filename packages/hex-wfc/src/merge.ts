/**
 * Combine generators learned from separate regions into one, as if all the
 * regions had been one example (without any edges between them).
 *
 * Counts add up (terrain weights, neighbour pairs, features, paths). Measures
 * that are already relative to their region (patch size as a share of the
 * map, where terrain sat in a 3×3 grid, edge preference, line width and
 * turning) are averaged, weighted by how much of that terrain each region had.
 */

import { pathRouteKey, type AdjacencyEntry, type HexWfcModel, type LineFeature, type PathFeature, type TerrainEntry } from "./model";

type Weighted = { value: number; weight: number };

function weightedMean(items: Weighted[]): number | undefined {
  const total = items.reduce((n, i) => n + i.weight, 0);
  if (!items.length || total <= 0) return undefined;
  return items.reduce((n, i) => n + i.value * i.weight, 0) / total;
}

function mergeTerrain(entries: TerrainEntry[]): TerrainEntry {
  const weight = entries.reduce((n, t) => n + t.weight, 0);
  const merged: TerrainEntry = { name: entries[0].name, weight };
  const mean = (pick: (t: TerrainEntry) => number | undefined) =>
    weightedMean(entries.flatMap((t) => {
      const v = pick(t);
      return v === undefined ? [] : [{ value: v, weight: t.weight }];
    }));
  // Shape: the one covering the most hexes of this terrain.
  const byShape = new Map<string, number>();
  for (const t of entries) if (t.shape) byShape.set(t.shape, (byShape.get(t.shape) ?? 0) + t.weight);
  const shape = [...byShape].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (shape) merged.shape = shape as TerrainEntry["shape"];
  const patch = mean((t) => t.patch);
  if (patch !== undefined) merged.patch = patch;
  const turn = mean((t) => t.turn);
  if (turn !== undefined) merged.turn = turn;
  const width = mean((t) => t.width);
  if (width !== undefined) merged.width = width;
  const spacing = mean((t) => t.spacing);
  if (spacing !== undefined) merged.spacing = spacing;
  const edge = mean((t) => t.edge);
  if (edge !== undefined) merged.edge = edge;
  const layouts = entries.filter((t) => t.layout?.length === 9);
  if (layouts.length) {
    merged.layout = Array.from({ length: 9 }, (_, i) =>
      weightedMean(layouts.map((t) => ({ value: t.layout![i], weight: t.weight })))!);
  }
  return merged;
}

function mergePaths(paths: PathFeature[]): PathFeature {
  const count = paths.reduce((n, p) => n + p.count, 0);
  const w = (p: PathFeature) => Math.max(p.count, 1e-9);
  const through: Record<string, number> = {};
  const totalW = paths.reduce((n, p) => n + w(p), 0);
  for (const p of paths) for (const [t, share] of Object.entries(p.through)) through[t] = (through[t] ?? 0) + (share * w(p)) / totalW;
  return {
    type: paths[0].type,
    from: paths[0].from,
    to: paths[0].to,
    count,
    turn: weightedMean(paths.map((p) => ({ value: p.turn, weight: w(p) }))) ?? 0,
    length: weightedMean(paths.map((p) => ({ value: p.length, weight: w(p) }))) ?? 0,
    through,
  };
}

export function mergeModels(models: HexWfcModel[], name: string, meta: Record<string, string> = {}): HexWfcModel {
  if (models.length === 0) throw new Error("Nothing to merge.");

  const terrainGroups = new Map<string, TerrainEntry[]>();
  for (const m of models) for (const t of m.terrains) terrainGroups.set(t.name, [...(terrainGroups.get(t.name) ?? []), t]);
  const terrains = [...terrainGroups.values()]
    .map(mergeTerrain)
    .sort((p, q) => q.weight - p.weight || p.name.localeCompare(q.name));
  const order = new Map(terrains.map((t, i) => [t.name, i]));

  const pairs = new Map<string, AdjacencyEntry>();
  for (const m of models) {
    for (const e of m.adjacency) {
      const [a, b] = order.get(e.a)! <= order.get(e.b)! ? [e.a, e.b] : [e.b, e.a];
      const k = `${a}\u0000${b}`;
      const prev = pairs.get(k);
      if (prev) prev.weight += e.weight;
      else pairs.set(k, { a, b, weight: e.weight });
    }
  }
  const adjacency = [...pairs.values()].sort(
    (p, q) => order.get(p.a)! - order.get(q.a)! || q.weight - p.weight || p.b.localeCompare(q.b),
  );

  const features = new Map<string, LineFeature>();
  for (const m of models) {
    for (const f of m.features ?? []) {
      const k = `${f.terrain}\u0000${f.from}\u0000${f.to}`;
      const prev = features.get(k);
      if (prev) prev.count += f.count;
      else features.set(k, { ...f });
    }
  }

  const routes = new Map<string, PathFeature[]>();
  for (const m of models) for (const p of m.paths ?? []) routes.set(pathRouteKey(p), [...(routes.get(pathRouteKey(p)) ?? []), p]);

  const merged: HexWfcModel = {
    name,
    terrains,
    adjacency,
    exampleHexes: models.reduce((n, m) => n + (m.exampleHexes ?? 0), 0) || undefined,
    meta: { ...meta },
  };
  if (merged.exampleHexes === undefined) delete merged.exampleHexes;
  if (features.size) merged.features = [...features.values()];
  if (routes.size) merged.paths = [...routes.values()].map(mergePaths);
  return merged;
}

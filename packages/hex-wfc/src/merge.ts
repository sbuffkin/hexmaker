/**
 * Combine generators learned from separate regions into one, as if all the
 * regions had been one example (without any edges between them).
 *
 * Counts add up (terrain weights, neighbour pairs, features, paths). Measures
 * that are already relative to their region (patch size as a share of the
 * map, where terrain sat in a 3×3 grid, edge preference, line width and
 * turning) are averaged, weighted by how much of that terrain each region had.
 *
 * Each model can also be given a compass direction: its terrains then lean
 * toward that side of the map (a valley in the west fading into forest in the
 * east), by multiplying their layouts with a gradient. How sharp the change
 * is follows the merged generator's directional bias.
 */

import { layoutSize, layoutTo5, pathRouteKey, type GeneratorSettings, type AdjacencyEntry, type HexWfcModel, type LineFeature, type PathFeature, type TerrainEntry } from "./model";

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
  // Near rule: the one from the entry with the most of this terrain.
  const near = [...entries].sort((a, b) => b.weight - a.weight).find((t) => t.near)?.near;
  if (near) merged.near = { ...near };
  // Layouts of different grid sizes are compared on the finer (5×5) grid.
  const withLayout = entries.filter((t) => layoutSize(t.layout));
  const fine = withLayout.some((t) => layoutSize(t.layout) === 5);
  const layouts = withLayout.map((t) => ({ lay: fine ? layoutTo5(t.layout!) : t.layout!, weight: t.weight }));
  if (layouts.length) {
    merged.layout = Array.from({ length: fine ? 25 : 9 }, (_, i) =>
      weightedMean(layouts.map((l) => ({ value: l.lay[i], weight: l.weight })))!);
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

/** Compass points a merged model can lean toward; "C" = no direction. */
export const COMPASS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"] as const;
export type Compass = (typeof COMPASS)[number];

export const isCompass = (v: string): v is Compass => (COMPASS as readonly string[]).includes(v);

/** Strength of the direction gradient: about 3.6× at the favoured edge, 0.28× at the far one. */
const LEAN = 1.6;

/**
 * A 5×5 layout leaning toward `dir`, averaging 1 over the grid (so a terrain's
 * overall share is unchanged); all 1s for "C".
 */
export function compassLayout(dir: Compass): number[] {
  const i = COMPASS.indexOf(dir);
  const dx = (i % 3) - 1, dy = Math.floor(i / 3) - 1;
  const len = Math.hypot(dx, dy) || 1;
  const raw = Array.from({ length: 25 }, (_, k) => {
    const u = (((k % 5) + 0.5) / 5) * 2 - 1, v = ((Math.floor(k / 5) + 0.5) / 5) * 2 - 1;
    return Math.exp((LEAN * (u * dx + v * dy)) / len);
  });
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((x) => Math.round((x / mean) * 100) / 100);
}

/** `m` with every terrain's layout multiplied by the compass gradient. */
function leanModel(m: HexWfcModel, dir: Compass): HexWfcModel {
  if (dir === "C") return m;
  const ramp = compassLayout(dir);
  return {
    ...m,
    terrains: m.terrains.map((t) => {
      const own = t.layout && layoutSize(t.layout) ? layoutTo5(t.layout) : null;
      return { ...t, layout: ramp.map((r, i) => Math.round(r * (own ? own[i] : 1) * 100) / 100) };
    }),
  };
}

/** Every count in a model multiplied by `f`; relative measures unchanged. */
function scaleModel(m: HexWfcModel, f: number): HexWfcModel {
  return {
    ...m,
    terrains: m.terrains.map((t) => ({ ...t, weight: t.weight * f })),
    adjacency: m.adjacency.map((e) => ({ ...e, weight: e.weight * f })),
    features: m.features?.map((x) => ({ ...x, count: x.count * f })),
    paths: m.paths?.map((p) => ({ ...p, count: p.count * f })),
  };
}

/**
 * Merge models into one. `influence` (one per model, any scale) sets how much
 * each counts: by default a model counts by its size (example hexes), as if
 * the regions were one example. With influence, each model's counts are
 * scaled so its share of the total is its share of the influence; a model
 * with 0 influence is left out.
 */
export function mergeModels(
  models: HexWfcModel[],
  name: string,
  meta: Record<string, string> = {},
  influence?: number[],
  /** One compass point per model ("C" = none); see compassLayout. */
  directions?: Compass[],
): HexWfcModel {
  if (directions && directions.length === models.length && directions.some((d) => d !== "C")) {
    const merged = mergeModels(models.map((m, i) => leanModel(m, directions[i])), name, meta, influence);
    // Directions only work through directional bias; make sure it's on.
    merged.settings = { ...merged.settings, directionalBias: Math.max(1, merged.settings?.directionalBias ?? 0) };
    return merged;
  }
  if (influence && influence.length === models.length) {
    const size = (m: HexWfcModel) => m.exampleHexes ?? m.terrains.reduce((n, t) => n + t.weight, 0);
    const totalSize = models.reduce((n, m) => n + size(m), 0);
    const totalInfluence = influence.reduce((n, w) => n + Math.max(0, w), 0);
    if (totalInfluence > 0 && totalSize > 0) {
      const kept = models
        .map((m, i) => ({ m, w: Math.max(0, influence[i]) }))
        .filter(({ m, w }) => w > 0 && size(m) > 0);
      const merged = mergeModels(
        kept.map(({ m, w }) => scaleModel(m, ((w / totalInfluence) * totalSize) / size(m))),
        name,
        meta,
      );
      // Example size is the regions' real size, whatever their influence.
      merged.exampleHexes = totalSize;
      return merged;
    }
  }
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
  const lead = [...models].sort((a, b) => totalWeight(b) - totalWeight(a)).find((m) => m.settings);
  if (lead?.settings) merged.settings = mergeSettings(lead.settings, models);
  if (features.size) merged.features = [...features.values()];
  if (routes.size) merged.paths = [...routes.values()].map(mergePaths);
  return merged;
}

const totalWeight = (m: HexWfcModel) => m.terrains.reduce((n, t) => n + t.weight, 0);

/**
 * Settings for a merged model: the lead model's, plus the per-terrain lists
 * (counts, near, impassable) of every model, the lead's winning on clashes.
 */
function mergeSettings(lead: GeneratorSettings, models: HexWfcModel[]): GeneratorSettings {
  const out: GeneratorSettings = { ...lead };
  const others = models.map((m) => m.settings).filter((x): x is GeneratorSettings => !!x && x !== lead);
  for (const o of others) {
    if (o.counts) out.counts = { ...o.counts, ...out.counts };
    if (o.near) out.near = { ...o.near, ...out.near };
    if (o.impassable) out.impassable = [...new Set([...(out.impassable ?? []), ...o.impassable])];
  }
  return out;
}

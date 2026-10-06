import { hexNeighbors, cellKey, parseCellKey, toCellMap, type Orientation, type Stagger } from "./grid";
import type { HexWfcModel } from "./model";

export interface LearnOptions {
  name: string;
  orientation: Orientation;
  stagger?: Stagger;
  meta?: Record<string, string>;
}

/**
 * Build a model from a painted example map.
 *
 * - Terrain weight = how many hexes use it.
 * - Adjacency weight = how many edges join the pair. Pairs that never touch
 *   in the example are left out, so they can never touch in generated maps.
 *
 * Cells that are missing (unpainted) are ignored, along with their edges.
 */
export function learnModel(
  cells: Map<string, string> | Record<string, string>,
  opts: LearnOptions,
): HexWfcModel {
  const map = toCellMap(cells);
  const stagger = opts.stagger ?? "odd";
  const terrainCount = new Map<string, number>();
  // Each undirected edge is seen from both ends, so counts are halved below.
  const edgeCount = new Map<string, { a: string; b: string; n: number }>();

  for (const [key, ta] of map) {
    const xy = parseCellKey(key);
    if (!xy || !ta) continue;
    terrainCount.set(ta, (terrainCount.get(ta) ?? 0) + 1);
    for (const [nx, ny] of hexNeighbors(xy[0], xy[1], opts.orientation, stagger)) {
      const tb = map.get(cellKey(nx, ny));
      if (!tb) continue;
      const [a, b] = ta <= tb ? [ta, tb] : [tb, ta];
      const k = `${a}\u0000${b}`;
      const e = edgeCount.get(k);
      if (e) e.n++;
      else edgeCount.set(k, { a, b, n: 1 });
    }
  }

  const terrains = [...terrainCount]
    .map(([name, weight]) => ({ name, weight }))
    .sort((p, q) => q.weight - p.weight || p.name.localeCompare(q.name));
  const order = new Map(terrains.map((t, i) => [t.name, i]));
  const adjacency = [...edgeCount.values()]
    .map(({ a, b, n }) => {
      // List each row under the more common terrain first; reads better.
      const [p, q] = order.get(a)! <= order.get(b)! ? [a, b] : [b, a];
      return { a: p, b: q, weight: n / 2 };
    })
    .sort((p, q) => order.get(p.a)! - order.get(q.a)! || q.weight - p.weight || p.b.localeCompare(q.b));

  return { name: opts.name, terrains, adjacency, meta: { ...(opts.meta ?? {}) } };
}

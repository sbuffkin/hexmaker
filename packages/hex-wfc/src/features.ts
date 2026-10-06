/**
 * Guaranteed line features (rivers): drawn as fixed hexes before the solver
 * runs, so they always exist, then the solver fills in around them.
 *
 * A path starts at its `from` anchor (a map edge, or a patch of a terrain it
 * creates there) and wanders toward its `to` anchor, turning about as often
 * as the example's line did. A terrain anchor gets a small fixed blob of that
 * terrain, so "river ends in a lake" really ends in water; the solver grows
 * the rest of the lake and its shore around it.
 */

import { hexNeighbors, hexDistance, cellKey } from "./grid";
import { adjacencyLookup, type HexWfcModel, type LineFeature, type GeneratorSettings } from "./model";
import type { GridInfo } from "./post";

type Side = 0 | 1 | 2 | 3; // N, E, S, W

export function placeFeatures(
  model: HexWfcModel,
  features: LineFeature[],
  s: Required<GeneratorSettings>,
  grid: GridInfo,
  fixed: Map<string, string>,
  rng: () => number,
): { cells: Map<string, string>; warnings: string[] } {
  const { cols, rows, ox, oy, orientation, stagger } = grid;
  const N = cols * rows;
  const adj = adjacencyLookup(model);
  const entryOf = new Map(model.terrains.map((t) => [t.name, t]));
  const placed = new Map<string, string>();
  const warnings: string[] = [];
  const terrainAt = (k: string) => placed.get(k) ?? fixed.get(k);
  const inGrid = (x: number, y: number) => x >= ox && x < ox + cols && y >= oy && y < oy + rows;
  const nbrs = (x: number, y: number) =>
    hexNeighbors(x, y, orientation, stagger).filter(([nx, ny]) => inGrid(nx, ny));
  const sizeScale = model.exampleHexes ? Math.sqrt(N / model.exampleHexes) : 1;

  /** Would putting t at (x, y) break a rule with anything already placed or fixed? */
  const fitsAt = (x: number, y: number, t: string, pending: Map<string, string>) =>
    nbrs(x, y).every(([nx, ny]) => {
      const k = cellKey(nx, ny);
      const u = pending.get(k) ?? terrainAt(k);
      return u === undefined || adj(t, u) > 0;
    });

  const sidePoint = (side: Side): [number, number] => {
    const along = (n: number) => Math.floor(rng() * n);
    if (side === 0) return [ox + along(cols), oy];
    if (side === 2) return [ox + along(cols), oy + rows - 1];
    if (side === 3) return [ox, oy + along(rows)];
    return [ox + cols - 1, oy + along(rows)];
  };
  const onSide = ([x, y]: [number, number], side: Side) =>
    side === 0 ? y === oy : side === 2 ? y === oy + rows - 1 : side === 3 ? x === ox : x === ox + cols - 1;
  const interiorPoint = (margin: number): [number, number] => {
    const mx = Math.min(margin, Math.floor(cols / 3)), my = Math.min(margin, Math.floor(rows / 3));
    return [ox + mx + Math.floor(rng() * Math.max(1, cols - 2 * mx)), oy + my + Math.floor(rng() * Math.max(1, rows - 2 * my))];
  };
  /** Pick a side, weighted by where the terrain sat in the example when directional bias is on. */
  const pickSide = (terrain: string): Side => {
    const lay = entryOf.get(terrain)?.layout;
    const bias = s.directionalBias;
    if (!lay || lay.length !== 9 || bias <= 0) return Math.floor(rng() * 4) as Side;
    const w = [lay[1], lay[5], lay[7], lay[3]].map((v) => Math.pow(Math.max(0.02, v), bias));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) if ((r -= w[i]) < 0) return i as Side;
    return 3;
  };

  /**
   * A fixed blob of terrain `t` at the line's end, so it visibly ends in it.
   * The blob may touch the line only at `at` (the line's last hex), so a lake
   * sits at the river mouth instead of wrapping around the river.
   */
  const anchorBlob = (at: [number, number], t: string, pending: Map<string, string>, line: Set<string>) => {
    const atKey = cellKey(at[0], at[1]);
    const touchesLineElsewhere = (x: number, y: number) =>
      nbrs(x, y).some(([nx, ny]) => {
        const k = cellKey(nx, ny);
        return k !== atKey && line.has(k);
      });
    const e = entryOf.get(t);
    const target = Math.max(4, Math.min(Math.floor(N / 6), Math.round((e?.patch ?? 0.01) * N * s.featureSize)));
    const queue: [number, number][] = [at];
    const seen = new Set<string>([cellKey(at[0], at[1])]);
    let n = 0;
    while (queue.length && n < target) {
      const [x, y] = queue.shift()!;
      const k = cellKey(x, y);
      if (!pending.has(k) && terrainAt(k) === undefined && !touchesLineElsewhere(x, y) && fitsAt(x, y, t, pending)) {
        pending.set(k, t);
        n++;
      }
      for (const [nx, ny] of nbrs(x, y)) {
        const nk = cellKey(nx, ny);
        if (!seen.has(nk)) {
          seen.add(nk);
          queue.push([nx, ny]);
        }
      }
    }
  };

  const drawOne = (f: LineFeature): boolean => {
    const startFree = (p: [number, number]) => {
      const u = terrainAt(cellKey(p[0], p[1]));
      return u === undefined || u === f.terrain;
    };
    const t = f.terrain;
    const turn = entryOf.get(t)?.turn ?? 0.2;
    const width = Math.max(1, Math.min(3, Math.round(s.lineWidth > 0 ? s.lineWidth : (entryOf.get(t)?.width ?? 1))));
    const span = Math.min(cols, rows);

    let start: [number, number];
    let startSide: Side | null = null;
    if (f.from === "edge") {
      startSide = pickSide(t);
      start = sidePoint(startSide);
    } else {
      start = interiorPoint(Math.max(2, Math.floor(span / 6)));
    }
    if (!startFree(start)) return false;
    let endSide: Side | null = null;
    let target: [number, number];
    if (f.to === "edge") {
      const opposite = ((startSide ?? Math.floor(rng() * 4)) + 2) % 4;
      endSide = (rng() < 0.6 ? opposite : (opposite + (rng() < 0.5 ? 1 : 3)) % 4) as Side;
      target = sidePoint(endSide);
    } else {
      // As long as the example's line, relative to map size: its patch share
      // of this map, divided by its width.
      const lineHexes = (entryOf.get(t)?.patch ?? 0.02) * N * s.featureSize;
      const want = Math.max(3, Math.min(Math.round(span * 1.2), Math.round((lineHexes / width) * (0.8 + 0.4 * rng()))));
      let best = interiorPoint(Math.max(2, Math.floor(span / 6)));
      for (let k = 0; k < 12; k++) {
        const p = interiorPoint(Math.max(2, Math.floor(span / 6)));
        if (Math.abs(hexDistance(p, start, orientation, stagger) - want) < Math.abs(hexDistance(best, start, orientation, stagger) - want)) best = p;
      }
      target = best;
    }

    const pending = new Map<string, string>();
    const path: [number, number][] = [start];
    const onPath = new Set<string>([cellKey(start[0], start[1])]);
    const free = (x: number, y: number) => {
      const k = cellKey(x, y);
      return !onPath.has(k) && (terrainAt(k) === undefined || terrainAt(k) === t);
    };
    let cur = start;
    const maxSteps = 3 * (cols + rows);
    for (let step = 0; step < maxSteps; step++) {
      if (endSide !== null ? onSide(cur, endSide) && path.length > 2 : hexDistance(cur, target, orientation, stagger) === 0) break;
      // Don't step next to earlier parts of the path (keeps it a clean line).
      const options = nbrs(cur[0], cur[1]).filter(([x, y]) => {
        if (!free(x, y)) return false;
        return nbrs(x, y).every(([ax, ay]) => {
          const k = cellKey(ax, ay);
          return !onPath.has(k) || (ax === cur[0] && ay === cur[1]);
        });
      });
      if (!options.length) break;
      const dist = (p: [number, number]) => hexDistance(p, target, orientation, stagger);
      options.sort((a, b) => dist(a) - dist(b));
      const here = dist(cur);
      let next = options[0];
      if (rng() < turn) {
        const sideways = options.filter((p) => dist(p) <= here);
        if (sideways.length) next = sideways[Math.floor(rng() * sideways.length)];
      }
      path.push(next);
      onPath.add(cellKey(next[0], next[1]));
      cur = next;
    }
    const reached = endSide !== null ? onSide(cur, endSide) : hexDistance(cur, target, orientation, stagger) <= 1;
    if (path.length < 3 || !reached) return false;

    for (const [x, y] of path) pending.set(cellKey(x, y), t);
    if (width >= 2) {
      for (const [x, y] of path) {
        const side = nbrs(x, y).filter(([nx, ny]) => free(nx, ny) && !pending.has(cellKey(nx, ny)));
        for (const [nx, ny] of side.slice(0, width - 1)) pending.set(cellKey(nx, ny), t);
      }
    }
    // Every line hex must fit its fixed neighbours; otherwise try another path.
    for (const [k, v] of pending) {
      const [x, y] = k.split("_").map(Number);
      if (!fitsAt(x, y, v, pending)) return false;
    }
    const line = new Set(pending.keys());
    if (f.from !== "edge" && f.from !== "none") anchorBlob(start, f.from, pending, line);
    if (f.to !== "edge" && f.to !== "none") anchorBlob(cur, f.to, pending, line);
    for (const [k, v] of pending) placed.set(k, v);
    return true;
  };

  for (const f of features) {
    if (!entryOf.has(f.terrain)) continue;
    const count = Math.max(1, Math.round(f.count * sizeScale));
    let made = 0;
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (drawOne(f)) {
          made++;
          break;
        }
      }
    }
    if (made < count) {
      const ends = `${f.from === "edge" ? "a map edge" : f.from} to ${f.to === "edge" ? "a map edge" : f.to}`;
      warnings.push(`Placed ${made} of ${count} ${f.terrain} (${ends})`);
    }
  }
  return { cells: placed, warnings };
}

/**
 * Edge style with an explicit terrain (e.g. water all round for islands):
 * a fixed border of that terrain whose width wanders along the edge, so the
 * coast isn't a straight frame. The solver builds the shore around it.
 */
export function placeEdgeBorder(
  model: HexWfcModel,
  s: Required<GeneratorSettings>,
  grid: GridInfo,
  fixed: Map<string, string>,
  rng: () => number,
): Map<string, string> {
  const out = new Map<string, string>();
  const t = s.edgeTerrain;
  if (!t || !(s.edgeStrength > 0) || !model.terrains.some((e) => e.name === t)) return out;
  const adj = adjacencyLookup(model);
  if (adj(t, t) <= 0) return out;
  const { cols, rows, ox, oy, orientation, stagger } = grid;
  const maxWidth = s.edgeStrength * Math.max(2, 0.15 * Math.min(cols, rows)) * 1.5;
  const phase = [0, 1, 2, 3].map(() => rng() * Math.PI * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = Math.min(i, cols - 1 - i, j, rows - 1 - j);
      // Smooth wobble in [0, 1] along both axes.
      const wobble =
        0.5 +
        0.25 * Math.sin((i / cols) * Math.PI * 4 + phase[0]) * Math.cos((j / rows) * Math.PI * 2 + phase[1]) +
        0.25 * Math.sin((j / rows) * Math.PI * 4 + phase[2]) * Math.cos((i / cols) * Math.PI * 2 + phase[3]);
      if (d >= maxWidth * (0.4 + 0.8 * wobble)) continue;
      const k = cellKey(ox + i, oy + j);
      if (fixed.has(k)) continue;
      out.set(k, t);
    }
  }
  // Drop border hexes that would break a rule with a fixed (painted) neighbour.
  for (const k of [...out.keys()]) {
    const [x, y] = k.split("_").map(Number);
    const clash = hexNeighbors(x, y, orientation, stagger).some(([nx, ny]) => {
      const u = fixed.get(cellKey(nx, ny));
      return u !== undefined && adj(t, u) <= 0;
    });
    if (clash) out.delete(k);
  }
  return out;
}


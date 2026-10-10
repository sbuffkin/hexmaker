/**
 * Region terrain from the blend field (plan-overworld-regions §4.3), the
 * phase-0 version: weighted sampling plus type-first smoothing.
 *
 * 1. Every region cell draws a terrain TYPE from τ(p), then a NAME within
 *    that type from ν(p) (blendField.ts). The draw is seeded per cell from
 *    the world seed and the cell's position, so a cell's first draw is the
 *    same whichever region is generated first.
 * 2. A few smoothing passes pull each cell toward the types around it
 *    (already-generated neighbour cells count, and never change), then
 *    pick the name the neighbours of that type use. Types first, so a
 *    forest edge lines up across a seam even where the names differ.
 *
 * Where WFC plugs in later: replace steps 1–2 with hex-wfc `solve` over the
 * region's bounding box, using `mergeModels` of the biomes whose mean Φ is
 * above 1% (weights = mean Φ), each terrain's layout taken from a 5×5
 * sample of P(t|p) / mean P(t) (a generalised `compassLayout`), every
 * `pinned` neighbour cell passed as a fixed cell (including the flower's
 * bounding-box corners), then crop to the mask. The field and the pins
 * are the same inputs this sampler uses.
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import type { BiomeId, BiomeProfile } from "./biomes";
import { namesWithinType, typeMix, type BlendField } from "./blendField";
import { childNeighbours, parentOf, regionCells, type RegionLayout } from "./layout";

export interface RegionGenInput {
  layout: RegionLayout;
  /** The region's parent hex. */
  parent: [number, number];
  field: BlendField;
  profiles: ReadonlyMap<BiomeId, BiomeProfile>;
  /** Terrain of cells already generated in neighbouring regions ("x_y" child keys). Never changed. */
  pinned?: ReadonlyMap<string, string>;
  /** Type of a palette terrain (for pinned cells and smoothing). */
  typeOf: (terrain: string) => string | undefined;
  seed: number;
  /** Smoothing passes (default 2). */
  smoothing?: number;
  /** How strongly the field's odds hold a cell against its neighbours (default 1.5). */
  fieldHold?: number;
  /** Name-within-type sharpness (blendField.namesWithinType). */
  sharpness?: number;
}

/** Child key → terrain for the region's own cells. */
export function generateRegion(input: RegionGenInput): Map<string, string> {
  const { layout, field, profiles, typeOf } = input;
  const pinned = input.pinned ?? new Map<string, string>();
  const cells = regionCells(layout, input.parent[0], input.parent[1]);
  const own = new Set(cells.map(([x, y]) => `${x}_${y}`));
  const sharp = input.sharpness ?? 2;

  // 1. Seeded draw per cell: type, then name within type.
  const types = new Map<string, Map<string, number>>();
  const draw = (x: number, y: number): string | undefined => {
    const phi = field.at(x, y);
    const tau = typeMix(phi, profiles);
    types.set(`${x}_${y}`, tau);
    const rng = mulberry32(cellSeed(input.seed, x, y));
    const type = pick(tau, rng());
    return type ? pick(namesWithinType(phi, profiles, type, sharp), rng()) : undefined;
  };
  const work = new Map<string, string>();
  for (const [x, y] of cells) {
    const name = draw(x, y);
    if (name) work.set(`${x}_${y}`, name);
  }

  // 2. Type-first smoothing (synchronous passes, so cell order doesn't matter).
  //    A halo of not-yet-generated neighbour cells (HALO deep) is drawn and
  //    smoothed along with the region, so the region's edge settles toward
  //    what the next region will become. Pinned cells are fixed context.
  const halo: [number, number][] = [];
  const seen = new Set(own);
  let ring = cells;
  for (let d = 0; d < HALO; d++) {
    const next: [number, number][] = [];
    for (const [x, y] of ring) {
      for (const [a, b] of childNeighbours(layout, x, y)) {
        const k = `${a}_${b}`;
        if (seen.has(k) || pinned.has(k)) continue;
        seen.add(k);
        next.push([a, b]);
        const name = draw(a, b);
        if (name) work.set(k, name);
      }
    }
    halo.push(...next);
    ring = next;
  }
  const outer = new Map<string, string | undefined>();
  const terrainAt = (k: string) => {
    const v = work.get(k) ?? pinned.get(k);
    if (v !== undefined || seen.has(k)) return v;
    if (!outer.has(k)) {
      const [x, y] = k.split("_").map(Number);
      outer.set(k, draw(x, y));
    }
    return outer.get(k);
  };
  const hold = input.fieldHold ?? 1.5;
  for (let pass = 0; pass < (input.smoothing ?? 2); pass++) {
    const next = new Map(work);
    for (const [x, y] of [...cells, ...halo]) {
      const k = `${x}_${y}`;
      const cur = work.get(k);
      if (!cur) continue;
      const score = new Map<string, number>();
      const namesByType = new Map<string, Map<string, number>>();
      for (const [a, b] of childNeighbours(layout, x, y)) {
        const t = terrainAt(`${a}_${b}`);
        const ty = t ? typeOf(t) : undefined;
        if (!t || !ty) continue;
        score.set(ty, (score.get(ty) ?? 0) + 1);
        if (!namesByType.has(ty)) namesByType.set(ty, new Map());
        const nm = namesByType.get(ty)!;
        nm.set(t, (nm.get(t) ?? 0) + 1);
      }
      // The field keeps its say: a cell only flips to a type the field allows there.
      const tau = types.get(k)!;
      for (const [ty, p] of tau) score.set(ty, (score.get(ty) ?? 0) + hold * 6 * p);
      for (const ty of [...score.keys()]) if (!tau.has(ty)) score.delete(ty);
      const curType = typeOf(cur);
      let bestType = curType, best = curType ? score.get(curType) ?? 0 : -1;
      for (const [ty, s] of [...score].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (s > best + 1e-9) { best = s; bestType = ty; }
      if (!bestType || bestType === curType) continue;
      const nm = namesByType.get(bestType);
      const name = nm?.size
        ? [...nm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
        : argmax(namesWithinType(field.at(x, y), profiles, bestType, sharp));
      if (name) next.set(k, name);
    }
    for (const [k, v] of next) work.set(k, v);
  }
  const out = new Map<string, string>();
  for (const k of own) {
    const v = work.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

/** Depth of the smoothed halo around a region. */
const HALO = 2;

/** Spiral order from a centre hex: the order regions are generated in (each pins the earlier ones). */
export function spiralOrder(hexes: [number, number][], centre: [number, number], distance: (a: [number, number], b: [number, number]) => number): [number, number][] {
  return [...hexes].sort((a, b) => distance(a, centre) - distance(b, centre) || a[1] - b[1] || a[0] - b[0]);
}

/** Per-cell seed from the world seed and the cell's position. */
function cellSeed(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

function pick(odds: Map<string, number>, r: number): string | undefined {
  let total = 0;
  for (const v of odds.values()) total += v;
  if (total <= 0) return undefined;
  let acc = 0;
  const target = r * total;
  let last: string | undefined;
  for (const [k, v] of odds) {
    acc += v;
    last = k;
    if (target < acc) return k;
  }
  return last;
}

function argmax(odds: Map<string, number>): string | undefined {
  let best: string | undefined, bv = -1;
  for (const [k, v] of odds) if (v > bv) { bv = v; best = k; }
  return best;
}

// ── seam quality ─────────────────────────────────────────────────────────

export interface SeamStat {
  /** Parent keys of the two regions, sorted. */
  a: string;
  b: string;
  /** Facing cell pairs across the seam. */
  pairs: number;
  /** Share of pairs with the same terrain type / the same terrain. */
  typeAgreement: number;
  nameAgreement: number;
}

/**
 * Agreement across every seam between generated regions: for each pair of
 * neighbouring child cells in different regions, do their types (names)
 * match? Uses `cells` = every generated child cell.
 */
export function seamStats(layout: RegionLayout, cells: ReadonlyMap<string, string>, typeOf: (t: string) => string | undefined): SeamStat[] {
  const acc = new Map<string, { pairs: number; type: number; name: number }>();
  const owner = new Map<string, string>();
  const ownerOf = (k: string) => {
    let o = owner.get(k);
    if (!o) {
      const [x, y] = k.split("_").map(Number);
      o = parentOf(layout, x, y).join("_");
      owner.set(k, o);
    }
    return o;
  };
  for (const [k, t] of cells) {
    const [x, y] = k.split("_").map(Number);
    const ok = ownerOf(k);
    for (const [a, b] of childNeighbours(layout, x, y)) {
      const nk = `${a}_${b}`;
      if (nk <= k) continue; // each pair once
      const nt = cells.get(nk);
      if (nt === undefined) continue;
      const no = ownerOf(nk);
      if (no === ok) continue;
      const id = ok < no ? `${ok}|${no}` : `${no}|${ok}`;
      const s = acc.get(id) ?? { pairs: 0, type: 0, name: 0 };
      s.pairs++;
      if (typeOf(t) === typeOf(nt)) s.type++;
      if (t === nt) s.name++;
      acc.set(id, s);
    }
  }
  return [...acc].map(([id, s]) => {
    const [a, b] = id.split("|");
    return { a, b, pairs: s.pairs, typeAgreement: s.type / s.pairs, nameAgreement: s.name / s.pairs };
  }).sort((p, q) => (p.a + p.b < q.a + q.b ? -1 : 1));
}

/** Type agreement between neighbouring cells INSIDE regions, the baseline a seam should match. */
export function interiorAgreement(layout: RegionLayout, cells: ReadonlyMap<string, string>, typeOf: (t: string) => string | undefined): number {
  let pairs = 0, same = 0;
  for (const [k, t] of cells) {
    const [x, y] = k.split("_").map(Number);
    const o = parentOf(layout, x, y).join("_");
    for (const [a, b] of childNeighbours(layout, x, y)) {
      const nk = `${a}_${b}`;
      if (nk <= k) continue;
      const nt = cells.get(nk);
      if (nt === undefined || parentOf(layout, a, b).join("_") !== o) continue;
      pairs++;
      if (typeOf(t) === typeOf(nt)) same++;
    }
  }
  return pairs ? same / pairs : 1;
}

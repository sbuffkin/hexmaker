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
 * The neighbours already made are fixed context (NeighbourContext, owner
 * 2026-10-12: "all neighbors that already exist should be treated as set
 * tiles"): the region is made on an enlarged canvas, itself plus a margin
 * of their real hexes, and the draws, smoothing, a shore's land side and
 * patches all read that margin. Only the region's own cells are written.
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
import { SHORE_TYPES, WATER_TYPES, type BiomeId, type BiomeProfile } from "./biomes";
import { namesWithinType, typeMix, type BlendField } from "./blendField";
import { childNeighbours, childPoint, neighbourRegions, parentOf, regionCells, regionCentrePoint, regionSpacing, type RegionLayout } from "./layout";
import { fbm, hash2 } from "./noise";
import { tuned, type BiomeTuning } from "./biomeTuning";

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
  /** Smoothing passes (default: the own biome's tuned "smoothing", 2). */
  smoothing?: number;
  /** How strongly the field's odds hold a cell against its neighbours (default: tuned "field-hold", 1.5). */
  fieldHold?: number;
  /** Name-within-type sharpness (blendField.namesWithinType; default: tuned "name-sharpness", 2). */
  sharpness?: number;
}

/** Child key → terrain for the region's own cells (except pinned ones, which are left alone). */
export function generateRegion(input: RegionGenInput): Map<string, string> {
  const { layout, field, profiles, typeOf } = input;
  const pinned = input.pinned ?? new Map<string, string>();
  // Pinned cells inside the region (hand-painted, locked) stay as they are
  // and count as fixed context, like the neighbours' cells.
  const cells = regionCells(layout, input.parent[0], input.parent[1]).filter(([x, y]) => !pinned.has(`${x}_${y}`));
  const own = new Set(cells.map(([x, y]) => `${x}_${y}`));
  // The region's own biome: its islands, patches and tuning (biomeTuning.ts).
  const ownBiome = field.biomes.get(`${input.parent[0]}_${input.parent[1]}`);
  const profile = ownBiome ? profiles.get(ownBiome) : undefined;
  const tuning = profile?.tuning;
  const sharp = input.sharpness ?? tuned(tuning, "name-sharpness");
  const haloDepth = tuned(tuning, "halo");
  // The neighbours' hexes already made (and the region's locked ones), as
  // fixed context every stage reads ("super-region", owner 2026-10-12).
  // None, or influence 0: exactly the generation from before.
  const ctx = neighbourContext(layout, cells, pinned, typeOf, tuned(tuning, "context-depth"), tuned(tuning, "neighbour-influence"), tuned(tuning, "neighbour-fade"));
  /** Name odds within a type at a cell: the field's, leaning to the names the context uses near it. */
  const namesAt = (x: number, y: number, type: string) => {
    const nu = namesWithinType(field.zoned(x, y), profiles, type, sharp);
    return ctx ? ctx.leanNames(x, y, type, nu) : nu;
  };

  // 1. Seeded draw per cell: type, then name within type. Near the context
  //    the odds lean toward the types (and names) it has there.
  const types = new Map<string, Map<string, number>>();
  const draw = (x: number, y: number): string | undefined => {
    // Mixed biomes (Alpine 2 + Taiga) draw from their parts' zones (BlendField.zoned).
    const phi = field.zoned(x, y);
    const base = typeMix(phi, profiles);
    const tau = ctx ? ctx.leanTypes(x, y, base) : base;
    types.set(`${x}_${y}`, tau);
    const rng = mulberry32(cellSeed(input.seed, x, y));
    const type = pick(tau, rng());
    return type ? pick(ctx ? namesAt(x, y, type) : namesWithinType(phi, profiles, type, sharp), rng()) : undefined;
  };
  const work = new Map<string, string>();
  for (const [x, y] of cells) {
    const name = draw(x, y);
    if (name) work.set(`${x}_${y}`, name);
  }

  // 2. Type-first smoothing (synchronous passes, so cell order doesn't matter).
  //    A halo of not-yet-generated neighbour cells (tuned "halo" deep, default 2) is drawn and
  //    smoothed along with the region, so the region's edge settles toward
  //    what the next region will become. Pinned cells are fixed context.
  const halo: [number, number][] = [];
  const seen = new Set(own);
  let ring = cells;
  for (let d = 0; d < haloDepth; d++) {
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
  const hold = input.fieldHold ?? tuned(tuning, "field-hold");
  const passes = input.smoothing ?? tuned(tuning, "smoothing");
  for (let pass = 0; pass < passes; pass++) {
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
        : argmax(namesAt(x, y, bestType));
      if (name) next.set(k, name);
    }
    for (const [k, v] of next) work.set(k, v);
  }

  // 2b. The seam (super-region): an own cell whose made neighbours across the
  //    seam are clearly the other class (land vs water) takes that class, so
  //    a coastline carries on instead of stepping one cell sideways (user
  //    test 2026-10-12: a region below a fjord's ragged edge matched 5 of 8).
  //    Only types the cell's (context-leaned) odds allow; none, or influence
  //    0: nothing changes. Before islands and patches, which are placed on
  //    purpose (a small archipelago ringed by sea keeps its islands).
  if (ctx) {
    const home = `${input.parent[0]}_${input.parent[1]}`;
    const water = new Set(WATER_TYPES);
    const classOf = (t: string | undefined): number | undefined => {
      const ty = t ? typeOf(t) : undefined;
      return ty === undefined ? undefined : water.has(ty) ? 0 : 1;
    };
    const next = new Map<string, string>();
    for (const [x, y] of cells) {
      const k = `${x}_${y}`;
      const mine = classOf(work.get(k));
      if (mine === undefined) continue;
      let land = 0, wet = 0;
      const byType = new Map<string, Map<string, number>>();
      for (const [a, b] of childNeighbours(layout, x, y)) {
        const nk = `${a}_${b}`;
        const t = terrainAt(nk);
        const ty = t ? typeOf(t) : undefined;
        if (t && ty) {
          const m = byType.get(ty) ?? new Map<string, number>();
          m.set(t, (m.get(t) ?? 0) + 1);
          byType.set(ty, m);
        }
        if (!pinned.has(nk) || parentOf(layout, a, b).join("_") === home) continue;
        const c = classOf(t);
        if (c === 1) land++;
        else if (c === 0) wet++;
      }
      const want = land > wet ? 1 : wet > land ? 0 : undefined;
      if (want === undefined || want === mine) continue;
      const tau = types.get(k);
      let bestType: string | undefined, best = -1;
      for (const [ty, p] of [...(tau ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (p <= 0 || water.has(ty) !== (want === 0)) continue;
        let n = 0;
        for (const c of byType.get(ty)?.values() ?? []) n += c;
        const s = n + hold * 6 * p;
        if (s > best + 1e-9) { best = s; bestType = ty; }
      }
      if (!bestType) continue;
      const nm = byType.get(bestType);
      const name = nm?.size ? [...nm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : argmax(namesAt(x, y, bestType));
      if (name) next.set(k, name);
    }
    for (const [k, v] of next) work.set(k, v);
  }

  // With made neighbours: the own cells next to them (the seam band).
  const band = ctx ? seamBand(layout, cells, pinned) : undefined;
  /** Cells placeIslands painted (keepMix leaves them alone). */
  const islandCells = new Set<string>();
  // 3. Islands for watery biomes (landShare / minIslands), after smoothing:
  //    smoothing pulls every cell toward the majority type, so scattered
  //    land in a mostly water biome would otherwise vanish.
  if (ownBiome && profile?.shore) {
    // A shoreline biome: its land share becomes a direction (land toward
    // the land-heavy neighbours). Islands don't apply.
    placeShore({
      layout,
      parent: input.parent,
      cells,
      work,
      terrainAt,
      typeOf,
      profile,
      profiles,
      field,
      pinned,
      sharpness: sharp,
      seed: input.seed,
      context: ctx,
    });
  } else if (ownBiome && profile && (profile.minIslands || profile.landShare)) {
    const was = new Map(work);
    placeIslands({
      layout,
      cells,
      work,
      terrainAt,
      typeOf,
      profile,
      influence: (x, y) => field.at(x, y).get(ownBiome) ?? 0,
      ...(band ? { seamBand: band } : {}),
      rng: mulberry32(cellSeed(input.seed ^ 0x6a09e667, input.parent[0], input.parent[1])),
    });
    for (const k of own) if (work.get(k) !== was.get(k)) islandCells.add(k);
  }

  // 4. Min patches (the Mix table's column), after smoothing and islands:
  //    smoothing erases a type that's only a sprinkle (alpine peaks, a volcano).
  if (ownBiome && profile?.minPatches?.size) {
    placePatches({
      layout,
      cells,
      work,
      terrainAt,
      typeOf,
      profile,
      influence: (x, y) => field.at(x, y).get(ownBiome) ?? 0,
      // A patch type the neighbours have next door starts near it (a ridge carries on),
      // and a type the context pushed over its Mix share may be painted over.
      // The seam band keeps its land or water.
      ...(ctx ? { affinity: (type: string, x: number, y: number) => ctx.typeNear(x, y, type), overShare: true, ...(band ? { seamBand: band } : {}) } : {}),
      rng: mulberry32(cellSeed(input.seed ^ 0x3c6ef372, input.parent[0], input.parent[1])),
    });
  }

  // 5. The region keeps its own biome (owner 2026-10-12): next to made
  //    regions, its type shares are brought back toward its Mix, changing
  //    the cells farthest from the seams first; the seam band keeps its
  //    land and water and half its continued terrain. Shore biomes (their
  //    land follows the neighbours) are left as placed. No context:
  //    nothing changes.
  const keep = tuned(tuning, "keep-mix");
  if (ctx && profile && !profile.shore && keep > 0) {
    keepMix({
      layout,
      cells,
      work,
      terrainAt,
      typeOf,
      profile,
      pinned,
      strength: keep,
      bandKeep: tuned(tuning, "band-keep"),
      fixed: islandCells,
      namesAt,
      rng: mulberry32(cellSeed(input.seed ^ 0x510e527f, input.parent[0], input.parent[1])),
    });
  }

  const out = new Map<string, string>();
  for (const k of own) {
    const v = work.get(k);
    if (v) out.set(k, v);
  }
  return out;
}


// ── neighbour context ("super-region") ───────────────────────────────────

/** Context weight falls by e per cell step past the first (cells right by the seam weigh 1). */
const CONTEXT_FALLOFF = 1;
/** Context weights below this are skipped. */
const CONTEXT_MIN = 1e-3;
/** A made neighbour's land as seen from a cell: weights fall by e every this many steps. */
const SIDE_SCALE = 2;
/** Child cells are √3 apart in the child plane. */
const STEP = Math.sqrt(3);

interface ContextCell {
  key: string;
  /** Point in the child plane. */
  px: number;
  py: number;
  name: string;
  type?: string;
  /** Land (not a WATER_TYPES type); undefined for untyped terrain. */
  land?: boolean;
  /** Parent key of the region it belongs to. */
  region: string;
}

/**
 * The hexes already made around a region (its neighbours' cells within
 * `depth` steps of it, and its own locked cells), held fixed while it's
 * generated: one enlarged canvas, the region plus that margin. Each stage
 * reads it:
 *
 * - the type and name odds of a cell lean toward the context near it,
 *   W·Σk / (1 + W·Σk) of the way (W the biome's "neighbour influence", k
 *   falling by e per step from 1 by the seam, and all of it fading by e
 *   every "neighbour-fade" steps the cell is from the seam), so a forest, a
 *   coast or the sea carries on across the seam, fading a cell or two in
 *   (then keepMix brings the region back to its own Mix);
 * - smoothing reads the seam cells as neighbours (as before) and keeps the
 *   context's types where the leaned odds allow them;
 * - a shore biome reads each made neighbour's land near each cell (sideLand)
 *   instead of one share for its whole side;
 * - patches of a type the context has nearby may start by the seam.
 *
 * Only the region's own cells are ever written.
 */
export class NeighbourContext {
  private near = new Map<string, [ContextCell, number][]>();
  private byRegion = new Map<string, ContextCell[]>();

  /** `fade`: steps per e of the seam fade (around); 0: no fade. */
  constructor(readonly layout: RegionLayout, readonly cells: ContextCell[], readonly influence: number, readonly fade = 0) {
    for (const c of cells) {
      const list = this.byRegion.get(c.region);
      if (list) list.push(c);
      else this.byRegion.set(c.region, [c]);
    }
  }

  /**
   * Context cells near (x, y) with their weights. Every weight also fades
   * with the cell's distance from the seam (its nearest context cell), by e
   * every `fade` steps past the first: right by the seam the context counts
   * in full, a few cells in the region's own biome governs (owner
   * 2026-10-12: the region must still clearly be its own biome).
   */
  private around(x: number, y: number): [ContextCell, number][] {
    const key = `${x}_${y}`;
    let hit = this.near.get(key);
    if (hit) return hit;
    const [ax, ay] = childPoint(this.layout, x, y);
    const all: [ContextCell, number][] = [];
    let dmin = Infinity;
    for (const c of this.cells) {
      const d = Math.hypot(c.px - ax, c.py - ay) / STEP;
      if (d < dmin) dmin = d;
      all.push([c, d]);
    }
    const seam = this.fade > 0 ? Math.exp(-Math.max(0, dmin - 1) / this.fade) : 1;
    hit = [];
    for (const [c, d] of all) {
      const k = Math.exp(-Math.max(0, d - 1) / CONTEXT_FALLOFF) * seam;
      if (k >= CONTEXT_MIN) hit.push([c, k]);
    }
    this.near.set(key, hit);
    return hit;
  }

  /** Type odds at (x, y), leaned toward the context's types near it. */
  leanTypes(x: number, y: number, base: Map<string, number>): Map<string, number> {
    const by = new Map<string, number>();
    let mass = 0;
    for (const [c, k] of this.around(x, y)) {
      if (!c.type) continue;
      by.set(c.type, (by.get(c.type) ?? 0) + k);
      mass += k;
    }
    if (!mass) return base;
    const w = this.influence, den = 1 + w * mass;
    const out = new Map<string, number>();
    for (const [t, v] of base) out.set(t, (v + w * (by.get(t) ?? 0)) / den);
    for (const [t, s] of by) if (!out.has(t)) out.set(t, (w * s) / den);
    return out;
  }

  /** Name odds within `type` at (x, y), leaned toward the names the context uses for it nearby. */
  leanNames(x: number, y: number, type: string, base: Map<string, number>): Map<string, number> {
    const by = new Map<string, number>();
    let mass = 0;
    for (const [c, k] of this.around(x, y)) {
      if (c.type !== type) continue;
      by.set(c.name, (by.get(c.name) ?? 0) + k);
      mass += k;
    }
    if (!mass) return base;
    // An empty base (no biome here has the type) sums to 0: the context's names alone.
    let total = 0;
    for (const v of base.values()) total += v;
    const w = this.influence, den = total + w * mass;
    const out = new Map<string, number>();
    for (const [n, v] of base) out.set(n, (v + w * (by.get(n) ?? 0)) / den);
    for (const [n, s] of by) if (!out.has(n)) out.set(n, (w * s) / den);
    return out;
  }

  /** How much of `type` the context has near (x, y), 0..1 (its share of the leaned odds). */
  typeNear(x: number, y: number, type: string): number {
    let mass = 0, of = 0;
    for (const [c, k] of this.around(x, y)) {
      if (!c.type) continue;
      mass += k;
      if (c.type === type) of += k;
    }
    return mass ? (this.influence * of) / (1 + this.influence * mass) : 0;
  }

  /** Does the context hold cells of the region of parent hex `hex`? */
  hasRegion(hex: [number, number]): boolean {
    return this.byRegion.has(`${hex[0]}_${hex[1]}`);
  }

  /** The land values (0 / 1) a made neighbour's context cells take: [min, max]. */
  landRange(region: string): number[] {
    const vals = (this.byRegion.get(region) ?? []).filter((c) => c.land !== undefined).map((c) => (c.land ? 1 : 0));
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [];
  }

  /**
   * A made neighbour's land as seen from own cell (x, y): its context
   * cells' land, nearest weighing most, mixed with its whole-region share
   * (`share`) by the influence (1 or more: the local land alone).
   */
  sideLand(region: string, x: number, y: number, share: number): number {
    const list = this.byRegion.get(region);
    if (!list) return share;
    const [ax, ay] = childPoint(this.layout, x, y);
    let sw = 0, sl = 0;
    for (const c of list) {
      if (c.land === undefined) continue;
      const w = Math.exp(-(Math.hypot(c.px - ax, c.py - ay) / STEP) / SIDE_SCALE);
      sw += w;
      if (c.land) sl += w;
    }
    if (!sw) return share;
    const a = Math.min(1, this.influence);
    return (1 - a) * share + a * (sl / sw);
  }
}

/**
 * The context of a region being generated (NeighbourContext): pinned cells
 * (made neighbours, locked own cells) within `depth` steps of its own
 * cells. Undefined when there are none, or `depth` or `influence` is 0
 * (then generation is exactly what it was without context).
 */
export function neighbourContext(
  layout: RegionLayout,
  cells: [number, number][],
  pinned: ReadonlyMap<string, string>,
  typeOf: (terrain: string) => string | undefined,
  depth: number,
  influence: number,
  /** The seam fade (NeighbourContext.around): steps per e; 0, none. */
  fade = 0,
): NeighbourContext | undefined {
  if (!(depth > 0) || !(influence > 0) || !pinned.size || !cells.length) return undefined;
  const water = new Set(WATER_TYPES);
  const seen = new Set(cells.map(([x, y]) => `${x}_${y}`));
  const out: ContextCell[] = [];
  let ring = cells;
  for (let d = 1; d <= depth && ring.length; d++) {
    const next: [number, number][] = [];
    for (const [x, y] of ring) {
      for (const [a, b] of childNeighbours(layout, x, y)) {
        const k = `${a}_${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push([a, b]);
        const name = pinned.get(k);
        if (name === undefined) continue;
        const type = typeOf(name);
        const [px, py] = childPoint(layout, a, b);
        out.push({ key: k, px, py, name, region: parentOf(layout, a, b).join("_"), ...(type ? { type, land: !water.has(type) } : {}) });
      }
    }
    ring = next;
  }
  return out.length ? new NeighbourContext(layout, out, influence, fade) : undefined;
}

export interface SeamContinuity {
  /** The region's own cells next to a made neighbour's cell. */
  edge: number;
  /** Of those, the ones whose land/water class matches the neighbour across the seam. */
  matched: number;
  share: number;
}

/**
 * How well a region continues its made neighbours: of its own cells next to
 * a neighbour's (pinned) cell, the share whose land/water class matches the
 * cells across the seam (their majority; a tie matches either). Untyped
 * terrain doesn't count.
 */
export function seamContinuity(
  layout: RegionLayout,
  parent: [number, number],
  own: ReadonlyMap<string, string>,
  pinned: ReadonlyMap<string, string>,
  typeOf: (terrain: string) => string | undefined,
): SeamContinuity {
  const water = new Set(WATER_TYPES);
  const cls = (t: string | undefined): number | undefined => {
    const ty = t ? typeOf(t) : undefined;
    return ty === undefined ? undefined : water.has(ty) ? 0 : 1;
  };
  const home = `${parent[0]}_${parent[1]}`;
  let edge = 0, matched = 0;
  for (const [k, t] of own) {
    const mine = cls(t);
    if (mine === undefined) continue;
    const [x, y] = k.split("_").map(Number);
    let land = 0, wet = 0;
    for (const [a, b] of childNeighbours(layout, x, y)) {
      if (parentOf(layout, a, b).join("_") === home) continue;
      const c = cls(pinned.get(`${a}_${b}`));
      if (c === 1) land++;
      else if (c === 0) wet++;
    }
    if (!land && !wet) continue;
    edge++;
    if ((mine === 1 && land >= wet) || (mine === 0 && wet >= land)) matched++;
  }
  return { edge, matched, share: edge ? matched / edge : 1 };
}

interface IslandInput {
  layout: RegionLayout;
  /** The region's own (unpinned) cells: the only cells changed. */
  cells: [number, number][];
  /** Terrain being generated; own cells are rewritten in place. */
  work: Map<string, string>;
  /** Terrain of any cell (own, halo, pinned), reading `work` first. */
  terrainAt: (key: string) => string | undefined;
  typeOf: (terrain: string) => string | undefined;
  /** The region's own biome (its landShare / minIslands, and its land types and names). */
  profile: BiomeProfile;
  /** The region biome's share of the field at a cell (islands go where it is strongest). */
  influence: (x: number, y: number) => number;
  /** Own cells next to a made neighbour: no island (or its shore) is put there, the seam carries the neighbour on. */
  seamBand?: ReadonlySet<string>;
  rng: () => number;
}

/**
 * Islands for watery biomes (BiomeInfo.landShare / minIslands). Smoothing
 * pulls every cell toward the majority type, so scattered land in a mostly
 * water biome would vanish; this runs after it.
 *
 * Land is any typed terrain whose type isn't in WATER_TYPES. Islands that
 * already lie wholly inside the region count (a coast running in from a
 * neighbour doesn't). New islands are grown from cells where the biome is
 * strongest, a cell apart from other land, until the region has
 * `minIslands` islands and `landShare` of its cells are land. Each island
 * is one of the biome's land types (by its shares) and gets a ring of each
 * SHORE_TYPES type the biome has. Islands stay small (each covers at most a
 * quarter of the region split between `minIslands`, its beach included,
 * though never less than one core hex), and a region too small for `minIslands`
 * still gets as many as fit, at least one when it has any free cell.
 */
export function placeIslands(input: IslandInput): void {
  const { layout, work, terrainAt, typeOf, profile, rng } = input;
  const t: BiomeTuning | undefined = profile.tuning;
  const beachCover = tuned(t, "beach");
  const edgeShy = tuned(t, "island-edge");
  const minIslands = Math.max(0, Math.floor(profile.minIslands ?? 0));
  const landShare = Math.min(1, Math.max(0, profile.landShare ?? 0));
  if (!minIslands && !landShare) return;
  const water = new Set(WATER_TYPES);
  const cores = new Map([...profile.types].filter(([t, s]) => s > 0 && !water.has(t) && !SHORE_TYPES.includes(t) && t !== "settlement"));
  if (!cores.size) return;
  const own = new Set(input.cells.map(([x, y]) => `${x}_${y}`));
  const ownList = [...own].sort();
  const n = own.size;
  if (!n) return;
  const nbrs = (k: string): string[] => {
    const [x, y] = k.split("_").map(Number);
    return childNeighbours(layout, x, y).map(([a, b]) => `${a}_${b}`);
  };
  const isLand = (k: string) => {
    const t = terrainAt(k);
    const ty = t ? typeOf(t) : undefined;
    return ty !== undefined && !water.has(ty);
  };
  const nameOf = (type: string): string | undefined => {
    const names = profile.names.get(type);
    return names?.size ? pick(names, rng()) : undefined;
  };

  // Islands already wholly inside the region, and the land there.
  let have = 0;
  const seen = new Set<string>();
  for (const k of ownList) {
    if (seen.has(k) || !isLand(k)) continue;
    let inside = true;
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop()!;
      for (const m of nbrs(c)) {
        if (!isLand(m)) continue;
        if (!own.has(m)) { inside = false; continue; }
        if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
    }
    if (inside) have++;
  }
  const landCount = () => ownList.filter(isLand).length;
  const landTarget = Math.round(landShare * n);

  const maxSize = Math.max(1, Math.floor((n * tuned(t, "island-max")) / Math.max(1, minIslands)));
  // Shore rings that are land (a beach) count toward an island's size: the
  // leading SHORE_TYPES the biome has, up to the first water one.
  let landRings = 0;
  for (const shore of SHORE_TYPES) {
    if (!profile.names.get(shore)?.size) continue;
    if (water.has(shore)) break;
    landRings++;
  }
  const taken = new Set<string>();
  // The seam band is kept clear, unless the region is all band (a tiny one).
  const band = input.seamBand && ownList.some((k) => !input.seamBand!.has(k)) ? input.seamBand : undefined;
  const free = (k: string) => own.has(k) && !taken.has(k) && !isLand(k) && !band?.has(k);
  /** Land an island will cover once its land shore rings are on (own cells only). */
  const footprint = (island: Set<string>): number => {
    const all = new Set(island);
    let ring = [...island], size = island.size;
    for (let i = 0; i < landRings; i++) {
      ring = [...new Set(ring.flatMap(nbrs))].filter((k) => free(k) && !all.has(k));
      for (const k of ring) all.add(k);
      size += ring.length * beachCover;
    }
    return size;
  };
  for (let guard = 0; guard < n && (have < minIslands || landCount() < landTarget); guard++) {
    // Seed: a free cell with no land next to it, best where the biome is strongest and away from the edge.
    let start: string | undefined, best = -1;
    for (const k of ownList) {
      if (!free(k)) continue;
      const around = nbrs(k);
      if (around.some(isLand)) continue;
      const [x, y] = k.split("_").map(Number);
      const score = (input.influence(x, y) + 0.05) * (around.every((m) => own.has(m)) ? 1 : edgeShy) * (0.5 + rng());
      if (score > best) { best = score; start = k; }
    }
    if (!start) break;
    const remaining = landTarget - landCount();
    const toAdd = Math.max(1, minIslands - have);
    const want = remaining > 0 ? (remaining / toAdd) * (0.7 + 0.6 * rng()) : 2 + rng() * 2;
    const size = Math.max(1, Math.min(maxSize, Math.round(want)));
    const type = pick(cores, rng())!;
    const island = new Set<string>();
    const add = (k: string) => {
      work.set(k, nameOf(type)!);
      island.add(k);
      taken.add(k);
    };
    add(start);
    while (footprint(island) < size) {
      // Grow onto a free cell that touches no land but this island.
      const options = [...new Set([...island].flatMap(nbrs))].filter((k) => free(k) && nbrs(k).every((m) => island.has(m) || !isLand(m))).sort();
      if (!options.length) break;
      add(options[Math.floor(rng() * options.length)]);
    }
    // Shore rings, inner first, for the shore types the biome has. A land
    // ring (a beach) is ragged: it covers only part of the shore, and the
    // next ring fills the gaps, so islands aren't all ringed alike.
    const shoreSoFar = new Set(island);
    for (const shore of SHORE_TYPES) {
      if (!profile.names.get(shore)?.size) continue;
      const next = [...new Set([...shoreSoFar].flatMap(nbrs))].filter(free).sort();
      const ragged = !water.has(shore);
      next.forEach((k, i) => {
        if (ragged && i > 0 && rng() >= beachCover) return;
        work.set(k, nameOf(shore)!);
        taken.add(k);
        shoreSoFar.add(k);
      });
    }
    have++;
  }
}

interface PatchInput {
  layout: RegionLayout;
  /** The region's own (unpinned) cells: the only cells changed. */
  cells: [number, number][];
  work: Map<string, string>;
  terrainAt: (key: string) => string | undefined;
  typeOf: (terrain: string) => string | undefined;
  /** The region's own biome: its minPatches, shares and names. */
  profile: BiomeProfile;
  /** The region biome's share of the field at a cell (patches go where it is strongest). */
  influence: (x: number, y: number) => number;
  /** Extra seed score for a type at a cell: how much of it the neighbours' context has nearby. */
  affinity?: (type: string, x: number, y: number) => number;
  /** A cell of a type with its own minimum may be painted over while that type is over its Mix share. */
  overShare?: boolean;
  /** Own cells next to a pinned cell: a patch never turns one from land into water or back (a coastline carries on). */
  seamBand?: ReadonlySet<string>;
  rng: () => number;
}

/**
 * Min patches per type (the biome note's Mix "Min patches" column): after
 * smoothing, a type the biome has only a little of (alpine peaks, a
 * volcano) is usually washed out. For each such type (in type order), the
 * patches already inside the region are counted, and new ones grown from
 * free cells where the biome is strongest (away from the edge, not
 * touching that type) until there are enough. A patch is about the type's
 * share of the region split between its patches, never over a quarter of
 * it. Only the region's own cells change; cells of a type that has its
 * own minimum are never painted over, unless `overShare` and that type
 * has more of the region than its Mix share (neighbours' forest filling an
 * Alpine region leaves its peaks room). Deterministic for a seed.
 */
export function placePatches(input: PatchInput): void {
  const { layout, work, terrainAt, typeOf, profile, rng } = input;
  const t: BiomeTuning | undefined = profile.tuning;
  const sizeMul = tuned(t, "patch-size");
  const maxShare = tuned(t, "patch-max");
  const edgeShy = tuned(t, "patch-edge");
  const wants = [...(profile.minPatches ?? [])].filter(([t, n]) => n > 0 && profile.names.get(t)?.size).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!wants.length) return;
  const own = new Set(input.cells.map(([x, y]) => `${x}_${y}`));
  const ownList = [...own].sort();
  const n = ownList.length;
  if (!n) return;
  const protectedTypes = new Set(wants.map(([t]) => t));
  const water = new Set(WATER_TYPES);
  const nbrs = (k: string): string[] => {
    const [x, y] = k.split("_").map(Number);
    return childNeighbours(layout, x, y).map(([a, b]) => `${a}_${b}`);
  };
  const typeAt = (k: string) => {
    const t = terrainAt(k);
    return t ? typeOf(t) : undefined;
  };
  const taken = new Set<string>();
  // Own cells per type, kept current, for `overShare`.
  const count = new Map<string, number>();
  if (input.overShare) for (const k of ownList) { const ty = typeAt(k); if (ty) count.set(ty, (count.get(ty) ?? 0) + 1); }
  let mixTotal = 0;
  for (const v of profile.types.values()) mixTotal += v;
  const over = (ty: string) => !!input.overShare && mixTotal > 0 && (count.get(ty) ?? 0) - 1 >= ((profile.types.get(ty) ?? 0) / mixTotal) * n;
  const paint = (k: string, name: string) => {
    if (input.overShare) {
      const was = typeAt(k);
      if (was) count.set(was, (count.get(was) ?? 0) - 1);
      const now = typeOf(name);
      if (now) count.set(now, (count.get(now) ?? 0) + 1);
    }
    work.set(k, name);
  };
  for (const [type, min] of wants) {
    // Patches of this type already in the region (own cells only).
    const seen = new Set<string>();
    let have = 0;
    for (const k of ownList) {
      if (seen.has(k) || typeAt(k) !== type) continue;
      have++;
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        for (const m of nbrs(stack.pop()!)) {
          if (own.has(m) && !seen.has(m) && typeAt(m) === type) { seen.add(m); stack.push(m); }
        }
      }
    }
    const free = (k: string) => {
      if (!own.has(k) || taken.has(k)) return false;
      const ty = typeAt(k) ?? "";
      if (input.seamBand?.has(k) && water.has(ty) !== water.has(type)) return false;
      return !protectedTypes.has(ty) || (ty !== type && over(ty));
    };
    const share = profile.types.get(type) ?? 0;
    const size = Math.max(1, Math.min(Math.round(((share * n) / min) * sizeMul), Math.floor((n * maxShare) / min)));
    const names = profile.names.get(type)!;
    for (let guard = 0; guard < n && have < min; guard++) {
      let start: string | undefined, best = -1;
      for (const k of ownList) {
        if (!free(k)) continue;
        const around = nbrs(k);
        if (around.some((m) => typeAt(m) === type)) continue;
        const [x, y] = k.split("_").map(Number);
        const near = input.affinity ? input.affinity(type, x, y) : 0;
        // Next to the same type in a neighbour, the edge is no reason to stay away.
        const shy = around.every((m) => own.has(m)) ? 1 : edgeShy + (1 - edgeShy) * Math.min(1, near);
        const score = (input.influence(x, y) + 0.05 + near) * shy * (0.5 + rng());
        if (score > best) { best = score; start = k; }
      }
      if (!start) break;
      const patch = new Set<string>();
      const add = (k: string) => {
        paint(k, pick(names, rng())!);
        patch.add(k);
        taken.add(k);
      };
      add(start);
      while (patch.size < size) {
        // Grow onto a free cell that touches no other patch of this type.
        const options = [...new Set([...patch].flatMap(nbrs))].filter((k) => free(k) && nbrs(k).every((m) => patch.has(m) || typeAt(m) !== type)).sort();
        if (!options.length) break;
        add(options[Math.floor(rng() * options.length)]);
      }
      have++;
    }
  }
}

interface KeepMixInput {
  layout: RegionLayout;
  /** The region's own (unpinned) cells: the only cells changed. */
  cells: [number, number][];
  work: Map<string, string>;
  terrainAt: (key: string) => string | undefined;
  typeOf: (terrain: string) => string | undefined;
  /** The region's own biome: its Mix (types), names and min patches. */
  profile: BiomeProfile;
  /** Made neighbours' cells and locked own cells: the seam is next to them. */
  pinned: ReadonlyMap<string, string>;
  /** Cells never changed (the islands placeIslands made). */
  fixed?: ReadonlySet<string>;
  /** 0..1: how far toward the Mix (tuned "keep-mix"). */
  strength: number;
  /** 0..1: share of the seam band kept on the type across the seam (tuned "band-keep"; default BAND_KEEP). */
  bandKeep?: number;
  /** Name odds within a type at a cell (the field's, leaned to the context's names). */
  namesAt: (x: number, y: number, type: string) => Map<string, number>;
  rng: () => number;
}

/** Own cells next to a pinned cell (a made neighbour's, or a locked own one): the seam band. */
function seamBand(layout: RegionLayout, cells: [number, number][], pinned: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [x, y] of cells) if (childNeighbours(layout, x, y).some(([a, b]) => pinned.has(`${a}_${b}`))) out.add(`${x}_${y}`);
  return out;
}

/** Share of the seam band keepMix leaves carrying on the type across the seam, unless tuned ("band-keep"). */
const BAND_KEEP = 0.5;

/**
 * Bring a region's terrain-type shares back toward its biome's Mix after
 * the neighbours' context leaned on it (owner 2026-10-12: "new regions mesh
 * with their neighbours at the seams, but the region must still clearly be
 * its own biome"). Each type's target is its Mix share (land and water
 * split by the biome's land share when it has one), moved `strength` of
 * the way from what the region has. Then, one cell at a time, the type
 * most under its target takes a cell of a type over its target, the one
 * farthest from the seams and next to that type already (so it grows in
 * clumps). Never: a `fixed` cell (islands), a coast or shallows cell, the
 * last cell of a min-patches patch; land into water or back on the
 * region's edge (a coastline carries on across the seam, and the edges not
 * made yet keep theirs for later); new land in an island biome; and the
 * seam band (own cells next to a pinned one) keeps at least BAND_KEEP of
 * its cells on the type across the seam, so the neighbours' terrain still
 * runs in. Deterministic for a seed.
 */
export function keepMix(input: KeepMixInput): void {
  const { layout, work, typeOf, profile, pinned, rng } = input;
  const strength = Math.min(1, Math.max(0, input.strength));
  if (!strength) return;
  const water = new Set(WATER_TYPES);
  const shore = new Set(SHORE_TYPES);
  const ownList = input.cells.map(([x, y]) => `${x}_${y}`).sort();
  const own = new Set(ownList);
  const nbrs = (k: string): string[] => {
    const [x, y] = k.split("_").map(Number);
    return childNeighbours(layout, x, y).map(([a, b]) => `${a}_${b}`);
  };
  const typeAt = (k: string) => {
    const t = input.terrainAt(k);
    return t ? typeOf(t) : undefined;
  };
  // Steps from the seam, through own cells: 1 next to a pinned cell.
  const dist = new Map<string, number>();
  let ring = ownList.filter((k) => nbrs(k).some((m) => pinned.has(m)));
  for (const k of ring) dist.set(k, 1);
  for (let d = 2; ring.length; d++) {
    const next: string[] = [];
    for (const k of ring) for (const m of nbrs(k)) if (own.has(m) && !dist.has(m)) { dist.set(m, d); next.push(m); }
    ring = next;
  }
  const FAR = 8;
  const distOf = (k: string) => Math.min(FAR, dist.get(k) ?? FAR);
  // The seam band: each band cell's type across the seam (the pinned
  // neighbours' most common). At least BAND_KEEP of the band keeps
  // matching it, so the neighbours' terrain still runs in at the seam.
  const across = new Map<string, string>();
  for (const k of ownList) {
    if (dist.get(k) !== 1) continue;
    const by = new Map<string, number>();
    for (const m of nbrs(k)) {
      const t = pinned.get(m);
      const ty = t ? typeOf(t) : undefined;
      if (ty) by.set(ty, (by.get(ty) ?? 0) + 1);
    }
    const top = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (top) across.set(k, top[0]);
  }
  let bandMatch = 0;
  for (const [k, ty] of across) if (typeAt(k) === ty) bandMatch++;
  const bandKeep = Math.min(1, Math.max(0, input.bandKeep ?? BAND_KEEP));
  const bandFloor = Math.ceil(across.size * bandKeep);

  // Counts and targets, land and water apart. Shore types and untyped or
  // non-Mix-side cells (settlements) aren't counted and never change.
  const counts = new Map<string, number>();
  const sideN = [0, 0];
  const side = (ty: string) => (water.has(ty) ? 1 : 0);
  const counted = (ty: string | undefined): ty is string => ty !== undefined && !shore.has(ty) && ty !== "settlement";
  for (const k of ownList) {
    const ty = typeAt(k);
    if (!counted(ty)) continue;
    counts.set(ty, (counts.get(ty) ?? 0) + 1);
    sideN[side(ty)]++;
  }
  const sideMix = [0, 0];
  for (const [ty, v] of profile.types) if (counted(ty)) sideMix[side(ty)] += v;
  if (!sideMix[0] && !sideMix[1]) return;
  // How many cells each side wants: the biome's land share (islands), else
  // its Mix's. A land share with no Mix type on one side keeps the sides.
  const total = sideN[0] + sideN[1];
  const land = profile.landShare ?? sideMix[0] / (sideMix[0] + sideMix[1]);
  const keepSides = profile.landShare !== undefined && (!sideMix[0] || !sideMix[1]);
  const sideWant = keepSides ? sideN : [total * land, total * (1 - land)];
  const target = new Map<string, number>();
  for (const ty of new Set([...counts.keys(), ...profile.types.keys()])) {
    if (!counted(ty)) continue;
    const s = side(ty);
    const full = sideMix[s] > 0 ? (sideWant[s] * (profile.types.get(ty) ?? 0)) / sideMix[s] : 0;
    const now = counts.get(ty) ?? 0;
    target.set(ty, now + strength * (full - now));
  }
  const surplus = (ty: string) => (counts.get(ty) ?? 0) - (target.get(ty) ?? 0);
  // Island biomes: their islands are placeIslands' (never added or taken here).
  const islandy = profile.landShare !== undefined || !!profile.minIslands;
  const blocked = new Set<string>();
  for (let guard = 0; guard < ownList.length * 2; guard++) {
    const under = [...target.keys()]
      .filter((ty) => !blocked.has(ty) && profile.names.get(ty)?.size && -surplus(ty) >= 0.5)
      .sort((a, b) => surplus(a) - surplus(b) || (a < b ? -1 : 1));
    const u = under[0];
    if (u === undefined) break;
    let best: string | undefined, bestScore = -Infinity;
    for (const k of ownList) {
      if (input.fixed?.has(k)) continue;
      const ty = typeAt(k);
      if (!counted(ty) || ty === u || surplus(ty) < 0.5) continue;
      if (side(ty) !== side(u)) {
        // Only a cell inside the region turns land into water or back: the
        // seam band keeps carrying a coastline on, and the region's other
        // edges keep theirs for the regions made next to them later.
        if (!nbrs(k).every((m) => own.has(m))) continue;
        // An island biome gets no new land here: only land run in from the neighbours may turn to water.
        if (islandy && side(ty) !== 0) continue;
      }
      // A band cell that carries on its neighbour's type only while the band keeps enough of those.
      if (across.get(k) === ty && bandMatch <= bandFloor) continue;
      const around = nbrs(k);
      // The last cell of a patch of a min-patches type stays.
      if (profile.minPatches?.get(ty) && !around.some((m) => own.has(m) && typeAt(m) === ty)) continue;
      const next = around.filter((m) => typeAt(m) === u).length;
      const score = 2 * next + distOf(k) + 0.5 * rng();
      if (score > bestScore) { bestScore = score; best = k; }
    }
    if (!best) { blocked.add(u); continue; }
    // The name the neighbouring cells of that type use, else one the field (or the Mix) gives.
    const byName = new Map<string, number>();
    for (const m of nbrs(best)) {
      const t = input.terrainAt(m);
      if (t && typeOf(t) === u) byName.set(t, (byName.get(t) ?? 0) + 1);
    }
    const [x, y] = best.split("_").map(Number);
    let name = byName.size ? [...byName].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : undefined;
    if (!name) {
      const field = input.namesAt(x, y, u);
      name = pick(field.size ? field : profile.names.get(u)!, rng());
    }
    if (!name) { blocked.add(u); continue; }
    const was = typeAt(best)!;
    if (across.get(best) === was) bandMatch--;
    else if (across.get(best) === u) bandMatch++;
    counts.set(was, (counts.get(was) ?? 0) - 1);
    counts.set(u, (counts.get(u) ?? 0) + 1);
    work.set(best, name);
  }
}

interface ShoreInput {
  layout: RegionLayout;
  parent: [number, number];
  /** The region's own (unpinned) cells: the only cells changed. */
  cells: [number, number][];
  work: Map<string, string>;
  terrainAt: (key: string) => string | undefined;
  typeOf: (terrain: string) => string | undefined;
  /** The region's own (shore) biome. */
  profile: BiomeProfile;
  profiles: ReadonlyMap<BiomeId, BiomeProfile>;
  field: BlendField;
  pinned: ReadonlyMap<string, string>;
  sharpness: number;
  seed: number;
  /** The neighbours' hexes as context (neighbourContext): each made neighbour's land is read near each cell. */
  context?: NeighbourContext;
}

// How sharply a cell leans toward the neighbour it faces (exp(lean · projection),
// as in hex-wfc's directional blend), the coastline's raggedness and the coast
// band's depth are the biome's tuning: "shore-lean" 1.6, "shore-ragged" 0.12,
// "coast-width" 1 (biomeTuning.ts).

/** Land share of a biome profile: its landShare, else its non-water type shares. */
function profileLand(p: BiomeProfile | undefined): number | undefined {
  if (!p) return undefined;
  if (p.landShare !== undefined) return p.landShare;
  let land = 0;
  for (const [t, v] of p.types) if (!WATER_TYPES.includes(t)) land += v;
  return land;
}

/**
 * Each neighbouring region's land share, by parent hex: from its cells
 * already painted (pinned) when there are some, else from its biome's mix.
 */
export function neighbourLand(
  layout: RegionLayout,
  parent: [number, number],
  pinned: ReadonlyMap<string, string>,
  biomes: ReadonlyMap<string, BiomeId>,
  profiles: ReadonlyMap<BiomeId, BiomeProfile>,
  typeOf: (terrain: string) => string | undefined,
): { hex: [number, number]; land: number }[] {
  const painted = new Map<string, { land: number; all: number }>();
  for (const [k, t] of pinned) {
    const [x, y] = k.split("_").map(Number);
    const pk = parentOf(layout, x, y).join("_");
    const ty = typeOf(t);
    if (!ty) continue;
    const c = painted.get(pk) ?? { land: 0, all: 0 };
    c.all++;
    if (!WATER_TYPES.includes(ty)) c.land++;
    painted.set(pk, c);
  }
  const out: { hex: [number, number]; land: number }[] = [];
  for (const [qx, qy] of neighbourRegions(layout, parent[0], parent[1])) {
    const pk = `${qx}_${qy}`;
    const c = painted.get(pk);
    if (c && c.all >= 3) { out.push({ hex: [qx, qy], land: c.land / c.all }); continue; }
    const b = biomes.get(pk);
    const land = profileLand(b ? profiles.get(b) : undefined);
    if (land !== undefined) out.push({ hex: [qx, qy], land });
  }
  return out;
}

/**
 * A shoreline region (a biome with `shore`): the region's land goes toward
 * its land-heavy neighbours and its water toward the others, with a coast
 * band between.
 *
 * 1. Each neighbouring region's land share (neighbourLand). Each own cell's
 *    landness is those shares weighted by exp(1.6 · projection) of the cell
 *    onto the direction of each neighbour (hex-wfc's directional blend), so
 *    a cell leans toward the neighbour it faces; plus a little smooth noise
 *    so the coastline is ragged.
 * 2. With no land neighbour to lean on (all within 0.15 of each other, or
 *    none known), one side picked from the seed is made land (a mostly
 *    water neighbourhood) or water (a mostly land one): a water region
 *    with a ragged coast along that side, never an island.
 * 3. The most landward cells become land: the biome's land-share when set,
 *    else the mean landness (between 15% and 85%).
 * 4. Land cells next to water take the biome's land shore type (coast),
 *    water cells next to land its water one (shallows); other land cells
 *    keep a land terrain or take one from the field (so they look like the
 *    land neighbour); other water cells likewise.
 *
 * Only the region's own cells change. Deterministic for a seed.
 */
export function placeShore(input: ShoreInput): void {
  const { layout, parent, work, terrainAt, typeOf, profile, profiles, field } = input;
  const lean = tuned(profile.tuning, "shore-lean");
  const ragged = tuned(profile.tuning, "shore-ragged");
  const coastWidth = tuned(profile.tuning, "coast-width");
  const own = new Set(input.cells.map(([x, y]) => `${x}_${y}`));
  const ownList = [...own].sort();
  if (!ownList.length) return;
  const water = new Set(WATER_TYPES);
  const isWaterType = (t: string | undefined) => t !== undefined && water.has(t);

  // 1–2. Neighbours and their land.
  const sides = neighbourLand(layout, parent, input.pinned, field.biomes, profiles, typeOf);
  const [cx, cy] = regionCentrePoint(layout, parent[0], parent[1]);
  // A neighbour already made is read where it is near each cell (its real
  // land and water by the seam), not as one share for its whole side: a
  // coast whose land is on its right continues on the right (owner 2026-10-12).
  const ctx = input.context;
  const dirs: { ux: number; uy: number; land: number; local?: string }[] = sides.map((s) => {
    const [qx, qy] = regionCentrePoint(layout, s.hex[0], s.hex[1]);
    const len = Math.hypot(qx - cx, qy - cy) || 1;
    const local = ctx?.hasRegion(s.hex) ? `${s.hex[0]}_${s.hex[1]}` : undefined;
    return { ux: (qx - cx) / len, uy: (qy - cy) / len, land: s.land, ...(local ? { local } : {}) };
  });
  const lands = dirs.flatMap((d) => {
    const range = d.local ? ctx!.landRange(d.local) : [];
    return range.length ? range : [d.land];
  });
  if (!dirs.length || Math.max(...lands) - Math.min(...lands) < 0.15) {
    const mean = lands.length ? lands.reduce((a, b) => a + b, 0) / lands.length : 0;
    const all = neighbourRegions(layout, parent[0], parent[1]);
    // The made side is known: the side picked is one that isn't made yet, when there is one.
    const open = ctx ? all.filter((h) => !ctx.hasRegion(h)) : all;
    const from = open.length ? open : all;
    const pickHex = from[Math.floor(hash2(input.seed >>> 0, parent[0], parent[1]) * from.length) % from.length];
    const [qx, qy] = regionCentrePoint(layout, pickHex[0], pickHex[1]);
    const len = Math.hypot(qx - cx, qy - cy) || 1;
    const towardLand = mean < 0.5;
    if (!dirs.length) {
      // Nothing known around: water everywhere but the one land side.
      for (const [ax, ay] of all) {
        if (ax === pickHex[0] && ay === pickHex[1]) continue;
        const [bx, by] = regionCentrePoint(layout, ax, ay);
        const l = Math.hypot(bx - cx, by - cy) || 1;
        dirs.push({ ux: (bx - cx) / l, uy: (by - cy) / l, land: 0 });
      }
    }
    dirs.push({ ux: (qx - cx) / len, uy: (qy - cy) / len, land: towardLand ? 1 : 0 });
  }

  const radius = regionSpacing(layout) / 2 || 1;
  const f = 1.4 / (radius * 2);
  const landness = new Map<string, number>();
  for (const k of ownList) {
    const [x, y] = k.split("_").map(Number);
    const [px, py] = childPoint(layout, x, y);
    const vx = (px - cx) / radius, vy = (py - cy) / radius;
    let sw = 0, sl = 0;
    for (const d of dirs) {
      const w = Math.exp(lean * (vx * d.ux + vy * d.uy));
      sw += w;
      sl += w * (d.local ? ctx!.sideLand(d.local, x, y, d.land) : d.land);
    }
    const noise = (fbm((input.seed ^ 0x51ed) >>> 0, px * f, py * f, 2) - 0.5) * 2 * ragged;
    landness.set(k, sl / sw + noise);
  }

  // 3. The most landward cells are land.
  const mean = ownList.reduce((s, k) => s + landness.get(k)!, 0) / ownList.length;
  const target = profile.landShare ?? Math.min(0.85, Math.max(0.15, mean));
  const order = [...ownList].sort((a, b) => landness.get(b)! - landness.get(a)! || (a < b ? -1 : 1));
  const landCount = Math.round(target * ownList.length);
  const isLandCell = new Map(order.map((k, i) => [k, i < landCount]));

  // 4. Terrain for each cell.
  const rng = mulberry32(cellSeed(input.seed ^ 0x1f83d9ab, parent[0], parent[1]));
  const nbrs = (k: string): string[] => {
    const [x, y] = k.split("_").map(Number);
    return childNeighbours(layout, x, y).map(([a, b]) => `${a}_${b}`);
  };
  /** Is a neighbouring cell land? Own cells by the plan, others by their terrain. */
  const landAt = (k: string): boolean | undefined => {
    if (isLandCell.has(k)) return isLandCell.get(k);
    const t = terrainAt(k);
    const ty = t ? typeOf(t) : undefined;
    return ty === undefined ? undefined : !water.has(ty);
  };
  const has = (type: string) => !!profile.names.get(type)?.size;
  const landShore = SHORE_TYPES.find((t) => !water.has(t) && has(t));
  const waterShore = SHORE_TYPES.find((t) => water.has(t) && has(t));
  const shoreSet = new Set(SHORE_TYPES);
  const nameFor = (k: string, wantLand: boolean): string | undefined => {
    const [x, y] = k.split("_").map(Number);
    const phi = field.zoned(x, y);
    const ok = (t: string) => t !== "settlement" && !shoreSet.has(t) && (wantLand ? !water.has(t) : water.has(t));
    let odds = new Map([...typeMix(phi, profiles)].filter(([t]) => ok(t)));
    if (!odds.size) odds = new Map([...profile.types].filter(([t]) => ok(t)));
    if (!odds.size) {
      const fallback = wantLand ? landShore : waterShore;
      return fallback ? pick(profile.names.get(fallback)!, rng()) : undefined;
    }
    const type = pick(odds, rng())!;
    const names = namesWithinType(phi, profiles, type, input.sharpness);
    return pick(names.size ? names : profile.names.get(type) ?? new Map<string, number>(), rng());
  };
  // Cells in the coast band: next to the other side (width 1), or within
  // coastWidth steps of it through the region's own cells.
  const inBand = coastBand(ownList, nbrs, landAt, isLandCell, coastWidth);
  for (const k of ownList) {
    const land = isLandCell.get(k)!;
    const cur = work.get(k);
    const curType = cur ? typeOf(cur) : undefined;
    let next: string | undefined;
    if (land && landShore && inBand.has(k)) next = curType === landShore ? cur : pick(profile.names.get(landShore)!, rng());
    else if (!land && waterShore && inBand.has(k)) next = curType === waterShore ? cur : pick(profile.names.get(waterShore)!, rng());
    else if (curType !== undefined && !shoreSet.has(curType) && curType !== "settlement" && isWaterType(curType) === !land) next = cur;
    else next = nameFor(k, land);
    if (next) work.set(k, next);
  }
}

/**
 * Own cells within `width` steps of the other side of the coastline: a land
 * cell with water next to it (or a water cell with land) is step 1, as
 * before tuning; wider bands grow inward through own cells of the same side.
 */
function coastBand(
  ownList: string[],
  nbrs: (k: string) => string[],
  landAt: (k: string) => boolean | undefined,
  isLandCell: ReadonlyMap<string, boolean>,
  width: number,
): Set<string> {
  const band = new Set<string>();
  let ring: string[] = [];
  for (const k of ownList) {
    const land = isLandCell.get(k)!;
    if (nbrs(k).some((m) => landAt(m) === !land)) { band.add(k); ring.push(k); }
  }
  for (let d = 2; d <= width; d++) {
    const next: string[] = [];
    for (const k of ring) {
      const land = isLandCell.get(k)!;
      for (const m of nbrs(k)) {
        if (band.has(m) || isLandCell.get(m) !== land) continue;
        band.add(m);
        next.push(m);
      }
    }
    ring = next.sort();
  }
  return band;
}

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

/**
 * A region's biome identity: how far its terrain-type shares are from its
 * biome's Mix, as half the summed share differences (0: exactly the Mix,
 * 1: no type in common). Untyped cells don't count.
 */
export function mixDistance(cells: ReadonlyMap<string, string>, profile: BiomeProfile, typeOf: (t: string) => string | undefined): number {
  const n = new Map<string, number>();
  let all = 0;
  for (const t of cells.values()) {
    const ty = typeOf(t);
    if (!ty) continue;
    n.set(ty, (n.get(ty) ?? 0) + 1);
    all++;
  }
  let mix = 0;
  for (const v of profile.types.values()) mix += v;
  if (!all || !mix) return 0;
  let d = 0;
  for (const ty of new Set([...n.keys(), ...profile.types.keys()])) d += Math.abs((n.get(ty) ?? 0) / all - (profile.types.get(ty) ?? 0) / mix);
  return d / 2;
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

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
import { SHORE_TYPES, WATER_TYPES, type BiomeId, type BiomeProfile } from "./biomes";
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

/** Child key → terrain for the region's own cells (except pinned ones, which are left alone). */
export function generateRegion(input: RegionGenInput): Map<string, string> {
  const { layout, field, profiles, typeOf } = input;
  const pinned = input.pinned ?? new Map<string, string>();
  // Pinned cells inside the region (hand-painted, locked) stay as they are
  // and count as fixed context, like the neighbours' cells.
  const cells = regionCells(layout, input.parent[0], input.parent[1]).filter(([x, y]) => !pinned.has(`${x}_${y}`));
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

  // 3. Islands for watery biomes (landShare / minIslands), after smoothing:
  //    smoothing pulls every cell toward the majority type, so scattered
  //    land in a mostly water biome would otherwise vanish.
  const ownBiome = field.biomes.get(`${input.parent[0]}_${input.parent[1]}`);
  const profile = ownBiome ? profiles.get(ownBiome) : undefined;
  if (ownBiome && profile && (profile.minIslands || profile.landShare)) {
    placeIslands({
      layout,
      cells,
      work,
      terrainAt,
      typeOf,
      profile,
      influence: (x, y) => field.at(x, y).get(ownBiome) ?? 0,
      rng: mulberry32(cellSeed(input.seed ^ 0x6a09e667, input.parent[0], input.parent[1])),
    });
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

  const maxSize = Math.max(1, Math.floor(n / (4 * Math.max(1, minIslands))));
  // Shore rings that are land (a beach) count toward an island's size: the
  // leading SHORE_TYPES the biome has, up to the first water one.
  let landRings = 0;
  for (const shore of SHORE_TYPES) {
    if (!profile.names.get(shore)?.size) continue;
    if (water.has(shore)) break;
    landRings++;
  }
  const taken = new Set<string>();
  const free = (k: string) => own.has(k) && !taken.has(k) && !isLand(k);
  /** Land an island will cover once its land shore rings are on (own cells only). */
  const footprint = (island: Set<string>): number => {
    const all = new Set(island);
    let ring = [...island];
    for (let i = 0; i < landRings; i++) {
      ring = [...new Set(ring.flatMap(nbrs))].filter((k) => free(k) && !all.has(k));
      for (const k of ring) all.add(k);
    }
    return all.size;
  };
  for (let guard = 0; guard < n && (have < minIslands || landCount() < landTarget); guard++) {
    // Seed: a free cell with no land next to it, best where the biome is strongest and away from the edge.
    let start: string | undefined, best = -1;
    for (const k of ownList) {
      if (!free(k)) continue;
      const around = nbrs(k);
      if (around.some(isLand)) continue;
      const [x, y] = k.split("_").map(Number);
      const score = (input.influence(x, y) + 0.05) * (around.every((m) => own.has(m)) ? 1 : 0.3) * (0.5 + rng());
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
    // Shore rings, inner first, for the shore types the biome has.
    let ring = [...island];
    for (const shore of SHORE_TYPES) {
      if (!profile.names.get(shore)?.size) continue;
      const next = [...new Set(ring.flatMap(nbrs))].filter(free).sort();
      for (const k of next) {
        work.set(k, nameOf(shore)!);
        taken.add(k);
      }
      ring = next;
    }
    have++;
  }
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

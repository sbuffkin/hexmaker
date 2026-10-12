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
        : argmax(namesWithinType(field.at(x, y), profiles, bestType, sharp));
      if (name) next.set(k, name);
    }
    for (const [k, v] of next) work.set(k, v);
  }

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
    });
  } else if (ownBiome && profile && (profile.minIslands || profile.landShare)) {
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
      rng: mulberry32(cellSeed(input.seed ^ 0x3c6ef372, input.parent[0], input.parent[1])),
    });
  }

  const out = new Map<string, string>();
  for (const k of own) {
    const v = work.get(k);
    if (v) out.set(k, v);
  }
  return out;
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
  const free = (k: string) => own.has(k) && !taken.has(k) && !isLand(k);
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
 * own minimum are never painted over. Deterministic for a seed.
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
  const nbrs = (k: string): string[] => {
    const [x, y] = k.split("_").map(Number);
    return childNeighbours(layout, x, y).map(([a, b]) => `${a}_${b}`);
  };
  const typeAt = (k: string) => {
    const t = terrainAt(k);
    return t ? typeOf(t) : undefined;
  };
  const taken = new Set<string>();
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
    const free = (k: string) => own.has(k) && !taken.has(k) && !protectedTypes.has(typeAt(k) ?? "");
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
        const score = (input.influence(x, y) + 0.05) * (around.every((m) => own.has(m)) ? 1 : edgeShy) * (0.5 + rng());
        if (score > best) { best = score; start = k; }
      }
      if (!start) break;
      const patch = new Set<string>();
      const add = (k: string) => {
        work.set(k, pick(names, rng())!);
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
  const dirs = sides.map((s) => {
    const [qx, qy] = regionCentrePoint(layout, s.hex[0], s.hex[1]);
    const len = Math.hypot(qx - cx, qy - cy) || 1;
    return { ux: (qx - cx) / len, uy: (qy - cy) / len, land: s.land };
  });
  const lands = dirs.map((d) => d.land);
  if (!dirs.length || Math.max(...lands) - Math.min(...lands) < 0.15) {
    const mean = lands.length ? lands.reduce((a, b) => a + b, 0) / lands.length : 0;
    const all = neighbourRegions(layout, parent[0], parent[1]);
    const pickHex = all[Math.floor(hash2(input.seed >>> 0, parent[0], parent[1]) * all.length) % all.length];
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
      sl += w * d.land;
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
    const phi = field.at(x, y);
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

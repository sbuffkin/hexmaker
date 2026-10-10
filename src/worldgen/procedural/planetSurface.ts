import { hexCenter, hexNeighbors, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import { inferTerrainType, isTerrainType } from "../../terrainTypes";
import {
  SIDES,
  SIDE_VECTORS,
  cellKey,
  distance,
  type ContextTerrain,
  type GenerationContext,
  type Side,
  findByType,
  findRole,
  gridKeys,
  typeIndex,
  ofType,
  type ProcGrid,
  type ProcOption,
  type ProcResult,
} from "./common";

/**
 * "Planet surface": a region map of a world — seas, coasts, plains,
 * forests, hills, mountains, deserts, ice — from seeded fractal noise
 * (elevation + moisture) and a latitude temperature gradient. Needs no
 * learned model, so any overland palette gets a usable map on first use;
 * water % and climate let one generator cover ocean worlds, deserts and
 * ice balls (the space presets set these per planet type).
 *
 * Terrain roles resolve by terrain type, then (for untyped terrains) by
 * name and category, so the Limited / Expanded palettes and user palettes
 * with any names all work.
 */

export const PLANET_SURFACE_ID = "procedural:planet-surface";
/** The same generator offered on world maps (Planet surface is space-only). */
export const OVERLAND_ID = "procedural:overland";

export const PLANET_SURFACE_OPTIONS: ProcOption[] = [
  {
    key: "water",
    label: "Water",
    choices: [
      { value: "10", label: "10% (dry)" },
      { value: "30", label: "30%" },
      { value: "50", label: "50%" },
      { value: "65", label: "65% (Earthlike)" },
      { value: "85", label: "85% (ocean world)" },
    ],
    default: "50",
  },
  {
    key: "climate",
    label: "Climate",
    choices: [
      { value: "temperate", label: "Temperate" },
      { value: "lush", label: "Lush / tropical" },
      { value: "arid", label: "Arid" },
      { value: "frozen", label: "Frozen" },
      { value: "volcanic", label: "Volcanic" },
    ],
    default: "temperate",
  },
  {
    key: "relief",
    label: "Relief",
    choices: [
      { value: "flat", label: "Flat" },
      { value: "normal", label: "Normal" },
      { value: "rugged", label: "Rugged" },
    ],
    default: "normal",
  },
];

/** Where Overland puts its sea. "random" picks one side from the seed. */
export type SeaSide = "north" | "east" | "south" | "west" | "around" | "scattered" | "none";

/**
 * Overland: Planet surface's knobs plus where the sea goes. A region is a
 * piece of a world, not a whole planet: one climate across the map (no
 * polar bands), and by default the sea runs along one side (picked from
 * the seed) so the map reads as a stretch of coast.
 */
export const OVERLAND_OPTIONS: ProcOption[] = [
  // A coast, not a hemisphere of ocean: less water by default.
  ...PLANET_SURFACE_OPTIONS.map((o) => (o.key === "water" ? { ...o, default: "30" } : o)),
  {
    key: "sea",
    label: "Sea",
    choices: [
      { value: "random", label: "One side (random)" },
      { value: "north", label: "North" },
      { value: "east", label: "East" },
      { value: "south", label: "South" },
      { value: "west", label: "West" },
      { value: "around", label: "All around (island)" },
      { value: "scattered", label: "Scattered (lakes and inlets)" },
      { value: "none", label: "None (landlocked)" },
    ],
    default: "random",
  },
];

const SEA_SIDES: SeaSide[] = ["north", "east", "south", "west", "around", "scattered", "none"];
const ONE_SIDE: SeaSide[] = ["north", "east", "south", "west"];

/** The Sea option as a side: "random" (or missing/unknown) → one of N/E/S/W from the seed. */
export function resolveSeaSide(option: string | undefined, seed: number): SeaSide {
  if (option && option !== "random" && (SEA_SIDES as string[]).includes(option)) return option as SeaSide;
  // Its own stream, so the noise layout doesn't depend on the side.
  return ONE_SIDE[Math.floor(mulberry32((seed ^ 0x5ea5) >>> 0)() * ONE_SIDE.length)];
}

/**
 * Overland's default Sea for a map placed next to existing regions, read
 * from the neighbours' border hexes (context `edgeCells`, just outside the
 * grid). Fresh-eyes r4: the random default could put the sea south when
 * the neighbour's coast ran east.
 *  - "edge":   the border across one seam is mostly water → the sea is on
 *              that side, continuing the neighbour's sea.
 *  - "end":    some water, gathered at one end of the seam → the
 *              neighbour's coast meets the seam there; the sea runs along
 *              that side (not toward the neighbour's land).
 *  - "middle": some water in the middle of the seam (an inlet / lake) →
 *              scattered water.
 *  - "dry":    no water on any seam → none (landlocked).
 * Undefined when there's no neighbour border to read.
 */
export interface NeighbourSea {
  side: SeaSide;
  why: "edge" | "end" | "middle" | "dry";
  /** The seam (side of this map) the decision was read from. */
  seam?: "north" | "east" | "south" | "west";
}

const WET = new Set(["water", "deep-water", "shallows"]);

export function seaSideFromNeighbours(
  grid: Pick<ProcGrid, "cols" | "rows" | "offset">,
  edgeCells: Map<string, ContextTerrain> | undefined,
): NeighbourSea | undefined {
  if (!edgeCells?.size) return undefined;
  const { offset: o, cols, rows } = grid;
  type Seam = "north" | "east" | "south" | "west";
  const seams = new Map<Seam, { n: number; wet: number[] }>();
  for (const [k, c] of edgeCells) {
    const [x, y] = k.split("_").map(Number);
    const w = x < o.x, e = x > o.x + cols - 1, nn = y < o.y, s = y > o.y + rows - 1;
    if (Number(w) + Number(e) + Number(nn) + Number(s) !== 1) continue; // corners: ambiguous
    const seam: Seam = w ? "west" : e ? "east" : nn ? "north" : "south";
    const type = isTerrainType(c.type) ? c.type : c.terrain ? inferTerrainType(c.terrain) : undefined;
    if (!type) continue;
    const at = seams.get(seam) ?? { n: 0, wet: [] };
    at.n++;
    // Position along the seam, 0 at its west / north end .. 1 at the other.
    if (WET.has(type)) at.wet.push(seam === "north" || seam === "south"
      ? (x - o.x) / Math.max(1, cols - 1)
      : (y - o.y) / Math.max(1, rows - 1));
    seams.set(seam, at);
  }
  if (!seams.size) return undefined;
  const ranked = [...seams].sort((a, b) => b[1].wet.length / b[1].n - a[1].wet.length / a[1].n);
  const [seam, best] = ranked[0];
  if (!best.wet.length) return { side: "none", why: "dry" };
  if (best.wet.length / best.n >= 0.5) return { side: seam, why: "edge", seam };
  const mean = best.wet.reduce((a, b) => a + b, 0) / best.wet.length;
  if (mean > 0.35 && mean < 0.65) return { side: "scattered", why: "middle", seam };
  const across = seam === "north" || seam === "south";
  const side: SeaSide = mean <= 0.35 ? (across ? "west" : "north") : (across ? "east" : "south");
  return { side, why: "end", seam };
}

/**
 * How far inland a point is, 0 at the sea edge .. 1 at the far edge
 * (u, v in 0..1, west→east and north→south). "around": 0 at every edge,
 * 1 in the middle.
 */
function inland(side: SeaSide, u: number, v: number): number {
  switch (side) {
    case "north": return v;
    case "south": return 1 - v;
    case "west": return u;
    case "east": return 1 - u;
    case "around": return 1 - Math.max(Math.abs(2 * u - 1), Math.abs(2 * v - 1));
    default: return 0.5;
  }
}

/** How strongly the sea side tilts the land (elevation units; noise spans ~0.3). */
const SEA_TILT = 0.6;

/**
 * Tilt of the field that decides where the sea is (Overland, sea on a side
 * or all around). Steeper than SEA_TILT so the noise only makes the coast
 * ragged (bays, headlands) instead of running inlets across the map; the
 * land's relief keeps the gentler SEA_TILT.
 */
const SEA_MASK_TILT = 1.6;

/** Largest inland lake kept on an Overland map with a sea side (hexes, at least 3). */
export function maxLakeSize(hexCount: number): number {
  return Math.max(3, Math.round(hexCount * 0.012));
}

/**
 * The sea of an Overland map with a sea side: one body of water touching
 * that side (or every side, "around"), plus small lakes. Water the noise
 * puts elsewhere — streaks and big inland seas — becomes land, and the sea
 * then grows out from its coast, lowest ground first, until it covers the
 * water share again. Pure; `field` is lower where the sea should be.
 */
export function sideSeaMask(
  keys: [number, number][],
  field: number[],
  target: number,
  onSeaEdge: (x: number, y: number) => boolean,
  neighbours: (x: number, y: number) => [number, number][],
): boolean[] {
  const n = keys.length;
  const index = new Map(keys.map(([x, y], i) => [cellKey(x, y), i]));
  const near = (i: number) =>
    neighbours(keys[i][0], keys[i][1]).map(([x, y]) => index.get(cellKey(x, y))).filter((j): j is number => j !== undefined);
  const want = Math.max(0, Math.min(n, Math.round(target)));
  const sea = new Array<boolean>(n).fill(false);
  if (want === 0) return sea;

  // Candidate water: the lowest `want` cells of the field.
  const order = [...field.keys()].sort((a, b) => field[a] - field[b] || a - b);
  const wet = new Array<boolean>(n).fill(false);
  for (let k = 0; k < want; k++) wet[order[k]] = true;

  // The sea: candidate water connected to the sea edge.
  const stack: number[] = [];
  for (let i = 0; i < n; i++) if (wet[i] && onSeaEdge(keys[i][0], keys[i][1])) { sea[i] = true; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of near(i)) if (wet[j] && !sea[j]) { sea[j] = true; stack.push(j); }
  }
  // No water reached the edge: start from the lowest edge cell.
  if (!sea.some(Boolean)) {
    const edge = order.find((i) => onSeaEdge(keys[i][0], keys[i][1]));
    if (edge !== undefined) sea[edge] = true;
  }

  // Lakes: other water bodies, kept only while small.
  const lakeMax = maxLakeSize(n);
  const seen = new Array<boolean>(n).fill(false);
  const water = [...sea];
  for (let i = 0; i < n; i++) {
    if (!wet[i] || sea[i] || seen[i]) continue;
    const body = [i];
    seen[i] = true;
    for (let b = 0; b < body.length; b++)
      for (const j of near(body[b])) if (wet[j] && !sea[j] && !seen[j]) { seen[j] = true; body.push(j); }
    if (body.length <= lakeMax) for (const j of body) water[j] = true;
  }

  // The edge fallback can put one cell over: drain the highest lake cells.
  let count = water.filter(Boolean).length;
  for (const i of [...order].reverse()) {
    if (count <= want) break;
    if (water[i] && !sea[i]) { water[i] = false; count--; }
  }

  // Grow the sea from its coast, lowest field first, back up to the target.
  const frontier = new Set<number>();
  for (let i = 0; i < n; i++) if (sea[i]) for (const j of near(i)) if (!water[j]) frontier.add(j);
  while (count < want && frontier.size) {
    let best = -1;
    for (const j of frontier) if (best < 0 || field[j] < field[best] || (field[j] === field[best] && j < best)) best = j;
    frontier.delete(best);
    if (water[best]) continue;
    water[best] = true;
    count++;
    for (const j of near(best)) if (!water[j]) frontier.add(j);
  }
  return water;
}

export interface PlanetRoles {
  deep?: string;
  sea: string;
  shallows?: string;
  beach?: string;
  plains: string;
  forest?: string;
  jungle?: string;
  swamp?: string;
  hills?: string;
  mountain?: string;
  peak?: string;
  snow?: string;
  desert?: string;
  badlands?: string;
  volcano?: string;
  variants: PlanetVariants;
}

/** Woodland family, chosen by temperature: conifers cold, broadleaf warm. */
type Family = "conifer" | "mixed" | "broadleaf" | "tropical";

/**
 * Typed extras for variety. A palette with several terrains of one type
 * (Expanded: forest, forest heavy, mixed forest, evergreen, …) spreads them
 * by climate instead of using only the first; name hints tell the variants
 * apart since the type doesn't. Empty on untyped palettes.
 */
export interface PlanetVariants {
  /** Forest per family: [open, dense]. */
  forest: Partial<Record<Family, [string | undefined, string | undefined]>>;
  denseJungle?: string;
  /** Wooded hills / mountains per family (on moist high ground). */
  hills: Partial<Record<Family, string>>;
  mountain: Partial<Record<Family, string>>;
}

const WOODED = /forest|wood|evergreen|pine|conifer|taiga|jungle|rainforest|grove/i;
const FAMILY_RE: Record<Family, RegExp> = {
  conifer: /evergreen|pine|conifer|taiga|spruce|fir\b/i,
  mixed: /mixed/i,
  tropical: /jungle|rainforest/i,
  broadleaf: /forest|wood|grove/i,
};
const DENSE = /heavy|dense|thick|deep|old/i;

/** Which family a name belongs to; broadleaf is the catch-all. */
function familyOf(name: string): Family {
  for (const f of ["conifer", "mixed", "tropical"] as const) if (FAMILY_RE[f].test(name)) return f;
  return "broadleaf";
}

function planetVariants(terrains: TerrainColor[], forest: string | undefined): PlanetVariants {
  const v: PlanetVariants = { forest: {}, hills: {}, mountain: {} };
  for (const name of ofType(terrains, ["forest"])) {
    const fam = familyOf(name);
    const slot = (v.forest[fam] ??= [undefined, undefined]);
    const i = DENSE.test(name) ? 1 : 0;
    // The base forest role stays the open broadleaf forest.
    if (name === forest) slot[i] = name;
    else slot[i] ??= name;
  }
  v.denseJungle = ofType(terrains, ["jungle"]).find((n) => DENSE.test(n));
  for (const [key, type] of [["hills", "hills"], ["mountain", "mountains"]] as const) {
    for (const name of ofType(terrains, [type])) {
      if (WOODED.test(name)) v[key][familyOf(name)] ??= name;
    }
  }
  return v;
}

/**
 * Roles by terrain type first (water, grassland, forest, …), so custom
 * names like "Kelp sea" or "Pinewood" work; untyped palettes fall back to
 * the name and category guesses. The base hills / mountain role skips
 * wooded variants ("forested hills"), which only appear on moist ground.
 */
export function planetRoles(terrains: TerrainColor[]): PlanetRoles | undefined {
  const sea = findRole(terrains, ["water"], ["ocean", "sea", "water"], "sea");
  const plains = findRole(terrains, ["grassland"], ["grass", "grassland", "plains", "lowland", "meadow"], "lowlands");
  if (!sea || !plains) return undefined;
  const bare = terrains.filter((t) => !WOODED.test(t.name));
  const rugged = (type: string, names: string[], category?: string) =>
    findByType(bare, [type], names) ?? findRole(terrains, [type], names, category);
  const forest = findRole(terrains, ["forest"], ["forest", "mixed forest", "woods"], "forest");
  return {
    sea,
    plains,
    deep: findRole(terrains, ["deep-water"], ["trench", "deep ocean", "deep water", "abyss"]),
    shallows: findRole(terrains, ["shallows"], ["shallows", "shallow water", "reef"]),
    beach: findRole(terrains, ["coast"], ["beach", "coast", "shore", "sand"], "coast"),
    forest,
    jungle: findRole(terrains, ["jungle"], ["jungle", "rainforest"]),
    swamp: findRole(terrains, ["wetland"], ["swamp", "marsh", "bog"], "bog"),
    hills: rugged("hills", ["hills", "hill", "foothills"]),
    mountain: rugged("mountains", ["mountain", "mountains"], "mountain"),
    peak: findRole(terrains, ["peaks"], ["peak", "mountains snow", "mountain snow", "snowy peak"]),
    snow: findRole(terrains, ["snow"], ["snow", "tundra", "ice", "glacier"], "snow"),
    desert: findRole(terrains, ["desert"], ["desert", "dunes", "desert rocky"], "desert"),
    badlands: findRole(terrains, ["badlands"], ["badlands", "brokenlands", "wasteland"]),
    volcano: findRole(terrains, ["volcanic"], ["volcano", "volcanic"]),
    variants: planetVariants(terrains, forest),
  };
}

export function planetSurfaceFits(terrains: TerrainColor[]): boolean {
  return planetRoles(terrains) !== undefined;
}

/** Seeded 2-D value noise with a few octaves, in [0, 1]. */
function makeNoise(rand: () => number): (x: number, y: number) => number {
  const SIZE = 256;
  const perm = Array.from({ length: SIZE }, (_, i) => i);
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const vals = Array.from({ length: SIZE }, () => rand());
  const lattice = (ix: number, iy: number) => vals[perm[(perm[ix & 255] + iy) & 255]];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => {
    let total = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 4; o++) {
      total += value(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return total / norm;
  };
}

/**
 * Land elevation quantile where mountains start (1 − share of land that is
 * mountain). Overland's Normal keeps mountains a minority feature, about
 * 7% of the land (fresh-eyes r4: a "farmland and hills" barony came out
 * with a mountain range at 13%); Rugged is the mountainous choice. A whole
 * planet keeps its old Normal.
 */
export function mountainQuantile(relief: string, flavor: "planet" | "overland"): number {
  if (relief === "flat") return 0.97;
  if (relief === "rugged") return 0.72;
  return flavor === "overland" ? 0.93 : 0.87;
}

/**
 * Overland's generator card text for a palette: only the kinds of terrain
 * this palette can actually give (the Limited palette has no coast terrain,
 * so it doesn't promise one).
 */
export function overlandDescription(terrains: TerrainColor[]): string {
  const r = planetRoles(terrains);
  const tail = "One climate across the map; set water %, climate and which side the sea is on. Next to another map, it carries on from that map's edge.";
  if (!r) return `A region from noise. ${tail}`;
  const parts = [
    r.sea && "sea",
    r.beach && "coast",
    r.plains && "plains",
    r.forest && "forests",
    r.swamp && "swamps",
    r.hills && "hills",
    r.mountain && "mountains",
  ].filter((p): p is string => !!p);
  const extras = [
    (r.desert ?? r.badlands) && "deserts when arid",
    r.snow && "snow when frozen",
  ].filter((p): p is string => !!p);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
  return `A region from noise: ${list}${extras.length ? ` (${extras.join(", ")})` : ""}. ${tail}`;
}

/** Value at quantile q (0..1) of a list. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

// ── Region detail (context mode) ─────────────────────────────────────────
//
// Target [elevation, moisture, temperature] per terrain type, on the same
// 0..1 scales the classifier below uses (sea below 0.33, hills from 0.64,
// mountains 0.79, peaks 0.92). A region zooming into a "forest" hex gets
// forest-ish targets in the middle; each edge drifts toward the terrain
// beyond it, so a sea to the east puts a coast on the east edge.
const TYPE_TARGETS: Record<string, [number, number, number]> = {
  "deep-water": [0.02, 0.5, 0.6],
  water: [0.14, 0.5, 0.6],
  shallows: [0.27, 0.5, 0.6],
  coast: [0.37, 0.4, 0.65],
  grassland: [0.5, 0.42, 0.6],
  settlement: [0.5, 0.42, 0.6],
  forest: [0.52, 0.68, 0.55],
  jungle: [0.5, 0.9, 0.9],
  wetland: [0.41, 0.86, 0.6],
  hills: [0.7, 0.45, 0.55],
  mountains: [0.85, 0.45, 0.45],
  peaks: [0.96, 0.4, 0.15],
  snow: [0.55, 0.4, 0.08],
  desert: [0.5, 0.1, 0.82],
  badlands: [0.6, 0.15, 0.75],
  volcanic: [0.82, 0.2, 0.85],
};

function targetOf(c: ContextTerrain | undefined): [number, number, number] | undefined {
  if (!c) return undefined;
  const type = isTerrainType(c.type) ? c.type : c.terrain ? inferTerrainType(c.terrain) : undefined;
  return type ? TYPE_TARGETS[type] : undefined;
}

export const REGION_DETAIL_ID = "procedural:region-detail";

export const REGION_DETAIL_OPTIONS: ProcOption[] = [
  {
    key: "edges",
    label: "Neighbour influence",
    choices: [
      { value: "soft", label: "Soft (thin edges)" },
      { value: "normal", label: "Normal" },
      { value: "strong", label: "Strong (wide edges)" },
    ],
    default: "normal",
  },
  {
    key: "variety",
    label: "Variety",
    choices: [
      { value: "low", label: "Low (mostly the parent terrain)" },
      { value: "normal", label: "Normal" },
      { value: "high", label: "High" },
    ],
    default: "normal",
  },
];

/** Thresholds shared by both modes' classification. */
interface Levels {
  sea: number;
  deep: number;
  shelf: number;
  hill: number;
  mountain: number;
  peak: number;
  /** Low ground (swamps): sea level, or the lowest land when there's no sea. */
  low?: number;
}

export function planetSurface(
  terrains: TerrainColor[],
  grid: ProcGrid,
  seed: number,
  options: Record<string, string> = {},
  /** When given, generate a *region* of the bigger map (Region detail):
   *  the parent hex's terrain fills it and neighbours shape its edges.
   *  Overland reads only `edgeCells` (a neighbouring region's border) and
   *  carries that terrain on across the seam. */
  context?: GenerationContext,
  /** "planet": a whole world (warm equator, polar caps). "overland": a
   *  region of one (single climate, sea on a chosen side; OVERLAND_OPTIONS). */
  flavor: "planet" | "overland" = "planet",
): ProcResult {
  const roles = planetRoles(terrains);
  if (!roles) return { cells: new Map(), paths: [], warnings: ["This palette has no sea or plains terrain."] };
  const rand = mulberry32(seed);
  const elevNoise = makeNoise(rand);
  const moistNoise = makeNoise(rand);
  const climate = options.climate ?? "temperate";
  // Frozen worlds have no temperate belt: open land is snow / ice, high
  // ground bare rock, and no woods anywhere.
  const frozen = climate === "frozen";

  const hexes = gridKeys(grid);
  // Feature scale: about 3 noise cells across the map whatever its size.
  const centers = hexes.map(([x, y]) => hexCenter(x, y, grid.orientation, grid.stagger));
  const xs = centers.map((c) => c[0]), ys = centers.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 3.2 / span;
  const ox = rand() * 100, oy = rand() * 100;
  const noiseE = centers.map(([px, py]) => elevNoise(ox + px * scale, oy + py * scale));
  const noiseM = centers.map(([px, py]) => moistNoise(oy + px * scale * 1.3, ox + py * scale * 1.3));

  let elev: number[], moistArr: number[], tempArr: number[], lv: Levels;
  /** Region detail: how strongly each side's neighbour reaches each hex. */
  let sideEdges: Map<Side, number[]> | undefined;
  /** Overland with a sea side: which hexes are water (else elevation decides). */
  let seaMask: boolean[] | undefined;
  // Overland next to an existing region: its border hexes pull this map's
  // edge toward them, so terrain carries on across the seam.
  const pulls = flavor === "overland" && context?.edgeCells?.size ? edgePulls(grid, hexes, context.edgeCells) : undefined;
  if (context && flavor !== "overland") {
    ({ elev, moist: moistArr, temp: tempArr, sideEdges } = regionField(grid, hexes, centers, noiseE, noiseM, context, options));
    lv = { sea: 0.33, deep: 0.08, shelf: 0.27, hill: 0.64, mountain: 0.79, peak: 0.92 };
  } else {
    const water = Math.max(0, Math.min(95, Number(options.water ?? 50))) / 100;
    const relief = options.relief ?? "normal";
    const overland = flavor === "overland";
    const sea: SeaSide = overland ? resolveSeaSide(options.sea, seed) : "scattered";
    // Tilt the land down toward the sea side, so high ground lies inland.
    const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
    const inlandAt = (i: number) => inland(sea, (xs[i] - minX) / spanX, (ys[i] - minY) / spanY) - 0.5;
    const sided = sea !== "scattered" && sea !== "none";
    elev = sided ? noiseE.map((n, i) => n + SEA_TILT * inlandAt(i)) : noiseE;
    let seaLevel: number;
    if (sided && water > 0) {
      // The sea hugs its side: one body touching that edge (plus small
      // lakes), from a steeper-tilted field so the coast is ragged but
      // the sea doesn't streak across the map (sideSeaMask).
      let field = noiseE.map((n, i) => n + SEA_MASK_TILT * inlandAt(i));
      if (pulls) {
        // Water across the seam stays water; land across it keeps the sea off.
        const lo = Math.min(...field) - 0.01, hi = Math.max(...field) + 0.01;
        field = field.map((f, i) => {
          const p = pulls[i];
          return p ? f + (p.wet * lo + (1 - p.wet) * hi - f) * p.alpha : f;
        });
      }
      const pullIndex = new Map(hexes.map(([x, y], i) => [cellKey(x, y), i]));
      const onEdge = (x: number, y: number) => {
        const w = x === grid.offset.x, e = x === grid.offset.x + grid.cols - 1;
        const nn = y === grid.offset.y, s = y === grid.offset.y + grid.rows - 1;
        const side = sea === "west" ? w : sea === "east" ? e : sea === "north" ? nn : sea === "south" ? s : w || e || nn || s;
        // A neighbour's sea right across the seam is open sea too.
        const p = pulls?.[pullIndex.get(cellKey(x, y)) ?? -1];
        return side || (!!p && p.near === 1 && p.wet > 0.5);
      };
      seaMask = sideSeaMask(hexes, field, water * hexes.length, onEdge,
        (x, y) => hexNeighbors(x, y, grid.orientation, grid.stagger));
      // Sea level for coasts and the lapse rate: the low end of the land.
      const land = elev.filter((_, i) => !seaMask![i]);
      seaLevel = land.length ? quantile(land, 0.05) : Infinity;
    } else {
      seaLevel = water <= 0 || sea === "none" ? -Infinity : quantile(elev, water);
    }
    const wetAt = (e: number, i: number) => (seaMask ? seaMask[i] : e <= seaLevel);
    // Lowland reference for the lapse rate: sea level, or (no sea) the low ground.
    const lowLevel = Number.isFinite(seaLevel) ? seaLevel : quantile(elev, 0.1);
    const landElev = elev.filter((e, i) => !wetAt(e, i));
    const seaElev = elev.filter((e, i) => wetAt(e, i));
    lv = {
      sea: seaLevel,
      hill: quantile(landElev.length ? landElev : [1], relief === "flat" ? 0.88 : relief === "rugged" ? 0.5 : 0.7),
      mountain: quantile(landElev.length ? landElev : [1], mountainQuantile(relief, flavor)),
      peak: quantile(landElev.length ? landElev : [1], relief === "rugged" ? 0.92 : 0.97),
      // Overland: only the far offshore water is deep (no trench band along the edge).
      deep: quantile(seaElev.length ? seaElev : [0], overland ? 0.12 : 0.35),
      shelf: quantile(seaElev.length ? seaElev : [0], 0.8),
      low: lowLevel,
    };
    const climateShift: Record<string, number> = { temperate: 0, lush: 0.12, arid: 0.15, frozen: -0.55, volcanic: 0.3 };
    const moistShift: Record<string, number> = { temperate: 0, lush: 0.25, arid: -0.35, frozen: -0.1, volcanic: -0.2 };
    const tShift = climateShift[climate] ?? 0;
    const mShift = moistShift[climate] ?? 0;
    let moistBase = noiseM.map((m) => m + mShift);
    if (pulls) {
      // Pull elevation (in this map's own levels) and moisture toward the
      // neighbour's border terrain: hills next to its hills, forest next to
      // its forest. Sea cells come from the mask above when there is one.
      const levels = lv;
      const low = Number.isFinite(levels.sea) ? levels.sea : lowLevel;
      const classElev = [
        low - 0.05,
        low + 0.01,
        (low + levels.hill) / 2,
        (levels.hill + levels.mountain) / 2,
        (levels.mountain + levels.peak) / 2,
        levels.peak + 0.02,
      ];
      elev = elev.map((e, i) => {
        const p = pulls[i];
        if (!p) return e;
        const target = p.classWeights.reduce((a, w, k) => a + w * classElev[k], 0);
        return e + (target - e) * p.alpha;
      });
      moistBase = moistBase.map((m, i) => {
        const p = pulls[i];
        return p ? m + (p.moist - m) * p.alpha : m;
      });
    }
    // Temperature: warm equator, cold poles (rows), shifted by climate.
    tempArr = centers.map((c, i) => {
      // Overland is one region: a single mid-latitude climate, no poles.
      const lat = overland ? 0.4 : maxY > minY ? Math.abs((c[1] - minY) / (maxY - minY) - 0.5) * 2 : 0; // 0 equator .. 1 pole
      return 1 - lat * 0.9 + tShift - Math.max(0, elev[i] - lowLevel) * 0.6;
    });
    moistArr = moistBase;
  }
  const seaLevel = lv.sea, deepAt = lv.deep, shelfAt = lv.shelf;
  const hillAt = lv.hill, mountainAt = lv.mountain, peakAt = lv.peak;
  const lowAt = lv.low ?? seaLevel;

  // Woodland variety (typed palettes only): the family follows temperature,
  // dense variants take the wettest ground. No rand() calls, so a seed's
  // layout is the same with or without variants.
  const v = roles.variants;
  const familyAt = (temp: number): Family =>
    temp > 0.75 ? "tropical" : temp < 0.45 ? "conifer" : temp < 0.6 ? "mixed" : "broadleaf";
  const chain = (f: Family): Family[] => (f === "broadleaf" ? [f] : f === "conifer" ? [f, "mixed", "broadleaf"] : [f, "broadleaf"]);
  const forestAt = (temp: number, m: number): string | undefined => {
    for (const f of chain(familyAt(temp))) {
      const slot = v.forest[f];
      const hit = slot && (m > 0.64 ? slot[1] ?? slot[0] : slot[0]);
      if (hit) return hit;
    }
    return roles.forest;
  };
  const wooded = (byFamily: Partial<Record<Family, string>>, temp: number): string | undefined => {
    for (const f of chain(familyAt(temp))) if (byFamily[f]) return byFamily[f];
    return undefined;
  };

  // Deserts belong to dry or hot climates. A whole planet has its desert
  // belts whatever the climate; an Overland region is one climate, so a
  // temperate (or lush, frozen) region has no desert: dry ground is plains.
  const desertOk = flavor !== "overland" || climate === "arid" || climate === "volcanic";

  const cells = new Map<string, string>();
  const isSea: boolean[] = seaMask ?? elev.map((e) => e <= seaLevel);
  const index = new Map(hexes.map(([x, y], i) => [cellKey(x, y), i]));

  hexes.forEach(([x, y], i) => {
    const k = cellKey(x, y);
    const e = elev[i];
    const temp = tempArr[i];
    const m = moistArr[i];

    if (isSea[i]) {
      // Frozen seas near the poles ice over (on an Overland region: floes).
      if (temp < 0.12 && roles.snow && (flavor !== "overland" || noiseM[i] > 0.5)) { cells.set(k, roles.snow); return; }
      if (e < deepAt && roles.deep) cells.set(k, roles.deep);
      else if (e > shelfAt && roles.shallows) cells.set(k, roles.shallows);
      else cells.set(k, roles.sea);
      return;
    }

    let t: string | undefined;
    if (e >= peakAt) t = roles.peak ?? roles.mountain;
    else if (e >= mountainAt) t = (m > 0.6 && !frozen ? wooded(v.mountain, temp) : undefined) ?? roles.mountain;
    else if (e >= hillAt) t = (m > 0.5 && !frozen ? wooded(v.hills, temp) : undefined) ?? roles.hills;
    if (t && temp < 0.2 && roles.peak) t = roles.peak;
    if (!t) {
      if (frozen) t = roles.snow ?? roles.badlands ?? roles.desert;
      else if (temp < 0.22) t = roles.snow;
      else if (climate === "volcanic" && m < 0.45) t = roles.badlands ?? roles.desert;
      else if (desertOk && m < 0.32 && temp > 0.45) t = roles.desert ?? roles.badlands;
      else if (m > 0.72 && temp > 0.75) t = (m > 0.85 ? v.denseJungle : undefined) ?? roles.jungle ?? forestAt(temp, m);
      else if (m > 0.68 && e - lowAt < 0.05) t = roles.swamp ?? forestAt(temp, m);
      else if (m > 0.5) t = forestAt(temp, m);
    }
    cells.set(k, t ?? roles.plains);
  });

  // Region detail: the neighbours' own terrains on their edges.
  if (context && sideEdges) stampNeighbourTerrains(cells, hexes, isSea, terrains, context, sideEdges, noiseM);

  // Beaches on low, mild coasts.
  if (roles.beach) {
    hexes.forEach(([x, y], i) => {
      if (isSea[i] || cells.get(cellKey(x, y)) !== roles.plains) return;
      const coastal = hexNeighbors(x, y, grid.orientation, grid.stagger)
        .some(([nx, ny]) => { const j = index.get(cellKey(nx, ny)); return j !== undefined && isSea[j]; });
      if (coastal && elev[i] - seaLevel < 0.03) cells.set(cellKey(x, y), roles.beach!);
    });
  }

  // Volcanic worlds: a few volcanoes on the high ground.
  if (climate === "volcanic" && roles.volcano) {
    const high = hexes.filter((_, i) => !isSea[i] && elev[i] >= hillAt);
    const n = Math.max(1, Math.round(high.length / 25));
    for (let v = 0; v < n && high.length; v++) {
      const [x, y] = high.splice(Math.floor(rand() * high.length), 1)[0];
      cells.set(cellKey(x, y), roles.volcano);
    }
  }

  return { cells, paths: [], warnings: [] };
}

/** How a neighbouring region's border pulls one hex of an Overland map. */
interface EdgePull {
  /** Steps to the nearest border hex across the seam (1 = on the edge). */
  near: number;
  /** How far toward the neighbour's terrain (0..1). */
  alpha: number;
  /** Share of the nearby border that is water. */
  wet: number;
  /** Weight per elevation class: water, low, mid, hills, mountains, peaks. */
  classWeights: number[];
  /** Target moisture (TYPE_TARGETS scale). */
  moist: number;
}

/** How far into the map a neighbour's border reaches, and how hard (by steps). */
const EDGE_REACH = 3;
const EDGE_ALPHA = [0, 0.85, 0.55, 0.25];

function elevClass(type: string): number {
  switch (type) {
    case "water": case "deep-water": case "shallows": return 0;
    case "coast": case "wetland": return 1;
    case "hills": return 3;
    case "mountains": case "volcanic": return 4;
    case "peaks": return 5;
    default: return 2;
  }
}

/**
 * Per hex, the pull of a neighbouring region's border hexes (context
 * `edgeCells`, just outside the grid) within EDGE_REACH steps; undefined
 * where none reach. Border hexes of unknown type are ignored.
 */
export function edgePulls(
  grid: ProcGrid,
  hexes: [number, number][],
  edgeCells: Map<string, ContextTerrain>,
): (EdgePull | undefined)[] {
  const cells = [...edgeCells]
    .map(([k, c]) => {
      const type = isTerrainType(c.type) ? c.type : c.terrain ? inferTerrainType(c.terrain) : undefined;
      return { at: k.split("_").map(Number) as [number, number], type };
    })
    .filter((c): c is { at: [number, number]; type: NonNullable<typeof c.type> } => !!c.type && !!TYPE_TARGETS[c.type]);
  return hexes.map((h) => {
    let near = Infinity, wsum = 0, wet = 0, moist = 0;
    const classWeights = [0, 0, 0, 0, 0, 0];
    for (const c of cells) {
      const d = distance(h, c.at, grid);
      if (d < 1 || d > EDGE_REACH) continue;
      near = Math.min(near, d);
      const w = EDGE_REACH + 1 - d;
      wsum += w;
      const cls = elevClass(c.type);
      classWeights[cls] += w;
      if (cls === 0) wet += w;
      moist += w * TYPE_TARGETS[c.type][1];
    }
    if (!wsum) return undefined;
    return {
      near,
      alpha: EDGE_ALPHA[near] ?? 0,
      wet: wet / wsum,
      classWeights: classWeights.map((w) => w / wsum),
      moist: moist / wsum,
    };
  });
}

/**
 * Elevation / moisture / temperature for a region inside a bigger map:
 * the parent's targets everywhere, blended toward each side's neighbour
 * near that edge, and toward exact neighbour-region cells near the border;
 * noise adds local detail on top.
 */
function regionField(
  grid: ProcGrid,
  hexes: [number, number][],
  centers: [number, number][],
  noiseE: number[],
  noiseM: number[],
  context: GenerationContext,
  options: Record<string, string>,
): { elev: number[]; moist: number[]; temp: number[]; sideEdges: Map<Side, number[]> } {
  const parent = targetOf(context.parent) ?? TYPE_TARGETS.grassland;
  // Edge band: how far in from an edge its neighbour still pulls.
  const band = options.edges === "soft" ? 0.3 : options.edges === "strong" ? 0.65 : 0.45;
  const variety = options.variety === "low" ? 0.22 : options.variety === "high" ? 0.55 : 0.36;

  const xs = centers.map((c) => c[0]), ys = centers.map((c) => c[1]);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2, midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const halfW = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, 1e-6);
  const halfH = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, 1e-6);

  const sides = SIDES
    .map((s) => ({ s, t: targetOf(context.sides?.[s]) }))
    .filter((x): x is { s: Side; t: [number, number, number] } => !!x.t);
  const edgeCells = [...(context.edgeCells ?? new Map<string, ContextTerrain>())]
    .map(([k, c]) => ({ at: k.split("_").map(Number) as [number, number], t: targetOf(c) }))
    .filter((x): x is { at: [number, number]; t: [number, number, number] } => !!x.t);

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const elev: number[] = [], moist: number[] = [], temp: number[] = [];
  const sideEdges = new Map<Side, number[]>(sides.map(({ s }) => [s, hexes.map(() => 0)]));
  hexes.forEach((h, i) => {
    const u = (centers[i][0] - midX) / halfW; // -1 west .. 1 east
    const v = (centers[i][1] - midY) / halfH; // -1 north .. 1 south
    let w = 1;
    const acc = [parent[0], parent[1], parent[2]];
    for (const { s, t } of sides) {
      const [dx, dy] = SIDE_VECTORS[s];
      // 1 on that edge, 0 at the far side. A corner neighbour (NE…) only
      // reaches hexes near *both* of its edges.
      const reach = s.length === 2 ? Math.min(u * Math.sign(dx), v * Math.sign(dy)) : u * dx + v * dy;
      const edge = smooth(Math.max(0, Math.min(1, (reach - (1 - band)) / band)));
      if (edge <= 0) continue;
      sideEdges.get(s)![i] = edge;
      const ws = edge * (s.length === 2 ? 2 : 3);
      w += ws;
      for (let k = 0; k < 3; k++) acc[k] += t[k] * ws;
    }
    // Exact border cells from a neighbouring region: strong, very local.
    for (const c of edgeCells) {
      const d = distance(h, c.at, grid);
      if (d > 3) continue;
      const ws = (4 - d) * 2;
      w += ws;
      for (let k = 0; k < 3; k++) acc[k] += c.t[k] * ws;
    }
    const target = acc.map((a) => a / w);
    const e = target[0] + (noiseE[i] - 0.5) * variety * 1.4;
    elev.push(e);
    moist.push(target[1] + (noiseM[i] - 0.5) * 0.5);
    temp.push(target[2] - Math.max(0, e - 0.6) * 0.5);
  });
  return { elev, moist, temp, sideEdges };
}

const SEA_TYPES = new Set(["water", "deep-water", "shallows"]);

/**
 * Region detail's card promises e.g. "evergreen heavy on the north-east and
 * south-east". The field above blends by terrain *type*, which can't tell
 * evergreen from mixed forest (both forest), so the promised terrain never
 * showed (fresh-eyes round 7). Near each edge, hexes of the neighbour's
 * type take the neighbour's exact terrain (with a ragged inner line); a
 * side where none matched still gets its edge-most land hex. Neighbours
 * that are sea, the parent's own terrain, or not in this palette are left
 * to the blend.
 */
function stampNeighbourTerrains(
  cells: Map<string, string>,
  hexes: [number, number][],
  isSea: boolean[],
  terrains: TerrainColor[],
  context: GenerationContext,
  sideEdges: Map<Side, number[]>,
  noise: number[],
): void {
  const types = typeIndex(terrains);
  const names = new Map(terrains.map((t) => [t.name.toLowerCase(), t.name]));
  const parent = context.parent?.terrain?.toLowerCase();
  // The side that reaches each hex hardest owns it.
  const owner = hexes.map((_, i) => {
    let best: Side | undefined;
    let w = 0;
    for (const [s, e] of sideEdges) if (e[i] > w) { w = e[i]; best = s; }
    return best ? { s: best, w } : undefined;
  });
  for (const [s, edges] of sideEdges) {
    const want = context.sides?.[s]?.terrain?.toLowerCase();
    const name = want ? names.get(want) : undefined;
    const type = want ? types.get(want) : undefined;
    if (!name || want === parent || (type && SEA_TYPES.has(type))) continue;
    let stamped = 0;
    hexes.forEach(([x, y], i) => {
      const o = owner[i];
      if (!o || o.s !== s || isSea[i]) return;
      const k = cellKey(x, y);
      if (!type || types.get(cells.get(k)!.toLowerCase()) !== type) return;
      if (o.w < 0.15 + (noise[i] - 0.5) * 0.3) return;
      cells.set(k, name);
      stamped++;
    });
    if (stamped > 0) continue;
    let best = -1;
    hexes.forEach((_, i) => {
      if (!isSea[i] && edges[i] > 0 && (best < 0 || edges[i] > edges[best])) best = i;
    });
    if (best >= 0) cells.set(cellKey(hexes[best][0], hexes[best][1]), name);
  }
}

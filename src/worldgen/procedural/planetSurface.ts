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
}

export function planetSurface(
  terrains: TerrainColor[],
  grid: ProcGrid,
  seed: number,
  options: Record<string, string> = {},
  /** When given, generate a *region* of the bigger map (Region detail):
   *  the parent hex's terrain fills it and neighbours shape its edges. */
  context?: GenerationContext,
): ProcResult {
  const roles = planetRoles(terrains);
  if (!roles) return { cells: new Map(), paths: [], warnings: ["This palette has no sea or plains terrain."] };
  const rand = mulberry32(seed);
  const elevNoise = makeNoise(rand);
  const moistNoise = makeNoise(rand);
  const climate = options.climate ?? "temperate";

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
  if (context) {
    ({ elev, moist: moistArr, temp: tempArr } = regionField(grid, hexes, centers, noiseE, noiseM, context, options));
    lv = { sea: 0.33, deep: 0.08, shelf: 0.27, hill: 0.64, mountain: 0.79, peak: 0.92 };
  } else {
    const water = Math.max(0, Math.min(95, Number(options.water ?? 50))) / 100;
    const relief = options.relief ?? "normal";
    elev = noiseE;
    const seaLevel = water <= 0 ? -Infinity : quantile(elev, water);
    const landElev = elev.filter((e) => e > seaLevel);
    const seaElev = elev.filter((e) => e <= seaLevel);
    lv = {
      sea: seaLevel,
      hill: quantile(landElev.length ? landElev : [1], relief === "flat" ? 0.88 : relief === "rugged" ? 0.5 : 0.7),
      mountain: quantile(landElev.length ? landElev : [1], relief === "flat" ? 0.97 : relief === "rugged" ? 0.72 : 0.87),
      peak: quantile(landElev.length ? landElev : [1], relief === "rugged" ? 0.92 : 0.97),
      deep: quantile(seaElev.length ? seaElev : [0], 0.35),
      shelf: quantile(seaElev.length ? seaElev : [0], 0.8),
    };
    // Temperature: warm equator, cold poles (rows), shifted by climate.
    const climateShift: Record<string, number> = { temperate: 0, lush: 0.12, arid: 0.15, frozen: -0.55, volcanic: 0.3 };
    const moistShift: Record<string, number> = { temperate: 0, lush: 0.25, arid: -0.35, frozen: -0.1, volcanic: -0.2 };
    const tShift = climateShift[climate] ?? 0;
    const mShift = moistShift[climate] ?? 0;
    tempArr = centers.map((c, i) => {
      const lat = maxY > minY ? Math.abs((c[1] - minY) / (maxY - minY) - 0.5) * 2 : 0; // 0 equator .. 1 pole
      return 1 - lat * 0.9 + tShift - Math.max(0, elev[i] - seaLevel) * 0.6;
    });
    moistArr = noiseM.map((m) => m + mShift);
  }
  const seaLevel = lv.sea, deepAt = lv.deep, shelfAt = lv.shelf;
  const hillAt = lv.hill, mountainAt = lv.mountain, peakAt = lv.peak;

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

  const cells = new Map<string, string>();
  const isSea: boolean[] = elev.map((e) => e <= seaLevel);
  const index = new Map(hexes.map(([x, y], i) => [cellKey(x, y), i]));

  hexes.forEach(([x, y], i) => {
    const k = cellKey(x, y);
    const e = elev[i];
    const temp = tempArr[i];
    const m = moistArr[i];

    if (isSea[i]) {
      // Frozen seas near the poles ice over.
      if (temp < 0.12 && roles.snow) { cells.set(k, roles.snow); return; }
      if (e < deepAt && roles.deep) cells.set(k, roles.deep);
      else if (e > shelfAt && roles.shallows) cells.set(k, roles.shallows);
      else cells.set(k, roles.sea);
      return;
    }

    let t: string | undefined;
    if (e >= peakAt) t = roles.peak ?? roles.mountain;
    else if (e >= mountainAt) t = (m > 0.6 ? wooded(v.mountain, temp) : undefined) ?? roles.mountain;
    else if (e >= hillAt) t = (m > 0.5 ? wooded(v.hills, temp) : undefined) ?? roles.hills;
    if (t && temp < 0.2 && roles.peak) t = roles.peak;
    if (!t) {
      if (temp < 0.22) t = roles.snow;
      else if (climate === "volcanic" && m < 0.45) t = roles.badlands ?? roles.desert;
      else if (m < 0.32 && temp > 0.45) t = roles.desert ?? roles.badlands;
      else if (m > 0.72 && temp > 0.75) t = (m > 0.85 ? v.denseJungle : undefined) ?? roles.jungle ?? forestAt(temp, m);
      else if (m > 0.68 && e - seaLevel < 0.05) t = roles.swamp ?? forestAt(temp, m);
      else if (m > 0.5) t = forestAt(temp, m);
    }
    cells.set(k, t ?? roles.plains);
  });

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
): { elev: number[]; moist: number[]; temp: number[] } {
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
  return { elev, moist, temp };
}

import { hexCenter, hexNeighbors, mulberry32 } from "../../../packages/hex-wfc/src";
import type { TerrainColor } from "../../types";
import { cellKey, findTerrain, gridKeys, type ProcGrid, type ProcOption, type ProcResult } from "./common";

/**
 * "Planet surface": a region map of a world — seas, coasts, plains,
 * forests, hills, mountains, deserts, ice — from seeded fractal noise
 * (elevation + moisture) and a latitude temperature gradient. Needs no
 * learned model, so any overland palette gets a usable map on first use;
 * water % and climate let one generator cover ocean worlds, deserts and
 * ice balls (the space presets set these per planet type).
 *
 * Terrain roles resolve by name, then category, so the Limited / Expanded
 * palettes and user palettes with similar names all work.
 */

export const PLANET_SURFACE_ID = "procedural:planet-surface";

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
}

export function planetRoles(terrains: TerrainColor[]): PlanetRoles | undefined {
  const sea = findTerrain(terrains, ["ocean", "sea", "water"], "sea");
  const plains = findTerrain(terrains, ["grass", "grassland", "plains", "lowland", "meadow"], "lowlands");
  if (!sea || !plains) return undefined;
  return {
    sea,
    plains,
    deep: findTerrain(terrains, ["trench", "deep ocean", "deep water", "abyss"]),
    shallows: findTerrain(terrains, ["shallows", "shallow water", "reef"]),
    beach: findTerrain(terrains, ["beach", "coast", "shore", "sand"], "coast"),
    forest: findTerrain(terrains, ["forest", "mixed forest", "woods"], "forest"),
    jungle: findTerrain(terrains, ["jungle", "rainforest"]),
    swamp: findTerrain(terrains, ["swamp", "marsh", "bog"], "bog"),
    hills: findTerrain(terrains, ["hills", "hill", "foothills"]),
    mountain: findTerrain(terrains, ["mountain", "mountains"], "mountain"),
    peak: findTerrain(terrains, ["peak", "mountains snow", "mountain snow", "snowy peak"]),
    snow: findTerrain(terrains, ["snow", "tundra", "ice", "glacier"], "snow"),
    desert: findTerrain(terrains, ["desert", "dunes", "desert rocky"], "desert"),
    badlands: findTerrain(terrains, ["badlands", "brokenlands", "wasteland"]),
    volcano: findTerrain(terrains, ["volcano", "volcanic"]),
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

export function planetSurface(
  terrains: TerrainColor[],
  grid: ProcGrid,
  seed: number,
  options: Record<string, string> = {},
): ProcResult {
  const roles = planetRoles(terrains);
  if (!roles) return { cells: new Map(), paths: [], warnings: ["This palette has no sea or plains terrain."] };
  const rand = mulberry32(seed);
  const elevNoise = makeNoise(rand);
  const moistNoise = makeNoise(rand);
  const water = Math.max(0, Math.min(95, Number(options.water ?? 50))) / 100;
  const climate = options.climate ?? "temperate";
  const relief = options.relief ?? "normal";

  const hexes = gridKeys(grid);
  // Feature scale: about 3 noise cells across the map whatever its size.
  const centers = hexes.map(([x, y]) => hexCenter(x, y, grid.orientation, grid.stagger));
  const xs = centers.map((c) => c[0]), ys = centers.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 3.2 / span;
  const ox = rand() * 100, oy = rand() * 100;

  const elev = centers.map(([px, py]) => elevNoise(ox + px * scale, oy + py * scale));
  const moist = centers.map(([px, py]) => moistNoise(oy + px * scale * 1.3, ox + py * scale * 1.3));
  const seaLevel = water <= 0 ? -Infinity : quantile(elev, water);
  const landElev = elev.filter((e) => e > seaLevel);
  const hillAt = quantile(landElev.length ? landElev : [1], relief === "flat" ? 0.88 : relief === "rugged" ? 0.5 : 0.7);
  const mountainAt = quantile(landElev.length ? landElev : [1], relief === "flat" ? 0.97 : relief === "rugged" ? 0.72 : 0.87);
  const peakAt = quantile(landElev.length ? landElev : [1], relief === "rugged" ? 0.92 : 0.97);
  const seaElev = elev.filter((e) => e <= seaLevel);
  const deepAt = quantile(seaElev.length ? seaElev : [0], 0.35);
  const shelfAt = quantile(seaElev.length ? seaElev : [0], 0.8);

  // Temperature: warm equator, cold poles (rows), shifted by climate.
  const climateShift: Record<string, number> = { temperate: 0, lush: 0.12, arid: 0.15, frozen: -0.55, volcanic: 0.3 };
  const moistShift: Record<string, number> = { temperate: 0, lush: 0.25, arid: -0.35, frozen: -0.1, volcanic: -0.2 };
  const tShift = climateShift[climate] ?? 0;
  const mShift = moistShift[climate] ?? 0;

  const cells = new Map<string, string>();
  const isSea: boolean[] = elev.map((e) => e <= seaLevel);
  const index = new Map(hexes.map(([x, y], i) => [cellKey(x, y), i]));

  hexes.forEach(([x, y], i) => {
    const k = cellKey(x, y);
    const e = elev[i];
    const lat = maxY > minY ? Math.abs((centers[i][1] - minY) / (maxY - minY) - 0.5) * 2 : 0; // 0 equator .. 1 pole
    const temp = 1 - lat * 0.9 + tShift - Math.max(0, e - seaLevel) * 0.6;
    const m = moist[i] + mShift;

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
    else if (e >= mountainAt) t = roles.mountain;
    else if (e >= hillAt) t = roles.hills;
    if (t && temp < 0.2 && roles.peak) t = roles.peak;
    if (!t) {
      if (temp < 0.22) t = roles.snow;
      else if (climate === "volcanic" && m < 0.45) t = roles.badlands ?? roles.desert;
      else if (m < 0.32 && temp > 0.45) t = roles.desert ?? roles.badlands;
      else if (m > 0.72 && temp > 0.75) t = roles.jungle ?? roles.forest;
      else if (m > 0.68 && e - seaLevel < 0.05) t = roles.swamp ?? roles.forest;
      else if (m > 0.5) t = roles.forest;
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

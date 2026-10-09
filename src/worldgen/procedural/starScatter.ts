import { mulberry32 } from "../../../packages/hex-wfc/src";
import { orbitsFits } from "./orbits";
import type { TerrainColor } from "../../types";
import {
  cellKey,
  distance,
  findRole,
  findTerrain,
  gridKeys,
  inCategory,
  ofType,
  typeIndex,
  untyped,
  weightedPick,
  type ProcGrid,
  type ProcOption,
  type ProcPath,
  type ProcResult,
} from "./common";

/**
 * Sector "star scatter": the classic subsector roll. Each hex holds a star
 * system with some probability (standard = 50%, the 4+ on 1d6 rule), typed
 * by its mainworld. A few nebula / dust patches thin out the systems inside
 * them, rare features (black hole, anomaly, deep-space station) are
 * sprinkled in, and nearby systems can be joined by jump routes.
 *
 * Works on any palette with a background terrain (type void, or "empty
 * space" / "void" / first `space` terrain) and at least one world (type
 * world / gas-giant / asteroids, or the `worlds` category, or a "star
 * system" terrain).
 */

export const STAR_SCATTER_ID = "procedural:star-scatter";

export const STAR_SCATTER_OPTIONS: ProcOption[] = [
  {
    key: "density",
    label: "System density",
    choices: [
      { value: "sparse", label: "Sparse (1 in 3)" },
      { value: "standard", label: "Standard (1 in 2)" },
      { value: "dense", label: "Dense (2 in 3)" },
      { value: "cluster", label: "Cluster (5 in 6)" },
    ],
    default: "standard",
  },
  {
    key: "clouds",
    label: "Nebulae",
    choices: [
      { value: "none", label: "None" },
      { value: "few", label: "A few" },
      { value: "many", label: "Many" },
    ],
    default: "few",
  },
  {
    key: "routes",
    label: "Jump routes",
    choices: [
      { value: "none", label: "None" },
      { value: "1", label: "Jump-1 (neighbours)" },
      { value: "2", label: "Jump-2" },
    ],
    default: "2",
  },
];

const DENSITY: Record<string, number> = { sparse: 1 / 3, standard: 1 / 2, dense: 2 / 3, cluster: 5 / 6 };

/** Rough mainworld mix for a habitable-ish sector. Unlisted world terrains weigh 1. */
const WORLD_WEIGHTS: Record<string, number> = {
  "garden world": 3,
  "desert world": 3,
  "barren world": 3.5,
  "ocean world": 2,
  "ice world": 2,
  "asteroid belt": 1.5,
  "molten world": 1,
  "gas giant": 1,
};

const FEATURE_WEIGHTS: Record<string, number> = {
  "deep-space station": 3,
  anomaly: 2,
  "black hole": 1,
};

export interface StarScatterRoles {
  background: string;
  worlds: string[];
  clouds: string[];
  features: string[];
}

/** Weights for typed terrains whose names aren't in the tables above. */
const WORLD_TYPE_WEIGHTS: Record<string, number> = { world: 2.5, "gas-giant": 1, asteroids: 1.5 };
const FEATURE_TYPE_WEIGHTS: Record<string, number> = { station: 3, anomaly: 1.5 };

/** Typed worlds that aren't a system's mainworld: comets, debris fields. */
const NOT_MAINWORLD = /comet|debris/i;

/**
 * Roles by type first (void / world, gas-giant, asteroids / nebula /
 * station, anomaly), then by name and category for untyped terrains. List
 * roles take both, so a half-typed palette still uses everything.
 */
export function starScatterRoles(terrains: TerrainColor[]): StarScatterRoles | undefined {
  const loose = untyped(terrains);
  const background = findRole(terrains, ["void"], ["empty space", "void", "deep space", "space"], "space");
  let worlds = [
    ...ofType(terrains, ["world", "gas-giant", "asteroids"]).filter((t) => !NOT_MAINWORLD.test(t)),
    ...inCategory(loose, "worlds"),
  ];
  if (worlds.length === 0) {
    const system = findRole(terrains, ["star"], ["star system", "system", "star"]);
    worlds = system ? [system] : [];
  }
  if (!background || worlds.length === 0) return undefined;
  const clouds = [
    ...ofType(terrains, ["nebula"]),
    ...inCategory(loose, "space").filter((t) => t !== background && !/rift/i.test(t)),
  ];
  const cloudNames = clouds.length ? clouds : [findTerrain(loose, ["nebula", "dust cloud"])].filter((t): t is string => !!t);
  const features = [
    ...ofType(terrains, ["station", "anomaly"]),
    ...inCategory(loose, "features").filter((t) => !/^star system$/i.test(t)),
  ];
  return { background, worlds, clouds: cloudNames, features };
}

/** Name weights, else the terrain's type weight; unknowns fall through to the default. */
function weightsFor(
  names: string[],
  types: Map<string, string>,
  byName: Record<string, number>,
  byType: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) {
    const k = n.toLowerCase();
    const w = byName[k] ?? byType[types.get(k) ?? ""];
    if (w !== undefined) out[k] = w;
  }
  return out;
}

export function starScatterFits(terrains: TerrainColor[]): boolean {
  return starScatterRoles(terrains) !== undefined;
}

export function starScatter(
  terrains: TerrainColor[],
  grid: ProcGrid,
  seed: number,
  options: Record<string, string> = {},
  jumpRouteType?: string,
): ProcResult {
  const roles = starScatterRoles(terrains);
  if (!roles) {
    return { cells: new Map(), paths: [], warnings: ["This palette has no space background or world terrains."] };
  }
  const rand = mulberry32(seed);
  const types = typeIndex(terrains);
  const worldWeights = weightsFor(roles.worlds, types, WORLD_WEIGHTS, WORLD_TYPE_WEIGHTS);
  const featureWeights = weightsFor(roles.features, types, FEATURE_WEIGHTS, FEATURE_TYPE_WEIGHTS);
  // Stations host a system (and so a route); black holes and anomalies don't.
  const hostsSystem = (t: string) => types.get(t.toLowerCase()) === "station" || /station/i.test(t);
  const density = DENSITY[options.density ?? "standard"] ?? 0.5;
  const hexes = gridKeys(grid);
  const cells = new Map<string, string>();
  for (const [x, y] of hexes) cells.set(cellKey(x, y), roles.background);

  // Nebula / dust patches: a few blobs grown from random seeds.
  const cloudCount = roles.clouds.length === 0 ? 0
    : options.clouds === "none" ? 0
    : Math.max(1, Math.round((hexes.length / 80) * (options.clouds === "many" ? 2.5 : 1)));
  const inCloud = new Set<string>();
  for (let c = 0; c < cloudCount; c++) {
    const center = hexes[Math.floor(rand() * hexes.length)];
    const radius = 1 + Math.floor(rand() * 2) + (rand() < 0.3 ? 1 : 0);
    const terrain = roles.clouds[Math.floor(rand() * roles.clouds.length)];
    for (const h of hexes) {
      const d = distance(center, h, grid);
      // Ragged edge: the outer ring is only partly filled.
      if (d < radius || (d === radius && rand() < 0.45)) {
        const k = cellKey(h[0], h[1]);
        cells.set(k, terrain);
        inCloud.add(k);
      }
    }
  }

  // Systems: one roll per hex; nebulae halve the odds.
  const systems: [number, number][] = [];
  for (const [x, y] of hexes) {
    const k = cellKey(x, y);
    const odds = inCloud.has(k) ? density / 2 : density;
    if (rand() >= odds) continue;
    const roll = rand();
    const feature = roles.features.length > 0 && roll < 0.04
      ? weightedPick(rand, roles.features, featureWeights)
      : undefined;
    cells.set(k, feature ?? weightedPick(rand, roles.worlds, worldWeights)!);
    if (!feature || hostsSystem(feature)) systems.push([x, y]);
  }

  // Jump routes: each system links to its nearest neighbour within range.
  const paths: ProcPath[] = [];
  const range = options.routes === "none" ? 0 : Number(options.routes ?? 2) || 0;
  const warnings: string[] = [];
  if (range > 0 && systems.length > 1) {
    if (!jumpRouteType) {
      warnings.push('No "Jump route" path type — routes skipped. Install the Space - Sector preset to add it.');
    } else {
      const seen = new Set<string>();
      for (const a of systems) {
        let best: [number, number] | undefined;
        let bestD = Infinity;
        for (const b of systems) {
          if (a === b) continue;
          const d = distance(a, b, grid);
          if (d <= range && d < bestD) { best = b; bestD = d; }
        }
        if (!best) continue;
        const ka = cellKey(a[0], a[1]), kb = cellKey(best[0], best[1]);
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(id)) continue;
        seen.add(id);
        paths.push({ type: jumpRouteType, hexes: [ka, kb] });
      }
    }
  }
  if (systems.length === 0) warnings.push("No systems rolled — try a higher density or another seed.");
  return { cells, paths, warnings };
}

/**
 * Offer Star scatter on sector-style palettes only. Once terrains are
 * typed, a system palette also "fits" (its bodies are world-typed), but
 * scattering planets across a star system makes no sense — so a palette
 * that Orbits fits (stars + bodies) is a system, not a sector.
 */
export function starScatterOffered(terrains: TerrainColor[]): boolean {
  return starScatterFits(terrains) && !orbitsFits(terrains);
}

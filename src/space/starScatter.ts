import { mulberry32 } from "../../packages/hex-wfc/src";
import { orbitsFits } from "./orbits";
import { roleOdds, rollRole, type TableSource } from "../worldgen/tableRoles";
import type { TerrainColor } from "../types";
import {
  cellKey,
  distance,
  gridKeys,
  ofType,
  typeIndex,
  type ProcGrid,
  type ProcOption,
  type ProcPath,
  type ProcResult,
  type TuningDef,
  tuned,
} from "../worldgen/procedural/common";

/**
 * Sector "star scatter": the classic subsector roll. Each hex holds a star
 * system with some probability (standard = 50%, the 4+ on 1d6 rule). What
 * each system hex is (its mainworld, or a special hex like a station) is
 * rolled on the Sector hexes role (tableRoles.ts): the World types table
 * when one is given, else equal odds over the palette's world terrains.
 * A few nebula / dust patches thin out the systems inside them, and nearby
 * systems can be joined by jump routes.
 *
 * Works on any palette with a background terrain (type void) and at least
 * one world (type world / gas-giant / asteroids, or a star-system terrain).
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

/** Star scatter's tuning sliders (setup wizard Advanced). */
export const STAR_SCATTER_TUNING: readonly TuningDef[] = [
  { key: "density", label: "More systems", help: "Percentage points added to (or taken from) the System density odds.", min: -30, max: 30, step: 5, default: 0 },
  { key: "nebulaAmount", label: "Nebula amount", help: "How many nebulae, times the Nebulae choice. 0 = none.", min: 0, max: 4, step: 0.25, default: 1 },
  { key: "nebulaSize", label: "Nebula size", help: "The smallest nebula radius, in hexes.", min: 0, max: 4, step: 1, default: 1 },
  { key: "nebulaEdge", label: "Nebula edge fill", help: "How much of each nebula's outer ring is filled. Lower gives ragged clouds.", min: 0, max: 1, step: 0.05, default: 0.45 },
  { key: "inNebula", label: "Systems in nebulae", help: "Odds of a system inside a nebula, as a share of the odds outside.", min: 0, max: 1, step: 0.05, default: 0.5 },
];

export interface StarScatterRoles {
  background: string;
  worlds: string[];
  clouds: string[];
  features: string[];
}

/** Feature types that host a system (and so a jump route). */
const HOSTS_SYSTEM = new Set(["station", "starport", "jump-point"]);

/**
 * Roles by terrain type only: void (background), world / gas-giant /
 * asteroids (mainworlds; comets and debris have their own types and are
 * left out), nebula (clouds), station / starport / jump point / anomaly
 * (features). With no worlds, a star-system (or star) terrain marks the
 * systems. Names and categories play no part; untyped terrains are unused.
 */
export function starScatterRoles(terrains: TerrainColor[]): StarScatterRoles | undefined {
  const background = ofType(terrains, ["void"])[0];
  let worlds = ofType(terrains, ["world", "gas-giant", "asteroids"]);
  if (worlds.length === 0) {
    const system = ofType(terrains, ["star-system"])[0] ?? ofType(terrains, ["star"])[0];
    worlds = system ? [system] : [];
  }
  if (!background || worlds.length === 0) return undefined;
  const clouds = ofType(terrains, ["nebula"]);
  const features = ofType(terrains, ["station", "starport", "jump-point", "anomaly"]);
  return { background, worlds, clouds, features };
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
  /** The role tables (World types); none = equal odds over the palette's worlds, said in the warnings. */
  tables?: TableSource,
): ProcResult {
  const roles = starScatterRoles(terrains);
  if (!roles) {
    return { cells: new Map(), paths: [], warnings: ["This palette has no space background or world terrains."] };
  }
  const rand = mulberry32(seed);
  const types = typeIndex(terrains);
  const warnings: string[] = [...roleOdds(tables, "sector-hexes", {}, roles.worlds).notes];
  // Stations host a system (and so a route); black holes and anomalies don't.
  const hostsSystem = (t: string) => HOSTS_SYSTEM.has(types.get(t.toLowerCase()) ?? "");
  const isFeature = (t: string) => roles.features.some((f) => f.toLowerCase() === t.toLowerCase());
  const moreSystems = tuned(options, "density", 0);
  const density = moreSystems
    ? Math.min(1, Math.max(0, (DENSITY[options.density ?? "standard"] ?? 0.5) + moreSystems / 100))
    : DENSITY[options.density ?? "standard"] ?? 0.5;
  const nebulaAmount = tuned(options, "nebulaAmount", 1);
  const hexes = gridKeys(grid);
  const cells = new Map<string, string>();
  for (const [x, y] of hexes) cells.set(cellKey(x, y), roles.background);

  // Nebula / dust patches: a few blobs grown from random seeds.
  const cloudCount = roles.clouds.length === 0 ? 0
    : options.clouds === "none" || nebulaAmount <= 0 ? 0
    : Math.max(1, Math.round((hexes.length / 80) * (options.clouds === "many" ? 2.5 : 1) * nebulaAmount));
  const nebulaSize = Math.round(tuned(options, "nebulaSize", 1));
  const nebulaEdge = tuned(options, "nebulaEdge", 0.45);
  const inNebula = tuned(options, "inNebula", 0.5);
  const inCloud = new Set<string>();
  for (let c = 0; c < cloudCount; c++) {
    const center = hexes[Math.floor(rand() * hexes.length)];
    const radius = nebulaSize + Math.floor(rand() * 2) + (rand() < 0.3 ? 1 : 0);
    const terrain = roles.clouds[Math.floor(rand() * roles.clouds.length)];
    for (const h of hexes) {
      const d = distance(center, h, grid);
      // Ragged edge: the outer ring is only partly filled.
      if (d < radius || (d === radius && rand() < nebulaEdge)) {
        const k = cellKey(h[0], h[1]);
        cells.set(k, terrain);
        inCloud.add(k);
      }
    }
  }

  // Systems: one roll per hex; nebulae halve the odds.
  const systems: [number, number][] = [];
  const arrivals = new Map<string, string>();
  for (const [x, y] of hexes) {
    const k = cellKey(x, y);
    const odds = inCloud.has(k) ? density * inNebula : density;
    if (rand() >= odds) continue;
    const pick = rollRole(tables, "sector-hexes", { rand, deferArrival: true, where: k }, roles.worlds);
    // A (nothing) row: empty space after all.
    if (!pick || pick.nothing) continue;
    if (pick.arrival) {
      // Rolled when someone arrives: until then the hex shows its Shown as
      // terrain (or stays background), and hosts a system for the routes.
      arrivals.set(k, pick.arrival);
      if (pick.terrain) cells.set(k, pick.terrain);
      systems.push([x, y]);
      continue;
    }
    cells.set(k, pick.terrain);
    // A world hosts a system (and so a route); of the rest, only station-like types do.
    if (!isFeature(pick.terrain) || hostsSystem(pick.terrain)) systems.push([x, y]);
  }

  // Jump routes: each system links to its nearest neighbour within range.
  const paths: ProcPath[] = [];
  const range = options.routes === "none" ? 0 : Number(options.routes ?? 2) || 0;
  if (range > 0 && systems.length > 1) {
    if (!jumpRouteType) {
      warnings.push("No path type for routes, so none were drawn. Pick one under Path type for routes (or add a path type to the palette).");
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
  return arrivals.size ? { cells, paths, warnings, arrivals } : { cells, paths, warnings };
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

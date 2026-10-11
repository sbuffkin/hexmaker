/**
 * The shipped "Default space" world types table, as DATA: written into a
 * note once (WorldTypeStore), then the note is what counts. Nothing here
 * is read at run time except to seed a missing note and for "Restore
 * default".
 *
 * It reproduces, exactly, the world odds Star scatter and Orbits had built
 * in (their name tables for the shipped Space palettes) and the shipped
 * palettes' submap defaults:
 *  - sector rows: Star scatter's mainworld weights (garden 3, ocean 2, …),
 *    each opening as a 13×13 Orbits system on Space - System;
 *  - system rows: Orbits' zone weights per body (a body a zone didn't list
 *    weighed 0.5 there), the rocky ones opening as 20×14 Planet surface
 *    maps tuned to the planet;
 *  - the moon (weight 0: Orbits puts moons beside planets, it never rolls
 *    them) for its map setup;
 *  - Stars: Orbits' random star weights (red dwarfs dominate);
 *  - Sector features: Star scatter's special hexes, 1 in 25 star system
 *    hexes split 3 : 2 : 1 between station, anomaly and black hole.
 * tests/worldTypes.test.ts holds a frozen copy of the old tables and
 * checks this against it.
 *
 * Pure: no Obsidian imports.
 */

import type { OrbitZone, SectorFeatureRow, StarTypeRow, WorldTypeRow } from "./worldTypes";

const SYSTEM_PALETTE = "Space - System";
const SURFACE_PALETTE = "Space - Planet";

const system = (world: string, weight: number): WorldTypeRow => ({
  world,
  weight,
  map: "sector",
  size: { cols: { lo: 13, hi: 13 }, rows: { lo: 13, hi: 13 } },
  generator: { id: "procedural:orbits" },
  palette: SYSTEM_PALETTE,
  baseTerrain: "void",
});

type Surface = Pick<WorldTypeRow, "size" | "generator" | "options" | "palette" | "baseTerrain">;
const surface = (water: string, climate: string, base: string, relief = "normal"): Surface => ({
  size: { cols: { lo: 20, hi: 20 }, rows: { lo: 14, hi: 14 } },
  generator: { id: "procedural:planet-surface" },
  options: { water, climate, relief },
  palette: SURFACE_PALETTE,
  baseTerrain: base,
});

/** One body's rows: its weight per zone (zones with the same weight share a row). */
function body(world: string, w: Record<OrbitZone, number>, setup: Surface = {}): WorldTypeRow[] {
  const zones: OrbitZone[] = ["inner", "habitable", "outer"];
  const out: WorldTypeRow[] = [];
  const done = new Set<OrbitZone>();
  for (const z of zones) {
    if (done.has(z)) continue;
    const same = zones.filter((o) => !done.has(o) && w[o] === w[z]);
    same.forEach((o) => done.add(o));
    out.push({ world, weight: w[z], map: "system", zones: same, ...setup });
  }
  return out;
}

export const DEFAULT_WORLD_TYPE_ROWS: readonly WorldTypeRow[] = [
  // Sector: a hex's star system, typed by its mainworld (Star scatter).
  system("garden world", 3),
  system("ocean world", 2),
  system("desert world", 3),
  system("ice world", 2),
  system("barren world", 3.5),
  system("molten world", 1),
  system("asteroid belt", 1.5),
  system("gas giant", 1),
  // System: one body per orbit, by zone (Orbits).
  ...body("terrestrial planet", { inner: 0.5, habitable: 4, outer: 0.5 }, surface("65", "temperate", "ocean")),
  ...body("ocean planet", { inner: 0.5, habitable: 3, outer: 0.5 }, surface("85", "lush", "ocean")),
  ...body("desert planet", { inner: 2, habitable: 3, outer: 0.5 }, surface("10", "arid", "dunes")),
  ...body("ice planet", { inner: 0.5, habitable: 0.5, outer: 3 }, surface("30", "frozen", "ocean")),
  ...body("rocky planet", { inner: 4, habitable: 2, outer: 1 }, surface("10", "arid", "regolith", "rugged")),
  ...body("molten planet", { inner: 4, habitable: 0.5, outer: 0.5 }, surface("10", "volcanic", "regolith", "rugged")),
  ...body("gas giant", { inner: 0.5, habitable: 0.5, outer: 4 }),
  ...body("ice giant", { inner: 0.5, habitable: 0.5, outer: 3 }),
  ...body("asteroid belt", { inner: 0.5, habitable: 1, outer: 1.5 }),
  { world: "moon", weight: 0, map: "system", ...surface("10", "frozen", "regolith", "rugged"), notes: "placed beside planets, never rolled" },
];

/** Orbits' random star (its old built-in weights). */
export const DEFAULT_STAR_ROWS: readonly StarTypeRow[] = [
  { star: "red dwarf", weight: 6 },
  { star: "yellow star", weight: 3 },
  { star: "brown dwarf", weight: 1.5 },
  { star: "white dwarf", weight: 1 },
  { star: "blue giant", weight: 0.5 },
];

/**
 * Star scatter's special hexes: it made 4% (1 in 25) of star system hexes
 * a feature, split 3 : 2 : 1 by weight. As chances per hex that is exactly
 * 1 in 50, 1 in 75 and 1 in 150.
 */
export const DEFAULT_SECTOR_FEATURE_ROWS: readonly SectorFeatureRow[] = [
  { feature: "deep-space station", chance: 1 / 50 },
  { feature: "anomaly", chance: 1 / 75 },
  { feature: "black hole", chance: 1 / 150 },
];

/** The shipped Stars and Sector features tables, together. */
export const DEFAULT_WORLD_TYPE_EXTRAS = {
  get stars(): StarTypeRow[] { return DEFAULT_STAR_ROWS.map((r) => ({ ...r })); },
  get features(): SectorFeatureRow[] { return DEFAULT_SECTOR_FEATURE_ROWS.map((r) => ({ ...r })); },
};

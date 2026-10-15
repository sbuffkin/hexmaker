/**
 * The Space module's palette presets (Space - Sector, System and Planet):
 * terrains, path types, the generator path roles and the submap defaults
 * that open a sector hex as a star system and a planet as its surface.
 * Pure data.
 */

import type { PathType, SubmapDefault, TerrainColor } from "../../types";
import type { PalettePreset } from "../../palettes/presets";

export const SPACE_SECTOR_PALETTE_NAME = "Space - Sector";
export const SPACE_SYSTEM_PALETTE_NAME = "Space - System";
export const SPACE_PLANET_PALETTE_NAME = "Space - Planet";

// Sector scale (Traveller subsector / sector chart): one hex is one parsec
// and holds at most one star system, typed by its mainworld. Drill into a
// hex with a "Space - System" submap for the system itself.
export const SPACE_SECTOR_TERRAINS: TerrainColor[] = [
  // Space
  { name: "empty space", type: "void", color: "#0b1020", category: "space" },
  { name: "nebula", type: "nebula", color: "#3b2a5c", category: "space" },
  { name: "dust cloud", type: "nebula", color: "#4a3b33", icon: "space-dust-cloud.svg", iconColor: "#f5e6d3", category: "space" },
  { name: "rift", type: "rift", color: "#020308", icon: "space-portal.svg", iconColor: "#a78bfa", category: "space" },
  // Worlds — mainworld type of the system in the hex
  { name: "garden world", type: "world", color: "#3f8f5a", icon: "space-world.svg", iconColor: "#ecfdf5", category: "worlds" },
  { name: "ocean world", type: "world", color: "#2e6fa8", icon: "space-water-world.svg", iconColor: "#e0f2fe", category: "worlds" },
  { name: "desert world", type: "world", color: "#b8924f", icon: "space-ring-segments.svg", iconColor: "#1c1917", category: "worlds" },
  { name: "ice world", type: "world", color: "#9cc3d9", icon: "space-frozen-orb.svg", iconColor: "#0f172a", category: "worlds" },
  { name: "barren world", type: "world", color: "#6e6c74", icon: "space-moon.svg", iconColor: "#f4f4f5", category: "worlds" },
  { name: "molten world", type: "world", color: "#a8402a", icon: "space-planet-core.svg", iconColor: "#fde68a", category: "worlds" },
  { name: "asteroid belt", type: "asteroids", color: "#5e554d", icon: "space-asteroid.png", iconColor: "#e7e5e4", category: "worlds" },
  { name: "gas giant", type: "gas-giant", color: "#b07d45", icon: "space-ringed-planet.svg", iconColor: "#fff7ed", category: "worlds" },
  // Points of interest
  { name: "star system", type: "star-system", color: "#c9a227", icon: "space-orbit.svg", iconColor: "#fff7d6", category: "features" },
  { name: "deep-space station", type: "station", color: "#7d8794", icon: "space-orbital.svg", iconColor: "#f8fafc", category: "features" },
  { name: "black hole", type: "anomaly", color: "#000000", icon: "space-target-outline.svg", iconColor: "#a78bfa", category: "features" },
  { name: "anomaly", type: "anomaly", color: "#7c3aad", icon: "space-anomaly.svg", iconColor: "#f5d0fe", category: "features" },
];

// System scale: the hexes around one star. Bodies, belts, and installations.
export const SPACE_SYSTEM_TERRAINS: TerrainColor[] = [
  // Space
  { name: "void", type: "void", color: "#05070f", category: "space" },
  { name: "nebula", type: "nebula", color: "#3b2a5c", category: "space" },
  { name: "jump limit", type: "jump-limit", color: "#1d1838", icon: "space-ring-dashed.svg", iconColor: "#c4b5fd", category: "space" },
  // Stars
  { name: "yellow star", type: "star", color: "#f2c94c", icon: "space-sun.svg", iconColor: "#7c2d12", category: "stars" },
  { name: "red dwarf", type: "star", color: "#d9573b", icon: "space-sun.svg", iconColor: "#fde68a", category: "stars" },
  { name: "blue giant", type: "star", color: "#79a8ff", icon: "space-sun.svg", iconColor: "#eff6ff", category: "stars" },
  { name: "white dwarf", type: "star", color: "#e3e9f7", icon: "space-sun.svg", iconColor: "#475569", category: "stars" },
  { name: "brown dwarf", type: "star", color: "#6f4434", icon: "space-sun.svg", iconColor: "#fcd9b6", category: "stars" },
  // Bodies
  { name: "terrestrial planet", type: "world", color: "#3f8f5a", icon: "space-world.svg", iconColor: "#ecfdf5", category: "bodies" },
  { name: "ocean planet", type: "world", color: "#2e6fa8", icon: "space-water-world.svg", iconColor: "#e0f2fe", category: "bodies" },
  { name: "desert planet", type: "world", color: "#b8924f", icon: "space-ring-segments.svg", iconColor: "#1c1917", category: "bodies" },
  { name: "ice planet", type: "world", color: "#9cc3d9", icon: "space-frozen-orb.svg", iconColor: "#0f172a", category: "bodies" },
  { name: "rocky planet", type: "world", color: "#7a7068", icon: "space-stone-sphere.svg", iconColor: "#f4f4f5", category: "bodies" },
  { name: "molten planet", type: "world", color: "#a8402a", icon: "space-planet-core.svg", iconColor: "#fde68a", category: "bodies" },
  { name: "gas giant", type: "gas-giant", color: "#b07d45", icon: "space-ringed-planet.svg", iconColor: "#fff7ed", category: "bodies" },
  { name: "ice giant", type: "gas-giant", color: "#5f9fb8", icon: "space-frozen-orb.svg", iconColor: "#ecfeff", category: "bodies" },
  { name: "moon", type: "moon", color: "#9a9aa2", icon: "space-moon.svg", iconColor: "#111827", category: "bodies" },
  { name: "asteroid belt", type: "asteroids", color: "#5e554d", icon: "space-asteroid.png", iconColor: "#e7e5e4", category: "bodies" },
  { name: "comet", type: "comet", color: "#8fb3c4", icon: "space-meteor.svg", iconColor: "#0f172a", category: "bodies" },
  // Installations
  { name: "space station", type: "station", color: "#7d8794", icon: "space-orbital.svg", iconColor: "#f8fafc", category: "installations" },
  { name: "starport", type: "starport", color: "#c0c7cf", icon: "space-star-gate.svg", iconColor: "#111827", category: "installations" },
  { name: "jump point", type: "jump-point", color: "#5b3fc4", icon: "space-portal.svg", iconColor: "#ede9fe", category: "installations" },
  // Hazards
  { name: "debris field", type: "debris", color: "#4d4640", icon: "space-dots-hex.svg", iconColor: "#e7e5e4", category: "hazards" },
  { name: "radiation belt", type: "anomaly", color: "#7d6a1f", icon: "space-radioactive.svg", iconColor: "#fef08a", category: "hazards" },
];

// Planet scale: one world's surface, opened from a planet or moon in a
// system. Land terrains with the overland types (water, grassland, desert…)
// so the Planet surface generator places them; the rest are for painting.
// Space content all the same (kind "space"), so a space-only setup gets a
// surface palette without the fantasy ones.
export const SPACE_PLANET_TERRAINS: TerrainColor[] = [
  // Seas
  { name: "deep ocean", type: "deep-water", color: "#10233f", category: "seas" },
  { name: "ocean", type: "water", color: "#245a87", category: "seas" },
  { name: "shallows", type: "shallows", color: "#3f86a3", category: "seas" },
  { name: "shore", type: "coast", color: "#b9ad84", category: "seas" },
  // Living ground
  { name: "plains", type: "grassland", color: "#6f9a5a", icon: "bw-grassland.png", category: "living" },
  { name: "forest", type: "forest", color: "#2f6b4a", icon: "bw-forest.png", category: "living" },
  { name: "jungle", type: "jungle", color: "#1f6b3a", icon: "bw-jungle.png", category: "living" },
  { name: "toxic marsh", type: "wetland", color: "#7d8f2a", icon: "bw-swamp.png", iconColor: "#f7fee7", category: "living" },
  // Barren ground
  { name: "regolith", type: "badlands", color: "#8a8178", icon: "bw-desert-rocky.png", category: "barren" },
  { name: "bare rock", type: "badlands", color: "#6b6560", icon: "bw-brokenlands.png", category: "barren" },
  { name: "dunes", type: "desert", color: "#d6b46a", icon: "bw-dunes.png", category: "barren" },
  { name: "ice", type: "snow", color: "#dbeaf5", category: "barren" },
  // Relief
  { name: "hills", type: "hills", color: "#a49a72", icon: "bw-hills.png", category: "relief" },
  { name: "crater field", type: "hills", color: "#7b7268", icon: "space-ring.svg", iconColor: "#f5f5f4", category: "relief" },
  { name: "mountains", type: "mountains", color: "#7a6a58", icon: "bw-mountains.png", category: "relief" },
  { name: "peaks", type: "peaks", color: "#c9d3dc", icon: "bw-mountains-snow.png", category: "relief" },
  // Strange ground and sites
  { name: "lava field", type: "volcanic", color: "#8f2d1c", icon: "bw-volcano.png", iconColor: "#fde68a", category: "strange" },
  { name: "crystal field", type: "badlands", color: "#6d5bb5", icon: "space-twinkle.svg", iconColor: "#ede9fe", category: "strange" },
  { name: "ruins", type: "settlement", color: "#8c7b6b", icon: "space-debris.svg", iconColor: "#fafaf9", category: "sites" },
  { name: "colony", type: "settlement", color: "#9ca3af", icon: "space-beacon-outline.svg", iconColor: "#111827", category: "sites" },
];

// Sector-scale "roads".
export const SPACE_PATH_TYPES: PathType[] = [
  { name: "Jump route", color: "#60a5fa", width: 2, lineStyle: "dashed", routing: "through", avoidImpassable: true, autoRoute: "direct" },
  { name: "Trade route", color: "#f59e0b", width: 3, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" },
];

// System-scale: faint dotted rings the Orbits generator draws around the star.
export const SYSTEM_PATH_TYPES: PathType[] = [
  { name: "Orbit", color: "#3b4a6b", width: 1, lineStyle: "dotted", routing: "through", avoidImpassable: true, autoRoute: "direct" },
];

// Drilling down: every system in a sector opens as an Orbits star system…
const SYSTEM_SUBMAP: SubmapDefault = {
  palette: SPACE_SYSTEM_PALETTE_NAME,
  cols: 13,
  rows: 13,
  generator: "procedural:orbits",
  baseTerrain: "void",
};
const SECTOR_SUBMAP_DEFAULTS: Record<string, SubmapDefault> = Object.fromEntries(
  ["garden world", "ocean world", "desert world", "ice world", "barren world", "molten world",
    "asteroid belt", "gas giant", "star system"].map((t) => [t, { ...SYSTEM_SUBMAP }]),
);

// …and every rocky world in a system opens as a planet-surface map on
// Space - Planet, tuned to the planet type. The sea (or dunes, or
// regolith) is the base terrain.
const surface = (water: string, climate: string, base: string, relief = "normal"): SubmapDefault => ({
  palette: SPACE_PLANET_PALETTE_NAME,
  cols: 20,
  rows: 14,
  generator: "procedural:planet-surface",
  options: { water, climate, relief },
  baseTerrain: base,
});
const SYSTEM_SUBMAP_DEFAULTS: Record<string, SubmapDefault> = {
  "terrestrial planet": surface("65", "temperate", "ocean"),
  "ocean planet": surface("85", "lush", "ocean"),
  "desert planet": surface("10", "arid", "dunes"),
  "ice planet": surface("30", "frozen", "ocean"),
  "rocky planet": surface("10", "arid", "regolith", "rugged"),
  "molten planet": surface("10", "volcanic", "regolith", "rugged"),
  moon: surface("10", "frozen", "regolith", "rugged"),
};

export const SPACE_PRESETS: PalettePreset[] = [
  {
    name: SPACE_SECTOR_PALETTE_NAME,
    description: "Star charts: one hex per parsec, typed by mainworld. Adds jump and trade route path types.",
    terrains: SPACE_SECTOR_TERRAINS,
    pathTypes: SPACE_PATH_TYPES,
    pathRoles: { routes: SPACE_PATH_TYPES[0].name },
    childPalette: SPACE_SYSTEM_PALETTE_NAME,
    kind: "space",
    submapDefaults: SECTOR_SUBMAP_DEFAULTS,
  },
  {
    name: SPACE_SYSTEM_PALETTE_NAME,
    description: "A single star system: stars, planets, belts, stations, and hazards. Adds an Orbit path type.",
    terrains: SPACE_SYSTEM_TERRAINS,
    pathTypes: SYSTEM_PATH_TYPES,
    pathRoles: { orbits: SYSTEM_PATH_TYPES[0].name },
    kind: "space",
    submapDefaults: SYSTEM_SUBMAP_DEFAULTS,
  },
  {
    name: SPACE_PLANET_PALETTE_NAME,
    description: "A planet's surface: seas, plains, regolith, dunes, ice, craters, lava fields, toxic marsh, crystal fields, ruins and colonies. Typed for the Planet surface generator.",
    terrains: SPACE_PLANET_TERRAINS,
    kind: "space",
  },
];

import type { PathType, TerrainColor, TerrainPalette } from "../types";
import {
  DEFAULT_TERRAIN_PALETTE,
  EXPANDED_PALETTE_NAME,
  LIMITED_PALETTE_NAME,
  LIMITED_TERRAIN_PALETTE,
} from "../constants";

/**
 * A built-in palette users can install from "Add palette", the setup wizard,
 * or any new-map palette dropdown. Installing copies the terrains into a new
 * palette note and merges any preset path types (by name) into settings.
 */
export interface PalettePreset {
  name: string;
  description: string;
  terrains: TerrainColor[];
  pathTypes?: PathType[];
  /** Palette suggested for submaps of maps using this one. */
  childPalette?: string;
}

export const SPACE_SECTOR_PALETTE_NAME = "Space - Sector";
export const SPACE_SYSTEM_PALETTE_NAME = "Space - System";

// Sector scale (Traveller subsector / sector chart): one hex is one parsec
// and holds at most one star system, typed by its mainworld. Drill into a
// hex with a "Space - System" submap for the system itself.
export const SPACE_SECTOR_TERRAINS: TerrainColor[] = [
  // Space
  { name: "empty space", color: "#0b1020", category: "space" },
  { name: "nebula", color: "#3b2a5c", category: "space" },
  { name: "dust cloud", color: "#4a3b33", icon: "space-dust-cloud.svg", iconColor: "#f5e6d3", category: "space" },
  { name: "rift", color: "#020308", icon: "space-portal.svg", iconColor: "#a78bfa", category: "space" },
  // Worlds — mainworld type of the system in the hex
  { name: "garden world", color: "#3f8f5a", icon: "space-world.svg", iconColor: "#ecfdf5", category: "worlds" },
  { name: "ocean world", color: "#2e6fa8", icon: "space-water-world.svg", iconColor: "#e0f2fe", category: "worlds" },
  { name: "desert world", color: "#b8924f", icon: "space-ring-segments.svg", iconColor: "#1c1917", category: "worlds" },
  { name: "ice world", color: "#9cc3d9", icon: "space-frozen-orb.svg", iconColor: "#0f172a", category: "worlds" },
  { name: "barren world", color: "#6e6c74", icon: "space-moon.svg", iconColor: "#f4f4f5", category: "worlds" },
  { name: "molten world", color: "#a8402a", icon: "space-planet-core.svg", iconColor: "#fde68a", category: "worlds" },
  { name: "asteroid belt", color: "#5e554d", icon: "space-asteroid.png", iconColor: "#e7e5e4", category: "worlds" },
  { name: "gas giant", color: "#b07d45", icon: "space-ringed-planet.svg", iconColor: "#fff7ed", category: "worlds" },
  // Points of interest
  { name: "star system", color: "#c9a227", icon: "space-orbit.svg", iconColor: "#fff7d6", category: "features" },
  { name: "deep-space station", color: "#7d8794", icon: "space-orbital.svg", iconColor: "#f8fafc", category: "features" },
  { name: "black hole", color: "#000000", icon: "space-target-outline.svg", iconColor: "#a78bfa", category: "features" },
  { name: "anomaly", color: "#7c3aad", icon: "space-anomaly.svg", iconColor: "#f5d0fe", category: "features" },
];

// System scale: the hexes around one star. Bodies, belts, and installations.
export const SPACE_SYSTEM_TERRAINS: TerrainColor[] = [
  // Space
  { name: "void", color: "#05070f", category: "space" },
  { name: "nebula", color: "#3b2a5c", category: "space" },
  { name: "jump limit", color: "#1d1838", icon: "space-ring-dashed.svg", iconColor: "#c4b5fd", category: "space" },
  // Stars
  { name: "yellow star", color: "#f2c94c", icon: "space-sun.svg", iconColor: "#7c2d12", category: "stars" },
  { name: "red dwarf", color: "#d9573b", icon: "space-sun.svg", iconColor: "#fde68a", category: "stars" },
  { name: "blue giant", color: "#79a8ff", icon: "space-sun.svg", iconColor: "#eff6ff", category: "stars" },
  { name: "white dwarf", color: "#e3e9f7", icon: "space-sun.svg", iconColor: "#475569", category: "stars" },
  { name: "brown dwarf", color: "#6f4434", icon: "space-sun.svg", iconColor: "#fcd9b6", category: "stars" },
  // Bodies
  { name: "terrestrial planet", color: "#3f8f5a", icon: "space-world.svg", iconColor: "#ecfdf5", category: "bodies" },
  { name: "ocean planet", color: "#2e6fa8", icon: "space-water-world.svg", iconColor: "#e0f2fe", category: "bodies" },
  { name: "desert planet", color: "#b8924f", icon: "space-ring-segments.svg", iconColor: "#1c1917", category: "bodies" },
  { name: "ice planet", color: "#9cc3d9", icon: "space-frozen-orb.svg", iconColor: "#0f172a", category: "bodies" },
  { name: "rocky planet", color: "#7a7068", icon: "space-stone-sphere.svg", iconColor: "#f4f4f5", category: "bodies" },
  { name: "molten planet", color: "#a8402a", icon: "space-planet-core.svg", iconColor: "#fde68a", category: "bodies" },
  { name: "gas giant", color: "#b07d45", icon: "space-ringed-planet.svg", iconColor: "#fff7ed", category: "bodies" },
  { name: "ice giant", color: "#5f9fb8", icon: "space-frozen-orb.svg", iconColor: "#ecfeff", category: "bodies" },
  { name: "moon", color: "#9a9aa2", icon: "space-moon.svg", iconColor: "#111827", category: "bodies" },
  { name: "asteroid belt", color: "#5e554d", icon: "space-asteroid.png", iconColor: "#e7e5e4", category: "bodies" },
  { name: "comet", color: "#8fb3c4", icon: "space-meteor.svg", iconColor: "#0f172a", category: "bodies" },
  // Installations
  { name: "space station", color: "#7d8794", icon: "space-orbital.svg", iconColor: "#f8fafc", category: "installations" },
  { name: "starport", color: "#c0c7cf", icon: "space-star-gate.svg", iconColor: "#111827", category: "installations" },
  { name: "jump point", color: "#5b3fc4", icon: "space-portal.svg", iconColor: "#ede9fe", category: "installations" },
  // Hazards
  { name: "debris field", color: "#4d4640", icon: "space-dots-hex.svg", iconColor: "#e7e5e4", category: "hazards" },
  { name: "radiation belt", color: "#7d6a1f", icon: "space-radioactive.svg", iconColor: "#fef08a", category: "hazards" },
];

// Sector-scale "roads".
export const SPACE_PATH_TYPES: PathType[] = [
  { name: "Jump route", color: "#60a5fa", width: 2, lineStyle: "dashed", routing: "through" },
  { name: "Trade route", color: "#f59e0b", width: 3, lineStyle: "solid", routing: "through" },
];

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    name: LIMITED_PALETTE_NAME,
    description: "A small fantasy overland set: ocean, grass, hills, forest, mountains, desert, snow.",
    terrains: LIMITED_TERRAIN_PALETTE,
  },
  {
    name: EXPANDED_PALETTE_NAME,
    description: "The full fantasy overland set with forests, mountains, wetlands, coasts, and more.",
    terrains: DEFAULT_TERRAIN_PALETTE,
  },
  {
    name: SPACE_SECTOR_PALETTE_NAME,
    description: "Star charts: one hex per parsec, typed by mainworld. Adds jump and trade route path types.",
    terrains: SPACE_SECTOR_TERRAINS,
    pathTypes: SPACE_PATH_TYPES,
    childPalette: SPACE_SYSTEM_PALETTE_NAME,
  },
  {
    name: SPACE_SYSTEM_PALETTE_NAME,
    description: "A single star system: stars, planets, belts, stations, and hazards.",
    terrains: SPACE_SYSTEM_TERRAINS,
  },
];

export function getPreset(name: string): PalettePreset | undefined {
  return PALETTE_PRESETS.find((p) => p.name === name);
}

/** Deep copy of a preset's terrains, safe to mutate. */
export function presetToPalette(preset: PalettePreset, name = preset.name): TerrainPalette {
  const pal: TerrainPalette = { name, terrains: preset.terrains.map((t) => ({ ...t })) };
  if (preset.childPalette) pal.childPalette = preset.childPalette;
  return pal;
}

/** `base`, or `base 2`, `base 3`, … — first name not taken (case-insensitive). */
export function uniquePaletteName(base: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Append preset path types whose names aren't already present. Returns the
 * names that were added, so callers can tell the user.
 */
export function mergePathTypes(existing: PathType[], incoming: PathType[] | undefined): string[] {
  const added: string[] = [];
  const have = new Set(existing.map((p) => p.name.toLowerCase()));
  for (const pt of incoming ?? []) {
    if (have.has(pt.name.toLowerCase())) continue;
    existing.push({ ...pt });
    have.add(pt.name.toLowerCase());
    added.push(pt.name);
  }
  return added;
}

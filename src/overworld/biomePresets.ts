/**
 * The shipped biomes as preset DATA (#50): written into biome notes once by
 * BiomeStore (seedBiomeNotes), then the notes are what counts. Nothing here
 * is read at run time except to seed a missing note and for "Restore
 * default".
 *
 * Mixes are each biome's terrain-type shares (percent) from the shipped
 * generator it used to borrow its mix from (src/worldgen/builtin), fitted
 * to the Expanded palette; transitions are the old ecotone table; colours
 * are the Expanded terrain each biome painted.
 *
 * Pure: no Obsidian imports.
 */

import type { BiomeNoteFields } from "./biomeNote";

export const BIOME_PRESETS: readonly BiomeNoteFields[] = [
  { id: "tundra", label: "Tundra", color: "#e0f2fe", mix: [{ type: "snow", weight: 26 }, { type: "hills", weight: 21 }, { type: "grassland", weight: 21 }, { type: "water", weight: 10 }, { type: "peaks", weight: 6 }, { type: "wetland", weight: 6 }, { type: "desert", weight: 4 }, { type: "forest", weight: 3 }, { type: "mountains", weight: 3 }], transitions: [{ next: "Temperate forest", between: "Taiga" }, { next: "Deep forest", between: "Taiga" }, { next: "Grassland", between: "Taiga" }, { next: "Jungle", between: "Grassland" }, { next: "Savanna", between: "Grassland" }, { next: "Badlands", between: "Grassland" }] },
  { id: "taiga", label: "Taiga", color: "#428a5e", mix: [{ type: "forest", weight: 63 }, { type: "hills", weight: 13 }, { type: "water", weight: 12 }, { type: "wetland", weight: 7 }, { type: "snow", weight: 3 }, { type: "mountains", weight: 2 }], transitions: [{ next: "Jungle", between: "Temperate forest" }, { next: "Badlands", between: "Grassland" }] },
  { id: "temperate-forest", label: "Temperate forest", color: "#2d9553", mix: [{ type: "forest", weight: 67 }, { type: "hills", weight: 17 }, { type: "grassland", weight: 8 }, { type: "water", weight: 5 }, { type: "wetland", weight: 3 }], transitions: [] },
  { id: "deep-forest", label: "Deep forest", color: "#257445", mix: [{ type: "forest", weight: 80 }, { type: "hills", weight: 14 }, { type: "grassland", weight: 3 }, { type: "wetland", weight: 3 }], transitions: [] },
  { id: "grassland", label: "Grassland", color: "#69a168", mix: [{ type: "grassland", weight: 59 }, { type: "hills", weight: 17 }, { type: "forest", weight: 9 }, { type: "desert", weight: 4 }, { type: "water", weight: 4 }, { type: "wetland", weight: 4 }, { type: "mountains", weight: 4 }], transitions: [{ next: "Alpine", between: "Valley" }] },
  { id: "savanna", label: "Savanna", color: "#c4b25c", mix: [{ type: "grassland", weight: 46 }, { type: "desert", weight: 26 }, { type: "jungle", weight: 10 }, { type: "hills", weight: 7 }, { type: "forest", weight: 6 }, { type: "wetland", weight: 4 }, { type: "water", weight: 2 }], transitions: [{ next: "Alpine", between: "Valley" }] },
  { id: "jungle", label: "Jungle", color: "#15803d", mix: [{ type: "jungle", weight: 63 }, { type: "wetland", weight: 14 }, { type: "hills", weight: 11 }, { type: "mountains", weight: 6 }, { type: "water", weight: 4 }, { type: "grassland", weight: 2 }], transitions: [{ next: "Badlands", between: "Savanna" }] },
  { id: "badlands", label: "Badlands", color: "#c2410c", mix: [{ type: "badlands", weight: 42 }, { type: "desert", weight: 26 }, { type: "mountains", weight: 21 }, { type: "hills", weight: 7 }, { type: "coast", weight: 4 }], transitions: [] },
  { id: "swamp", label: "Swamp", color: "#909f23", mix: [{ type: "wetland", weight: 62 }, { type: "forest", weight: 21 }, { type: "water", weight: 10 }, { type: "grassland", weight: 6 }, { type: "shallows", weight: 2 }], transitions: [{ next: "Badlands", between: "Grassland" }, { next: "Alpine", between: "Valley" }] },
  { id: "river-delta", label: "River delta", color: "#5f9a7a", mix: [{ type: "wetland", weight: 39 }, { type: "water", weight: 32 }, { type: "shallows", weight: 13 }, { type: "grassland", weight: 10 }, { type: "coast", weight: 4 }, { type: "forest", weight: 2 }], transitions: [] },
  { id: "valley", label: "Valley", color: "#e0e8a1", mix: [{ type: "grassland", weight: 34 }, { type: "hills", weight: 21 }, { type: "mountains", weight: 18 }, { type: "forest", weight: 12 }, { type: "peaks", weight: 11 }, { type: "water", weight: 3 }, { type: "wetland", weight: 2 }], transitions: [] },
  { id: "karst", label: "Karst", color: "#4ade80", mix: [{ type: "grassland", weight: 30 }, { type: "hills", weight: 24 }, { type: "mountains", weight: 18 }, { type: "forest", weight: 17 }, { type: "water", weight: 5 }, { type: "badlands", weight: 4 }, { type: "wetland", weight: 2 }], transitions: [] },
  { id: "alpine", label: "Alpine", color: "#bfdbfe", mix: [{ type: "mountains", weight: 44 }, { type: "peaks", weight: 20 }, { type: "hills", weight: 18 }, { type: "forest", weight: 9 }, { type: "snow", weight: 4 }, { type: "grassland", weight: 4 }, { type: "water", weight: 2 }], transitions: [{ next: "Jungle", between: "Karst" }] },
  { id: "volcanic", label: "Volcanic", color: "#b91c1c", mix: [{ type: "desert", weight: 26 }, { type: "badlands", weight: 20 }, { type: "hills", weight: 20 }, { type: "mountains", weight: 15 }, { type: "forest", weight: 8 }, { type: "water", weight: 6 }, { type: "shallows", weight: 4 }, { type: "volcanic", weight: 1 }], transitions: [] },
  { id: "coastal-fjord", label: "Coastal fjord", color: "#cac181", mix: [{ type: "mountains", weight: 28 }, { type: "water", weight: 22 }, { type: "hills", weight: 16 }, { type: "forest", weight: 12 }, { type: "peaks", weight: 10 }, { type: "shallows", weight: 9 }, { type: "grassland", weight: 3 }, { type: "coast", weight: 1 }], transitions: [] },
  { id: "archipelago", label: "Archipelago", color: "#4a82a5", mix: [{ type: "water", weight: 57 }, { type: "shallows", weight: 14 }, { type: "jungle", weight: 11 }, { type: "deep-water", weight: 4 }, { type: "grassland", weight: 3 }, { type: "forest", weight: 3 }, { type: "hills", weight: 3 }, { type: "coast", weight: 2 }, { type: "mountains", weight: 1 }, { type: "volcanic", weight: 1 }, { type: "peaks", weight: 1 }], transitions: [] },
  { id: "open-sea", label: "Open sea", color: "#29507f", mix: [{ type: "water", weight: 80 }, { type: "deep-water", weight: 20 }], transitions: [] },
];

/** A copy of a preset's fields (callers may change it). */
export function biomePreset(id: string): BiomeNoteFields | undefined {
  const p = BIOME_PRESETS.find((b) => b.id === id);
  return p ? { ...p, mix: p.mix.map((r) => ({ ...r })), transitions: p.transitions.map((t) => ({ ...t })) } : undefined;
}

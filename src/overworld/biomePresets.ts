/**
 * The shipped biomes as preset DATA (#50): written into biome notes once by
 * BiomeStore (seedBiomeNotes), then the notes are what counts. Nothing here
 * is read at run time except to seed a missing note and for "Restore
 * default".
 *
 * Mixes are each biome's terrain-type shares (percent) from the shipped
 * generator it used to borrow its mix from (src/worldgen/builtin), fitted
 * to the Expanded palette; transitions are the old ecotone table; colours
 * are the Expanded terrain each biome painted; the archipelago's islands
 * (land share 30%, at least 2) are the archipelago fix's (BiomeInfo).
 *
 * Min patches: the types smoothing washed out of most regions of the biome
 * (measured with dev/measure-patches.ts: 200 seeds of an 8×8 region, on
 * Expanded) that give it its character, e.g. alpine peaks, a volcano.
 * Coast is the one note-only preset (no row in the BIOMES table): a
 * `shore` biome whose land faces its land neighbours.
 *
 * Pure: no Obsidian imports.
 */

import type { BiomeNoteFields } from "./biomeNote";
import { copyClimate } from "./biomeClimate";

export const BIOME_PRESETS: readonly BiomeNoteFields[] = [
  { id: "tundra", label: "Tundra", color: "#e0f2fe", mix: [{ type: "snow", weight: 26 }, { type: "hills", weight: 21 }, { type: "grassland", weight: 21 }, { type: "water", weight: 10, minPatches: 1 }, { type: "peaks", weight: 6 }, { type: "wetland", weight: 6 }, { type: "desert", weight: 4 }, { type: "forest", weight: 3 }, { type: "mountains", weight: 3 }], transitions: [{ next: "Temperate forest", between: "Taiga" }, { next: "Deep forest", between: "Taiga" }, { next: "Grassland", between: "Taiga" }, { next: "Jungle", between: "Grassland" }, { next: "Savanna", between: "Grassland" }, { next: "Badlands", between: "Grassland" }], climate: { temperature: { lo: 0, hi: 0.36 }, elevation: "low" } },
  { id: "taiga", label: "Taiga", color: "#428a5e", mix: [{ type: "forest", weight: 63 }, { type: "hills", weight: 13, minPatches: 1 }, { type: "water", weight: 12, minPatches: 1 }, { type: "wetland", weight: 7 }, { type: "snow", weight: 3 }, { type: "mountains", weight: 2 }], transitions: [{ next: "Jungle", between: "Temperate forest" }, { next: "Badlands", between: "Grassland" }], climate: { temperature: { lo: 0.18, hi: 0.36 }, moisture: { lo: 0.45, hi: 1 }, elevation: "low" } },
  { id: "temperate-forest", label: "Temperate forest", color: "#2d9553", mix: [{ type: "forest", weight: 67 }, { type: "hills", weight: 17, minPatches: 1 }, { type: "grassland", weight: 8 }, { type: "water", weight: 5 }, { type: "wetland", weight: 3 }], transitions: [], climate: { temperature: { lo: 0.36, hi: 0.66 }, moisture: { lo: 0.3, hi: 0.62 }, elevation: "low" } },
  { id: "deep-forest", label: "Deep forest", color: "#257445", mix: [{ type: "forest", weight: 80 }, { type: "hills", weight: 14, minPatches: 1 }, { type: "grassland", weight: 3 }, { type: "wetland", weight: 3 }], transitions: [], climate: { temperature: { lo: 0.36, hi: 0.66 }, moisture: { lo: 0.62, hi: 0.8 }, elevation: "low" } },
  { id: "grassland", label: "Grassland", color: "#69a168", mix: [{ type: "grassland", weight: 59 }, { type: "hills", weight: 17, minPatches: 1 }, { type: "forest", weight: 9, minPatches: 1 }, { type: "desert", weight: 4 }, { type: "water", weight: 4 }, { type: "wetland", weight: 4 }, { type: "mountains", weight: 4 }], transitions: [{ next: "Alpine", between: "Valley" }], climate: { temperature: { lo: 0.36, hi: 0.66 }, moisture: { lo: 0, hi: 0.3 }, elevation: "low" } },
  { id: "savanna", label: "Savanna", color: "#c4b25c", mix: [{ type: "grassland", weight: 46 }, { type: "desert", weight: 26, minPatches: 1 }, { type: "jungle", weight: 10, minPatches: 1 }, { type: "hills", weight: 7 }, { type: "forest", weight: 6 }, { type: "wetland", weight: 4 }, { type: "water", weight: 2 }], transitions: [{ next: "Alpine", between: "Valley" }], climate: { temperature: { lo: 0.66, hi: 1 }, moisture: { lo: 0.2, hi: 0.5 }, elevation: "low" } },
  { id: "jungle", label: "Jungle", color: "#15803d", mix: [{ type: "jungle", weight: 63 }, { type: "wetland", weight: 14, minPatches: 1 }, { type: "hills", weight: 11, minPatches: 1 }, { type: "mountains", weight: 6 }, { type: "water", weight: 4 }, { type: "grassland", weight: 2 }], transitions: [{ next: "Badlands", between: "Savanna" }], climate: { temperature: { lo: 0.66, hi: 1 }, moisture: { lo: 0.5, hi: 0.85 }, elevation: "low" } },
  { id: "badlands", label: "Badlands", color: "#c2410c", mix: [{ type: "badlands", weight: 42 }, { type: "desert", weight: 26, minPatches: 1 }, { type: "mountains", weight: 21, minPatches: 1 }, { type: "hills", weight: 7 }, { type: "coast", weight: 4 }], transitions: [], climate: { temperature: { lo: 0.66, hi: 1 }, moisture: { lo: 0, hi: 0.2 }, elevation: "low" } },
  { id: "swamp", label: "Swamp", color: "#909f23", mix: [{ type: "wetland", weight: 62 }, { type: "forest", weight: 21, minPatches: 1 }, { type: "water", weight: 10, minPatches: 1 }, { type: "grassland", weight: 6 }, { type: "shallows", weight: 2 }], transitions: [{ next: "Badlands", between: "Grassland" }, { next: "Alpine", between: "Valley" }], climate: { temperature: { lo: 0.36, hi: 1 }, moisture: { lo: 0.8, hi: 1 }, elevation: "low" } },
  { id: "river-delta", label: "River delta", color: "#5f9a7a", mix: [{ type: "wetland", weight: 39 }, { type: "water", weight: 32 }, { type: "shallows", weight: 13, minPatches: 1 }, { type: "grassland", weight: 10 }, { type: "coast", weight: 4 }, { type: "forest", weight: 2 }], transitions: [], climate: { moisture: { lo: 0.55, hi: 1 }, elevation: "mouth", rare: true } },
  { id: "valley", label: "Valley", color: "#e0e8a1", mix: [{ type: "grassland", weight: 34 }, { type: "hills", weight: 21, minPatches: 1 }, { type: "mountains", weight: 18, minPatches: 1 }, { type: "forest", weight: 12, minPatches: 1 }, { type: "peaks", weight: 11 }, { type: "water", weight: 3 }, { type: "wetland", weight: 2 }], transitions: [], climate: { elevation: "mid", chance: 0.55 } },
  { id: "karst", label: "Karst", color: "#4ade80", mix: [{ type: "grassland", weight: 30 }, { type: "hills", weight: 24 }, { type: "mountains", weight: 18, minPatches: 1 }, { type: "forest", weight: 17, minPatches: 1 }, { type: "water", weight: 5 }, { type: "badlands", weight: 4 }, { type: "wetland", weight: 2 }], transitions: [], climate: { temperature: { lo: 0.62, hi: 1 }, moisture: { lo: 0.6, hi: 1 }, elevation: "mid", chance: 0.55, rare: true } },
  { id: "alpine", label: "Alpine", color: "#bfdbfe", mix: [{ type: "mountains", weight: 44 }, { type: "peaks", weight: 20, minPatches: 2 }, { type: "hills", weight: 18, minPatches: 1 }, { type: "forest", weight: 9, minPatches: 1 }, { type: "snow", weight: 4 }, { type: "grassland", weight: 4 }, { type: "water", weight: 2 }], transitions: [{ next: "Jungle", between: "Karst" }], climate: { elevation: "high" } },
  { id: "volcanic", label: "Volcanic", color: "#b91c1c", mix: [{ type: "desert", weight: 26 }, { type: "badlands", weight: 20 }, { type: "hills", weight: 20 }, { type: "mountains", weight: 15, minPatches: 1 }, { type: "forest", weight: 8 }, { type: "water", weight: 6 }, { type: "shallows", weight: 4 }, { type: "volcanic", weight: 1, minPatches: 1 }], transitions: [], climate: { elevation: "high", chance: 0.12, rare: true } },
  { id: "coastal-fjord", label: "Coastal fjord", color: "#cac181", mix: [{ type: "mountains", weight: 28 }, { type: "water", weight: 22 }, { type: "hills", weight: 16, minPatches: 1 }, { type: "forest", weight: 12 }, { type: "peaks", weight: 10, minPatches: 1 }, { type: "shallows", weight: 9 }, { type: "grassland", weight: 3 }, { type: "coast", weight: 1 }], transitions: [], climate: { temperature: { lo: 0, hi: 0.3 }, elevation: "low", coastal: true, chance: 0.5 } },
  { id: "archipelago", label: "Archipelago", color: "#4a82a5", mix: [{ type: "water", weight: 57 }, { type: "shallows", weight: 14 }, { type: "jungle", weight: 11 }, { type: "deep-water", weight: 4 }, { type: "grassland", weight: 3 }, { type: "forest", weight: 3 }, { type: "hills", weight: 3 }, { type: "coast", weight: 2 }, { type: "mountains", weight: 1 }, { type: "volcanic", weight: 1 }, { type: "peaks", weight: 1 }], transitions: [], landShare: 0.3, minIslands: 2, climate: { elevation: "sea", coastal: true, chance: 0.3 } },
  { id: "coast", label: "Coast", color: "#d9c98f", mix: [{ type: "coast", weight: 30 }, { type: "water", weight: 28 }, { type: "shallows", weight: 18 }, { type: "grassland", weight: 14 }, { type: "hills", weight: 6 }, { type: "wetland", weight: 4 }], transitions: [{ next: "Alpine", between: "Coastal fjord" }], shore: true },
  { id: "open-sea", label: "Open sea", color: "#29507f", mix: [{ type: "water", weight: 80 }, { type: "deep-water", weight: 20, minPatches: 1 }], transitions: [], climate: { elevation: "sea" } },
];

/** A copy of a preset's fields (callers may change it). */
export function biomePreset(id: string): BiomeNoteFields | undefined {
  const p = BIOME_PRESETS.find((b) => b.id === id);
  if (!p) return undefined;
  const out: BiomeNoteFields = { ...p, mix: p.mix.map((r) => ({ ...r })), transitions: p.transitions.map((t) => ({ ...t })) };
  const climate = copyClimate(p.climate);
  if (climate) out.climate = climate;
  else delete out.climate;
  return out;
}

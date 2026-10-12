/**
 * The World maps module's runtime: the World biomes generator (an
 * overworld, one biome per hex).
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "../types";
import { representableBiomes } from "../../overworld/biomes";
import { WORLD_BIOMES_ID, WORLD_BIOMES_OPTIONS, WORLD_BIOMES_TUNING, worldBiomesFromOptions } from "../../overworld/worldBiomes";
import { gridKeys } from "../../worldgen/procedural/common";

function generators(_plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution[] {
  return [
    {
      order: 50,
      id: WORLD_BIOMES_ID,
      label: "World biomes",
      mapKind: "world",
      description: "An overworld: each hex is one biome (tundra, forest, savanna…), laid out by climate, with transition biomes between ones that shouldn't touch. Its hexes then open into regions that blend with their neighbours.",
      source: "built-in",
      options: WORLD_BIOMES_OPTIONS,
      tuning: WORLD_BIOMES_TUNING,
      fits: (terrains) => representableBiomes(terrains).size >= 3,
      generate: (req) => {
        const g = procGrid(req.grid);
        const r = worldBiomesFromOptions(gridKeys(g), g.orientation, g.stagger, req.terrains, req.seed, req.options);
        // The river is biome data on an overworld, not a path (paths come later).
        return r.terrain.size ? { ok: true, cells: r.terrain, paths: [], warnings: [] } : { ok: false, message: "This palette has no terrains for biomes." };
      },
      toPaths,
    },
  ];
}

export const worldMapsRuntime: ModuleRuntime = {
  id: "world-maps",
  generators,
  newMapOptionIds: {
    [WORLD_BIOMES_ID]: { climate: "NewMap.worldBiomesClimate", water: "NewMap.worldBiomesWater", land: "NewMap.worldBiomesLand", north: "NewMap.worldBiomesNorth" },
  },
};

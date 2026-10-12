/**
 * The World maps module (W slice, owner call CM2): overworlds, biomes,
 * neighbouring regions. Not a map type: it works with any. Its code still
 * lives in src/overworld/ and is reached from the core directly (the
 * boundary ratchet counts those edges); plan-code-modules P7 moves it
 * behind this module. Pure data.
 */

import type { HexmakerModule } from "../types";
import { WORLD_MAPS_TABLE_CONDITIONS } from "./tableConditions";

export const worldMapsModule: HexmakerModule = {
  id: "world-maps",
  slice: "worldmaps",
  tableConditions: WORLD_MAPS_TABLE_CONDITIONS,
  // River carves its overworld path's cells into water (overworld paths).
  addedPresetPathFields: [{ pathType: "River", field: "carves" }],
  mapScales: [{
    id: "biomes",
    label: "Biomes",
    description: "An overworld: one biome per hex, each opening into a region map.",
    kind: "world",
    size: { cols: 16, rows: 12 },
    palette: "Expanded",
    generators: ["procedural:world-biomes"],
  }],
  owns: {
    settingsKeys: ["biomesFolder", "biomePoolsFolder", "biomesSeeded", "biomeClimatesSeeded", "biomeColumnsFilled"],
    mapNoteKeys: [],
    commands: ["new-overworld"],
    strings: [
      "New overworld…",
      "World biomes",
      "procedural:world-biomes",
      "Biomes folder",
      "Biome pools folder",
      "Edit region…",
      "Generate overworld…",
      "Make the missing regions",
      "hexmaker-biome",
    ],
  },
};

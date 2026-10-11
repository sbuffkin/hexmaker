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
  slice: "W",
  tableConditions: WORLD_MAPS_TABLE_CONDITIONS,
  owns: { settingsKeys: [], mapNoteKeys: [], commands: [] },
};

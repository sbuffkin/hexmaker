/**
 * The Hex fields module (slice "fields", GitHub #52, plan-custom-hex-fields):
 * the world's own data on every hex, declared in a fields note, kept as
 * columns of each map note's `## Hexes` table. Built off, those columns stay
 * in the notes as any unknown column does (mapNote.ts). Pure data; what needs
 * the plugin is in ./runtime.ts.
 */

import type { HexmakerModule } from "../types";
import { NEAR_CONDITION } from "../../fields/nearCondition";

export const fieldsModule: HexmakerModule = {
  id: "fields",
  slice: "fields",
  // A table's When `near: town 2` (the places hex fields know about).
  tableConditions: [NEAR_CONDITION],
  modeActions: {
    policy: { "edit-fields": { modes: ["build", "god"], verb: "edit hex fields" } },
    commands: { "recalculate-fields": "edit-fields" },
  },
  owns: {
    settingsKeys: [],
    mapNoteKeys: [],
    commands: ["recalculate-fields"],
    strings: [
      "Recalculate fields",
      "Hex fields",
      "hexmaker-fields",
      "Place influences",
      "Open the fields note",
      "place-type",
      "duckmage-editor-fields",
    ],
  },
};

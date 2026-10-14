/**
 * The Hex flower module (unreleased slice "hexflower", plan-hex-flower):
 * solo exploring. A map can start blank and fill in as the party walks:
 * each new hex is rolled on one or more hex flowers (a 19-cell flower of
 * results walked with 2d6) or tables. Flowers are notes the user makes
 * from their own palette; nothing is shipped. Not a map type: it works on
 * any map. Pure data; what needs the plugin is in ./runtime.ts.
 */

import type { HexmakerModule } from "../types";
import { EXPLORE_FIELDS, FROM_CONDITION } from "../../hexflower/exploreFields";

export const hexFlowerModule: HexmakerModule = {
  id: "hex-flower",
  slice: "hexflower",
  mapNoteFields: EXPLORE_FIELDS,
  // A table's When `from:` (the terrain of the hex the party came from).
  tableConditions: [FROM_CONDITION],
  owns: {
    settingsKeys: ["hexFlowersFolder"],
    mapNoteKeys: EXPLORE_FIELDS.map((f) => f.key),
    commands: [],
    strings: [
      "Hex flowers",
      "hexmaker-hex-flower",
      "duckmage-hex-flower",
      "hex flower note",
      "procedural:hex-flower",
      "Roll this hex",
      "Fill from palette",
      "Test walk",
      "Hex flowers folder",
    ],
  },
};

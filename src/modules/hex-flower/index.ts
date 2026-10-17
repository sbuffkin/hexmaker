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
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT).
  placement: {
    "Settings.hexFlowersFolder": "debug",
    // ── Hex flowers (plan-hex-flower): the generator page's Hex flowers tab (its own surface,
    // FlowerPage) puts dice, walk length and seed in Advanced, the note's read report and the
    // odds matrix in Debug. The Hex flower generator's Party token and Reveal options are main
    // on New map and in the setup wizard (owner HF9, 2026-10-16: "both above the fold, this is
    // pretty standard functionality"). ──
    "FlowerPage.dice": "advanced",
    "FlowerPage.walkLength": "advanced",
    "FlowerPage.seed": "advanced",
    "FlowerPage.report": "debug",
    "FlowerPage.matrix": "debug",
    "NewMap.flowerParty": "main",
    "NewMap.flowerReveal": "main",
    "Wizard.flowerParty": "main",
    "Wizard.flowerReveal": "main",
  },
  // How the work modes treat its entry points (merged into src/workMode.ts).
  modeActions: {
    // A map the party explores grows (blank hexes only) as the party nears its edge, in every mode like discovering (HF4).
    policy: { "grow-while-exploring": { modes: ["play", "build", "god"], verb: "grow the map as the party explores" } },
    // Its hex menu items (runtime hexMenu): rolling an unknown hex.
    menus: { "hex.explore-roll": "discover", "hex.explore-reroll": "discover" },
  },
  owns: {
    settingsKeys: ["hexFlowersFolder"],
    mapNoteKeys: EXPLORE_FIELDS.map((f) => f.key),
    commands: [],
    // Not "Hex flowers" (the tab): the region shape and the regions' toolbar ring are called hex flowers too.
    strings: [
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

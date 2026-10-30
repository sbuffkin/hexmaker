/**
 * The Fog of war module (slice "fog", plan-explore-reveal-existing, HF11;
 * needs Play): explore a finished map by revealing it. The party's sight, the
 * GM's Peek and reveal items, Start and Stop exploring, and the map note's
 * `explore-*` keys (a build with this slice reads them all, so it keeps a map
 * explored by Hex flower intact). Pure data; what needs the plugin is in
 * ./runtime.ts.
 */

import type { HexmakerModule } from "../types";
import { EXPLORE_FIELDS } from "../../fog/exploreFields";

export const fogModule: HexmakerModule = {
  id: "fog",
  slice: "fog",
  mapNoteFields: EXPLORE_FIELDS,
  modeActions: {
    // HF11: what the party sees and the GM reveals (sight, peek, start/stop, fog): play state, never map data.
    policy: {
      "explore-play": { modes: ["play", "build", "god"], verb: "explore the map" },
    },
    // Its hex menu items (runtime hexMenu): revealing and hiding under fog.
    menus: {
      "hex.explore-start": "explore-play",
      "hex.explore-reveal-hex": "explore-play",
      "hex.explore-hide-hex": "explore-play",
      "hex.explore-stop": "explore-play",
    },
  },
  owns: {
    settingsKeys: [],
    mapNoteKeys: EXPLORE_FIELDS.map((f) => f.key),
    commands: [],
    strings: [
      "Start exploring",
      "Reveal this hex",
      "Stop exploring",
      "Reveal hexes",
      "Revealing hexes",
    ],
  },
};

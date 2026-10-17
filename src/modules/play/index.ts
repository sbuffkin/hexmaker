/**
 * The Solo play module (slice "play"; owner calls SF3–SF5, P1, P2): the
 * party token moving one hex at a time in Play, the hexes it has visited
 * (marked on the map, kept in the map note), and the play log (one dated
 * note per day). Not a map type: it works on any map. Pure data; what
 * needs the plugin is in ./runtime.ts.
 *
 * A build without it keeps everything it wrote: the map notes' `visited`
 * and `show-visited` keys stay as the user's (tests/moduleKeysRoundTrip),
 * token notes keep `token-party` and `token-log`, and a party token is a
 * plain token there.
 */

import type { HexmakerModule, MapNoteField } from "../types";
import { PLAY_LOG_TARGET } from "./playLog";

/** Its map settings in the map note (MapData.visited / showVisited). */
export const PLAY_FIELDS: readonly MapNoteField[] = [
  // Hexes the party has stood on, first visit first (src/modules/play/partyTravel.ts).
  { field: "visited", key: "visited", kind: "list" },
  // The layers menu's Visited switch.
  { field: "showVisited", key: "show-visited", kind: "bool" },
];

export const playModule: HexmakerModule = {
  id: "play",
  slice: "play",
  mapNoteFields: PLAY_FIELDS,
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT): the
  // party switch, the log folder setting and Add to log are main; marking
  // one hex visited by hand is Advanced.
  placement: {
    "MapView.hexVisited": "advanced",
  },
  // How the work modes treat its entry points (merged into src/workMode.ts).
  modeActions: {
    commands: { "open-play-log": "edit-note" },
    // A line in the play log; a hex visited (or not) by hand; the party switch.
    menus: { "hex.log": "edit-note", "hex.visited": "token", "token.party": "token" },
  },
  owns: {
    settingsKeys: ["logFolder"],
    mapNoteKeys: PLAY_FIELDS.map((f) => f.key),
    commands: ["open-play-log"],
    strings: [
      "Open today's play log",
      "Play log folder",
      "Add to play log",
      "Write what happened here in today's play log",
      "duckmage-play-log-text",
      PLAY_LOG_TARGET,
    ],
  },
};

/**
 * The Hexcrawl manual module (slice "manual"): a printable gazetteer of a
 * map (legend, encounter tables, keyed hexes by section, index) from the
 * Map export form. An output feature only: it reads maps and notes and
 * writes a PDF to the export folder, nothing else. Pure data; its part of
 * the export form is in ./runtime.ts.
 */

import type { HexmakerModule } from "../types";
import { MANUAL_PARTS } from "./manualModel";

export const manualModule: HexmakerModule = {
  id: "manual",
  slice: "manual",
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT): its button and Fold on the Map export form.
  placement: {
    "MapExport.exportManual": "main",
    "MapExport.playerEdition": "main",
    "MapExport.manualPartLegend": "main",
    "MapExport.manualPartTables": "main",
    "MapExport.manualPartFactions": "main",
    "MapExport.manualPartIndex": "main",
  },
  owns: {
    settingsKeys: [],
    mapNoteKeys: [],
    commands: [],
    strings: [
      "Hexcrawl manual",
      "Export hexcrawl manual (PDF)",
      "Player version (leave out the hidden and secret sections)",
      // Its parts' labels, but not the ones the core says too ("Encounter tables" in the README's
      // hex template, "Index" inside every findIndex).
      ...MANUAL_PARTS.map((p) => p.label).filter((l) => l !== "Encounter tables" && l !== "Index"),
    ],
  },
};

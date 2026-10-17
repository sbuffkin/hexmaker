/**
 * The Content packs module (slice "packs", SF1): export the notes you made
 * (tables, workflows, templates, towns, palettes…) to a .zip and import one
 * into another vault. No map type and no saved format of its own: a pack
 * becomes ordinary notes, and its pack.md is a plain note. Pure data; the
 * commands and the surfaces it adds are in ./runtime.ts.
 */

import type { HexmakerModule } from "../types";

export const packsModule: HexmakerModule = {
  id: "packs",
  slice: "packs",
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT; SF1, 2026-10-14).
  placement: {
    "Plugin.cmd.exportContentPack": "main",
    "Plugin.cmd.importContentPack": "main",
    "MapExport.contentPack": "main",
    "Wizard.importPack": "main",
    "PackExport.name": "main",
    "PackExport.description": "main",
    "PackExport.selectAll": "main",
    "PackExport.export": "main",
    "PackImport.pickZip": "main",
    "PackImport.pickFolder": "main",
    "PackImport.vaultZips": "main",
    "PackImport.conflictAll": "main",
    "PackImport.import": "main",
  },
  // How the work modes treat its commands (merged into src/workMode.ts).
  modeActions: {
    commands: {
      "export-content-pack": "export",
      // Adds notes to content folders (no map data); never locked, like settings and palettes.
      "import-content-pack": "settings",
    },
  },
  owns: {
    settingsKeys: [],
    mapNoteKeys: [],
    commands: ["export-content-pack", "import-content-pack"],
    strings: [
      "Export content pack…",
      "Import content pack…",
      "Import a content pack…",
      "Content pack (.zip)",
      "hexmaker-pack",
      "pack.md",
      "Plugin.cmd.exportContentPack",
      "Plugin.cmd.importContentPack",
    ],
  },
};

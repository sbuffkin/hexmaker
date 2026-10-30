/**
 * The Content packs module's runtime: its two commands, the setup wizard's
 * "Import a content pack…" offer and the Map export form's "Content pack
 * (.zip)" box. The kinds of notes a pack carries come from the core and
 * each map-type module (ModuleRuntime.packKinds, read in ./packCommands.ts).
 */

import type { ModuleRuntime } from "../types";
import { openPackExport, openPackImport } from "./packCommands";
import { renderPackExportBox, renderPackImportOffer } from "./packOffer";

export const packsRuntime: ModuleRuntime = {
  id: "packs",
  commands: [
    { id: "export-content-pack", name: "Export content pack…", placementId: "Plugin.cmd.exportContentPack", run: (plugin) => openPackExport(plugin) },
    { id: "import-content-pack", name: "Import content pack…", placementId: "Plugin.cmd.importContentPack", run: (plugin) => openPackImport(plugin) },
  ],
  // An option on the wizard's last step, never a step of its own.
  wizardOffers: [{ id: "packs.import", step: "done", render: (container, plugin) => renderPackImportOffer(container, plugin) }],
  // Not the map but your notes, after the form's list of files.
  exportForm: [{
    id: "packs.export",
    render: ({ plugin }) => ({ box: { placementId: "MapExport.contentPack", render: (el, done) => renderPackExportBox(el, plugin, done) } }),
  }],
};

/**
 * What the content pack commands ("Export content pack…", "Import
 * content pack…"), the Map export form's button and the setup wizard's
 * offer open, and the kinds of content this vault packs: the core's
 * folders and each map-type module's (./packKinds.ts).
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import { generatorsFolder } from "../../worldgen/generators";
import { coreKinds, type PackKind } from "./packKinds";
import { PackExportModal } from "./PackExportModal";
import { PackImportModal } from "./PackImportModal";

/**
 * This vault's pack kinds, core first, by their folders now (one per id).
 * The map-type modules' kinds (ModuleRuntime.packKinds) are read through a
 * dynamic import: ../runtime imports this module's runtime, so a static
 * import here would be an import cycle (tests/importCycles.test.ts).
 */
export async function packKindsFor(plugin: HexmakerPlugin): Promise<PackKind[]> {
  const { modulePackKinds } = await import("../runtime");
  const all = [
    ...coreKinds(plugin.settings, { palettes: plugin.paletteStore.folder(), generators: generatorsFolder(plugin) }),
    ...modulePackKinds(plugin),
  ];
  return all.filter((k, i) => all.findIndex((o) => o.id === k.id) === i);
}

/** Open "Export a content pack". */
export async function openPackExport(plugin: HexmakerPlugin): Promise<void> {
  new PackExportModal(plugin.app, plugin, await packKindsFor(plugin)).open();
}

/** Open "Import a content pack". */
export async function openPackImport(plugin: HexmakerPlugin): Promise<void> {
  new PackImportModal(plugin.app, plugin, await packKindsFor(plugin)).open();
}

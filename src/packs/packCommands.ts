/**
 * What the content pack commands ("Export content pack…", "Import
 * content pack…") open, and the kinds of content this vault packs: the core's folders
 * and each map-type module's (src/packs/packKinds.ts).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import { modulePackKinds } from "../modules/runtime";
import { generatorsFolder } from "../worldgen/generators";
import { coreKinds, type PackKind } from "./packKinds";
import { PackExportModal } from "./PackExportModal";
import { PackImportModal } from "./PackImportModal";
import { setPackOpeners } from "./packOpeners";

/** This vault's pack kinds, core first, by their folders now (one per id). */
export function packKindsFor(plugin: HexmakerPlugin): PackKind[] {
  const all = [
    ...coreKinds(plugin.settings, { palettes: plugin.paletteStore.folder(), generators: generatorsFolder(plugin) }),
    ...modulePackKinds(plugin),
  ];
  return all.filter((k, i) => all.findIndex((o) => o.id === k.id) === i);
}

/** What the pack commands run (the plugin places them as Plugin.cmd.exportContentPack / importContentPack); also wires the openers other surfaces use. */
export function packCommands(plugin: HexmakerPlugin): { exportPack: () => void; importPack: () => void } {
  const exportPack = () => new PackExportModal(plugin.app, plugin, packKindsFor(plugin)).open();
  const importPack = () => new PackImportModal(plugin.app, plugin, packKindsFor(plugin)).open();
  setPackOpeners({ exportPack, importPack });
  return { exportPack, importPack };
}

/**
 * Wires the hex-note properties sync (src/maps/hexPropsSync.ts) to the
 * vault and workspace events. Split from HexmakerPlugin.
 */
import type { Plugin } from "obsidian";
import type { HexPropsSync } from "../maps/hexPropsSync";

export function registerHexPropsEvents(plugin: Plugin, sync: HexPropsSync): void {
  const { app } = plugin;
  // A hex note's properties edited (properties panel, text, sync).
  plugin.registerEvent(app.metadataCache.on("changed", (file, data) => sync.onMetadataChanged(file, data)));
  // Leaving a note settles edits held while it was open.
  plugin.registerEvent(app.workspace.on("file-open", (file) => sync.onFileOpen(file)));
  plugin.registerEvent(app.vault.on("rename", (f, oldPath) => sync.onRename(oldPath, f.path)));
  plugin.registerEvent(app.vault.on("delete", (f) => sync.onDelete(f.path)));
}

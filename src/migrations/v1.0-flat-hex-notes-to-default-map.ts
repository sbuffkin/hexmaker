/**
 * Before 1.0: hex notes sat straight in the hexes folder
 * (`{hexFolder}/{x}_{y}.md`). Maps became subfolders, so such notes move to
 * `{hexFolder}/default/`. A note whose new path is taken stays put. Safe to
 * run on every load: only the hexes folder's own files are looked at (not
 * the whole vault), and on a vault without such notes nothing happens and
 * no folder is created.
 */
import { TFile, TFolder, type App } from "obsidian";
import { normalizeFolder } from "../utils";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.0-flat-hex-notes-to-default-map",
  from: "0.x",
  to: "1.0",
  phase: "settings",
  change: "Hex notes from before maps had folders moved into the \"default\" map's folder.",
  recordedBy: "every load (only the hexes folder's own files are looked at)",
};

const HEX_NAME = /^-?\d+_-?\d+$/;

/** Move loose hex notes into `{hexFolder}/default`. Returns how many moved. */
export async function migrate(app: App, hexFolderSetting: string): Promise<number> {
  const hexFolder = normalizeFolder(hexFolderSetting);
  if (!hexFolder) return 0;
  // Scan first — only create the destination folder if there are actually
  // files to move. On a fresh install the scan returns nothing and we return
  // early, avoiding spurious folder creation before setup is complete.
  const folder = app.vault.getAbstractFileByPath(hexFolder);
  if (!(folder instanceof TFolder)) return 0;
  const candidates = folder.children.filter((f): f is TFile => f instanceof TFile && f.name.endsWith(".md") && HEX_NAME.test(f.basename));
  if (candidates.length === 0) return 0;

  const defaultFolder = `${hexFolder}/default`;
  if (!app.vault.getAbstractFileByPath(defaultFolder)) {
    try {
      await app.vault.createFolder(defaultFolder);
    } catch {
      /* exists */
    }
  }
  let moved = 0;
  for (const file of candidates) {
    const newPath = `${defaultFolder}/${file.name}`;
    if (!app.vault.getAbstractFileByPath(newPath)) {
      try {
        await app.fileManager.renameFile(file, newPath);
        moved++;
      } catch {
        /* skip */
      }
    }
  }
  return moved;
}

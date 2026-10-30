/**
 * Before 1.0: a terrain's tables were `{tables}/terrain/{name} - description.md`
 * and `… - encounters.md`. They became `{tables}/terrain/description/{name}.md`
 * and `…/encounters/{name}.md`. A table whose new path is taken stays put.
 * Runs whenever the terrain tables are checked (it finds nothing to do once
 * the old files are gone).
 */
import { TFile, type App } from "obsidian";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.0-flat-terrain-tables-to-subfolders",
  from: "0.x",
  to: "1.0",
  phase: "tables",
  change: "Terrain tables named \"<terrain> - encounters\" moved into encounters and description folders.",
  recordedBy: "every terrain-table check (nothing to do once moved)",
};

/** Move each terrain's old flat-named tables under `subfolder` into the type folders. */
export async function migrate(app: App, subfolder: string, terrainNames: readonly string[]): Promise<void> {
  for (const name of terrainNames) {
    for (const tableType of ["description", "encounters"] as const) {
      const oldPath = `${subfolder}/${name} - ${tableType}.md`;
      const newPath = `${subfolder}/${tableType}/${name}.md`;
      const oldFile = app.vault.getAbstractFileByPath(oldPath);
      if (oldFile instanceof TFile && !app.vault.getAbstractFileByPath(newPath)) {
        try {
          await app.fileManager.renameFile(oldFile, newPath);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

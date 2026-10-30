import type { App, TFile } from "obsidian";
import { groupTablesForPicker } from "../notePickers";
import { tableMadeBy } from "./resolve";

/**
 * Table files for a picker: the user's own, then the ones the map made
 * (terrain and region tables, told apart by their `table-type:`
 * frontmatter; see tableMadeBy). Order kept within each part.
 */
export function groupTableFiles(app: App, files: readonly TFile[]): { own: TFile[]; mapMade: TFile[] } {
  return groupTablesForPicker(files, (f) => ({ madeBy: tableMadeBy(app.metadataCache.getFileCache(f)?.frontmatter) }));
}

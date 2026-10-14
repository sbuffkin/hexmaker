/**
 * Which notes are table notes (the tables folder, minus "_" notes and the
 * workflows folder), for the table store, "Check tables" and the roll
 * ranges upgrade. Pure path logic plus one vault listing.
 */
import type { App, TFile } from "obsidian";

export interface TableScope {
  tablesFolder: string;
  workflowsFolder: string;
}

/** Table notes in the tables folder ("_" notes and workflows excluded), by path. */
export function tableNotes(app: App, scope: TableScope): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => isTableNotePath(f.path, scope.tablesFolder, scope.workflowsFolder))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Whether a vault path is a table note the migration and checks look at. */
export function isTableNotePath(path: string, tablesFolder: string, workflowsFolder: string): boolean {
  if (!path.endsWith(".md")) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith("_")) return false;
  const tf = tablesFolder ? tablesFolder + "/" : "";
  if (tf && !path.startsWith(tf)) return false;
  const wf = workflowsFolder ? workflowsFolder + "/" : "";
  if (wf && path.startsWith(wf)) return false;
  return true;
}

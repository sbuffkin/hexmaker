/**
 * What the tables and workflows folders do on vault events (dispatched by
 * src/plugin/vaultEvents.ts): a renamed folder's linkedFolder links in
 * table notes follow it, and a deleted table leaves the workflows that
 * rolled on it. Split from HexmakerPlugin.onload.
 */
import { TAbstractFile, TFile, TFolder, type App } from "obsidian";
import type { HexmakerPluginSettings } from "../types";
import { normalizeFolder } from "../utils";
import { buildWorkflowContent, parseWorkflow } from "./workflow";

/** What the table events read. */
export interface TableEventsHost {
  app: App;
  settings: Pick<HexmakerPluginSettings, "tablesFolder" | "workflowsFolder">;
}

/** Keep linkedFolder frontmatter in sync when a folder is renamed. */
export async function onTableFolderRenamed(host: TableEventsHost, abstractFile: TAbstractFile, oldPath: string): Promise<void> {
  if (!(abstractFile instanceof TFolder)) return;
  const oldFolder = normalizeFolder(oldPath);
  const newFolder = normalizeFolder(abstractFile.path);
  if (oldFolder === newFolder) return;

  const tablesPrefix = normalizeFolder(host.settings.tablesFolder);
  const tableFiles = host.app.vault
    .getMarkdownFiles()
    .filter(
      (f) => !tablesPrefix || f.path.startsWith(tablesPrefix + "/"),
    );

  for (const tableFile of tableFiles) {
    const fm = host.app.metadataCache.getFileCache(tableFile)?.frontmatter;
    const lf: unknown = fm?.["linkedFolder"] ?? fm?.["linked-folder"];
    if (!lf || typeof lf !== "string") continue;
    const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(lf);
    const lfClean = wikiLinkMatch ? wikiLinkMatch[1].trim() : lf;
    const lfNorm = normalizeFolder(lfClean);
    if (lfNorm !== oldFolder && !lfNorm.startsWith(oldFolder + "/"))
      continue;
    const updatedLf = newFolder + lfNorm.slice(oldFolder.length);
    await host.app.vault.process(tableFile, (content) =>
      content.replace(
        /^((?:linkedFolder|linked-folder):\s*).*$/m,
        `$1"[[${updatedLf}]]"`,
      ),
    );
  }
}

/** Remove workflow steps that reference a deleted table file. */
export async function onTableDeleted(host: TableEventsHost, abstractFile: TAbstractFile): Promise<void> {
  if (!(abstractFile instanceof TFile)) return;
  const tablesPrefix = normalizeFolder(host.settings.tablesFolder);
  if (tablesPrefix && !abstractFile.path.startsWith(tablesPrefix + "/"))
    return;

  // The table path stored in workflows has no .md extension
  const deletedTablePath = abstractFile.path.slice(0, -3);

  const wfPrefix = normalizeFolder(host.settings.workflowsFolder);
  const templatesPath = wfPrefix ? `${wfPrefix}/templates` : "templates";
  const workflowFiles = host.app.vault
    .getMarkdownFiles()
    .filter(
      (f) =>
        (!wfPrefix || f.path.startsWith(wfPrefix + "/")) &&
        !f.path.startsWith(templatesPath + "/") &&
        !f.basename.startsWith("_"),
    );

  for (const wfFile of workflowFiles) {
    await host.app.vault.process(wfFile, (content) => {
      const workflow = parseWorkflow(content, wfFile.basename);
      const filtered = workflow.steps.filter(
        (s) => s.tablePath !== deletedTablePath,
      );
      if (filtered.length === workflow.steps.length) return content;
      workflow.steps = filtered;
      // Everything else in the note (other columns, text after the table) stays.
      return buildWorkflowContent(workflow, { existing: content });
    });
  }
}

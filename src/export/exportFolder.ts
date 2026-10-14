/**
 * Helpers for resolving and creating the export destination folder.
 */

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { leafShowingPath } from "../openNote";
import { normalizeFolder } from "../utils";
import { ensureFolder } from "../vault/ensureFolder";
import type HexmakerPlugin from "../HexmakerPlugin";
import { localIsoDateTime, withFrontmatterEntries, yamlLink } from "../provenance";

/**
 * Resolve the configured export folder, defaulting to `{worldFolder}/exports`
 * (or just `exports` if `worldFolder` is empty). Returns a normalized path
 * suitable for vault operations.
 */
export function resolveExportFolder(plugin: HexmakerPlugin): string {
  const configured = normalizeFolder(plugin.settings.exportFolder ?? "");
  if (configured) return configured;
  const world = normalizeFolder(plugin.settings.worldFolder ?? "");
  return world ? `${world}/exports` : "exports";
}

/**
 * Ensure the export folder (and any missing ancestors) exist. Idempotent.
 */
export async function ensureExportFolder(plugin: HexmakerPlugin): Promise<string> {
  const folder = resolveExportFolder(plugin);
  await ensureFolder(plugin.app.vault, folder);
  return folder;
}

/**
 * The notice after an export: "Replaced <path>" when it overwrote an earlier
 * export of the same name, so re-exporting isn't silent (round 6 S10).
 */
export function exportedMessage(path: string, replaced: boolean): string {
  return replaced ? `Replaced ${path}` : `Exported to ${path}`;
}

/** What an exported note is: the `hexmaker-export` value. */
export type ExportKind = "note" | "hex" | "table" | "workflow";

/**
 * An exported markdown note with where it came from in its frontmatter
 * (X1): `exported-from` links the source note, `exported` is when, and
 * `hexmaker-export` says what kind of export it is, so the copy can't be
 * mistaken for the note it was made from.
 */
export function withExportProvenance(md: string, sourcePath: string, kind: ExportKind, when: Date = new Date()): string {
  return withFrontmatterEntries(md, [
    ["exported-from", yamlLink(sourcePath)],
    ["exported", localIsoDateTime(when)],
    ["hexmaker-export", kind],
  ]);
}

/**
 * Open an exported file. A tab already showing it is focused and reloaded
 * (a re-export used to open a second tab of the same image, round 6 S10);
 * otherwise it opens in a new tab.
 */
export async function openExported(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  const leaves: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    leaves.push(leaf);
  });
  const existing = leafShowingPath(leaves, path);
  if (existing) {
    // Re-open in place so the view shows the new bytes.
    await existing.setViewState({ type: "empty", state: {} });
    await existing.openFile(file, { active: true });
    await app.workspace.revealLeaf(existing);
    return;
  }
  await app.workspace.getLeaf("tab").openFile(file);
}

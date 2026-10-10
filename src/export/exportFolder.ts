/**
 * Helpers for resolving and creating the export destination folder.
 */

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { leafShowingPath } from "../openNote";
import { normalizeFolder } from "../utils";
import type HexmakerPlugin from "../HexmakerPlugin";

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
  await ensureFolder(plugin.app, folder);
  return folder;
}

/** Create the folder if missing. Quietly tolerates concurrent creation. */
async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch {
    /* race: already exists */
  }
}

/**
 * The notice after an export: "Replaced <path>" when it overwrote an earlier
 * export of the same name, so re-exporting isn't silent (round 6 S10).
 */
export function exportedMessage(path: string, replaced: boolean): string {
  return replaced ? `Replaced ${path}` : `Exported to ${path}`;
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

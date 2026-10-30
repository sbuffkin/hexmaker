/**
 * Make sure a vault folder exists, tolerating the race where it's made
 * between the check and the create (another write, a sync, a second
 * window): Obsidian's createFolder throws when the folder is already there.
 */

import type { Vault } from "obsidian";

/** The two vault calls these need (so tests can pass a fake). */
export type FolderVault = Pick<Vault, "getAbstractFileByPath" | "createFolder">;

/** Create `path` with one createFolder call when nothing is at that path. */
export async function ensureFolder(vault: FolderVault, path: string): Promise<void> {
  if (vault.getAbstractFileByPath(path)) return;
  try {
    await vault.createFolder(path);
  } catch {
    /* made meanwhile */
  }
}

/** Create each missing level of `folder` ("a", "a/b", "a/b/c"), one at a time. */
export async function ensureFolderPath(vault: FolderVault, folder: string): Promise<void> {
  const parts = folder.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    if (!vault.getAbstractFileByPath(p)) {
      try { await vault.createFolder(p); } catch { /* made meanwhile */ }
    }
  }
}

/**
 * Open a note, or focus it if it's already open. "Open note" used to call
 * getLeaf("tab").openFile() every time, so a round-4 tester ended up with
 * two "2_8" tabs after opening the same hex note twice.
 */

import type { App, TFile, WorkspaceLeaf } from "obsidian";

interface LeafLike {
  view: unknown;
  getViewState?: () => { state?: Record<string, unknown> };
}

/** The first leaf whose view shows the file at `path` (pure, for tests).
 *  Background tabs that haven't loaded yet (deferred views) have no
 *  `view.file`, so their view state's `file` is checked too. */
export function leafShowingPath<L extends LeafLike>(
  leaves: readonly L[],
  path: string,
): L | undefined {
  return leaves.find((leaf) => {
    const file = (leaf.view as { file?: { path?: string } | null } | null)?.file;
    if (file?.path === path) return true;
    return leaf.getViewState?.().state?.["file"] === path;
  });
}

/** Focus the tab already showing `file`, or open it in a new tab. */
export async function openNoteFocused(app: App, file: TFile): Promise<void> {
  const leaves: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    leaves.push(leaf);
  });
  const existing = leafShowingPath(leaves, file.path);
  if (existing) {
    app.workspace.setActiveLeaf(existing, { focus: true });
    await app.workspace.revealLeaf(existing);
    return;
  }
  await app.workspace.getLeaf("tab").openFile(file);
}

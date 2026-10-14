import { ItemView, WorkspaceLeaf } from "obsidian";
import { isMapNoteText } from "./dataStamp";

/**
 * Read-only safety mode, for a vault updated by a newer version (see
 * dataStamp.ts). The plugin's views are replaced by this one, which only
 * says what happened; nothing in here writes to the vault.
 */
export class SafetyModeView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string,
    private readonly title: string,
    private readonly message: () => string,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return this.title;
  }

  getIcon(): string {
    return "alert-triangle";
  }

  onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("duckmage-safety-view");
    el.createEl("h3", { text: "Read-only on this device" });
    el.createEl("p", { text: this.message() });
    el.createEl("p", {
      text: "Update the plugin from the community plugins settings (check for updates), then reload Obsidian.",
    });
    return Promise.resolve();
  }
}

/** The read-only file access the map-note check needs (Obsidian's DataAdapter fits). */
export interface ReadOnlyAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
}

/** Is `path` a possible map note: `{hexFolder}/{folder}/_{name}.md`? */
export function isMapNotePath(path: string, hexFolder: string): boolean {
  if (!hexFolder || !path.startsWith(hexFolder + "/")) return false;
  const rest = path.slice(hexFolder.length + 1).split("/");
  return rest.length === 2 && /^_.+\.md$/i.test(rest[1]);
}

/**
 * Does the hex folder hold a map note written by a newer version? Reads the
 * files directly (works before the metadata cache is ready, and when
 * data.json isn't synced but the notes are). Never writes.
 */
export async function hasNewerMapNotes(adapter: ReadOnlyAdapter, hexFolder: string): Promise<boolean> {
  if (!hexFolder) return false;
  try {
    if (!(await adapter.exists(hexFolder))) return false;
    const { folders } = await adapter.list(hexFolder);
    for (const folder of folders) {
      const { files } = await adapter.list(folder);
      for (const file of files) {
        if (!isMapNotePath(file, hexFolder)) continue;
        if (isMapNoteText(await adapter.read(file))) return true;
      }
    }
  } catch {
    // Unreadable folder: nothing to go on.
  }
  return false;
}

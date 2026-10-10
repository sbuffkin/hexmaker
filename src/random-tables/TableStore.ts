/**
 * Watches table notes so hand edits to the raw note are imported (issue #45,
 * see tableImport.ts). Like PaletteStore, it keeps the content it last read
 * or wrote per note: a change that isn't the plugin's own write is a hand
 * edit, and is compared against that.
 *
 * Plugin code that rewrites a table goes through processTableNote, which
 * records the result first, so the plugin's own writes are never imported
 * back. Imports wait until typing has paused, and never rewrite the note
 * under a focused editor.
 */

import { MarkdownView, TFile, type App, type TAbstractFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { importHandEdit, type ImportKind } from "./tableImport";
import { isTableNotePath } from "./tableMigration";

/** Content the plugin last read or wrote, per table note path. */
const lastContent = new Map<string, string>();

/** Remember content the plugin wrote (or read) for a table note. */
export function rememberTableContent(path: string, content: string): void {
  lastContent.set(path, content);
}

/** vault.process for table notes: the result is recorded as the plugin's own write. */
export async function processTableNote(app: App, file: TFile, edit: (content: string) => string): Promise<string> {
  return app.vault.process(file, (content) => {
    const next = edit(content);
    lastContent.set(file.path, next);
    return next;
  });
}

const QUIET_MS = 1500;

export class TableStore {
  private timers = new Map<string, number>();

  constructor(
    private app: App,
    private scope: () => { tablesFolder: string; workflowsFolder: string },
    /** Called after an import rewrote a note (for a notice or a refresh). */
    private onImported?: (path: string, kind: ImportKind) => void,
  ) {}

  /** Hook into the plugin's vault events and remember every table note's content. */
  static register(plugin: HexmakerPlugin): TableStore {
    const store = new TableStore(plugin.app, () => ({
      tablesFolder: normalizeFolder(plugin.settings.tablesFolder ?? ""),
      workflowsFolder: normalizeFolder(plugin.settings.workflowsFolder ?? ""),
    }));
    const { vault } = plugin.app;
    plugin.registerEvent(vault.on("modify", (f) => store.onModify(f)));
    plugin.registerEvent(vault.on("create", (f) => void store.remember(f)));
    plugin.registerEvent(vault.on("rename", (f, old) => store.onRename(f, old)));
    plugin.registerEvent(vault.on("delete", (f) => lastContent.delete(f.path)));
    void store.init();
    return store;
  }

  isTable(path: string): boolean {
    const s = this.scope();
    return isTableNotePath(path, s.tablesFolder, s.workflowsFolder);
  }

  async init(): Promise<void> {
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.isTable(f.path) && !lastContent.has(f.path)) await this.remember(f);
    }
  }

  async remember(f: TAbstractFile): Promise<void> {
    if (f instanceof TFile && this.isTable(f.path)) lastContent.set(f.path, await this.app.vault.cachedRead(f));
  }

  onRename(f: TAbstractFile, oldPath: string): void {
    const c = lastContent.get(oldPath);
    lastContent.delete(oldPath);
    if (c !== undefined && this.isTable(f.path)) lastContent.set(f.path, c);
  }

  onModify(f: TAbstractFile): void {
    if (!(f instanceof TFile) || !this.isTable(f.path)) return;
    const prev = this.timers.get(f.path);
    if (prev !== undefined) window.clearTimeout(prev);
    this.timers.set(
      f.path,
      window.setTimeout(() => {
        this.timers.delete(f.path);
        void this.importNow(f);
      }, QUIET_MS),
    );
  }

  /** True while the note is open in an editor that has focus (don't rewrite under the cursor). */
  private beingTyped(file: TFile): boolean {
    let typing = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file?.path === file.path && v.getMode() === "source" && v.editor.hasFocus()) typing = true;
    });
    return typing;
  }

  /**
   * Compare the note with the last content the plugin saw and import the
   * edit. Returns what was done.
   */
  async importNow(file: TFile, opts: { ignoreFocus?: boolean } = {}): Promise<ImportKind> {
    const cur = await this.app.vault.read(file);
    const prev = lastContent.get(file.path);
    if (prev === undefined || prev === cur) {
      lastContent.set(file.path, cur);
      return "none";
    }
    if (!opts.ignoreFocus && this.beingTyped(file)) {
      // Try again once the person stops typing (the next modify reschedules too).
      this.onModify(file);
      return "none";
    }
    const result = importHandEdit(prev, cur);
    if (result.content === cur) {
      lastContent.set(file.path, cur);
      return result.kind;
    }
    let wrote = false;
    await this.app.vault.process(file, (now) => {
      if (now !== cur) return now; // edited again meanwhile: the next modify handles it
      wrote = true;
      lastContent.set(file.path, result.content);
      return result.content;
    });
    if (wrote) this.onImported?.(file.path, result.kind);
    return wrote ? result.kind : "none";
  }
}

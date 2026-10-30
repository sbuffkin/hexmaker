/**
 * The text of every note under the tables folder, kept in memory so the
 * table resolver (resolve.ts, which is synchronous) can roll on vault
 * tables: generators and their previews, and arrival rolls. Read once at
 * start, then kept up to date from vault events. Never writes.
 */

import { TFile, type TAbstractFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { contentFolder } from "../notePickers";
import { notesLookup, type TableLookup } from "./resolve";
import { parseRandomTable, type RandomTable } from "./randomTable";

export class TableNotes {
  private contents = new Map<string, string>();
  private cached: TableLookup | null = null;
  private ready = false;

  constructor(private plugin: HexmakerPlugin) {}

  static register(plugin: HexmakerPlugin): TableNotes {
    const notes = new TableNotes(plugin);
    const { vault } = plugin.app;
    plugin.registerEvent(vault.on("modify", (f) => void notes.read(f)));
    plugin.registerEvent(vault.on("create", (f) => void notes.read(f)));
    plugin.registerEvent(vault.on("delete", (f) => notes.drop(f.path)));
    plugin.registerEvent(vault.on("rename", (f, old) => { notes.drop(old); void notes.read(f); }));
    return notes;
  }

  private folder(): string {
    return contentFolder(this.plugin.settings, "tablesFolder");
  }

  private inScope(path: string): boolean {
    const folder = this.folder();
    return path.endsWith(".md") && (!folder || path.startsWith(`${folder}/`));
  }

  /** Read every note under the tables folder (again: the folder setting changed). */
  async init(): Promise<void> {
    this.contents.clear();
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      if (this.inScope(f.path)) this.contents.set(f.path, await this.plugin.app.vault.cachedRead(f));
    }
    this.cached = null;
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async read(f: TAbstractFile): Promise<void> {
    if (!(f instanceof TFile) || !this.inScope(f.path)) return;
    this.put(f.path, await this.plugin.app.vault.cachedRead(f));
  }

  /** Take a note's text now (the plugin just wrote it). */
  put(path: string, content: string): void {
    if (this.contents.get(path) === content) return;
    this.contents.set(path, content);
    this.cached = null;
  }

  private drop(path: string): void {
    if (this.contents.delete(path)) this.cached = null;
  }

  /** The tables as a lookup for the resolver (links by path or note name). */
  lookup(): TableLookup {
    if (!this.cached) this.cached = notesLookup(Object.fromEntries(this.contents));
    return this.cached;
  }

  /** Every note that reads as a table, with its table (for pickers). */
  tables(): { path: string; table: RandomTable }[] {
    const out: { path: string; table: RandomTable }[] = [];
    const lookup = this.lookup();
    for (const path of [...this.contents.keys()].sort()) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (name.startsWith("_")) continue;
      const t = lookup.table(path);
      if (t) out.push({ path, table: t.table });
    }
    return out;
  }

  /** A note's text, if it's under the tables folder. */
  text(path: string): string | undefined {
    return this.contents.get(path);
  }

  /** Parse a note's table (undefined when it isn't one we hold). */
  table(path: string): RandomTable | undefined {
    const c = this.contents.get(path);
    return c === undefined ? undefined : parseRandomTable(c);
  }
}

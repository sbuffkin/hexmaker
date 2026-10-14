/**
 * A store over a folder of notes that are the only copy of their data
 * (biome notes, World types tables): every note is read into an entry,
 * hand edits are read back live from vault events, and every change is
 * told to onChange listeners. Reads and writes run one at a time on a
 * queue, so a hand edit is always read before a write that follows it.
 *
 * Subclasses say where the folder is, which files are theirs, how a note
 * is read (load), and the words used in logs and backup folder names.
 */

import { TAbstractFile, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { ModuleStore } from "../modules/types";
import { writeJsonBackup } from "../backup";
import { ensureFolderPath } from "../vault/ensureFolder";

export abstract class NoteFolderStore<E extends { path: string }> implements ModuleStore {
  abstract readonly id: string;
  /** Logged with a failed queued task: "Hexmaker: <logLabel>". */
  protected abstract readonly logLabel: string;
  /** Backups go to `<plugin>/backups/<backupFolder>-<date>/`. */
  protected abstract readonly backupFolder: string;
  /** Logged when a backup fails: "Hexmaker: <backupLabel> backup failed". */
  protected abstract readonly backupLabel: string;

  protected entries = new Map<string, E>();
  protected lastContent = new Map<string, string>();
  protected reported = new Map<string, string>();
  protected listeners = new Set<() => void>();
  protected ready = false;
  protected queue: Promise<void> = Promise.resolve();

  constructor(protected plugin: HexmakerPlugin) {}

  abstract init(): Promise<void>;
  /** The folder the notes live in. */
  abstract folder(): string;
  /** Whether a vault file is one of this store's notes. */
  protected abstract isNoteFile(f: TAbstractFile): f is TFile;
  /** Read one note. True when what it says changed. */
  protected abstract load(f: TFile): Promise<boolean>;

  isReady(): boolean {
    return this.ready;
  }

  /** Call `fn` after every change. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Re-read every note (the folder setting changed). */
  async reload(): Promise<void> {
    await this.enqueue(async () => {
      this.entries.clear();
      this.lastContent.clear();
      for (const f of this.files()) await this.load(f);
      this.publish();
    });
  }

  // ── vault events ───────────────────────────────────────────────────────

  /** A new note is read like an edited one. */
  onCreate(f: TAbstractFile): void {
    this.onModify(f);
  }

  onModify(f: TAbstractFile): void {
    if (!this.isNoteFile(f)) return;
    void this.enqueue(async () => {
      if (await this.load(f)) this.publish();
    });
  }

  onDelete(f: TAbstractFile): void {
    if (!this.entries.has(f.path)) return;
    this.entries.delete(f.path);
    this.lastContent.delete(f.path);
    this.publish();
  }

  // ── internals ──────────────────────────────────────────────────────────

  protected publish(): void {
    for (const fn of this.listeners) fn();
  }

  /** Every note in the folder and its subfolders (not `_` notes), in path order. */
  protected files(): TFile[] {
    const root = this.plugin.app.vault.getAbstractFileByPath(this.folder());
    if (!(root instanceof TFolder)) return [];
    const out: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.path.endsWith(".md") && !child.name.startsWith("_")) out.push(child);
      }
    };
    walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  protected async ensureFolder(folder: string): Promise<void> {
    await ensureFolderPath(this.plugin.app.vault, folder);
  }

  protected async backup(base: string, notes: Record<string, string>): Promise<void> {
    try {
      const dir = `${this.plugin.manifest.dir}/backups/${this.backupFolder}-${new Date().toISOString().slice(0, 10)}`;
      await writeJsonBackup(this.plugin.app.vault.adapter, dir, base, JSON.stringify({ savedAt: new Date().toISOString(), notes }));
    } catch (e) {
      console.error(`Hexmaker: ${this.backupLabel} backup failed`, e);
    }
  }

  protected enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => {
      console.error(`Hexmaker: ${this.logLabel}`, e);
    });
    return this.queue;
  }
}

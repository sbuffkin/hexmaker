/**
 * The world's fields note (`<world folder>/Hex fields.md`, fieldsNote.ts):
 * read at start-up and again whenever it changes on disk (a hand edit,
 * sync), written only when the settings section edits it. The note is the
 * only copy; nothing is kept in data.json. No note = no fields.
 *
 * Reads and writes run one at a time on a queue, so a hand edit is read
 * before a write that follows it, and the write keeps the user's own text
 * around the two tables (updateFieldsNote).
 */

import { TFile, type TAbstractFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { ensureFolderPath } from "../vault/ensureFolder";
import { logError, logWarn } from "../log";
import { EMPTY_DECLS, type FieldDecls } from "./fieldTypes";
import { FIELDS_NOTE_NAME, parseFieldsNote, updateFieldsNote, type FieldsNoteProblem } from "./fieldsNote";

export class FieldStore {
  private decls: FieldDecls = EMPTY_DECLS;
  private problemList: FieldsNoteProblem[] = [];
  private lastText: string | null = null;
  private reported = "";
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private plugin: HexmakerPlugin) {}

  /** `<world folder>/Hex fields.md`. */
  notePath(): string {
    const folder = normalizeFolder(this.plugin.settings.worldFolder ?? "");
    return folder ? `${folder}/${FIELDS_NOTE_NAME}` : FIELDS_NOTE_NAME;
  }

  /** The declarations as last read (empty without a note). */
  get(): FieldDecls {
    return this.decls;
  }

  /** Rows of the note that couldn't be read. */
  problems(): readonly FieldsNoteProblem[] {
    return this.problemList;
  }

  noteFile(): TFile | null {
    const f = this.plugin.app.vault.getAbstractFileByPath(this.notePath());
    return f instanceof TFile ? f : null;
  }

  /** Call `fn` after every change. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  init(): Promise<void> {
    return this.enqueue(() => this.load());
  }

  /** Replace the declarations: the note is written (made if missing), keeping its other text. */
  save(decls: FieldDecls): Promise<void> {
    this.set(decls, this.problemList);
    return this.enqueue(async () => {
      const vault = this.plugin.app.vault;
      const file = this.noteFile();
      if (file) {
        await vault.process(file, (c) => (this.lastText = updateFieldsNote(c, decls)));
      } else {
        const path = this.notePath();
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (folder) await ensureFolderPath(vault, folder);
        this.lastText = updateFieldsNote("", decls);
        await vault.create(path, this.lastText);
      }
    });
  }

  // ── vault events ───────────────────────────────────────────────────────

  onModify(f: TAbstractFile): void {
    if (f.path === this.notePath()) void this.enqueue(() => this.load());
  }

  onDelete(f: TAbstractFile): void {
    if (f.path !== this.notePath()) return;
    this.lastText = null;
    this.set(EMPTY_DECLS, []);
  }

  onRename(f: TAbstractFile, oldPath: string): void {
    if (f.path === this.notePath() || oldPath === this.notePath()) void this.enqueue(() => this.load());
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const file = this.noteFile();
    if (!file) {
      if (this.decls !== EMPTY_DECLS) this.set(EMPTY_DECLS, []);
      this.lastText = null;
      return;
    }
    const text = await this.plugin.app.vault.read(file);
    if (text === this.lastText && this.decls !== EMPTY_DECLS) return;
    this.lastText = text;
    const read = parseFieldsNote(text);
    this.set({ fields: read.fields, influences: read.influences }, read.problems);
    const said = read.problems.map((p) => `${p.where}: ${p.text} (${p.reason})`).join("\n");
    if (said && said !== this.reported) logWarn(`rows of ${file.path} that can't be read:\n${said}`);
    this.reported = said;
  }

  private set(decls: FieldDecls, problems: FieldsNoteProblem[]): void {
    this.decls = decls;
    this.problemList = problems;
    for (const fn of this.listeners) fn();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => logError("hex fields note", e));
    return this.queue;
  }
}

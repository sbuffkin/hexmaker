/**
 * The table editor's linked-folder sync (a table whose rows are notes in a
 * folder): stub notes for new rows, renamed notes for renamed rows, "_"
 * for deleted rows, rows for notes added by hand. Split from
 * RandomTableEditorModal.
 *
 * The folder and the row text come from the table note, which may come
 * from someone else's pack, so the folder must be inside the world folder
 * and not hidden, and row text is cleaned into a file name before it
 * becomes a path.
 */
import { TFile, type App } from "obsidian";
import type { RandomTableEntry } from "../randomTable";
import { worldFolderOf } from "../../notePickers";
import { ensureFolder } from "../../vault/ensureFolder";
import { isFolderInside, noteFileName } from "../../vault/safePaths";

/** The note a row of a linked-folder table stands for: its text as a file name ("" = none). */
export function rowNoteName(result: string): string {
  return noteFileName(result);
}

/** A row's note path in `folder`, or null when its text leaves no file name. */
export function rowNotePath(folder: string, result: string): string | null {
  const name = rowNoteName(result);
  return name ? `${folder}/${name}.md` : null;
}

/** Whether the editor may sync notes in `folder`: a folder inside the world folder, not hidden. */
export function linkedFolderAllowed(folder: string, settings: { worldFolder?: string }): boolean {
  return !!folder && isFolderInside(folder, [worldFolderOf(settings)]);
}

/** Rows whose note isn't in the folder (kept and reported, never recreated). */
export function missingRowNotes(app: App, folder: string, entries: readonly RandomTableEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const p = rowNotePath(folder, e.result);
    if (p && !app.vault.getAbstractFileByPath(p)) out.add(e.result);
  }
  return out;
}

/** Sync entries ↔ notes in the folder: a stub note for each new row, a row for each note added by hand. Mutates entries. */
export async function syncLinkedFolder(app: App, entries: RandomTableEntry[], folder: string, missingAtOpen: ReadonlySet<string>): Promise<void> {
  await ensureFolder(app.vault, folder);
  const existing = app.vault
    .getMarkdownFiles()
    .filter((f) => f.parent?.path === folder && !f.basename.startsWith("_"));
  for (const entry of entries) {
    // A row whose note was missing when the editor opened is reported, not recreated.
    if (missingAtOpen.has(entry.result)) continue;
    const notePath = rowNotePath(folder, entry.result);
    if (!notePath || app.vault.getAbstractFileByPath(notePath)) continue;
    try {
      await app.vault.create(notePath, `# ${entry.result}\n`);
    } catch {
      /* made meanwhile, or a name the file system refuses: the row stays */
    }
  }
  const names = new Set(entries.map((e) => rowNoteName(e.result)));
  for (const f of existing) {
    if (!names.has(f.basename)) entries.push({ result: f.basename, weight: 1 });
  }
}

/** Rename the notes of rows whose text was changed, instead of making new ones. */
export async function renameUpdatedEntries(app: App, entries: readonly RandomTableEntry[], originalResults: WeakMap<RandomTableEntry, string>, folder: string): Promise<void> {
  for (const entry of entries) {
    const orig = originalResults.get(entry);
    if (!orig || orig === entry.result) continue;
    const oldPath = rowNotePath(folder, orig);
    const newPath = rowNotePath(folder, entry.result);
    if (!oldPath || !newPath || oldPath === newPath) continue;
    const note = app.vault.getAbstractFileByPath(oldPath);
    if (!(note instanceof TFile)) continue;
    if (app.vault.getAbstractFileByPath(newPath)) continue; // target already exists
    try {
      await app.fileManager.renameFile(note, newPath);
    } catch {
      /* best-effort */
    }
  }
}

/** Prepend "_" to the notes of deleted rows, so later syncs leave them out. */
export async function retireDeletedEntries(app: App, originalResults: ReadonlySet<string>, current: readonly RandomTableEntry[], folder: string): Promise<void> {
  const currentNames = new Set(current.map((e) => e.result));
  for (const result of originalResults) {
    if (currentNames.has(result)) continue;
    const name = rowNoteName(result);
    if (!name) continue;
    const note = app.vault.getAbstractFileByPath(`${folder}/${name}.md`);
    if (!(note instanceof TFile)) continue;
    try {
      await app.fileManager.renameFile(note, `${folder}/_${name}.md`);
    } catch {
      /* already renamed or missing */
    }
  }
}

/** The note's text now, or null when it's gone. */
export async function currentText(app: App, file: TFile): Promise<string | null> {
  const now = app.vault.getAbstractFileByPath(file.path);
  return now instanceof TFile ? app.vault.read(now) : null;
}

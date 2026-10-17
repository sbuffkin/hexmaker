/**
 * Undo for text a party step wrote into a hex note (owner HF7: "one undo =
 * the whole step"): a "note-section" entry holds one section's text before
 * and after. Undo puts the section back as it was, redo writes it again,
 * each only while the section still shows what the entry left there; a
 * section edited since is left alone, and the user is told. A note the
 * step made stays (with its template); only the section text goes.
 */
import { Notice, TFile, type App } from "obsidian";
import { replaceSectionText, sectionText } from "../sections";
import type { UndoDirection } from "../undoBook";
import type { UndoItem } from "./undoItems";

export type NoteSectionUndo = Extract<UndoItem, { kind: "note-section" }>;

const noteName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

/** "Features in 4_5 was edited since, so it stays." */
export function editedSinceText(item: NoteSectionUndo): string {
  return `${item.section} in ${noteName(item.path)} was edited since, so it stays.`;
}

/** The entry when its section still shows what it left (undo: "after"; redo: "before"); else null, and `tell` says so. */
export async function prepareNoteSection(
  app: App, item: NoteSectionUndo, dir: UndoDirection, tell: (text: string) => void = (t) => new Notice(t),
): Promise<NoteSectionUndo | null> {
  const file = app.vault.getAbstractFileByPath(item.path);
  if (!(file instanceof TFile)) return null;
  const now = sectionText(await app.vault.read(file), item.section);
  if (now === (dir === "undo" ? item.after : item.before)) return item;
  tell(editedSinceText(item));
  return null;
}

/** Put the section back (undo) or write it again (redo). */
export async function applyNoteSection(app: App, item: NoteSectionUndo, dir: UndoDirection): Promise<void> {
  const file = app.vault.getAbstractFileByPath(item.path);
  if (!(file instanceof TFile)) return;
  const text = dir === "undo" ? item.before : item.after;
  await app.vault.process(file, (c) => replaceSectionText(c, item.section, text));
}

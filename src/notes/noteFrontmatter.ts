import { App, TFile } from "obsidian";
import { noteRefTarget } from "../noteFormats";
import type { Frontmatter } from "./frontmatterText";

/** A note's cached frontmatter, or null when the path isn't a note. */
export function getFrontMatter(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter as Frontmatter;
  return frontmatter;
}

/**
 * The note a reference names: a wikilink (resolved like Obsidian does,
 * from `sourcePath`) or a vault path (with or without ".md"). Null when
 * it names no note.
 */
export function resolveNoteRef(app: App, value: unknown, sourcePath: string): TFile | null {
  const { target, link } = noteRefTarget(value);
  if (!target) return null;
  const direct = app.vault.getAbstractFileByPath(target) ?? app.vault.getAbstractFileByPath(`${target}.md`);
  if (direct instanceof TFile) return direct;
  if (!link) return null;
  const dest = app.metadataCache.getFirstLinkpathDest?.(target.replace(/\.md$/i, ""), sourcePath);
  return dest instanceof TFile ? dest : null;
}

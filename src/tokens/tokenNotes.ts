/**
 * Token notes in the vault: read a note's token from the metadata cache
 * (or from the file itself), and write its `token-*` frontmatter. The keys
 * themselves are in tokens/tokenFields.ts.
 */
import { App, TFile, parseYaml } from "obsidian";
import type { TokenEntry } from "../types";
import { mapNameFromRef } from "../noteFormats";
import type { Frontmatter } from "../notes/frontmatterText";
import { resolveNoteRef } from "../notes/noteFrontmatter";
import { TOKEN_KEYS, type TokenFieldPatch, tokenEntryFromFm, tokenMapValue, writeTokenFields } from "./tokenFields";

export function getTokenDataFromCache(app: App, file: TFile): TokenEntry | null {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm?.["token"]) return null;
  return tokenEntryFromFm(fm, file, resolveNoteRef(app, fm["token-link"], file.path));
}

/**
 * Where a token note's token is now ({hex, map}), read from the file
 * itself (the metadata cache can lag a write by a tick), or null when the
 * note isn't a token. For undo's "has it moved since?" check.
 */
export async function readTokenPlace(app: App, path: string): Promise<{ hex: string; map: string } | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const text = await app.vault.read(file);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  let fm: Record<string, unknown> | null = null;
  try { fm = parseYaml(m[1]) as Record<string, unknown> | null; } catch { return null; }
  if (!fm?.["token"]) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return { hex: s(fm["token-hex"]), map: mapNameFromRef(fm["token-map"]) };
}

export async function setTokenHex(
  app: App,
  path: string,
  hex: string,
  map: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    fm["token-hex"] = hex;
    fm["token-map"] = tokenMapValue(map);
  });
}

export async function setTokenVisible(
  app: App,
  path: string,
  visible: boolean,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    fm["token-visible"] = visible;
  });
}

export async function removeTokenFrontmatter(
  app: App,
  path: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
    for (const key of TOKEN_KEYS) delete fm[key];
  });
}

export async function applyTokenFrontmatter(
  app: App,
  path: string,
  data: TokenFieldPatch,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => writeTokenFields(fm, data));
}

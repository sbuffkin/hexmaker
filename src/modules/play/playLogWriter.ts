/**
 * Writes the play log (src/modules/play/playLog.ts has the format): one dated note
 * per day, entries appended, and a link back from the hex's note.
 */
import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getTokenDataFromCache } from "../../frontmatter";
import { addLinkToSection } from "../../sections";
import { ensureFolder } from "../../vault/ensureFolder";
import type { TokenEntry } from "../../types";
import { partyFor } from "./partyTravel";
import {
  appendLogEntry,
  formatLogEntry,
  HEX_LOG_SECTION,
  logDayLink,
  logDayName,
  logFolderFor,
  logNotePath,
  logTime,
  newLogNote,
} from "./playLog";
import { hexKey } from "../../hexKey";

/** Every token on map `mapName` (from the metadata cache). */
export function tokensOnMap(app: App, mapName: string): TokenEntry[] {
  const out: TokenEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const t = getTokenDataFromCache(app, file);
    if (t && t.map === mapName) out.push(t);
  }
  return out;
}


/** Today's log note in `folder`, made if missing. */
export async function ensureLogNote(app: App, folder: string, now = new Date()): Promise<TFile> {
  const path = logNotePath(folder, now);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  if (folder) await ensureFolder(app.vault, folder);
  try {
    return await app.vault.create(path, newLogNote(logDayName(now)));
  } catch (err) {
    const again = app.vault.getAbstractFileByPath(path);
    if (again instanceof TFile) return again;
    throw err;
  }
}

/** How an entry is written (addToPlayLog). */
export interface PlayLogOptions {
  /** The party token the entry names (its note path); default: the one on the hex, else the map's. */
  partyPath?: string;
  /**
   * Link the hex: make its note when missing and list the day under its
   * "Log" heading (default). Off: link the hex only when its note exists,
   * and leave the note alone (a move line shouldn't make a note per step).
   */
  linkHex?: boolean;
}

/**
 * Append `text` to today's play log for hex (x, y) of `mapName`, naming the
 * party token there (or the map's party): in that party's log folder if it
 * has one, else the campaign's. The hex's note (made if needed) gets a link
 * to the day's note under "Log". Returns the log note's path.
 */
export async function addToPlayLog(
  plugin: HexmakerPlugin,
  mapName: string,
  x: number,
  y: number,
  text: string,
  now = new Date(),
  opts: PlayLogOptions = {},
): Promise<string> {
  const app = plugin.app;
  const tokens = tokensOnMap(app, mapName);
  const party = (opts.partyPath ? tokens.find((t) => t.filePath === opts.partyPath) : undefined) ?? partyFor(tokens, mapName, hexKey(x, y));
  const folder = logFolderFor(plugin.settings, party);
  const log = await ensureLogNote(app, folder, now);
  const linkHex = opts.linkHex !== false;

  const hexPath = plugin.hexPath(x, y, mapName);
  let hexFile = app.vault.getAbstractFileByPath(hexPath);
  if (!(hexFile instanceof TFile) && linkHex) hexFile = await plugin.createHexNote(x, y, mapName);
  const hexLink = hexFile instanceof TFile
    ? `[[${app.metadataCache.fileToLinktext(hexFile, log.path)}|${plugin.hexLinkAlias(hexFile.path)}]]`
    : `${plugin.mapLabel(mapName)} ${x}, ${y}`;
  const partyFile = party ? app.vault.getAbstractFileByPath(party.filePath) : null;
  const partyLink = partyFile instanceof TFile && party
    ? `[[${app.metadataCache.fileToLinktext(partyFile, log.path)}${party.title !== partyFile.basename ? `|${party.title}` : ""}]]`
    : undefined;

  const entry = formatLogEntry({ time: logTime(now), hexLink, partyLink, text });
  await app.vault.process(log, (content) => appendLogEntry(content, entry, logDayName(now)));
  if (linkHex && hexFile instanceof TFile) await addLinkToSection(app, hexFile.path, HEX_LOG_SECTION, logDayLink(log.path));
  return log.path;
}

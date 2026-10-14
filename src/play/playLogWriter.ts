/**
 * Writes the play log (src/play/playLog.ts has the format): one dated note
 * per day, entries appended, and a link back from the hex's note.
 */
import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getTokenDataFromCache } from "../frontmatter";
import { addLinkToSection } from "../sections";
import type { TokenEntry } from "../types";
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

/** Every token on map `mapName` (from the metadata cache). */
export function tokensOnMap(app: App, mapName: string): TokenEntry[] {
  const out: TokenEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const t = getTokenDataFromCache(app, file);
    if (t && t.map === mapName) out.push(t);
  }
  return out;
}

/** Make `folder` (and its parents) if missing. */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder || app.vault.getAbstractFileByPath(folder)) return;
  try { await app.vault.createFolder(folder); } catch { /* made meanwhile */ }
}

/** Today's log note in `folder`, made if missing. */
export async function ensureLogNote(app: App, folder: string, now = new Date()): Promise<TFile> {
  const path = logNotePath(folder, now);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  await ensureFolder(app, folder);
  try {
    return await app.vault.create(path, newLogNote(logDayName(now)));
  } catch (err) {
    const again = app.vault.getAbstractFileByPath(path);
    if (again instanceof TFile) return again;
    throw err;
  }
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
): Promise<string> {
  const app = plugin.app;
  const party = partyFor(tokensOnMap(app, mapName), mapName, `${x}_${y}`);
  const folder = logFolderFor(plugin.settings, party);
  const log = await ensureLogNote(app, folder, now);

  const hexPath = plugin.hexPath(x, y, mapName);
  let hexFile = app.vault.getAbstractFileByPath(hexPath);
  if (!(hexFile instanceof TFile)) hexFile = await plugin.createHexNote(x, y, mapName);
  const hexLink = hexFile instanceof TFile
    ? `[[${app.metadataCache.fileToLinktext(hexFile, log.path)}|${plugin.hexLinkAlias(hexFile.path)}]]`
    : `${plugin.mapLabel(mapName)} ${x}, ${y}`;
  const partyFile = party ? app.vault.getAbstractFileByPath(party.filePath) : null;
  const partyLink = partyFile instanceof TFile && party
    ? `[[${app.metadataCache.fileToLinktext(partyFile, log.path)}${party.title !== partyFile.basename ? `|${party.title}` : ""}]]`
    : undefined;

  const entry = formatLogEntry({ time: logTime(now), hexLink, partyLink, text });
  await app.vault.process(log, (content) => appendLogEntry(content, entry, logDayName(now)));
  if (hexFile instanceof TFile) await addLinkToSection(app, hexFile.path, HEX_LOG_SECTION, logDayLink(log.path));
  return log.path;
}

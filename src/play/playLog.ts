/**
 * The play log (owner call SF3, 2026-10-13): what happened in a session
 * goes to a dated note, not into a hex's Description.
 *
 * One note per day in the campaign's log folder (setting "Play log folder",
 * asked in the setup wizard; blank = `<world folder>/log`), named
 * `YYYY-MM-DD.md`. A party token may keep its own log: `token-log: <folder>`
 * in its note (Token form → Advanced), so two parties can keep two logs.
 * Entries are appended, one bullet each, plain Markdown:
 *
 *   # 2026-10-14
 *
 *   - 14:32 · [[world/hexes/vale/3_4|Vale 3, 4]] · [[Brennar's band]] · Wolves on the ridge.
 *
 * The hex's note gets a link back under a "Log" heading (once per day).
 * Barebones and generic: no ruleset, no fields beyond time, hex, party, text.
 *
 * Pure: no Obsidian imports.
 */

/** The heading hex notes list their log days under. */
export const HEX_LOG_SECTION = "Log";

/** Where the log lives when the setting is blank, under the world folder. */
export const LOG_SUBFOLDER = "log";

const trimFolder = (p: string | undefined): string => (p ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

/** The day's note name, local time: "2026-10-14". */
export function logDayName(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The entry's time, local: "14:32". */
export function logTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The log folder an entry goes to: the party token's own (`token-log`),
 * else the setting, else `<world folder>/log`.
 */
export function logFolderFor(
  settings: { logFolder?: string; worldFolder?: string },
  party?: { logFolder?: string },
): string {
  return trimFolder(party?.logFolder) || trimFolder(settings.logFolder) || `${trimFolder(settings.worldFolder) || "world"}/${LOG_SUBFOLDER}`;
}

/** The day's log note path in `folder`. */
export function logNotePath(folder: string, d: Date): string {
  const f = trimFolder(folder);
  return `${f ? `${f}/` : ""}${logDayName(d)}.md`;
}

/** One log entry: time, the hex, the party (when there is one) and the text. */
export interface LogEntry {
  time: string;
  /** A wikilink to the hex (its note), e.g. `[[world/hexes/vale/3_4|Vale 3, 4]]`. */
  hexLink?: string;
  /** A wikilink to the party token's note. */
  partyLink?: string;
  text: string;
}

/**
 * The entry as a Markdown bullet. Text over several lines keeps its line
 * breaks, indented under the bullet so it stays one list item.
 */
export function formatLogEntry(e: LogEntry): string {
  const lines = e.text.replace(/\r\n?/g, "\n").trim().split("\n");
  const head = [e.time, e.hexLink, e.partyLink, lines[0]].filter((p) => !!p && p.trim()).join(" · ");
  return [`- ${head}`, ...lines.slice(1).map((l) => (l.trim() ? `  ${l}` : ""))].join("\n");
}

/** A new day's log note. */
export function newLogNote(dayName: string): string {
  return `# ${dayName}\n\n`;
}

/** `content` (a log note, maybe empty) with `entry` appended at the end. */
export function appendLogEntry(content: string, entry: string, dayName: string): string {
  const base = content.trim() ? content : newLogNote(dayName);
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const body = base.replace(/\s+$/, "");
  // A bullet list: entries follow each other directly; anything else gets a blank line first.
  const lastLine = body.split(/\r?\n/).pop() ?? "";
  const sep = /^\s*([-*+]|\d+\.)\s|^\s{2,}\S/.test(lastLine) ? eol : eol + eol;
  return body + sep + entry.replace(/\n/g, eol) + eol;
}

/** A link to the day's log note, for the hex's Log section: `[[world/log/2026-10-14|2026-10-14]]`. */
export function logDayLink(notePath: string): string {
  const target = notePath.replace(/\.md$/i, "");
  const day = target.slice(target.lastIndexOf("/") + 1);
  return `[[${target}|${day}]]`;
}

/** The "Add to this hex" target that means the play log, not a section of the hex's note. */
export const PLAY_LOG_TARGET = "play-log";

/**
 * Where a roll's "Add to this hex" points first: the play log in Play
 * (SF3), else the section the roll came from.
 */
export function rollDefaultSection(mode: "play" | "build" | "god", fromSection: string): string {
  return mode === "play" ? PLAY_LOG_TARGET : fromSection;
}

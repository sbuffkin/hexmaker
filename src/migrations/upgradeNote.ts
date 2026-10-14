/**
 * The upgrade note (owner MG1): after start-up upgrades changed a vault, a
 * visible note "Hexmaker upgrade <date>" in the world folder says what
 * changed, what was backed up and where, and anything to check, with
 * "update every device first" as its first line and the changelog's points
 * newer than the version the vault came from. The one combined upgrade
 * notice (ui/notify.ts, MG1b) links to it.
 *
 * The text is built by pure functions (tested); writeUpgradeNote puts it in
 * the vault, never over an existing note.
 */
import type { App } from "obsidian";
import { compareVersions } from "../compat";
import type { UpgradeEntry } from "./upgradeReport";

/** The note's name for a date: "Hexmaker upgrade 2026-10-14". */
export function upgradeNoteName(date: Date): string {
  return `Hexmaker upgrade ${isoDate(date)}`;
}

/** The first line of every upgrade note (owner MG7, option A). */
export const UPDATE_DEVICES_LINE =
  "**Update every device that shares this vault first.** A device still on an older version of Hexmap World Creator shows these maps without their terrain or paths, and may write the old format back. Update the plugin there before opening a map.";

export interface UpgradeNoteInput {
  date: Date;
  /** The version that last saved the vault ("1.5.6"), or undefined when unknown. */
  from: string | undefined;
  /** This version. */
  to: string;
  entries: UpgradeEntry[];
  /** The plugin's backups folder (vault-relative). */
  backupsFolder: string;
  /** CHANGELOG.md's text (its points newer than `from` are listed). */
  changelog?: string;
  /** The command palette's prefix ("Hexmap World Creator"). */
  pluginName: string;
}

/** The note's Markdown. */
export function upgradeNoteText(input: UpgradeNoteInput): string {
  const { date, entries } = input;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const from = input.from ? `version ${input.from}` : "an older version";
  const lines: string[] = [
    `# ${upgradeNoteName(date)}`,
    "",
    UPDATE_DEVICES_LINE,
    "",
    `Hexmap World Creator updated this vault from ${from} to version ${input.to} on ${isoDate(date)} at ${time}.`,
    "",
    "## What changed",
    "",
  ];
  const changed = unique(entries.map((e) => sentence(e.text)));
  lines.push(...(changed.length ? changed.map((t) => `- ${t}`) : ["- Nothing in your notes changed."]));
  lines.push(
    "",
    "## Backups",
    "",
    `Everything the upgrade changed was copied first, into the plugin's backups folder \`${input.backupsFolder}\` (Obsidian hides it from the file list). **${input.pluginName}: Open backups folder** shows it; **${input.pluginName}: Restore from upgrade backup…** puts notes back as they were.`,
    "",
  );
  const backups = unique(entries.flatMap((e) => e.backups ?? []));
  lines.push(...(backups.length ? backups.map((b) => `- \`${b}\``) : ["- No notes needed a backup."]));
  lines.push("", "## To check", "");
  const checks = unique([
    ...entries.flatMap((e) => e.check ?? []).map(sentence),
    "Open your maps once: each should look as it did before.",
  ]);
  lines.push(...checks.map((c) => `- [ ] ${c}`));
  const news = changelogPoints(input.changelog ?? "", input.from);
  if (news.length) lines.push("", "## What's new", "", ...news);
  return lines.join("\n") + "\n";
}

/**
 * The changelog's points newer than `from`: each `## <version>` (and
 * `## Unreleased`) section above it, with its `###` groups as `###`
 * headings. HTML comments (slice markers) are dropped.
 */
export function changelogPoints(changelog: string, from: string | undefined): string[] {
  const text = changelog.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n");
  const out: string[] = [];
  let take = false;
  let group: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const sec = /^##\s+(.+)$/.exec(line);
    if (sec && !line.startsWith("###")) {
      const v = sec[1].trim().replace(/^v/i, "");
      take = /^unreleased$/i.test(v) || !from || compareVersions(v.split(/\s/)[0], from) > 0;
      group = null;
      continue;
    }
    if (!take) continue;
    const g = /^###\s+(.+)$/.exec(line);
    if (g) { group = g[1].trim(); continue; }
    if (/^\s*[-*]\s+\S/.test(line)) {
      if (group !== null) {
        if (out.length) out.push("");
        out.push(`### ${group}`, "");
        group = null;
      }
      out.push(`- ${line.replace(/^\s*[-*]\s+/, "")}`);
    }
  }
  return out;
}

/** Write the note into `folder` (vault root when blank). Never over a note: "(2)", "(3)"… Returns its path. */
export async function writeUpgradeNote(app: App, folder: string, input: UpgradeNoteInput): Promise<string> {
  const base = upgradeNoteName(input.date);
  const dir = folder.replace(/^\/+|\/+$/g, "");
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    try { await app.vault.createFolder(dir); } catch { /* made meanwhile */ }
  }
  const at = (n: number) => `${dir ? `${dir}/` : ""}${base}${n > 1 ? ` (${n})` : ""}.md`;
  let n = 1;
  while (app.vault.getAbstractFileByPath(at(n))) n++;
  const path = at(n);
  await app.vault.create(path, upgradeNoteText(input));
  return path;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First letter up, a full stop at the end. */
function sentence(t: string): string {
  const s = t.trim().replace(/^Hexmap World Creator:\s*/, "");
  if (!s) return s;
  const up = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…)]$/.test(up) ? up : `${up}.`;
}

function unique(list: string[]): string[] {
  return [...new Set(list.filter((s) => s.trim()))];
}

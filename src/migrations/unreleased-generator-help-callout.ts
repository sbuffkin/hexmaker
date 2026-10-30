/**
 * Unreleased → 2.0 (audit-generated-notes-2026-10-10): the ~30-line help in
 * every generator note becomes a collapsed callout, so a note opens on its
 * tables. An older note's help is wrapped as it stands, hand edits and all,
 * and stops at the end of its list: text the user wrote after it stays out
 * of the callout. The reader ignores help in either form, forever, so a note
 * from an older device still works.
 */
import { HELP_TITLE } from "../../packages/hex-wfc/src";
import type { NoteRewrite } from "./noteRewrites";

const HELP_START = /^A wave function collapse generator\./;

/** The note with its plain help wrapped in the callout (unchanged when it has none). */
export function wrapGeneratorHelp(content: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fmEnd < 0) return content;
  const start = lines.findIndex((l, i) => i > fmEnd && HELP_START.test(l));
  if (start < 0) return content;
  // The opening line, blank lines, then the list and its indented lines.
  let end = start + 1;
  while (end < lines.length && lines[end].trim() === "") end++;
  while (end < lines.length && /^(- |\s+\S)/.test(lines[end])) end++;
  const help = lines.slice(start, end);
  while (help[help.length - 1].trim() === "") help.pop();
  const callout = [`> [!info]- ${HELP_TITLE}`, ...help.map((l) => (l.trim() ? `> ${l}` : ">"))];
  return [...lines.slice(0, start), ...callout, ...lines.slice(start + help.length)].join(eol);
}

/** Generator notes (the marker in frontmatter), not their saves. */
function generatorNote(path: string, folder: string, text: string): boolean {
  return path.startsWith(`${folder}/`) && !path.startsWith(`${folder}/saves/`) && /^hex-wfc\s*:/m.test(text);
}

const folderOf = (world: string | undefined) => (world ? `${world}/generators` : "generators");

export const generatorHelpCallout: NoteRewrite = {
  info: {
    id: "unreleased-generator-help-callout",
    from: "unreleased",
    to: "2.0",
    phase: "notes",
    change: "The help text in generator notes is folded into a collapsed callout.",
    recordedBy: "noteFormatUpgrades: generator-help",
  },
  recordId: "generator-help",
  label: "help text in generator notes",
  async plan(host, add) {
    const folder = folderOf(host.settings.worldFolder);
    for (const file of host.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${folder}/`)) continue;
      const text = await host.app.vault.cachedRead(file);
      if (generatorNote(file.path, folder, text)) add(file.path, text, wrapGeneratorHelp(text));
    }
  },
  replan(_host, _path, current) {
    return wrapGeneratorHelp(current);
  },
};

export const info = generatorHelpCallout.info;

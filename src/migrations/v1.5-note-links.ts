/**
 * 1.5.x → 1.6 (NF3): token notes' `token-map: coast` becomes a link to the
 * map note, `token-link: world/npcs/Ana.md` a link to that note, and
 * workflows' `template-file:` path a link to the template. "_" notes are
 * never touched. Readers accept the plain forms forever.
 */
import { TFile } from "obsidian";
import { linkNotePathKey, linkTokenMap } from "../noteFormats";
import { normalizeFolder } from "../utils";
import { mayHave, type NoteRewrite } from "./noteRewrites";

export const noteLinks: NoteRewrite = {
  info: {
    id: "v1.5-note-links",
    from: "1.5.x",
    to: "1.6",
    phase: "notes",
    change: "Token notes and workflows name their map, note and template as links.",
    recordedBy: "noteFormatUpgrades: note-links",
  },
  recordId: "note-links",
  label: "links for token maps, token notes and workflow templates",
  async plan(host, add) {
    const { vault } = host.app;
    const exists = (p: string) => vault.getAbstractFileByPath(p) instanceof TFile;
    const wfFolder = normalizeFolder(host.settings.workflowsFolder ?? "");
    for (const file of vault.getMarkdownFiles()) {
      if (file.basename.startsWith("_") || !mayHave(host, file, ["token-map", "token-link", "template-file"])) continue;
      const text = await vault.cachedRead(file);
      if (!text.startsWith("---")) continue;
      let next = text;
      if (/^token-map\s*:/m.test(next)) next = linkTokenMap(next).content;
      if (/^token-link\s*:/m.test(next)) next = linkNotePathKey(next, "token-link", exists).content;
      if (wfFolder && file.path.startsWith(wfFolder + "/") && /^template-file\s*:/m.test(next)) next = linkNotePathKey(next, "template-file", exists).content;
      add(file.path, text, next);
    }
  },
  replan(host, path, current) {
    const { vault } = host.app;
    const exists = (p: string) => vault.getAbstractFileByPath(p) instanceof TFile;
    let next = linkTokenMap(current).content;
    next = linkNotePathKey(next, "token-link", exists).content;
    const wfFolder = normalizeFolder(host.settings.workflowsFolder ?? "");
    if (wfFolder && path.startsWith(wfFolder + "/")) next = linkNotePathKey(next, "template-file", exists).content;
    return next;
  },
};

export const info = noteLinks.info;

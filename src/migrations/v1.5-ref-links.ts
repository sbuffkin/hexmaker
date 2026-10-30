/**
 * 1.5.x → 1.6 (NF3, the remaining references): map notes' `palette:` and
 * `region-palette:`, palette notes' `child-palette:`, generators'
 * `palette:`, `source-map(s):` and `blend-of:`, generator saves'
 * `generator-path:`, and each module's own notes (Space: World types
 * tables' Palette column) become links to the notes they name. A name that
 * names no note is left as typed. Readers accept plain names forever.
 */
import { TFile } from "obsidian";
import { linkFrontmatterKey, linkFrontmatterList, mapNoteLink, pathLink } from "../noteFormats";
import { normalizeFolder } from "../utils";
import type { NoteFormatHost, NoteRewrite } from "./noteRewrites";

export const refLinks: NoteRewrite = {
  info: {
    id: "v1.5-ref-links",
    from: "1.5.x",
    to: "1.6",
    phase: "notes",
    change: "Map, palette and generator notes name the palettes, maps and generators they use as links.",
    recordedBy: "noteFormatUpgrades: ref-links",
  },
  recordId: "ref-links",
  label: "links for palettes, generators and source maps in map, palette, generator and world types notes",
  async plan(host, add) {
    const { vault } = host.app;
    const refs = refLinker(host);
    for (const file of vault.getMarkdownFiles()) {
      if (!refs.mayHave(file.path)) continue;
      const text = await vault.cachedRead(file);
      add(file.path, text, refs.rewrite(file.path, text));
    }
  },
  replan(host, path, current) {
    return refLinker(host).rewrite(path, current);
  },
};

export const info = refLinks.info;

/**
 * "ref-links": which notes can hold a plain reference, and the rewrite of
 * one. Map notes (one per known map), palette notes (the palettes folder),
 * generators and their saves (the generators folder), and each module's
 * own notes (Space: World types tables, in their folder). Each key is rewritten on its own line; nothing else in
 * the note changes.
 */
function refLinker(host: NoteFormatHost): { mayHave(path: string): boolean; rewrite(path: string, text: string): string } {
  const { vault } = host.app;
  const isFile = (p: string | undefined): p is string => !!p && vault.getAbstractFileByPath(p) instanceof TFile;
  const world = normalizeFolder(host.settings.worldFolder ?? "");
  const generators = world ? `${world}/generators` : "generators";
  const saves = `${generators}/saves`;
  const palettes = host.paletteStore ? normalizeFolder(host.paletteStore.folder()) : "";
  const modules = (host.moduleRefLinks ?? []).map((l) => ({ linker: l, folder: normalizeFolder(l.folder()) }));
  const mapNotes = new Set(host.mapStore.notePath ? host.settings.maps.map((m) => host.mapStore.notePath!(m.name)) : []);
  const maps = new Set(host.settings.maps.map((m) => m.name));
  const under = (path: string, folder: string) => !!folder && path.startsWith(folder + "/");
  /** A palette name → a link to its note (it must exist). */
  const paletteLink = (name: string) => {
    const path = host.paletteStore?.notePathOf(name);
    const link = isFile(path) ? pathLink(path) : undefined;
    return link && link.replace(/^\[\[|\]\]$/g, "").split("/").pop() === name ? link : undefined;
  };
  const mapLink = (name: string) => (maps.has(name) && host.mapStore.notePath && isFile(host.mapStore.notePath(name)) ? mapNoteLink(name) : undefined);
  const generatorLink = (name: string) => {
    const path = `${generators}/${name}.md`;
    if (isFile(path)) return pathLink(path);
    const hit = vault.getMarkdownFiles().find((f) => f.basename === name && under(f.path, generators) && !under(f.path, saves));
    return hit ? pathLink(hit.path) : undefined;
  };
  const fm = (text: string) => /^---\r?\n/.test(text);
  return {
    mayHave: (path) => mapNotes.has(path) || under(path, palettes) || under(path, generators) || modules.some((m) => under(path, m.folder)),
    rewrite(path, text) {
      if (!fm(text)) return text;
      if (mapNotes.has(path)) {
        let next = linkFrontmatterKey(text, "palette", paletteLink).content;
        next = linkFrontmatterKey(next, "region-palette", paletteLink).content;
        return next;
      }
      for (const m of modules) {
        if (!under(path, m.folder)) continue;
        const next = m.linker.rewrite(text, { paletteNote: (n) => (paletteLink(n) ? host.paletteStore?.notePathOf(n) : undefined) });
        if (next !== undefined) return next;
      }
      if (under(path, saves) && /^hexmaker-save\s*:/m.test(text)) {
        return linkFrontmatterKey(text, "generator-path", (v) => {
          const p = /\.md$/i.test(v) ? v : `${v}.md`;
          return isFile(p) ? pathLink(p) : undefined;
        }).content;
      }
      if (under(path, generators) && /^hex-wfc\s*:/m.test(text)) {
        let next = linkFrontmatterKey(text, "palette", paletteLink).content;
        next = linkFrontmatterKey(next, "source-map", mapLink).content;
        next = linkFrontmatterList(next, "source-maps", mapLink).content;
        next = linkFrontmatterList(next, "blend-of", generatorLink).content;
        return next;
      }
      if (under(path, palettes)) return linkFrontmatterKey(text, "child-palette", paletteLink).content;
      return text;
    },
  };
}

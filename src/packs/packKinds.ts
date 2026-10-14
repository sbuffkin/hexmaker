/**
 * The kinds of content a pack carries (random tables, towns, palettes…):
 * each is a vault folder in this vault and a folder of the same id in the
 * pack. Exporting files a note under the kind whose folder holds it;
 * importing puts it in this vault's folder for that kind, whatever it is
 * called here.
 *
 * Kinds are data: the core lists its own (CORE_KINDS), map-type modules
 * add theirs (ModuleRuntime.packKinds), and a later "generator module"
 * format can read the same folders.
 *
 * Pure: no Obsidian imports.
 */

import { contentFolder, type ContentFolderKey } from "../notePickers";
import { templatesFolderFor } from "../noteTemplates";
import { hasLegacyRollerLink, withRollerBlock } from "../random-tables/randomTable";

export interface PackKind {
  /** Stable id, also the pack's folder for it ("tables"). */
  id: string;
  /** Its name for people ("Random tables"). */
  label: string;
  /** Its folder in this vault. */
  folder: string;
  /** Fix a note of this kind for its new place on import (tables: the roller block). */
  fixText?(text: string): string;
}

/** The settings the core kinds read. */
export type PackFolderSettings = Partial<Record<ContentFolderKey, string>> & {
  worldFolder?: string;
  templatesFolder?: string;
};

/**
 * An old "Open in roller" link (obsidian://duckmage-roll?…) names the
 * table's path in the vault that made it: swap it for the path-less roller
 * block. Any other table note is left exactly as it is.
 */
export function fixTableNote(text: string): string {
  return hasLegacyRollerLink(text) ? withRollerBlock(text) : text;
}

const CONTENT: { id: string; label: string; key: ContentFolderKey; fixText?: (t: string) => string }[] = [
  { id: "tables", label: "Random tables", key: "tablesFolder", fixText: fixTableNote },
  { id: "workflows", label: "Workflows and their templates", key: "workflowsFolder" },
  { id: "towns", label: "Towns", key: "townsFolder" },
  { id: "dungeons", label: "Dungeons", key: "dungeonsFolder" },
  { id: "features", label: "Features", key: "featuresFolder" },
  { id: "quests", label: "Quests", key: "questsFolder" },
  { id: "factions", label: "Factions", key: "factionsFolder" },
  { id: "areas", label: "Areas", key: "regionsFolder" },
];

/**
 * The core's kinds for these settings, in the order the export form lists
 * them. `palettes` and `generators` are the palette and generator folders
 * (they live with their stores).
 */
export function coreKinds(s: PackFolderSettings, extra: { palettes: string; generators: string }): PackKind[] {
  const out: PackKind[] = CONTENT.map((c) => ({ id: c.id, label: c.label, folder: contentFolder(s, c.key), ...(c.fixText ? { fixText: c.fixText } : {}) }));
  out.splice(2, 0, { id: "templates", label: "Note templates", folder: templatesFolderFor(s) });
  out.push(
    { id: "palettes", label: "Palettes and path types", folder: extra.palettes },
    { id: "generators", label: "Generators", folder: extra.generators },
  );
  return out;
}

const trim = (p: string): string => p.trim().replace(/^\/+|\/+$/g, "");

/** The kind whose folder holds `path` (the deepest folder wins), if any. */
export function kindOf(path: string, kinds: readonly PackKind[]): PackKind | undefined {
  let best: PackKind | undefined;
  for (const k of kinds) {
    const f = trim(k.folder);
    if (!f || !path.startsWith(f + "/")) continue;
    if (!best || f.length > trim(best.folder).length) best = k;
  }
  return best;
}

/**
 * The notes a pack can offer, by kind id: markdown notes inside a kind's
 * folder (the deepest one), never `_` notes. Each list sorted.
 */
export function notesByKind(paths: readonly string[], kinds: readonly PackKind[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of paths) {
    if (!p.toLowerCase().endsWith(".md")) continue;
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (base.startsWith("_")) continue;
    const k = kindOf(p, kinds);
    if (!k) continue;
    const list = out.get(k.id) ?? [];
    list.push(p);
    out.set(k.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b));
  return out;
}

/** A vault note's path in the pack: `<kind id>/<path under the kind's folder>`. */
export function packPathOf(kind: PackKind, vaultPath: string): string {
  return `${kind.id}/${vaultPath.slice(trim(kind.folder).length + 1)}`;
}

/** A pack path that's safe to write: relative, no `..`, no empty or hidden parts. */
export function isSafePackPath(p: string): boolean {
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\\")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

/** Where a pack note goes in this vault, or null when it isn't under a known kind. */
export function vaultPathOf(packPath: string, kinds: readonly PackKind[]): { kind: PackKind; path: string } | null {
  const slash = packPath.indexOf("/");
  if (slash <= 0) return null;
  const kind = kinds.find((k) => k.id === packPath.slice(0, slash));
  if (!kind) return null;
  const folder = trim(kind.folder);
  const rest = packPath.slice(slash + 1);
  return { kind, path: folder ? `${folder}/${rest}` : rest };
}

/** "dir/Name.md" → "dir/Name 2.md" (then 3, 4…), the first `taken` says is free. */
export function keepBothPath(path: string, taken: (p: string) => boolean): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const next = `${stem} ${n}${ext}`;
    if (!taken(next)) return next;
  }
}

/**
 * Links written with a folder path (`[[world/tables/Weather]]`,
 * `[x](world/tables/Weather.md)`) pointed into the old vault's folder:
 * point them at this vault's. Links by name only need nothing.
 */
export function rewriteFolderLinks(text: string, from: string, to: string): string {
  const f = trim(from), t = trim(to);
  if (!f || !t || f === t) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // One pass over every form, so a new folder inside the old one isn't rewritten twice.
  const enc = (s: string) => s.replace(/ /g, "%20");
  const forms = [`\\[\\[${esc(f)}/`, `\\]\\(<?${esc(f)}/`];
  if (f.includes(" ")) forms.push(`\\]\\(<?${esc(enc(f))}/`);
  return text.replace(new RegExp(forms.join("|"), "g"), (m) =>
    m.startsWith("[[") ? `[[${t}/` : m.includes("%20") ? m.replace(enc(f), enc(t)) : m.replace(f, t));
}

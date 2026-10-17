/**
 * Palettes in a content pack whose name this vault already has (owner K2,
 * 2026-10-16): "check if it's literally the same palette as one already
 * imported first, don't duplicate, but if it's got adjustments/additions
 * etc make it '2'."
 *
 * - The same palette (terrains, colours, icons, path types, compared
 *   without regard to row order, colour case or table formatting): not
 *   imported, shown as "already have".
 * - A different one: imported as "Name 2" (then 3…), and the pack's other
 *   notes that name it (a generator's `palette:`, a palette's
 *   `child-palette:`, a `[[palettes/Name]]` link) are pointed at the new
 *   name.
 *
 * A palette's name is its note's basename, so renaming it is writing the
 * note under the new name. Pure: no Obsidian imports.
 */

import { parsePaletteNote, readChildPalette, readPaletteKind, readSubmapDefaults, submapDefaultsKey } from "../palettes/paletteNote";
import { parsePathTypes } from "../palettes/pathTypeTable";
import { refBasename } from "../noteFormats";
import { escapeRegex } from "../textUtils";

/** A palette this vault has: its note's path and text. */
export interface VaultPalette {
  path: string;
  text: string;
}

/** Finds the vault's palette of a name (any case), or null. */
export type FindPalette = (name: string) => Promise<VaultPalette | null>;

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const byName = <T extends { name: string }>(a: T, b: T) => lower(a.name).localeCompare(lower(b.name));

/**
 * What a palette note holds, as a string that's the same for two notes
 * that only differ in row order, colour case or formatting. Null when the
 * note isn't a palette.
 */
export function paletteKey(text: string): string | null {
  const terrains = parsePaletteNote(text);
  if (!terrains) return null;
  const t = [...terrains].sort(byName).map((x) => [
    x.name.trim(), lower(x.color), lower(x.unreadColor), x.icon?.trim() ?? "", lower(x.iconColor),
    x.category?.trim() ?? "", x.type ?? "", x.impassable ?? null,
  ]);
  const paths = [...(parsePathTypes(text)?.types ?? [])].sort(byName).map((p) => [
    p.name.trim(), lower(p.color), lower(p.unreadColor), p.width, p.lineStyle, p.routing,
    p.avoidImpassable ?? null, p.autoRoute ?? null, p.carves?.trim() || null, p.carveWidth === 1 ? 1 : 0,
  ]);
  return JSON.stringify({
    t, paths,
    child: lower(readChildPalette(text)),
    kind: readPaletteKind(text) ?? "",
    submaps: submapDefaultsKey(readSubmapDefaults(text)),
  });
}

/** "dir/Name.md" → "Name". */
export function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/**
 * `text` with its references to renamed palettes (`renames`: old name →
 * new, keys lower-case) pointed at the new names: the frontmatter
 * `palette:` / `child-palette:` values (plain or links), and wikilinks
 * into `folder` (this vault's palettes folder).
 */
export function renamePaletteRefs(text: string, renames: ReadonlyMap<string, string>, folder: string): string {
  if (!renames.size) return text;
  let out = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
  if (fm) {
    const body = fm[1].replace(/^((?:child-)?palette:[ \t]*)([^\r\n]*)$/gm, (line, key: string, raw: string) => {
      const q = /^(["'])(.*)\1\s*$/.exec(raw.trim());
      const value = q ? q[2] : raw.trim();
      const to = renames.get(lower(refBasename(value)));
      if (!to) return line;
      const next = value.startsWith("[[")
        ? value.replace(/^\[\[([^\]|#]*?)([^\]|#/]+?)(\.md)?(?=[\]|#])/, (_m, dir: string) => `[[${dir}${to}`)
        : to;
      return `${key}${q ? `${q[1]}${next}${q[1]}` : next}`;
    });
    out = out.slice(0, fm.index) + fm[0].replace(fm[1], () => body) + out.slice(fm.index + fm[0].length);
  }
  const dir = folder.trim().replace(/^\/+|\/+$/g, "");
  if (dir) {
    out = out.replace(new RegExp(`\\[\\[${escapeRegex(dir)}/([^\\]|#/]+?)(\\.md)?(?=[\\]|#])`, "g"), (m, name: string) => {
      const to = renames.get(lower(name));
      return to ? `[[${dir}/${to}` : m;
    });
  }
  return out;
}

/** What happens to one of the pack's palettes. */
export type PalettePlan =
  | { kind: "new" }
  | { kind: "same"; existing: string; from?: string; to?: string }
  | { kind: "renamed"; from: string; to: string; target: string };

/**
 * Decide each pack palette (`targets`: where each would go, in pack
 * order; `texts`: their notes): new, the same as the vault's palette of
 * that name, or a different one renamed to the first free "Name N" (free
 * of the vault's palettes, notes, and the pack's other palettes). A "Name N"
 * that already holds this same palette (the pack imported before) is
 * "same", with `from`/`to` so the pack's notes point at that copy.
 */
export async function planPalettes(
  palettes: readonly { target: string; text: string }[],
  find: FindPalette,
  noteExists: (path: string) => Promise<boolean>,
): Promise<PalettePlan[]> {
  const packNames = new Set(palettes.map((p) => lower(noteName(p.target))));
  const claimed = new Set<string>();
  const out: PalettePlan[] = [];
  for (const p of palettes) {
    const name = noteName(p.target);
    const mine = await find(name);
    if (!mine) {
      claimed.add(lower(name));
      out.push({ kind: "new" });
      continue;
    }
    const incoming = paletteKey(p.text);
    if (incoming !== null && incoming === paletteKey(mine.text)) {
      out.push({ kind: "same", existing: mine.path });
      continue;
    }
    const dir = p.target.slice(0, p.target.length - noteName(p.target).length - (p.target.toLowerCase().endsWith(".md") ? 3 : 0));
    for (let n = 2; ; n++) {
      const to = `${name} ${n}`;
      const target = `${dir}${to}.md`;
      if (packNames.has(lower(to)) || claimed.has(lower(to))) continue;
      const earlier = await find(to);
      if (earlier && incoming !== null && incoming === paletteKey(earlier.text)) {
        claimed.add(lower(to));
        out.push({ kind: "same", existing: earlier.path, from: name, to });
        break;
      }
      if (earlier || (await noteExists(target))) continue;
      claimed.add(lower(to));
      out.push({ kind: "renamed", from: name, to, target });
      break;
    }
  }
  return out;
}

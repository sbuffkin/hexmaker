import { TFile, type App } from "obsidian";

/**
 * Hex names (N1) live in the map note's Hexes table. A hex that has a note
 * also gets its name as one of the note's Obsidian `aliases` (X4), so the
 * quick switcher, search and [[links]] find "Glass Wastes" while the file
 * stays `x_y.md`.
 *
 * The plugin manages exactly one alias per note: the hex's current name.
 * On rename it swaps the old name for the new one and leaves every other
 * alias (the user's own) alone. The old name comes from the map note
 * (the name before the change), so nothing extra is stored in the note.
 */

/** Tidy a typed name: one line, trimmed, no table pipes. "" = no name. */
export function cleanHexName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The `aliases` list after a hex is renamed from `oldName` to `newName`
 * (either may be empty = no name), or null when nothing changes.
 * `current` is whatever the frontmatter holds (list, single string, or
 * nothing). Only `oldName` is removed; other aliases keep their order.
 */
export function nextAliases(
  current: unknown,
  oldName: string | null | undefined,
  newName: string | null | undefined,
): string[] | null {
  const list = Array.isArray(current)
    ? current.filter((a): a is string => typeof a === "string")
    : typeof current === "string" && current.trim()
      ? [current]
      : [];
  const oldN = cleanHexName(oldName);
  const newN = cleanHexName(newName);
  let out = list;
  if (oldN && oldN !== newN) out = out.filter((a) => a !== oldN);
  if (newN && !out.includes(newN)) out = [...out, newN];
  const same = out.length === list.length && out.every((a, i) => a === list[i]);
  // A single-string `aliases` is rewritten as a list only if it changed.
  return same ? null : out;
}

/** Apply a rename to one note's `aliases`. No-op when nothing changes. */
export async function syncHexNameAlias(
  app: App,
  path: string,
  oldName: string | null | undefined,
  newName: string | null | undefined,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  // Skip the write when the indexed frontmatter already agrees.
  const cache = app.metadataCache.getFileCache(file);
  if (cache && nextAliases(cache.frontmatter?.aliases, oldName, newName) === null) return;
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const next = nextAliases(fm.aliases, oldName, newName);
    if (next === null) return;
    if (next.length) fm.aliases = next;
    else delete fm.aliases;
  });
}

/** Names that changed between two versions of a map's hexes (hand edits of the map note). */
export function renamedHexes(
  before: ReadonlyMap<string, { name?: string }>,
  after: ReadonlyMap<string, { name?: string }>,
): { key: string; oldName?: string; newName?: string }[] {
  const out: { key: string; oldName?: string; newName?: string }[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const oldName = before.get(key)?.name;
    const newName = after.get(key)?.name;
    if ((oldName ?? "") !== (newName ?? "")) out.push({ key, oldName, newName });
  }
  return out;
}

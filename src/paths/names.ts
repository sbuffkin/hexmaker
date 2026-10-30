/**
 * Path names: unique within a map, compared ignoring case and spacing
 * (a Path routes row matches its Paths row the same way). Names are labels
 * only; nothing behaves differently because of what a path is called.
 */

/** The comparison key of a path name: trimmed, lower case, runs of spaces collapsed. */
export function pathNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The first free name among `base`, `base 2`, `base 3`… (the smallest unused
 * number), against `taken` (any names; compared with pathNameKey).
 * An empty base becomes "Path".
 */
export function uniquePathName(base: string, taken: Iterable<string>): string {
  const stem = base.trim().replace(/\s+/g, " ") || "Path";
  const used = new Set<string>();
  for (const n of taken) used.add(pathNameKey(n));
  if (!used.has(pathNameKey(stem))) return stem;
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}`;
    if (!used.has(pathNameKey(candidate))) return candidate;
  }
}

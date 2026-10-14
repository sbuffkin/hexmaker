/**
 * Splitting a markdown table row into cells, shared by the note parsers
 * (map notes, biome notes and pools, palette notes, path types, world
 * types). Only the split is shared: each parser keeps its own separator
 * row pattern and cell escaper, since those differ on purpose (map notes
 * accept `=` separators and fold newlines, for one).
 */

/** Options for splitRow. */
export interface SplitRowOptions {
  /** A `|` inside a `[[link|alias]]` belongs to the link (biome pools, world types). */
  wikiLinks?: boolean;
}

/**
 * A table row's cells, trimmed: the outer pipes dropped, `\|` read as a
 * literal `|`. A row without outer pipes splits the same way.
 */
export function splitRow(line: string, opts: SplitRowOptions = {}): string[] {
  const links = !!opts.wikiLinks;
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (links) {
      if (s[i] === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
      if (s[i] === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
    }
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|" && !depth) { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** splitRow keeping `[[link|alias]]` whole. */
export function splitLinkRow(line: string): string[] {
  return splitRow(line, { wikiLinks: true });
}

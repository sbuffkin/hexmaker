/**
 * Markdown table rows, shared by the note parsers (map notes, biome notes
 * and pools, palette notes, path types, world types, workflows): the one
 * cell splitter and the usual separator row. Map notes and hex flowers keep
 * their own separator pattern on purpose (map notes accept `=` rows, hex
 * flowers want two dashes), and each parser keeps its own cell escaper.
 */

/** A `| --- | :-: |` separator row (outer pipes optional, one dash is enough). */
export const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

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

/**
 * A row that starts with a pipe, split like splitLinkRow (`[[link|alias]]`
 * kept whole); null for any other line, and no cells for a lone `|`. What
 * workflow steps tables read (it was textUtils.splitTableRow, which split
 * the same way but for a `|` closing an unfinished `[[link`: it's the
 * row's end now, as in every other table).
 */
export function splitPipedRow(line: string): string[] | null {
  const s = line.trim();
  if (!s.startsWith("|")) return null;
  return s === "|" ? [] : splitLinkRow(s);
}

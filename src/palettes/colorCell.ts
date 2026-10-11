// Colour cells in palette notes.
//
// Obsidian reads `#14223d` (a `#` followed by a letter) in a note's body as
// a tag: a tag pill in reading view and an entry in the vault's tag list. So
// colours are written as inline code, `` `#14223d` ``, which is never a tag
// and still reads as the colour in the raw note.
//
// Reading is forgiving: `` `#14223d` ``, `#14223d`, `14223d` (a bare 3- or
// 6-digit hex gets its `#`), `` ` #14223D ` `` all read as `#14223d`. Hex is
// lower-cased; any other CSS colour (`rgb(…)`, `violet`) is kept as typed.

const HASH_HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BARE_HEX = /^([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The colour a cell holds ("" for an empty cell). */
export function parseColorCell(raw: string | undefined): string {
  const v = (raw ?? "").trim().replace(/^`+/, "").replace(/`+$/, "").trim();
  if (HASH_HEX.test(v)) return v.toLowerCase();
  if (BARE_HEX.test(v)) return `#${v.toLowerCase()}`;
  return v;
}

/** A colour as written into a note: inline code, or "" when there's none. */
export function colorCell(color: string | undefined): string {
  const v = parseColorCell(color);
  return v ? `\`${v}\`` : "";
}

/** Whether a cell's text isn't what the plugin would write for it (an empty cell is fine). */
export function colorCellStale(raw: string | undefined): boolean {
  const v = (raw ?? "").trim();
  return v !== "" && v !== colorCell(v);
}

/** [start, end) of each cell's text (between pipes) in a table row, honouring `\|`. */
function cellSpans(line: string): [number, number][] {
  let start = 0;
  let end = line.length;
  while (start < end && /\s/.test(line[start])) start++;
  while (end > start && /\s/.test(line[end - 1])) end--;
  if (line[start] === "|") start++;
  if (end > start && line[end - 1] === "|" && line[end - 2] !== "\\") end--;
  const spans: [number, number][] = [];
  let from = start;
  for (let i = start; i < end; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") { i++; continue; }
    if (line[i] === "|") { spans.push([from, i]); from = i + 1; }
  }
  spans.push([from, end]);
  return spans;
}

/**
 * Rewrite just the colour cells of table rows `rows` (indices into `lines`,
 * which may keep a trailing `\r`) at the cell positions `columns`, leaving
 * every other character of the line as it was. Returns true if any changed.
 */
export function wrapColorCellsInRows(lines: string[], rows: Iterable<number>, columns: number[]): boolean {
  let changed = false;
  for (const i of rows) {
    const line = lines[i];
    const spans = cellSpans(line);
    // Right to left, so earlier offsets stay valid.
    for (const col of [...columns].sort((a, b) => b - a)) {
      const span = spans[col];
      if (!span) continue;
      let [a, b] = span;
      while (a < b && /\s/.test(line[a])) a++;
      while (b > a && /\s/.test(line[b - 1])) b--;
      const raw = lines[i].slice(a, b);
      if (!colorCellStale(raw)) continue;
      lines[i] = lines[i].slice(0, a) + colorCell(raw) + lines[i].slice(b);
      changed = true;
    }
  }
  return changed;
}

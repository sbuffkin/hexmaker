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
//
// A few slips have only one possible reading and are fixed (safeColorFix):
// quotes, a trailing `;`, `0x` or `##` in front of a hex, spaces inside a
// hex, a missing `)`, a colour name typed in words ("Dark Green"). Anything
// else that isn't a CSS colour is kept exactly as typed (so a rewrite never
// loses it) and reported (isCssColor), never guessed.

const HASH_HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BARE_HEX = /^([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i;
const ARG = /^(-?(\d+\.?\d*|\.\d+)(e-?\d+)?(%|deg|rad|grad|turn)?|none)$/i;

/** rgb(1 2 3), hsl(120, 50%, 50% / 0.5), color(display-p3 1 0 0): 3 or 4 numbers. */
function isColorFunction(s: string): boolean {
  const m = FUNCTION.exec(s);
  if (!m) return false;
  let args = m[2].trim();
  if (m[1].toLowerCase() === "color") args = args.replace(/^[a-z][\w-]*\s+/i, "");
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 3 && parts.length <= 4 && parts.every((p) => ARG.test(p));
}

/** CSS named colours (CSS Color 4), plus transparent and currentcolor. */
const NAMED = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen transparent currentcolor").split(" "),
);

/** Whether `v` (as parseColorCell returns it) is a colour CSS can draw. */
export function isCssColor(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (HASH_HEX.test(s) || isColorFunction(s) || NAMED.has(s.toLowerCase())) return true;
  // Anything else CSS can draw (color-mix(), system colours…) counts too,
  // where the browser can tell (always in Obsidian).
  const win = typeof activeWindow === "undefined" ? undefined : (activeWindow as unknown as { CSS?: { supports?: (property: string, value: string) => boolean } });
  const css = win?.CSS;
  return !!css?.supports && css.supports("color", s);
}

/**
 * The one colour a slip can only mean, or null when there's no single safe
 * reading. Only called on text that isn't a colour as it stands.
 */
export function safeColorFix(v: string): string | null {
  let s = v.trim().replace(/^(["'])(.*)\1$/, "$2").trim().replace(/[;,.]+$/, "").trim();
  if (isCssColor(s)) return HASH_HEX.test(s) ? s.toLowerCase() : s;
  if (BARE_HEX.test(s)) return `#${s.toLowerCase()}`;
  // 0x29507f, ##29507f, # 29 50 7f
  const hex = s.replace(/^(0x|#+)/i, "").replace(/\s+/g, "");
  if (/^(0x|#)/i.test(s) && BARE_HEX.test(hex)) return `#${hex.toLowerCase()}`;
  // rgb(1, 2, 3 (the closing bracket missing)
  if (/^[a-z]+\([^()]*$/i.test(s) && isColorFunction(`${s})`)) return `${s})`;
  // "Dark Green", "dark-green"
  const name = s.toLowerCase().replace(/[\s_-]+/g, "");
  if (name !== s.toLowerCase() && NAMED.has(name)) return name;
  return null;
}

/** The colour a cell holds ("" for an empty cell). */
export function parseColorCell(raw: string | undefined): string {
  const v = (raw ?? "").trim().replace(/^`+/, "").replace(/`+$/, "").trim();
  if (HASH_HEX.test(v)) return v.toLowerCase();
  if (BARE_HEX.test(v)) return `#${v.toLowerCase()}`;
  if (!v || isCssColor(v)) return v;
  return safeColorFix(v) ?? v;
}

/** The grey a colour that can't be read is drawn with. */
export const UNREAD_GREY = "#888888";

/**
 * A cell's colour as the note reader keeps it: `color` to draw with (grey
 * when the text can't be read, or the cell is empty) and, when it can't be
 * read, the text as typed (`unreadColor`).
 */
export function readColor(raw: string | undefined): { color: string; unreadColor?: string } {
  const v = parseColorCell(raw);
  if (!v) return { color: UNREAD_GREY };
  return isCssColor(v) ? { color: v } : { color: UNREAD_GREY, unreadColor: v };
}

/** The colour to write for an entry: the text as typed while it still can't be read. */
export function writtenColor(t: { color: string; unreadColor?: string }): string {
  return t.unreadColor && t.color === UNREAD_GREY ? t.unreadColor : t.color;
}

/** Whether a cell holds text that isn't a colour (and has no safe reading). An empty cell is fine. */
export function colorUnreadable(raw: string | undefined): boolean {
  const v = parseColorCell(raw);
  return v !== "" && !isCssColor(v);
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

/**
 * Loose YAML for map-note frontmatter (split out of mapNote.ts).
 *
 * Frontmatter is read with a forgiving YAML subset instead of a strict
 * parser: one typo must not make the whole map unreadable, and scalar
 * typing stays ours (strict YAML 1.1 would read the hex `3_4` as 34).
 */

export type YNode =
  | { t: "s"; v: string; q: boolean }
  | { t: "l"; v: YNode[] }
  | { t: "m"; v: Map<string, YNode> };

export interface YBlock {
  /** Top-level key, or null for comments. */
  key: string | null;
  lines: string[];
}

const indentOf = (l: string) => /^[ \t]*/.exec(l)![0].replace(/\t/g, "  ").length;
const isBlankOrComment = (l: string) => !l.trim() || /^\s*#/.test(l);
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isLineBreak = (c: string) => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";

/**
 * A `key: value` line: the key as written (quotes kept) and the value with
 * the spaces around it trimmed (undefined when nothing follows the colon),
 * or null when the line isn't one. Keys are `"double"` or `'single'` quoted
 * (`''` is a quote inside) or plain (up to the first colon, not starting
 * with a space, `#`, `:` or a quote); the colon is followed by a space or
 * the line's end.
 *
 * Hand-written to run in linear time: the regex it replaces
 * (`/^\s*(…|[^\s#:"'][^:]*?)\s*:(?:\s+(.*?))?\s*$/`) backtracked over long
 * runs of spaces, about a minute for one 400k-character line. It matches
 * exactly what that regex matched (tests/yamlLooseKeyLine.test.ts).
 */
export function keyLine(line: string): { key: string; rest: string | undefined } | null {
  const n = line.length;
  let i = 0;
  while (i < n && isSpace(line[i])) i++;
  if (i === n) return null;
  // The value's last non-space character, and the last line break before it
  // (a value may not hold one), once for the whole line.
  let last = n - 1;
  while (last >= 0 && isSpace(line[last])) last--;
  let breakBeforeLast = -1;
  for (let k = last - 1; k >= 0; k--) if (isLineBreak(line[k])) { breakBeforeLast = k; break; }

  /** The rest of the line after a key ending at `end`: `\s*:` then a value or nothing. */
  const after = (end: number): { rest: string | undefined } | null => {
    let p = end;
    while (p < n && isSpace(line[p])) p++;
    if (line[p] !== ":") return null;
    p++;
    if (p === n) return { rest: undefined };
    if (!isSpace(line[p])) return null;
    let s = p;
    while (s < n && isSpace(line[s])) s++;
    if (s > last) return { rest: "" };
    if (breakBeforeLast > s) return null;
    return { rest: line.slice(s, last + 1) };
  };

  const c = line[i];
  if (c === '"') {
    for (let j = i + 1; j < n; j++) {
      if (line[j] === "\\") {
        if (j + 1 >= n || isLineBreak(line[j + 1])) return null;
        j++;
      } else if (line[j] === '"') {
        const r = after(j + 1);
        return r && { key: line.slice(i, j + 1), rest: r.rest };
      }
    }
    return null;
  }
  if (c === "'") {
    // Each quote may end the key; `''` may also be a quote inside it. The
    // longest key that is followed by a colon wins (as the regex's greedy loop).
    const ends: number[] = [];
    for (let j = i + 1; j < n; j++) {
      if (line[j] !== "'") continue;
      ends.push(j + 1);
      if (line[j + 1] === "'") j++;
      else break;
    }
    for (let k = ends.length - 1; k >= 0; k--) {
      const r = after(ends[k]);
      if (r) return { key: line.slice(i, ends[k]), rest: r.rest };
    }
    return null;
  }
  if (c === "#" || c === ":") return null;
  const colon = line.indexOf(":", i);
  if (colon < 0) return null;
  const r = after(colon);
  return r && { key: line.slice(i, colon).trimEnd(), rest: r.rest };
}

function unquoteKey(k: string): string {
  if (/^".*"$/.test(k)) { try { return JSON.parse(k) as string; } catch { return k.slice(1, -1); } }
  if (/^'.*'$/.test(k)) return k.slice(1, -1).replace(/''/g, "'");
  return k;
}

/** Split frontmatter text into top-level blocks (a key line plus its indented/list lines). */
export function yamlBlocks(src: string): YBlock[] {
  const out: YBlock[] = [];
  for (const line of src.split("\n")) {
    const top = !/^\s/.test(line) && line.trim() !== "";
    const kv = top && !line.startsWith("#") && !line.startsWith("-") ? keyLine(line) : null;
    if (kv) out.push({ key: unquoteKey(kv.key), lines: [line] });
    else if (out.length && (!top || line.startsWith("-"))) out[out.length - 1].lines.push(line);
    else out.push({ key: null, lines: [line] });
  }
  return out;
}

/** Split `a, "b, c", [d, e]` at top-level commas. */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') { cur += s[++i] ?? ""; continue; }
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") { quote = c; cur += c; }
    else if (c === "[" || c === "{") { depth++; cur += c; }
    else if (c === "]" || c === "}") { depth--; cur += c; }
    else if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the first `:` outside quotes/brackets (a flow-map key separator). */
function flowColon(s: string): number {
  let depth = 0, quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

function scalarNode(raw: string): YNode {
  let t = raw.trim();
  if (t.startsWith('"')) {
    try { return { t: "s", v: JSON.parse(t) as string, q: true }; } catch { /* below */ }
    const end = t.lastIndexOf('"');
    if (end > 0) { try { return { t: "s", v: JSON.parse(t.slice(0, end + 1)) as string, q: true }; } catch { /* below */ } }
    return { t: "s", v: t.replace(/^"|"$/g, ""), q: true };
  }
  if (t.startsWith("'")) return { t: "s", v: t.replace(/^'|'$/g, "").replace(/''/g, "'"), q: true };
  if (t.startsWith("[") && !t.startsWith("[[") && t.endsWith("]")) {
    return { t: "l", v: splitFlow(t.slice(1, -1)).map(scalarNode) };
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    const m = new Map<string, YNode>();
    for (const item of splitFlow(t.slice(1, -1))) {
      const c = flowColon(item);
      if (c < 0) continue;
      m.set(unquoteKey(item.slice(0, c).trim()), scalarNode(item.slice(c + 1)));
    }
    return { t: "m", v: m };
  }
  // "foo # comment" is YAML for "foo"; "Thornwood #2" keeps its "#2".
  return { t: "s", v: withoutComment(t), q: false };
}

/**
 * `t` without a trailing ` # comment` (spaces, `#`, a space, then the rest
 * of the line). What `t.replace(/\s+#\s.*$/, "")` did, in linear time: that
 * regex backtracked over long runs of spaces.
 */
export function withoutComment(t: string): string {
  let lastBreak = -1;
  for (let k = t.length - 1; k >= 0; k--) if (isLineBreak(t[k])) { lastBreak = k; break; }
  for (let q = 1; q + 1 < t.length; q++) {
    if (t[q] !== "#" || !isSpace(t[q - 1]) || !isSpace(t[q + 1]) || lastBreak >= q + 2) continue;
    let p = q - 1;
    while (p > 0 && isSpace(t[p - 1])) p--;
    return t.slice(0, p);
  }
  return t;
}

/** Parse a nested block (the lines under a `key:` with no inline value). */
function blockNode(lines: string[]): YNode | undefined {
  const body = lines.filter((l) => !isBlankOrComment(l));
  if (!body.length) return undefined;
  const ind = Math.min(...body.map(indentOf));
  const atInd = (l: string) => indentOf(l) === ind;
  if (body[0].trim().startsWith("-")) {
    const items: string[][] = [];
    for (const l of body) {
      if (atInd(l) && /^\s*-(\s|$)/.test(l)) items.push([l.replace(/^(\s*)-\s?/, "$1 ")]);
      else if (items.length) items[items.length - 1].push(l);
    }
    return {
      t: "l",
      v: items.map((it) => {
        const first = it[0].trim();
        if (keyLine(first) && !/^["'[{]/.test(first)) return blockNode(it) ?? { t: "s", v: "", q: false };
        return it.length > 1 ? scalarNode([first, ...it.slice(1).map((l) => l.trim())].join(" ")) : scalarNode(first);
      }),
    };
  }
  const m = new Map<string, YNode>();
  let key: string | null = null;
  let rest = "";
  let kids: string[] = [];
  const finish = () => {
    if (key === null) return;
    const node = valueNode(rest, kids);
    if (node) m.set(key, node);
  };
  for (const l of body) {
    const kv = atInd(l) ? keyLine(l) : null;
    if (kv) { finish(); key = unquoteKey(kv.key); rest = kv.rest ?? ""; kids = []; }
    else kids.push(l);
  }
  finish();
  return { t: "m", v: m };
}

/** The value of `key: rest` followed by `kids` (indented lines). */
function valueNode(rest: string, kids: string[]): YNode | undefined {
  const r = rest.trim();
  if (/^[|>][+-]?\d*$/.test(r)) {
    const text = kids.filter((l) => l.trim()).map((l) => l.trim());
    return { t: "s", v: text.join(r.startsWith("|") ? "\n" : " "), q: true };
  }
  if (r) {
    const more = kids.filter((l) => !isBlankOrComment(l)).map((l) => l.trim());
    return scalarNode(more.length ? [r, ...more].join(" ") : r);
  }
  return blockNode(kids);
}

export function parseYamlLoose(src: string): { blocks: YBlock[]; values: Map<string, YNode> } {
  const blocks = yamlBlocks(src);
  const values = new Map<string, YNode>();
  for (const b of blocks) {
    if (b.key === null) continue;
    const kv = keyLine(b.lines[0])!;
    const node = valueNode(kv.rest ?? "", b.lines.slice(1));
    values.set(b.key, node ?? { t: "s", v: "", q: false });
  }
  return { blocks, values };
}

/** A plain JS value from a node (YAML core typing for unquoted scalars). */
export function toJs(n: YNode): unknown {
  if (n.t === "l") return n.v.map(toJs);
  if (n.t === "m") return Object.fromEntries([...n.v].map(([k, v]) => [k, toJs(v)]));
  if (n.q) return n.v;
  const t = n.v.trim();
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (t === "" || t === "~" || /^null$/i.test(t)) return null;
  // (Not `\d+\.?\d*`: that form backtracks quadratically on a long run of digits.)
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

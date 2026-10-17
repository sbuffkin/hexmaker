// Frozen copy of src/maps/yamlLoose.ts before its key-line regex was made linear
// (security review #5). tests/yamlLooseKeyLine.test.ts checks the new parser reads
// everything exactly as this one did. Never edit.
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
const KEY_LINE = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:"'][^:]*?)\s*:(?:\s+(.*?))?\s*$/;

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
    const kv = top && !line.startsWith("#") && !line.startsWith("-") ? KEY_LINE.exec(line) : null;
    if (kv) out.push({ key: unquoteKey(kv[1]), lines: [line] });
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
  t = t.replace(/\s+#\s.*$/, "");
  return { t: "s", v: t, q: false };
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
        if (KEY_LINE.test(first) && !/^["'[{]/.test(first)) return blockNode(it) ?? { t: "s", v: "", q: false };
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
    const kv = atInd(l) ? KEY_LINE.exec(l) : null;
    if (kv) { finish(); key = unquoteKey(kv[1]); rest = kv[2] ?? ""; kids = []; }
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
    const kv = KEY_LINE.exec(b.lines[0])!;
    const node = valueNode(kv[2] ?? "", b.lines.slice(1));
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
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

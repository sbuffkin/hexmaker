/**
 * Field formulas (plan-custom-hex-fields, owner round 2 "Chaining"):
 * simple arithmetic over the same hex's other fields, written as people
 * write it:
 *
 *   Population / 20 + Land value
 *   round(Population * 0.1) + 2
 *   [Land value] * 2              (brackets around a name are allowed)
 *
 * - Numbers, + − * / (also × ÷), parentheses, unary minus.
 * - Field names in any case, spaces and all; the longest name that fits
 *   wins ("Land value" before "Land").
 * - Functions: min, max, round, floor, ceil, abs.
 * - Dice: `2d6`, `d20` (a roll, so a number cell in a table can say
 *   `3d6 * 100`).
 *
 * A blank or non-number field reads as 0 in a formula. A formula that
 * can't be read is reported (`error`) and gives no value. Never eval().
 *
 * Pure: no Obsidian imports.
 */

type Node =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "dice"; n: number; sides: number }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: Node; b: Node }
  | { k: "fn"; name: string; args: Node[] };

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "dice"; n: number; sides: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "(" }
  | { t: ")" }
  | { t: "," }
  | { t: "fn"; name: string };

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => Math.round(a[0] ?? 0),
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
};

export interface Formula {
  /** The field names it reads, in its spelling of the declarations (each once). */
  refs: string[];
  /** Why it can't be read (then `run` gives undefined). */
  error?: string;
  /** Its value, reading fields with `get` (a missing one is 0); dice roll with `rand`. */
  run(get: (field: string) => number | undefined, rand?: () => number): number | undefined;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

function tokenize(src: string, names: readonly string[]): Token[] | string {
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === ",") { out.push({ t: "," }); i++; continue; }
    if ("+-−".includes(c)) { out.push({ t: "op", v: c === "+" ? "+" : "-" }); i++; continue; }
    if ("*×·".includes(c)) { out.push({ t: "op", v: "*" }); i++; continue; }
    if ("/÷".includes(c)) { out.push({ t: "op", v: "/" }); i++; continue; }
    if (c === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) return "a [ without its ]";
      const inner = src.slice(i + 1, end).trim().toLowerCase();
      const hit = names.find((n) => n.toLowerCase() === inner);
      if (!hit) return `no field called "${src.slice(i + 1, end).trim()}"`;
      out.push({ t: "ref", name: hit });
      i = end + 1;
      continue;
    }
    const dice = /^(\d*)d(\d+)/i.exec(src.slice(i));
    if (dice && !isWordChar(src[i + dice[0].length]) && !isWordChar(src[i - 1])) {
      out.push({ t: "dice", n: dice[1] ? Number(dice[1]) : 1, sides: Number(dice[2]) });
      i += dice[0].length;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(%?)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[1]) / (num[2] ? 100 : 1) });
      i += num[0].length;
      continue;
    }
    const rest = src.slice(i).toLowerCase();
    const name = byLength.find((n) => rest.startsWith(n.toLowerCase()) && !isWordChar(src[i + n.length]));
    if (name) { out.push({ t: "ref", name }); i += name.length; continue; }
    const word = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (word && FUNCTIONS[word[0].toLowerCase()] && src.slice(i + word[0].length).trimStart().startsWith("(")) {
      out.push({ t: "fn", name: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    return word ? `"${word[0]}" isn't a field or a function` : `can't read "${c}"`;
  }
  return out;
}

/** Recursive descent: expr = term (+|- term)*; term = unary (*|/ unary)*; unary = -unary | atom. */
function parse(tokens: Token[]): Node | string {
  let p = 0;
  const peek = () => tokens[p];
  const expr = (): Node | string => {
    let a = term();
    while (typeof a !== "string" && peek()?.t === "op" && ["+", "-"].includes((peek() as { v: string }).v)) {
      const op = (tokens[p++] as { v: "+" | "-" }).v;
      const b = term();
      if (typeof b === "string") return b;
      a = { k: "bin", op, a, b };
    }
    return a;
  };
  const term = (): Node | string => {
    let a = unary();
    while (typeof a !== "string" && peek()?.t === "op" && ["*", "/"].includes((peek() as { v: string }).v)) {
      const op = (tokens[p++] as { v: "*" | "/" }).v;
      const b = unary();
      if (typeof b === "string") return b;
      a = { k: "bin", op, a, b };
    }
    return a;
  };
  const unary = (): Node | string => {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      const a = unary();
      if (typeof a === "string") return a;
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return atom();
  };
  const atom = (): Node | string => {
    const t = tokens[p++];
    if (!t) return "it ends too soon";
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "ref") return { k: "ref", name: t.name };
    if (t.t === "dice") return { k: "dice", n: t.n, sides: t.sides };
    if (t.t === "(") {
      const e = expr();
      if (typeof e === "string") return e;
      if (tokens[p++]?.t !== ")") return "a ( without its )";
      return e;
    }
    if (t.t === "fn") {
      if (tokens[p++]?.t !== "(") return `${t.name} needs (…)`;
      const args: Node[] = [];
      if (peek()?.t !== ")") {
        for (;;) {
          const e = expr();
          if (typeof e === "string") return e;
          args.push(e);
          if (peek()?.t === ",") { p++; continue; }
          break;
        }
      }
      if (tokens[p++]?.t !== ")") return `${t.name}( without its )`;
      if (!args.length) return `${t.name}() needs a value`;
      return { k: "fn", name: t.name, args };
    }
    return "a sign where a value should be";
  };
  const root = expr();
  if (typeof root === "string") return root;
  if (p < tokens.length) return "something after the end";
  return root;
}

function refsOf(n: Node, out: Set<string>): void {
  if (n.k === "ref") out.add(n.name);
  else if (n.k === "neg") refsOf(n.a, out);
  else if (n.k === "bin") { refsOf(n.a, out); refsOf(n.b, out); }
  else if (n.k === "fn") for (const a of n.args) refsOf(a, out);
}

function evaluate(n: Node, get: (field: string) => number | undefined, rand: () => number): number {
  switch (n.k) {
    case "num": return n.v;
    case "ref": return get(n.name) ?? 0;
    case "dice": {
      let s = 0;
      for (let i = 0; i < Math.min(n.n, 1000); i++) s += 1 + Math.floor(rand() * n.sides);
      return s;
    }
    case "neg": return -evaluate(n.a, get, rand);
    case "fn": return FUNCTIONS[n.name](n.args.map((a) => evaluate(a, get, rand)));
    case "bin": {
      const a = evaluate(n.a, get, rand), b = evaluate(n.b, get, rand);
      if (n.op === "+") return a + b;
      if (n.op === "-") return a - b;
      if (n.op === "*") return a * b;
      return b === 0 ? NaN : a / b;
    }
  }
}

/** Read a formula once; `names` are the fields it may name. */
export function compileFormula(text: string, names: readonly string[]): Formula {
  const src = text.trim().replace(/^=\s*/, "");
  if (!src) return { refs: [], error: "it's empty", run: () => undefined };
  const tokens = tokenize(src, names);
  const tree = typeof tokens === "string" ? tokens : parse(tokens);
  if (typeof tree === "string") return { refs: [], error: tree, run: () => undefined };
  const refs = new Set<string>();
  refsOf(tree, refs);
  return {
    refs: [...refs],
    run: (get, rand = Math.random) => {
      const v = evaluate(tree, get, rand);
      return Number.isFinite(v) ? v : undefined;
    },
  };
}

/** A cell that's a plain number or a dice sum ("400", "3d6 * 100"), as a number; undefined otherwise. */
export function rollNumberText(text: string, rand: () => number = Math.random): number | undefined {
  const f = compileFormula(text, []);
  return f.error ? undefined : f.run(() => undefined, rand);
}

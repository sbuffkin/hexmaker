/**
 * Write a re-made generator into its existing note without rewriting the
 * note (owner, 2026-10-12: "relearn rewrote whole notes before"): only the
 * frontmatter keys and the generator's own tables (Terrains, Adjacency,
 * Features, Paths, Layout) change. Headings, help text and anything the
 * user wrote stay where they are; other tables (such as Blend of) too.
 *
 * Also the readable "Blend of" table, which records each map folded into a
 * generator or a biome note ("Blend into <biome>"):
 *
 *   ## Blend of
 *
 *   | Map | Weight | Date |
 *   | --- | ---: | --- |
 *   | [[_the-coast]] | 25% | 2026-10-12 |
 *
 * Pure: no Obsidian imports.
 */

const GENERATOR_SECTIONS = ["terrains", "adjacency", "features", "paths", "layout"];

const isTableLine = (l: string) => l.trim().startsWith("|");
const heading = (l: string) => /^#{1,6}\s+(.*)$/.exec(l.trim())?.[1].trim().toLowerCase();

interface FmEntry {
  key?: string;
  lines: string[];
}

/** Frontmatter lines grouped by key (a block list's `  - item` lines go with their key). */
function frontmatter(lines: string[]): { entries: FmEntry[]; end: number } | null {
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const entries: FmEntry[] = [];
  for (let i = 1; i < end; i++) {
    const m = /^([^:#\s][^:]*):/.exec(lines[i]);
    if (m) entries.push({ key: m[1].trim(), lines: [lines[i]] });
    else if (/^\s+-(\s|$)/.test(lines[i]) && entries.length && entries[entries.length - 1].key) entries[entries.length - 1].lines.push(lines[i]);
    else entries.push({ lines: [lines[i]] });
  }
  return { entries, end };
}

/** Where each section's table is: heading line index, table start and end (exclusive). */
function sectionTables(lines: string[], from: number): Map<string, { head: number; start: number; end: number }> {
  const out = new Map<string, { head: number; start: number; end: number }>();
  for (let i = from; i < lines.length; i++) {
    const h = heading(lines[i]);
    if (h === undefined || !GENERATOR_SECTIONS.includes(h) || out.has(h)) continue;
    let s = i + 1;
    while (s < lines.length && !isTableLine(lines[s]) && heading(lines[s]) === undefined) s++;
    if (s >= lines.length || !isTableLine(lines[s])) { out.set(h, { head: i, start: i + 1, end: i + 1 }); continue; }
    let e = s;
    while (e < lines.length && isTableLine(lines[e])) e++;
    out.set(h, { head: i, start: s, end: e });
  }
  return out;
}

/**
 * `old` with `fresh`'s frontmatter values and generator tables written in.
 * Keys only in `old` are dropped (the model carries every key it read), keys
 * only in `fresh` are added; a section `fresh` doesn't have any more loses
 * its table (and its heading when nothing else is under it). Line endings
 * are kept; the same string when nothing changed.
 */
export function updateGeneratorNote(old: string, fresh: string): string {
  const eol = old.includes("\r\n") ? "\r\n" : "\n";
  const a = old.replace(/\r\n?/g, "\n").split("\n");
  const b = fresh.replace(/\r\n?/g, "\n").split("\n");
  const fa = frontmatter(a), fb = frontmatter(b);
  if (!fa || !fb) return fresh;
  const want = new Map(fb.entries.filter((e) => e.key).map((e) => [e.key!, e.lines]));
  const fm: string[] = [];
  const seen = new Set<string>();
  for (const e of fa.entries) {
    if (!e.key) { fm.push(...e.lines); continue; }
    const next = want.get(e.key);
    if (!next || seen.has(e.key)) continue;
    seen.add(e.key);
    fm.push(...next);
  }
  for (const [k, lines] of want) if (!seen.has(k)) fm.push(...lines);

  let body = a.slice(fa.end + 1);
  const freshBody = b.slice(fb.end + 1);
  const freshTables = sectionTables(freshBody, 0);
  // Replace from the bottom up so earlier indices stay valid.
  const oldTables = [...sectionTables(body, 0)].sort((p, q) => q[1].head - p[1].head);
  for (const [name, at] of oldTables) {
    const f = freshTables.get(name);
    if (f && f.end > f.start) {
      body = [...body.slice(0, at.start), ...freshBody.slice(f.start, f.end), ...body.slice(at.end)];
    } else {
      // Gone from the model: drop its table, and its heading when nothing else is under it.
      let after = at.end;
      while (after < body.length && body[after].trim() === "") after++;
      const onlyTable = after >= body.length || heading(body[after]) !== undefined;
      const between = body.slice(at.head + 1, at.start).every((l) => l.trim() === "");
      body = onlyTable && between ? [...body.slice(0, at.head), ...body.slice(after)] : [...body.slice(0, at.start), ...body.slice(at.end)];
    }
  }
  const have = sectionTables(body, 0);
  for (const name of GENERATOR_SECTIONS) {
    const f = freshTables.get(name);
    if (have.has(name) || !f || f.end <= f.start) continue;
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    body.push("", freshBody[f.head], "", ...freshBody.slice(f.start, f.end), "");
  }
  const out = ["---", ...fm, "---", ...body].join(eol);
  return out === a.join(eol) ? old : out;
}

export interface BlendOfRow {
  /** The map, as written (a link or a name). */
  map: string;
  /** Its weight, 0–1. */
  weight: number;
  /** YYYY-MM-DD. */
  date: string;
}

const isBlendOfHeader = (l: string) => {
  const cells = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().toLowerCase());
  return cells.includes("map") && cells.includes("weight");
};

/** The note with a row added to its Blend of table (made under its own heading at the end when missing). */
export function addBlendOfRow(content: string, row: BlendOfRow): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const line = `| ${row.map.replace(/\|/g, "\\|")} | ${Math.round(row.weight * 1000) / 10}% | ${row.date} |`;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableLine(lines[i]) || !isBlendOfHeader(lines[i]) || !/^\s*\|?\s*:?-+/.test(lines[i + 1])) continue;
    let e = i + 2;
    while (e < lines.length && isTableLine(lines[e])) e++;
    lines.splice(e, 0, line);
    return lines.join(eol);
  }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("", "## Blend of", "", "| Map | Weight | Date |", "| --- | ---: | --- |", line, "");
  return lines.join(eol);
}

/**
 * Biome pools (#50): the biomes a generated overworld may use, one plain
 * note per pool at `<biome pools folder>/<name>.md`:
 *
 *   ---
 *   hexmaker-biome-pool: 1
 *   ---
 *
 *   # Cold north
 *
 *   > [!info] Biome pool
 *   > … (short help)
 *
 *   | Biome | Weight | Notes |
 *   | --- | ---: | --- |
 *   | [[Tundra]] |  |  |
 *   | [[Taiga]] | 2 | twice as likely where it fits |
 *   | [[Glass wastes]] | 0.5 |  |
 *
 * - *Biome* links a biome note (built-in or the user's, generator-backed
 *   ones too).
 * - *Weight* (optional, default 1) scales how often the biome takes a hex
 *   where its climate fits: 0.5 = half its chance, 2 = twice it (up to
 *   always), 0 = never placed by the generator.
 * - *Notes* is free text, kept as written.
 *
 * Placement uses each biome's climate (biomeClimate.ts). A biome in the
 * pool WITHOUT a climate is placed only on hexes no climate biome of the
 * pool fits (a pool of just such biomes paints them by chance).
 *
 * Reading is forgiving: columns by header name in any order, a plain name
 * instead of a link, weights like `2` or `50%`. Rows that can't be read
 * are reported and left in the note as written; rewriting replaces only
 * the table (prose and other frontmatter stay).
 *
 * Pure: no Obsidian imports.
 */

import { biomeFileName, linkTarget, type BiomeNoteFields } from "./biomeNote";

export const BIOME_POOL_MARKER = "hexmaker-biome-pool";
export const BIOME_POOL_FORMAT = 1;
/** The shipped pool's name. */
export const ALL_BIOMES_POOL = "All biomes";

export interface BiomePoolRow {
  /** Link target as written (no brackets), e.g. "Tundra" or "world/biomes/Tundra". */
  biome: string;
  /** Default 1. */
  weight?: number;
  notes?: string;
}

export interface BiomePoolProblem {
  text: string;
}

export interface ParsedBiomePool {
  rows: BiomePoolRow[];
  problems: BiomePoolProblem[];
}

export const BIOME_POOL_HELP = [
  "> [!info] Biome pool",
  "> The biomes a generated overworld may use. **Biome** links a biome note. **Weight** (optional, 1 if blank) scales how often it's chosen where its climate fits: 0.5 is half as often, 2 twice (up to always), 0 never. Biomes without a climate are only placed where no other biome in the pool fits. Add or delete rows freely.",
];

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    // A `|` inside [[link|alias]] belongs to the link.
    if (s[i] === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
    if (s[i] === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|" && !depth) { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

interface Span { start: number; end: number; headers: string[] }

function findTable(lines: string[]): Span | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !SEPARATOR_ROW.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map(norm);
    if (!headers.includes("biome") && !headers.includes("biomes")) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, headers };
  }
  return null;
}

/** "2", "50%", "0.5" → a weight ≥ 0, or NaN. */
function readWeight(raw: string): number {
  const t = raw.trim();
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  if (!t || !Number.isFinite(n) || n < 0) return NaN;
  return pct ? n / 100 : n;
}

/** Read a pool note. Never throws. */
export function parseBiomePool(content: string): ParsedBiomePool {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const rows: BiomePoolRow[] = [];
  const problems: BiomePoolProblem[] = [];
  const t = findTable(lines);
  if (!t) return { rows, problems: [{ text: "no table with a Biome column" }] };
  const bi = t.headers.includes("biome") ? t.headers.indexOf("biome") : t.headers.indexOf("biomes");
  const wi = ["weight", "chance", "share"].map((h) => t.headers.indexOf(h)).find((i) => i >= 0) ?? -1;
  const ni = ["notes", "note", "comment"].map((h) => t.headers.indexOf(h)).find((i) => i >= 0) ?? -1;
  for (let i = t.start + 2; i < t.end; i++) {
    const cells = splitRow(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const biome = linkTarget(cells[bi] ?? "");
    if (!biome) { problems.push({ text: `row ${i + 1}: no biome` }); continue; }
    const row: BiomePoolRow = { biome };
    const rawW = wi >= 0 ? (cells[wi] ?? "").trim() : "";
    if (rawW) {
      const w = readWeight(rawW);
      if (Number.isFinite(w)) row.weight = w;
      else problems.push({ text: `row ${i + 1}: weight "${rawW}" isn't a number (read as 1)` });
    }
    const notes = ni >= 0 ? (cells[ni] ?? "").trim() : "";
    if (notes) row.notes = notes;
    rows.push(row);
  }
  return { rows, problems };
}

const esc = (s: string) => s.replace(/\|/g, "\\|");
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function poolTable(rows: BiomePoolRow[]): string[] {
  return [
    "| Biome | Weight | Notes |",
    "| --- | ---: | --- |",
    ...rows.map((r) => `| [[${r.biome}]] | ${r.weight !== undefined && r.weight !== 1 ? fmt(r.weight) : ""} | ${esc(r.notes ?? "")} |`),
  ];
}

/** A fresh pool note. */
export function buildBiomePool(name: string, rows: BiomePoolRow[]): string {
  return [
    "---", `${BIOME_POOL_MARKER}: ${BIOME_POOL_FORMAT}`, "---", "",
    `# ${name}`, "",
    ...BIOME_POOL_HELP, "",
    ...poolTable(rows), "",
  ].join("\n");
}

/**
 * The note with its table set to `rows` (everything else kept; rows the
 * plugin reads the same are left as written). Same string when unchanged.
 */
export function updateBiomePool(content: string, rows: BiomePoolRow[]): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const t = findTable(lines);
  const same = (a: BiomePoolRow[], b: BiomePoolRow[]) => JSON.stringify(a.map(key)) === JSON.stringify(b.map(key));
  if (t && same(parseBiomePool(content).rows, rows) && !parseBiomePool(content).problems.length) return content;
  const table = poolTable(rows);
  let out: string[];
  if (t) out = [...lines.slice(0, t.start), ...table, ...lines.slice(t.end)];
  else {
    out = [...lines];
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    out.push("", ...table, "");
  }
  return out.join(eol);
}

const key = (r: BiomePoolRow) => [r.biome.toLowerCase(), r.weight ?? 1, r.notes ?? ""];

/** The shipped pool: every built-in biome, linked by its note's name. */
export function allBiomesPool(presets: readonly BiomeNoteFields[]): BiomePoolRow[] {
  return presets.map((p) => ({ biome: biomeFileName(p.label) }));
}

/**
 * A pool's biomes as placement input: each row's biome (looked up by
 * `find`, which takes a link target), with its climate chance scaled by the
 * row's weight. Weight 0 drops a biome; a row naming no known biome is
 * reported. Repeats: the first row counts.
 */
export function poolBiomes(
  rows: readonly BiomePoolRow[],
  find: (ref: string) => BiomeNoteFields | undefined,
): { biomes: BiomeNoteFields[]; unknown: string[] } {
  const biomes: BiomeNoteFields[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const b = find(r.biome) ?? find(r.biome.slice(r.biome.lastIndexOf("/") + 1));
    if (!b) { unknown.push(r.biome); continue; }
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const w = r.weight ?? 1;
    if (w <= 0) continue;
    if (w === 1 || !b.climate) { biomes.push(b); continue; }
    const chance = Math.min(1, (b.climate.chance ?? 1) * w);
    const climate = { ...b.climate };
    if (chance >= 1) delete climate.chance;
    else climate.chance = chance;
    biomes.push({ ...b, climate });
  }
  return { biomes, unknown };
}

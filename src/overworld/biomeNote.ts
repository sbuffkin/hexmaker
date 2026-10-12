/**
 * Biome notes (#50): one plain note per overworld biome, at
 * `<worldFolder>/biomes/<name>.md`, built-in and user-made alike.
 *
 *   ---
 *   hexmaker-biome: 1
 *   id: tundra
 *   label: Tundra
 *   colour: "#d8e4ea"
 *   blend: normal
 *   land-share: 90%
 *   min-islands: 3
 *   generator: "[[My tundra]]"
 *   ---
 *
 *   # Tundra
 *
 *   > [!info] Biome
 *   > … (short help)
 *
 *   ## Mix
 *
 *   | Type | Weight |
 *   | --- | ---: |
 *   | snow | 40 |
 *
 *   ## Transitions
 *
 *   | Next to | Put between |
 *   | --- | --- |
 *   | Temperate forest | Taiga |
 *
 * - *Mix* is by terrain TYPE (the palette's Type column), never by terrain
 *   name: a region of this biome gets each type in proportion to its weight
 *   (any scale), spread over the palette's terrains of that type.
 * - *Terrain weights* (optional, PR1): how one type's share is split among
 *   the palette's terrains of that type, by name (`| Terrain | Weight |`,
 *   "Pine forest 3, Oak forest 1"). Terrains not listed count 1; 0 leaves
 *   one out. Without the table a type's share is split evenly.
 * - `parent`: the biome this one was made from ("Make generator from
 *   this region"); used to list related generators first.
 * - *Transitions*: biomes this one shouldn't touch on an overworld, and the
 *   biome put between them. Biomes are named by label, id or note name.
 * - `blend`: narrow, normal or wide (how far the biome mixes into its
 *   neighbours' regions). `land-share` (0–100%, or 0–1) and `min-islands`
 *   are for watery biomes. All optional.
 * - `generator`: a generator note this biome's regions come from (once
 *   generator regions land); without one it mixes with the blend field.
 * - `blank: yes`: its regions start blank (nothing generated) and are
 *   painted by hand (the shipped "Custom (blank)" biome). Never placed by
 *   World biomes; its Mix may be empty.
 *
 * Reading is forgiving: columns by header name in any order, `colour` or
 * `color`, weights like `40` or `40%`. Rows that can't be read are reported
 * (`problems`) and left in the note as written. Writing touches only the
 * plugin's own frontmatter keys and the two tables; every other line (the
 * user's prose, extra frontmatter keys) stays; a table is only rewritten
 * when what it says changed.
 *
 * Pure: no Obsidian imports.
 */

import { climateKeyValues, readClimate, sameClimateValue, type BiomeClimate } from "./biomeClimate";
import { cleanTuning, isTuningHeader, readTuningRows, tuningTable, type BiomeTuning } from "./biomeTuning";

// The tuning API, for callers that read biome notes (one import for both).
export {
  TUNING_PARAMS,
  TUNING_SECTIONS,
  blendTuning,
  cleanTuning,
  clampTuning,
  engineOverrides,
  isDefaultValue,
  paramsIn,
  tuned,
  tunedOrUnset,
  tuningCount,
  tuningParam,
  type BiomeTuning,
  type TuningParam,
  type TuningSection,
} from "./biomeTuning";

/** Frontmatter key written into every biome note (the format version). */
export const BIOME_NOTE_MARKER = "hexmaker-biome";
export const BIOME_NOTE_FORMAT = 1;

export type BiomeBlend = "narrow" | "normal" | "wide";
export const BIOME_BLENDS: readonly BiomeBlend[] = ["narrow", "normal", "wide"];

export interface BiomeMixRow {
  /** Terrain type id (TERRAIN_TYPES), e.g. "forest". */
  type: string;
  /** Relative weight, > 0, any scale. */
  weight: number;
  /**
   * Fewest separate patches of this type a region of the biome gets (the
   * Mix table's optional "Min patches" column). Unset = no minimum.
   */
  minPatches?: number;
}

/** One row of the optional Terrain weights table: a palette terrain's weight within its type. */
export interface BiomeTerrainWeight {
  /** Palette terrain name, as written (matched ignoring case). */
  terrain: string;
  /** Relative weight within its type, >= 0 (0 = never). */
  weight: number;
}

export interface BiomeTransition {
  /** The biome this one shouldn't touch (as written: label, id or note name). */
  next: string;
  /** The biome put between them. */
  between: string;
}

/** What a biome note says. Shared with the generator page (other session). */
export interface BiomeNoteFields {
  /** Stable id: references (region maps, transitions) use it, so a renamed note keeps them. */
  id: string;
  label: string;
  /** Swatch colour (CSS colour, hex lower-cased). */
  color?: string;
  /** Terrain-type mix (by type only). */
  mix: BiomeMixRow[];
  transitions: BiomeTransition[];
  /** Inter-region blend width; unset = the overworld's setting. */
  blend?: BiomeBlend;
  /** Share of land, 0..1 (watery biomes). */
  landShare?: number;
  /** Fewest islands a region of this biome gets. */
  minIslands?: number;
  /**
   * A shoreline biome (`shore: yes`): a region's land goes toward its
   * land-heavy neighbours and its water toward the others, with a coast
   * band between (regionGen placeShore).
   */
  shore?: boolean;
  /** Link target of a generator note (no brackets), e.g. "world/generators/My tundra". */
  generator?: string;
  /** Where World biomes may place it (biomeClimate.ts); unset = only by hand. */
  climate?: BiomeClimate;
  /** Per-terrain weights within a type (the optional Terrain weights table). */
  terrainWeights?: BiomeTerrainWeight[];
  /** The biome this one was made from (label, id or note name). */
  parent?: string;
  /** `blank: yes`: its regions start blank, to paint by hand (no generation, never placed by World biomes). */
  blank?: boolean;
  /** Generator tuning (the optional Tuning table, biomeTuning.ts): only values that differ from the defaults. */
  tuning?: BiomeTuning;
}

export interface BiomeNoteProblem {
  /** "settings" (frontmatter), "Mix" or "Transitions". */
  where: string;
  text: string;
}

export interface ParsedBiomeNote {
  fields: BiomeNoteFields;
  problems: BiomeNoteProblem[];
}

/** Lower-case id from a name: "Temperate forest" → "temperate-forest". */
export function biomeSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

const UNSAFE_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** A label as a legal note basename. */
export function biomeFileName(label: string): string {
  return label.replace(UNSAFE_NAME_CHARS, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "") || "Biome";
}

export const BIOME_HELP = [
  "> [!info] Biome",
  "> A biome for overworld regions. **Mix**: how much of each terrain *type* its regions get (weights, any scale; an optional *Min patches* column asks for at least that many separate patches of the type). **Terrain weights** (optional): how a type's share is split between its terrains, like Pine forest 3 and Oak forest 1 (terrains not listed count 1). **Transitions**: biomes it shouldn't touch, and the biome put between. In the frontmatter, `blend` is narrow, normal or wide; `land-share` (like `60%`) and `min-islands` are for watery biomes; `shore: yes` puts a region's land on the side of its land neighbours and its water on the other; `blank: yes` makes its regions start blank, to paint by hand; `generator` links a generator note. For generated overworlds (optional): `temperature` (cold, cool, mild, warm, hot, or 0.2–0.5), `moisture` (dry, moderate, wet), `elevation` (sea, low, mid, high, mouth), `coastal: yes`, `chance` (like 50%) and `rare: yes`; without them the biome is only placed by hand. Delete a row to drop it.",
];

// ── reading ──────────────────────────────────────────────────────────────

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

interface Span { start: number; end: number; headers: string[] }

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** First table whose headers satisfy `want`. */
function findTable(lines: string[], want: (headers: string[]) => boolean): Span | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !SEPARATOR_ROW.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map(norm);
    if (!want(headers)) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, headers };
  }
  return null;
}

const isMix = (h: string[]) => h.includes("type") && (h.includes("weight") || h.includes("share"));
const isTerrainWeights = (h: string[]) => h.includes("terrain") && !h.includes("type") && (h.includes("weight") || h.includes("share"));
const isTuning = (h: string[]) => isTuningHeader(h);
const isTransitions = (h: string[]) => (h.includes("next to") || h.includes("biome")) && (h.includes("put between") || h.includes("between") || h.includes("transition"));

/** The frontmatter span (line indices: the opening and closing `---`), or null. */
function frontmatterSpan(lines: string[]): { open: number; close: number } | null {
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return close > 0 ? { open: 0, close } : null;
}

const unquote = (v: string) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"');
  return t;
};

/** Plain `key: value` frontmatter (no nesting needed here). Keys lower-cased. */
function readFrontmatter(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const fm = frontmatterSpan(lines);
  if (!fm) return out;
  for (const l of lines.slice(fm.open + 1, fm.close)) {
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(l);
    if (m) out.set(m[1].toLowerCase(), unquote(m[2].replace(/\s+#.*$/, "")));
  }
  return out;
}

/** Headers the Mix table's min-patches column may have. */
const MIN_PATCH_HEADERS = ["min patches", "min-patches", "minimum patches", "fewest patches", "patches"];

/** "yes" / "true" / "on" / "1" → true, "no" / "false" / "off" / "0" → false, else undefined. */
function readYesNo(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase();
  if (["yes", "y", "true", "on", "1"].includes(t)) return true;
  if (["no", "n", "false", "off", "0"].includes(t)) return false;
  return undefined;
}

/** "40", "40%", "0.4" → a number, or NaN. */
const num = (raw: string) => Number(raw.trim().replace(/%$/, "").trim());

/** "60%" → 0.6, "0.6" → 0.6, "60" → 0.6. NaN when unreadable. */
export function parseShare(raw: string): number {
  const t = raw.trim();
  if (!t) return NaN;
  const pct = t.endsWith("%");
  const n = num(t);
  if (!Number.isFinite(n)) return NaN;
  const v = pct || n > 1 ? n / 100 : n;
  return v >= 0 && v <= 1 ? v : NaN;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function readColour(raw: string): string {
  const v = raw.trim().replace(/^`+|`+$/g, "").trim();
  if (HEX.test(v)) return (v.startsWith("#") ? v : `#${v}`).toLowerCase();
  return v;
}

/** `[[Target|Alias]]` / `[[Target]]` / plain text → "Target". */
export function linkTarget(raw: string): string {
  const m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(raw);
  return (m ? m[1] : raw).trim();
}

/**
 * Read a biome note. `basename` (the note's name) gives the label and id
 * when the frontmatter has none. Never throws; unreadable bits go to `problems`.
 */
export function parseBiomeNote(content: string, basename: string): ParsedBiomeNote {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const fm = readFrontmatter(lines);
  const problems: BiomeNoteProblem[] = [];
  const label = fm.get("label")?.trim() || basename.trim();
  const fields: BiomeNoteFields = {
    id: biomeSlug(fm.get("id") ?? "") || biomeSlug(basename) || biomeSlug(label) || "biome",
    label,
    mix: [],
    transitions: [],
  };
  const colour = fm.get("colour") ?? fm.get("color");
  if (colour) fields.color = readColour(colour);
  const blend = fm.get("blend")?.trim().toLowerCase();
  if (blend) {
    if ((BIOME_BLENDS as readonly string[]).includes(blend)) fields.blend = blend as BiomeBlend;
    else problems.push({ where: "settings", text: `blend should be narrow, normal or wide, not "${blend}"` });
  }
  const land = fm.get("land-share");
  if (land) {
    const v = parseShare(land);
    if (Number.isFinite(v)) fields.landShare = v;
    else problems.push({ where: "settings", text: `land-share should be a share like 60%, not "${land}"` });
  }
  const isl = fm.get("min-islands");
  if (isl) {
    const v = num(isl);
    if (Number.isInteger(v) && v >= 0) fields.minIslands = v;
    else problems.push({ where: "settings", text: `min-islands should be a whole number, not "${isl}"` });
  }
  const gen = fm.get("generator");
  if (gen && linkTarget(gen)) fields.generator = linkTarget(gen);
  const parent = fm.get("parent");
  if (parent && linkTarget(parent)) fields.parent = linkTarget(parent);
  const shore = fm.get("shore");
  if (shore) {
    const v = readYesNo(shore);
    if (v === true) fields.shore = true;
    else if (v === undefined) problems.push({ where: "settings", text: `shore should be yes or no, not "${shore}"` });
  }
  const blank = fm.get("blank");
  if (blank) {
    const v = readYesNo(blank);
    if (v === true) fields.blank = true;
    else if (v === undefined) problems.push({ where: "settings", text: `blank should be yes or no, not "${blank}"` });
  }
  const climate = readClimate(fm);
  if (climate.climate) fields.climate = climate.climate;
  for (const p of climate.problems) problems.push({ where: "settings", text: p.text });

  const mix = findTable(lines, isMix);
  if (mix) {
    const ti = mix.headers.indexOf("type");
    const wi = mix.headers.includes("weight") ? mix.headers.indexOf("weight") : mix.headers.indexOf("share");
    const pi = mix.headers.findIndex((h) => MIN_PATCH_HEADERS.includes(h));
    for (let i = mix.start + 2; i < mix.end; i++) {
      const cells = splitRow(lines[i]);
      if (cells.every((c) => c === "")) continue;
      const type = (cells[ti] ?? "").trim().toLowerCase().replace(/\s+/g, "-");
      const w = num(cells[wi] ?? "");
      if (!type) { problems.push({ where: "Mix", text: `row ${i + 1}: no type` }); continue; }
      if (!Number.isFinite(w) || w < 0) { problems.push({ where: "Mix", text: `row ${i + 1}: weight "${cells[wi] ?? ""}" isn't a number` }); continue; }
      if (w === 0) continue;
      // Min patches: blank = none; a bad value is reported, the row still counts.
      const rawP = pi >= 0 ? (cells[pi] ?? "").trim() : "";
      let minPatches: number | undefined;
      if (rawP && rawP !== "-" && rawP !== "—") {
        const p = num(rawP);
        if (Number.isInteger(p) && p >= 0) minPatches = p;
        else problems.push({ where: "Mix", text: `row ${i + 1}: min patches "${rawP}" isn't a whole number` });
      }
      const hit = fields.mix.find((r) => r.type === type);
      if (hit) {
        hit.weight += w;
        if (minPatches !== undefined) hit.minPatches = Math.max(hit.minPatches ?? 0, minPatches);
      } else fields.mix.push(minPatches !== undefined ? { type, weight: w, minPatches } : { type, weight: w });
    }
  }
  const tw = findTable(lines, isTerrainWeights);
  if (tw) {
    const ni = tw.headers.indexOf("terrain");
    const wi = tw.headers.includes("weight") ? tw.headers.indexOf("weight") : tw.headers.indexOf("share");
    const rows: BiomeTerrainWeight[] = [];
    for (let i = tw.start + 2; i < tw.end; i++) {
      const cells = splitRow(lines[i]);
      if (cells.every((c) => c === "")) continue;
      const terrain = linkTarget(cells[ni] ?? "");
      const w = num(cells[wi] ?? "");
      if (!terrain) { problems.push({ where: "Terrain weights", text: `row ${i + 1}: no terrain` }); continue; }
      if (!Number.isFinite(w) || w < 0) { problems.push({ where: "Terrain weights", text: `row ${i + 1}: weight "${cells[wi] ?? ""}" isn't a number` }); continue; }
      const hit = rows.find((r) => r.terrain.toLowerCase() === terrain.toLowerCase());
      if (hit) hit.weight += w;
      else rows.push({ terrain, weight: w });
    }
    if (rows.length) fields.terrainWeights = rows;
  }
  const tr = findTable(lines, isTransitions);
  if (tr) {
    const ni = tr.headers.includes("next to") ? tr.headers.indexOf("next to") : tr.headers.indexOf("biome");
    const bi = ["put between", "between", "transition"].map((h) => tr.headers.indexOf(h)).find((x) => x >= 0)!;
    for (let i = tr.start + 2; i < tr.end; i++) {
      const cells = splitRow(lines[i]);
      if (cells.every((c) => c === "")) continue;
      const next = linkTarget(cells[ni] ?? ""), between = linkTarget(cells[bi] ?? "");
      if (!next || !between) { problems.push({ where: "Transitions", text: `row ${i + 1}: needs both a biome and the one put between` }); continue; }
      fields.transitions.push({ next, between });
    }
  }
  const tu = findTable(lines, isTuning);
  if (tu) {
    const rows: { cells: string[]; line: string; n: number }[] = [];
    for (let i = tu.start + 2; i < tu.end; i++) rows.push({ cells: splitRow(lines[i]), line: lines[i], n: i + 1 });
    const read = readTuningRows(rows, tu.headers);
    if (read.tuning) fields.tuning = read.tuning;
    for (const p of read.problems) problems.push({ where: "Tuning", text: p });
  }
  return { fields, problems };
}

// ── writing ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\|/g, "\\|");
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const quote = (s: string) => (/^[\w .,()'-]*$/.test(s) && !/^\s|\s$/.test(s) && !/^(yes|no|true|false|null|~|-?\d[\d.]*)$/i.test(s) ? s : `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);

/** "0.6" → "60%". */
export const shareText = (v: number) => `${fmt(v * 100)}%`;

/** The Mix table; the Min patches column only when some row has one (older notes stay as they were). */
function mixTable(rows: BiomeMixRow[]): string[] {
  if (!rows.some((r) => r.minPatches !== undefined))
    return ["| Type | Weight |", "| --- | ---: |", ...rows.map((r) => `| ${esc(r.type)} | ${fmt(r.weight)} |`)];
  return [
    "| Type | Weight | Min patches |",
    "| --- | ---: | ---: |",
    ...rows.map((r) => `| ${esc(r.type)} | ${fmt(r.weight)} | ${r.minPatches !== undefined ? String(r.minPatches) : ""} |`),
  ];
}

function terrainWeightsTable(rows: BiomeTerrainWeight[]): string[] {
  return ["| Terrain | Weight |", "| --- | ---: |", ...rows.map((r) => `| ${esc(r.terrain)} | ${fmt(r.weight)} |`)];
}

function transitionsTable(rows: BiomeTransition[]): string[] {
  return ["| Next to | Put between |", "| --- | --- |", ...rows.map((r) => `| ${esc(r.next)} | ${esc(r.between)} |`)];
}

/** Our frontmatter keys, in writing order, with their values (undefined = remove). */
function ownKeys(f: BiomeNoteFields): [string, string | undefined][] {
  return [
    [BIOME_NOTE_MARKER, String(BIOME_NOTE_FORMAT)],
    ["id", f.id],
    ["label", quote(f.label)],
    ["colour", f.color ? `"${f.color}"` : undefined],
    ["blend", f.blend],
    ["land-share", f.landShare !== undefined ? shareText(f.landShare) : undefined],
    ["min-islands", f.minIslands !== undefined ? String(f.minIslands) : undefined],
    ["shore", f.shore ? "yes" : undefined],
    ["blank", f.blank ? "yes" : undefined],
    ["generator", f.generator ? `"[[${f.generator}]]"` : undefined],
    ["parent", f.parent ? quote(f.parent) : undefined],
    ...climateKeyValues(f.climate),
  ];
}

const OWN_ALIASES: Record<string, string> = { color: "colour" };

/** A fresh biome note. */
export function buildBiomeNote(f: BiomeNoteFields): string {
  const fm = ownKeys(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return [
    "---", ...fm, "---", "",
    `# ${f.label}`, "",
    ...BIOME_HELP, "",
    "## Mix", "",
    ...mixTable(f.mix), "",
    ...(f.terrainWeights?.length ? ["## Terrain weights", "", ...terrainWeightsTable(f.terrainWeights), ""] : []),
    "## Transitions", "",
    ...transitionsTable(f.transitions), "",
    ...(cleanTuning(f.tuning) ? ["## Tuning", "", ...tuningTable(f.tuning), ""] : []),
  ].join("\n");
}

/**
 * The note with `f` written into it: our frontmatter keys set (others kept,
 * in place), the Mix and Transitions tables replaced (or added under their
 * own heading at the end). Everything else stays as it was; line endings
 * are kept. The same string when nothing changed.
 */
export function updateBiomeNote(content: string, f: BiomeNoteFields): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  let lines = content.replace(/\r\n?/g, "\n").split("\n");
  // Frontmatter.
  const keys = ownKeys(f);
  let fm = frontmatterSpan(lines);
  if (!fm) {
    lines = ["---", "---", ...lines];
    fm = { open: 0, close: 1 };
  }
  const body = lines.slice(fm.open + 1, fm.close);
  const seen = new Set<string>();
  const nextBody: string[] = [];
  for (const l of body) {
    const m = /^([A-Za-z][\w-]*)\s*:/.exec(l);
    const key = m ? (OWN_ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase()) : undefined;
    const own = key ? keys.find(([k]) => k === key) : undefined;
    if (!own) { nextBody.push(l); continue; }
    if (seen.has(key!)) continue; // a duplicate key: one is enough
    seen.add(key!);
    if (own[1] === undefined) continue;
    const want = `${m![1]}: ${own[1]}`;
    // Keep the user's spelling when it already reads as the same value.
    const cur = readFrontmatter(["---", l, "---"]).get(m![1].toLowerCase()) ?? "";
    nextBody.push(sameValue(key!, cur, own[1]) ? l : want);
  }
  for (const [k, v] of keys) if (!seen.has(k) && v !== undefined) nextBody.push(`${k}: ${v}`);
  lines.splice(fm.open + 1, fm.close - fm.open - 1, ...nextBody);
  // Tables.
  lines = putTable(lines, isMix, mixTable(f.mix), "## Mix");
  // Only written when there are weights, or the note already has the table.
  if (f.terrainWeights?.length || findTable(lines, isTerrainWeights)) lines = putTable(lines, isTerrainWeights, terrainWeightsTable(f.terrainWeights ?? []), "## Terrain weights");
  lines = putTable(lines, isTransitions, transitionsTable(f.transitions), "## Transitions");
  // Only written when something is tuned, or the note already has the table
  // (rows that name no setting are kept as written).
  const tu = findTable(lines, isTuning);
  if (cleanTuning(f.tuning) || tu) {
    const kept = tu ? readTuningRows(lines.slice(tu.start + 2, tu.end).map((l, i) => ({ cells: splitRow(l), line: l, n: tu.start + 3 + i })), tu.headers).unknownRows : [];
    lines = putTable(lines, isTuning, tuningTable(f.tuning, kept), "## Tuning");
  }
  const out = lines.join(eol);
  return out === content.replace(/\r\n?/g, "\n").split("\n").join(eol) ? content : out;
}

const CLIMATE_KEY_SET = new Set(climateKeyValues(undefined).map(([k]) => k));

function sameValue(key: string, cur: string, want: string): boolean {
  const w = unquote(want);
  if (key === "land-share") return parseShare(cur) === parseShare(w);
  if (key === "colour") return readColour(cur) === readColour(w);
  if (key === "generator" || key === "parent") return linkTarget(cur) === linkTarget(w);
  if (key === "id") return biomeSlug(cur) === biomeSlug(w);
  if (key === "shore" || key === "blank") return readYesNo(cur) === readYesNo(w);
  if (CLIMATE_KEY_SET.has(key)) return sameClimateValue(key, cur, w);
  return cur.trim() === w.trim();
}

function putTable(lines: string[], want: (h: string[]) => boolean, table: string[], heading: string): string[] {
  const span = findTable(lines, want);
  if (span) {
    const cur = lines.slice(span.start, span.end);
    // Rows the plugin reads the same are left alone (spacing, alignment, extra columns).
    if (sameTable(cur, table)) return lines;
    return [...lines.slice(0, span.start), ...table, ...lines.slice(span.end)];
  }
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  out.push("", heading, "", ...table, "");
  return out;
}

function sameTable(cur: string[], next: string[]): boolean {
  const rows = (ls: string[]) => ls.slice(2).filter((l) => splitRow(l).some((c) => c !== "")).map((l) => splitRow(l).join("|").toLowerCase());
  const a = rows(cur), b = rows(next);
  return a.length === b.length && a.every((r, i) => r === b[i]) && splitRow(cur[0]).map(norm).join("|") === splitRow(next[0]).map(norm).join("|");
}

/** Mix as shares summing to 1 (types with weight 0 dropped). */
export function mixShares(mix: BiomeMixRow[]): Map<string, number> {
  const total = mix.reduce((s, r) => s + Math.max(0, r.weight), 0);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const r of mix) if (r.weight > 0) out.set(r.type, (out.get(r.type) ?? 0) + r.weight / total);
  return out;
}

/**
 * The biome store as the rest of the plugin sees it (`plugin.biomeStore`).
 * `name` is a biome's id, label or note name (case-insensitive).
 */
export interface BiomeStoreApi {
  get(name: string): BiomeNoteFields | undefined;
  /** Every biome, in note-name order. */
  list(): BiomeNoteFields[];
  /** Write a change to a biome's note (user prose kept). False when there's no such biome or its note doesn't read. */
  update(name: string, patch: Partial<Omit<BiomeNoteFields, "id">>): Promise<boolean>;
  /** Rewrite a shipped biome's note from its preset data (the old note is backed up). False for user biomes. */
  restoreDefault(name: string): Promise<boolean>;
  /** Whether a biome has shipped preset data (Restore default applies). */
  hasDefault(name: string): boolean;
}

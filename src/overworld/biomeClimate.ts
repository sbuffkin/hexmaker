/**
 * A biome's climate (#50): where World biomes may place it on a generated
 * overworld. Optional plain keys in the biome note's frontmatter:
 *
 *   temperature: cold–mild     (cold, cool, mild, warm, hot, or 0.2–0.5)
 *   moisture: wet              (dry, moderate, wet, or 0.6–1)
 *   elevation: low             (sea, low, mid, high, or mouth)
 *   coastal: yes               (only next to the coast)
 *   chance: 50%                (share of the fitting hexes it takes)
 *   rare: yes                  (at most one hex per ~20)
 *
 * A biome with none of temperature / moisture / elevation / coastal is
 * never placed by the generator, only by hand. Built-in biomes carry
 * theirs as data (biomePresets.ts); nothing here knows any biome by name.
 *
 * How the generator uses it (worldBiomes.ts): each hex is in one band of
 * height (high: the top of the land; mid: hills; low: the rest; sea; and
 * the river's mouth). The biomes of a band whose temperature and moisture
 * contain the hex's are tried rarest first, then narrowest: one roll per
 * hex, and the first biome whose chance is above the roll takes it. When
 * none does, the hex falls to the next band down.
 *
 * Reading is forgiving: en dash, hyphen, "to" or ".." between the ends;
 * percents or 0–1; a range written backwards is turned round. Anything
 * unreadable is reported and left out (the hex just isn't limited by it).
 *
 * Pure: no Obsidian imports.
 */

export interface ClimateRange {
  /** 0..1, inclusive. */
  lo: number;
  /** 0..1, exclusive (inclusive at 1). */
  hi: number;
}

export type ClimateElevation = "sea" | "low" | "mid" | "high" | "mouth";

export interface BiomeClimate {
  /** Unset: any temperature. */
  temperature?: ClimateRange;
  /** Unset: any moisture. */
  moisture?: ClimateRange;
  /** Unset (with other climate keys set): low. */
  elevation?: ClimateElevation;
  /** Only hexes next to the coast (land by the sea, or sea by land). */
  coastal?: boolean;
  /** Share of the fitting hexes it takes, 0..1; unset = all of them. */
  chance?: number;
  /** At most one hex per ~20 on an overworld. */
  rare?: boolean;
}

export interface ClimateProblem {
  key: string;
  text: string;
}

/** Word bands, cold → hot. */
export const TEMPERATURE_WORDS: readonly [string, number, number][] = [
  ["cold", 0, 0.2],
  ["cool", 0.2, 0.4],
  ["mild", 0.4, 0.6],
  ["warm", 0.6, 0.8],
  ["hot", 0.8, 1],
];
/** Word bands, dry → wet. */
export const MOISTURE_WORDS: readonly [string, number, number][] = [
  ["dry", 0, 1 / 3],
  ["moderate", 1 / 3, 2 / 3],
  ["wet", 2 / 3, 1],
];

const ELEVATION_ALIASES: Record<string, ClimateElevation> = {
  sea: "sea", ocean: "sea", water: "sea",
  low: "low", lowland: "low", lowlands: "low", plain: "low", plains: "low",
  mid: "mid", middle: "mid", hills: "mid", hill: "mid", upland: "mid", uplands: "mid",
  high: "high", peak: "high", peaks: "high", highland: "high", highlands: "high",
  mouth: "mouth", "river mouth": "mouth", "river-mouth": "mouth", delta: "mouth",
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** One end of a range: a word band, or a number (percent, or 0–1). */
function readEnd(raw: string, words: readonly [string, number, number][]): { lo: number; hi: number; word: boolean } | undefined {
  const t = raw.trim().toLowerCase();
  const w = words.find(([name]) => name === t);
  if (w) return { lo: w[1], hi: w[2], word: true };
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  if (!t || !Number.isFinite(n)) return undefined;
  const v = pct || n > 1 ? n / 100 : n;
  return v >= 0 && v <= 1 ? { lo: v, hi: v, word: false } : undefined;
}

/**
 * "cold–mild", "wet", "0.2–0.5", "20% to 50%" → a range; "any" or blank →
 * undefined with no problem. Problems name what was wrong.
 */
export function parseClimateRange(raw: string, words: readonly [string, number, number][]): { range?: ClimateRange; problem?: string } {
  const t = raw.trim().toLowerCase();
  if (!t || t === "any") return {};
  const parts = t.split(/\s*(?:–|—|\.\.|\bto\b|(?<=[a-z%\d.])\s*-\s*(?=[a-z\d.]))\s*/).filter((p) => p !== "");
  const names = words.map(([n]) => n).join(", ");
  if (parts.length > 2) return { problem: `"${raw.trim()}" should be one band or a range like ${words[0][0]}–${words[1][0]}` };
  const ends = parts.map((p) => readEnd(p, words));
  if (ends.some((e) => !e)) return { problem: `"${raw.trim()}" should use ${names}, or numbers from 0 to 1` };
  const [a, b] = ends as { lo: number; hi: number; word: boolean }[];
  if (!b) {
    if (!a.word) return { problem: `"${raw.trim()}" needs two ends, like 0.2–0.5` };
    return { range: { lo: a.lo, hi: a.hi } };
  }
  // Word ends span their whole band; number ends are the number.
  let lo = a.lo, hi = b.hi;
  let problem: string | undefined;
  if (lo > hi) {
    // Written backwards ("mild–cold"): turned round.
    problem = `"${raw.trim()}" runs backwards; read the other way round`;
    lo = b.lo;
    hi = a.hi;
  }
  if (near(lo, hi)) return { problem: `"${raw.trim()}" is empty (both ends are the same)` };
  return { range: { lo, hi }, problem };
}

/** A range as written: words when its ends fall on word bands, else numbers. */
export function formatClimateRange(r: ClimateRange, words: readonly [string, number, number][]): string {
  const from = words.find(([, lo]) => near(lo, r.lo));
  const to = words.find(([, , hi]) => near(hi, r.hi));
  if (from && to) return from === to ? from[0] : `${from[0]}–${to[0]}`;
  return `${fmtNum(r.lo)}–${fmtNum(r.hi)}`;
}

/** Whether a range is the whole 0–1 (says nothing). */
const isAll = (r: ClimateRange | undefined) => !r || (near(r.lo, 0) && near(r.hi, 1));

/** "yes" / "no" and friends; undefined when neither. */
export function readYesNoWord(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase();
  if (["yes", "y", "true", "on", "1"].includes(t)) return true;
  if (["no", "n", "false", "off", "0"].includes(t)) return false;
  return undefined;
}

/** "50%", "0.5", "50" → 0.5; NaN when unreadable. */
function readChance(raw: string): number {
  const t = raw.trim();
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  if (!t || !Number.isFinite(n)) return NaN;
  const v = pct || n > 1 ? n / 100 : n;
  return v >= 0 && v <= 1 ? v : NaN;
}

/** Read the climate keys from a note's (lower-cased) frontmatter. Undefined when none is set. */
export function readClimate(fm: ReadonlyMap<string, string>): { climate?: BiomeClimate; problems: ClimateProblem[] } {
  const problems: ClimateProblem[] = [];
  const c: BiomeClimate = {};
  const temp = fm.get("temperature");
  if (temp !== undefined) {
    const r = parseClimateRange(temp, TEMPERATURE_WORDS);
    if (r.range && !isAll(r.range)) c.temperature = r.range;
    if (r.problem) problems.push({ key: "temperature", text: r.problem });
  }
  const moist = fm.get("moisture");
  if (moist !== undefined) {
    const r = parseClimateRange(moist, MOISTURE_WORDS);
    if (r.range && !isAll(r.range)) c.moisture = r.range;
    if (r.problem) problems.push({ key: "moisture", text: r.problem });
  }
  const elev = fm.get("elevation")?.trim().toLowerCase();
  if (elev) {
    const e = ELEVATION_ALIASES[elev];
    if (e) c.elevation = e;
    else problems.push({ key: "elevation", text: `elevation should be sea, low, mid, high or mouth, not "${elev}"` });
  }
  const coastal = fm.get("coastal");
  if (coastal) {
    const v = readYesNoWord(coastal);
    if (v === undefined) problems.push({ key: "coastal", text: `coastal should be yes or no, not "${coastal}"` });
    else if (v) c.coastal = true;
  }
  const chance = fm.get("chance");
  if (chance) {
    const v = readChance(chance);
    if (Number.isFinite(v)) { if (v < 1) c.chance = v; }
    else problems.push({ key: "chance", text: `chance should be a share like 50%, not "${chance}"` });
  }
  const rare = fm.get("rare");
  if (rare) {
    const v = readYesNoWord(rare);
    if (v === undefined) problems.push({ key: "rare", text: `rare should be yes or no, not "${rare}"` });
    else if (v) c.rare = true;
  }
  return { climate: Object.keys(c).length ? c : undefined, problems };
}

/** The climate keys' values as written (undefined = not written). */
export function climateKeyValues(c: BiomeClimate | undefined): [string, string | undefined][] {
  return [
    ["temperature", c?.temperature && !isAll(c.temperature) ? formatClimateRange(c.temperature, TEMPERATURE_WORDS) : undefined],
    ["moisture", c?.moisture && !isAll(c.moisture) ? formatClimateRange(c.moisture, MOISTURE_WORDS) : undefined],
    ["elevation", c?.elevation],
    ["coastal", c?.coastal ? "yes" : undefined],
    ["chance", c?.chance !== undefined && c.chance < 1 ? `${fmtNum(c.chance * 100)}%` : undefined],
    ["rare", c?.rare ? "yes" : undefined],
  ];
}

/** Whether a written climate value reads the same as another (keeps the user's spelling). */
export function sameClimateValue(key: string, cur: string, want: string): boolean {
  const one = (v: string) => {
    const m = new Map([[key, v]]);
    return JSON.stringify(climateKeyValues(readClimate(m).climate));
  };
  return one(cur) === one(want);
}

/** Whether the generator may place this biome (any placement key set). */
export function isPlaceable(c: BiomeClimate | undefined): boolean {
  return !!c && (c.temperature !== undefined || c.moisture !== undefined || c.elevation !== undefined || !!c.coastal);
}

/** Whether a value lies in a range (the top end counts at 1). */
export function inClimateRange(r: ClimateRange | undefined, v: number): boolean {
  if (!r) return true;
  return v >= r.lo && (v < r.hi || (r.hi >= 1 - 1e-9 && v <= 1));
}

/** Area of a climate's temperature × moisture box (1 = any climate). */
export function climateArea(c: BiomeClimate): number {
  const span = (r?: ClimateRange) => (r ? Math.max(0, r.hi - r.lo) : 1);
  return span(c.temperature) * span(c.moisture);
}

/** The middle of a climate's box. */
export function climateCentre(c: BiomeClimate): [number, number] {
  const mid = (r?: ClimateRange) => (r ? (r.lo + r.hi) / 2 : 0.5);
  return [mid(c.temperature), mid(c.moisture)];
}

/** A copy (callers may change it). */
export function copyClimate(c: BiomeClimate | undefined): BiomeClimate | undefined {
  if (!c) return undefined;
  const out: BiomeClimate = { ...c };
  if (c.temperature) out.temperature = { ...c.temperature };
  if (c.moisture) out.moisture = { ...c.moisture };
  return out;
}

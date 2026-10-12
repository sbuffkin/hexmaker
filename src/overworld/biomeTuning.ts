/**
 * Per-biome generator tuning (owner request 2026-10-12: "make sure all the
 * major generator settings are available … so i can hand tune whichever
 * biomes we are putting on offer"). Every constant that shapes a blend-field
 * region, plus the WFC engine knobs for a biome that links a generator, is a
 * parameter here with today's value as its default.
 *
 * Stored in the biome's note as a readable table, only the values that
 * differ from the default:
 *
 *   ## Tuning
 *
 *   | Setting | Value | Default |
 *   | --- | ---: | ---: |
 *   | Smoothing passes | 3 | 2 |
 *   | Border wiggle | 0.35 | 0.2 |
 *
 * Reading is forgiving: a setting is found by its label or its key (any
 * case, spaces or dashes), values like `0.35`, `35%` or `3`; the Default
 * column is only for the reader. A value out of range is clamped and
 * reported; a row that names no setting is reported and kept in the note as
 * written.
 *
 * With nothing set, generation is exactly what it was before tuning existed
 * (tests/biomeTuning.test.ts holds snapshots taken before it was wired in).
 *
 * Pure: no Obsidian imports.
 */

import { DEFAULT_SETTINGS } from "../../packages/hex-wfc/src/model";

/** The Debug sub-sections the biome page shows, in order. */
export const TUNING_SECTIONS = ["Layout", "Borders & transitions", "Water & islands", "Patches & detail", "Engine"] as const;
export type TuningSection = (typeof TUNING_SECTIONS)[number];

/** WFC engine settings a biome may override for its generator (GeneratorSettings field names). */
export type EngineField =
  | "neighbourInfluence"
  | "frequencyFeedback"
  | "featureSize"
  | "scatter"
  | "randomness"
  | "edgeSmoothing"
  | "speckSize"
  | "keepRare"
  | "edgeStrength"
  | "directionalBias";

export interface TuningParam {
  /** Stable key (also accepted in the note's Setting column). */
  key: string;
  /** What the note's Setting column and the page say. */
  label: string;
  section: TuningSection;
  /**
   * Today's value. For `inherits` params it's only shown (the value used
   * when unset comes from elsewhere: the Blend width, the generator).
   */
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  /**
   * Unset means "use something else" (the biome's Blend width, the
   * generator's own setting), so any set value is written, even one equal
   * to `default`.
   */
  inherits?: boolean;
  /** The generator setting an Engine param overrides. */
  engine?: EngineField;
  /** One short line for the page. */
  help: string;
}

/**
 * Every tunable parameter. Defaults are the constants generation used
 * before tuning (file:line in the comments).
 */
export const TUNING_PARAMS: readonly TuningParam[] = [
  // ── Layout: how the influence field spreads (blendField.ts) ──
  { key: "reach", label: "Influence reach", section: "Layout", default: 2, min: 1, max: 4, step: 0.25, help: "How far a biome's influence reaches, in regions (blendField CUTOFF)." },
  { key: "wiggle-scale", label: "Wiggle scale", section: "Layout", default: 1.4, min: 0.25, max: 5, step: 0.05, help: "Bumps per region in the border wiggle (higher: tighter wiggles)." },
  { key: "halo", label: "Edge look-ahead", section: "Layout", default: 2, min: 0, max: 5, step: 1, integer: true, help: "Cells past the region's edge smoothed with it, so its edge leans toward what's next door." },
  // ── Borders & transitions ──
  { key: "blend-k", label: "Blend falloff", section: "Borders & transitions", default: 3.5, min: 0.5, max: 20, step: 0.25, inherits: true, help: "Exact falloff of the blend into neighbours (narrow 6, normal 3.5, wide 2). Unset: the Blend width." },
  { key: "wiggle", label: "Border wiggle", section: "Borders & transitions", default: 0.2, min: 0, max: 0.6, step: 0.05, help: "How far borders between biomes wander, in regions (0: straight seams)." },
  { key: "name-sharpness", label: "Terrain pick sharpness", section: "Borders & transitions", default: 2, min: 0.5, max: 6, step: 0.5, help: "Where biomes mix, how strongly the main biome picks which terrain of a type is used." },
  // ── Water & islands (regionGen.ts placeIslands / placeShore) ──
  { key: "island-max", label: "Largest island", section: "Water & islands", default: 0.25, min: 0.02, max: 1, step: 0.01, help: "Largest share of the region one island may cover (split between min islands)." },
  { key: "island-edge", label: "Islands at the edge", section: "Water & islands", default: 0.3, min: 0, max: 1, step: 0.05, help: "How readily islands start next to the region's edge (1: as readily as inside)." },
  { key: "beach", label: "Beach cover", section: "Water & islands", default: 0.6, min: 0, max: 1, step: 0.05, help: "Share of an island's shore the beach ring covers." },
  { key: "coast-width", label: "Coast band width", section: "Water & islands", default: 1, min: 1, max: 4, step: 1, integer: true, help: "Shore biomes: how many cells deep the coast and shallows bands are." },
  { key: "shore-lean", label: "Shore lean", section: "Water & islands", default: 1.6, min: 0, max: 6, step: 0.1, help: "Shore biomes: how sharply land turns toward the land-heavy neighbours." },
  { key: "shore-ragged", label: "Coastline raggedness", section: "Water & islands", default: 0.12, min: 0, max: 0.5, step: 0.01, help: "Shore biomes: noise on the coastline." },
  // ── Patches & detail (regionGen.ts generateRegion / placePatches) ──
  { key: "smoothing", label: "Smoothing passes", section: "Patches & detail", default: 2, min: 0, max: 8, step: 1, integer: true, help: "Passes that pull each cell toward the terrain types around it (0: speckled)." },
  { key: "field-hold", label: "Field hold", section: "Patches & detail", default: 1.5, min: 0, max: 6, step: 0.1, help: "How strongly the biome mix holds a cell against its neighbours while smoothing." },
  { key: "patch-size", label: "Min patch size", section: "Patches & detail", default: 1, min: 0.25, max: 4, step: 0.25, help: "Size of the patches Min patches adds, times the type's share." },
  { key: "patch-max", label: "Largest patch", section: "Patches & detail", default: 0.25, min: 0.02, max: 1, step: 0.01, help: "Largest share of the region one added patch may cover." },
  { key: "patch-edge", label: "Patches at the edge", section: "Patches & detail", default: 0.3, min: 0, max: 1, step: 0.05, help: "How readily added patches start next to the region's edge." },
  // ── Engine: WFC knobs for a biome that links a generator (unset: the generator's own) ──
  { key: "clumping", label: "Clumping", section: "Engine", default: DEFAULT_SETTINGS.neighbourInfluence, min: 0, max: 10, step: 0.5, inherits: true, engine: "neighbourInfluence", help: "How strongly decided neighbours steer each choice." },
  { key: "mix-strength", label: "Mix strength", section: "Engine", default: DEFAULT_SETTINGS.frequencyFeedback, min: 0, max: 10, step: 0.5, inherits: true, engine: "frequencyFeedback", help: "How hard the overall mix is pulled toward the weights." },
  { key: "feature-size", label: "Feature size", section: "Engine", default: DEFAULT_SETTINGS.featureSize, min: 0, max: 4, step: 0.1, inherits: true, engine: "featureSize", help: "Multiplier on learned patch sizes (0: no growth)." },
  { key: "scatter", label: "Scatter", section: "Engine", default: DEFAULT_SETTINGS.scatter, min: 0, max: 10, step: 0.5, inherits: true, engine: "scatter", help: "Randomness in which hex is decided next." },
  { key: "randomness", label: "Randomness", section: "Engine", default: DEFAULT_SETTINGS.randomness, min: 0, max: 1, step: 0.05, inherits: true, engine: "randomness", help: "Share of choices made by weight alone." },
  { key: "edge-smoothing", label: "Edge smoothing", section: "Engine", default: DEFAULT_SETTINGS.edgeSmoothing, min: 0, max: 1, step: 0.05, inherits: true, engine: "edgeSmoothing", help: "Trim one-hex bumps and notches on patch edges." },
  { key: "speck-size", label: "Remove specks up to", section: "Engine", default: DEFAULT_SETTINGS.speckSize, min: 0, max: 10, step: 1, integer: true, inherits: true, engine: "speckSize", help: "Remove patches of this many hexes or fewer." },
  { key: "keep-rare", label: "Keep rare", section: "Engine", default: DEFAULT_SETTINGS.keepRare, min: 0, max: 0.2, step: 0.01, inherits: true, engine: "keepRare", help: "Terrains rarer than this share are never smoothed away." },
  { key: "edge-strength", label: "Edge strength", section: "Engine", default: DEFAULT_SETTINGS.edgeStrength, min: 0, max: 1, step: 0.05, inherits: true, engine: "edgeStrength", help: "How strongly the border follows the learned edge terrain." },
  { key: "directional-bias", label: "Directional bias", section: "Engine", default: DEFAULT_SETTINGS.directionalBias, min: 0, max: 1, step: 0.05, inherits: true, engine: "directionalBias", help: "Keep terrain where it sat in the example." },
];

/** Set values by param key (only the set ones). */
export type BiomeTuning = Record<string, number>;

const squash = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
const BY_NAME = new Map<string, TuningParam>();
for (const p of TUNING_PARAMS) {
  BY_NAME.set(squash(p.key), p);
  BY_NAME.set(squash(p.label), p);
}

/** A param by key or label (any case, spaces or dashes). */
export function tuningParam(name: string): TuningParam | undefined {
  return BY_NAME.get(squash(name));
}

export const paramsIn = (section: TuningSection): TuningParam[] => TUNING_PARAMS.filter((p) => p.section === section);

/** Clamp (and round, for whole-number params) a value into a param's range. */
export function clampTuning(p: TuningParam, v: number): number {
  const c = Math.min(p.max, Math.max(p.min, v));
  return p.integer ? Math.round(c) : c;
}

/** Is `v` the param's default (so it isn't written)? Never for `inherits` params. */
export function isDefaultValue(p: TuningParam, v: number): boolean {
  return !p.inherits && Math.abs(v - p.default) < 1e-9;
}

/** The value generation uses: the tuned one, else the param's default. */
export function tuned(t: BiomeTuning | undefined, key: string): number {
  const p = tuningParam(key);
  if (!p) throw new Error(`No tuning param ${key}`);
  const v = t?.[p.key];
  return v !== undefined && Number.isFinite(v) ? v : p.default;
}

/** The tuned value, or undefined when unset (for `inherits` params). */
export function tunedOrUnset(t: BiomeTuning | undefined, key: string): number | undefined {
  const p = tuningParam(key);
  const v = p ? t?.[p.key] : undefined;
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/** A tuning with default values dropped (what's written). Undefined when nothing is left. */
export function cleanTuning(t: BiomeTuning | undefined): BiomeTuning | undefined {
  if (!t) return undefined;
  const out: BiomeTuning = {};
  for (const p of TUNING_PARAMS) {
    const v = t[p.key];
    if (v === undefined || !Number.isFinite(v) || isDefaultValue(p, v)) continue;
    out[p.key] = clampTuning(p, v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** How many params are set (the page's "· N set"). */
export function tuningCount(t: BiomeTuning | undefined, section?: TuningSection): number {
  const c = cleanTuning(t);
  if (!c) return 0;
  return Object.keys(c).filter((k) => !section || tuningParam(k)?.section === section).length;
}

/** The generator settings a biome's Engine tuning overrides. */
export function engineOverrides(t: BiomeTuning | undefined): Partial<Record<EngineField, number>> {
  const out: Partial<Record<EngineField, number>> = {};
  for (const p of TUNING_PARAMS) {
    if (!p.engine) continue;
    const v = tunedOrUnset(t, p.key);
    if (v !== undefined) out[p.engine] = clampTuning(p, v);
  }
  return out;
}

// ── the note's table ─────────────────────────────────────────────────────

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** The Tuning table's lines for a tuning (only set values; `kept` rows appended as written). */
export function tuningTable(t: BiomeTuning | undefined, kept: readonly string[] = []): string[] {
  const c = cleanTuning(t) ?? {};
  const rows = TUNING_PARAMS.filter((p) => c[p.key] !== undefined).map((p) => `| ${p.label} | ${fmt(c[p.key])} | ${p.inherits ? "—" : fmt(p.default)} |`);
  return ["| Setting | Value | Default |", "| --- | ---: | ---: |", ...rows, ...kept];
}

/** Headers of the Tuning table (lower-cased). */
export const isTuningHeader = (h: readonly string[]): boolean => h.includes("setting") && h.includes("value");

/** A value cell: "0.35", "35%", "3". NaN when unreadable. */
export function readTuningValue(raw: string): number {
  const t = raw.trim();
  if (!t) return NaN;
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").trim());
  return pct ? n / 100 : n;
}

export interface TuningRead {
  tuning?: BiomeTuning;
  /** Rows naming no setting (kept as written when the table is rewritten). */
  unknownRows: string[];
  problems: string[];
}

/**
 * Read the Tuning table's rows (`cells` per row, the raw line kept for
 * unknown ones). Forgiving: see the file comment.
 */
export function readTuningRows(rows: { cells: string[]; line: string; n: number }[], headers: readonly string[]): TuningRead {
  const si = headers.indexOf("setting"), vi = headers.indexOf("value");
  const out: BiomeTuning = {};
  const unknownRows: string[] = [];
  const problems: string[] = [];
  for (const r of rows) {
    const name = (r.cells[si] ?? "").trim();
    const raw = (r.cells[vi] ?? "").trim();
    if (!name && !raw) continue;
    const p = tuningParam(name);
    if (!p) {
      problems.push(`row ${r.n}: no setting called "${name}"`);
      unknownRows.push(r.line);
      continue;
    }
    if (!raw || raw === "—" || raw === "-") continue;
    const v = readTuningValue(raw);
    if (!Number.isFinite(v)) {
      problems.push(`row ${r.n}: ${p.label} "${raw}" isn't a number`);
      continue;
    }
    const c = clampTuning(p, v);
    if (Math.abs(c - v) > 1e-9) problems.push(`row ${r.n}: ${p.label} ${raw} is outside ${fmt(p.min)}–${fmt(p.max)}, using ${fmt(c)}`);
    out[p.key] = c;
  }
  return { ...(Object.keys(out).length ? { tuning: out } : {}), unknownRows, problems };
}

/** Same tuning (written values) on both sides. */
export function sameTuning(a: BiomeTuning | undefined, b: BiomeTuning | undefined): boolean {
  return JSON.stringify(cleanTuning(a) ?? {}) === JSON.stringify(cleanTuning(b) ?? {});
}

/** Blend two tunings: `w` of `b` and 1 − w of `a`, per param (unset = the default; whole-number params rounded). */
export function blendTuning(a: BiomeTuning | undefined, b: BiomeTuning | undefined, w: number): BiomeTuning | undefined {
  const out: BiomeTuning = {};
  for (const p of TUNING_PARAMS) {
    const va = tunedOrUnset(a, p.key), vb = tunedOrUnset(b, p.key);
    if (va === undefined && vb === undefined) continue;
    if (p.inherits && (va === undefined || vb === undefined)) {
      // Nothing to mix with: keep what's set.
      out[p.key] = (va ?? vb)!;
      continue;
    }
    out[p.key] = clampTuning(p, (1 - w) * (va ?? p.default) + w * (vb ?? p.default));
  }
  return cleanTuning(out);
}

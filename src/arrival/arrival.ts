/**
 * Roll on arrival (plan-tables-everywhere phase 4: SP4, SP5, GM4, T5).
 *
 * - A world is set to make places on arrival with the map note key
 *   `on-arrival: make places` (Map properties), inherited down the map
 *   tree; unset everywhere = off, and then nothing here ever runs.
 * - Seeds depend only on stored values: the parent map's `seed:`, the hex
 *   and a purpose (and the reroll count), never on map names.
 * - A place's setup (SP4, no form) comes from, field by field: the rolled
 *   row's attributes (Size, Generator, Options, Palette, Base), then the
 *   palette's Submap defaults for the terrain, then the engine's defaults.
 * - What was rolled is written as plain text in the new map's note
 *   (`## Arrival`), so it can be read and edited like any note.
 *
 * Pure: no Obsidian imports.
 */

import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { generatorRefId, readGenerator, readOptions, readSize } from "../worldgen/cellReaders";
import type { SubmapDefault } from "../types";

// ── the setting ──────────────────────────────────────────────────────────

export type ArrivalMode = "off" | "make";

/** How the setting is written in the map note. */
export const ARRIVAL_MODE_WORDS: Record<ArrivalMode, string> = { off: "off", make: "make places" };

/** The choices as shown in Map properties. */
export const ARRIVAL_MODE_TEXT: Record<ArrivalMode, string> = {
  off: "Do nothing (make places in Build)",
  make: "Make the place, in any mode",
};

/** `on-arrival:` read forgivingly ("make places", "make", "generate", "yes" / "off", "no", "nothing"); unknown → undefined. */
export function parseArrivalMode(raw: unknown): ArrivalMode | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (/^(make|generate|create|yes|on|true)\b/.test(t)) return "make";
  if (/^(off|no|none|nothing|false|do nothing)\b/.test(t)) return "off";
  return undefined;
}

/** The setting for a map: its own, else the nearest map above it's, else off. */
export function effectiveArrivalMode(
  mapName: string,
  modeOf: (map: string) => string | undefined,
  parentOf: (map: string) => string | undefined,
): { mode: ArrivalMode; from?: string } {
  const seen = new Set<string>();
  for (let m: string | undefined = mapName; m && !seen.has(m); m = parentOf(m)) {
    seen.add(m);
    const mode = parseArrivalMode(modeOf(m));
    if (mode) return { mode, from: m };
  }
  return { mode: "off" };
}

// ── seeds ────────────────────────────────────────────────────────────────

/** A 32-bit hash of the parts (FNV-1a over their text). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const text = parts.map(String).join("\u0000");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type SeedPurpose = "arrival" | "submap" | "place";

/**
 * The seed of something under hex `hex` of a map whose seed is
 * `parentSeed`: "arrival" (its On arrival roll), "submap" (generating the
 * place, `reroll` times rerolled), "place" (the new map's own seed).
 */
export function arrivalSeed(parentSeed: number, hex: string, purpose: SeedPurpose, reroll = 0): number {
  return hashSeed(parentSeed >>> 0, hex, purpose, reroll);
}

// ── the place's setup (SP4) ──────────────────────────────────────────────

export interface PlaceSetup {
  palette: string;
  cols: number;
  rows: number;
  /** Generator id (registry). */
  generator: string;
  options: Record<string, string>;
  baseTerrain?: string;
  /** Where each part came from, for the write-up. */
  from: Record<"palette" | "size" | "generator" | "options" | "base", "row" | "defaults" | "engine">;
}

/** The engine's defaults, worked out by the caller for a palette. */
export interface EngineDefaults {
  palette: string;
  cols: number;
  rows: number;
  /** The generator for this palette and terrain (submapStartKind). */
  generatorFor: (palette: string) => string;
  baseFor: (palette: string) => string | undefined;
}

const unlinkName = (s: string) => (/\[\[([^\]|#]+)/.exec(s)?.[1] ?? s).trim().replace(/\.md$/i, "").replace(/^.*\//, "");

/**
 * The setup for a place made on arrival, field by field: the rolled row's
 * attributes, then the palette's Submap defaults, then the engine's.
 * A Size range is rolled from `seed`. Options merge (the row's win).
 */
export function placeSetup(
  attrs: Record<string, string> | undefined,
  saved: SubmapDefault | undefined,
  engine: EngineDefaults,
  seed: number,
): PlaceSetup {
  const a = attrs ?? {};
  const from = {} as PlaceSetup["from"];
  const pick = <T>(key: keyof PlaceSetup["from"], row: T | undefined, def: T | undefined, eng: T): T => {
    if (row !== undefined) { from[key] = "row"; return row; }
    if (def !== undefined) { from[key] = "defaults"; return def; }
    from[key] = "engine";
    return eng;
  };
  const palette = pick("palette", a.Palette?.trim() ? unlinkName(a.Palette) : undefined, saved?.palette, engine.palette);

  const sizeRange = a.Size ? readSize(a.Size) : undefined;
  const rand = mulberry32(seed >>> 0);
  const rolled = sizeRange
    ? { cols: sizeRange.cols.lo + Math.floor(rand() * (sizeRange.cols.hi - sizeRange.cols.lo + 1)), rows: sizeRange.rows.lo + Math.floor(rand() * (sizeRange.rows.hi - sizeRange.rows.lo + 1)) }
    : undefined;
  const size = pick("size", rolled, saved?.cols && saved.rows ? { cols: saved.cols, rows: saved.rows } : undefined, { cols: engine.cols, rows: engine.rows });

  const gen = a.Generator ? readGenerator(a.Generator) : undefined;
  const generator = pick("generator", gen ? generatorRefId(gen) : undefined, saved?.generator, engine.generatorFor(palette));

  const rowOptions = a.Options ? readOptions(a.Options) : undefined;
  const hasRow = !!rowOptions && Object.keys(rowOptions).length > 0;
  const hasSaved = !!saved?.options && Object.keys(saved.options).length > 0;
  const options = pick("options", hasRow ? { ...(saved?.options ?? {}), ...rowOptions } : undefined, hasSaved ? { ...saved?.options } : undefined, {});

  const base = pick("base", a.Base?.trim() || undefined, saved?.baseTerrain === "" ? undefined : saved?.baseTerrain, engine.baseFor(palette));
  const out: PlaceSetup = { palette, cols: size.cols, rows: size.rows, generator, options, from };
  if (base) out.baseTerrain = base;
  return out;
}

// ── the write-up ─────────────────────────────────────────────────────────

export interface ArrivalReport {
  /** The date (YYYY-MM-DD). */
  date: string;
  /** The parent map's note link target (`_the-drift`), and the hex as people write it (`4, 7`). */
  parentNote: string;
  hex: string;
  /** The On arrival roll, when there was one: the table, what came up, and the chain ("Unexplored sector → Mainworlds → ocean world"). */
  rolled?: { table: string; result: string; chain: string };
  /** The hex's terrain once known. */
  terrain?: string;
  /** "Orbits", the palette, the size and the seed. */
  made: { generator: string; palette: string; cols: number; rows: number; seed: number };
  rerolls?: number;
  locked?: boolean;
  /**
   * More lines from arrival rules. Seam: module arrival rules (plan-
   * generator-modules §4.4) add their rolls here.
   */
  extra?: string[];
}

export const ARRIVAL_HEADING = "## Arrival";

/** The `## Arrival` section's lines (heading included): plain text. */
export function arrivalLines(r: ArrivalReport): string[] {
  const lines = [
    ARRIVAL_HEADING,
    "",
    `First visited ${r.date}, from [[${r.parentNote}]] hex ${r.hex}.`,
    "",
  ];
  if (r.rolled) lines.push(`- Rolled on [[${r.rolled.table.replace(/\.md$/i, "")}]]: ${r.rolled.result} (${r.rolled.chain}).`);
  else if (r.terrain) lines.push(`- The hex was ${r.terrain}.`);
  lines.push(`- Made with ${r.made.generator} on ${r.made.palette}, ${r.made.cols}×${r.made.rows}, seed ${r.made.seed}.`);
  for (const e of r.extra ?? []) lines.push(`- ${e}`);
  if (r.rerolls) lines.push(`- Rerolled ${r.rerolls === 1 ? "once" : `${r.rerolls} times`}.`);
  lines.push(r.locked
    ? "- Locked: rerolling it now needs God mode."
    : "- Not locked yet: Reroll above the map makes it again; Lock keeps it.");
  return lines;
}

/**
 * The note with its `## Arrival` section set to `lines`: an existing one
 * (up to the next `## ` heading) is replaced, else the section goes at
 * the end. Everything else stays as it was.
 */
export function withArrivalSection(content: string, lines: readonly string[]): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const all = content.replace(/\r\n?/g, "\n").split("\n");
  const start = all.findIndex((l) => l.trim().toLowerCase() === ARRIVAL_HEADING.toLowerCase());
  if (start >= 0) {
    let end = start + 1;
    while (end < all.length && !/^#{1,2}\s/.test(all[end])) end++;
    // Keep one blank line before the next heading.
    const next = [""];
    all.splice(start, end - start, ...lines, ...next);
    return all.join(eol);
  }
  while (all.length && all[all.length - 1].trim() === "") all.pop();
  return [...all, "", ...lines, ""].join(eol);
}

const STATUS_LINE = /^- (?:Made with |Rerolled |Locked|Not locked yet)/;

/**
 * The `## Arrival` section after a reroll or a lock: its "Made with",
 * "Rerolled" and lock lines are written again (`made` only when given);
 * every other line stays as it was. Unchanged when there's no section.
 */
export function restateArrival(content: string, s: { made?: ArrivalReport["made"]; rerolls: number; locked: boolean }): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const all = content.replace(/\r\n?/g, "\n").split("\n");
  const start = all.findIndex((l) => l.trim().toLowerCase() === ARRIVAL_HEADING.toLowerCase());
  if (start < 0) return content;
  let end = start + 1;
  while (end < all.length && !/^#{1,2}\s/.test(all[end])) end++;
  const section = all.slice(start + 1, end);
  const made = section.find((l) => l.startsWith("- Made with "));
  const kept = section.filter((l) => !STATUS_LINE.test(l));
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const status = arrivalLines({ date: "", parentNote: "", hex: "", made: s.made ?? { generator: "", palette: "", cols: 0, rows: 0, seed: 0 }, rerolls: s.rerolls, locked: s.locked })
    .filter((l) => STATUS_LINE.test(l))
    .map((l) => (l.startsWith("- Made with ") && !s.made ? made ?? "" : l))
    .filter((l) => l !== "");
  const next = [""];
  all.splice(start + 1, end - start - 1, ...kept, ...status, ...next);
  return all.join(eol);
}

/** One line for a notice. */
export function arrivalSummary(place: string, r: Pick<ArrivalReport, "rolled" | "made">): string {
  const rolled = r.rolled ? `${r.rolled.result}. ` : "";
  return `Arrived at ${place}: ${rolled}Made with ${r.made.generator}, ${r.made.cols}×${r.made.rows}.`;
}

/**
 * A row's attributes as a submap setup (the palette's Submap defaults
 * shape), for Build's "New map from this hex…" form to start from. The
 * smallest size of a range.
 */
export function rowSubmapDefault(attrs: Record<string, string> | undefined): SubmapDefault | undefined {
  if (!attrs) return undefined;
  const out: SubmapDefault = {};
  if (attrs.Palette?.trim()) out.palette = unlinkName(attrs.Palette);
  const size = attrs.Size ? readSize(attrs.Size) : undefined;
  if (size) { out.cols = size.cols.lo; out.rows = size.rows.lo; }
  const gen = attrs.Generator ? readGenerator(attrs.Generator) : undefined;
  if (gen) out.generator = generatorRefId(gen);
  const opts = attrs.Options ? readOptions(attrs.Options) : undefined;
  if (opts && Object.keys(opts).length) out.options = opts;
  if (attrs.Base?.trim()) out.baseTerrain = attrs.Base.trim();
  return Object.keys(out).length ? out : undefined;
}

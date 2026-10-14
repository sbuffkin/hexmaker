/**
 * Exploring (plan-hex-flower): what fills a blank hex when the party walks
 * into it. A map's `explore-with:` lists rules, one per source:
 *
 *   explore-with:
 *     - "[[Wilds]] -> terrain"
 *     - "[[Ruins]] -> Features"
 *     - "[[Weather]] -> play log, every step"
 *
 * `<link> [-> | → | into] <target>[, every step]`. The link is a hex flower
 * note or a random table. Targets: terrain, name, icon, a hex note
 * section (Features, Description…), play log, on arrival. No target: by
 * what came up (EXPLORE_DEFAULTS). Rules run top to bottom; each sees what
 * the ones before it decided (its tables' When `terrain`, and `from`: the
 * terrain of the hex the party came from).
 *
 * Never overwrites: a target is written only while it's empty, and a
 * locked hex gets nothing. "every step" rules roll on every step (blank
 * hex or not), e.g. weather into the play log.
 *
 * Seeds: from the map's seed, the hex, the rule and the hex the party came
 * from, so the same walk fills the same way; Reroll adds 1.
 *
 * Where a flower's walk stands: the map is the memory. The stored cell if
 * it shows the terrain of the hex being left; else the cell showing that
 * terrain nearest to it; else the stored cell; else the start. Flowers that
 * don't set terrain (weather) use the stored cell only.
 *
 * Pure: no Obsidian imports.
 */

import { hashSeed } from "../arrival/arrival";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { CENTRE, cellDistance, cellsShowing, isBlocked, isCell, step, type Flower, type Move } from "./flower";

// ── rules ────────────────────────────────────────────────────────────────

export type ExploreTarget =
  | { kind: "terrain" }
  | { kind: "name" }
  | { kind: "icon" }
  | { kind: "section"; section: string }
  | { kind: "log" }
  | { kind: "arrival" };

export interface ExploreRule {
  /** The link as written, without brackets ("Wilds", "tables/Weather"). */
  source: string;
  /** Unset: by what came up (EXPLORE_DEFAULTS). */
  target?: ExploreTarget;
  every: boolean;
  /** The rule as written. */
  raw: string;
}

/** What a result kind fills when its rule names no target. One place to change it. */
export const EXPLORE_DEFAULTS: Readonly<Record<RolledKind, ExploreTarget>> = {
  terrain: { kind: "terrain" },
  note: { kind: "section", section: "Features" },
  text: { kind: "section", section: "Description" },
};

/** Which hexes a step fills: just the one entered (default) or its blank neighbours too. */
export type Reveal = "entered" | "neighbours";
export const DEFAULT_REVEAL: Reveal = "entered";

export function parseReveal(raw: string | undefined): Reveal {
  return /neighbou?rs?|around|all/i.test(raw ?? "") ? "neighbours" : DEFAULT_REVEAL;
}

const ARROW = /\s*(?:->|→|=>|\binto\b|\bto\b)\s*/i;
const EVERY = /,?\s*\b(?:every|each)\s+(?:step|move|turn)\b\s*$/i;

/** The link target in `raw` (`[[a|b]]` → a; a plain name as is). */
export function linkTarget(raw: string): string {
  const m = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(raw);
  return (m ? m[1] : raw).trim().replace(/^["']|["']$/g, "").replace(/\.md$/i, "").trim();
}

/** A target word → a target (undefined: not one). `sections` are the hex note's section names. */
export function parseTarget(raw: string, sections: readonly string[] = []): ExploreTarget | undefined {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return undefined;
  if (/^terrains?$/.test(t)) return { kind: "terrain" };
  if (/^(hex )?names?$/.test(t)) return { kind: "name" };
  if (/^icons?$/.test(t)) return { kind: "icon" };
  if (/^(the )?(play )?log$|^journal$/.test(t)) return { kind: "log" };
  if (/^on[- ]?arrival$|^arrival$/.test(t)) return { kind: "arrival" };
  const section = sections.find((s) => s.toLowerCase() === t) ?? raw.trim().replace(/^#+\s*/, "");
  return { kind: "section", section };
}

/** One `explore-with` entry → a rule, or why it can't be read. */
export function parseRule(raw: string, sections: readonly string[] = []): ExploreRule | { error: string; raw: string } {
  let text = raw.trim();
  if (!text) return { error: "empty", raw };
  const every = EVERY.test(text);
  if (every) text = text.replace(EVERY, "").trim();
  // The link part ends at the arrow (or is the whole entry).
  const linkEnd = /\]\]/.exec(text);
  let linkPart = text;
  let targetPart = "";
  if (linkEnd) {
    linkPart = text.slice(0, linkEnd.index + 2);
    targetPart = text.slice(linkEnd.index + 2).replace(/^\s*(?:->|→|=>|\binto\b|\bto\b)?\s*/i, "");
  } else {
    const parts = text.split(ARROW);
    linkPart = parts[0];
    targetPart = parts.slice(1).join(" ");
  }
  const source = linkTarget(linkPart);
  if (!source) return { error: "no flower or table named", raw };
  const target = targetPart.trim() ? parseTarget(targetPart, sections) : undefined;
  return { source, ...(target ? { target } : {}), every, raw };
}

/** A rule back as text (for writing a new map's `explore-with`). */
export function formatRule(rule: Pick<ExploreRule, "source" | "target" | "every">): string {
  const t = rule.target;
  const target = !t ? "" : t.kind === "section" ? t.section : t.kind === "log" ? "play log" : t.kind === "arrival" ? "on arrival" : t.kind;
  return `[[${rule.source}]]${target ? ` -> ${target}` : ""}${rule.every ? ", every step" : ""}`;
}

/** Every readable rule of a map's `explore-with` (unreadable ones are skipped). */
export function readRules(list: readonly string[] | undefined, sections: readonly string[] = []): ExploreRule[] {
  return (list ?? []).map((r) => parseRule(r, sections)).filter((r): r is ExploreRule => !("error" in r));
}

// ── positions ────────────────────────────────────────────────────────────

/** `hex-flower-at` → flower name (lower case) → cell. Junk is skipped. */
export function parseFlowerAt(list: readonly string[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of list ?? []) {
    const m = /^(.*?)\s*[:=]\s*(\d+)\s*$/.exec(String(item));
    if (!m) continue;
    const cell = Number(m[2]);
    const name = linkTarget(m[1]).toLowerCase();
    if (name && isCell(cell)) out.set(name, cell);
  }
  return out;
}

/** Positions back as `hex-flower-at` entries, keeping each flower's name as given. */
export function formatFlowerAt(at: ReadonlyMap<string, number>, names: ReadonlyMap<string, string> = new Map()): string[] {
  return [...at].map(([k, cell]) => `${names.get(k) ?? k}: ${cell}`);
}

/** Where a flower's walk starts for a step (see the top of this file). */
export function startCell(flower: Flower, stored: number | undefined, fromTerrain: string | undefined, setsTerrain: boolean): number {
  const start = isCell(flower.start) && !isBlocked(flower.cells[flower.start - 1]?.result ?? "") ? flower.start : CENTRE;
  const here = stored !== undefined && isCell(stored) ? stored : undefined;
  if (!setsTerrain || !fromTerrain) return here ?? start;
  const showing = cellsShowing(flower, fromTerrain);
  if (here !== undefined && showing.includes(here)) return here;
  if (showing.length) {
    const near = here ?? start;
    return [...showing].sort((a, b) => cellDistance(a, near) - cellDistance(b, near) || a - b)[0];
  }
  return here ?? start;
}

// ── results ──────────────────────────────────────────────────────────────

export type RolledKind = "terrain" | "note" | "text";

/** What a roll came up with (nothing: undefined). */
export interface Rolled {
  kind: RolledKind;
  /** The terrain (palette spelling), the note link target, or the text. */
  value: string;
}

/** A flower cell's result → what it gives (`table` when it names a table to roll through). */
export function classifyResult(
  result: string,
  terrains: readonly string[],
  isTable: (link: string) => boolean,
): Rolled | { kind: "table"; value: string } | undefined {
  const t = result.trim();
  if (!t || isBlocked(t) || /^\(?\s*nothing\s*\)?$/i.test(t)) return undefined;
  if (/\[\[[^\]]+\]\]/.test(t)) {
    const link = linkTarget(t);
    return isTable(link) ? { kind: "table", value: link } : { kind: "note", value: link };
  }
  const terrain = terrains.find((x) => x.toLowerCase() === t.toLowerCase());
  return terrain !== undefined ? { kind: "terrain", value: terrain } : { kind: "text", value: t };
}

/** A source a rule rolls on. */
export type ExploreSource =
  | { kind: "flower"; flower: Flower }
  | {
      kind: "table";
      /** Roll it (seeded), knowing the terrain decided so far and where the party came from. */
      roll(seed: number, known: { terrain?: string; from?: string }): Rolled | undefined;
    };

// ── planning a step ──────────────────────────────────────────────────────

/** What the entered hex already holds (only empty targets are written). */
export interface HexNow {
  terrain?: string;
  name?: string;
  icon?: string;
  locked?: boolean;
  onArrival?: string;
  /** Sections of its note that already have content (by name, any case). */
  filledSections?: readonly string[];
}

export interface PlanInput {
  rules: readonly ExploreRule[];
  /** The hex entered and the one left ("x_y"; from unset: rolled by hand). */
  hex: string;
  from?: string;
  /** The left hex's terrain. */
  fromTerrain?: string;
  now: HexNow;
  /** The map's seed. */
  seed: number;
  /** Reroll count (0 the first time). */
  reroll?: number;
  /** A count that grows each step, so "every step" rolls differ on a walk back and forth. */
  stepNo?: number;
  /** Only the "every step" rules (the hex isn't blank). */
  everyOnly?: boolean;
  /** Where each flower's walk stands (flower name, lower case → cell). */
  at: ReadonlyMap<string, number>;
  terrains: readonly string[];
  source: (link: string) => ExploreSource | undefined;
  /** A link names a table (a flower cell's [[table]] is rolled through). */
  isTable: (link: string) => boolean;
}

/** One thing a step writes. */
export interface PlannedWrite {
  target: ExploreTarget;
  value: string;
  kind: RolledKind;
  /** The rule (index into the rules) it came from. */
  rule: number;
}

/** A flower walked during the step. */
export interface PlannedMove {
  flower: string;
  from: number;
  to: number;
  move: Move;
  total?: number;
  rule: number;
}

export interface Plan {
  writes: PlannedWrite[];
  moves: PlannedMove[];
  /** Positions after the step (every flower's, changed or not). */
  at: Map<string, number>;
  /** Rules whose source wasn't found, and other notes for the report. */
  problems: string[];
}

/** The seed of rule `rule`'s roll for this step. */
export function ruleSeed(input: Pick<PlanInput, "seed" | "hex" | "from" | "reroll" | "stepNo">, rule: number, every: boolean): number {
  return hashSeed(input.seed >>> 0, input.hex, every ? "explore-step" : "explore", rule, input.from ?? "", input.reroll ?? 0, every ? input.stepNo ?? 0 : 0);
}

const sameTarget = (a: ExploreTarget, b: ExploreTarget) =>
  a.kind === b.kind && (a.kind !== "section" || (b.kind === "section" && a.section.toLowerCase() === b.section.toLowerCase()));

/** Whether target `t` is still empty on the hex (counting earlier writes of this plan). */
function isEmpty(t: ExploreTarget, now: HexNow, writes: readonly PlannedWrite[]): boolean {
  if (writes.some((w) => sameTarget(w.target, t)) && t.kind !== "log") return false;
  switch (t.kind) {
    case "terrain": return !now.terrain;
    case "name": return !now.name;
    case "icon": return !now.icon;
    case "arrival": return !now.onArrival;
    case "log": return true;
    case "section": return !(now.filledSections ?? []).some((s) => s.toLowerCase() === t.section.toLowerCase());
  }
}

/**
 * Plan what one step writes to the hex entered: each rule in order, its
 * flower walked (or table rolled), the result written to its target only
 * while that's empty. Locked hexes get nothing.
 */
export function planStep(input: PlanInput): Plan {
  const at = new Map(input.at);
  const plan: Plan = { writes: [], moves: [], at, problems: [] };
  if (input.now.locked) return plan;
  let terrain = input.now.terrain;
  input.rules.forEach((rule, i) => {
    if (input.everyOnly && !rule.every) return;
    const src = input.source(rule.source);
    if (!src) { plan.problems.push(`Nothing called "${rule.source}" to roll on.`); return; }
    // A rule whose (fixed) target is filled already has nothing to do.
    if (rule.target && !isEmpty(rule.target, input.now, plan.writes)) return;
    const seed = ruleSeed(input, i, rule.every);
    const known = { ...(terrain ? { terrain } : {}), ...(input.fromTerrain ? { from: input.fromTerrain } : {}) };
    let rolled: Rolled | undefined;
    if (src.kind === "flower") {
      const f = src.flower;
      const key = f.name.toLowerCase();
      const setsTerrain = (rule.target ?? { kind: "terrain" }).kind === "terrain";
      const from = startCell(f, at.get(key), input.fromTerrain, setsTerrain);
      const s = step(f, from, mulberry32(seed));
      at.set(key, s.cell);
      plan.moves.push({ flower: f.name, from, to: s.cell, move: s.move, ...(s.total !== undefined ? { total: s.total } : {}), rule: i });
      const c = classifyResult(f.cells[s.cell - 1]?.result ?? "", input.terrains, input.isTable);
      if (c?.kind === "table") {
        const inner = input.source(c.value);
        rolled = inner?.kind === "table" ? inner.roll(hashSeed(seed, "cell"), known) : undefined;
        if (!inner) plan.problems.push(`Cell ${s.cell} of ${f.name} names "${c.value}", which isn't a table.`);
      } else rolled = c;
    } else {
      rolled = src.roll(seed, known);
    }
    if (!rolled) return;
    const target = rule.target ?? EXPLORE_DEFAULTS[rolled.kind];
    // Terrain only from terrain results; a non-terrain into terrain is skipped.
    if (target.kind === "terrain" && rolled.kind !== "terrain") { plan.problems.push(`${rule.source}: "${rolled.value}" isn't a terrain of this palette.`); return; }
    if (!isEmpty(target, input.now, plan.writes)) return;
    plan.writes.push({ target, value: rolled.value, kind: rolled.kind, rule: i });
    if (target.kind === "terrain") terrain = rolled.value;
  });
  return plan;
}

/** The writes of a plan as a short line ("hills; Features: [[Old shrine]]"). */
export function describeWrites(writes: readonly PlannedWrite[]): string {
  return writes.map((w) => {
    const v = w.kind === "note" ? `[[${w.value}]]` : w.value;
    switch (w.target.kind) {
      case "terrain": return v;
      case "section": return `${w.target.section}: ${v}`;
      case "log": return `log: ${v}`;
      case "arrival": return `on arrival: ${v}`;
      default: return `${w.target.kind}: ${v}`;
    }
  }).join(". ");
}

/** "8 → down-left" for the notice. */
export function describeMove(m: Pick<PlannedMove, "total" | "move">): string {
  return `${m.total ?? "–"} → ${m.move}`;
}

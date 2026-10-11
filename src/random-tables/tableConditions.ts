/**
 * The `When` column of a random table (plan-tables-everywhere §2.8): an
 * escape hatch that limits a row to some contexts. Prefer one table per
 * context; use When for the rare row that only fits sometimes.
 *
 *   | d6 | Result | Weight | When |
 *   | 1–4 | gas giant | 4 | zone: outer |
 *   | 5 | ice moon | 1 | star: red dwarf, white dwarf; zone: outer |
 *   | 6 | hot jupiter | 1 | zone: inner; ring: 2–3 |
 *
 * - Conditions are `key: value`, separated by `;`. A comma lists choices
 *   (any of them fits). Every condition must fit.
 * - Keys: zone (inner, habitable, outer), ring (hexes from the star, like
 *   2–4), star (star terrains), type (terrain types), terrain (the parent
 *   hex's terrain), temperature (cold … hot, or 0.2–0.5).
 * - A key the roller doesn't know about here (no star, say) lets the row
 *   through, so a hand roll and the Tables view roll every row.
 * - An unknown key, or a value that can't be read, is reported and that
 *   row never fires.
 *
 * The rule a hand-roller follows: "if a row's When doesn't fit, roll
 * again". The code renormalises over the rows that fit, which is the same
 * distribution.
 *
 * Pure: no Obsidian imports.
 */

import { TEMPERATURE_WORDS, inClimateRange, parseClimateRange, type ClimateRange } from "../overworld/biomeClimate";
import { ORBIT_ZONES, readIntRange, readOrbit, type IntRange, type OrbitZone } from "../space/worldTypes";

export type TableCondition =
  | { key: "zone"; zones: OrbitZone[] }
  | { key: "ring"; range: IntRange }
  | { key: "star" | "type" | "terrain"; values: string[] }
  | { key: "temperature"; range: ClimateRange }
  /** Can't be read: the row never fires. */
  | { key: "unknown"; text: string };

/** What the roller knows where it rolls. Every field is optional. */
export interface ConditionContext {
  zone?: OrbitZone;
  /** Hexes from the star. */
  ring?: number;
  /** The system's star terrain. */
  star?: string;
  /** The terrain type being placed or the parent hex's type. */
  type?: string;
  /** The parent hex's terrain. */
  terrain?: string;
  /** 0 (cold) … 1 (hot). */
  temperature?: number;
}

export const CONDITION_KEYS = ["zone", "ring", "star", "type", "terrain", "temperature"] as const;

const lc = (s: string) => s.trim().toLowerCase();
const list = (raw: string) => raw.split(/\s*,\s*/).map(lc).filter((s) => s !== "");

/** One `key: value` → a condition (key "unknown" when it can't be read). */
function readCondition(part: string): TableCondition {
  const m = /^([a-z ]+?)\s*[:=]\s*(.+)$/i.exec(part.trim());
  if (!m) return { key: "unknown", text: part.trim() };
  const key = lc(m[1]).replace(/s$/, "");
  const value = m[2].trim();
  switch (key) {
    case "zone":
    case "orbit": {
      const o = readOrbit(value);
      if (!o || o.distance || !o.zones?.length) return { key: "unknown", text: part.trim() };
      return { key: "zone", zones: o.zones };
    }
    case "ring":
    case "distance": {
      const r = readIntRange(value);
      return r ? { key: "ring", range: r } : { key: "unknown", text: part.trim() };
    }
    case "star":
    case "type":
    case "terrain": {
      const values = list(value);
      return values.length ? { key, values } : { key: "unknown", text: part.trim() };
    }
    case "temperature":
    case "temp": {
      const r = parseClimateRange(value, TEMPERATURE_WORDS);
      return r.range && !r.problem ? { key: "temperature", range: r.range } : { key: "unknown", text: part.trim() };
    }
    default:
      return { key: "unknown", text: part.trim() };
  }
}

/** A When cell → its conditions (empty for a blank cell or "any"). */
export function parseWhen(raw: string): TableCondition[] {
  const t = raw.trim();
  if (!t || /^(any|always|-|—)$/i.test(t)) return [];
  return t.split(/\s*;\s*/).filter((p) => p !== "").map(readCondition);
}

/** The parts of a When cell that can't be read (reported; the row never fires). */
export function unreadableConditions(when: readonly TableCondition[]): string[] {
  return when.flatMap((c) => (c.key === "unknown" ? [c.text] : []));
}

/** Whether a row's conditions fit the context. Conditions the context can't speak to pass; unreadable ones never do. */
export function conditionsFit(when: readonly TableCondition[] | undefined, ctx: ConditionContext = {}): boolean {
  if (!when?.length) return true;
  for (const c of when) {
    switch (c.key) {
      case "unknown":
        return false;
      case "zone":
        if (ctx.zone && !c.zones.includes(ctx.zone)) return false;
        break;
      case "ring":
        if (ctx.ring !== undefined && (ctx.ring < c.range.lo || ctx.ring > c.range.hi)) return false;
        break;
      case "star":
      case "type":
      case "terrain": {
        const v = ctx[c.key];
        if (v !== undefined && !c.values.includes(lc(v))) return false;
        break;
      }
      case "temperature":
        if (ctx.temperature !== undefined && !inClimateRange(c.range, ctx.temperature)) return false;
        break;
    }
  }
  return true;
}

/** Conditions back as a When cell. */
export function formatWhen(when: readonly TableCondition[]): string {
  const fmt = (r: IntRange) => (r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);
  return when.map((c) => {
    switch (c.key) {
      case "zone": return `zone: ${ORBIT_ZONES.filter((z) => c.zones.includes(z)).join(", ")}`;
      case "ring": return `ring: ${fmt(c.range)}`;
      case "temperature": return `temperature: ${c.range.lo}–${c.range.hi}`;
      case "unknown": return c.text;
      default: return `${c.key}: ${c.values.join(", ")}`;
    }
  }).join("; ");
}

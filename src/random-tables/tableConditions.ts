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
 * - Keys: type (terrain types) and terrain (the parent hex's terrain) are
 *   the core's; modules add theirs (Space: zone, ring, star; World maps:
 *   temperature), see TableConditionDef.
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

import type { OrbitZone } from "../modules/space/orbitZones";
import type { TableConditionDef } from "../modules/types";
import { registry } from "../modules";

export type TableCondition =
  /** The core's list keys (type, terrain): any of the values fits. */
  | { key: "type" | "terrain"; values: string[] }
  /** A module's key (zone, ring, star, temperature): its own reading of the value. */
  | { key: string; value: unknown }
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

const lc = (s: string) => s.trim().toLowerCase();
const list = (raw: string) => raw.split(/\s*,\s*/).map(lc).filter((s) => s !== "");

/** The core's list keys. */
const CORE_LIST_KEYS = ["type", "terrain"] as const;

/** A module's condition for a key or one of its aliases (singular, lower case). */
function conditionDef(key: string): TableConditionDef | undefined {
  return registry.tableConditions().find((d) => d.key === key || (d.aliases ?? []).includes(key));
}

/** Every key a When cell may use: the core's and each module's, in module order. */
export function conditionKeys(): string[] {
  return [...registry.tableConditions().map((d) => d.key), ...CORE_LIST_KEYS];
}

/** One `key: value` → a condition (key "unknown" when it can't be read). */
function readCondition(part: string): TableCondition {
  const m = /^([a-z ]+?)\s*[:=]\s*(.+)$/i.exec(part.trim());
  if (!m) return { key: "unknown", text: part.trim() };
  const key = lc(m[1]).replace(/s$/, "");
  const value = m[2].trim();
  if (key === "type" || key === "terrain") {
    const values = list(value);
    return values.length ? { key, values } : { key: "unknown", text: part.trim() };
  }
  const def = conditionDef(key);
  const read = def?.read(value);
  return def && read !== undefined ? { key: def.key, value: read } : { key: "unknown", text: part.trim() };
}

/** A When cell → its conditions (empty for a blank cell or "any"). */
export function parseWhen(raw: string): TableCondition[] {
  const t = raw.trim();
  if (!t || /^(any|always|-|—)$/i.test(t)) return [];
  return t.split(/\s*;\s*/).filter((p) => p !== "").map(readCondition);
}

/** The parts of a When cell that can't be read (reported; the row never fires). */
export function unreadableConditions(when: readonly TableCondition[]): string[] {
  return when.flatMap((c) => ("text" in c ? [c.text] : []));
}

/** Whether a row's conditions fit the context. Conditions the context can't speak to pass; unreadable ones never do. */
export function conditionsFit(when: readonly TableCondition[] | undefined, ctx: ConditionContext = {}): boolean {
  if (!when?.length) return true;
  const known = ctx as Record<string, unknown>;
  for (const c of when) {
    if ("text" in c) return false;
    const v = known[c.key];
    if (v === undefined) continue;
    if ("values" in c) {
      if (typeof v !== "string" || !c.values.includes(lc(v))) return false;
      continue;
    }
    const def = conditionDef(c.key);
    if (!def || !def.fits(c.value, v)) return false;
  }
  return true;
}

/** Conditions back as a When cell. */
export function formatWhen(when: readonly TableCondition[]): string {
  return when.map((c) => {
    if ("text" in c) return c.text;
    if ("values" in c) return `${c.key}: ${c.values.join(", ")}`;
    return `${c.key}: ${conditionDef(c.key)?.format(c.value) ?? String(c.value)}`;
  }).join("; ");
}

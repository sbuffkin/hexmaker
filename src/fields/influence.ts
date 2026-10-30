/**
 * Place influences (plan-custom-hex-fields, owner round 2 "Places"): each
 * kind of place (town, city, camp, settlement, or the user's own) changes
 * fields on its own hex and, fading, on the hexes around it:
 *
 *   | Place type | Field | Here | Nearby | Radius |
 *   | City | Population | +400 | +40%   | 3      |
 *
 * - A change is `+400` / `-50` (add), `x1.5` / `×1.5` / `*1.5`
 *   (multiply), `+40%` / `-20%` (multiply by 1.4 / 0.8) or `=yes` (set,
 *   any type).
 * - Here is the place's own hex. Nearby reaches `radius` hexes and fades
 *   in a straight line: full next door, 1/radius of it at the edge.
 *   A set (`=`) doesn't fade.
 * - Several places add up: every add is summed, every multiply
 *   multiplied, and value = (base + adds) × multiplies. A set wins over
 *   both; the nearest place's set wins over a farther one.
 *
 * Pure: no Obsidian imports.
 */

import type { InfluenceDef } from "./fieldTypes";

export type Change =
  | { kind: "add"; amount: number }
  | { kind: "mul"; factor: number }
  | { kind: "set"; value: string };

/** A Here / Nearby cell → its change; "" → null; unreadable → undefined (reported). */
export function parseChange(raw: string): Change | null | undefined {
  const t = raw.trim().replace(/\s+/g, "").replace(/−/g, "-");
  if (!t || t === "-" || t === "—") return null;
  if (t.startsWith("=")) return { kind: "set", value: raw.trim().slice(1).trim() };
  const pct = /^([+-])(\d+\.?\d*)%$/.exec(t);
  if (pct) return { kind: "mul", factor: 1 + (pct[1] === "-" ? -1 : 1) * Number(pct[2]) / 100 };
  const mul = /^[x×*](\d+\.?\d*)$/i.exec(t);
  if (mul) return { kind: "mul", factor: Number(mul[1]) };
  const add = /^([+-]?)(\d+\.?\d*)$/.exec(t);
  if (add) return { kind: "add", amount: (add[1] === "-" ? -1 : 1) * Number(add[2]) };
  return undefined;
}

/** A change back as a cell. */
export function formatChange(c: Change | null): string {
  if (!c) return "";
  if (c.kind === "set") return `=${c.value}`;
  if (c.kind === "add") return c.amount < 0 ? `${c.amount}` : `+${c.amount}`;
  const pct = Math.round((c.factor - 1) * 10000) / 100;
  return Number.isInteger(pct * 10) && Math.abs(pct) < 1000 ? `${pct < 0 ? "" : "+"}${pct}%` : `x${c.factor}`;
}

/** How much of a nearby change reaches `distance` hexes away (1 next door … 1/radius at the edge; 0 beyond). */
export function fade(distance: number, radius: number): number {
  if (distance < 1 || distance > radius || radius < 1) return 0;
  return (radius - distance + 1) / radius;
}

/** A change scaled by how much of it reaches (a set never fades). */
export function scaled(c: Change, weight: number): Change {
  if (c.kind === "add") return { kind: "add", amount: c.amount * weight };
  if (c.kind === "mul") return { kind: "mul", factor: 1 + (c.factor - 1) * weight };
  return c;
}

/** Everything the places around a hex do to one field. */
export interface FieldEffect {
  add: number;
  mul: number;
  /** The nearest place's set, with its distance. */
  set?: { value: string; distance: number };
  /** Something changed it. */
  touched: boolean;
}

export const NO_EFFECT: FieldEffect = { add: 0, mul: 1, touched: false };

/** A place on a map: its hex, its type (lower case) and where it came from. */
export interface Place {
  key: string;
  type: string;
  /**
   * The note it came from (a town note linked in the hex's Towns), if any.
   * The seam for summing a place's hexes into its note, which moved to
   * plan-play-bookkeeping (owner 2026-10-26); nothing writes there yet.
   */
  note?: string;
  /** What made it a place, for the report ("terrain Town", "[[Saltmere]]"). */
  source: string;
}

/**
 * Every field's effect on one hex: the influences of every place within
 * reach. `distanceTo(key)` is hexes from this hex to a place's hex.
 */
export function effectsAt(places: readonly Place[], influences: readonly InfluenceDef[], distanceTo: (key: string) => number): Map<string, FieldEffect> {
  const out = new Map<string, FieldEffect>();
  if (!places.length || !influences.length) return out;
  const byPlace = new Map<string, InfluenceDef[]>();
  for (const inf of influences) {
    const k = inf.place.trim().toLowerCase();
    byPlace.set(k, [...(byPlace.get(k) ?? []), inf]);
  }
  for (const place of places) {
    const infs = byPlace.get(place.type);
    if (!infs) continue;
    const d = distanceTo(place.key);
    for (const inf of infs) {
      const raw = d === 0 ? parseChange(inf.here) : parseChange(inf.nearby);
      if (!raw) continue;
      const weight = d === 0 ? 1 : fade(d, inf.radius);
      if (weight <= 0) continue;
      const c = scaled(raw, weight);
      const k = inf.field.trim().toLowerCase();
      const e = { ...(out.get(k) ?? NO_EFFECT), touched: true };
      if (c.kind === "add") e.add += c.amount;
      else if (c.kind === "mul") e.mul *= c.factor;
      else if (!e.set || d < e.set.distance) e.set = { value: c.value, distance: d };
      out.set(k, e);
    }
  }
  return out;
}

/** A number with an effect applied: (base + adds) × multiplies. */
export function applyNumber(base: number, e: FieldEffect): number {
  return (base + e.add) * e.mul;
}

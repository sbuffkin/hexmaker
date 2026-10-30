/**
 * A hex's field values: read, written and worked out (plan-custom-hex-
 * fields phase 1).
 *
 * Storage: each field is a `## Hexes` column of the map note, named like
 * the field, its cell the plain value (`HexData.extra[<name>]`, matched in
 * any case). One more column, "Field rolls", keeps what each rolled field
 * came to before places changed it (`Population: 400; Land value: 3`), so
 * Recalculate can redo the place changes without rolling again.
 *
 * A field the plugin worked out is listed in Field rolls; a value typed by
 * hand (the editor, the note, a script) isn't, and "Recalculate, keep
 * rolls" leaves it alone. Formulas are always worked out again.
 *
 * Value = the table's roll (else the default), then the places' changes
 * (influence.ts). A field with no table and no formula that no place
 * changes stays blank: blank reads as its default.
 *
 * Pure: no Obsidian imports.
 */

import type { HexData } from "../maps/mapNote";
import { fieldNamed, formatNumber, isNumeric, normalizeValue, readNumber, type FieldDecls, type FieldDef } from "./fieldTypes";
import { applyNumber, NO_EFFECT, type FieldEffect } from "./influence";
import { compileFormula, rollNumberText } from "./formula";

/** The `## Hexes` column holding the rolls (before place changes). */
export const FIELD_ROLLS_COLUMN = "Field rolls";

const lc = (s: string) => s.trim().toLowerCase();

/** A field's cell on a hex (any case of its header); undefined when blank. */
export function getField(h: Pick<HexData, "extra"> | undefined, name: string): string | undefined {
  const e = h?.extra;
  if (!e) return undefined;
  if (e[name]) return e[name];
  const k = lc(name);
  for (const [hd, v] of Object.entries(e)) if (lc(hd) === k && v) return v;
  return undefined;
}

/** A field's value as shown: its cell, else its default. */
export function shownValue(h: Pick<HexData, "extra"> | undefined, f: FieldDef): string {
  return getField(h, f.name) ?? f.default.trim();
}

/** A field's value as a number for formulas and sorting (blank → default → undefined). */
export function numberValue(h: Pick<HexData, "extra"> | undefined, f: FieldDef): number | undefined {
  return readNumber(normalizeValue(f, shownValue(h, f)));
}

/** `extra` with cells set ("" or null clears one); other spellings of the same header dropped. Undefined when nothing is left. */
export function withCells(extra: Record<string, string> | undefined, cells: Record<string, string | null>): Record<string, string> | undefined {
  const out: Record<string, string> = { ...(extra ?? {}) };
  for (const [name, v] of Object.entries(cells)) {
    const k = lc(name);
    // Keep the header as the note spells it when there is one.
    const existing = Object.keys(out).find((h) => lc(h) === k);
    for (const h of Object.keys(out)) if (lc(h) === k) delete out[h];
    if (v) out[existing ?? name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The Field rolls cell → field (lower case) → { name, value }. */
export function readRolls(cell: string | undefined): Map<string, { name: string; value: string }> {
  const out = new Map<string, { name: string; value: string }>();
  if (!cell) return out;
  // Split on ";" that isn't escaped as "\\;" (no lookbehind: old iOS can't parse it).
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === "\\" && cell[i + 1] === ";") { cur += ";"; i++; }
    else if (cell[i] === ";") { parts.push(cur); cur = ""; }
    else cur += cell[i];
  }
  parts.push(cur);
  for (const part of parts) {
    const m = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/.exec(part);
    if (m && m[1]) out.set(lc(m[1]), { name: m[1], value: m[2] });
  }
  return out;
}

/** Rolls back as a cell, in the declarations' order. */
export function formatRolls(rolls: Map<string, { name: string; value: string }>, order: readonly FieldDef[]): string {
  const rank = (k: string) => {
    const i = order.findIndex((f) => lc(f.name) === k);
    return i < 0 ? order.length : i;
  };
  return [...rolls.entries()]
    .filter(([, r]) => r.value !== "")
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([, r]) => `${r.name}: ${r.value.replace(/;/g, "\\;")}`)
    .join("; ");
}

/** What working out a hex needs. */
export interface HexFieldContext {
  decls: FieldDecls;
  /** The field's table rolled for this hex (its result text), or undefined (no table, nothing came up). */
  roll(field: FieldDef): string | undefined;
  /** What the places around do to each field (by lower-case field name). */
  effects: ReadonlyMap<string, FieldEffect>;
  rand?: () => number;
}

/**
 * - `fill`: only blank fields are worked out (a hex just got terrain).
 * - `modifiers`: rolls kept, place changes redone; hand-typed values kept;
 *   blank fields worked out.
 * - `reroll`: every field rolled again (hand-typed ones too).
 * - `formulas`: only the formulas worked out again (a field they read changed).
 */
export type FieldPass = "fill" | "modifiers" | "reroll" | "formulas";

/** Formula fields in an order where each comes after the formulas it reads; ones in a loop are left out. */
export function formulaOrder(fields: readonly FieldDef[]): FieldDef[] {
  const names = fields.map((f) => f.name);
  const byName = new Map(fields.filter((f) => f.formula).map((f) => [lc(f.name), f]));
  const out: FieldDef[] = [];
  const state = new Map<string, "busy" | "done" | "loop">();
  const visit = (f: FieldDef): boolean => {
    const k = lc(f.name);
    const s = state.get(k);
    if (s === "done") return true;
    if (s === "busy" || s === "loop") { state.set(k, "loop"); return false; }
    state.set(k, "busy");
    let ok = true;
    for (const r of compileFormula(f.formula ?? "", names).refs) {
      const dep = byName.get(lc(r));
      if (dep && !visit(dep)) ok = false;
    }
    if (!ok || state.get(k) === "loop") { state.set(k, "loop"); return false; }
    state.set(k, "done");
    out.push(f);
    return true;
  };
  for (const f of byName.values()) visit(f);
  return out;
}

/** A field's value with the places' changes applied to `base` ("" = nothing). */
export function applyEffect(f: FieldDef, base: string, e: FieldEffect): string {
  if (e.set) return normalizeValue(f, e.set.value);
  if (!isNumeric(f) || (e.add === 0 && e.mul === 1)) return normalizeValue(f, base);
  const n = readNumber(normalizeValue(f, base)) ?? 0;
  return formatNumber(f, applyNumber(n, e));
}

/**
 * Work out a hex's fields (see FieldPass). Returns the hex's new `extra`,
 * or undefined when nothing changes.
 */
export function computeHexFields(h: Pick<HexData, "extra"> | undefined, ctx: HexFieldContext, pass: FieldPass): Record<string, string> | undefined {
  const { decls } = ctx;
  if (!decls.fields.length) return undefined;
  const rolls = readRolls(getField(h, FIELD_ROLLS_COLUMN));
  const cells: Record<string, string | null> = {};
  // The values as they stand once each field is worked out (formulas read them).
  const now = new Map<string, string>();
  for (const f of decls.fields) now.set(lc(f.name), getField(h, f.name) ?? "");
  const effectOf = (f: FieldDef) => ctx.effects.get(lc(f.name)) ?? NO_EFFECT;

  for (const f of decls.fields) {
    if (f.formula || pass === "formulas") continue;
    const k = lc(f.name);
    const current = now.get(k) ?? "";
    const rolled = rolls.get(k);
    if (current && pass === "fill") continue;
    if (current && pass === "modifiers" && !rolled) continue;
    const e = effectOf(f);
    let base: string;
    let fromTable = false;
    if (pass === "modifiers" && rolled) {
      base = rolled.value;
      fromTable = true;
    } else {
      const r = f.table ? rolledValue(f, ctx.roll(f), ctx.rand) : "";
      fromTable = r !== "";
      base = r || normalizeValue(f, f.default);
    }
    const keep = fromTable || e.touched;
    const value = keep ? applyEffect(f, base, e) : "";
    if (keep && base !== "") rolls.set(k, { name: f.name, value: base });
    else rolls.delete(k);
    cells[f.name] = value || null;
    now.set(k, value);
  }

  const numberOf = (name: string): number | undefined => {
    const f = fieldNamed(decls, name);
    if (!f) return undefined;
    return readNumber(normalizeValue(f, now.get(lc(f.name)) || f.default));
  };
  const names = decls.fields.map((f) => f.name);
  for (const f of formulaOrder(decls.fields)) {
    const v = compileFormula(f.formula ?? "", names).run(numberOf, ctx.rand);
    const base = v === undefined ? "" : isNumeric(f) ? formatNumber(f, v) : String(v);
    const value = base === "" ? "" : applyEffect(f, base, effectOf(f));
    rolls.delete(lc(f.name));
    cells[f.name] = value || null;
    now.set(lc(f.name), value);
  }

  cells[FIELD_ROLLS_COLUMN] = formatRolls(rolls, decls.fields) || null;
  const next = withCells(h?.extra, cells);
  return sameCells(h?.extra, next) ? undefined : next ?? {};
}

/**
 * A value typed by hand (the editor): the cell set, its roll forgotten (so
 * Recalculate keeps it), and the formulas worked out again. Returns the
 * hex's new `extra` (undefined when nothing changes).
 */
export function setByHand(h: Pick<HexData, "extra"> | undefined, decls: FieldDecls, f: FieldDef, raw: string, effects: ReadonlyMap<string, FieldEffect> = new Map()): Record<string, string> | undefined {
  const rolls = readRolls(getField(h, FIELD_ROLLS_COLUMN));
  rolls.delete(lc(f.name));
  const value = normalizeValue(f, raw) || (f.type === "text" ? raw.trim() : "");
  const extra = withCells(h?.extra, { [f.name]: value || null, [FIELD_ROLLS_COLUMN]: formatRolls(rolls, decls.fields) || null });
  const next = computeHexFields({ extra }, { decls, roll: () => undefined, effects }, "formulas") ?? extra;
  return sameCells(h?.extra, next) ? undefined : next ?? {};
}

/** A table's result as the field's value: a number field reads dice sums ("3d6 * 100") too. */
export function rolledValue(f: FieldDef, raw: string | undefined, rand?: () => number): string {
  if (raw && isNumeric(f)) {
    const n = rollNumberText(raw.trim(), rand);
    if (n !== undefined) return formatNumber(f, n);
  }
  return normalizeValue(f, raw);
}

/** Same cells, ignoring header case and blank cells. */
function sameCells(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const flat = (e: Record<string, string> | undefined) =>
    JSON.stringify(Object.entries(e ?? {}).filter(([, v]) => v).map(([k, v]) => [lc(k), v]).sort());
  return flat(a) === flat(b);
}

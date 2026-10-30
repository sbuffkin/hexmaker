/**
 * The hex table's hex field columns (plan-custom-hex-fields phase 1): one
 * column per field the world declares, after Type; sorting by a field
 * (the sort button cycles xy → yx → type → each field); and the field
 * filters (number range, a yes/no or choice value, text contains).
 *
 * A row keeps its values in `data-fields` (JSON, field name lower case →
 * the value shown) so filtering and sorting never read the map again.
 *
 * Pure except for drawing cells on elements it's given (no Obsidian imports).
 */

import type { HexData } from "../maps/mapNote";
import { isNumeric, readNumber, normalizeValue, type FieldDef } from "./fieldTypes";
import { shownValue } from "./hexFields";

/** Two shown values in field order: numbers by size (blank last), the rest by text. */
export function compareFieldValues(f: FieldDef, a: string, b: string): number {
  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
  if (isNumeric(f)) return (readNumber(a) ?? 0) - (readNumber(b) ?? 0);
  if (f.type === "choice" && f.choices?.length) {
    const rank = (v: string) => f.choices!.findIndex((c) => c.toLowerCase() === v.toLowerCase());
    return rank(a) - rank(b);
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** One field's filter: a number range, one value (yes/no, choice) or text it contains. */
export interface FieldFilter {
  min?: number;
  max?: number;
  equals?: string;
  contains?: string;
}

/** Field name (lower case) → its filter. */
export type FieldFilters = Map<string, FieldFilter>;

/** Is a filter doing anything? */
export function filterSet(f: FieldFilter | undefined): boolean {
  return !!f && (f.min !== undefined || f.max !== undefined || !!f.equals || !!f.contains);
}

/** Does a row's values (field lower case → value) pass every field filter? */
export function matchesFieldFilters(values: Record<string, string>, filters: FieldFilters, fields: readonly FieldDef[]): boolean {
  for (const f of fields) {
    const flt = filters.get(f.name.toLowerCase());
    if (!filterSet(flt)) continue;
    const v = values[f.name.toLowerCase()] ?? "";
    if (flt!.min !== undefined || flt!.max !== undefined) {
      const n = readNumber(v);
      if (n === undefined) return false;
      if (flt!.min !== undefined && n < flt!.min) return false;
      if (flt!.max !== undefined && n > flt!.max) return false;
    }
    if (flt!.equals && normalizeValue(f, v).toLowerCase() !== flt!.equals.toLowerCase()) return false;
    if (flt!.contains && !v.toLowerCase().includes(flt!.contains.toLowerCase())) return false;
  }
  return true;
}

/** The toolbar button's label. */
export function filtersLabel(filters: FieldFilters): string {
  const n = [...filters.values()].filter(filterSet).length;
  return n ? `Fields: ${n} set` : "Fields: all";
}

/** A row's values, as shown (blank → the default). */
export function rowValues(h: HexData | undefined, fields: readonly FieldDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.name.toLowerCase()] = shownValue(h, f);
  return out;
}

/** The header cells, one per field. */
export function renderFieldHeaders(row: HTMLElement, fields: readonly FieldDef[]): void {
  for (const f of fields) row.createEl("th", { text: f.name, cls: "duckmage-hex-table-field-head", attr: { title: f.formula ? `= ${f.formula}` : f.type } });
}

/** A row's field cells, and its values kept on the row for filters and sorting. */
export function renderFieldCells(tr: HTMLElement, h: HexData | undefined, fields: readonly FieldDef[]): void {
  const values = rowValues(h, fields);
  tr.dataset.fields = JSON.stringify(values);
  for (const f of fields) {
    const v = values[f.name.toLowerCase()];
    const td = tr.createEl("td", { cls: `duckmage-hex-table-field${isNumeric(f) ? " is-number" : ""}` });
    if (v) td.setText(v);
    else td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
  }
}

/** A row's values back from `data-fields`. */
export function valuesOfRow(tr: HTMLElement): Record<string, string> {
  try {
    return JSON.parse(tr.dataset.fields ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

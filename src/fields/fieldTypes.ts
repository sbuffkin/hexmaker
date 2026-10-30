/**
 * Custom hex fields (GitHub #52, plan-custom-hex-fields): the user's own
 * per-hex data (population, land value, …), declared once per world in the
 * fields note (fieldsNote.ts) and stored as `## Hexes` columns of each map
 * note (one column per field, the field's name as the header).
 *
 * This file: what a declaration is, and reading / writing one value of
 * each type. A value is always kept as the text in its cell; these
 * helpers read it as its type.
 *
 * Pure: no Obsidian imports.
 */

/** number: any number (rounded to 2 decimals); whole number: an integer; yes/no; choice: one of `choices`. */
export type FieldType = "number" | "whole number" | "text" | "yes/no" | "choice";

export const FIELD_TYPES: readonly FieldType[] = ["number", "whole number", "text", "yes/no", "choice"];

/** One field, as declared in the fields note's `## Fields` table. */
export interface FieldDef {
  /** The column header in every map note's `## Hexes` table (matched in any case). */
  name: string;
  type: FieldType;
  /** What a hex has when nothing set it ("" = blank). */
  default: string;
  /** A random table to roll (its link target as written, no brackets). */
  table?: string;
  /** A formula over the hex's other fields (`Population / 20`): the field is computed, never rolled. */
  formula?: string;
  /** choice: the values offered, in order. */
  choices?: string[];
}

/** How one kind of place changes one field: on its own hex, and around it. */
export interface InfluenceDef {
  /** The place type ("City", "Town", "Camp"), matched in any case. */
  place: string;
  /** The field it changes (a FieldDef name, any case). */
  field: string;
  /** On the place's own hex ("+400", "x1.5", "+40%", "=yes"), or "". */
  here: string;
  /** On hexes within `radius`, fading with distance, or "". */
  nearby: string;
  /** Hexes away the nearby change reaches (0 = only its own hex). */
  radius: number;
}

/** Everything the fields note declares. */
export interface FieldDecls {
  fields: FieldDef[];
  influences: InfluenceDef[];
}

export const EMPTY_DECLS: FieldDecls = { fields: [], influences: [] };

const TRUE = /^(yes|true|y|on|1|✓|✔|☑)$/i;
const FALSE = /^(no|false|n|off|0|-|—)$/i;

/** A type name as people write it ("int", "Yes / No", "bool", "list") → its type; unknown → undefined. */
export function parseFieldType(raw: string): FieldType | undefined {
  const t = raw.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
  if (!t) return "text";
  if (/^(number|num|decimal|real|float)$/.test(t)) return "number";
  if (/^(whole number|whole|integer|int|count)$/.test(t)) return "whole number";
  if (/^(text|string|words?)$/.test(t)) return "text";
  if (/^(yes\/no|y\/n|bool|boolean|checkbox|flag)$/.test(t)) return "yes/no";
  if (/^(choice|choices|list|one of|pick)$/.test(t)) return "choice";
  return undefined;
}

/** Is it a number type (influences add and multiply, formulas use it)? */
export function isNumeric(f: Pick<FieldDef, "type">): boolean {
  return f.type === "number" || f.type === "whole number";
}

/** A cell's text as a number ("1,200" and "1 200" read), or undefined. */
export function readNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().replace(/(\d)[, ](?=\d{3}\b)/g, "$1");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** A number written for its field: whole numbers rounded, others to at most 2 decimals. */
export function formatNumber(f: Pick<FieldDef, "type">, n: number): string {
  if (!Number.isFinite(n)) return "";
  if (f.type === "whole number") return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

/**
 * Any text → the field's value as it's stored ("" when it can't be one):
 * numbers read and rounded, yes/no as "yes" / "no", a choice in its
 * declared spelling (any case). Text is kept as typed (trimmed).
 */
export function normalizeValue(f: FieldDef, raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  switch (f.type) {
    case "number":
    case "whole number": {
      const n = readNumber(t) ?? firstNumber(t);
      return n === undefined ? "" : formatNumber(f, n);
    }
    case "yes/no":
      return TRUE.test(t) ? "yes" : FALSE.test(t) ? "no" : "";
    case "choice": {
      const hit = (f.choices ?? []).find((c) => c.toLowerCase() === t.toLowerCase());
      return hit ?? (f.choices?.length ? "" : t);
    }
    default:
      return t;
  }
}

/** The first number written in a text ("about 400 people" → 400). */
export function firstNumber(text: string): number | undefined {
  const m = /[-+]?\d[\d,]*\.?\d*/.exec(text);
  return m ? readNumber(m[0].replace(/,/g, "")) : undefined;
}

/** Does a stored value read as its type (what the editor and the table check)? */
export function isValidValue(f: FieldDef, raw: string): boolean {
  return !raw.trim() || normalizeValue(f, raw) !== "";
}

/** The field named `name`, in any case. */
export function fieldNamed(decls: FieldDecls, name: string): FieldDef | undefined {
  const k = name.trim().toLowerCase();
  return decls.fields.find((f) => f.name.toLowerCase() === k);
}

/**
 * The fields note: one per world, `<world folder>/Hex fields.md`, the only
 * copy of the world's hex field declarations and place influences
 * (plan-custom-hex-fields phase 1). Readable and editable by hand, like a
 * palette note:
 *
 *   ---
 *   hexmaker-fields: 1
 *   ---
 *   # Hex fields
 *   ## Fields
 *   | Field | Type | Default | Table | Formula | Choices |
 *   | Population | whole number | 0 | [[tables/fields/Population]] |  |  |
 *   | Land value | number | 1 |  |  |  |
 *   | Militia | whole number |  |  | Population / 20 |  |
 *   ## Place influences
 *   | Place type | Field | Here | Nearby | Radius |
 *   | City | Population | +400 | +40% | 3 |
 *
 * - Headers are matched in any case, columns in any order; missing ones
 *   are blank. Rows that can't be read are reported and left out; the
 *   note is never rewritten except by the settings section (which keeps
 *   every line outside the two tables).
 * - The map notes hold the values: one `## Hexes` column per field, named
 *   like the field (src/maps/mapNote.ts keeps unknown columns as
 *   `HexData.extra`).
 *
 * Pure: no Obsidian imports.
 */

import { SEPARATOR_ROW, splitRow } from "../md/tableRow";
import { parseFieldType, type FieldDecls, type FieldDef, type InfluenceDef } from "./fieldTypes";
import { parseChange } from "./influence";
import { compileFormula } from "./formula";

export const FIELDS_NOTE_MARKER = "hexmaker-fields";
export const FIELDS_NOTE_FORMAT = 1;
/** The note's file name in the world folder. */
export const FIELDS_NOTE_NAME = "Hex fields.md";

export interface FieldsNoteProblem {
  where: "Fields" | "Place influences";
  text: string;
  reason: string;
}

export interface FieldsNoteRead extends FieldDecls {
  problems: FieldsNoteProblem[];
}

const FIELD_COLS: Record<string, string> = {
  field: "field", name: "field",
  type: "type", kind: "type",
  default: "default", "default value": "default",
  table: "table", "roll on": "table", "random table": "table",
  formula: "formula", computed: "formula",
  choices: "choices", options: "choices", values: "choices",
};
const INFLUENCE_COLS: Record<string, string> = {
  place: "place", "place type": "place", type: "place",
  field: "field",
  here: "here", "on its hex": "here", own: "here",
  nearby: "nearby", around: "nearby", near: "nearby",
  radius: "radius", range: "radius", reach: "radius",
};

const FIELD_HEADERS = ["Field", "Type", "Default", "Table", "Formula", "Choices"];
const INFLUENCE_HEADERS = ["Place type", "Field", "Here", "Nearby", "Radius"];

const HELP = [
  "> [!info]- How to edit this note",
  "> Each row of **Fields** is a column in every map's `## Hexes` table, named like the field.",
  "> - **Type**: number, whole number, text, yes/no or choice (list the choices, comma separated).",
  "> - **Table**: a random table to roll when a hex gets terrain. Its `When` column can say `near: town 2`.",
  "> - **Formula**: computed from the hex's other fields, e.g. `Population / 20`.",
  "> - **Place influences**: what each kind of place does to a field on its own hex (**Here**) and within **Radius** hexes (**Nearby**, fading): `+400`, `+40%`, `x1.5`, `=yes`.",
  "> Run **Recalculate fields** after adding towns or cities.",
];

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** A wikilink cell → its target (`[[a/b|B]]` → `a/b`); plain text as typed. */
export function linkTarget(cell: string): string {
  const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(cell.trim());
  return (m ? m[1] : cell).trim().replace(/\.md$/i, "");
}

interface TableAt {
  start: number;
  end: number;
  cols: string[];
  body: number;
}

/** The `## <name>` section's first table: its line span and column ids. */
function findTable(lines: string[], heading: RegExp, aliases: Record<string, string>): TableAt | null {
  const h = lines.findIndex((l) => heading.test(l.trim()));
  if (h < 0) return null;
  let end = lines.findIndex((l, i) => i > h && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  const start = lines.findIndex((l, i) => i > h && i < end && l.trim().startsWith("|"));
  if (start < 0) return null;
  let last = start;
  while (last + 1 < end && lines[last + 1].trim().startsWith("|")) last++;
  const cols = splitRow(lines[start]).map((c) => aliases[norm(c)] ?? "");
  const body = start + 1 < lines.length && SEPARATOR_ROW.test(lines[start + 1]) ? start + 2 : start + 1;
  return { start, end: last + 1, cols, body };
}

function rowsOf(lines: string[], t: TableAt): { line: string; get: (id: string) => string }[] {
  const out: { line: string; get: (id: string) => string }[] = [];
  for (let i = t.body; i < t.end; i++) {
    const cells = splitRow(lines[i]);
    if (cells.every((c) => !c)) continue;
    out.push({ line: lines[i].trim(), get: (id) => cells[t.cols.indexOf(id)] ?? "" });
  }
  return out;
}

/** Read a fields note (forgiving; see the top of this file). */
export function parseFieldsNote(content: string): FieldsNoteRead {
  const lines = content.split(/\r?\n/);
  const out: FieldsNoteRead = { fields: [], influences: [], problems: [] };
  const ft = findTable(lines, /^##\s+(hex\s+)?fields\s*:?$/i, FIELD_COLS);
  if (ft) {
    for (const r of rowsOf(lines, ft)) {
      const no = (reason: string) => out.problems.push({ where: "Fields", text: r.line, reason });
      const name = r.get("field").replace(/[|]/g, "").trim();
      if (!name) { no("no field name"); continue; }
      if (out.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) { no(`"${name}" is already a field above`); continue; }
      const type = parseFieldType(r.get("type"));
      if (!type) { no(`"${r.get("type")}" isn't a type (number, whole number, text, yes/no, choice)`); continue; }
      const f: FieldDef = { name, type, default: r.get("default") };
      const table = linkTarget(r.get("table"));
      if (table) f.table = table;
      const formula = r.get("formula");
      if (formula) f.formula = formula;
      const choices = r.get("choices").split(/\s*[,;]\s*/).filter(Boolean);
      if (choices.length) f.choices = choices;
      out.fields.push(f);
    }
    // Formulas are checked once every field is known (they may name a later one).
    const names = out.fields.map((f) => f.name);
    for (const f of out.fields) {
      if (!f.formula) continue;
      const err = compileFormula(f.formula, names).error;
      if (err) out.problems.push({ where: "Fields", text: `${f.name}: ${f.formula}`, reason: `the formula can't be read: ${err}` });
    }
  }
  const it = findTable(lines, /^##\s+(place\s+)?influences?\s*:?$/i, INFLUENCE_COLS);
  if (it) {
    for (const r of rowsOf(lines, it)) {
      const no = (reason: string) => out.problems.push({ where: "Place influences", text: r.line, reason });
      const place = r.get("place");
      const field = r.get("field");
      if (!place || !field) { no("needs a Place and a Field"); continue; }
      const here = r.get("here"), nearby = r.get("nearby");
      if (parseChange(here) === undefined) { no(`Here "${here}" isn't a change (+400, +40%, x1.5, =yes)`); continue; }
      if (parseChange(nearby) === undefined) { no(`Nearby "${nearby}" isn't a change (+400, +40%, x1.5, =yes)`); continue; }
      const radiusRaw = r.get("radius");
      const radius = radiusRaw ? Number(radiusRaw) : 0;
      if (!Number.isInteger(radius) || radius < 0) { no(`Radius "${radiusRaw}" should be a whole number`); continue; }
      out.influences.push({ place, field, here, nearby, radius });
    }
  }
  return out;
}

const esc = (v: string | undefined) => (v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const row = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;

function fieldsTable(fields: readonly FieldDef[]): string[] {
  return [
    row(FIELD_HEADERS),
    row(FIELD_HEADERS.map(() => "---")),
    ...fields.map((f) => row([f.name, f.type, f.default, f.table ? `[[${f.table}]]` : "", f.formula ?? "", (f.choices ?? []).join(", ")])),
  ];
}

function influencesTable(infs: readonly InfluenceDef[]): string[] {
  return [
    row(INFLUENCE_HEADERS),
    row(INFLUENCE_HEADERS.map(() => "---")),
    ...infs.map((i) => row([i.place, i.field, i.here, i.nearby, String(i.radius)])),
  ];
}

/** A new fields note. */
export function buildFieldsNote(decls: FieldDecls): string {
  return [
    "---", `${FIELDS_NOTE_MARKER}: ${FIELDS_NOTE_FORMAT}`, "---",
    "# Hex fields", "", ...HELP, "",
    "## Fields", ...fieldsTable(decls.fields), "",
    "## Place influences", ...influencesTable(decls.influences), "",
  ].join("\n");
}

/** The note with its two tables replaced; every other line (the user's own text) kept. */
export function updateFieldsNote(content: string, decls: FieldDecls): string {
  if (!content.trim()) return buildFieldsNote(decls);
  let lines = content.split(/\r?\n/);
  const put = (heading: RegExp, title: string, aliases: Record<string, string>, table: string[]) => {
    const t = findTable(lines, heading, aliases);
    if (t) { lines = [...lines.slice(0, t.start), ...table, ...lines.slice(t.end)]; return; }
    const h = lines.findIndex((l) => heading.test(l.trim()));
    if (h >= 0) { lines = [...lines.slice(0, h + 1), ...table, ...lines.slice(h + 1)]; return; }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", title, ...table, "");
  };
  put(/^##\s+(hex\s+)?fields\s*:?$/i, "## Fields", FIELD_COLS, fieldsTable(decls.fields));
  put(/^##\s+(place\s+)?influences?\s*:?$/i, "## Place influences", INFLUENCE_COLS, influencesTable(decls.influences));
  return lines.join("\n");
}

/** Is this note a fields note (its frontmatter marker)? */
export function isFieldsNote(content: string): boolean {
  return new RegExp(`^---\\r?\\n(?:[^\\n]*\\r?\\n)*?${FIELDS_NOTE_MARKER}\\s*:`).test(content);
}

/**
 * Plain-text file format for a model: Markdown with YAML frontmatter and two
 * tables. It's meant to be read and edited by hand (and renders nicely in
 * Obsidian or on GitHub).
 *
 *   ---
 *   hex-wfc: 1
 *   name: lakes
 *   palette: Default        <- any other keys are kept as `meta`
 *   ---
 *   ## Terrains
 *   | Terrain | Weight |
 *   ...
 *   ## Adjacency
 *   | Terrain | Next to | Weight |
 *   ...
 */

import type { HexWfcModel } from "./model";

export const FORMAT_VERSION = 1;
const MARKER = "hex-wfc";

function yamlValue(v: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9 _./()-]*$/.test(v) && !v.endsWith(" ") ? v : JSON.stringify(v);
}

function parseYamlValue(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function modelToMarkdown(model: HexWfcModel): string {
  const fm = [`${MARKER}: ${FORMAT_VERSION}`, `name: ${yamlValue(model.name)}`];
  for (const [k, v] of Object.entries(model.meta)) {
    if (k === MARKER || k === "name") continue;
    fm.push(`${k}: ${yamlValue(v)}`);
  }
  const lines = [
    "---",
    ...fm,
    "---",
    "",
    `# ${model.name}`,
    "",
    "A wave function collapse generator. You can edit both tables by hand.",
    "",
    "- **Terrains**: *Weight* is how common the terrain is. 0 means it is never placed.",
    "- **Adjacency**: pairs that may touch, and how often (higher is more likely).",
    "  A pair that isn't listed can never touch, including a terrain next to itself.",
    "  Order doesn't matter, so *A | B* also covers *B | A*.",
    "",
    "## Terrains",
    "",
    "| Terrain | Weight |",
    "| --- | ---: |",
    ...model.terrains.map((t) => `| ${cell(t.name)} | ${num(t.weight)} |`),
    "",
    "## Adjacency",
    "",
    "| Terrain | Next to | Weight |",
    "| --- | --- | ---: |",
    ...model.adjacency.map((e) => `| ${cell(e.a)} | ${cell(e.b)} | ${num(e.weight)} |`),
    "",
  ];
  return lines.join("\n");
}

/** Split a Markdown table row into trimmed cells, honouring `\|` escapes. */
function splitRow(line: string): string[] | null {
  const s = line.trim();
  if (!s.startsWith("|")) return null;
  const out: string[] = [];
  let cur = "";
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      cur += s[++i];
    } else if (ch === "|") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface ParseResult {
  model: HexWfcModel;
  /** Non-fatal issues, e.g. a row with a bad weight that was skipped. */
  warnings: string[];
}

export function isModelMarkdown(text: string): boolean {
  return new RegExp(`^---\\r?\\n(?:.*\\r?\\n)*?${MARKER}\\s*:`).test(text);
}

/**
 * Parse a model file. Throws if the text isn't a hex-wfc file at all; bad
 * individual rows become warnings instead.
 */
export function parseModelMarkdown(text: string, fallbackName = "Untitled"): ParseResult {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const meta: Record<string, string> = {};
  let name = "";
  let version: number | null = null;

  let i = 0;
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = /^([^:#][^:]*):(.*)$/.exec(lines[i]);
      if (!m) continue;
      const key = m[1].trim();
      const value = parseYamlValue(m[2]);
      if (key === MARKER) version = Number(value);
      else if (key === "name") name = value;
      else meta[key] = value;
    }
    i++;
  }
  if (version === null) throw new Error(`Not a ${MARKER} file (missing "${MARKER}:" in the frontmatter)`);
  if (version > FORMAT_VERSION)
    warnings.push(`File is ${MARKER} version ${version}; this reader understands version ${FORMAT_VERSION}`);

  let section: "terrains" | "adjacency" | null = null;
  let headerSeen = false;
  const model: HexWfcModel = { name: "", terrains: [], adjacency: [], meta };
  const weightOf = (raw: string | undefined, where: string): number | null => {
    if (raw === undefined || raw === "") return 1;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      warnings.push(`${where}: weight "${raw}" isn't a number ≥ 0, row skipped`);
      return null;
    }
    return n;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (h) {
      const title = h[1].trim().toLowerCase();
      if (!name && line.trim().startsWith("# ")) name = h[1].trim();
      section = title === "terrains" ? "terrains" : title === "adjacency" ? "adjacency" : null;
      headerSeen = false;
      continue;
    }
    if (!section) continue;
    const cells = splitRow(line);
    if (!cells) {
      if (line.trim()) headerSeen = false; // prose between tables
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator
    if (!headerSeen) {
      headerSeen = true; // first row of each table is the header
      continue;
    }
    const where = `${section === "terrains" ? "Terrains" : "Adjacency"} row "${cells.join(" | ")}"`;
    if (section === "terrains") {
      if (!cells[0]) continue;
      const w = weightOf(cells[1], where);
      if (w !== null) model.terrains.push({ name: cells[0], weight: w });
    } else {
      if (!cells[0] || !cells[1]) {
        if (cells.some(Boolean)) warnings.push(`${where}: needs two terrains, row skipped`);
        continue;
      }
      const w = weightOf(cells[2], where);
      if (w !== null) model.adjacency.push({ a: cells[0], b: cells[1], weight: w });
    }
  }

  model.name = name || fallbackName;
  return { model, warnings };
}

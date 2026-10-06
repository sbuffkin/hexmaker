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

import { LAYOUT_BINS, type HexWfcModel, type GeneratorSettings } from "./model";

export const FORMAT_VERSION = 1;
const MARKER = "hex-wfc";

/** Frontmatter key for each saved solver setting. */
export const SETTING_KEYS: Record<keyof GeneratorSettings, string> = {
  featureSize: "feature-size",
  directionalBias: "directional-bias",
  neighbourInfluence: "clumping",
  frequencyFeedback: "mix-strength",
  scatter: "scatter",
  randomness: "randomness",
};

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
  const settingKeys = new Set(Object.values(SETTING_KEYS));
  for (const [k, v] of Object.entries(model.meta)) {
    if (k === MARKER || k === "name" || settingKeys.has(k)) continue;
    fm.push(`${k}: ${yamlValue(v)}`);
  }
  for (const [field, key] of Object.entries(SETTING_KEYS) as [keyof GeneratorSettings, string][]) {
    const v = model.settings?.[field];
    if (v !== undefined) fm.push(`${key}: ${num(v)}`);
  }
  const withLayout = model.terrains.filter((t) => t.layout?.length === 9);
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
    "  *Patch %* is the size of a typical patch as a share of the map, so features",
    "  scale with the map. *Shape* is how it spreads: `blob` (lakes, forests),",
    "  `line` (ranges, ridges) or `none` (backgrounds, shores, scattered hexes).",
    "  *Turn* is how often a `line` changes direction (0 to 1).",
    "- **Adjacency**: pairs that may touch, and how often (higher is more likely).",
    "  A pair that isn't listed can never touch, including a terrain next to itself.",
    "  Order doesn't matter, so *A | B* also covers *B | A*.",
    "- **Layout** (optional): where each terrain sat in the example map, in a 3×3",
    "  grid. 1 means as common there as anywhere; 3 means three times as common.",
    "  Directional bias uses it to keep, say, an ocean along the bottom.",
    "- Frontmatter settings (optional): `feature-size`, `directional-bias`,",
    "  `clumping`, `mix-strength`, `scatter` and `randomness`.",
    "",
    "## Terrains",
    "",
    "| Terrain | Weight | Patch % | Shape | Turn |",
    "| --- | ---: | ---: | --- | ---: |",
    ...model.terrains.map(
      (t) =>
        `| ${cell(t.name)} | ${num(t.weight)} | ${t.patch === undefined ? "" : num(t.patch * 100)} | ${t.shape ?? ""} | ${t.turn === undefined ? "" : num(t.turn)} |`,
    ),
    "",
    "## Adjacency",
    "",
    "| Terrain | Next to | Weight |",
    "| --- | --- | ---: |",
    ...model.adjacency.map((e) => `| ${cell(e.a)} | ${cell(e.b)} | ${num(e.weight)} |`),
    "",
    ...(withLayout.length
      ? [
          "## Layout",
          "",
          `| Terrain | ${LAYOUT_BINS.join(" | ")} |`,
          `| --- |${" ---: |".repeat(9)}`,
          ...withLayout.map((t) => `| ${cell(t.name)} | ${t.layout!.map(num).join(" | ")} |`),
          "",
        ]
      : []),
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
  let settings: GeneratorSettings | undefined;
  const layouts = new Map<string, number[]>();
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
      else {
        const field = (Object.keys(SETTING_KEYS) as (keyof GeneratorSettings)[]).find((f) => SETTING_KEYS[f] === key);
        if (field) {
          const n = Number(value);
          if (value !== "" && Number.isFinite(n) && n >= 0) (settings ??= {})[field] = n;
          else warnings.push(`Setting "${key}: ${value}" isn't a number ≥ 0, ignored`);
        } else meta[key] = value;
      }
    }
    i++;
  }
  if (version === null) throw new Error(`Not a ${MARKER} file (missing "${MARKER}:" in the frontmatter)`);
  if (version > FORMAT_VERSION)
    warnings.push(`File is ${MARKER} version ${version}; this reader understands version ${FORMAT_VERSION}`);

  let section: "terrains" | "adjacency" | "layout" | null = null;
  let headerSeen = false;
  // Column index by lower-cased header name, for the Terrains table's
  // optional columns. Positions are the fallback for the required ones.
  let columns = new Map<string, number>();
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
      section = title === "terrains" || title === "adjacency" || title === "layout" ? title : null;
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
      columns = new Map(cells.map((c, idx) => [c.toLowerCase(), idx]));
      continue;
    }
    const sectionTitle = section === "terrains" ? "Terrains" : section === "adjacency" ? "Adjacency" : "Layout";
    const where = `${sectionTitle} row "${cells.join(" | ")}"`;
    if (section === "layout") {
      if (!cells[0]) continue;
      const values = LAYOUT_BINS.map((b) => Number(cells[columns.get(b.toLowerCase()) ?? -1]));
      if (values.every((v) => Number.isFinite(v) && v >= 0)) layouts.set(cells[0], values);
      else warnings.push(`${where}: needs 9 numbers ≥ 0 under ${LAYOUT_BINS.join(", ")}, row skipped`);
      continue;
    }
    if (section === "terrains") {
      if (!cells[0]) continue;
      const col = (name: string) => {
        const idx = columns.get(name);
        return idx === undefined ? undefined : cells[idx] || undefined;
      };
      const w = weightOf(col("weight") ?? cells[1], where);
      if (w === null) continue;
      const entry: HexWfcModel["terrains"][number] = { name: cells[0], weight: w };
      const patch = col("patch %") ?? col("patch");
      if (patch !== undefined) {
        const n = Number(patch.replace(/%$/, ""));
        if (Number.isFinite(n) && n >= 0 && n <= 100) entry.patch = Math.round(n * 1000) / 100000;
        else warnings.push(`${where}: patch "${patch}" isn't a percentage, ignored`);
      }
      const shape = col("shape")?.toLowerCase();
      if (shape !== undefined) {
        if (shape === "blob" || shape === "line" || shape === "none") entry.shape = shape;
        else warnings.push(`${where}: shape "${shape}" should be blob, line or none, ignored`);
      }
      const turn = col("turn");
      if (turn !== undefined) {
        const n = Number(turn);
        if (Number.isFinite(n) && n >= 0 && n <= 1) entry.turn = n;
        else warnings.push(`${where}: turn "${turn}" should be between 0 and 1, ignored`);
      }
      model.terrains.push(entry);
    } else {
      if (!cells[0] || !cells[1]) {
        if (cells.some(Boolean)) warnings.push(`${where}: needs two terrains, row skipped`);
        continue;
      }
      const w = weightOf(cells[2], where);
      if (w !== null) model.adjacency.push({ a: cells[0], b: cells[1], weight: w });
    }
  }

  for (const [t, values] of layouts) {
    const entry = model.terrains.find((e) => e.name === t);
    if (entry) entry.layout = values;
    else warnings.push(`Layout row "${t}" isn't in the Terrains table, ignored`);
  }
  if (settings) model.settings = settings;
  model.name = name || fallbackName;
  return { model, warnings };
}

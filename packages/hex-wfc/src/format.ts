/**
 * Plain-text file format for a model: Markdown with YAML frontmatter and a
 * few tables. It's meant to be read and edited by hand (and renders nicely in
 * Obsidian or on GitHub).
 *
 *   ---
 *   hex-wfc: 1
 *   name: lakes
 *   example-hexes: 2500
 *   feature-size: 1          <- solver settings (all optional)
 *   palette: Default         <- any other keys are kept as `meta`
 *   ---
 *   ## Terrains   | Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |
 *   ## Adjacency  | Terrain | Next to | Weight |
 *   ## Features   | Terrain | From | To | Count |          (optional)
 *   ## Layout     | Terrain | NW | N | NE | W | C | E | SW | S | SE |   (optional)
 */

import {
  LAYOUT_BINS,
  GROWTH_SHAPES,
  SYMMETRIES,
  type HexWfcModel,
  type GeneratorSettings,
  type GrowthShape,
  type Symmetry,
  type CountRange,
  type PathTweak,
  type TerrainEntry,
} from "./model";

export const FORMAT_VERSION = 1;
const MARKER = "hex-wfc";
const EXAMPLE_KEY = "example-hexes";

type SettingKind = "number" | "string" | "symmetry" | "boolean" | "list" | "mix" | "counts" | "paths";

/** Frontmatter key for each saved solver setting. */
export const SETTING_KEYS: Record<keyof GeneratorSettings, string> = {
  featureSize: "feature-size",
  directionalBias: "directional-bias",
  neighbourInfluence: "clumping",
  frequencyFeedback: "mix-strength",
  scatter: "scatter",
  randomness: "randomness",
  edgeStrength: "edge-strength",
  edgeTerrain: "edge-terrain",
  lineWidth: "line-width",
  smoothing: "smoothing",
  edgeSmoothing: "edge-smoothing",
  speckSize: "speck-size",
  keepRare: "keep-rare",
  symmetry: "symmetry",
  spacing: "spacing",
  connected: "connected",
  impassable: "impassable",
  mix: "mix",
  counts: "counts",
  features: "features",
  drawPaths: "draw-paths",
  paths: "paths",
};

const SETTING_KINDS: Record<keyof GeneratorSettings, SettingKind> = {
  featureSize: "number",
  directionalBias: "number",
  neighbourInfluence: "number",
  frequencyFeedback: "number",
  scatter: "number",
  randomness: "number",
  edgeStrength: "number",
  edgeTerrain: "string",
  lineWidth: "number",
  smoothing: "number",
  edgeSmoothing: "number",
  speckSize: "number",
  keepRare: "number",
  symmetry: "symmetry",
  spacing: "number",
  connected: "boolean",
  impassable: "list",
  mix: "mix",
  counts: "counts",
  features: "boolean",
  drawPaths: "boolean",
  paths: "paths",
};

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Value of a setting as stored in frontmatter. Lists and maps are strings
 * with "; " between items, so terrain names may contain commas and spaces:
 *   impassable: "Water; High peaks"
 *   mix: "Forest 1.5; Water 0.5"
 *   counts: "Town 3; Lake 1-; Ruin 0-2"     (exactly, at least, between)
 */
export function encodeSetting(field: keyof GeneratorSettings, value: unknown): string | number | boolean {
  switch (SETTING_KINDS[field]) {
    case "number":
      return Number(num(value as number));
    case "boolean":
      return Boolean(value);
    case "list":
      return (value as string[]).join("; ");
    case "mix":
      return Object.entries(value as Record<string, number>)
        .map(([t, m]) => `${t} ${num(m)}`)
        .join("; ");
    case "counts":
      return Object.entries(value as Record<string, CountRange>)
        .map(([t, r]) => {
          if (r.min !== undefined && r.min === r.max) return `${t} ${r.min}`;
          return `${t} ${r.min ?? ""}-${r.max ?? ""}`;
        })
        .join("; ");
    case "paths":
      return Object.entries(value as Record<string, PathTweak>)
        .map(([route, t]) => {
          const opts: string[] = [];
          if (t.off) opts.push("off");
          for (const k of ["count", "wiggle", "length", "follow"] as const) if (t[k] !== undefined) opts.push(`${k} ${num(t[k])}`);
          if (t.as) opts.push(`as ${t.as}`);
          return `${route} = ${opts.join(", ")}`;
        })
        .filter((e) => !e.endsWith("= "))
        .join("; ");
    default:
      return String(value);
  }
}

/** Parse a frontmatter value back into a setting, or explain what's wrong. */
export function decodeSetting(field: keyof GeneratorSettings, raw: string): { value: unknown } | { error: string } {
  const v = raw.trim();
  const items = () => v.split(";").map((p) => p.trim()).filter(Boolean);
  const splitLast = (item: string): [string, string] => {
    const i = item.lastIndexOf(" ");
    return i < 0 ? ["", item] : [item.slice(0, i).trim(), item.slice(i + 1)];
  };
  switch (SETTING_KINDS[field]) {
    case "number": {
      const n = Number(v);
      return v !== "" && Number.isFinite(n) && n >= 0 ? { value: n } : { error: "isn't a number ≥ 0" };
    }
    case "boolean":
      if (/^(true|yes|on|1)$/i.test(v)) return { value: true };
      if (/^(false|no|off|0)$/i.test(v)) return { value: false };
      return { error: "should be true or false" };
    case "symmetry":
      return SYMMETRIES.includes(v as Symmetry)
        ? { value: v }
        : { error: `should be one of ${SYMMETRIES.join(", ")}` };
    case "string":
      return { value: v };
    case "list":
      return { value: items() };
    case "mix": {
      const out: Record<string, number> = {};
      for (const item of items()) {
        const [t, m] = splitLast(item);
        const n = Number(m);
        if (!t || !Number.isFinite(n) || n < 0) return { error: `has "${item}"; write it like "Forest 1.5"` };
        out[t] = n;
      }
      return { value: out };
    }
    case "counts": {
      const out: Record<string, CountRange> = {};
      for (const item of items()) {
        const [t, spec] = splitLast(item);
        const m = /^(\d*)(-?)(\d*)$/.exec(spec);
        if (!t || !m || (m[1] === "" && m[3] === "") || (!m[2] && m[3] !== ""))
          return { error: `has "${item}"; write it like "Town 3", "Lake 1-" or "Ruin 0-2"` };
        const range: CountRange = {};
        if (m[2]) {
          if (m[1] !== "") range.min = Number(m[1]);
          if (m[3] !== "") range.max = Number(m[3]);
        } else {
          range.min = range.max = Number(m[1]);
        }
        out[t] = range;
      }
      return { value: out };
    }
    case "paths": {
      const out: Record<string, PathTweak> = {};
      for (const item of items()) {
        const eq = item.indexOf(" = ");
        if (eq < 0) return { error: `has "${item}"; write it like "Road: edge > peak = count 2, wiggle 1.5"` };
        const route = item.slice(0, eq).trim();
        const tweak: PathTweak = {};
        for (const part of item.slice(eq + 3).split(",").map((x) => x.trim()).filter(Boolean)) {
          const m = /^(count|wiggle|length|follow) (\S+)$/.exec(part);
          if (part === "off") tweak.off = true;
          else if (part.startsWith("as ")) tweak.as = part.slice(3).trim();
          else if (m && Number.isFinite(Number(m[2])) && Number(m[2]) >= 0) tweak[m[1] as "count"] = Number(m[2]);
          else return { error: `has "${part}" for ${route}; use off, count N, wiggle N, length N, follow N or as <path type>` };
        }
        out[route] = tweak;
      }
      return { value: out };
    }
  }
}

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
const opt = (n: number | undefined, scale = 1) => (n === undefined ? "" : num(n * scale));

export function modelToMarkdown(model: HexWfcModel): string {
  const fm = [`${MARKER}: ${FORMAT_VERSION}`, `name: ${yamlValue(model.name)}`];
  if (model.exampleHexes !== undefined) fm.push(`${EXAMPLE_KEY}: ${model.exampleHexes}`);
  const reserved = new Set<string>([MARKER, "name", EXAMPLE_KEY, ...Object.values(SETTING_KEYS)]);
  for (const [field, key] of Object.entries(SETTING_KEYS) as [keyof GeneratorSettings, string][]) {
    const v = model.settings?.[field];
    if (v === undefined) continue;
    const enc = encodeSetting(field, v);
    fm.push(`${key}: ${typeof enc === "string" ? JSON.stringify(enc) : String(enc)}`);
  }
  for (const [k, v] of Object.entries(model.meta)) {
    if (reserved.has(k)) continue;
    fm.push(`${k}: ${yamlValue(v)}`);
  }
  const withLayout = model.terrains.filter((t) => t.layout?.length === 9);
  const features = model.features ?? [];
  const lines = [
    "---",
    ...fm,
    "---",
    "",
    `# ${model.name}`,
    "",
    "A wave function collapse generator. You can edit the tables and settings by hand.",
    "",
    "- **Terrains**: *Weight* is how common the terrain is; 0 means the solver never places it.",
    "  *Patch %* is the size of a typical patch as a share of the map, so patches scale",
    "  with the map. *Shape* is how it spreads: `blob` (compact patches), `line` (long",
    "  thin runs), `scatter` (single hexes) or `none` (left to the neighbour rules).",
    "  *Turn* is how often a `line` changes direction (0 to 1) and *Width* its",
    "  thickness (1 to 3). *Spacing* is the closest two `scatter` hexes may be.",
    "  *Edge* is how common the terrain is along the map border (1 = as anywhere).",
    "- **Adjacency**: pairs that may touch, and how often (higher is more likely).",
    "  A pair that isn't listed can never touch, including a terrain next to itself.",
    "  Order doesn't matter, so *A | B* also covers *B | A*.",
    "- **Features** (optional): lines of terrain that are always placed. *From* and *To*",
    "  are `edge`, `none` or a terrain name.",
    "- **Paths** (optional): paths drawn over the terrain. *From* and *To* are `edge`,",
    "  `none`, `path` (joins another path of the same type) or a terrain. *Through*",
    "  is the share of the path on each terrain.",
    "- **Layout** (optional): where each terrain sat in the example map, in a 3×3",
    "  grid. 1 means as common there as anywhere; 3 means three times as common.",
    "- Frontmatter settings (optional): `feature-size`, `directional-bias`, `clumping`,",
    "  `mix-strength`, `scatter`, `randomness`, `edge-strength`, `edge-terrain`,",
    "  `line-width`, `edge-smoothing`, `speck-size`, `keep-rare`, `symmetry`, `spacing`,",
    "  `connected`, `impassable`,",
    "  `mix`, `counts`, `features`, `draw-paths` and `paths` (per route, e.g.",
    "  `Road: edge > peak = count 2, wiggle 1.5, as Trade road`).",
    "",
    "## Terrains",
    "",
    "| Terrain | Weight | Patch % | Shape | Turn | Width | Spacing | Edge |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
    ...model.terrains.map(
      (t) =>
        `| ${cell(t.name)} | ${num(t.weight)} | ${opt(t.patch, 100)} | ${t.shape ?? ""} | ${opt(t.turn)} | ${opt(t.width)} | ${opt(t.spacing)} | ${opt(t.edge)} |`,
    ),
    "",
    "## Adjacency",
    "",
    "| Terrain | Next to | Weight |",
    "| --- | --- | ---: |",
    ...model.adjacency.map((e) => `| ${cell(e.a)} | ${cell(e.b)} | ${num(e.weight)} |`),
    "",
    ...(features.length
      ? [
          "## Features",
          "",
          "| Terrain | From | To | Count |",
          "| --- | --- | --- | ---: |",
          ...features.map((f) => `| ${cell(f.terrain)} | ${cell(f.from)} | ${cell(f.to)} | ${num(f.count)} |`),
          "",
        ]
      : []),
    ...(model.paths?.length
      ? [
          "## Paths",
          "",
          "| Path | From | To | Count | Turn | Length % | Through |",
          "| --- | --- | --- | ---: | ---: | ---: | --- |",
          ...model.paths.map(
            (p) =>
              `| ${cell(p.type)} | ${cell(p.from)} | ${cell(p.to)} | ${num(p.count)} | ${num(p.turn)} | ${num(p.length * 100)} | ${cell(
                Object.entries(p.through).map(([t, v]) => `${t} ${num(v * 100)}%`).join("; "),
              )} |`,
          ),
          "",
        ]
      : []),
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

type Section = "terrains" | "adjacency" | "features" | "paths" | "layout";
const SECTIONS: readonly Section[] = ["terrains", "adjacency", "features", "paths", "layout"];

/**
 * Parse a model file. Throws if the text isn't a hex-wfc file at all; bad
 * individual rows and settings become warnings instead.
 */
export function parseModelMarkdown(text: string, fallbackName = "Untitled"): ParseResult {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const meta: Record<string, string> = {};
  const settings: Record<string, unknown> = {};
  let exampleHexes: number | undefined;
  let name = "";
  let version: number | null = null;
  const fieldByKey = new Map(
    (Object.entries(SETTING_KEYS) as [keyof GeneratorSettings, string][]).map(([f, k]) => [k, f]),
  );

  let i = 0;
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = /^([^:#\s][^:]*):(.*)$/.exec(lines[i]);
      if (!m) continue;
      const key = m[1].trim();
      const value = parseYamlValue(m[2]);
      const field = fieldByKey.get(key);
      if (key === MARKER) version = Number(value);
      else if (key === "name") name = value;
      else if (key === EXAMPLE_KEY) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) exampleHexes = n;
      } else if (field) {
        const decoded = decodeSetting(field, value);
        if ("error" in decoded) warnings.push(`Setting "${key}: ${value}" ${decoded.error}, ignored`);
        else settings[field] = decoded.value;
      } else meta[key] = value;
    }
    i++;
  }
  if (version === null) throw new Error(`Not a ${MARKER} file (missing "${MARKER}:" in the frontmatter)`);
  if (version > FORMAT_VERSION)
    warnings.push(`File is ${MARKER} version ${version}; this reader understands version ${FORMAT_VERSION}`);

  let section: Section | null = null;
  let headerSeen = false;
  // Column index by lower-cased header name; positions are the fallback for
  // the required columns so older or hand-made tables still work.
  let columns = new Map<string, number>();
  const model: HexWfcModel = { name: "", terrains: [], adjacency: [], meta };
  const features: NonNullable<HexWfcModel["features"]> = [];
  const paths: NonNullable<HexWfcModel["paths"]> = [];
  const layouts = new Map<string, number[]>();
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
      section = SECTIONS.includes(title as Section) ? (title as Section) : null;
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
    const col = (colName: string) => {
      const idx = columns.get(colName);
      return idx === undefined ? undefined : cells[idx] || undefined;
    };
    const where = `${section[0].toUpperCase()}${section.slice(1)} row "${cells.join(" | ")}"`;
    if (!cells[0]) continue;

    if (section === "terrains") {
      const w = weightOf(col("weight") ?? cells[1], where);
      if (w === null) continue;
      const entry: TerrainEntry = { name: cells[0], weight: w };
      const numberCol = (colName: string, lo: number, hi: number, set: (n: number) => void) => {
        const raw = col(colName);
        if (raw === undefined) return;
        const n = Number(raw.replace(/%$/, ""));
        if (Number.isFinite(n) && n >= lo && n <= hi) set(n);
        else warnings.push(`${where}: ${colName} "${raw}" should be between ${lo} and ${hi}, ignored`);
      };
      numberCol(columns.has("patch %") ? "patch %" : "patch", 0, 100, (n) => (entry.patch = Math.round(n * 1000) / 100000));
      const shape = col("shape")?.toLowerCase();
      if (shape !== undefined) {
        if (GROWTH_SHAPES.includes(shape as GrowthShape)) entry.shape = shape as GrowthShape;
        else warnings.push(`${where}: shape "${shape}" should be ${GROWTH_SHAPES.join(", ")}, ignored`);
      }
      numberCol("turn", 0, 1, (n) => (entry.turn = n));
      numberCol("width", 1, 3, (n) => (entry.width = n));
      numberCol("spacing", 0, 1000, (n) => (entry.spacing = n));
      numberCol("edge", 0, 1000, (n) => (entry.edge = n));
      model.terrains.push(entry);
    } else if (section === "adjacency") {
      if (!cells[1]) {
        warnings.push(`${where}: needs two terrains, row skipped`);
        continue;
      }
      const w = weightOf(cells[2], where);
      if (w !== null) model.adjacency.push({ a: cells[0], b: cells[1], weight: w });
    } else if (section === "features") {
      const count = Number(col("count") ?? "1");
      if (!Number.isFinite(count) || count < 0) {
        warnings.push(`${where}: count should be a number ≥ 0, row skipped`);
        continue;
      }
      features.push({ terrain: cells[0], from: col("from") ?? "none", to: col("to") ?? "none", count });
    } else if (section === "paths") {
      const nums = ["count", "turn", "length %"].map((c) => Number(col(c) ?? (c === "count" ? "1" : "0")));
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
        warnings.push(`${where}: count, turn and length % should be numbers ≥ 0, row skipped`);
        continue;
      }
      const through: Record<string, number> = {};
      for (const item of (col("through") ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
        const m = /^(.*\S)\s+([\d.]+)%?$/.exec(item);
        if (m) through[m[1]] = Math.round(Number(m[2]) * 1000) / 100000;
      }
      paths.push({
        type: cells[0],
        from: col("from") ?? "none",
        to: col("to") ?? "none",
        count: nums[0],
        turn: nums[1],
        length: Math.round(nums[2] * 1000) / 100000,
        through,
      });
    } else {
      const values = LAYOUT_BINS.map((b) => Number(cells[columns.get(b.toLowerCase()) ?? -1]));
      if (values.every((v) => Number.isFinite(v) && v >= 0)) layouts.set(cells[0], values);
      else warnings.push(`${where}: needs 9 numbers ≥ 0 under ${LAYOUT_BINS.join(", ")}, row skipped`);
    }
  }

  for (const [t, values] of layouts) {
    const entry = model.terrains.find((e) => e.name === t);
    if (entry) entry.layout = values;
    else warnings.push(`Layout row "${t}" isn't in the Terrains table, ignored`);
  }
  if (features.length) model.features = features;
  if (paths.length) model.paths = paths;
  if (exampleHexes !== undefined) model.exampleHexes = exampleHexes;
  if (Object.keys(settings).length) model.settings = settings;
  model.name = name || fallbackName;
  return { model, warnings };
}

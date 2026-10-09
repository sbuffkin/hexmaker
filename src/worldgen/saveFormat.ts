/**
 * Generator saves: a quick save of everything on the generator page (the
 * generator's settings, seed, size and palette) plus the map it produced,
 * so a generated map can be kept and reloaded without creating a map.
 *
 * A save is a Markdown note in the generators/saves folder:
 *
 *   ---
 *   hexmaker-save: 1                <- SAVE_FORMAT
 *   hexmaker-version: 1.5.5         <- plugin version that wrote it
 *   name: bay-area-12345
 *   generator: bay-area
 *   generator-path: world/generators/bay-area.md
 *   palette: Default
 *   seed: 12345
 *   size: 38x25
 *   stagger: odd
 *   orientation: flat
 *   created: 2026-10-08
 *   ---
 *   ## Settings      ~~~~json  the generator's settings when saved
 *   ## Terrain       ~~~~hexmaker-terrain  legend + one run-length row per line
 *   ## Paths         ~~~~json  [{ type, route, hexes }]
 *   ## Generator     ~~~~hex-wfc  the whole generator file, so the save loads
 *                    even if the generator was changed, re-learned or deleted
 *
 * The stored terrain is the source of truth: if a later version generates a
 * different map from the same inputs, loading still shows (and creates) the
 * saved one. Pure: no Obsidian imports.
 */

import { VERSION_KEY } from "../compat";
import type { GeneratorSettings } from "../../packages/hex-wfc/src";

export const SAVE_FORMAT = 1;
export const SAVE_MARKER = "hexmaker-save";
/** Code fence for embedded blocks; four tildes so the generator's own content can't close it. */
const FENCE = "~~~~";

export interface GeneratorSave {
  name: string;
  /** Plugin version that wrote the save ("unknown" if it didn't say). */
  version: string;
  format: number;
  created: string;
  generatorName: string;
  generatorPath: string;
  palette: string;
  seed: number;
  cols: number;
  rows: number;
  stagger: "odd" | "even";
  orientation: "flat" | "pointy";
  settings: GeneratorSettings;
  /** Terrain per hex, keyed "x_y" (grid starts at 0_0). */
  cells: Map<string, string>;
  paths: { type: string; route?: string; hexes: string[] }[];
  /** The generator file's full text when saved. */
  generatorMarkdown: string;
}

// ── Terrain grid ──────────────────────────────────────────────────────────

/**
 * Encode a cols×rows grid as a legend line plus one line per row of legend
 * indexes, run-length encoded: "0*5 2 1*3". "-" is an unpainted hex.
 */
export function encodeCells(cells: Map<string, string>, cols: number, rows: number): string {
  const legend: string[] = [];
  const index = new Map<string, number>();
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    const tokens: string[] = [];
    let prev = "", run = 0;
    const flush = () => {
      if (run) tokens.push(run > 1 ? `${prev}*${run}` : prev);
    };
    for (let x = 0; x < cols; x++) {
      const t = cells.get(`${x}_${y}`);
      let tok = "-";
      if (t !== undefined) {
        if (!index.has(t)) {
          index.set(t, legend.length);
          legend.push(t);
        }
        tok = String(index.get(t));
      }
      if (tok === prev) run++;
      else {
        flush();
        prev = tok;
        run = 1;
      }
    }
    flush();
    lines.push(tokens.join(" "));
  }
  return [`legend: ${legend.join("; ")}`, ...lines].join("\n");
}

export function decodeCells(text: string, cols: number, rows: number): { cells: Map<string, string> } | { error: string } {
  const lines = text.split(/\r?\n/);
  const head = lines.shift() ?? "";
  if (!head.startsWith("legend:")) return { error: "the terrain block has no legend line" };
  const legend = head.slice("legend:".length).split(";").map((s) => s.trim()).filter((s) => s !== "");
  const cells = new Map<string, string>();
  for (let y = 0; y < rows; y++) {
    let x = 0;
    for (const tok of (lines[y] ?? "").trim().split(/\s+/).filter(Boolean)) {
      const m = /^(-|\d+)(?:\*(\d+))?$/.exec(tok);
      if (!m) return { error: `row ${y + 1} has "${tok}"` };
      const n = m[2] ? Number(m[2]) : 1;
      for (let k = 0; k < n; k++, x++) {
        if (m[1] === "-") continue;
        const t = legend[Number(m[1])];
        if (t === undefined) return { error: `row ${y + 1} uses terrain #${m[1]}, which isn't in the legend` };
        cells.set(`${x}_${y}`, t);
      }
    }
    if (x !== cols) return { error: `row ${y + 1} has ${x} hexes, expected ${cols}` };
  }
  return { cells };
}

// ── Whole file ────────────────────────────────────────────────────────────

const yaml = (v: string | number) =>
  typeof v === "number" || /^[A-Za-z0-9_][A-Za-z0-9 _./()-]*$/.test(v) ? String(v) : JSON.stringify(v);

/**
 * Point a save's text at a renamed generator: if its `generator-path` is
 * `from.path` (or, with no path, its `generator` is `from.name`), the two
 * lines are rewritten. Anything else, including the save's own copy of the
 * generator, is left as it was. Returns the text unchanged otherwise.
 */
export function retargetSave(text: string, from: { name: string; path: string }, to: { name: string; path: string }): string {
  const fmEnd = text.search(/\r?\n---\s*(\r?\n|$)/);
  if (!text.startsWith("---") || fmEnd < 0) return text;
  const head = text.slice(0, fmEnd), rest = text.slice(fmEnd);
  const value = (key: string): string | undefined => {
    const m = new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "m").exec(head);
    if (!m) return undefined;
    const raw = m[1].trim();
    try {
      return raw.startsWith('"') ? String(JSON.parse(raw)) : raw;
    } catch {
      return raw;
    }
  };
  const path = value("generator-path"), name = value("generator");
  if (!(path ? path === from.path : name === from.name)) return text;
  const set = (h: string, key: string, v: string) =>
    new RegExp(`^${key}:[^\\r\\n]*$`, "m").test(h)
      ? h.replace(new RegExp(`^${key}:[^\\r\\n]*$`, "m"), () => `${key}: ${yaml(v)}`)
      : h;
  return set(set(head, "generator", to.name), "generator-path", to.path) + rest;
}

export function serializeSave(s: GeneratorSave): string {
  const fm = [
    `${SAVE_MARKER}: ${SAVE_FORMAT}`,
    `${VERSION_KEY}: ${yaml(s.version)}`,
    `name: ${yaml(s.name)}`,
    `generator: ${yaml(s.generatorName)}`,
    `generator-path: ${yaml(s.generatorPath)}`,
    `palette: ${yaml(s.palette)}`,
    `seed: ${s.seed}`,
    `size: ${s.cols}x${s.rows}`,
    `stagger: ${s.stagger}`,
    `orientation: ${s.orientation}`,
    `created: ${yaml(s.created)}`,
  ];
  const block = (lang: string, body: string) => `${FENCE}${lang}\n${body.replace(/\s+$/, "")}\n${FENCE}`;
  return [
    "---",
    ...fm,
    "---",
    "",
    `# ${s.name}`,
    "",
    `Generator save from **${s.generatorName}**: seed ${s.seed}, ${s.cols}×${s.rows}. Load it from the terrain generator page.`,
    "",
    "## Settings",
    "",
    block("json", JSON.stringify(s.settings, null, 2)),
    "",
    "## Terrain",
    "",
    block("hexmaker-terrain", encodeCells(s.cells, s.cols, s.rows)),
    "",
    "## Paths",
    "",
    block("json", JSON.stringify(s.paths)),
    "",
    "## Generator",
    "",
    block("hex-wfc", s.generatorMarkdown),
    "",
  ].join("\n");
}

export function isSaveMarkdown(text: string): boolean {
  return new RegExp(`^---\\r?\\n(?:(?!---).*\\r?\\n)*?${SAVE_MARKER}\\s*:`).test(text);
}

function isSavedPath(p: unknown): p is GeneratorSave["paths"][number] {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.type === "string" && Array.isArray(o.hexes) && o.hexes.every((h) => typeof h === "string");
}

/** The body of the fenced block under "## heading". */
function section(text: string, heading: string): string | undefined {
  const re = new RegExp(`^## ${heading}\\s*\\r?\\n[\\s\\S]*?^${FENCE}[^\\n]*\\r?\\n([\\s\\S]*?)^${FENCE}\\s*$`, "m");
  return re.exec(text)?.[1]?.replace(/\r?\n$/, "");
}

/**
 * Read a save written by any version. Later formats should add a migration
 * here keyed on `format` (and `hexmaker-version` if needed) rather than
 * changing how older files are read.
 */
export function parseSave(text: string, fallbackName = "save"): { save: GeneratorSave; warnings: string[] } | { error: string } {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fmMatch) return { error: "no frontmatter" };
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"')) {
      try {
        v = String(JSON.parse(v));
      } catch {
        v = v.slice(1, -1);
      }
    }
    fm[m[1]] = v;
  }
  const format = Number(fm[SAVE_MARKER]);
  if (!Number.isFinite(format)) return { error: "not a generator save" };
  const warnings: string[] = [];
  if (format > SAVE_FORMAT) warnings.push(`Saved in a newer format (${format}); loading what this version understands`);

  const size = /^(\d+)\s*x\s*(\d+)$/i.exec(fm.size ?? "");
  if (!size) return { error: `bad size "${fm.size ?? ""}"` };
  const cols = Number(size[1]), rows = Number(size[2]);

  const terrain = section(text, "Terrain");
  if (terrain === undefined) return { error: "no Terrain block" };
  const decoded = decodeCells(terrain, cols, rows);
  if ("error" in decoded) return { error: `terrain: ${decoded.error}` };

  let settings: GeneratorSettings = {};
  try {
    settings = JSON.parse(section(text, "Settings") ?? "{}") as GeneratorSettings;
  } catch {
    warnings.push("The settings block couldn't be read, so the generator's own settings are used");
  }
  let paths: GeneratorSave["paths"] = [];
  try {
    const raw = JSON.parse(section(text, "Paths") ?? "[]") as unknown;
    if (Array.isArray(raw)) paths = (raw as unknown[]).filter(isSavedPath);
  } catch {
    warnings.push("The paths block couldn't be read, so the save has no paths");
  }

  return {
    save: {
      name: fm.name || fallbackName,
      version: fm[VERSION_KEY] || "unknown",
      format,
      created: fm.created ?? "",
      generatorName: fm.generator ?? "",
      generatorPath: fm["generator-path"] ?? "",
      palette: fm.palette ?? "",
      seed: Number(fm.seed) >>> 0,
      cols,
      rows,
      stagger: fm.stagger === "even" ? "even" : "odd",
      orientation: fm.orientation === "pointy" ? "pointy" : "flat",
      settings,
      cells: decoded.cells,
      paths,
      generatorMarkdown: section(text, "Generator") ?? "",
    },
    warnings,
  };
}

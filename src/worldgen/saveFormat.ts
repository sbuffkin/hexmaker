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
 *   origin: -7,-8                  <- top-left hex (format 2; 0,0 before)
 *   connect-to: the-coast           <- the map it was generated beside, if any
 *   connect-side: east
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
import { noteRefTarget, pathLink } from "../noteFormats";
import { hexKey, hexXY } from "../hexKey";
import type { Side } from "./world";

/**
 * `generator-path` as read: a link (`[[world/generators/bay-area]]`, the
 * form written now, so renaming the generator through Obsidian updates it)
 * or a plain path (older saves) → a vault path ending in ".md". A short
 * link (`[[bay-area]]`, what Obsidian may write after a rename) comes back
 * as `bay-area.md`: the caller resolves it like a link (saves.ts).
 */
export function generatorPathOf(value: string | undefined): string {
  const { target } = noteRefTarget(value ?? "");
  if (!target) return "";
  return /\.md$/i.test(target) ? target : `${target}.md`;
}

/** `generator-path` as written: a link to the generator's note (plain when it can't be one). */
export function generatorPathValue(path: string): string {
  return (path && pathLink(path)) || path;
}

/**
 * 2: `origin` (and `connect-to` / `connect-side`). Format 1 wrote every map
 * from 0,0, so a map that started elsewhere (a neighbour region at -7,-8)
 * lost the hexes left of and above 0,0; see legacyOrigin.
 */
export const SAVE_FORMAT = 2;
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
  /** The grid's top-left hex: `cells` and `paths` use the map's own coordinates. */
  origin: { x: number; y: number };
  /** The map it was generated beside (Connect to), so loading can put it back there. */
  connect?: { anchor: string; side: Side };
  stagger: "odd" | "even";
  orientation: "flat" | "pointy";
  settings: GeneratorSettings;
  /** Terrain per hex, keyed "x_y" (grid starts at `origin`). */
  cells: Map<string, string>;
  paths: { type: string; route?: string; hexes: string[] }[];
  /** The generator file's full text when saved. */
  generatorMarkdown: string;
}

// ── Terrain grid ──────────────────────────────────────────────────────────

const ZERO = { x: 0, y: 0 };

/**
 * Encode a cols×rows grid starting at `origin` as a legend line plus one
 * line per row of legend indexes, run-length encoded: "0*5 2 1*3". "-" is
 * an unpainted hex.
 */
export function encodeCells(cells: Map<string, string>, cols: number, rows: number, origin = ZERO): string {
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
      const t = cells.get(hexKey(origin.x + x, origin.y + y));
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

export function decodeCells(text: string, cols: number, rows: number, origin = ZERO): { cells: Map<string, string> } | { error: string } {
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
        cells.set(hexKey(origin.x + x, origin.y + y), t);
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
  // A link may already point at the new path: Obsidian updates links when
  // the file is renamed (a short link `[[name]]` matches by name).
  const path = generatorPathOf(value("generator-path")), name = value("generator");
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const pointsAt = (p: string) => path === p || (!path.includes("/") && path === base(p));
  if (!(path ? pointsAt(from.path) || pointsAt(to.path) : name === from.name)) return text;
  const set = (h: string, key: string, v: string) =>
    new RegExp(`^${key}:[^\\r\\n]*$`, "m").test(h)
      ? h.replace(new RegExp(`^${key}:[^\\r\\n]*$`, "m"), () => `${key}: ${yaml(v)}`)
      : h;
  const next = set(set(head, "generator", to.name), "generator-path", generatorPathValue(to.path)) + rest;
  return next;
}

export function serializeSave(s: GeneratorSave): string {
  const fm = [
    `${SAVE_MARKER}: ${SAVE_FORMAT}`,
    `${VERSION_KEY}: ${yaml(s.version)}`,
    `name: ${yaml(s.name)}`,
    `generator: ${yaml(s.generatorName)}`,
    `generator-path: ${yaml(generatorPathValue(s.generatorPath))}`,
    `palette: ${yaml(s.palette)}`,
    `seed: ${s.seed}`,
    `size: ${s.cols}x${s.rows}`,
    `origin: ${s.origin.x},${s.origin.y}`,
    ...(s.connect ? [`connect-to: ${yaml(s.connect.anchor)}`, `connect-side: ${s.connect.side}`] : []),
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
    block("hexmaker-terrain", encodeCells(s.cells, s.cols, s.rows, s.origin)),
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

const isSide = (v: string | undefined): v is Side => v === "north" || v === "south" || v === "east" || v === "west";

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

  const originMatch = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(fm.origin ?? "");
  if (fm.origin !== undefined && !originMatch) return { error: `bad origin "${fm.origin}"` };
  let origin = originMatch ? { x: Number(originMatch[1]), y: Number(originMatch[2]) } : { ...ZERO };

  const terrain = section(text, "Terrain");
  if (terrain === undefined) return { error: "no Terrain block" };
  const decoded = decodeCells(terrain, cols, rows, origin);
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
  if (!originMatch) {
    const legacy = legacyOrigin(decoded.cells, cols, rows, paths);
    if (legacy) {
      origin = legacy.origin;
      warnings.push(`An older version saved only part of this map (${legacy.lost} of ${cols * rows} hexes are missing). They come back when the page makes the same map again: the same generator and seed, connected where it was`);
    }
  }
  const side = fm["connect-side"];
  const connect = fm["connect-to"] && isSide(side) ? { anchor: fm["connect-to"], side } : undefined;

  return {
    save: {
      name: fm.name || fallbackName,
      version: fm[VERSION_KEY] || "unknown",
      format,
      created: fm.created ?? "",
      generatorName: fm.generator ?? "",
      generatorPath: generatorPathOf(fm["generator-path"]),
      palette: fm.palette ?? "",
      seed: Number(fm.seed) >>> 0,
      cols,
      rows,
      origin,
      ...(connect ? { connect } : {}),
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

/**
 * Where a format-1 save's map really started. Format 1 wrote rows and
 * columns from 0,0 whatever the grid's origin, so a map starting at -7,-8
 * kept only its hexes from 0,0 on (in their right places) and the rest of
 * each line came out blank. That shows as blank columns on the right and
 * blank rows at the bottom; the origin is minus their count. It's only
 * taken when every path hex then lies inside the grid and at least one is
 * left of or above 0,0 (paths were saved whole), or there are no paths.
 * Returns null for a save that isn't cut off like that.
 */
export function legacyOrigin(
  cells: ReadonlyMap<string, string>,
  cols: number,
  rows: number,
  paths: GeneratorSave["paths"],
): { origin: { x: number; y: number }; lost: number } | null {
  if (!cells.size) return null;
  let maxX = -1, maxY = -1;
  for (const k of cells.keys()) {
    const { x, y } = hexXY(k);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const origin = { x: -(cols - 1 - maxX), y: -(rows - 1 - maxY) };
  if (origin.x === 0 && origin.y === 0) return null;
  const hexes = paths.flatMap((p) => p.hexes.map((h) => hexXY(h)));
  const inside = hexes.every(({ x, y }) => x >= origin.x && x < origin.x + cols && y >= origin.y && y < origin.y + rows);
  const offZero = hexes.some(({ x, y }) => x < 0 || y < 0);
  if (hexes.length && !(inside && offZero)) return null;
  return { origin, lost: cols * rows - cells.size };
}

/**
 * The map to show for a loaded save, given what the page generates now from
 * the same inputs. The same map: `same`. A save missing hexes (legacyOrigin)
 * whose every hex matches: the generated map, which has the lost ones back
 * (`filled` of them). Anything else: the saved map, as the source of truth.
 */
export function mapForSave(
  save: Pick<GeneratorSave, "cells">,
  generated: ReadonlyMap<string, string>,
): { cells: Map<string, string>; same: boolean; filled: number } {
  let matches = true;
  for (const [k, t] of save.cells) if (generated.get(k) !== t) {
    matches = false;
    break;
  }
  if (matches && generated.size === save.cells.size) return { cells: save.cells, same: true, filled: 0 };
  if (matches && generated.size > save.cells.size) return { cells: new Map(generated), same: false, filled: generated.size - save.cells.size };
  return { cells: save.cells, same: false, filled: 0 };
}

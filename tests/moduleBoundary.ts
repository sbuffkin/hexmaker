/**
 * The module boundary scan (plan-code-modules §3.4 rule 1, owner call CM8):
 * how far the core still reaches into a module's code, and how often it
 * still branches on a map type by name. tests/moduleBoundary.test.ts holds
 * the counts to a ratchet (tests/fixtures/moduleBoundary.json): a count may
 * only go down, and when it does the allow-list has to come down with it.
 *
 * The allow-list is edited by hand, never regenerated, so every
 * change to it is a deliberate, reviewed line in a diff.
 *
 * Pure node: no Obsidian imports.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Each module's own code: files under these folders belong to it. */
export const MODULE_DIRS: Record<string, string[]> = {
  space: ["src/space/", "src/modules/space/"],
  "world-maps": ["src/overworld/", "src/modules/world-maps/"],
  world: ["src/modules/world/"],
};

/**
 * The core may import a module only through these files (the registry's
 * two entry points and its shared types). Everything else under
 * src/modules/<id>/ is that module's own.
 */
export const MODULE_ENTRY_POINTS = new Set([
  "src/modules/index.ts",
  "src/modules/runtime.ts",
  "src/modules/registry.ts",
  "src/modules/types.ts",
]);

/**
 * Branches on a map type by name in core code (the "random if statements"
 * of owner note Q7). Each pattern is one decision site.
 */
export const DECISION_PATTERNS: Record<string, RegExp[]> = {
  space: [
    /\bisSpaceMap\b/g,
    /\bisSpacePalette\b/g,
    /\bspaceContext\b/g,
    /[!=]==\s*"space"/g,
    /"space"\s*[!=]==/g,
    /\.(?:has|includes)\("space"\)/g,
    /[!=]==\s*"planet"/g,
  ],
  world: [
    /\.(?:has|includes)\("world"\)/g,
  ],
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(root, p).split(sep).join("/");

/** The module a file belongs to (undefined = core). */
export function ownerOf(file: string): string | undefined {
  if (MODULE_ENTRY_POINTS.has(file)) return undefined;
  for (const [id, dirs] of Object.entries(MODULE_DIRS)) if (dirs.some((d) => file.startsWith(d))) return id;
  return undefined;
}

/** Strip comments (block and line) so prose about "space" never counts. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Value imports (not `import type`, not all-`type` specifier lists). */
function valueImports(text: string): string[] {
  const out: string[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"|import\s+"([^"]+)"|export\s+(?:\*|\{[\s\S]*?\})\s+from\s+"([^"]+)"/g;
  for (const m of text.matchAll(re)) {
    if (m[4]) { out.push(m[4]); continue; }
    if (m[5]) { out.push(m[5]); continue; }
    if (m[1]) continue;
    const spec = m[2].trim();
    const braces = /^\{([\s\S]*)\}$/.exec(spec);
    if (braces) {
      const parts = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length && parts.every((s) => s.startsWith("type "))) continue;
    }
    out.push(m[3]);
  }
  return out;
}

export interface BoundaryCounts {
  /** "core file -> module": value imports of that module's code. */
  imports: Record<string, number>;
  /** "core file -> module": map-type decision sites. */
  decisions: Record<string, number>;
}

export function scanBoundary(): BoundaryCounts {
  const imports: Record<string, number> = {};
  const decisions: Record<string, number> = {};
  for (const abs of walk(join(root, "src"))) {
    const file = rel(abs);
    if (ownerOf(file) !== undefined || MODULE_ENTRY_POINTS.has(file)) continue;
    const text = readFileSync(abs, "utf8");
    const body = code(text);
    for (const spec of valueImports(body)) {
      if (!spec.startsWith(".")) continue;
      let target = rel(resolve(dirname(abs), spec));
      if (!/\.ts$/.test(target)) target += ".ts";
      const owner = ownerOf(target) ?? ownerOf(target.replace(/\.ts$/, "/index.ts"));
      if (!owner) continue;
      const key = `${file} -> ${owner}`;
      imports[key] = (imports[key] ?? 0) + 1;
    }
    for (const [id, patterns] of Object.entries(DECISION_PATTERNS)) {
      const n = patterns.reduce((sum, re) => sum + [...body.matchAll(re)].length, 0);
      if (n) decisions[`${file} -> ${id}`] = n;
    }
  }
  const sorted = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { imports: sorted(imports), decisions: sorted(decisions) };
}

/** Totals per module. */
export function totals(r: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(r)) {
    const id = k.split(" -> ")[1];
    out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

/**
 * Readers for the cells of table rows that set up a map: a size, a
 * generator, its options. Shared by arrival (src/arrival) and the Space
 * module's World types tables. Pure: no imports.
 */

/**
 * The generator a world's submap is made with. Assignable to
 * worldgen/biomeRegion's GeneratorRef (minus the in-memory form):
 * `{ path }` a generator note, `{ builtin }` a shipped generator's slug,
 * `{ id }` a registry id (`procedural:planet-surface`, `wfc:<path>`, …).
 */
export type WorldGeneratorRef = { path: string } | { builtin: string } | { id: string };

/** Inclusive integer range. */
export interface IntRange {
  lo: number;
  hi: number;
}

export interface WorldSizeRange {
  cols: IntRange;
  rows: IntRange;
}

const RANGE_SPLIT = /\s*(?:–|—|\.\.|\bto\b|-)\s*/;

/** "20", "16–24", "16 to 24" → an integer range ≥ 1 (turned round when backwards). */
export function readIntRange(raw: string): IntRange | undefined {
  const parts = raw.trim().split(RANGE_SPLIT).filter((p) => p !== "");
  if (parts.length < 1 || parts.length > 2) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 1)) return undefined;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return { lo, hi };
}

/** "20×14", "20x14", "16–24 × 10–14", "20 by 14" → a size range. */
export function readSize(raw: string): WorldSizeRange | undefined {
  const parts = raw.trim().toLowerCase().split(/\s*(?:×|\*|\bby\b|(?<=[\d\s])x(?=[\s\d]))\s*/).filter((p) => p !== "");
  if (parts.length !== 2) return undefined;
  const cols = readIntRange(parts[0]), rows = readIntRange(parts[1]);
  return cols && rows ? { cols, rows } : undefined;
}

/** A generator ref as a registry id (`{ path }` → `wfc:<path>.md`, `{ builtin }` → `builtin:<slug>`). */
export function generatorRefId(ref: WorldGeneratorRef): string {
  if ("id" in ref) return ref.id;
  if ("builtin" in ref) return `builtin:${ref.builtin}`;
  return `wfc:${/\.md$/i.test(ref.path) ? ref.path : `${ref.path}.md`}`;
}

/** "[[My gen]]" → path; "procedural:x" → id; "preset-volcanic" → builtin; "" / "none" → undefined. */
export function readGenerator(raw: string): WorldGeneratorRef | undefined {
  const t = raw.trim();
  if (!t || /^(none|-|—)$/i.test(t)) return undefined;
  const link = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(t);
  if (link) return { path: link[1].trim() };
  if (t.includes(":")) return { id: t };
  return { builtin: t.toLowerCase() };
}

/** "water=85, climate=lush" (or "water: 85; climate: lush") → options; undefined when unreadable. */
export function readOptions(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const t = raw.trim();
  if (!t) return out;
  for (const pair of t.split(/\s*[,;]\s*/).filter((p) => p !== "")) {
    const m = /^([^=:]+?)\s*[=:]\s*(.+)$/.exec(pair);
    if (!m) return undefined;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}


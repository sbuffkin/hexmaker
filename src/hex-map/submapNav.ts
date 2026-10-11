import { slugify } from "../utils";

/**
 * Pure helpers for submap navigation (breadcrumbs, naming). Kept free of
 * Obsidian imports so they're unit-testable.
 */

/**
 * Ancestors of `start`, root first, excluding `start` itself. Stops at the
 * first map without a parent, on a cycle, or after `max` hops.
 */
export function mapAncestors(
  start: string,
  parentOf: (mapName: string) => string | undefined,
  max = 8,
): string[] {
  const chain: string[] = [];
  const seen = new Set([start]);
  let cur = parentOf(start);
  while (cur && !seen.has(cur) && chain.length < max) {
    chain.unshift(cur);
    seen.add(cur);
    cur = parentOf(cur);
  }
  return chain;
}

/**
 * Default name for a submap created from hex (x, y) of `parentMap`:
 * `<parent>-<x>-<y>` (slugified, as map names are), suffixed `-2`, `-3`, …
 * if taken.
 */
export function defaultSubmapName(
  parentMap: string,
  x: number,
  y: number,
  taken: Iterable<string>,
): string {
  return uniqueMapSlug(`${parentMap}-${x}-${y}`, taken);
}

/**
 * A free folder name (slug) for a map called `name`: slugified, suffixed
 * `-2`, `-3`, … if taken; "submap" when nothing is left of the name.
 */
export function uniqueMapSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name.trim()).replace(/^-+|-+$/g, "") || "submap";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Readable default name for a submap of hex (x, y) (NAV2): the hex's name
 * when it has one, else its terrain and this hex's coordinates
 * ("Barren world 12, 5"), else "<parent display name> x, y". Coordinates
 * never chain: a parent name ending in its own "x, y" loses them (F14: "The
 * Drift 2, 7 12, 5"). With `taken` (other maps' names), a name already
 * used gets " (2)", " (3)", … so it stays unique.
 */
export function defaultSubmapLabel(
  hexName: string | null | undefined,
  parentLabel: string,
  x: number,
  y: number,
  opts: { terrain?: string | null; taken?: Iterable<string> } = {},
): string {
  const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const named = tidy(hexName);
  const terrain = tidy(opts.terrain);
  const parent = tidy(parentLabel).replace(/\s*-?\d+,\s*-?\d+$/, "") || tidy(parentLabel);
  const base = named
    || (terrain ? `${terrain.charAt(0).toUpperCase()}${terrain.slice(1)} ${x}, ${y}` : `${parent} ${x}, ${y}`);
  const used = new Set([...(opts.taken ?? [])].map((t) => tidy(t).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

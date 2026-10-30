/**
 * Names for new maps from a table (plan-tables-everywhere phase 6, the
 * Names role; F14). A map made from a hex (a submap, a region, a place
 * found on arrival) is called, in order:
 *
 *   1. the hex's own name (typed on the parent map);
 *   2. a name rolled on the Names table set on the parent map or a map
 *      above it (Map properties → Generator tables → Names), with the hex's
 *      terrain and terrain type as When context;
 *   3. the hex's terrain and coordinates ("Barren world 12, 5"), as before.
 *
 * A Names table is an ordinary random table: plain-text rows, or rows that
 * link other tables (rolled through) or notes (their name is used). A
 * (nothing) row, or a table that gives nothing here, falls through to 3.
 *
 * Pure: no Obsidian imports.
 */

import { resolveRoll, type TableLookup } from "../random-tables/resolve";
import type { ConditionContext } from "../random-tables/tableConditions";

/** Longest name kept from a table row (longer ones are cut at a word). */
export const MAX_ROLLED_NAME = 60;

/**
 * A rolled cell as a map name: link brackets, a path and `.md` taken off,
 * spaces tidied, characters a note name can't hold dropped, cut to
 * MAX_ROLLED_NAME. Undefined when nothing is left.
 */
export function tidyMapName(raw: string): string | undefined {
  let s = raw.trim();
  const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(s);
  if (link) s = (link[2] ?? link[1]).trim();
  s = s.replace(/\.md$/i, "");
  if (s.includes("/")) s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(/[\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
  if (s.length > MAX_ROLLED_NAME) {
    const cut = s.slice(0, MAX_ROLLED_NAME);
    const space = cut.lastIndexOf(" ");
    s = (space > 20 ? cut.slice(0, space) : cut).trim();
  }
  return s || undefined;
}

/**
 * Roll a name on the Names table `link` (undefined: no table, so no name).
 * Text, a terrain or a linked note's name count; nothing, a loop or an
 * empty table give undefined (the caller falls back to terrain and
 * coordinates). Seeded when `ctx.seed` or `ctx.rand` is given.
 */
export function rollMapName(
  link: string | undefined,
  lookup: TableLookup,
  ctx: ConditionContext & { rand?: () => number; seed?: number } = {},
): string | undefined {
  if (!link || !lookup.table(link)) return undefined;
  const r = resolveRoll(link, lookup, ctx);
  if (r.kind === "text" || r.kind === "terrain" || r.kind === "note") return tidyMapName(r.value);
  return undefined;
}

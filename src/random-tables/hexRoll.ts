/**
 * Rolling a table for a hex: the hex editor's rolls (🎲 / 📖, weather and
 * rumours, "Add to this hex") and the fields of the planned hex generator
 * (plan-hex-generation-workflow) all go through this one function, which
 * rolls on the shared resolver (resolve.ts, plan-tables-everywhere §2.3):
 *
 * - a row that links another table is rolled through (nested rolls, the
 *   loop guard shows ⟲), and the chain is said ("Weather → Storms → hail");
 * - the hex's terrain and terrain type are the When context, so a row
 *   marked `When: terrain: swamp` only comes up on swamp hexes ("roll
 *   again" otherwise);
 * - a `pick: each` table gives one line per row that came up;
 * - a (nothing) row gives no text.
 *
 * Pure: no Obsidian imports.
 */

import { chainLabel, resolveEach, resolveRoll, type Resolved, type TableLookup } from "./resolve";
import type { ConditionContext } from "./tableConditions";

export interface HexRollContext extends Pick<ConditionContext, "terrain" | "type"> {
  rand?: () => number;
  seed?: number;
}

export interface HexRoll {
  /** What to add to the hex: one line per result ("" when nothing came up). */
  text: string;
  /** The rows taken in the table itself (to highlight), in order. */
  rows: number[];
  /** The die face of the table's own roll, when it rolled by its ranges. */
  face?: number;
  /** "Weather → Storms → hail" for each result that went through another table. */
  chains: string[];
  /** The results, as the resolver gave them. */
  results: Resolved[];
}

/** A result as text for the hex: the row's own words (a link's name as written), nothing for (nothing). */
function resultText(r: Resolved): string {
  if (r.kind === "nothing" || r.kind === "empty") return "";
  if (r.kind === "note" || r.kind === "generator") return r.chain[r.chain.length - 1]?.result ?? r.value;
  return r.value;
}

/** Roll the table `link` for a hex (see the top of this file). */
export function rollForHex(link: string, lookup: TableLookup, ctx: HexRollContext = {}): HexRoll {
  const t = lookup.table(link);
  const results = t?.table.pick === "each" ? resolveEach(link, lookup, ctx) : [resolveRoll(link, lookup, ctx)].filter((r) => r.kind !== "empty");
  const own = t?.key;
  const rows = results.flatMap((r) => (r.chain[0] && r.chain[0].table === own ? [r.chain[0].index] : []));
  const face = results.length === 1 ? results[0].chain[0]?.face : undefined;
  const chains = results.filter((r) => r.chain.length > 1).map((r) => chainLabel(r));
  const out: HexRoll = {
    text: results.map(resultText).filter((s) => s.trim() !== "").join("\n"),
    rows,
    chains,
    results,
  };
  if (face !== undefined) out.face = face;
  return out;
}

/**
 * Extra columns of a map note's Paths table, read by header ignoring case
 * and spacing. The map-note format keeps every column it doesn't know;
 * these helpers read and set one. `Overworld path` (a region path
 * projected from an overworld path) is read here too, so regeneration
 * keeps such paths whether or not World maps is built (off hides, never
 * deletes). Pure.
 */

import type { MapPath } from "../types";

/** Region Paths column: the overworld path a projected path came from. */
export const OWNER_COL = "Overworld path";

/** An extra column's value, by header ignoring case and spacing. */
export function extraCell(extra: Record<string, string> | undefined, header: string): string | undefined {
  if (!extra) return undefined;
  const want = header.toLowerCase().replace(/\s+/g, "");
  for (const [h, v] of Object.entries(extra)) if (h.toLowerCase().replace(/\s+/g, "") === want) return v;
  return undefined;
}

/** `extra` with one column set (or removed, for undefined), keeping the header as the note spells it. */
export function withExtraCell(extra: Record<string, string> | undefined, header: string, value: string | undefined): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let spelled = header;
  const want = header.toLowerCase().replace(/\s+/g, "");
  for (const [h, v] of Object.entries(extra ?? {})) {
    if (h.toLowerCase().replace(/\s+/g, "") === want) spelled = h;
    else out[h] = v;
  }
  if (value) out[spelled] = value;
  return Object.keys(out).length ? out : undefined;
}

/** The overworld path a region path was projected from, if any. */
export function ownerOf(p: Pick<MapPath, "extra">): string | undefined {
  return extraCell(p.extra, OWNER_COL)?.trim() || undefined;
}

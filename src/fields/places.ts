/**
 * Places for hex fields (plan-custom-hex-fields phase 1): where the towns,
 * cities and camps of a map are, for place influences and the `near:`
 * When key.
 *
 * A hex is a place of a type when:
 * - its terrain is named like a place type ("City", "Town" terrains), or
 *   its terrain's palette type is one ("settlement"); or
 * - its hex note links a note under Towns (Settlements, …): that note's
 *   `place-type:` property says its type ("city"), else "town". Those
 *   places keep their note (Place.note) for later bookkeeping.
 *
 * Place types: the ones the fields note's influences name, plus town,
 * city, village, camp and settlement (so `near: town 2` works without an
 * influence row).
 *
 * Pure: no Obsidian imports.
 */

import type { HexData } from "../maps/mapNote";
import type { InfluenceDef } from "./fieldTypes";
import type { Place } from "./influence";

export const DEFAULT_PLACE_TYPES: readonly string[] = ["town", "city", "village", "camp", "settlement"];

/** The frontmatter key a place note names its type with. */
export const PLACE_TYPE_KEY = "place-type";

/** Every place type the world knows (lower case): the defaults and the influences'. */
export function placeTypes(influences: readonly InfluenceDef[]): Set<string> {
  return new Set([...DEFAULT_PLACE_TYPES, ...influences.map((i) => i.place.trim().toLowerCase()).filter(Boolean)]);
}

/** Places made by terrain: a terrain named like a place type, or of a place type (its palette type). */
export function terrainPlaces(hexes: ReadonlyMap<string, HexData>, types: ReadonlySet<string>, typeOf: (terrain: string) => string | undefined): Place[] {
  const out: Place[] = [];
  for (const [key, h] of hexes) {
    if (!h.terrain) continue;
    const t = h.terrain.trim().toLowerCase();
    const type = types.has(t) ? t : typeOf(h.terrain)?.trim().toLowerCase();
    if (type && types.has(type)) out.push({ key, type, source: `terrain ${h.terrain}` });
  }
  return out;
}

/** A linked place note's type: its `place-type:` (or `type:` when that is a place type), else "town". */
export function notePlaceType(fm: Record<string, unknown> | undefined, types: ReadonlySet<string>): string {
  const own = fm?.[PLACE_TYPE_KEY] ?? fm?.["place type"];
  if (typeof own === "string" && own.trim()) return own.trim().toLowerCase();
  const t = fm?.type;
  if (typeof t === "string" && types.has(t.trim().toLowerCase())) return t.trim().toLowerCase();
  return "town";
}

/** The parts of a metadata cache the Towns links are read from. */
export interface SectionCache {
  headings?: { heading: string; level: number; position: { start: { offset: number } } }[];
  links?: { link: string; position: { start: { offset: number } } }[];
}

/** The links under the heading `isSection` picks, up to the next heading at its level or above. */
export function linksUnderHeading(cache: SectionCache | null | undefined, isSection: (heading: string) => boolean): string[] {
  const hs = cache?.headings ?? [];
  const out: string[] = [];
  hs.forEach((h, i) => {
    if (!isSection(h.heading)) return;
    const start = h.position.start.offset;
    const next = hs.slice(i + 1).find((n) => n.level <= h.level);
    const end = next ? next.position.start.offset : Infinity;
    for (const l of cache?.links ?? []) if (l.position.start.offset > start && l.position.start.offset < end) out.push(l.link);
  });
  return out;
}

/** The places within `radius` of a hex, with distances (the `near:` When key's context). */
export function placesNear(places: readonly Place[], distanceTo: (key: string) => number): { type: string; distance: number }[] {
  return places.map((p) => ({ type: p.type, distance: distanceTo(p.key) }));
}

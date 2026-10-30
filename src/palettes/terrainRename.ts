/**
 * Terrains renamed by hand in a palette note (#43).
 *
 * Hexes name their terrain, so renaming a row in the palette note leaves
 * every hex that used the old name with a terrain the palette no longer
 * has. The palette store compares each revision of the note with the one
 * before; a name that went and a name that came in its place (the same
 * row, or the same colour) is a rename candidate. Nothing is changed until
 * the person clicks "Rename everywhere" (renameOffer.ts).
 *
 * Pure: no Obsidian imports.
 */

import type { TerrainColor } from "../types";

export interface TerrainRename {
  from: string;
  to: string;
}

const sameColor = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Renames between two revisions of a palette's terrains: a name gone from
 * `before` paired with a name new in `after` that sits in the same row or
 * has the same colour. Only pairs with one possible reading count (two new
 * terrains with the gone one's colour is no rename). Names are matched as
 * written; a change of case is a rename too.
 */
export function detectTerrainRenames(before: readonly TerrainColor[], after: readonly TerrainColor[]): TerrainRename[] {
  const beforeNames = new Set(before.map((t) => t.name));
  const afterNames = new Set(after.map((t) => t.name));
  const gone = before.map((t, i) => ({ t, i })).filter(({ t }) => !afterNames.has(t.name));
  const added = after.map((t, i) => ({ t, i })).filter(({ t }) => !beforeNames.has(t.name));
  if (!gone.length || !added.length) return [];
  const fits = (g: { t: TerrainColor; i: number }, a: { t: TerrainColor; i: number }) =>
    g.i === a.i || sameColor(g.t.color, a.t.color);
  const out: TerrainRename[] = [];
  for (const g of gone) {
    const forG = added.filter((a) => fits(g, a));
    if (forG.length !== 1) continue;
    const a = forG[0];
    if (gone.filter((h) => fits(h, a)).length !== 1) continue;
    out.push({ from: g.t.name, to: a.t.name });
  }
  return out;
}

/**
 * Renames still waiting for an answer, with the latest ones folded in: a
 * name typed a letter at a time ("forest" → "w" → "wo" → "woods") is one
 * rename from the first name to the last. A rename is dropped once its old
 * name is back in the palette, its new name has gone, or it was renamed
 * back. `names` are the palette's terrain names now.
 */
export function foldRenames(pending: readonly TerrainRename[], found: readonly TerrainRename[], names: ReadonlySet<string>): TerrainRename[] {
  const out = pending.map((r) => ({ from: r.from, to: r.to }));
  for (const f of found) {
    const prev = out.find((r) => r.to === f.from);
    if (prev) prev.to = f.to;
    else out.push({ from: f.from, to: f.to });
  }
  return out.filter((r) => r.from !== r.to && names.has(r.to) && !names.has(r.from));
}

/** How much still uses a terrain name on the maps of one palette. */
export interface TerrainUse {
  hexes: number;
  /** Maps with hexes of that terrain. */
  hexMaps: string[];
  /** Maps whose base terrain (unpainted hexes) is the name. */
  baseOf: string[];
}

/**
 * Count the hexes (and base terrains) using `name` on `maps`. `hexesOf`
 * gives a map's hex data (MapStore.all).
 */
export function terrainUse(
  name: string,
  maps: readonly { name: string; baseTerrain?: string }[],
  hexesOf: (map: string) => ReadonlyMap<string, { terrain?: string }>,
): TerrainUse {
  const use: TerrainUse = { hexes: 0, hexMaps: [], baseOf: [] };
  for (const m of maps) {
    let n = 0;
    for (const h of hexesOf(m.name).values()) if (h.terrain === name) n++;
    if (m.baseTerrain === name) use.baseOf.push(m.name);
    if (n) use.hexMaps.push(m.name);
    use.hexes += n;
  }
  return use;
}

/**
 * The offer's text, e.g. `"forest" is now "woods" in the Default palette.
 * Still named "forest": 42 hexes on 2 maps, 2 tables.`
 */
export function renameOfferText(palette: string, r: TerrainRename, use: TerrainUse, tables: number): string {
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (use.hexes) parts.push(`${s(use.hexes, "hex", "hexes")} on ${s(use.hexMaps.length, "map")}`);
  if (use.baseOf.length) parts.push(`the base terrain of ${s(use.baseOf.length, "map")}`);
  if (tables) parts.push(s(tables, "table"));
  return `"${r.from}" is now "${r.to}" in the ${palette} palette. Still named "${r.from}": ${parts.join(", ")}.`;
}

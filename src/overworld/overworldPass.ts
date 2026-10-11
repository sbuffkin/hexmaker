/**
 * The overworld first pass (#50), pure part: what a World biomes result
 * writes into an overworld's hexes. Hand-painted (locked) hexes are never
 * written; every other hex gets its biome's terrain, and its biome in the
 * Biome column when the terrain can't say it (a user's biome).
 *
 * Pure: no Obsidian imports.
 */

import type { BiomeId } from "./biomes";

export interface PassHex {
  terrain?: string;
  biome?: string;
  locked?: boolean;
}

export interface PassWrites {
  /** Hex → patch (`biome: null` clears the column). */
  cells: [string, { terrain: string; biome: string | null }][];
  /** Locked hexes left as they were. */
  kept: string[];
}

/**
 * The writes for a result. `readsAs(terrain)` is the biome a terrain stands
 * for on the overworld's palette (biomeForTerrain). Hexes whose biome has
 * no terrain on the palette are left alone.
 */
export function firstPassWrites(
  current: ReadonlyMap<string, PassHex>,
  result: { biomes: ReadonlyMap<string, BiomeId>; terrain: ReadonlyMap<string, string> },
  readsAs: (terrain: string) => BiomeId | undefined,
): PassWrites {
  const cells: PassWrites["cells"] = [];
  const kept: string[] = [];
  for (const [k, biome] of result.biomes) {
    if (current.get(k)?.locked) { kept.push(k); continue; }
    const terrain = result.terrain.get(k);
    if (!terrain) continue;
    const want = readsAs(terrain) === biome ? null : biome;
    const cur = current.get(k);
    if (cur?.terrain === terrain && (cur.biome ?? null) === want) continue;
    cells.push([k, { terrain, biome: want }]);
  }
  return { cells, kept };
}

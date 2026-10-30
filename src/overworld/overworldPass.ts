/**
 * The overworld first pass (#50), pure part: what a World biomes result
 * writes into an overworld's hexes. Hand-painted (locked) hexes are never
 * written; every other hex gets its biome's terrain AND its biome in the
 * Biome column (BC1, owner 2026-10-11: always, not only where the terrain
 * can't say it, so a user's biome is never lost). A blank biome's hex gets
 * no terrain: its region is painted by hand.
 *
 * Also here: filling the Biome column of older overworlds once (the
 * column used to be written only for biomes the terrain couldn't say), and
 * turning some generated hexes into blank ones ("Blank hexes" on the New
 * overworld form).
 *
 * Pure: no Obsidian imports.
 */

import { hexDistance, type Orientation, type Stagger } from "../../packages/hex-wfc/src/grid";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import type { BiomeId } from "./biomes";
import { hexPair } from "../hexKey";

export interface PassHex {
  terrain?: string;
  biome?: string;
  locked?: boolean;
}

export interface PassWrites {
  /** Hex → patch (`terrain: null` clears it: a blank biome). */
  cells: [string, { terrain: string | null; biome: string }][];
  /** Locked hexes left as they were. */
  kept: string[];
}

/**
 * The writes for a result. `refOf(biome)` is what the Biome column says for
 * a biome (biomes.biomeRef: its label). `isBlank(biome)`: a blank biome
 * (its hex is written with no terrain). Hexes whose (non-blank) biome has
 * no terrain on the palette are left alone.
 */
export function firstPassWrites(
  current: ReadonlyMap<string, PassHex>,
  result: { biomes: ReadonlyMap<string, BiomeId>; terrain: ReadonlyMap<string, string> },
  refOf: (biome: BiomeId) => string,
  isBlank: (biome: BiomeId) => boolean = () => false,
): PassWrites {
  const cells: PassWrites["cells"] = [];
  const kept: string[] = [];
  for (const [k, biome] of result.biomes) {
    const cur = current.get(k);
    if (cur?.locked) { kept.push(k); continue; }
    const terrain = isBlank(biome) ? null : result.terrain.get(k);
    if (terrain === undefined) continue;
    const ref = refOf(biome);
    if ((cur?.terrain ?? null) === terrain && cur?.biome === ref) continue;
    cells.push([k, { terrain, biome: ref }]);
  }
  return { cells, kept };
}

/**
 * BC1 migration: the Biome column for every overworld hex that has a biome
 * but no (readable) Biome cell yet. `biomeOf(key)` is the hex's biome as
 * the overworld reads it today (its region's, else its terrain's);
 * `known(ref)` says whether a written cell names a biome (an unreadable
 * one is left as the user wrote it). Returns hex → ref to write.
 */
export function biomeColumnFills(
  hexes: Iterable<string>,
  current: (key: string) => PassHex | undefined,
  biomeOf: (key: string) => BiomeId | undefined,
  refOf: (biome: BiomeId) => string,
): [string, string][] {
  const out: [string, string][] = [];
  for (const k of hexes) {
    if (current(k)?.biome) continue;
    const b = biomeOf(k);
    if (b) out.push([k, refOf(b)]);
  }
  return out;
}

/**
 * Pick `n` hexes of a generated overworld to turn into blank ones (the New
 * overworld form's "Blank hexes"): land hexes first, spread out (each pick
 * is the land hex farthest from the earlier ones, ties broken by the seed),
 * then sea hexes if there isn't enough land. Deterministic for a seed.
 */
export function pickBlankHexes(
  keys: readonly string[],
  sea: ReadonlySet<string>,
  n: number,
  seed: number,
  orientation: Orientation,
  stagger: Stagger,
): string[] {
  const want = Math.max(0, Math.min(keys.length, Math.floor(n)));
  if (!want) return [];
  const rng = mulberry32((seed >>> 0) ^ 0xb1a4c);
  const picked: string[] = [];
  const pickFrom = (pool: string[]) => {
    const left = [...pool];
    while (picked.length < want && left.length) {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < left.length; i++) {
        const d = picked.length ? Math.min(...picked.map((p) => hexDistance(hexPair(p), hexPair(left[i]), orientation, stagger))) : 0;
        const score = d + rng() * 0.5;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      picked.push(left.splice(best, 1)[0]);
    }
  };
  const sorted = [...keys].sort();
  pickFrom(sorted.filter((k) => !sea.has(k)));
  pickFrom(sorted.filter((k) => sea.has(k)));
  return picked;
}

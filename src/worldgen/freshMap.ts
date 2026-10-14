/**
 * A fresh generated map (SF7, owner 2026-10-14: "a Reroll / Lock bar on a
 * new map until its first edit, same rule as regions"). New map → Generate
 * keeps how the map was made in its note, readably:
 *
 *   generator: procedural:overland
 *   generator-options: water=30, sea=west, paths.River=1
 *   generator-seed: 123456
 *   arrival: open
 *
 * While `arrival: open`, the map's bar offers Reroll (the same generator,
 * options, palette, size and neighbours with a new seed) and Lock; the first
 * hand edit locks it (workMode.handEditLocks), as for a new region. Once
 * locked only God may reroll it.
 *
 * Pure, no Obsidian imports.
 */

import type { MapData } from "../types";
import { readOptions } from "./cellReaders";

/** How a map was generated: what Reroll runs again. */
export interface MapRecipe {
  /** The generator's registry id (`procedural:overland`, `builtin:<slug>`, `wfc:<path>`). */
  generator: string;
  options: Record<string, string>;
  seed: number;
}

/** Options as written in the note: "water=30, sea=west" (read back with readOptions). Sorted, so it doesn't churn. */
export function formatOptions(options: Readonly<Record<string, string>>): string {
  return Object.keys(options)
    .filter((k) => options[k] !== undefined && options[k] !== "")
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join(", ");
}

/** Record how a fresh map was made, and open it for rerolls. */
export function setRecipe(map: Pick<MapData, "arrival" | "generator" | "generatorOptions" | "generatorSeed">, r: MapRecipe, open = true): void {
  map.generator = r.generator;
  const opts = formatOptions(r.options);
  if (opts) map.generatorOptions = opts;
  else delete map.generatorOptions;
  map.generatorSeed = r.seed >>> 0;
  if (open) map.arrival = "open";
}

/** The recipe a map keeps (undefined when it has none or its options can't be read). */
export function recipeOf(map: Pick<MapData, "generator" | "generatorOptions" | "generatorSeed"> | undefined): MapRecipe | undefined {
  const generator = map?.generator?.trim();
  if (!generator) return undefined;
  const options = readOptions(map?.generatorOptions ?? "");
  if (!options) return undefined;
  const seed = typeof map?.generatorSeed === "number" && Number.isFinite(map.generatorSeed) ? map.generatorSeed >>> 0 : 0;
  return { generator, options, seed };
}

/**
 * The seed a reroll uses: a new one from the last (seeded, so it's the
 * same sequence wherever it runs; never the same seed again).
 */
export function nextRecipeSeed(seed: number): number {
  // xorshift32 step: never 0 for a non-zero start.
  let x = (seed >>> 0) || 0x9e3779b9;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x === (seed >>> 0) ? (x + 1) >>> 0 : x;
}

/** The plugin side: record the recipe on map `name` (saved with the next settings save). */
export function markFreshMap(plugin: { getMap(name: string): MapData | undefined }, name: string, r: MapRecipe): void {
  const map = plugin.getMap(name);
  if (map) setRecipe(map, r);
}

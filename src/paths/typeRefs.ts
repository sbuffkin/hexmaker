/**
 * A path type's references across a map's paths (PathTypeEditorModal:
 * rename and delete a type). Type names are references into the palette,
 * compared exactly; nothing here interprets them. Pure.
 */

import type { MapPath, PathChain } from "../types";

/** How many paths use type `name`. */
export function countPathsOfType(paths: readonly MapPath[], name: string): number {
  return paths.filter((p) => p.typeName === name).length;
}

/** Point every path of type `from` at `to` (in place). Returns how many changed. */
export function renamePathTypeInPaths(paths: MapPath[], from: string, to: string): number {
  let n = 0;
  for (const p of paths) {
    if (p.typeName === from) {
      p.typeName = to;
      n++;
    }
  }
  return n;
}

/** The paths without those of type `name` (a deleted type takes its paths with it). */
export function removePathTypeFromPaths(paths: readonly MapPath[], name: string): MapPath[] {
  return paths.filter((p) => p.typeName !== name);
}

/**
 * The same two edits on legacy chains, for as long as maps store
 * `pathChains` (the Phase-3 adapter in mapPaths.ts). Phase 3 switches the
 * modal to the MapPath functions above and deletes these.
 */
export function renamePathTypeInChains(chains: PathChain[], from: string, to: string): number {
  let n = 0;
  for (const c of chains) {
    if (c.typeName === from) {
      c.typeName = to;
      n++;
    }
  }
  return n;
}

export function removePathTypeFromChains(chains: readonly PathChain[], name: string): PathChain[] {
  return chains.filter((c) => c.typeName !== name);
}

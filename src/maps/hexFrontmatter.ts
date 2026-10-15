/**
 * Hex data read from already-fetched hex-note frontmatter (the fallback
 * before the map store is ready, and for hex notes outside a map folder),
 * plus the terrain of just-written notes not yet indexed. Pure (no
 * obsidian): tests/fixtures/pureFiles.json. The store-backed facade is
 * maps/hexData.ts.
 */
import type { Frontmatter } from "../notes/frontmatterText";

/**
 * Pure extractors that read already-fetched frontmatter. The hex-grid render
 * loop fetches frontmatter ONCE per hex (getAbstractFileByPath + getFileCache)
 * and feeds it to all three — instead of calling the three `*FromFile` helpers
 * in hexData.ts, which each re-fetch the same cache (3× the lookups per hex,
 * ~11.5k redundant ops on a 3843-hex map).
 */
export function terrainFromFm(fm: Frontmatter | null | undefined): string | null {
  return typeof fm?.terrain === "string" ? fm.terrain : null;
}

export function iconOverrideFromFm(fm: Frontmatter | null | undefined): string | null {
  return typeof fm?.icon === "string" ? fm.icon : null;
}

export function gmIconsFromFm(fm: Frontmatter | null | undefined): string[] {
  if (!fm) return [];
  const arr = fm["gm-icons"];
  if (Array.isArray(arr)) {
    return arr.filter((v): v is string => typeof v === "string");
  }
  const legacy = fm["gm-icon"];
  return typeof legacy === "string" ? [legacy] : [];
}

/**
 * Terrain of hex notes this plugin just wrote whose frontmatter Obsidian
 * hasn't indexed yet. Creating a map writes thousands of notes and opens it
 * straight away; without this the first render shows most hexes blank and
 * nothing re-renders when the index catches up. Cleared per note when its
 * metadata arrives (HexmakerPlugin listens for "changed").
 */
const pendingTerrain = new Map<string, string>();

export function notePendingTerrain(path: string, terrain: string): void {
  pendingTerrain.set(path, terrain);
}

export function clearPendingTerrain(path?: string): void {
  if (path === undefined) pendingTerrain.clear();
  else pendingTerrain.delete(path);
}

/** Terrain of a just-written note that isn't indexed yet, if any. */
export function pendingTerrainOf(path: string): string | null {
  return pendingTerrain.get(path) ?? null;
}

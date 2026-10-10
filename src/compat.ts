/**
 * Versions and backwards compatibility for things the plugin writes to disk.
 *
 * Every generator file, generator save and map records the plugin version
 * that wrote it, so a later version can load it "as best it can" and, if a
 * format ever changes, migrate by version. One example of each per released
 * version lives in tests/fixtures/compat/<version>/ and is loaded by
 * tests/compat.test.ts; `npm run version` snapshots the new version's set.
 *
 * Pure (no Obsidian imports), so tests and the snapshot script can use it.
 */

import type { MapData } from "./types";

/** Frontmatter key recording the plugin version that last wrote a file. */
export const VERSION_KEY = "hexmaker-version";

/** Set by esbuild from manifest.json (see esbuild.config.mjs); absent in tests. */
declare const __HEXMAKER_VERSION__: string | undefined;

/**
 * The plugin version this build is, or the manifest Obsidian loaded, or
 * "unknown" (tests, stubs). The build constant comes first because Obsidian
 * keeps the manifest from startup, which is stale after an in-place update.
 */
export function pluginVersion(plugin: { manifest?: { version?: string } }): string {
  if (typeof __HEXMAKER_VERSION__ === "string") return __HEXMAKER_VERSION__;
  return plugin.manifest?.version ?? "unknown";
}

/**
 * Compare dotted versions ("1.5.10" > "1.5.9"). Unknown or malformed
 * versions sort first, so they're treated as the oldest.
 */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const parts = (v: string | undefined) => (v && /^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : null);
  const pa = parts(a), pb = parts(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Default palette for maps saved before maps had one. */
export const LEGACY_PALETTE_NAME = "Default";

/**
 * Bring a map entry from data.json (any version) up to the current shape.
 * Fills fields older versions didn't have; never drops unknown fields, so a
 * map saved by a newer version survives a round trip through an older one.
 */
export function migrateMapData(raw: unknown, defaultPalette = LEGACY_PALETTE_NAME): MapData {
  const r = (raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {}) as Partial<MapData> & Record<string, unknown>;
  if (typeof r.name !== "string") r.name = String(r.name ?? "map");
  if (!r.paletteName) r.paletteName = defaultPalette;
  if (!r.gridSize || typeof r.gridSize !== "object") r.gridSize = { cols: 0, rows: 0 };
  if (!r.gridOffset) r.gridOffset = { x: 0, y: 0 };
  if (!Array.isArray(r.pathChains)) r.pathChains = [];
  // Before path types (≤ 1.2): roads and rivers as two lists of hex chains.
  // Their conversion was lost in 5e475da; bring such maps' paths across.
  for (const [key, typeName] of [["roadChains", "Road"], ["riverChains", "River"]] as const) {
    const old = r[key];
    if (!Array.isArray(old)) continue;
    for (const c of old) {
      if (Array.isArray(c) && c.length) r.pathChains.push({ typeName, hexes: c.map(String) });
    }
    delete r[key];
  }
  return r as MapData;
}

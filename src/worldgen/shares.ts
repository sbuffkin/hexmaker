/**
 * Terrain shares for the generator page: how much of a map each terrain
 * covers, so the Advanced table can show what a mix or count change does.
 */

import type { HexWfcModel } from "../../packages/hex-wfc/src";

/** Fraction of hexes (0–1) per terrain in a generated map. */
export function terrainShares(cells: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of cells.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  const total = cells.size || 1;
  return new Map([...counts].map(([t, n]) => [t, n / total]));
}

/** The learned mix: each terrain's weight as a fraction of all weights. */
export function exampleShares(model: HexWfcModel): Map<string, number> {
  const total = model.terrains.reduce((sum, t) => sum + Math.max(0, t.weight), 0) || 1;
  return new Map(model.terrains.map((t) => [t.name, Math.max(0, t.weight) / total]));
}

/** True when the model has per-terrain mix or count settings. */
export function hasTerrainTweaks(model: HexWfcModel): boolean {
  const s = model.settings ?? {};
  return Object.keys(s.mix ?? {}).length > 0 || Object.keys(s.counts ?? {}).length > 0;
}

/** The same model with per-terrain mix and counts dropped (everything else kept). */
export function withoutTerrainTweaks(model: HexWfcModel): HexWfcModel {
  const settings = { ...(model.settings ?? {}) };
  delete settings.mix;
  delete settings.counts;
  return { ...model, settings };
}

/** "12%", or "<1%" for a terrain that's present but rare. */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** Change in percentage points, e.g. "+6", "−3", or "" when it rounds to 0. */
export function formatShareChange(now: number, before: number): string {
  const d = Math.round((now - before) * 100);
  if (d === 0) return "";
  return d > 0 ? `+${d}` : `−${-d}`;
}

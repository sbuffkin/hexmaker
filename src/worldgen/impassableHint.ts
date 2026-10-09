/**
 * Suggest which terrains a generator should treat as impassable, without
 * knowing what any terrain is.
 *
 * Main signal: the example's paths. A terrain that covers a good part of the
 * region but that no path type ever ran through (ends don't count: a river
 * may end in the sea) is something the paths went around. It's only
 * suggested when a miss that complete would be very unlikely by chance, so
 * small terrains the paths simply weren't drawn near aren't suggested.
 *
 * Fallback, only for generators without paths: a big terrain that looks like
 * water (blue, or named like it).
 */

import type { HexWfcModel, PathFeature } from "../../packages/hex-wfc/src";

export interface ImpassableHint {
  terrain: string;
  reason: string;
}

/** Below this share of the region a terrain isn't suggested. */
const MIN_SHARE = 0.03;
/** A path type "avoids" a terrain if it ran through it at under this fraction of its share. */
const AVOID_RATIO = 0.25;
/** Suggest only if missing it this completely by chance is under this probability. */
const MAX_CHANCE = 0.001;

const WATERY = /\b(ocean|sea|lake|water|shallows|deep|trench|abyss|chasm|lava|magma|void|reef|lagoon|bay)\b/i;

/** Roughly how many hexes a route covered in the example. */
function routeHexes(p: PathFeature, exampleHexes: number): number {
  const side = Math.sqrt(Math.max(exampleHexes, 1));
  return Math.max(3, p.length * side) * Math.max(p.count, 0);
}

/** Hue (0-360) and saturation (0-1) of a #rrggbb colour, or null. */
function hueSat(color: string | undefined): { h: number; s: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function suggestImpassable(
  model: HexWfcModel,
  colors: Map<string, string> = new Map(),
  already: string[] = [],
): ImpassableHint[] {
  const total = model.terrains.reduce((n, t) => n + Math.max(0, t.weight), 0);
  if (total <= 0) return [];
  const taken = new Set(already);
  const candidates = model.terrains
    .map((t) => ({ name: t.name, share: Math.max(0, t.weight) / total }))
    .filter((t) => t.share >= MIN_SHARE && !taken.has(t.name));
  const paths = model.paths ?? [];
  const example = model.exampleHexes ?? total;

  if (paths.length) {
    // Hexes each path type covered, and how many of them were on each terrain
    // (leaving out the terrains a route starts or ends on).
    const byType = new Map<string, { hexes: number; on: Map<string, number> }>();
    for (const p of paths) {
      const hexes = routeHexes(p, example);
      const entry = byType.get(p.type) ?? { hexes: 0, on: new Map<string, number>() };
      entry.hexes += hexes;
      for (const [t, s] of Object.entries(p.through)) {
        if (t === p.from || t === p.to) continue;
        entry.on.set(t, (entry.on.get(t) ?? 0) + s * hexes);
      }
      byType.set(p.type, entry);
    }
    const allHexes = [...byType.values()].reduce((n, e) => n + e.hexes, 0);
    const routes = paths.filter((p) => p.count > 0).length;
    const out: ImpassableHint[] = [];
    for (const c of candidates) {
      const avoidedByAll = [...byType.values()].every((e) => (e.on.get(c.name) ?? 0) / Math.max(e.hexes, 1) < AVOID_RATIO * c.share);
      if (!avoidedByAll) continue;
      // Chance that hexes placed at random would all miss a terrain this big.
      const chance = Math.pow(1 - c.share, allHexes);
      if (chance >= MAX_CHANCE) continue;
      out.push({ terrain: c.name, reason: `${routes} learned route${routes === 1 ? "" : "s"} never cross it, though it covers ${pct(c.share)} of the region` });
    }
    return out.sort((a, b) => a.terrain.localeCompare(b.terrain));
  }

  // No paths to go on: only big terrain that looks like water.
  const out: ImpassableHint[] = [];
  for (const c of candidates) {
    if (c.share < 0.05) continue;
    const hs = hueSat(colors.get(c.name));
    const blue = !!hs && hs.h >= 185 && hs.h <= 250 && hs.s >= 0.25;
    const named = WATERY.test(c.name);
    if (!blue && !named) continue;
    out.push({
      terrain: c.name,
      reason: `looks like water (${[named ? "its name" : "", blue ? "its colour" : ""].filter(Boolean).join(" and ")}) and covers ${pct(c.share)}; there are no paths to tell for sure`,
    });
  }
  return out.sort((a, b) => a.terrain.localeCompare(b.terrain));
}

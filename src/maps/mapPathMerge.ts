/**
 * MapStore's pure path helpers (moved out of MapStore.ts, which re-exports
 * them): the three-way merge of hand-edited paths and the per-path route stats
 * written to the map note.
 */
import type { MapPath } from "../types";
import type { PathRouteStats } from "./mapNote";
import type { ResolvedBranch } from "../paths/resolve";
import { pathNameKey } from "../paths/names";

/**
 * Three-way merge of a map's paths by name (ignoring case and spacing):
 * `base` is what the note held when we last read or wrote it, `theirs` what
 * it holds now (hand edits, sync), `ours` the paths in memory (edits not yet
 * written). A path they changed, added or removed takes their version;
 * every other path keeps ours. Their order first, then paths only we added.
 */
export function mergePaths(base: readonly MapPath[], theirs: readonly MapPath[], ours: readonly MapPath[]): MapPath[] {
  const key = (p: MapPath) => pathNameKey(p.name);
  const b = new Map(base.map((p) => [key(p), p]));
  const o = new Map(ours.map((p) => [key(p), p]));
  const t = new Map(theirs.map((p) => [key(p), p]));
  const same = (x: MapPath | undefined, y: MapPath | undefined) => JSON.stringify(x) === JSON.stringify(y);
  const out: MapPath[] = [];
  for (const p of theirs) {
    const k = key(p);
    if (!same(b.get(k), p)) out.push(p); // changed or added by hand
    else if (o.has(k)) out.push(o.get(k)!); // ours (maybe edited); removed by us = gone
  }
  for (const p of ours) {
    const k = key(p);
    if (!t.has(k) && !b.has(k)) out.push(p); // added by us
  }
  return out;
}

/** Per path (by pathNameKey): the hexes it covers and the segments drawn straight. */
export function pathRouteStats(paths: readonly MapPath[], resolved: readonly ResolvedBranch[]): Record<string, PathRouteStats> {
  const out: Record<string, PathRouteStats> = {};
  const byName = new Map(paths.map((p) => [p.name, p]));
  const hexes = new Map<string, Set<string>>();
  for (const r of resolved) {
    const k = pathNameKey(r.path);
    let set = hexes.get(k);
    if (!set) { set = new Set(); hexes.set(k, set); }
    for (const h of r.hexes) set.add(h);
    const st = (out[k] ??= { hexes: 0 });
    const anchors = byName.get(r.path)?.branches[r.branch]?.anchors ?? [];
    for (const i of r.fallbackSegments) (st.fallbacks ??= []).push([anchors[i], anchors[i + 1]]);
  }
  for (const [k, set] of hexes) out[k].hexes = set.size;
  return out;
}

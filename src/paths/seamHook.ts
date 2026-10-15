/**
 * Hooking onto a neighbouring map's road or river across the seam (owner
 * O1, 2026-10-14: "make sure you can hook to an existing road/river from a
 * different region neighbour easily via the tool, clicking on it
 * reactivating it and letting you extend it via more clicks").
 *
 * A map that sits in a world (regions of one overworld, or maps placed next
 * to each other) shows its neighbours' hexes just past its edges, the
 * "strip" (neighbourShadow), with their paths on it (ghostPaths.ts). Each
 * map keeps its own paths: a road that runs on into the next map is one
 * path there and one here, their ends on touching hexes across the seam,
 * the same type. The overworld joins them into one line (regionPaths.ts).
 *
 * - **Hook** (seamHooks / hookAt): a neighbour path's open end lying in the
 *   strip, touching this map. Clicking it with the path tool starts a path
 *   here on the hex next to that end (straight on from it where it can),
 *   with the neighbour path's type and name, so the next clicks extend it.
 * - **Same hex, by hand** (hookFor): starting a path of the same type on a
 *   hex touching such an end takes the neighbour path's name too.
 * - **Across** (crossFrom): drawing up to this map's edge, a click in the
 *   strip carries on in the neighbour, from its hex touching the end.
 *
 * Pure: no Obsidian imports. Keys in "this map's frame" are this map's hex
 * keys; a strip hex also knows which map and hex it really is.
 */

import type { HexKey } from "../types";
import { hexNeighbors } from "../../packages/hex-wfc/src/grid";
import { latticeCenter, type LatticeGrid, type Pt } from "./pathGeometry";
import { pathNameKey } from "./names";
import { hexKey } from "../hexKey";

/** A strip hex (this map's frame) → which map and hex it is. */
export interface StripRef {
  map: string;
  x: number;
  y: number;
}

/** One routed branch of a neighbour's path, in that map's own frame. */
export interface NeighbourBranch {
  path: string;
  typeName: string;
  hexes: readonly HexKey[];
  /** Its start sits on another branch (a fork): not an open end. */
  forkFrom?: unknown;
  /** Its end sits on another branch (a join): not an open end. */
  joinTo?: unknown;
}

/** A neighbour path's open end in the strip, touching this map. */
export interface SeamHook {
  map: string;
  path: string;
  typeName: string;
  /** The end hex, in this map's frame. */
  end: HexKey;
  /** The hexes of this map touching the end. */
  touching: HexKey[];
  /** Where a path hooked on here starts: the touching hex straight on from the end. */
  start: HexKey;
  /** The path's run across the strip up to its end (this map's frame), for the click test. */
  run: HexKey[];
}

const parse = (k: HexKey): [number, number] => {
  const i = k.indexOf("_");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/** Neighbours of a hex in this map's lattice. */
export function touchingKeys(key: HexKey, grid: LatticeGrid): HexKey[] {
  return hexNeighbors(...parse(key), grid.orientation, grid.stagger).map(([x, y]) => hexKey(x, y));
}

/** Each neighbour map's offset into this map's frame (maps in a world sit on one grid, shifted). */
function offsets(strip: ReadonlyMap<HexKey, StripRef>): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const [key, ref] of strip) {
    if (out.has(ref.map)) continue;
    const [x, y] = parse(key);
    out.set(ref.map, [x - ref.x, y - ref.y]);
  }
  return out;
}

/**
 * Every neighbour path end that a path here can hook onto. `inMap` says
 * whether a key of this map's frame is one of its own hexes.
 */
export function seamHooks(
  strip: ReadonlyMap<HexKey, StripRef>,
  branchesOf: (map: string) => readonly NeighbourBranch[],
  inMap: (key: HexKey) => boolean,
  grid: LatticeGrid,
): SeamHook[] {
  const out: SeamHook[] = [];
  for (const [map, [dx, dy]] of offsets(strip)) {
    const inStrip = (k: HexKey) => strip.get(k)?.map === map;
    for (const b of branchesOf(map)) {
      if (!b.hexes.length) continue;
      const local = b.hexes.map((k) => {
        const [x, y] = parse(k);
        return hexKey(x + dx, y + dy);
      });
      const ends: { at: number; step: 1 | -1 }[] = [];
      if (!b.forkFrom) ends.push({ at: 0, step: 1 });
      if (!b.joinTo && local.length > 1) ends.push({ at: local.length - 1, step: -1 });
      else if (!b.joinTo && b.forkFrom && local.length === 1) ends.push({ at: 0, step: 1 });
      for (const { at, step } of ends) {
        const end = local[at];
        if (!inStrip(end)) continue;
        const touching = touchingKeys(end, grid).filter(inMap);
        if (!touching.length) continue;
        // The run back from the end while it stays in the strip, end last.
        const run: HexKey[] = [];
        for (let i = at; i >= 0 && i < local.length && inStrip(local[i]); i += step) run.unshift(local[i]);
        // Straight on: past the end, the way the path was heading.
        const c = latticeCenter(end, grid);
        const prev = run.length > 1 ? latticeCenter(run[run.length - 2], grid) : null;
        const ahead: Pt = prev ? { cx: 2 * c.cx - prev.cx, cy: 2 * c.cy - prev.cy } : c;
        const start = nearestKey(ahead, touching, grid) ?? touching[0];
        out.push({ map, path: b.path, typeName: b.typeName, end, touching, start, run });
      }
    }
  }
  return out;
}

/** The key of `keys` whose centre is nearest `p` (ties: the first), or null when empty. */
export function nearestKey(p: Pt, keys: readonly HexKey[], grid: LatticeGrid): HexKey | null {
  let best: HexKey | null = null;
  let bestD = Infinity;
  for (const k of keys) {
    const c = latticeCenter(k, grid);
    const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** How near (lattice units, a hex's centre-to-corner is 1) a click must be to a hooked path's run. */
export const HOOK_R = 0.8;

function distToRun(p: Pt, run: readonly HexKey[], grid: LatticeGrid): number {
  const pts = run.map((k) => latticeCenter(k, grid));
  let best = Math.hypot(p.cx - pts[0].cx, p.cy - pts[0].cy);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.cx - a.cx) * dx + (p.cy - a.cy) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.cx + t * dx - p.cx, a.cy + t * dy - p.cy));
  }
  return best;
}

/** The hook whose run in the strip is under lattice point `p` (the nearest), or null. */
export function hookAt(p: Pt, hooks: readonly SeamHook[], grid: LatticeGrid): SeamHook | null {
  let best: SeamHook | null = null;
  let bestD = Infinity;
  for (const h of hooks) {
    const d = distToRun(p, h.run, grid);
    if (d <= HOOK_R && d < bestD - 1e-9) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** A neighbour path of type `typeName` whose end touches hex `start` of this map (a path started there continues it). */
export function hookFor(start: HexKey, typeName: string, hooks: readonly SeamHook[]): SeamHook | null {
  return hooks.find((h) => h.typeName === typeName && h.touching.includes(start)) ?? null;
}

/** The neighbour path's name for a path started here, unless this map already has a path called that. */
export function hookedName(name: string, taken: Iterable<string>): string | null {
  const key = pathNameKey(name);
  for (const t of taken) if (pathNameKey(t) === key) return null;
  return name;
}

/**
 * Carrying a path on across the seam: the active end is on this map's
 * edge and the click `p` is in the strip. The strip hex touching the end
 * nearest the click, as the neighbour's own map and hex, or null when the
 * end doesn't touch the strip (draw up to the edge first).
 */
export function crossFrom(
  activeEnd: HexKey,
  p: Pt,
  strip: ReadonlyMap<HexKey, StripRef>,
  grid: LatticeGrid,
): { map: string; hex: HexKey; local: HexKey } | null {
  const across = touchingKeys(activeEnd, grid).filter((k) => strip.has(k));
  const local = nearestKey(p, across, grid);
  const ref = local ? strip.get(local) : undefined;
  return local && ref ? { map: ref.map, hex: hexKey(ref.x, ref.y), local } : null;
}

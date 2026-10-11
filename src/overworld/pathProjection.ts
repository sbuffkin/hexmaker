/**
 * Overworld paths into regions, the pure part (owner 2026-10-11: "Once you
 * hit 'confirm' for a biome-level path, it should get applied in a
 * reasonable way to the regions it crosses through").
 *
 * A path drawn on an overworld is a draft until it is confirmed. Confirming
 * projects it into every region it crosses:
 *
 * - **Seams.** Where the overworld path steps from hex P to hex Q, the two
 *   regions agree on the pair of cells it crosses by: one in P's region,
 *   its neighbour in Q's. The pair depends only on the layout, the two hexes
 *   and a salt (world seed + path name), never on terrain or which region
 *   was made first, so a region made later joins up with one made earlier.
 * - **Inside a region** the route runs from where it enters to where it
 *   leaves (or the region's centre, where the path starts or ends there)
 *   through the region's own terrain with the path type's routing.
 * - **Ownership.** A projected path carries the overworld path's name in
 *   its "Overworld path" column; re-confirming replaces only those, never a
 *   path the user drew in the region. The overworld path's "Applied" column
 *   says it was confirmed.
 * - **Carving.** A path type may carve terrain (PathType.carves): its hexes
 *   (and, at width 1, the hexes beside them) become that terrain. Locked
 *   (hand-painted) cells are never repainted.
 *
 * Both columns are ordinary extra columns of the map note's Paths table
 * (kept and written back by every reader), so the data stays readable.
 *
 * Pure: no Obsidian imports.
 */

import type { HexKey, MapPath, PathType, TerrainColor } from "../types";
import { hashString } from "../paths/router";
import { pathNameKey, uniquePathName } from "../paths/names";
import { childNeighbours, childPoint, regionCells, regionCentreCell, regionCentrePoint, type RegionLayout } from "./layout";

/** Overworld Paths column: "yes" once a path is confirmed into its regions. */
export const APPLIED_COL = "Applied";
/** Region Paths column: the overworld path a projected path came from. */
export const OWNER_COL = "Overworld path";

const xy = (k: HexKey): [number, number] => {
  const [x, y] = k.split("_").map(Number);
  return [x, y];
};
const key = (x: number, y: number): HexKey => `${x}_${y}`;

// ── the two columns ──────────────────────────────────────────────────────

/** An extra column's value, by header ignoring case and spacing. */
export function extraCell(extra: Record<string, string> | undefined, header: string): string | undefined {
  if (!extra) return undefined;
  const want = header.toLowerCase().replace(/\s+/g, "");
  for (const [h, v] of Object.entries(extra)) if (h.toLowerCase().replace(/\s+/g, "") === want) return v;
  return undefined;
}

/** `extra` with one column set (or removed, for undefined), keeping the header as the note spells it. */
export function withExtraCell(extra: Record<string, string> | undefined, header: string, value: string | undefined): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let spelled = header;
  const want = header.toLowerCase().replace(/\s+/g, "");
  for (const [h, v] of Object.entries(extra ?? {})) {
    if (h.toLowerCase().replace(/\s+/g, "") === want) spelled = h;
    else out[h] = v;
  }
  if (value) out[spelled] = value;
  return Object.keys(out).length ? out : undefined;
}

const APPLIED_WORDS = ["yes", "y", "true", "x", "done", "applied", "confirmed", "✓", "✔"];

/** Read forgivingly: yes, y, true, x, ✓, done, applied. */
export function isApplied(p: Pick<MapPath, "extra">): boolean {
  const first = (extraCell(p.extra, APPLIED_COL) ?? "").trim().toLowerCase().split(/[\s,.;]+/)[0];
  return APPLIED_WORDS.includes(first);
}

/** The path with its Applied cell set (yes) or cleared. */
export function withApplied<P extends MapPath>(p: P, on: boolean): P {
  const extra = withExtraCell(p.extra, APPLIED_COL, on ? "yes" : undefined);
  const out = { ...p };
  if (extra) out.extra = extra;
  else delete out.extra;
  return out;
}

/** The overworld path a region path was projected from, if any. */
export function ownerOf(p: Pick<MapPath, "extra">): string | undefined {
  return extraCell(p.extra, OWNER_COL)?.trim() || undefined;
}

/** Geometry and type of a path (what a projection depends on). */
function shapeKey(p: MapPath): string {
  return JSON.stringify([p.typeName, p.branches.map((b) => b.anchors)]);
}

/**
 * After an edit to an overworld map's paths: a confirmed path whose route,
 * type or name changed is a draft again (its regions show the old route
 * until it is confirmed again). Returns `after` itself when nothing changes.
 */
export function draftsAfterEdit(before: readonly MapPath[], after: MapPath[]): MapPath[] {
  const old = new Map(before.map((p) => [pathNameKey(p.name), p]));
  let changed = false;
  const out = after.map((p) => {
    if (!isApplied(p)) return p;
    const was = old.get(pathNameKey(p.name));
    if (was && isApplied(was) && shapeKey(was) === shapeKey(p)) return p;
    changed = true;
    return withApplied(p, false);
  });
  return changed ? out : after;
}

// ── seams ────────────────────────────────────────────────────────────────

/**
 * The cells where a path crossing from parent hex P's region into Q's
 * crosses: [cell in P's region, its neighbour in Q's], or null when the two
 * regions don't touch. The same for P→Q and Q→P (swapped), so both regions
 * agree. The pair is taken near the middle of the shared edge, nudged by
 * `salt` so two paths over one seam don't overlap.
 */
export function seamCrossing(layout: RegionLayout, p: [number, number], q: [number, number], salt: string): [HexKey, HexKey] | null {
  const pk = key(p[0], p[1]), qk = key(q[0], q[1]);
  const [u, v] = pk < qk ? [p, q] : [q, p];
  const vCells = new Set(regionCells(layout, v[0], v[1]).map(([x, y]) => key(x, y)));
  const pairs: [HexKey, HexKey][] = [];
  for (const [x, y] of regionCells(layout, u[0], u[1])) {
    for (const [a, b] of childNeighbours(layout, x, y)) {
      const nk = key(a, b);
      if (vCells.has(nk)) pairs.push([key(x, y), nk]);
    }
  }
  if (!pairs.length) return null;
  // Along the shared edge: across the line between the two regions' centres.
  const [ux, uy] = regionCentrePoint(layout, u[0], u[1]);
  const [vx, vy] = regionCentrePoint(layout, v[0], v[1]);
  const tx = -(vy - uy), ty = vx - ux;
  const along = ([a, b]: [HexKey, HexKey]) => {
    const [ax, ay] = childPoint(layout, ...xy(a));
    const [bx, by] = childPoint(layout, ...xy(b));
    return ((ax + bx) / 2) * tx + ((ay + by) / 2) * ty;
  };
  const sorted = pairs
    .map((pr) => ({ pr, t: along(pr) }))
    .sort((a, b) => a.t - b.t || (a.pr[0] < b.pr[0] ? -1 : a.pr[0] > b.pr[0] ? 1 : a.pr[1] < b.pr[1] ? -1 : 1))
    .map((s) => s.pr);
  const n = sorted.length;
  const spread = Math.floor(n / 4);
  const h = hashString(`${salt}|${pk < qk ? pk : qk}|${pk < qk ? qk : pk}`) / 4294967296;
  const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) / 2) + Math.round((h * 2 - 1) * spread)));
  const [a, b] = sorted[idx];
  return pk < qk ? [a, b] : [b, a];
}

/** The salt that keeps one path's seams its own: world seed and path name. */
export function seamSalt(worldSeed: number, pathName: string): string {
  return `${worldSeed >>> 0}|${pathNameKey(pathName)}`;
}

// ── projecting one path ──────────────────────────────────────────────────

/** One resolved overworld branch (resolve.ts ResolvedBranch, the parts used here). */
export interface OverworldBranch {
  branch: number;
  hexes: HexKey[];
  forkFrom?: { branch: number };
  joinTo?: { branch: number };
}

/** The route inside region `region` (parent hex key) between two of its cells, inclusive. */
export type RegionRouteFn = (region: HexKey, from: HexKey, to: HexKey) => HexKey[];

/**
 * An overworld path's routes in the regions it crosses: parent hex key →
 * hex chains (child-grid keys), in order (the first is the region path's
 * main line; a later one that starts on an earlier one is a fork). Only
 * regions `wanted` says yes to are routed.
 */
export function projectPath(
  layout: RegionLayout,
  salt: string,
  branches: readonly OverworldBranch[],
  route: RegionRouteFn,
  wanted: (region: HexKey) => boolean,
): Map<HexKey, HexKey[][]> {
  const out = new Map<HexKey, HexKey[][]>();
  const firstIn = new Map<string, HexKey[]>();
  const centre = (r: HexKey) => key(...regionCentreCell(layout, ...xy(r)));
  const midOf = (branch: number, region: HexKey) => {
    const c = firstIn.get(`${branch}|${region}`);
    return c ? c[Math.floor((c.length - 1) / 2)] : undefined;
  };
  const seamMemo = new Map<string, [HexKey, HexKey] | null>();
  const seam = (a: HexKey, b: HexKey) => {
    const k = `${a}>${b}`;
    if (!seamMemo.has(k)) seamMemo.set(k, seamCrossing(layout, xy(a), xy(b), salt));
    return seamMemo.get(k)!;
  };
  for (const b of branches) {
    const H = b.hexes;
    if (H.length < 2) continue;
    const last = H.length - 1;
    for (let i = 0; i <= last; i++) {
      const R = H[i];
      if (!wanted(R)) continue;
      const enter = i > 0 ? seam(H[i - 1], R)?.[1] : undefined;
      const leave = i < last ? seam(R, H[i + 1])?.[0] : undefined;
      const from = enter ?? (i === 0 && b.forkFrom ? midOf(b.forkFrom.branch, R) : undefined) ?? centre(R);
      const to = leave ?? (i === last && b.joinTo ? midOf(b.joinTo.branch, R) : undefined) ?? centre(R);
      const chain = route(R, from, to);
      if (chain.length < 2) continue;
      const list = out.get(R) ?? [];
      list.push(chain);
      out.set(R, list);
      const fk = `${b.branch}|${R}`;
      if (!firstIn.has(fk)) firstIn.set(fk, chain);
    }
  }
  return out;
}

// ── region paths ─────────────────────────────────────────────────────────

/**
 * A region's paths with the ones owned by overworld path `owner` replaced by
 * `next` (or removed, for null). The replacement keeps the old one's place,
 * its name (the user may have renamed it) and notes; a new one gets the
 * overworld path's name, made unique. `alsoOwned` adopts more paths as
 * owned (orphans of a renamed overworld path). User-drawn paths are kept
 * as they are.
 */
export function mergeOwned(
  existing: readonly MapPath[],
  owner: string,
  next: MapPath | null,
  alsoOwned: (p: MapPath) => boolean = () => false,
): MapPath[] {
  const mine = (p: MapPath) => {
    const o = ownerOf(p);
    return (o !== undefined && pathNameKey(o) === pathNameKey(owner)) || (o !== undefined && alsoOwned(p));
  };
  const at = existing.findIndex(mine);
  const old = at >= 0 ? existing[at] : undefined;
  const kept = existing.filter((p) => !mine(p));
  if (!next) return kept;
  const placed: MapPath = { ...next, extra: withExtraCell({ ...(old?.extra ?? {}), ...(next.extra ?? {}) }, OWNER_COL, owner) };
  placed.name = old ? old.name : uniquePathName(next.name, kept.map((p) => p.name));
  if (old?.notes !== undefined && placed.notes === undefined) placed.notes = old.notes;
  const out = [...kept];
  const before = at >= 0 ? existing.slice(0, at).filter((p) => !mine(p)).length : out.length;
  out.splice(before, 0, placed);
  return out;
}

// ── carving ──────────────────────────────────────────────────────────────

/**
 * The terrain a carve setting means on a palette: a terrain of that name
 * (any case), else the palette's first terrain of that terrain type
 * ("water"). Undefined when it names nothing on the palette, or is unset.
 */
export function carveTerrainFor(carves: string | undefined, palette: readonly TerrainColor[]): string | undefined {
  const v = carves?.trim().toLowerCase();
  if (!v) return undefined;
  const byName = palette.find((t) => t.name.toLowerCase() === v);
  if (byName) return byName.name;
  return palette.find((t) => t.type?.toLowerCase() === v)?.name;
}

/** A path type's carve width: 0 (its own hexes) or 1 (and the hexes beside them). */
export function carveWidthOf(t: Pick<PathType, "carveWidth"> | undefined): 0 | 1 {
  return t?.carveWidth === 1 ? 1 : 0;
}

/** The cells a carve covers: the chains' hexes, widened by `width`, kept to `inside`. */
export function carveCells(
  chains: readonly (readonly HexKey[])[],
  width: 0 | 1,
  inside: (k: HexKey) => boolean,
  neighbours: (k: HexKey) => HexKey[],
): Set<HexKey> {
  const out = new Set<HexKey>();
  for (const c of chains) {
    for (const k of c) {
      if (inside(k)) out.add(k);
      if (width === 1) for (const n of neighbours(k)) if (inside(n)) out.add(n);
    }
  }
  return out;
}

/** The writes a carve makes: every cell that isn't locked and isn't that terrain already. */
export function carveWrites(
  cells: Iterable<HexKey>,
  terrain: string,
  now: (k: HexKey) => { terrain?: string; locked?: boolean } | undefined,
): [HexKey, { terrain: string }][] {
  const out: [HexKey, { terrain: string }][] = [];
  for (const k of [...cells].sort()) {
    const h = now(k);
    if (h?.locked || h?.terrain === terrain) continue;
    out.push([k, { terrain }]);
  }
  return out;
}

/** Child-grid neighbours as keys (for carveCells). */
export function childNeighbourKeys(layout: RegionLayout): (k: HexKey) => HexKey[] {
  return (k) => childNeighbours(layout, ...xy(k)).map(([x, y]) => key(x, y));
}

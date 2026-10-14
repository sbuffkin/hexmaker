/**
 * Region paths that cross region seams, joined into overworld lines (owner
 * 2026-10-13: "show cross-region rivers and roads on the overworld map,
 * make them thinner to not crowd it").
 *
 * - **Which.** A branch end on a region's edge meets a branch end of the
 *   same path type in the neighbouring region, the two hexes touching
 *   across the seam. Those pieces are joined into one line; paths that stay
 *   inside one region aren't drawn. A fork of a crossing path is drawn with
 *   it (same region, same path).
 * - **Not twice.** A region path made by confirming an overworld path (its
 *   "Overworld path" column names one that still exists) is left out: the
 *   overworld path itself is already drawn, at overworld scale.
 * - **Thinner.** A type's width (px at the default zoom) times
 *   OW_PATH_SCALE, in the overworld's hexes. Below OW_PATH_MIN the type is
 *   skipped entirely: decided by width, never by name.
 *
 * Pure: no Obsidian imports. The view's cache (CrossRegionPaths) rebuilds a
 * region's pieces only when that region changed.
 */

import type { HexKey, MapPath, PathLineStyle, PathType } from "../types";
import type { ResolvedBranch } from "../paths/resolve";
import { DASH_PX, isSmooth, SCREEN_HEX_RADIUS } from "../paths/pathGeometry";
import { ownerOf } from "../paths/pathColumns";
import { pathNameKey } from "../paths/names";
import { hexCenter } from "../../packages/hex-wfc/src/grid";
import { childNeighbours, childPoint, parentOf, type RegionLayout } from "./layout";
import { affineScale, gridPointToChild, RegionBitmapCache, type Affine } from "./overworldRender";

/** Overworld width of a path = its type's width × this. */
export const OW_PATH_SCALE = 0.5;
/** Narrowest overworld width drawn (px at the default zoom): thinner types are skipped. */
export const OW_PATH_MIN = 1.25;

/** A type's overworld width (px at the default zoom), or null when it's too thin to draw. */
export function overworldPathWidth(typeWidth: number): number | null {
  const w = (Number.isFinite(typeWidth) ? typeWidth : 0) * OW_PATH_SCALE;
  return w >= OW_PATH_MIN ? w : null;
}

/** A type's overworld dash pattern (px at the default zoom; [] = solid). */
export function overworldPathDash(style: PathLineStyle): number[] {
  return (DASH_PX[style] ?? []).map((d) => d * OW_PATH_SCALE);
}

/** One routed branch of one region's path. */
export interface RegionPathPiece {
  region: string;
  path: string;
  typeName: string;
  branch: number;
  hexes: HexKey[];
  /** Can the first / last hex join across a seam (not the start of a fork, not the end of a join). */
  openStart: boolean;
  openEnd: boolean;
  /** The overworld path this one was confirmed from, if any. */
  owner?: string;
}

/** A joined line: hexes in order across the regions it crosses. */
export interface CrossRegionLine {
  typeName: string;
  hexes: HexKey[];
  /** Path names along it (first seen first). */
  names: string[];
  regions: string[];
}

const xy = (k: HexKey): [number, number] => {
  const i = k.indexOf("_");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/** A region's resolved branches → its pieces. */
export function piecesOf(region: string, resolved: readonly ResolvedBranch[], stored: readonly MapPath[]): RegionPathPiece[] {
  const owners = new Map<string, string>();
  for (const p of stored) {
    const o = ownerOf(p);
    if (o) owners.set(pathNameKey(p.name), o);
  }
  return resolved
    .filter((rb) => rb.hexes.length > 0)
    .map((rb) => {
      const owner = owners.get(pathNameKey(rb.path));
      return {
        region,
        path: rb.path,
        typeName: rb.typeName,
        branch: rb.branch,
        hexes: rb.hexes,
        openStart: !rb.forkFrom,
        openEnd: !rb.joinTo,
        ...(owner ? { owner } : {}),
      };
    });
}

/**
 * The pieces that cross a seam, joined into lines. Pieces are in the
 * overworld's shared child grid (every region of one overworld is a block
 * of it), so "touching across a seam" is: the same hex or neighbours in
 * that grid, in different regions. Only pieces that pair with another
 * region's are drawn (with the forks of their paths): a path that stays in
 * one region never is.
 */
export function crossRegionLines(layout: RegionLayout, pieces: readonly RegionPathPiece[]): CrossRegionLine[] {
  // End ids: piece i's start is 2i, its end 2i+1 (a one-hex piece has only its start).
  const endHex = (id: number) => {
    const p = pieces[id >> 1];
    return id & 1 ? p.hexes[p.hexes.length - 1] : p.hexes[0];
  };
  const endIds = (i: number): number[] => {
    const p = pieces[i];
    const out: number[] = [];
    if (p.openStart) out.push(2 * i);
    if (p.hexes.length > 1 && p.openEnd) out.push(2 * i + 1);
    else if (p.hexes.length === 1 && !p.openStart && p.openEnd) out.push(2 * i);
    return out;
  };
  const byHex = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    for (const id of endIds(i)) {
      const k = `${p.typeName}\u0000${endHex(id)}`;
      const list = byHex.get(k);
      if (list) list.push(id);
      else byHex.set(k, [id]);
    }
  });

  // Seam pairs: an open end of a piece in ANOTHER region on the same hex or
  // a touching one (O1: only paths joining two regions or more are drawn;
  // a region's own pieces never pair, even where its map's box runs past
  // its block, as a hex flower's does).
  const partners = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const l = partners.get(a);
    if (!l) partners.set(a, [b]);
    else if (!l.includes(b)) l.push(b);
  };
  pieces.forEach((p, i) => {
    for (const id of endIds(i)) {
      const h = endHex(id);
      for (const n of [h, ...childNeighbours(layout, ...xy(h)).map(([nx, ny]) => `${nx}_${ny}`)]) {
        for (const other of byHex.get(`${p.typeName}\u0000${n}`) ?? []) {
          if (pieces[other >> 1].region === p.region) continue;
          link(id, other);
          link(other, id);
        }
      }
    }
  });

  // Components: seam pairs, plus the branches of one path in one region (its forks).
  const root = pieces.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const union = (a: number, b: number) => { root[find(a)] = find(b); };
  for (const [a, list] of partners) for (const b of list) union(a >> 1, b >> 1);
  const unit = new Map<string, number>();
  pieces.forEach((p, i) => {
    const k = `${p.region}\u0000${pathNameKey(p.path)}`;
    const first = unit.get(k);
    if (first === undefined) unit.set(k, i);
    else union(first, i);
  });
  const crossing = new Set<number>();
  for (const a of partners.keys()) crossing.add(find(a >> 1));
  const drawn = (i: number) => crossing.has(find(i));

  // Walk: from a piece end with no partner (a line's real end), through
  // each partner not yet drawn; whatever is left (loops) from its start.
  const visited = new Set<number>();
  const lines: CrossRegionLine[] = [];
  const walk = (start: number, fromEnd: 0 | 1) => {
    const hexes: HexKey[] = [];
    const names: string[] = [];
    const regions: string[] = [];
    let cur = start, s = fromEnd;
    for (;;) {
      visited.add(cur);
      const p = pieces[cur];
      const seq = s === 0 ? p.hexes : [...p.hexes].reverse();
      for (const h of seq) if (hexes[hexes.length - 1] !== h) hexes.push(h);
      if (!names.includes(p.path)) names.push(p.path);
      if (!regions.includes(p.region)) regions.push(p.region);
      const far = p.hexes.length === 1 ? 2 * cur : 2 * cur + (1 - s);
      const next = (partners.get(far) ?? []).find((id) => !visited.has(id >> 1));
      if (next === undefined) break;
      cur = next >> 1;
      s = (pieces[cur].hexes.length === 1 ? 0 : next & 1) as 0 | 1;
    }
    lines.push({ typeName: pieces[start].typeName, hexes, names, regions });
  };
  pieces.forEach((p, i) => {
    if (!drawn(i) || visited.has(i)) return;
    if (p.openStart && !partners.has(2 * i)) walk(i, 0);
    else if (p.hexes.length > 1 && p.openEnd && !partners.has(2 * i + 1)) walk(i, 1);
  });
  pieces.forEach((p, i) => {
    if (drawn(i) && !visited.has(i)) walk(i, p.openStart || !partners.has(2 * i) ? 0 : 1);
  });
  return lines;
}

/** A line ready to draw: child-plane points and its type's overworld look. */
export interface OverworldPathLine extends CrossRegionLine {
  /** Child-plane centres of its hexes. */
  pts: [number, number][];
  color: string;
  /** Overworld width and dash, px at the default zoom. */
  width: number;
  dash: number[];
  smooth: boolean;
}

/** What the cache reads from the vault (the plugin's paths service and map store). */
export interface RegionPathSource {
  /** The overworld's regions now. */
  regions(): readonly { name: string }[];
  /** Are this region's paths resolvable yet (terrain and palette loaded)? */
  ready(region: string): boolean;
  resolved(region: string): readonly ResolvedBranch[];
  stored(region: string): readonly MapPath[];
  types(region: string): readonly PathType[];
  /** Names of the overworld's own paths (their confirmed copies aren't drawn twice). */
  overworldPaths(): readonly string[];
  /** For a type not in a region's palette. */
  unknownType: PathType;
}

/**
 * The joined lines of one overworld, cached: a region's pieces are rebuilt
 * only after invalidate(region) (its map changed: a path edit, terrain the
 * routes go round) or when its path types change; the lines only when some
 * region's pieces did.
 */
export class CrossRegionPaths {
  readonly pieces = new RegionBitmapCache<RegionPathPiece[]>();
  private joined: { key: string; lines: OverworldPathLine[] } | null = null;
  /** Times the lines were joined (tests and timings). */
  joins = 0;

  invalidate(region: string): void {
    this.pieces.invalidate(region);
  }

  clear(): void {
    this.pieces.clear();
    this.joined = null;
  }

  lines(layout: RegionLayout, src: RegionPathSource): OverworldPathLine[] {
    const regions = src.regions();
    this.pieces.retain(new Set(regions.map((r) => r.name)));
    const builds0 = this.pieces.builds;
    const typesOf = new Map<string, Map<string, PathType>>();
    const all: RegionPathPiece[] = [];
    for (const r of regions) {
      const types = src.types(r.name);
      const byName = new Map<string, PathType>();
      for (const t of types) if (!byName.has(t.name)) byName.set(t.name, t);
      typesOf.set(r.name, byName);
      const ready = src.ready(r.name);
      // Not loaded yet: never cache the empty answer.
      const key = ready ? JSON.stringify(types.map((t) => [t.name, t.width])) : `loading ${this.pieces.builds}`;
      all.push(...this.pieces.get(r.name, key, () => (ready ? piecesOf(r.name, src.resolved(r.name), src.stored(r.name)) : [])));
    }
    const own = [...new Set(src.overworldPaths().map(pathNameKey))].sort();
    const style = JSON.stringify([...typesOf].map(([n, m]) => [n, [...m.values()].map((t) => [t.name, t.color, t.width, t.lineStyle, t.routing])]));
    const key = `${JSON.stringify(layout)}|${regions.map((r) => r.name).join("\u0000")}|${own.join("\u0000")}|${style}`;
    if (this.joined && this.joined.key === key && this.pieces.builds === builds0) return this.joined.lines;

    const owned = new Set(own);
    const typeOf = (p: RegionPathPiece) => typesOf.get(p.region)?.get(p.typeName) ?? { ...src.unknownType, name: p.typeName };
    const shown = all.filter((p) => !(p.owner && owned.has(pathNameKey(p.owner))) && overworldPathWidth(typeOf(p).width) !== null);
    const firstOf = new Map<string, RegionPathPiece>();
    for (const p of shown) if (!firstOf.has(p.typeName)) firstOf.set(p.typeName, p);
    const lines = crossRegionLines(layout, shown).map((l): OverworldPathLine => {
      const t = typeOf(firstOf.get(l.typeName)!);
      return {
        ...l,
        pts: l.hexes.map((h) => childPoint(layout, ...xy(h))),
        color: t.color,
        width: overworldPathWidth(t.width)!,
        dash: overworldPathDash(t.lineStyle),
        smooth: isSmooth(t.routing),
      };
    });
    this.joins++;
    this.joined = { key, lines };
    return lines;
  }
}

// ── the Biomes view: simplified, edge to edge (O2) ─────────────────────────

/**
 * The overworld hexes a line passes through, in order: each child hex's
 * parent, repeats dropped, and a dip into a hex and straight back out
 * (A, B, A) left out.
 */
export function overworldRoute(layout: RegionLayout, hexes: readonly HexKey[]): HexKey[] {
  const out: HexKey[] = [];
  for (const h of hexes) {
    const p = parentOf(layout, ...xy(h)).join("_");
    if (out[out.length - 1] === p) continue;
    if (out.length >= 2 && out[out.length - 2] === p) { out.pop(); continue; }
    out.push(p);
  }
  return out;
}

/**
 * A simplified line in the overworld's parent plane (O2: "just edge to
 * edge, no need to match the real curves"): from the first hex's centre,
 * straight through the middle of each shared edge, to the last hex's
 * centre. Fewer than two hexes: nothing (it doesn't leave its hex here).
 */
export function edgeToEdgePoints(layout: RegionLayout, route: readonly HexKey[]): [number, number][] {
  if (route.length < 2) return [];
  const c = route.map((k) => hexCenter(...xy(k), layout.orientation, layout.parentStagger));
  const pts: [number, number][] = [c[0]];
  for (let i = 1; i < c.length; i++) pts.push([(c[i - 1][0] + c[i][0]) / 2, (c[i - 1][1] + c[i][1]) / 2]);
  pts.push(c[c.length - 1]);
  return pts;
}

/** The Biomes view's lines: the same lines, `pts` in the parent plane, straight. */
export function biomeViewLines<L extends OverworldPathLine>(layout: RegionLayout, lines: readonly L[]): L[] {
  return lines
    .map((l) => ({ ...l, pts: edgeToEdgePoints(layout, overworldRoute(layout, l.hexes)), smooth: false }))
    .filter((l) => l.pts.length >= 2);
}

/** Distance from a point to a polyline. */
function distToPolyline(pts: readonly [number, number][], x: number, y: number): number {
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** Screen px of slack around a line for the hover hit test. */
export const PATH_HIT_PX = 4;

/**
 * The line under a grid-px point measured now (the layer's hover hit
 * test). `c2g` / `p2g` were measured when the grid's font size was
 * `emThen`; `screenPerPx` is screen px per layout px (sx). `c2g` maps the
 * plane the lines' points are in: the child plane, or for the Biomes
 * view's lines the parent plane (pass p2g there). The point goes
 * back to that plane, and the slack (half the
 * stroke plus PATH_HIT_PX on screen) is converted to child units the same
 * way, so the test holds at every zoom.
 */
export function pathAtGridPoint<L extends { pts: readonly [number, number][]; width: number }>(
  lines: readonly L[], c2g: Affine, p2g: Affine, emThen: number, emNow: number, screenPerPx: number, gx: number, gy: number,
): L | null {
  const [x, y] = gridPointToChild(c2g, emThen, emNow, gx, gy);
  const back = emThen > 0 && emNow > 0 ? emThen / emNow : 1;
  const childPerGridPx = 1 / affineScale(c2g);
  const slack = (PATH_HIT_PX / (screenPerPx || 1)) * back * childPerGridPx;
  let best: L | null = null, bd = Infinity;
  for (const l of lines) {
    const half = ((l.width / SCREEN_HEX_RADIUS) * affineScale(p2g) * childPerGridPx) / 2;
    const d = distToPolyline(l.pts, x, y);
    if (d <= half + slack && d < bd) { bd = d; best = l; }
  }
  return best;
}

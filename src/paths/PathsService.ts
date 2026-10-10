/**
 * The plugin's paths service: every map's anchored paths, resolved to hex
 * chains through one shared resolver and one route cache per map. The map
 * view, the PNG export, the ghost strip, the hexcrawl manual and the
 * read-only consumers (region navigate, region/submap context) all read
 * `resolvedPathChains(map)` (the old PathChain shape).
 *
 * Pure (no Obsidian imports): the plugin hands it a PathsHost.
 *
 * Determinism: a map's routes depend only on its paths, its palette's
 * impassable terrains, the terrain shown on each hex (own, else the map's
 * base terrain), its bounds, the orientation, the stagger and each path
 * type's explicit style. READINESS GATE: until the map's terrain and its
 * palette are loaded, nothing is resolved (an empty list): routing with a
 * half-loaded palette would draw a road straight through a lake and then
 * jump when the palette arrives. Never an intermediate route.
 */

import type { MapData, MapPath, PathChain, PathType, TerrainColor } from "../types";
import { impassableNames } from "../impassable";
import type { RouteContext, SegmentStyle } from "./router";
import { contextSignature, DEFAULT_SEGMENT_STYLE } from "./router";
import { RouteCache } from "./routeCache";
import { resolvePaths, resolvedToChains, type ResolvedBranch, type StyleFor } from "./resolve";
import { storedMapPaths } from "./mapPaths";
import { buildPathStrokes, type LatticeGrid, type PathStroke, type StrokeOptions } from "./pathGeometry";
import { UNKNOWN_PATH_TYPE } from "../constants";

/**
 * A path type's routing style: THE place the router's avoid/winding flags
 * come from (the resolver's StyleFor is built from it). `undefined` for a
 * type not in the palette (the resolver then uses DEFAULT_SEGMENT_STYLE).
 *
 * PA5 SWITCH (fix/46-palettes-generators): the return line below is today's
 * effective mapping (the existing helpers in src/impassable.ts). When PA5
 * is merged it becomes exactly
 *   return t && { avoid: t.avoidImpassable, winding: t.autoRoute === "winding" };
 * and nothing else changes. No other code reads avoid or winding.
 */
export function pathTypeStyle(t: PathType | undefined): SegmentStyle | undefined {
  return t && { avoid: t.avoidImpassable, winding: t.autoRoute === "winding" };
}

/** StyleFor over a map's path types (first of a name wins, as the palette does). */
export function styleForTypes(types: readonly PathType[]): StyleFor {
  const byName = new Map<string, PathType>();
  for (const t of types) if (!byName.has(t.name)) byName.set(t.name, t);
  return (name) => pathTypeStyle(byName.get(name));
}

/** What the service needs from the plugin. */
export interface PathsHost {
  /**
   * The readiness gate: the map's terrain AND its palette are loaded.
   * (Wired to MapStore.isReady() + PaletteStore.isReady(); Phase 3's
   * per-map MapStore.isReady(map) slots in there.)
   */
  isMapReady(map: string): boolean;
  getMap(name: string): MapData | undefined;
  orientation(): "flat" | "pointy";
  /** The stagger the map is drawn with (its own, else the plugin's). */
  stagger(map: MapData): "odd" | "even";
  /** The map's path types (its palette's). */
  pathTypes(map: string): readonly PathType[];
  /** The map's palette terrains. */
  palette(map: string): readonly TerrainColor[];
  /** The map's hexes with data (own terrain). */
  hexData(map: string): ReadonlyMap<string, { terrain?: string }>;
  /**
   * Called before a map's paths are resolved whenever its routing context
   * or its types' routing styles differ from the last resolve (and on the
   * first one): the plugin's chance to keep existing routes where they
   * were (phase 7 pins) before anything draws the new ones.
   */
  routesChanging?(map: string): void;
}

interface Memo {
  key: string;
  resolved: ResolvedBranch[];
  chains: PathChain[];
}

export class PathsService {
  private caches = new Map<string, RouteCache>();
  private memo = new Map<string, Memo>();
  /** Per map: the context signature and styles of the last resolve (see PathsHost.routesChanging). */
  private seen = new Map<string, string>();
  /** Per map: paths drawn instead of the stored ones (the path tool's live drag preview). */
  private previews = new Map<string, MapPath[]>();

  constructor(private host: PathsHost) {}

  /** The map's stored paths (anchors), whatever its readiness. */
  storedPaths(map: MapData): MapPath[] {
    return storedMapPaths(map);
  }

  /**
   * Draw `paths` for this map instead of its stored ones until cleared
   * (null). Nothing is saved: the path tool shows a drag's reroute live and
   * commits once on release.
   */
  setPreview(mapName: string, paths: MapPath[] | null): void {
    if (paths) this.previews.set(mapName, paths);
    else this.previews.delete(mapName);
  }

  /** The paths being drawn for the map: the preview if any, else the stored ones. */
  shownPaths(map: MapData): MapPath[] {
    return this.previews.get(map.name) ?? storedMapPaths(map);
  }

  /**
   * The map's router under its current context (cached segments), or null
   * when the map isn't ready. Resolves first, so a pending context change
   * has been dealt with.
   */
  router(mapName: string): RouteCache | null {
    if (!this.compute(mapName)) return null;
    return this.cacheFor(mapName);
  }

  /** The routing style of a type on this map (DEFAULT_SEGMENT_STYLE's when unknown). */
  styleOf(mapName: string, typeName: string): SegmentStyle {
    return styleForTypes(this.host.pathTypes(mapName))(typeName) ?? DEFAULT_SEGMENT_STYLE;
  }

  /** Can this map's paths be resolved yet (terrain and palette loaded)? */
  isReady(mapName: string): boolean {
    return !!this.host.getMap(mapName) && this.host.isMapReady(mapName);
  }

  /** The map's routing context now, or null when it isn't ready. */
  context(mapName: string): RouteContext | null {
    const map = this.host.getMap(mapName);
    if (!map || !this.host.isMapReady(mapName)) return null;
    const { x: ox, y: oy } = map.gridOffset;
    const { cols, rows } = map.gridSize;
    const bounds = { minX: ox, minY: oy, maxX: ox + cols - 1, maxY: oy + rows - 1 };
    const names = new Set(impassableNames([...this.host.palette(mapName)]));
    const blocked = new Set<string>();
    if (names.size) {
      const hexes = this.host.hexData(mapName);
      const base = map.baseTerrain;
      if (base && names.has(base)) {
        // Every hex without its own terrain shows the base: walk the bounds.
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          for (let y = bounds.minY; y <= bounds.maxY; y++) {
            const k = `${x}_${y}`;
            const t = hexes.get(k)?.terrain || base;
            if (names.has(t)) blocked.add(k);
          }
        }
      } else {
        for (const [k, h] of hexes) if (h.terrain && names.has(h.terrain)) blocked.add(k);
      }
    }
    return { orientation: this.host.orientation(), stagger: this.host.stagger(map), bounds, blocked };
  }

  /** The map's route cache (kept across calls; a context change keeps the old routes as previous()). */
  cacheFor(mapName: string): RouteCache {
    let c = this.caches.get(mapName);
    if (!c) this.caches.set(mapName, (c = new RouteCache()));
    return c;
  }

  /** The map's paths resolved to branches; [] until the map is ready. */
  resolved(mapName: string): ResolvedBranch[] {
    return this.compute(mapName)?.resolved ?? [];
  }

  /** The map's resolved branches as PathChains (for read-only consumers); [] until ready. */
  resolvedPathChains(mapName: string): PathChain[] {
    return this.compute(mapName)?.chains ?? [];
  }

  /** The map's lattice (orientation and stagger), or null for an unknown map. */
  lattice(mapName: string): LatticeGrid | null {
    const map = this.host.getMap(mapName);
    return map ? { orientation: this.host.orientation(), stagger: this.host.stagger(map) } : null;
  }

  /**
   * The map's path strokes in lattice units: what the map view and the PNG
   * export both draw (only the final affine differs). [] until ready.
   */
  strokes(mapName: string, opts: Omit<StrokeOptions, "unknownType"> = {}): PathStroke[] {
    const grid = this.lattice(mapName);
    if (!grid) return [];
    return buildPathStrokes(this.resolved(mapName), this.host.pathTypes(mapName), grid, { ...opts, unknownType: UNKNOWN_PATH_TYPE });
  }

  /** Forget a map's cached routes (map deleted or renamed). */
  forget(mapName: string): void {
    this.caches.delete(mapName);
    this.memo.delete(mapName);
    this.seen.delete(mapName);
    this.previews.delete(mapName);
  }

  private compute(mapName: string): Memo | null {
    const map = this.host.getMap(mapName);
    let ctx = this.context(mapName);
    if (!map || !ctx) return null;
    const types = this.host.pathTypes(mapName);
    const styleFor = styleForTypes(types);
    const stylesOf = (ps: readonly MapPath[]) => [...new Set(ps.map((p) => p.typeName))]
      .map((n) => { const s = styleFor(n); return `${n}=${s ? `${+s.avoid}${+s.winding}` : "?"}`; })
      .join(",");
    // Routing inputs changed since the last resolve: let the host keep the
    // old routes (pins add anchors) before the new ones are drawn.
    const inputs = `${contextSignature(ctx)}|${stylesOf(storedMapPaths(map))}`;
    if (this.seen.get(mapName) !== inputs) {
      this.seen.set(mapName, inputs);
      if (this.host.routesChanging) {
        this.host.routesChanging(mapName);
        ctx = this.context(mapName);
        if (!ctx) return null;
      }
    }
    const paths = this.shownPaths(map);
    const styles = stylesOf(paths);
    const key = `${contextSignature(ctx)}|${styles}|${JSON.stringify(paths.map((p) => [p.name, p.typeName, p.branches.map((b) => b.anchors)]))}`;
    const hit = this.memo.get(mapName);
    if (hit && hit.key === key) return hit;
    const resolved = resolvePaths(paths, ctx, styleFor, this.cacheFor(mapName));
    const memo: Memo = { key, resolved, chains: resolvedToChains(resolved) };
    this.memo.set(mapName, memo);
    return memo;
  }
}

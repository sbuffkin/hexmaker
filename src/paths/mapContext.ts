/**
 * A map's routing inputs, built in ONE place so every reader routes a map's
 * paths the same way (MapStore's migration and compatibility view now, the
 * plugin's paths service and the PNG export later). Pure, no Obsidian imports.
 *
 * Routes depend only on: orientation, stagger, the map's bounds, the hexes
 * whose SHOWN terrain (own, else the map's base terrain) is impassable in
 * the map's palette, and each path type's explicit style fields. Nothing
 * here looks at a path's or a type's name.
 */

import type { HexKey } from "../types";
import { DEFAULT_SEGMENT_STYLE, type RouteContext, type SegmentStyle } from "./router";
import type { StyleFor } from "./resolve";
import { hexKey, hexXY } from "../hexKey";

export interface MapRouteInput {
  orientation: "flat" | "pointy";
  stagger: "odd" | "even";
  gridSize: { cols: number; rows: number };
  gridOffset: { x: number; y: number };
  /** Terrain shown on hexes without their own. */
  baseTerrain?: string;
  /** Hexes with their own terrain (hex key → terrain name). */
  terrainOf: Iterable<[HexKey, { terrain?: string } | undefined]>;
  /** Names of the palette's impassable terrains. */
  impassable: Iterable<string>;
}

/** The routing context of a map (see the module comment). */
export function mapRouteContext(m: MapRouteInput): RouteContext {
  const bounds = {
    minX: m.gridOffset.x,
    minY: m.gridOffset.y,
    maxX: m.gridOffset.x + m.gridSize.cols - 1,
    maxY: m.gridOffset.y + m.gridSize.rows - 1,
  };
  const impassable = new Set(m.impassable);
  const blocked = new Set<HexKey>();
  if (impassable.size) {
    const own = new Map<HexKey, string | undefined>();
    for (const [k, h] of m.terrainOf) own.set(k, h?.terrain || undefined);
    const shown = (k: HexKey) => own.get(k) ?? m.baseTerrain;
    if (m.baseTerrain && impassable.has(m.baseTerrain)) {
      // Every hex without its own terrain shows the base: walk the grid.
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const k = hexKey(x, y);
          const t = shown(k);
          if (t && impassable.has(t)) blocked.add(k);
        }
      }
    } else {
      for (const [k, t] of own) {
        if (!t || !impassable.has(t)) continue;
        const { x, y } = hexXY(k);
        if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) blocked.add(k);
      }
    }
  }
  return { orientation: m.orientation, stagger: m.stagger, bounds, blocked };
}

/** What the style needs of a path type (PA5's explicit fields, when present). */
export interface PathTypeStyleFields {
  name: string;
  /** Explicit "go around impassable terrain" (PA5 makes it required). */
  avoidImpassable?: boolean;
  /** PA5's auto-route style: "direct" | "winding". */
  autoRoute?: string;
}

/**
 * A StyleFor from a palette's path types, reading ONLY their explicit
 * fields: `avoidImpassable` when set, `autoRoute === "winding"`. A field
 * that isn't there (palettes from before PA5) takes DEFAULT_SEGMENT_STYLE's
 * value, never a guess from the type's name. A type not in the list is
 * undefined (the resolver uses DEFAULT_SEGMENT_STYLE).
 */
export function pathTypeStyleFor(types: readonly PathTypeStyleFields[]): StyleFor {
  const byName = new Map<string, SegmentStyle>();
  for (const t of types) {
    if (byName.has(t.name)) continue;
    byName.set(t.name, {
      avoid: typeof t.avoidImpassable === "boolean" ? t.avoidImpassable : DEFAULT_SEGMENT_STYLE.avoid,
      winding: t.autoRoute === undefined ? DEFAULT_SEGMENT_STYLE.winding : t.autoRoute === "winding",
    });
  }
  return (name) => byName.get(name);
}

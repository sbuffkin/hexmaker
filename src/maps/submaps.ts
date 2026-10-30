/**
 * Region and Location submaps (plan-overworld-regions §1, K1/K7/K8). Pure:
 * no Obsidian imports, so the rules are unit-tested.
 *
 * A hex can open into one Region map (the hex itself, at the scale its map
 * picked once in its region settings) and any number of Location maps
 * (towns, dungeons… each its own size). The child map's own record
 * (`parent` + `submapKind`) is the truth; the parent hex's `regionMap` /
 * `locations` cells mirror it so the map note reads on its own.
 */

import type { MapData, RegionSettings, SubmapKind } from "../types";
import type { HexData } from "./mapNote";
import { compareHexKeys } from "../hexKey";

/** A child map's role: "region" only when marked so; any other child is a location (K8). */
export function submapKindOf(map: Pick<MapData, "parent" | "submapKind"> | undefined): SubmapKind | undefined {
  if (!map) return undefined;
  if (map.submapKind === "region") return "region";
  return map.parent ? "location" : map.submapKind;
}

/**
 * The UI word for a submap's kind (owner Q9/R1): "Submap" is the umbrella,
 * "Region" and "Location" its two kinds; never "Place". A map that isn't a
 * submap reads "Map".
 */
export function submapKindLabel(map: Pick<MapData, "parent" | "submapKind"> | undefined): "Region" | "Location" | "Map" {
  const kind = submapKindOf(map);
  return kind === "region" ? "Region" : kind === "location" ? "Location" : "Map";
}

/** Every map a hex opens into: its region first, then its locations. */
export function hexChildMaps(h: Pick<HexData, "regionMap" | "locations"> | undefined): string[] {
  if (!h) return [];
  const out = h.regionMap ? [h.regionMap] : [];
  for (const l of h.locations ?? []) if (!out.includes(l)) out.push(l);
  return out;
}

/** Hex patch that adds `map` to the hex's locations (end of the list). No-op patch ({}) if it's already linked. */
export function addLocationPatch(h: HexData | undefined, map: string): Pick<HexData, "locations"> {
  const cur = h?.locations ?? [];
  if (cur.includes(map) || h?.regionMap === map) return {};
  return { locations: [...cur, map] };
}

/** Hex patch that makes `map` the hex's region map (moving it out of locations). */
export function setRegionPatch(h: HexData | undefined, map: string): { regionMap: string; locations?: string[] | null } {
  const patch: { regionMap: string; locations?: string[] | null } = { regionMap: map };
  const locs = (h?.locations ?? []).filter((l) => l !== map);
  // A different region map already there is never dropped: it becomes a location.
  if (h?.regionMap && h.regionMap !== map && !locs.includes(h.regionMap)) locs.push(h.regionMap);
  if (locs.length !== (h?.locations ?? []).length || locs.some((l, i) => l !== h?.locations?.[i])) patch.locations = locs.length ? locs : null;
  return patch;
}

/** Hex patch that unlinks `map` (as region or location). Empty when it isn't linked. */
export function removeMapPatch(h: HexData | undefined, map: string): { regionMap?: null; locations?: string[] | null } {
  const patch: { regionMap?: null; locations?: string[] | null } = {};
  if (h?.regionMap === map) patch.regionMap = null;
  if (h?.locations?.includes(map)) {
    const rest = h.locations.filter((l) => l !== map);
    patch.locations = rest.length ? rest : null;
  }
  return patch;
}

/** Hex patch that renames `from` to `to` wherever the hex links it, or null. */
export function renameMapPatch(h: HexData | undefined, from: string, to: string): { regionMap?: string; locations?: string[] } | null {
  if (!h) return null;
  const patch: { regionMap?: string; locations?: string[] } = {};
  if (h.regionMap === from) patch.regionMap = to;
  if (h.locations?.includes(from)) patch.locations = h.locations.map((l) => (l === from ? to : l)).filter((l, i, a) => a.indexOf(l) === i);
  return Object.keys(patch).length ? patch : null;
}

/** `list` with the item at `from` moved to index `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it);
  return out;
}

/** Locations shown one by one in the hex's right-click menu; from one more on, a "Locations (n)…" list. */
export const MENU_LOCATIONS_MAX = 2;

export interface SubmapMenuPlan {
  /** "Enter region: …" item. */
  region?: string;
  /** "Open: …" items, one per location (only when there are few). */
  open: string[];
  /** > 0: one "Locations (n)…" item that opens the list instead. */
  listCount: number;
}

/** What the right-click menu shows for a hex's maps (K7). */
export function submapMenuPlan(h: HexData | undefined): SubmapMenuPlan {
  const locs = (h?.locations ?? []).filter((l) => l !== h?.regionMap);
  const many = locs.length > MENU_LOCATIONS_MAX;
  return { region: h?.regionMap, open: many ? [] : locs, listCount: many ? locs.length : 0 };
}

/** Entries matching a search (name or label, case-insensitive), order kept. */
export function filterByQuery<T extends { name: string; label: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
}

// ── regions of a map ─────────────────────────────────────────────────────

/** The region maps of `parent`, in reading order of their parent hexes. */
export function regionsOf<T extends Pick<MapData, "name" | "parent" | "submapKind">>(maps: T[], parent: string): T[] {
  return maps
    .filter((m) => m.submapKind === "region" && m.parent?.map === parent)
    .sort((a, b) => compareHexKeys(a.parent!.hex, b.parent!.hex));
}

/**
 * The region settings are fixed while any region of the map exists (K1/K5):
 * derived, never stored, so it can't go stale. Deleting the last region
 * unlocks them.
 */
export function regionsLocked(maps: Pick<MapData, "name" | "parent" | "submapKind">[], parent: string): boolean {
  return maps.some((m) => m.submapKind === "region" && m.parent?.map === parent);
}

/** The region map of hex `hex` on `parent`, from the maps' own records. */
export function regionMapAt<T extends Pick<MapData, "name" | "parent" | "submapKind">>(maps: T[], parent: string, hex: string): T | undefined {
  return maps.find((m) => m.submapKind === "region" && m.parent?.map === parent && m.parent.hex === hex);
}

// ── region settings ──────────────────────────────────────────────────────

export const FLOWER_RADII = [1, 2, 3, 4, 5] as const;
export const RECT_SIDES = [6, 8, 10] as const;
export const RECT_SIDE_RANGE = { min: 2, max: 32 };
/** Rectangles first (OW1): hex flowers don't join their neighbours until the map-shape work (phase 2b). */
export const DEFAULT_REGION_SETTINGS: RegionSettings = { footprint: "rect", size: 8, blend: "normal" };

/** Hexes in one region. */
export function regionCellCount(s: Pick<RegionSettings, "footprint" | "size">): number {
  return s.footprint === "hex" ? 3 * s.size * s.size + 3 * s.size + 1 : s.size * s.size;
}

/** A region map's grid (its bounding box): (2r+1)² for a flower, n×n for a rectangle. */
export function regionGridSize(s: Pick<RegionSettings, "footprint" | "size">): { cols: number; rows: number } {
  const n = s.footprint === "hex" ? 2 * s.size + 1 : s.size;
  return { cols: n, rows: n };
}

/** "Hex flower, 37 hexes" / "Rectangle, 8 × 8". */
export function regionSettingsLabel(s: Pick<RegionSettings, "footprint" | "size">): string {
  return s.footprint === "hex" ? `Hex flower, ${regionCellCount(s)} hexes` : `Rectangle, ${s.size} × ${s.size}`;
}

/** Why settings can't be used, or null. */
export function regionSettingsProblem(s: Pick<RegionSettings, "footprint" | "size">): string | null {
  if (!Number.isInteger(s.size)) return "Size must be a whole number.";
  if (s.footprint === "hex" && !(FLOWER_RADII as readonly number[]).includes(s.size)) return "Hex flowers have 7, 19, 37, 61 or 91 hexes.";
  if (s.footprint === "rect" && (s.size < RECT_SIDE_RANGE.min || s.size > RECT_SIDE_RANGE.max)) {
    return `Rectangles are ${RECT_SIDE_RANGE.min} to ${RECT_SIDE_RANGE.max} hexes across.`;
  }
  return null;
}

/**
 * Settings after an edit while locked: the fixed fields keep their old
 * values; only blend and the default generator change (they apply to new
 * regions only).
 */
export function applyRegionSettingsEdit(old: RegionSettings, next: RegionSettings, locked: boolean): RegionSettings {
  if (!locked) return next;
  return { ...old, blend: next.blend, generator: next.generator };
}

// ── mirror repair (map record wins) ──────────────────────────────────────

export interface MirrorFix {
  /** The parent map and hex whose cells change. */
  map: string;
  hex: string;
  patch: { regionMap?: string | null; locations?: string[] | null };
  /** Why, for the console log. */
  reason: string;
}

/**
 * Bring the hexes' Region map cells in line with the maps' own records:
 * - a region map whose parent hex doesn't name it gets named there (a
 *   different map already there becomes a location, never dropped);
 * - a hex naming a region map that isn't (by its record) that hex's region
 *   keeps it as a location instead;
 * - a hex whose region map is unknown (no such map) is left alone: that's
 *   the user's text.
 * Two regions claiming one hex: the first (map order) wins; the other is
 * shown as a location of it.
 */
export function regionMirrorFixes(
  maps: Pick<MapData, "name" | "parent" | "submapKind">[],
  hexOf: (map: string, hex: string) => HexData | undefined,
  allHexes: (map: string) => Iterable<[string, HexData]>,
): MirrorFix[] {
  const names = new Set(maps.map((m) => m.name));
  const fixes: MirrorFix[] = [];
  // Working copy so several fixes on one hex compose.
  const cur = new Map<string, HexData>();
  const key = (m: string, h: string) => `${m}\u0000${h}`;
  const get = (m: string, h: string) => cur.get(key(m, h)) ?? hexOf(m, h);
  const fix = (map: string, hex: string, patch: MirrorFix["patch"], reason: string) => {
    const h = { ...(get(map, hex) ?? {}) };
    if (patch.regionMap !== undefined) { if (patch.regionMap) h.regionMap = patch.regionMap; else delete h.regionMap; }
    if (patch.locations !== undefined) { if (patch.locations?.length) h.locations = patch.locations; else delete h.locations; }
    cur.set(key(map, hex), h);
    const prev = fixes.find((f) => f.map === map && f.hex === hex);
    if (prev) { prev.patch = { ...prev.patch, ...patch }; prev.reason += `; ${reason}`; }
    else fixes.push({ map, hex, patch, reason });
  };

  const claimed = new Set<string>();
  for (const m of maps) {
    if (m.submapKind !== "region" || !m.parent || !names.has(m.parent.map)) continue;
    const { map: p, hex } = m.parent;
    const k = key(p, hex);
    const h = get(p, hex);
    if (claimed.has(k)) {
      // A second region for one hex: keep it reachable as a location.
      const add = addLocationPatch(h, m.name);
      if (add.locations) fix(p, hex, add, `${m.name} is a second region for this hex; listed as a location`);
      continue;
    }
    claimed.add(k);
    if (h?.regionMap !== m.name) fix(p, hex, setRegionPatch(h, m.name), `${m.name} is this hex's region`);
  }

  for (const parent of maps) {
    for (const [hex, h0] of allHexes(parent.name)) {
      const h = get(parent.name, hex) ?? h0;
      const r = h.regionMap;
      if (!r || !names.has(r)) continue;
      const rec = maps.find((m) => m.name === r)!;
      const isHere = rec.submapKind === "region" && rec.parent?.map === parent.name && rec.parent.hex === hex
        && claimed.has(key(parent.name, hex)) && get(parent.name, hex)?.regionMap === r;
      if (isHere) continue;
      const locs = (h.locations ?? []).filter((l) => l !== r);
      fix(parent.name, hex, { regionMap: null, locations: [r, ...locs] }, `${r} isn't this hex's region; kept as a location`);
    }
  }
  return fixes;
}

// ── where a submap came from ─────────────────────────────────────────────

/** What parentHexTerrain needs (the plugin satisfies it). */
export interface ParentHexHost {
  parentOf(mapName: string): { map: string; hex: string } | undefined;
  getMap(mapName: string): Pick<MapData, "baseTerrain"> | undefined;
  mapLabel(mapName: string): string;
  mapStore: { get(mapName: string, key: string): Pick<HexData, "terrain" | "name"> | undefined };
}

/**
 * The terrain of the hex `mapName` was made from (its own, else the parent
 * map's base terrain), with a label for that hex ("The Drift 2, 7", or its
 * name). From the parent's map data, never its hex note (F11). Undefined
 * for a top-level map or a hex with no terrain.
 */
export function parentHexTerrain(host: ParentHexHost, mapName: string): { terrain: string; label: string } | undefined {
  const parent = host.parentOf(mapName);
  if (!parent) return undefined;
  const hex = host.mapStore.get(parent.map, parent.hex);
  const terrain = (hex?.terrain ?? host.getMap(parent.map)?.baseTerrain ?? "").trim();
  if (!terrain) return undefined;
  const [x, y] = parent.hex.split("_");
  const label = hex?.name?.trim() || `${host.mapLabel(parent.map)} ${x}, ${y}`;
  return { terrain, label };
}

/**
 * The right-click item for making a map from a hex: "New map from this
 * hex…" on a hex with none, "Add another map…" once it has one (C11: the
 * existing map is the item to pick; making another stays possible).
 */
export function newMapItemTitle(h: Pick<HexData, "regionMap" | "locations"> | undefined): string {
  return hexChildMaps(h).length ? "Add another map…" : "New map from this hex…";
}

/** Region footprints placed in the shared grid today (hex flowers: phase 2b). */
export function meshes(s: Pick<RegionSettings, "footprint"> | undefined): boolean {
  return s?.footprint === "rect";
}

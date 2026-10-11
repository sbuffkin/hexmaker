/**
 * Overworld paths into regions, the vault part: "Confirm into regions",
 * "Remove from regions", and the hook that puts confirmed paths into a
 * region when it is made or regenerated. The rules are in pathProjection.ts
 * (pure, tested).
 *
 * Writes go through the map store (terrain: setMany, paths: setPaths), so
 * the region map notes are written as usual. Confirm and remove are one undo
 * step on the overworld's queue (kind "projection"); the regeneration hook
 * is part of making the region and records nothing of its own.
 *
 * Gated like every path edit: Build or God on the overworld.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexKey, MapData, MapPath, PathType } from "../types";
import type { ResolvedBranch } from "../paths/resolve";
import type { RouteContext } from "../paths/router";
import { routeSegment, DEFAULT_SEGMENT_STYLE } from "../paths/router";
import { anchorsFor, dedupeSteps } from "../paths/fromHexes";
import { pathNameKey } from "../paths/names";
import { clonePaths } from "../paths/edit";
import { regionMapAt } from "../maps/submaps";
import { cellEdits, cellPatch, currentCellEdits, sameValue, type CellEdit, type UndoDirection } from "../undoBook";
import { mapAllows } from "../workMode";
import { inRegion, type RegionLayout } from "./layout";
import { worldSeed } from "./regionWorld";
import { overworldOf, planRegionAt } from "./regionsVault";
import {
  carveCells,
  carveTerrainFor,
  carveWidthOf,
  carveWrites,
  childNeighbourKeys,
  isApplied,
  mergeOwned,
  ownerOf,
  projectPath,
  seamSalt,
  withApplied,
  type OverworldBranch,
} from "./pathProjection";

/** Shown when confirming is refused by the overworld's work mode. */
export const CONFIRM_LOCKED_HINT = "Switch to Build to confirm paths into regions.";

/** The undo entry of a confirm / remove: every map's paths before and after, and the terrain it carved. */
export interface ProjectionUndo {
  kind: "projection";
  maps: { mapName: string; before: MapPath[]; after: MapPath[] }[];
  edits: CellEdit[];
}

export interface ProjectionReport {
  /** Region maps whose paths or terrain changed. */
  regions: string[];
  /** Hexes whose terrain was carved (or put back). */
  carved: number;
  /** Regions that couldn't be routed (not loaded yet). */
  skipped: string[];
}

const xy = (k: HexKey): [number, number] => {
  const [x, y] = k.split("_").map(Number);
  return [x, y];
};

/** Is this map an overworld whose regions mesh (the paths can go into them)? */
export function isPathOverworld(plugin: HexmakerPlugin, mapName: string): boolean {
  return !!overworldOf(plugin, mapName);
}

/** The region maps of an overworld, by their parent hex. */
function regionsOf(plugin: HexmakerPlugin, owName: string): Map<HexKey, MapData> {
  const out = new Map<HexKey, MapData>();
  for (const m of plugin.settings.maps) {
    if (m.submapKind === "region" && m.parent?.map === owName && !out.has(m.parent.hex)) out.set(m.parent.hex, m);
  }
  return out;
}

/** The region maps an overworld path crosses (that exist), in path order. */
export function regionsCrossed(plugin: HexmakerPlugin, owName: string, pathName: string): string[] {
  const out: string[] = [];
  for (const rb of plugin.paths.resolved(owName)) {
    if (pathNameKey(rb.path) !== pathNameKey(pathName)) continue;
    for (const h of rb.hexes) {
      const r = regionMapAt(plugin.settings.maps, owName, h);
      if (r && !out.includes(r.name)) out.push(r.name);
    }
  }
  return out;
}

/** The overworld's paths that run through hex `hex`, and whether each is confirmed. */
export function overworldPathsAt(plugin: HexmakerPlugin, owName: string, hex: HexKey): { name: string; applied: boolean }[] {
  if (!isPathOverworld(plugin, owName)) return [];
  const names = new Set(plugin.paths.resolved(owName).filter((rb) => rb.hexes.includes(hex)).map((rb) => pathNameKey(rb.path)));
  return plugin.mapStore.paths(owName).filter((p) => names.has(pathNameKey(p.name))).map((p) => ({ name: p.name, applied: isApplied(p) }));
}

function typeOn(plugin: HexmakerPlugin, mapName: string, typeName: string): PathType | undefined {
  try {
    return plugin.getMapPathTypes(mapName).find((t) => t.name === typeName);
  } catch {
    return undefined;
  }
}

interface ProjectOptions {
  /** Only these parent hexes (a region being made). */
  only?: ReadonlySet<HexKey>;
  /** Also replace region paths whose overworld path no longer exists (a renamed one). */
  adoptOrphans?: boolean;
}

/**
 * Put overworld path `pathName` into the regions it crosses (or, with
 * `path` null, take it out of every region). Writes terrain and paths; no
 * undo, no gate (callers do both).
 */
function projectInto(plugin: HexmakerPlugin, owName: string, pathName: string, path: MapPath | null, opts: ProjectOptions = {}): ProjectionReport {
  const report: ProjectionReport = { regions: [], carved: 0, skipped: [] };
  const ow = overworldOf(plugin, owName);
  if (!ow) return report;
  const layout: RegionLayout = ow.layout;
  const salt = seamSalt(worldSeed(ow.settings.worldId ?? ow.map.name), pathName);
  const regions = regionsOf(plugin, owName);
  const owNames = new Set(plugin.mapStore.paths(owName).map((p) => pathNameKey(p.name)));
  const orphan = opts.adoptOrphans
    ? (p: MapPath) => {
        const o = ownerOf(p);
        return !!o && !owNames.has(pathNameKey(o)) && (!path || p.typeName === path.typeName);
      }
    : () => false;
  const owned = (p: MapPath) => {
    const o = ownerOf(p);
    return !!o && (pathNameKey(o) === pathNameKey(pathName) || orphan(p));
  };

  const branches: OverworldBranch[] = path
    ? plugin.paths.resolved(owName)
        .filter((rb: ResolvedBranch) => pathNameKey(rb.path) === pathNameKey(path.name))
        .map((rb) => ({ branch: rb.branch, hexes: rb.hexes, forkFrom: rb.forkFrom, joinTo: rb.joinTo }))
    : [];
  const crossed = new Set(branches.flatMap((b) => b.hexes));

  // Regions to visit: the ones crossed, and the ones holding an old copy.
  const targets = new Map<HexKey, MapData>();
  for (const [hex, m] of regions) {
    if (opts.only && !opts.only.has(hex)) continue;
    if (crossed.has(hex) || plugin.mapStore.paths(m.name).some(owned)) targets.set(hex, m);
  }

  // Each region's router: its own terrain and the type's routing, with the
  // hexes of its other paths passable (a road may bridge a carved river).
  const routers = new Map<HexKey, ((a: HexKey, b: HexKey) => HexKey[]) | null>();
  const routerFor = (hex: HexKey) => {
    if (routers.has(hex)) return routers.get(hex)!;
    const m = targets.get(hex)!;
    const ctx = plugin.paths.isReady(m.name) ? plugin.paths.context(m.name) : null;
    let fn: ((a: HexKey, b: HexKey) => HexKey[]) | null = null;
    if (ctx && path) {
      const style = plugin.paths.styleOf(m.name, path.typeName);
      const bridges = new Set<HexKey>();
      const mine = new Set(plugin.mapStore.paths(m.name).filter(owned).map((p) => pathNameKey(p.name)));
      for (const rb of plugin.paths.resolved(m.name)) if (!mine.has(pathNameKey(rb.path))) rb.hexes.forEach((h) => bridges.add(h));
      const blocked = new Set([...ctx.blocked].filter((h) => !bridges.has(h)));
      const routeCtx: RouteContext = { ...ctx, blocked };
      fn = (a, b) => routeSegment(a, b, { ...routeCtx, ...style }).hexes;
    }
    routers.set(hex, fn);
    return fn;
  };
  const projected = path
    ? projectPath(layout, salt, branches, (R, a, b) => routerFor(R)!(a, b), (R) => targets.has(R) && !!routerFor(R))
    : new Map<HexKey, HexKey[][]>();

  const nb = childNeighbourKeys(layout);
  for (const [hex, m] of targets) {
    if (path && !routerFor(hex)) {
      report.skipped.push(m.name);
      continue;
    }
    const [px, py] = xy(hex);
    const inside = (k: HexKey) => inRegion(layout, px, py, ...xy(k));
    const chains = projected.get(hex) ?? [];
    const store = plugin.mapStore;
    const palette = plugin.getMapPalette(m.name);
    const current = store.paths(m.name);
    const oldOwned = current.filter(owned);

    // ── terrain: carve the new route, put back what only the old one carved ──
    const type = path ? typeOn(plugin, m.name, path.typeName) ?? typeOn(plugin, owName, path.typeName) : undefined;
    const carveT = carveTerrainFor(type?.carves, palette);
    const newCells = carveT ? carveCells(chains, carveWidthOf(type), inside, nb) : new Set<HexKey>();
    const writes: [HexKey, { terrain: string }][] = carveT ? carveWrites(newCells, carveT, (k) => store.get(m.name, k)) : [];
    if (oldOwned.length) {
      const oldNames = new Set(oldOwned.map((p) => pathNameKey(p.name)));
      const oldResolved = plugin.paths.resolved(m.name);
      // Hexes other carving paths keep.
      const keep = new Set<HexKey>();
      for (const p of current) {
        if (oldNames.has(pathNameKey(p.name))) continue;
        const t = typeOn(plugin, m.name, p.typeName);
        if (!carveTerrainFor(t?.carves, palette)) continue;
        const hexes = oldResolved.filter((rb) => pathNameKey(rb.path) === pathNameKey(p.name)).map((rb) => rb.hexes);
        carveCells(hexes, carveWidthOf(t), inside, nb).forEach((k) => keep.add(k));
      }
      let plan: Map<string, string> | null | undefined;
      for (const p of oldOwned) {
        const t = typeOn(plugin, m.name, p.typeName) ?? typeOn(plugin, owName, p.typeName);
        const oldT = carveTerrainFor(t?.carves, palette);
        if (!oldT) continue;
        const hexes = oldResolved.filter((rb) => pathNameKey(rb.path) === pathNameKey(p.name)).map((rb) => rb.hexes);
        for (const k of carveCells(hexes, carveWidthOf(t), inside, nb)) {
          if (newCells.has(k) || keep.has(k)) continue;
          const h = store.get(m.name, k);
          if (h?.locked || h?.terrain !== oldT) continue;
          if (plan === undefined) {
            try { plan = planRegionAt(plugin, owName, px, py)?.cells ?? null; } catch { plan = null; }
          }
          const back = plan?.get(k);
          if (back && back !== oldT) writes.push([k, { terrain: back }]);
        }
      }
    }
    if (writes.length) {
      store.setMany(m.name, writes);
      report.carved += writes.length;
    }

    // ── the region's path: anchors that route back to exactly the chains ──
    let next: MapPath | null = null;
    if (path && chains.length) {
      const ctx = plugin.paths.context(m.name);
      const style = ctx ? plugin.paths.styleOf(m.name, path.typeName) : DEFAULT_SEGMENT_STYLE;
      next = {
        name: path.name,
        typeName: path.typeName,
        branches: chains.map((c) => ({ anchors: ctx ? anchorsFor(c, { ...ctx, ...style }) : dedupeSteps(c) })),
      };
    }
    const list = mergeOwned(store.paths(m.name), pathName, next, orphan);
    if (!sameValue(list, store.paths(m.name))) store.setPaths(m.name, list);
    if (writes.length || !sameValue(list, current)) report.regions.push(m.name);
  }
  return report;
}

/** Snapshot of every overworld + region map's paths (for undo). */
function snapshot(plugin: HexmakerPlugin, owName: string): Map<string, MapPath[]> {
  const out = new Map<string, MapPath[]>([[owName, clonePaths(plugin.mapStore.paths(owName))]]);
  for (const m of regionsOf(plugin, owName).values()) out.set(m.name, clonePaths(plugin.mapStore.paths(m.name)));
  return out;
}

/** Confirm (or, with `remove`, take out) one overworld path, as one undo step. */
async function runProjection(
  plugin: HexmakerPlugin,
  owName: string,
  pathName: string,
  remove: boolean,
): Promise<ProjectionReport | { error: string }> {
  const ow = plugin.getMap(owName);
  if (!ow || !overworldOf(plugin, owName)) return { error: "This map has no rectangle regions to put paths into." };
  if (!mapAllows(ow, "edit-path")) return { error: CONFIRM_LOCKED_HINT };
  if (!plugin.paths.isReady(owName)) return { error: "The map is still loading. Try again in a moment." };
  const path = plugin.mapStore.paths(owName).find((p) => pathNameKey(p.name) === pathNameKey(pathName));
  if (!path) return { error: `There's no path called ${pathName} on this map.` };
  const before = snapshot(plugin, owName);
  const { result: report, cells } = await plugin.mapStore.record(() => {
    const r = projectInto(plugin, owName, path.name, remove ? null : path, { adoptOrphans: !remove });
    const owPaths = plugin.mapStore.paths(owName).map((p) => (pathNameKey(p.name) === pathNameKey(path.name) ? withApplied(p, !remove) : p));
    if (!sameValue(owPaths, plugin.mapStore.paths(owName))) plugin.mapStore.setPaths(owName, owPaths);
    return r;
  });
  const maps: ProjectionUndo["maps"] = [];
  for (const [mapName, b] of before) {
    const after = clonePaths(plugin.mapStore.paths(mapName));
    if (!sameValue(b, after)) maps.push({ mapName, before: b, after });
  }
  const edits = cellEdits(cells);
  if (maps.length || edits.length) plugin.pushUndo(owName, { kind: "projection", maps, edits });
  await plugin.saveSettings();
  await plugin.mapStore.flush();
  return report;
}

/**
 * "Confirm into regions": route overworld path `pathName` through every
 * region it crosses (seams agree, so it joins up), carve terrain if its type
 * says so, and mark it Applied. Confirming again updates the region paths
 * it made before. One undo step.
 */
export function confirmOverworldPath(plugin: HexmakerPlugin, owName: string, pathName: string): Promise<ProjectionReport | { error: string }> {
  return runProjection(plugin, owName, pathName, false);
}

/** "Remove from regions": take a confirmed path's copies out of its regions (carved terrain put back) and make it a draft. */
export function removeOverworldPath(plugin: HexmakerPlugin, owName: string, pathName: string): Promise<ProjectionReport | { error: string }> {
  return runProjection(plugin, owName, pathName, true);
}

/**
 * A region was just made or regenerated: put every confirmed path of its
 * overworld that crosses it back in (routed after generation, then carved).
 * Quiet: nothing is recorded or reported; never throws.
 */
export function applyConfirmedPaths(plugin: HexmakerPlugin, regionName: string): number {
  try {
    const region = plugin.getMap(regionName);
    if (region?.submapKind !== "region" || !region.parent) return 0;
    const owName = region.parent.map;
    if (typeof plugin.mapStore?.paths !== "function" || !plugin.paths?.resolved || !overworldOf(plugin, owName)) return 0;
    const only = new Set([region.parent.hex]);
    let n = 0;
    for (const p of plugin.mapStore.paths(owName)) {
      if (!isApplied(p)) continue;
      n += projectInto(plugin, owName, p.name, p, { only }).regions.length;
    }
    return n;
  } catch (e) {
    console.error("Hexmaker: putting confirmed paths into a region failed", e);
    return 0;
  }
}

/** Overworld paths shown as drafts (not confirmed) on this map: none unless it's an overworld. */
export function draftPathNames(plugin: HexmakerPlugin, mapName: string): Set<string> {
  if (!isPathOverworld(plugin, mapName)) return new Set();
  return new Set(plugin.mapStore.paths(mapName).filter((p) => !isApplied(p)).map((p) => p.name));
}

// ── undo ─────────────────────────────────────────────────────────────────

/** The part of a projection entry still in place (null: nothing to do). */
export function prepareProjectionUndo(plugin: HexmakerPlugin, item: ProjectionUndo, dir: UndoDirection): ProjectionUndo | null {
  const maps = item.maps.filter((m) => sameValue(plugin.mapStore.paths(m.mapName), dir === "undo" ? m.after : m.before));
  const edits = currentCellEdits(item.edits, dir, (m, k) => plugin.mapStore.get(m, k) as Record<string, unknown> | undefined) ?? [];
  if (!maps.length && !edits.length) return null;
  return { ...item, maps, edits };
}

/** Undo (back to "before") or redo a projection: terrain first, then the paths. */
export function applyProjectionUndo(plugin: HexmakerPlugin, item: ProjectionUndo, dir: UndoDirection): void {
  for (const e of item.edits) plugin.mapStore.set(e.map, e.key, cellPatch(e, dir));
  for (const m of item.maps) plugin.mapStore.setPaths(m.mapName, clonePaths(dir === "undo" ? m.before : m.after));
}

import { Notice, TAbstractFile, TFile, TFolder, parseYaml } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexKey, MapData, MapPath, PathChain, PathType, TerrainColor } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildMapNote,
  MAP_NOTE_FORMAT,
  PATHS_FORMAT,
  READABLE_KEYS_FORMAT,
  mapNoteKey,
  parseMapNote,
  readMapNote,
  refreshProblemCallouts,
  RESETTABLE_FIELDS,
  updateMapNote,
  type HexData,
  type MapNoteContext,
  type MapNoteData,
  type MapNoteProblem,
  type MapNoteReadOptions,
  type PathRouteStats,
} from "./mapNote";
import { renamedHexes, syncHexNameAlias } from "./hexNames";
import { regionMirrorFixes } from "./submaps";
import { writeJsonBackup } from "../backup";
import { impassableNames } from "../impassable";
import type { RouteContext } from "../paths/router";
import { RouteCache, type SegmentRouter } from "../paths/routeCache";
import { resolvePaths, styleOf, type ResolvedBranch, type StyleFor } from "../paths/resolve";
import { anchorsFor, compactLegacy, dedupeSteps, reproduces, routeFnFor, type CompactReport } from "../paths/fromHexes";
import { pinChanged, segmentFn } from "../paths/edit";
import { legacyChainsToPaths } from "../paths/legacy";
import { pathNameKey, uniquePathName } from "../paths/names";
import { mapRouteContext, pathTypeStyleFor } from "../paths/mapContext";
import { buildView, emptyView, reconcile, type PathView } from "../paths/chainView";

/** A map's routing context changed (terrain, palette impassability, size, stagger). */
export interface RouteContextChange {
  map: string;
  before: RouteContext;
  after: RouteContext;
  /** Routes under `before` (cached). */
  previous: SegmentRouter;
  /** Routes under `after` (cached). */
  current: SegmentRouter;
  styleFor: StyleFor;
}

/** Hex-note frontmatter keys that hold map data (moved into the map note). */
export const HEX_DATA_KEYS = ["terrain", "icon", "gm-icons", "gm-icon", "region", "duckmage-submap", "locked"] as const;
/** Pointer left in a cleaned hex note's frontmatter. */
export const MAP_LINK_KEY = "hexmaker-map";

const HEX_FILE = /^(-?\d+)_(-?\d+)\.md$/;

/** Read map data out of a hex note's frontmatter (pre-migration notes). */
export function hexDataFromFrontmatter(fm: Record<string, unknown> | null | undefined): HexData {
  const h: HexData = {};
  if (!fm) return h;
  if (typeof fm.terrain === "string" && fm.terrain) h.terrain = fm.terrain;
  if (typeof fm.icon === "string" && fm.icon) h.icon = fm.icon;
  const gm = Array.isArray(fm["gm-icons"]) ? fm["gm-icons"].filter((v): v is string => typeof v === "string")
    : typeof fm["gm-icon"] === "string" ? [fm["gm-icon"]] : [];
  if (gm.length) h.gmIcons = gm;
  if (typeof fm.region === "string" && fm.region) h.region = fm.region;
  if (typeof fm["duckmage-submap"] === "string" && fm["duckmage-submap"]) h.locations = [fm["duckmage-submap"]];
  if (fm.locked === true || fm.locked === "true") h.locked = true;
  return h;
}

/**
 * Per-hex map data for every map, backed by one map note per map
 * ("<hexFolder>/<map>/_<map>.md"). Reads are synchronous from memory;
 * writes update memory at once and reach the note debounced, so painting a
 * hundred hexes is one write, not a hundred.
 *
 * The map's settings (MapData) stay in settings.maps as the working copy
 * (every reader is synchronous) and data.json keeps a cache; the note wins
 * on load, like palette notes.
 */
export class MapStore {
  private hexes = new Map<string, Map<string, HexData>>();
  /** Content we last wrote/read per note path (echo suppression). */
  private lastContent = new Map<string, string>();
  /** Map-data key we last wrote per map (skip no-op writes). */
  private lastKey = new Map<string, string>();
  /** Per map: the outside inputs (palette names, path types) its derived Summary/Route were last written or loaded with. */
  private lastDerived = new Map<string, string>();
  private dirty = new Set<string>();
  private writeTimer: number | undefined;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(map: string) => void>();
  /** Maps whose note exists but doesn't parse: never written over. */
  private broken = new Set<string>();
  /** The sticky notice shown for each broken map (hidden once it reads again). */
  private brokenNotices = new Map<string, Notice>();
  /** Format-1 notes backed up this session before their first rewrite. */
  private backedUp = new Set<string>();
  /** Maps whose unreadable rows get reported once the note has been quiet a moment. */
  private toReview = new Set<string>();
  private reviewTimer: number | undefined;
  /** Last reported unreadable rows per map (so a notice isn't repeated). */
  private reported = new Map<string, string>();
  /** Per map: which handed-out pathChains object is which branch (see chainView.ts). */
  private views = new Map<string, PathView>();
  /** Per map: segment routes under its current routing context (and the previous one, for pinning). */
  private routeCaches = new Map<string, RouteCache>();
  /** Maps still being moved out of hex-note frontmatter (their terrain isn't in memory yet). */
  private migrating = new Set<string>();
  /** Per map: what converting its old every-hex paths did, saved next to its backup. */
  private pathReports = new Map<string, CompactReport>();
  /** Old every-hex paths converted this session, per map (for the startup notice). */
  private converted: { map: string; report: CompactReport }[] = [];
  private contextListeners = new Set<(e: RouteContextChange) => boolean | void>();

  constructor(private plugin: HexmakerPlugin) {}

  /**
   * No map: the store has loaded every map note. With a map: that map's
   * terrain and palette are loaded too, so its paths can be resolved
   * (routing earlier would route around an incomplete set of impassable
   * hexes and the line would jump when the rest arrived). The palette store
   * loads before this one (HexmakerPlugin: paletteStore.init().then(mapStore.init)).
   */
  isReady(map?: string): boolean {
    if (!this.ready) return false;
    if (map === undefined) return true;
    const ps = (this.plugin as { paletteStore?: { isReady?: () => boolean } }).paletteStore;
    if (ps?.isReady && !ps.isReady()) return false;
    return !!this.plugin.getMap(map) && !this.broken.has(map) && !this.migrating.has(map);
  }

  // ── paths ────────────────────────────────────────────────────────────

  private hexFolder(): string {
    return normalizeFolder(this.plugin.settings.hexFolder ?? "");
  }

  mapFolder(map: string): string {
    const root = this.hexFolder();
    return root ? `${root}/${map}` : map;
  }

  notePath(map: string): string {
    return `${this.mapFolder(map)}/_${map}.md`;
  }

  /** Which map and hex a hex-note path belongs to, if any. */
  resolve(path: string): { map: string; key: string } | null {
    const root = this.hexFolder();
    const rel = root ? (path.startsWith(root + "/") ? path.slice(root.length + 1) : null) : path;
    if (!rel) return null;
    const parts = rel.split("/");
    if (parts.length !== 2) return null;
    const m = HEX_FILE.exec(parts[1]);
    if (!m) return null;
    return { map: parts[0], key: `${m[1]}_${m[2]}` };
  }

  // ── reads / writes ───────────────────────────────────────────────────

  private table(map: string): Map<string, HexData> {
    let t = this.hexes.get(map);
    if (!t) { t = new Map(); this.hexes.set(map, t); }
    return t;
  }

  get(map: string, key: string): HexData | undefined {
    return this.hexes.get(map)?.get(key);
  }

  /** All hexes of a map with data (read-only view). */
  all(map: string): ReadonlyMap<string, HexData> {
    return this.hexes.get(map) ?? new Map();
  }

  /**
   * Patch one hex. `undefined`/`null`/empty values clear that field. The
   * note write is debounced; listeners hear about the change at once.
   */
  set(map: string, key: string, patch: { [K in keyof HexData]?: HexData[K] | null }): void {
    const t = this.table(map);
    const h: HexData = { ...(t.get(key) ?? {}) };
    for (const [k, v] of Object.entries(patch) as [keyof HexData, unknown][]) {
      const empty = v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
      if (empty) delete h[k];
      else (h as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(h).length) t.set(key, h); else t.delete(key);
    if ("terrain" in patch) this.terrainChanged(map);
    this.markDirty(map);
    this.emit(map);
  }

  /** Bulk set (generators, map creation): one dirty mark, one event. */
  setMany(map: string, cells: Iterable<[string, Partial<HexData>]>): void {
    const t = this.table(map);
    for (const [key, patch] of cells) {
      const h: HexData = { ...(t.get(key) ?? {}), ...patch };
      for (const k of Object.keys(h) as (keyof HexData)[]) if (h[k] === undefined || h[k] === "") delete h[k];
      if (Object.keys(h).length) t.set(key, h); else t.delete(key);
    }
    this.terrainChanged(map);
    this.markDirty(map);
    this.emit(map);
  }

  /** Terrain changed: if that moves the map's routing context, routes are pinned (see routeCache). */
  private terrainChanged(name: string): void {
    const map = this.plugin.getMap(name);
    if (map && map.paths?.length && this.routeCaches.has(name) && this.isReady(name)) this.routeCache(map);
  }

  onChange(fn: (map: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── paths (anchored model) ───────────────────────────────────────────

  /**
   * A map's routing context changed (terrain painted impassable or back, a
   * palette's impassable flags, the grid's size or stagger). A listener that
   * returns true has dealt with it (phase 7: pin with a notice and "Reroute
   * instead"); otherwise the store keeps every route where it was by adding
   * anchors (Decision 3), silently.
   */
  onRouteContextChange(fn: (e: RouteContextChange) => boolean | void): () => void {
    this.contextListeners.add(fn);
    return () => this.contextListeners.delete(fn);
  }

  /** The map's routing inputs now (see paths/mapContext.ts). */
  routeContext(map: MapData): RouteContext {
    const p = this.plugin as Partial<Pick<HexmakerPlugin, "getMapPalette">> & { settings: { hexOrientation?: "flat" | "pointy"; staggerOffset?: "odd" | "even" } };
    let palette: TerrainColor[] = [];
    try { palette = p.getMapPalette?.call(this.plugin, map.name) ?? []; } catch { /* no palette yet */ }
    return mapRouteContext({
      orientation: p.settings.hexOrientation ?? "flat",
      stagger: map.staggerOffset ?? p.settings.staggerOffset ?? "odd",
      gridSize: map.gridSize,
      gridOffset: map.gridOffset,
      baseTerrain: map.baseTerrain,
      terrainOf: this.all(map.name),
      impassable: impassableNames(palette),
    });
  }

  /** The routing style of each of the map's path types (their explicit fields only). */
  pathStyleFor(map: MapData): StyleFor {
    const p = this.plugin as Partial<Pick<HexmakerPlugin, "getMapPathTypes">>;
    let types: PathType[] = [];
    try { types = p.getMapPathTypes?.call(this.plugin, map.name) ?? []; } catch { /* none */ }
    return pathTypeStyleFor(types);
  }

  /** The map's segment cache, switched to its current context (pinning first if that changed). */
  routeCache(map: MapData): RouteCache {
    let cache = this.routeCaches.get(map.name);
    if (!cache) { cache = new RouteCache(); this.routeCaches.set(map.name, cache); }
    const before = cache.context;
    const after = this.routeContext(map);
    if (!cache.setContext(after) || !before) return cache;
    const previous = cache.previous()!;
    const styleFor = this.pathStyleFor(map);
    let handled = false;
    for (const fn of this.contextListeners) {
      try { if (fn({ map: map.name, before, after, previous, current: cache, styleFor }) === true) handled = true; }
      catch (e) { console.error("Hexmaker: route context listener failed", e); }
    }
    if (!handled && map.paths?.length) {
      const { paths, pinned } = pinChanged(map.paths, segmentFn(previous, styleFor), segmentFn(cache, styleFor), after);
      if (pinned.length) {
        map.paths = paths;
        if (!this.broken.has(map.name)) this.markDirty(map.name);
      }
    }
    cache.dropPrevious();
    return cache;
  }

  /** The map's paths resolved to hexes, or null until its terrain and palette are loaded. */
  resolved(name: string): ResolvedBranch[] | null {
    const map = this.plugin.getMap(name);
    if (!map || !this.isReady(name)) return null;
    this.syncPaths(map);
    return resolvePaths(map.paths ?? [], this.routeCache(map).context!, this.pathStyleFor(map), this.routeCache(map));
  }

  /** The map's paths (the stored model), with edits made through pathChains folded in. */
  paths(name: string): readonly MapPath[] {
    const map = this.plugin.getMap(name);
    if (!map) return [];
    this.syncPaths(map);
    return map.paths ?? [];
  }

  /** Replace a map's paths (new tools): pathChains is rebuilt to match, the note written. */
  setPaths(name: string, paths: MapPath[]): void {
    const map = this.plugin.getMap(name);
    if (!map) return;
    map.paths = paths;
    this.rebuildView(map);
    this.markDirty(name);
    this.emit(name);
  }

  /** Anchors that route back to exactly `hexes` (dense when nothing shorter does). */
  private anchorsOf(map: MapData, typeName: string, hexes: HexKey[]): HexKey[] {
    if (!this.isReady(map.name)) return dedupeSteps(hexes);
    const cache = this.routeCache(map);
    const route = routeFnFor(cache, styleOf(this.pathStyleFor(map), typeName));
    const a = anchorsFor(hexes, route, cache.context!);
    return reproduces(a, hexes, route) ? a : dedupeSteps(hexes);
  }

  /** pathChains rebuilt from the paths (one chain per resolved branch). */
  private rebuildView(map: MapData): void {
    const old = this.views.get(map.name);
    // Needs the map's terrain in memory (the palette store loads first).
    if (this.broken.has(map.name) || this.migrating.has(map.name)) {
      this.views.set(map.name, emptyView());
      return;
    }
    const cache = this.routeCache(map);
    const resolved = resolvePaths(map.paths ?? [], cache.context!, this.pathStyleFor(map), cache);
    const { chains, view } = buildView(resolved, old?.removed);
    map.pathChains = chains;
    this.views.set(map.name, view);
  }

  /**
   * Fold edits made through the compatibility view (map.pathChains: the
   * path tool, generators, type renames) into map.paths.
   */
  private syncPaths(map: MapData): void {
    if (!this.ready || this.broken.has(map.name) || this.migrating.has(map.name)) return;
    if (!map.pathChains) map.pathChains = [];
    const view = this.views.get(map.name) ?? emptyView();
    const r = reconcile(map.paths ?? [], map.pathChains, view, (t, h) => this.anchorsOf(map, t, h));
    this.views.set(map.name, r.view);
    if (r.changed || !map.paths) map.paths = r.paths;
  }

  /**
   * Convert old every-hex paths (data.json chains, or a format 2–4 note's
   * `Type | Hexes` rows): merge same-type chains that touch end to end,
   * drop one-hex leftovers with no notes or extra columns (they stay in the
   * backup and the report), and give each branch the fewest anchors that
   * route back to exactly its hexes. `others` (already anchored) are kept
   * first, unchanged.
   */
  private convertLegacy(map: MapData, legacy: MapPath[], others: MapPath[]): void {
    const cache = this.routeCache(map);
    const { paths, report } = compactLegacy(legacy, cache.context!, { dropSingles: true, styleFor: this.pathStyleFor(map), cache });
    const taken = others.map((p) => p.name);
    const named = paths.map((p) => {
      const name = uniquePathName(p.name, taken);
      taken.push(name);
      return name === p.name ? p : { ...p, name };
    });
    map.paths = [...others, ...named];
    this.pathReports.set(map.name, report);
    this.converted.push({ map: map.name, report });
  }

  /** Save a map's path-conversion report next to its backup (once). */
  private async savePathReport(map: string): Promise<void> {
    const report = this.pathReports.get(map);
    this.pathReports.delete(map);
    if (!report || !report.pathsIn) return;
    const adapter = this.plugin.app.vault.adapter;
    try {
      const dir = this.backupDir();
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      let path = `${dir}/${map}-paths-report.md`;
      for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${map}-paths-report-${n}.md`;
      await adapter.write(path, pathReportText(map, report));
    } catch (e) {
      console.error(`Hexmap World Creator: couldn't save the path report for ${map}`, e);
    }
  }

  private emit(map: string): void {
    for (const fn of this.listeners) {
      try { fn(map); } catch (e) { console.error("Hexmaker: map listener failed", e); }
    }
  }

  private markDirty(map: string): void {
    this.dirty.add(map);
    if (!this.ready) return;
    window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => void this.flush(), 500);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => console.error("Hexmaker: map note sync failed", e));
    return this.queue;
  }

  /** Write every dirty map's note now (and report unreadable rows still waiting). */
  flush(): Promise<void> {
    window.clearTimeout(this.writeTimer);
    return this.enqueue(async () => {
      const maps = [...this.dirty];
      this.dirty.clear();
      for (const name of maps) {
        const map = this.plugin.getMap(name);
        if (map) await this.writeNote(map);
      }
      if (this.toReview.size) await this.review();
    });
  }

  /**
   * Maps by unique name, first wins (as getMap does). Old data.json files
   * can hold two maps with the same name; both share one folder and note.
   */
  private uniqueMaps(): MapData[] {
    const seen = new Set<string>();
    return this.plugin.settings.maps.filter((m) => !seen.has(m.name) && !!seen.add(m.name));
  }

  /**
   * This map's note is loaded and readable, so it holds the map's paths and
   * data.json needn't (see HexmakerPlugin.saveData).
   */
  holdsPaths(name: string): boolean {
    return this.ready && this.lastKey.has(name) && !this.broken.has(name);
  }

  /**
   * data.json was replaced from outside (Obsidian Sync from another device):
   * its map entries are fresh objects without paths, so put every readable
   * note's settings and paths back on them before anything syncs. The notes
   * win, as on startup.
   */
  reloadFromNotes(): Promise<void> {
    if (!this.ready) return this.queue;
    return this.enqueue(async () => {
      for (const map of this.uniqueMaps()) {
        if (this.broken.has(map.name)) continue;
        const r = await this.loadMap(map);
        if (typeof r === "object") this.markBroken(map.name, this.notePath(map.name), r.unreadable, r.newer);
      }
      this.plugin.refreshHexMap();
    });
  }

  /** Settings changed (saveSettings): write notes whose data differs. */
  sync(): Promise<void> {
    if (!this.ready) return this.queue;
    for (const m of this.uniqueMaps()) {
      if (this.lastKey.get(m.name) !== mapNoteKey(this.dataFor(m))) this.dirty.add(m.name);
      // A palette change can change the derived Summary (a terrain no longer
      // "not in the palette"): rewrite; the write is skipped if the text is the same.
      else if (this.lastDerived.has(m.name) && this.lastDerived.get(m.name) !== JSON.stringify(this.contextFor(m))) this.dirty.add(m.name);
    }
    return this.flush();
  }

  /** What the note's derived parts need from the palette (see MapNoteContext). Tolerant of a partial plugin. */
  contextFor(map: MapData): MapNoteContext {
    const p = this.plugin as Partial<Pick<HexmakerPlugin, "getMapPalette" | "getMapPathTypes" | "mapPaletteName" | "paletteStore">>;
    const ctx: MapNoteContext = {};
    try {
      if (p.getMapPalette) ctx.paletteTerrains = p.getMapPalette.call(this.plugin, map.name).map((t) => t.name);
      if (p.getMapPathTypes) ctx.pathTypes = p.getMapPathTypes.call(this.plugin, map.name).map((t) => t.name);
      // Only the palette the map names, when installed (else the name is shown plain).
      const used = p.mapPaletteName?.call(this.plugin, map.name);
      const note = used && used === map.paletteName ? p.paletteStore?.notePathOf(used) : undefined;
      if (note) ctx.paletteNote = note.replace(/.md$/i, "");
    } catch (e) {
      console.error("Hexmaker: couldn't read the palette for a map note's summary", e);
    }
    const resolved = this.isReady(map.name) && map.paths?.length ? this.resolved(map.name) : null;
    if (resolved) ctx.pathRoutes = pathRouteStats(map.paths ?? [], resolved);
    return ctx;
  }

  dataFor(map: MapData): MapNoteData {
    this.syncPaths(map);
    const { name: _n, pathChains: _c, paths, savedViewport: _v, ...settings } = map;
    return { settings: settings, hexes: this.table(map.name), paths: paths ?? [] };
  }

  private async writeNote(map: MapData): Promise<void> {
    if (this.broken.has(map.name)) return;
    const { vault } = this.plugin.app;
    const path = this.notePath(map.name);
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const current = await vault.read(file);
      // Re-check what's on disk now: a hand edit may have broken it since
      // we last read it (onModify not run yet). Never write over that.
      const r = readMapNote(current, this.readOpts(path));
      if (!r || !r.ok) {
        this.markBroken(map.name, path, r ? r.reason : NO_FRONTMATTER, r && !r.ok ? r.newer : undefined);
        return;
      }
      const seen = this.lastContent.get(path);
      if (seen !== undefined && seen !== current) {
        // Edited outside (by hand, or synced in) and not loaded yet: fold
        // those edits in first so this write doesn't undo them.
        this.foldIn(map, seen, r.data);
      }
      if ((r.data.format ?? 1) < MAP_NOTE_FORMAT && !this.backedUp.has(path)) {
        if (!(await this.backupMapNote(map.name, current))) {
          this.markBroken(map.name, path, "it couldn't be backed up before converting it to the new format");
          return;
        }
        this.backedUp.add(path);
      }
      await this.savePathReport(map.name);
      const data = this.dataFor(map);
      const ctx = this.contextFor(map);
      const next = updateMapNote(current, map.name, data, ctx);
      this.lastDerived.set(map.name, JSON.stringify(ctx));
      // The write rewrites the warning callouts from what's in the note.
      this.reported.set(map.name, problemSignature(r.data.problems));
      this.lastContent.set(path, next);
      if (next !== current) await vault.modify(file, next);
      this.lastKey.set(map.name, mapNoteKey(data));
    } else {
      const data = this.dataFor(map);
      const folder = this.mapFolder(map.name);
      if (!vault.getAbstractFileByPath(folder)) {
        try { await vault.createFolder(folder); } catch { /* exists */ }
      }
      const ctx = this.contextFor(map);
      const content = buildMapNote(map.name, data, ctx);
      this.lastDerived.set(map.name, JSON.stringify(ctx));
      this.lastContent.set(path, content);
      await vault.create(path, content);
      this.lastKey.set(map.name, mapNoteKey(data));
    }
  }

  // ── load / hand edits ────────────────────────────────────────────────

  /** Wikilinks in the note (background image, tables) resolve like Obsidian's. */
  private readOpts(notePath: string): MapNoteReadOptions {
    const mc = this.plugin.app.metadataCache as { getFirstLinkpathDest?: (link: string, source: string) => TFile | null };
    return { resolveLink: (link) => mc.getFirstLinkpathDest?.(link, notePath)?.path };
  }

  /**
   * Apply a parsed note to a map: settings + paths onto MapData, hexes into
   * memory. In current-format notes a settings key deleted by hand resets
   * that setting (unless its line just couldn't be read).
   */
  private apply(map: MapData, data: MapNoteData): void {
    Object.assign(map, data.settings);
    if ((data.format ?? 1) >= READABLE_KEYS_FORMAT) {
      const unreadable = new Set((data.problems ?? []).map((p) => p.field));
      const m = map as unknown as Record<string, unknown>;
      for (const f of RESETTABLE_FIELDS) if (!(f in data.settings) && !unreadable.has(f)) delete m[f];
    }
    this.hexes.set(map.name, this.matchCase(map, data.hexes));
    this.applyPaths(map, data);
    this.lastKey.set(map.name, mapNoteKey(this.dataFor(map)));
    // Loaded or hand-edited: taken as written. Derived parts catch up on the next write.
    this.lastDerived.set(map.name, JSON.stringify(this.contextFor(map)));
  }

  /**
   * The note's paths onto the map: old every-hex rows in an older note are
   * converted (merged, compacted; see convertLegacy), the routing context is
   * brought up to date (a hand edit that painted water under a road keeps
   * the road), and pathChains is rebuilt to match.
   */
  private applyPaths(map: MapData, data: MapNoteData): void {
    const legacy = new Set(data.legacyPaths ?? []);
    if (legacy.size && (data.format ?? 1) < PATHS_FORMAT) {
      this.convertLegacy(map, data.paths.filter((p) => legacy.has(p.name)), data.paths.filter((p) => !legacy.has(p.name)));
    } else {
      map.paths = data.paths;
      this.routeCache(map);
    }
    this.rebuildView(map);
  }

  /**
   * Palette and terrain names typed in another case ("forest" for "Forest")
   * read as the palette's own spelling; the next write puts that in the note.
   */
  private matchCase(map: MapData, hexes: Map<string, HexData>): Map<string, HexData> {
    const out = new Map(hexes);
    const palettes = (this.plugin.settings as { terrainPalettes?: { name: string }[] }).terrainPalettes;
    if (Array.isArray(palettes) && map.paletteName && !palettes.some((p) => p.name === map.paletteName)) {
      const hit = palettes.find((p) => p.name.toLowerCase() === map.paletteName.toLowerCase());
      if (hit) map.paletteName = hit.name;
    }
    const getPalette = (this.plugin as { getMapPalette?: (name: string) => { name: string }[] }).getMapPalette;
    const terrains = getPalette ? getPalette.call(this.plugin, map.name) : [];
    if (!terrains.length) return out;
    const exact = new Set(terrains.map((t) => t.name));
    const lower = new Map(terrains.map((t) => [t.name.toLowerCase(), t.name]));
    const fix = (t: string | undefined) => (t && !exact.has(t) ? lower.get(t.toLowerCase()) ?? t : t);
    for (const [k, h] of out) {
      const t = fix(h.terrain);
      if (t !== h.terrain) out.set(k, { ...h, terrain: t });
    }
    if (map.baseTerrain) map.baseTerrain = fix(map.baseTerrain);
    if (map.terrainType) map.terrainType = fix(map.terrainType);
    return out;
  }

  /**
   * Edits made to the note outside the plugin since `seenText` (the version
   * we last read or wrote), folded into memory: any hex, setting or the
   * path list they changed takes their value; everything else keeps ours.
   */
  private foldIn(map: MapData, seenText: string, theirs: MapNoteData): void {
    const base = parseMapNote(seenText);
    if (!base) { this.apply(map, theirs); return; }
    const t = this.table(map.name);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const k of new Set([...base.hexes.keys(), ...theirs.hexes.keys()])) {
      if (same(base.hexes.get(k), theirs.hexes.get(k))) continue;
      const h = theirs.hexes.get(k);
      if (h) t.set(k, h); else t.delete(k);
    }
    const m = map as unknown as Record<string, unknown>;
    const bs = base.settings as Record<string, unknown>, ts = theirs.settings as Record<string, unknown>;
    for (const k of new Set([...Object.keys(bs), ...Object.keys(ts)])) {
      if (same(bs[k], ts[k])) continue;
      if (k in ts) m[k] = ts[k];
      else if ((theirs.format ?? 1) >= READABLE_KEYS_FORMAT && RESETTABLE_FIELDS.includes(k)) delete m[k];
    }
    this.syncPaths(map);
    const merged = mergePaths(base.paths, theirs.paths, map.paths ?? []);
    if (!same(merged, map.paths ?? [])) {
      map.paths = merged;
      this.routeCache(map);
      this.rebuildView(map);
    }
  }

  /** "loaded", "missing" (no note: migrate), or why it can't be read (leave it alone). */
  private async loadMap(map: MapData): Promise<"loaded" | "missing" | { unreadable: string; newer?: number }> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.notePath(map.name));
    if (!(file instanceof TFile)) return "missing";
    const content = await this.plugin.app.vault.read(file);
    const r = readMapNote(content, this.readOpts(file.path));
    this.lastContent.set(file.path, content);
    if (!r || !r.ok) return { unreadable: r ? r.reason : NO_FRONTMATTER, newer: r && !r.ok ? r.newer : undefined };
    this.apply(map, r.data);
    if ((r.data.format ?? 1) < MAP_NOTE_FORMAT) this.dirty.add(map.name);
    else if (r.data.problems?.length) this.toReview.add(map.name);
    return "loaded";
  }

  /**
   * A map note that can't be read: hold every change in memory instead of
   * writing over it (a rebuild would lose the user's text), and say so once
   * with a notice that stays until it reads again.
   */
  private markBroken(map: string, path: string, reason: string, newer?: number): void {
    if (this.broken.has(map)) return;
    this.broken.add(map);
    this.brokenNotices.set(map, new Notice(
      newer
        ? `Hexmap World Creator: the map note ${path} is in map-note format ${newer}, from a newer version of the plugin. Update Hexmap World Creator to use this map; until then changes to it aren't saved.`
        : `Hexmap World Creator: can't read the map note ${path}: ${reason}. Changes to this map aren't saved until it's fixed; fix it in the note and the map reloads from it.`,
      0,
    ));
  }

  private markReadable(map: string): void {
    if (!this.broken.delete(map)) return;
    this.brokenNotices.get(map)?.hide();
    this.brokenNotices.delete(map);
  }

  /** A map note edited by hand (or synced in): reload that map. */
  onModify(file: TAbstractFile): void {
    if (!this.ready || !(file instanceof TFile)) return;
    const m = /\/?_([^/]+)\.md$/.exec(file.path);
    if (!m || file.path !== this.notePath(m[1])) return;
    const map = this.plugin.getMap(m[1]);
    if (!map) return;
    void this.enqueue(async () => {
      const content = await this.plugin.app.vault.read(file);
      if (this.lastContent.get(file.path) === content) return; // our own write
      this.lastContent.set(file.path, content);
      const r = readMapNote(content, this.readOpts(file.path));
      if (!r || !r.ok) {
        // Broken mid-session (a lost `---`, a renamed table header…): the
        // next paint must not rebuild the note over the user's text.
        this.markBroken(map.name, file.path, r ? r.reason : NO_FRONTMATTER, r && !r.ok ? r.newer : undefined);
        return;
      }
      this.markReadable(map.name);
      const data = r.data;
      const before = new Map(this.hexes.get(map.name) ?? []);
      this.apply(map, data);
      // Names renamed by hand in the table: keep their notes' aliases in step.
      for (const r of renamedHexes(before, data.hexes)) {
        await syncHexNameAlias(this.plugin.app, `${this.mapFolder(map.name)}/${r.key}.md`, r.oldName, r.newName);
      }
      await this.plugin.saveData(this.plugin.settings);
      this.emit(map.name);
      this.plugin.refreshHexMap();
      this.scheduleReview(map.name);
    });
  }

  /** Report unreadable rows once the note has been left alone for a moment (not mid-typing). */
  private scheduleReview(map: string): void {
    this.toReview.add(map);
    window.clearTimeout(this.reviewTimer);
    this.reviewTimer = window.setTimeout(() => void this.enqueue(() => this.review()), 3000);
  }

  /**
   * For each map waiting: a notice naming the note if its unreadable rows
   * changed, and the note's warning callout brought in line (only the
   * callout; the rest is tidied on the next real write).
   */
  private async review(): Promise<void> {
    window.clearTimeout(this.reviewTimer);
    const maps = [...this.toReview];
    this.toReview.clear();
    const { vault } = this.plugin.app;
    for (const name of maps) {
      if (this.broken.has(name)) continue;
      const path = this.notePath(name);
      const file = vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const content = await vault.read(file);
      const r = readMapNote(content);
      if (!r || !r.ok) continue;
      this.report(name, path, r.data.problems ?? []);
      const next = refreshProblemCallouts(content);
      if (next !== content) {
        this.lastContent.set(path, next);
        await vault.modify(file, next);
      }
    }
  }

  private report(map: string, path: string, problems: MapNoteProblem[]): void {
    const sig = problemSignature(problems);
    if ((this.reported.get(map) ?? "") === sig) return;
    this.reported.set(map, sig);
    if (!problems.length) return;
    const n = problems.length;
    const first = problems.slice(0, 2).map((p) => `"${p.text.length > 40 ? p.text.slice(0, 40) + "…" : p.text}" (${p.reason})`).join("; ");
    new Notice(`Hexmap World Creator: ${n === 1 ? "a line" : `${n} lines`} in ${path} couldn't be read: ${first}${n > 2 ? "; …" : ""}. ${n === 1 ? "It's" : "They're"} kept as written; the warning box in the note lists ${n === 1 ? "it" : "them"}.`, 10000);
  }

  /** Copy a format-1 map note's text before its first rewrite. Never overwrites. */
  private async backupMapNote(map: string, text: string): Promise<boolean> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      const dir = this.backupDir();
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      let path = `${dir}/${map}-map-note.md`;
      for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${map}-map-note-${n}.md`;
      await adapter.write(path, text);
      return true;
    } catch (e) {
      console.error(`Hexmap World Creator: couldn't back up the map note for ${map}; it wasn't converted`, e);
      return false;
    }
  }

  /** A map was renamed (folder already moved): move its note too. */
  async renameMap(oldName: string, newName: string): Promise<void> {
    const t = this.hexes.get(oldName);
    if (t) { this.hexes.delete(oldName); this.hexes.set(newName, t); }
    if (this.broken.delete(oldName)) this.broken.add(newName);
    for (const m of [this.views, this.routeCaches] as Map<string, unknown>[]) {
      if (m.has(oldName)) { m.set(newName, m.get(oldName)); m.delete(oldName); }
    }
    const { vault, fileManager } = this.plugin.app;
    const moved = vault.getAbstractFileByPath(`${this.mapFolder(newName)}/_${oldName}.md`);
    if (moved instanceof TFile) await fileManager.renameFile(moved, this.notePath(newName));
    this.lastKey.delete(oldName);
    this.lastDerived.delete(oldName);
    this.dirty.add(newName);
    await this.flush();
  }

  /**
   * Make each hex's Region map cell agree with the region maps' records
   * (the map record wins; see regionMirrorFixes). Logged, never silent.
   * Maps in `skip` (unreadable notes) aren't touched.
   */
  repairRegionMirrors(skip: string[] = []): number {
    const maps = this.uniqueMaps();
    const fixes = regionMirrorFixes(maps, (m, k) => this.get(m, k), (m) => this.all(m))
      .filter((f) => !skip.includes(f.map) && !this.broken.has(f.map));
    for (const f of fixes) {
      console.warn(`Hexmap World Creator: fixed a region link: ${f.map} hex ${f.hex}: ${f.reason}.`);
      this.set(f.map, f.hex, f.patch);
    }
    return fixes.length;
  }

  forgetMap(name: string): void {
    this.hexes.delete(name);
    this.views.delete(name);
    this.routeCaches.delete(name);
    this.lastKey.delete(name);
    this.lastDerived.delete(name);
    this.dirty.delete(name);
  }

  // ── startup + migration ──────────────────────────────────────────────

  /**
   * Call at layout ready. Maps that already have a note load from it.
   * Maps that don't are migrated: their hex notes' map data is copied into
   * a new map note (verified by reading it back), backed up as JSON, and
   * only then cleaned out of the hex notes (which keep all their prose and
   * get a link to the map note). Notes are never deleted.
   */
  init(): Promise<void> {
    return this.enqueue(async () => {
      const maps = this.uniqueMaps();
      const toMigrate: MapData[] = [];
      const unreadable: MapData[] = [];
      for (const map of maps) {
        const r = await this.loadMap(map);
        if (r === "missing") toMigrate.push(map);
        else if (r !== "loaded") {
          // A map note that exists but doesn't parse (hand-broken
          // frontmatter or table) must never be "migrated" over: its hex
          // notes are already cleaned, so that would write an empty map.
          // Keep the note, hold edits in memory only, and say so.
          unreadable.push(map);
          this.markBroken(map.name, this.notePath(map.name), r.unreadable, r.newer);
        }
      }
      for (const m of toMigrate) this.migrating.add(m.name);
      this.ready = true;
      if (toMigrate.length) await this.migrate(toMigrate);
      // Hex notes still carrying map data after a load (an interrupted
      // cleanup, or notes synced in from an older device) get cleaned now.
      await this.cleanHexNotes(maps.filter((m) => !toMigrate.includes(m) && !unreadable.includes(m)), false);
      // Region map cells follow the region maps' own records.
      this.repairRegionMirrors(unreadable.map((m) => m.name));
      // Notes in the older format (JSON values) are converted once, after a
      // backup; unreadable rows in the others are reported.
      for (const name of [...this.dirty]) {
        const map = this.plugin.getMap(name);
        this.dirty.delete(name);
        if (map) await this.writeNote(map);
      }
      await this.review();
      this.reportConversions();
      this.plugin.refreshHexMap();
    });
  }

  /** One notice for the old every-hex paths converted this session. */
  private reportConversions(): void {
    const done = this.converted.filter((c) => c.report.pathsIn > 0);
    this.converted = [];
    if (!done.length) return;
    const sum = (f: (r: CompactReport) => number) => done.reduce((n, c) => n + f(c.report), 0);
    const chains = sum((r) => r.pathsIn), paths = sum((r) => r.pathsOut), singles = sum((r) => r.singlesDropped.length);
    const merged = sum((r) => r.merged.length), inexact = sum((r) => r.inexact.length);
    new Notice(
      `Hexmap World Creator: paths on ${done.length} map${done.length === 1 ? "" : "s"} moved to the new format: ${chains} old path${chains === 1 ? "" : "s"} became ${paths}` +
        (merged ? ` (${merged} joined from touching pieces)` : "") +
        (singles ? `; ${singles} one-hex leftover${singles === 1 ? " was" : "s were"} dropped` : "") +
        (inexact ? `; ${inexact} kept every hex as written` : "") +
        `. The old notes and a report per map are in ${this.backupDir()}.`,
      15000,
    );
  }

  private hexFiles(map: string): TFile[] {
    const folder = this.plugin.app.vault.getAbstractFileByPath(this.mapFolder(map));
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((f): f is TFile => f instanceof TFile && HEX_FILE.test(f.name));
  }

  private async frontmatterOf(file: TFile): Promise<Record<string, unknown> | undefined> {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (cache) return cache.frontmatter;
    // Not indexed yet: parse it ourselves.
    const text = await this.plugin.app.vault.cachedRead(file);
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return undefined;
    try { return (parseYaml(m[1]) ?? undefined) as Record<string, unknown> | undefined; } catch { return undefined; }
  }

  private async migrate(maps: MapData[]): Promise<void> {
    const notice = new Notice(`Hexmap World Creator: moving map data into map notes (0/${maps.length} maps)…`, 0);
    const backupDir = this.backupDir();
    const adapter = this.plugin.app.vault.adapter;
    let done = 0;
    const failed: string[] = [];
    for (const map of maps) {
      const hexes = new Map<string, HexData>();
      for (const file of this.hexFiles(map.name)) {
        const h = hexDataFromFrontmatter(await this.frontmatterOf(file));
        if (Object.keys(h).length) hexes.set(file.basename, h);
      }
      this.hexes.set(map.name, hexes);
      this.migrating.delete(map.name);
      // data.json's every-hex paths become named, anchored paths (backed up below).
      const oldChains: PathChain[] = (map.pathChains ?? []).map((c) => ({ ...c, hexes: [...c.hexes] }));
      if (!map.paths) this.convertLegacy(map, legacyChainsToPaths(oldChains), []);
      this.rebuildView(map);
      // Write, then read back and compare before touching any hex note.
      await this.writeNote(map);
      const written = this.plugin.app.vault.getAbstractFileByPath(this.notePath(map.name));
      const back = written instanceof TFile ? parseMapNote(await this.plugin.app.vault.read(written)) : null;
      const expected = mapNoteKey(this.dataFor(map));
      if (!back || mapNoteKey({ ...back, settings: this.dataFor(map).settings }) !== expected) {
        failed.push(map.name);
        continue;
      }
      try {
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(`${backupDir}/${map.name}.json`, JSON.stringify({ map: map.name, hexes: [...hexes], pathChains: oldChains }, null, 1));
        await this.savePathReport(map.name);
      } catch (e) {
        console.error("Hexmaker: map-note backup failed", e);
        failed.push(map.name);
        continue;
      }
      await this.cleanHexNotes([map], true);
      done++;
      notice.setMessage(`Hexmap World Creator: moving map data into map notes (${done}/${maps.length} maps)…`);
    }
    notice.hide();
    if (failed.length) {
      new Notice(`Hexmap World Creator: couldn't move map data for ${failed.join(", ")} — their hex notes were left untouched.`, 0);
    } else {
      new Notice(`Hexmap World Creator: map data for ${done} map${done === 1 ? "" : "s"} now lives in map notes (_<map>.md). Hex notes keep their text; a full copy of them is in ${backupDir}.`);
    }
    await this.plugin.saveData(this.plugin.settings);
  }

  /**
   * Remove map-data keys from hex notes whose data the map note already
   * holds, leaving a link to the map note. Only keys whose value matches
   * the map note are removed unless `trustNote` (fresh migration) — so a
   * hex note edited on an old device isn't silently overwritten.
   */
  private async cleanHexNotes(maps: MapData[], trustNote: boolean): Promise<void> {
    const { fileManager } = this.plugin.app;
    for (const map of maps) {
      const link = `[[_${map.name}]]`;
      const toClean: { file: TFile; fm: Record<string, unknown> }[] = [];
      for (const file of this.hexFiles(map.name)) {
        const fm = await this.frontmatterOf(file);
        if (fm && HEX_DATA_KEYS.some((k) => k in fm)) toClean.push({ file, fm });
      }
      if (!toClean.length) continue;
      // processFrontMatter re-serialises the whole frontmatter, so comments
      // and formatting in other keys can change. Keep the full text of every
      // note we're about to touch; if that can't be saved, touch none.
      if (!(await this.backupHexNotes(map.name, toClean.map((c) => c.file)))) continue;
      for (const { file, fm } of toClean) {
        const fromNote = hexDataFromFrontmatter(fm);
        const stored = this.get(map.name, file.basename) ?? {};
        if (!trustNote && JSON.stringify(fromNote) !== JSON.stringify(pick(stored, fromNote))) {
          // The hex note disagrees with the map note: take the hex note's
          // values (it was edited elsewhere), then clean it.
          this.set(map.name, file.basename, fromNote);
        }
        await fileManager.processFrontMatter(file, (f: Record<string, unknown>) => {
          for (const k of HEX_DATA_KEYS) delete f[k];
          f[MAP_LINK_KEY] = link;
        });
      }
    }
  }

  private backupDir(): string {
    return `${this.plugin.manifest.dir}/backups/map-notes-${new Date().toISOString().slice(0, 10)}`;
  }

  /**
   * Save the full text of `files` as `<backupDir>/<map>-hex-notes.json.gz`
   * (`.json` where gzip isn't available), never overwriting an earlier one.
   * About 110 bytes per note gzipped. Returns false if it couldn't be saved.
   */
  private async backupHexNotes(map: string, files: TFile[]): Promise<boolean> {
    const { vault } = this.plugin.app;
    const adapter = vault.adapter;
    try {
      const notes: Record<string, string> = {};
      for (const f of files) notes[f.path] = await vault.read(f);
      const json = JSON.stringify({ map, savedAt: new Date().toISOString(), notes });
      await writeJsonBackup(adapter, this.backupDir(), `${map}-hex-notes`, json);
      return true;
    } catch (e) {
      console.error(`Hexmap World Creator: couldn't back up hex notes for ${map}; they were left untouched`, e);
      return false;
    }
  }
}

const NO_FRONTMATTER = "its frontmatter (the --- lines with hexmaker-map at the top) is missing or broken";

function problemSignature(problems: MapNoteProblem[] | undefined): string {
  return (problems ?? []).map((p) => `${p.where}\u0000${p.text}\u0000${p.reason}`).join("\u0001");
}

/**
 * Settings as written to data.json: maps whose note holds their paths
 * (`holds`) go without `pathChains`. Everything else is shared, not copied.
 */
export function withoutNotePaths<S extends { maps: MapData[] }>(settings: S, holds: (name: string) => boolean): S {
  const maps = settings.maps.map((m) => {
    if (!holds(m.name)) return m;
    const { pathChains: _chains, paths: _paths, ...rest } = m;
    return rest as MapData;
  });
  return { ...settings, maps };
}

/** The fields of `a` that `like` has, for comparing partial hex data. */
function pick(a: HexData, like: HexData): HexData {
  const out: HexData = {};
  for (const k of Object.keys(like) as (keyof HexData)[]) (out as Record<string, unknown>)[k] = a[k];
  return out;
}

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

/** A map's path-conversion report, as a note next to its backup. */
export function pathReportText(map: string, r: CompactReport): string {
  const lines = [
    `# Paths of ${map}: converted to named paths with anchors`,
    "",
    `- Old paths (every hex listed): ${r.pathsIn}`,
    `- New paths: ${r.pathsOut} (${r.branches} branches, ${r.anchors} anchors)`,
    `- Joined from pieces that touched end to end: ${r.merged.length}`,
    `- One-hex leftovers dropped (no notes): ${r.singlesDropped.length}`,
    `- Duplicate strokes dropped (every step already drawn): ${r.duplicates.length}`,
    `- Kept with every hex as an anchor (couldn't be shortened exactly): ${r.inexact.length}`,
    "",
    "Every new path draws exactly the steps of the old ones it came from. The old paths are in the backup next to this report.",
    "Below, old paths are named by their type and their place among the old paths of that type (Road, Road 2, Road 3…); the new paths are named the same way, so a name here may now be a different path.",
  ];
  if (r.merged.length) lines.push("", "## Joined", "", ...r.merged.map((m) => `- ${m.name}: ${m.from.join(", ")}`));
  if (r.duplicates.length) lines.push("", "## Duplicate strokes", "", ...r.duplicates.map((d) => `- ${d.name} (already drawn by ${d.into})`));
  if (r.singlesDropped.length) lines.push("", "## One-hex leftovers dropped", "", ...r.singlesDropped.map((d) => `- ${d.name} (${d.typeName}) at ${d.hex.replace("_", ", ")}`));
  if (r.inexact.length) lines.push("", "## Kept as written", "", ...r.inexact.map((n) => `- ${n}`));
  if (r.combinedText.length) lines.push("", "## Notes combined from joined pieces", "", ...r.combinedText.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}

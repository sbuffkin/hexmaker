import { Notice, TAbstractFile, TFile, TFolder, parseYaml } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildMapNote,
  mapNoteKey,
  parseMapNote,
  updateMapNote,
  type HexData,
  type MapNoteData,
} from "./mapNote";
import { renamedHexes, syncHexNameAlias } from "./hexNames";

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
  if (typeof fm["duckmage-submap"] === "string" && fm["duckmage-submap"]) h.submap = fm["duckmage-submap"];
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
  private dirty = new Set<string>();
  private writeTimer: number | undefined;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(map: string) => void>();
  /** Maps whose note exists but doesn't parse: never written over. */
  private broken = new Set<string>();

  constructor(private plugin: HexmakerPlugin) {}

  isReady(): boolean {
    return this.ready;
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
    this.markDirty(map);
    this.emit(map);
  }

  onChange(fn: (map: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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

  /** Write every dirty map's note now. */
  flush(): Promise<void> {
    window.clearTimeout(this.writeTimer);
    return this.enqueue(async () => {
      const maps = [...this.dirty];
      this.dirty.clear();
      for (const name of maps) {
        const map = this.plugin.getMap(name);
        if (map) await this.writeNote(map);
      }
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
        if (!this.broken.has(map.name)) await this.loadMap(map);
      }
      this.plugin.refreshHexMap();
    });
  }

  /** Settings changed (saveSettings): write notes whose data differs. */
  sync(): Promise<void> {
    if (!this.ready) return this.queue;
    for (const m of this.uniqueMaps()) {
      if (this.lastKey.get(m.name) !== mapNoteKey(this.dataFor(m))) this.dirty.add(m.name);
    }
    return this.flush();
  }

  dataFor(map: MapData): MapNoteData {
    const { name: _n, pathChains, savedViewport: _v, ...settings } = map;
    return { settings: settings, hexes: this.table(map.name), paths: pathChains ?? [] };
  }

  private async writeNote(map: MapData): Promise<void> {
    if (this.broken.has(map.name)) return;
    const { vault } = this.plugin.app;
    const data = this.dataFor(map);
    const key = mapNoteKey(data);
    const path = this.notePath(map.name);
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const current = await vault.read(file);
      const next = updateMapNote(current, map.name, data);
      if (next !== current) {
        this.lastContent.set(path, next);
        await vault.modify(file, next);
      }
    } else {
      const folder = this.mapFolder(map.name);
      if (!vault.getAbstractFileByPath(folder)) {
        try { await vault.createFolder(folder); } catch { /* exists */ }
      }
      const content = buildMapNote(map.name, data);
      this.lastContent.set(path, content);
      await vault.create(path, content);
    }
    this.lastKey.set(map.name, key);
  }

  // ── load / hand edits ────────────────────────────────────────────────

  /** Apply a parsed note to a map: settings + paths onto MapData, hexes into memory. */
  private apply(map: MapData, data: MapNoteData): void {
    Object.assign(map, data.settings);
    map.pathChains = data.paths;
    this.hexes.set(map.name, new Map(data.hexes));
    this.lastKey.set(map.name, mapNoteKey(this.dataFor(map)));
  }

  /** "loaded", "missing" (no note: migrate), or "unreadable" (leave it alone). */
  private async loadMap(map: MapData): Promise<"loaded" | "missing" | "unreadable"> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.notePath(map.name));
    if (!(file instanceof TFile)) return "missing";
    const content = await this.plugin.app.vault.read(file);
    const data = parseMapNote(content);
    if (!data) return "unreadable";
    this.lastContent.set(file.path, content);
    this.apply(map, data);
    return "loaded";
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
      const data = parseMapNote(content);
      if (!data) return;
      this.broken.delete(map.name);
      this.lastContent.set(file.path, content);
      const before = new Map(this.hexes.get(map.name) ?? []);
      this.apply(map, data);
      // Names renamed by hand in the table: keep their notes' aliases in step.
      for (const r of renamedHexes(before, data.hexes)) {
        await syncHexNameAlias(this.plugin.app, `${this.mapFolder(map.name)}/${r.key}.md`, r.oldName, r.newName);
      }
      await this.plugin.saveData(this.plugin.settings);
      this.emit(map.name);
      this.plugin.refreshHexMap();
    });
  }

  /** A map was renamed (folder already moved): move its note too. */
  async renameMap(oldName: string, newName: string): Promise<void> {
    const t = this.hexes.get(oldName);
    if (t) { this.hexes.delete(oldName); this.hexes.set(newName, t); }
    const { vault, fileManager } = this.plugin.app;
    const moved = vault.getAbstractFileByPath(`${this.mapFolder(newName)}/_${oldName}.md`);
    if (moved instanceof TFile) await fileManager.renameFile(moved, this.notePath(newName));
    this.lastKey.delete(oldName);
    this.dirty.add(newName);
    await this.flush();
  }

  forgetMap(name: string): void {
    this.hexes.delete(name);
    this.lastKey.delete(name);
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
        else if (r === "unreadable") unreadable.push(map);
      }
      // A map note that exists but doesn't parse (hand-broken frontmatter)
      // must never be "migrated" over: its hex notes are already cleaned,
      // so that would write an empty map. Keep the note, hold edits in
      // memory only, and say so.
      for (const m of unreadable) this.broken.add(m.name);
      if (unreadable.length) {
        new Notice(`Hexmap World Creator: couldn't read the map note for ${unreadable.map((m) => m.name).join(", ")} (${unreadable.map((m) => this.notePath(m.name)).join(", ")}). Fix its frontmatter (it needs "hexmaker-map: 1"); it won't be overwritten until then.`, 0);
      }
      this.ready = true;
      if (toMigrate.length) await this.migrate(toMigrate);
      // Hex notes still carrying map data after a load (an interrupted
      // cleanup, or notes synced in from an older device) get cleaned now.
      await this.cleanHexNotes(maps.filter((m) => !toMigrate.includes(m) && !unreadable.includes(m)), false);
      this.plugin.refreshHexMap();
    });
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
        await adapter.write(`${backupDir}/${map.name}.json`, JSON.stringify({ map: map.name, hexes: [...hexes] }, null, 1));
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
      const dir = this.backupDir();
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      const gz = typeof CompressionStream === "function";
      const ext = gz ? ".json.gz" : ".json";
      let path = `${dir}/${map}-hex-notes${ext}`;
      for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${map}-hex-notes-${n}${ext}`;
      if (gz) {
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
        await adapter.writeBinary(path, await new Response(stream).arrayBuffer());
      } else {
        await adapter.write(path, json);
      }
      return true;
    } catch (e) {
      console.error(`Hexmap World Creator: couldn't back up hex notes for ${map}; they were left untouched`, e);
      return false;
    }
  }
}

/**
 * Settings as written to data.json: maps whose note holds their paths
 * (`holds`) go without `pathChains`. Everything else is shared, not copied.
 */
export function withoutNotePaths<S extends { maps: MapData[] }>(settings: S, holds: (name: string) => boolean): S {
  const maps = settings.maps.map((m) => {
    if (!holds(m.name)) return m;
    const { pathChains: _paths, ...rest } = m;
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

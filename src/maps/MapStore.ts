import { Notice, TAbstractFile, TFile, TFolder, parseYaml } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildMapNote,
  MAP_NOTE_FORMAT,
  mapNoteKey,
  parseMapNote,
  readMapNote,
  refreshProblemCallouts,
  RESETTABLE_FIELDS,
  updateMapNote,
  type HexData,
  type MapNoteData,
  type MapNoteProblem,
  type MapNoteReadOptions,
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
  /** The sticky notice shown for each broken map (hidden once it reads again). */
  private brokenNotices = new Map<string, Notice>();
  /** Format-1 notes backed up this session before their first rewrite. */
  private backedUp = new Set<string>();
  /** Maps whose unreadable rows get reported once the note has been quiet a moment. */
  private toReview = new Set<string>();
  private reviewTimer: number | undefined;
  /** Last reported unreadable rows per map (so a notice isn't repeated). */
  private reported = new Map<string, string>();

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
        if (typeof r === "object") this.markBroken(map.name, this.notePath(map.name), r.unreadable);
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
    const path = this.notePath(map.name);
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const current = await vault.read(file);
      // Re-check what's on disk now: a hand edit may have broken it since
      // we last read it (onModify not run yet). Never write over that.
      const r = readMapNote(current, this.readOpts(path));
      if (!r || !r.ok) {
        this.markBroken(map.name, path, r ? r.reason : NO_FRONTMATTER);
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
      const data = this.dataFor(map);
      const next = updateMapNote(current, map.name, data);
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
      const content = buildMapNote(map.name, data);
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
    if ((data.format ?? 1) >= MAP_NOTE_FORMAT) {
      const unreadable = new Set((data.problems ?? []).map((p) => p.field));
      const m = map as unknown as Record<string, unknown>;
      for (const f of RESETTABLE_FIELDS) if (!(f in data.settings) && !unreadable.has(f)) delete m[f];
    }
    map.pathChains = data.paths;
    this.hexes.set(map.name, this.matchCase(map, data.hexes));
    this.lastKey.set(map.name, mapNoteKey(this.dataFor(map)));
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
      else if ((theirs.format ?? 1) >= MAP_NOTE_FORMAT && RESETTABLE_FIELDS.includes(k)) delete m[k];
    }
    if (!same(base.paths, theirs.paths)) map.pathChains = theirs.paths;
  }

  /** "loaded", "missing" (no note: migrate), or why it can't be read (leave it alone). */
  private async loadMap(map: MapData): Promise<"loaded" | "missing" | { unreadable: string }> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.notePath(map.name));
    if (!(file instanceof TFile)) return "missing";
    const content = await this.plugin.app.vault.read(file);
    const r = readMapNote(content, this.readOpts(file.path));
    this.lastContent.set(file.path, content);
    if (!r || !r.ok) return { unreadable: r ? r.reason : NO_FRONTMATTER };
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
  private markBroken(map: string, path: string, reason: string): void {
    if (this.broken.has(map)) return;
    this.broken.add(map);
    this.brokenNotices.set(map, new Notice(
      `Hexmap World Creator: can't read the map note ${path}: ${reason}. Changes to this map aren't saved until it's fixed; fix it in the note and the map reloads from it.`,
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
        this.markBroken(map.name, file.path, r ? r.reason : NO_FRONTMATTER);
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
        else if (r !== "loaded") {
          // A map note that exists but doesn't parse (hand-broken
          // frontmatter or table) must never be "migrated" over: its hex
          // notes are already cleaned, so that would write an empty map.
          // Keep the note, hold edits in memory only, and say so.
          unreadable.push(map);
          this.markBroken(map.name, this.notePath(map.name), r.unreadable);
        }
      }
      this.ready = true;
      if (toMigrate.length) await this.migrate(toMigrate);
      // Hex notes still carrying map data after a load (an interrupted
      // cleanup, or notes synced in from an older device) get cleaned now.
      await this.cleanHexNotes(maps.filter((m) => !toMigrate.includes(m) && !unreadable.includes(m)), false);
      // Notes in the older format (JSON values) are converted once, after a
      // backup; unreadable rows in the others are reported.
      for (const name of [...this.dirty]) {
        const map = this.plugin.getMap(name);
        this.dirty.delete(name);
        if (map) await this.writeNote(map);
      }
      await this.review();
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

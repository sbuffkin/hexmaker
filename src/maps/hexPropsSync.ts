/**
 * Keeps hex notes' terrain / area / icon / name properties (src/maps/hexProps.ts)
 * in step with the map, both ways (owner MG4).
 *
 * Map → notes: every MapStore change (paint, generate, reroll, undo, a
 * terrain or area rename, a hand edit of the map note) is noted per map;
 * a moment later the hexes whose properties changed are found by comparing
 * with what was last synced, and only the notes that exist are written.
 * Notes are never created for this.
 *
 * Notes → map: a hex note whose properties change (properties panel, or
 * the text) is compared with what the plugin last wrote there (the memory,
 * `hex-properties-shown.json` in the plugin folder). A hand edit goes to
 * the map as one undo step through the work-mode gate, so it counts as a
 * hand edit (it locks an open place); one the mode or the palette refuses
 * is put back with a notice. While the note is open in the editor, a
 * refused edit is left as typed and nothing is rewritten under the cursor:
 * it's settled when the note is left.
 *
 * Precedence: when the map and the note both changed a field since the
 * last sync, the map wins and the note is rewritten (see hexProps.ts).
 *
 * Echoes: a change event whose text is exactly what we just wrote is ours
 * and ignored; every sync reads the note's text, never a possibly stale
 * metadata cache, before deciding anything.
 */
import { Notice, TFile, TFolder, parseYaml, type App, type TAbstractFile } from "obsidian";
import type { MapStore } from "./MapStore";
import type { MapData, TerrainColor } from "../types";
import { CalloutMemory } from "./calloutMemory";
import { uniqueMapsByName } from "./mapTree";
import { sameName } from "../hexBodyFields";
import { lockedHint } from "../workMode";
import { needsWrite, planPropsSync, propsOf, readProps, setPropsInText, type HexProps, type NoteProps, type PropField } from "./hexProps";

/** What the sync needs from the plugin. */
export interface HexPropsHost {
  app: App;
  manifest: { dir?: string };
  settings: { hexNoteProperties?: boolean; maps: MapData[] };
  mapStore: Pick<MapStore, "isReady" | "resolve" | "mapFolder" | "get" | "all" | "set" | "onChange">;
  getMap(name: string): MapData | undefined;
  getMapPalette(map: string): TerrainColor[];
  availableIcons: string[];
  mapLabel(map: string): string;
  undoableEdit<T>(map: string, fn: () => T | Promise<T>): Promise<T>;
  setHexName(map: string, x: number, y: number, name: string): Promise<void>;
  syncHexEncounterTableLink(path: string, terrain: string | null): Promise<void>;
}

const MEMORY_FILE = "hex-properties-shown.json";
const HEX_FILE = /^-?\d+_-?\d+\.md$/;
const DELAY = 300;

/** A note's text → its properties (frontmatter parsed; unreadable YAML reads as none). */
export function notePropsOfText(text: string): NoteProps {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(\r?\n|$)/.exec(text);
  let fm: Record<string, unknown> | undefined;
  if (m) {
    try { fm = (parseYaml(m[1]) ?? undefined) as Record<string, unknown> | undefined; } catch { fm = undefined; }
  }
  return readProps(fm && typeof fm === "object" ? fm : undefined);
}

interface Refusal { field: PropField; value: string | null; why: string }

export class HexPropsSync {
  /** What each hex note's properties showed when last synced (path → field → value). */
  readonly memory: CalloutMemory;
  private started = false;
  private stopListening: (() => void) | null = null;
  /** Per map: hex key → its properties (JSON) as last synced, to find what a change touched. */
  private seen = new Map<string, Map<string, string>>();
  private dirtyMaps = new Set<string>();
  private dirtyNotes = new Set<string>();
  private timer: number | undefined;
  private queue: Promise<void> = Promise.resolve();
  /** Texts we just wrote, per path: their change events are echoes. */
  private wrote = new Map<string, string>();
  /** Notes holding a refused edit while open in the editor (settled when left). */
  private held = new Set<string>();
  private focused: string | null = null;
  /** Test hook: how many notes the sync wrote. */
  writes = 0;

  constructor(private host: HexPropsHost) {
    this.memory = new CalloutMemory(() => host.app.vault.adapter, () => host.manifest.dir ?? "", MEMORY_FILE);
  }

  /** The setting (Advanced): on unless turned off. */
  get enabled(): boolean {
    return this.host.settings.hexNoteProperties !== false;
  }

  /** Following changes (started, and the setting on). */
  get running(): boolean {
    return this.started && this.enabled;
  }

  /**
   * Startup, after the note upgrades: bring every hex note in line (a
   * restart with nothing changed writes nothing), then follow changes.
   */
  start(): Promise<void> {
    if (this.started || !this.enabled) return this.queue;
    this.started = true;
    this.stopListening = this.host.mapStore.onChange((map) => this.mapChanged(map));
    return this.enqueue(async () => {
      await this.memory.ready();
      for (const m of uniqueMapsByName(this.host.settings.maps)) await this.syncMap(m.name, true);
    });
  }

  /** Stop following changes (the setting was turned off). */
  stop(): void {
    this.started = false;
    this.stopListening?.();
    this.stopListening = null;
    this.seen.clear();
    this.dirtyMaps.clear();
    this.dirtyNotes.clear();
    this.held.clear();
    window.clearTimeout(this.timer);
  }

  /** The properties a new hex note starts with (createHexNote), remembered as written. */
  withProps(content: string, map: string, x: number, y: number, path: string): string {
    if (!this.enabled) return content;
    const props = propsOf(this.host.mapStore.get(map, `${x}_${y}`));
    const next = setPropsInText(content, props);
    if (next !== content) this.rememberShown(path, props);
    return next;
  }

  /** What a migration wrote into a note: remembered, so a later hand edit is told from it. */
  remember(path: string, props: HexProps): void {
    this.rememberShown(path, props);
  }

  /** None shown is kept as no entry: it reads the same (hexProps.planPropsSync) and keeps the file small. */
  private rememberShown(path: string, props: HexProps): void {
    if (Object.keys(props).length) this.memory.set(path, props);
    else this.memory.forget(path);
  }

  // ── events (wired in src/plugin/vaultEvents.ts) ──────────────────────

  mapChanged(map: string): void {
    if (!this.running) return;
    this.dirtyMaps.add(map);
    this.schedule();
  }

  /** A note's metadata changed (`data`: its text). */
  onMetadataChanged(file: TAbstractFile, data?: string): void {
    if (!this.running || !(file instanceof TFile) || !HEX_FILE.test(file.name)) return;
    if (data !== undefined && this.wrote.get(file.path) === data) {
      this.wrote.delete(file.path); // our own write
      return;
    }
    const loc = this.host.mapStore.resolve(file.path);
    if (!loc || !this.host.getMap(loc.map)) return;
    this.dirtyNotes.add(file.path);
    this.schedule();
  }

  /** A note was opened: the one left behind settles anything held while it was open. */
  onFileOpen(file: TFile | null): void {
    const prev = this.focused;
    this.focused = file?.path ?? null;
    if (prev && prev !== this.focused && this.held.has(prev) && this.running) {
      this.dirtyNotes.add(prev);
      this.schedule();
    }
  }

  onRename(oldPath: string, newPath: string): void {
    this.memory.rename(oldPath, newPath);
    this.held.delete(oldPath);
  }

  onDelete(path: string): void {
    this.memory.forget(path);
    this.held.delete(path);
    this.wrote.delete(path);
  }

  // ── the sync ─────────────────────────────────────────────────────────

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), DELAY);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => console.error("Hexmaker: hex note properties sync failed", e));
    return this.queue;
  }

  /** Sync everything waiting now (tests; the timer otherwise). */
  flush(): Promise<void> {
    window.clearTimeout(this.timer);
    return this.enqueue(async () => {
      if (!this.running) return;
      const maps = [...this.dirtyMaps];
      const notes = [...this.dirtyNotes];
      this.dirtyMaps.clear();
      this.dirtyNotes.clear();
      for (const m of maps) await this.syncMap(m, false);
      for (const p of notes) {
        const file = this.host.app.vault.getAbstractFileByPath(p);
        const loc = this.host.mapStore.resolve(p);
        if (file instanceof TFile && loc) await this.syncNote(file, loc.map, loc.key);
      }
    });
  }

  /** A map's hexes whose properties changed since the last sync (`all`: every hex note of the map). */
  private async syncMap(map: string, all: boolean): Promise<void> {
    if (!this.host.mapStore.isReady(map) || !this.host.getMap(map)) return;
    const now = new Map<string, string>();
    for (const [k, h] of this.host.mapStore.all(map)) {
      const p = propsOf(h);
      if (Object.keys(p).length) now.set(k, JSON.stringify(p));
    }
    const before = this.seen.get(map);
    this.seen.set(map, now);
    const folder = this.host.mapStore.mapFolder(map);
    if (all || !before) {
      const dir = this.host.app.vault.getAbstractFileByPath(folder);
      if (!(dir instanceof TFolder)) return;
      const files = dir.children.filter((f): f is TFile => f instanceof TFile && HEX_FILE.test(f.name));
      for (const f of files) await this.syncNote(f, map, f.basename, true);
      return;
    }
    for (const k of new Set([...now.keys(), ...before.keys()])) {
      if (now.get(k) === before.get(k)) continue;
      const file = this.host.app.vault.getAbstractFileByPath(`${folder}/${k}.md`);
      if (file instanceof TFile) await this.syncNote(file, map, k);
    }
  }

  /**
   * One note, both ways. `screen`: first ask the metadata cache whether the
   * note can need anything (startup's pass over every note); skipped for
   * notes we just wrote, whose cache may be behind.
   */
  private async syncNote(file: TFile, map: string, key: string, screen = false): Promise<void> {
    const { vault, metadataCache } = this.host.app;
    const path = file.path;
    const store = this.host.mapStore;
    let want = propsOf(store.get(map, key));
    if (screen && !this.wrote.has(path) && !this.held.has(path)) {
      const cache = metadataCache.getFileCache(file);
      if (cache && !needsWrite(readProps(cache.frontmatter), want)) {
        this.rememberShown(path, want);
        return;
      }
    }
    const text = await vault.read(file);
    // Changed again since our write: its echo won't come as written.
    if (this.wrote.has(path) && this.wrote.get(path) !== text) this.wrote.delete(path);
    const note = notePropsOfText(text);
    const base = this.memory.get(path) as HexProps | undefined;
    const plan = planPropsSync(note, want, base);
    const refused: Refusal[] = [];
    const imported = Object.keys(plan.imports) as PropField[];
    if (imported.length) {
      await this.importEdits(map, key, path, plan.imports, refused);
      want = propsOf(store.get(map, key));
      // The edit is taken: remembered as typed at once, so a later sync
      // (after an undo, or when the write below has to wait) reads the
      // note as a stale copy, never as the same edit again. A refused
      // edit stays an edit (put back below, or when the note is left).
      const shown: HexProps = { ...(base ?? {}) };
      for (const f of imported) {
        if (refused.some((r) => r.field === f)) continue;
        if (note.props[f]) shown[f] = note.props[f]; else delete shown[f];
      }
      this.rememberShown(path, shown);
      this.markSeen(map, key, want);
    }
    const active = this.isActive(path);
    if (active && imported.length) {
      // In the editor: the map has what was typed; the note isn't rewritten
      // under the cursor. Leaving it puts the map's spelling back.
      if (refused.length) this.held.add(path); else this.held.delete(path);
      return;
    }
    this.held.delete(path);
    const next = setPropsInText(text, want);
    if (next !== text) {
      let wrote = false;
      await vault.process(file, (cur) => {
        if (cur !== text) return cur; // changed meanwhile: synced again on its change event
        wrote = true;
        return next;
      });
      if (!wrote) {
        this.dirtyNotes.add(path);
        this.schedule();
        return;
      }
      this.wrote.set(path, next);
      this.writes++;
    }
    this.rememberShown(path, want);
    this.markSeen(map, key, want);
    if (refused.length) this.tellRefused(map, key, refused);
  }

  /**
   * The note now shows `props`: the map's later changes are compared with
   * that (an import followed by an undo back to the old value is a change).
   */
  private markSeen(map: string, key: string, props: HexProps): void {
    const seen = this.seen.get(map);
    if (!seen) return;
    if (Object.keys(props).length) seen.set(key, JSON.stringify(props));
    else seen.delete(key);
  }

  /** Put hand edits on the map (one undo step, through the work-mode gate). */
  private async importEdits(map: string, key: string, path: string, imports: Partial<Record<PropField, string | null>>, refused: Refusal[]): Promise<void> {
    const store = this.host.mapStore;
    const [x, y] = key.split("_").map(Number);
    await this.host.undoableEdit(map, async () => {
      for (const [field, value] of Object.entries(imports) as [PropField, string | null][]) {
        if (field === "name") {
          await this.host.setHexName(map, x, y, value ?? "");
        } else if (field === "terrain") {
          // A terrain must be one the map's palette has (matched ignoring case).
          const terrain = value === null ? null : this.host.getMapPalette(map).find((t) => sameName(t.name, value))?.name;
          if (terrain === undefined) refused.push({ field, value, why: "isn't in this map's palette" });
          else if (!store.set(map, key, { terrain }, "paint-terrain")) refused.push({ field, value, why: lockedHint("paint-terrain") });
          else await this.host.syncHexEncounterTableLink(path, terrain);
        } else if (field === "area") {
          if (!store.set(map, key, { region: value }, "paint-region-area")) refused.push({ field, value, why: lockedHint("paint-region-area") });
        } else {
          const icon = value === null ? null : this.host.availableIcons.find((i) => sameName(i, value));
          if (icon === undefined) refused.push({ field, value, why: "isn't an icon the plugin has" });
          else if (!store.set(map, key, { icon }, "paint-icon")) refused.push({ field, value, why: lockedHint("paint-icon") });
        }
      }
    });
  }

  private tellRefused(map: string, key: string, refused: Refusal[]): void {
    const [x, y] = key.split("_");
    const what = refused.map((r) => `${r.field} "${r.value ?? ""}": ${r.why.replace(/\.$/, "")}`).join("; ");
    new Notice(`${this.host.mapLabel(map)} ${x}, ${y}: not put on the map (${what}). The note's ${refused.length === 1 ? "property was" : "properties were"} put back.`, 8000);
  }

  private isActive(path: string): boolean {
    const ws = this.host.app.workspace as Partial<App["workspace"]> | undefined;
    return ws?.getActiveFile?.()?.path === path;
  }
}

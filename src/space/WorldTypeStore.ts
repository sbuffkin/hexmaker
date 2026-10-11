/**
 * World types tables in the vault: `<world types folder>/<name>.md`, one
 * note per table (worldTypes.ts has the format). The notes are the only
 * copy; data.json only remembers that the shipped "Default space" table
 * was written (`worldTypesSeeded`), so a deleted one isn't written again
 * (Restore default brings it back).
 *
 * - init(): reads every note, then writes the shipped table once when
 *   space maps are on (ensureDefault() does it on demand otherwise).
 * - Hand edits are read back live (vault events); rows that can't be read
 *   are reported once per edit, never used, and kept as written.
 * - A note from before stars and sector features were rows (format 1)
 *   is given the shipped Stars and Sector features tables once, when read;
 *   one from before the Mainworld column (format 1 or 2) the shipped
 *   rows' mainworlds (backed up first).
 * - source(): a table as the space generators' role tables (SP1).
 * - Every change is told to onChange listeners.
 */

import { Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { writeJsonBackup } from "../backup";
import { enabledKinds } from "../mapKinds";
import { biomeFileName } from "../overworld/biomeNote";
import {
  DEFAULT_WORLD_TYPES,
  buildWorldTypes,
  copyFeatureRows,
  copyStarRows,
  copyWorldTypeRows,
  parseWorldTypes,
  updateWorldTypes,
  upgradeWorldTypes,
  type SectorFeatureRow,
  type StarTypeRow,
  type WorldTypeExtras,
  type WorldTypeProblem,
  type WorldTypeRow,
  type WorldTypeTable,
} from "./worldTypes";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "./worldTypePresets";
import { chosenWorldTypes, defaultWorldTypesName, worldTypesSource } from "./worldTypesSource";
import type { TableSource } from "../worldgen/tableRoles";

interface Entry {
  path: string;
  name: string;
  rows: WorldTypeRow[];
  /** Undefined: the note has no Stars table. */
  stars?: StarTypeRow[];
  /** Undefined: the note has no Sector features table. */
  features?: SectorFeatureRow[];
  problems: WorldTypeProblem[];
}

/** An entry as a table (copies, so callers may change it). */
function tableOf(e: Entry): WorldTypeTable {
  const t: WorldTypeTable = { name: e.name, rows: copyWorldTypeRows(e.rows) };
  if (e.stars) t.stars = copyStarRows(e.stars);
  if (e.features) t.features = copyFeatureRows(e.features);
  return t;
}

/** Settings the store reads (a subset of the plugin's). */
interface StoreSettings {
  worldFolder?: string;
  worldTypesFolder?: string;
  worldTypesSeeded?: boolean;
  mapKinds?: string[];
}

/** The folder for world types notes: the setting, else `<world folder>/world-types`. */
export function worldTypesFolder(settings: StoreSettings): string {
  const configured = normalizeFolder(settings.worldTypesFolder ?? "");
  if (configured) return configured;
  const world = normalizeFolder(settings.worldFolder ?? "");
  return world ? `${world}/world-types` : "world-types";
}

export class WorldTypeStore {
  private entries = new Map<string, Entry>();
  private lastContent = new Map<string, string>();
  private reported = new Map<string, string>();
  private listeners = new Set<() => void>();
  private ready = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private plugin: HexmakerPlugin) {}

  private get settings(): StoreSettings {
    return this.plugin.settings;
  }

  isReady(): boolean {
    return this.ready;
  }

  folder(): string {
    return worldTypesFolder(this.settings);
  }

  /** Call `fn` after every change. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      for (const f of this.files()) await this.load(f);
      if (enabledKinds(this.settings).has("space")) await this.seed();
      this.ready = true;
      this.publish();
    });
  }

  /** Re-read every note (the folder setting changed). */
  async reload(): Promise<void> {
    await this.enqueue(async () => {
      this.entries.clear();
      this.lastContent.clear();
      for (const f of this.files()) await this.load(f);
      this.publish();
    });
  }

  /** Write the shipped table if it never was (once). */
  async ensureDefault(): Promise<void> {
    await this.enqueue(() => this.seed());
  }

  // ── API ────────────────────────────────────────────────────────────────

  /** Every table, by name. */
  list(): WorldTypeTable[] {
    return this.sorted().map(tableOf);
  }

  /** A table by name (any case) or note path. */
  get(name: string): WorldTypeTable | undefined {
    const e = this.find(name);
    return e ? tableOf(e) : undefined;
  }

  pathOf(name: string): string | undefined {
    return this.find(name)?.path;
  }

  /** What couldn't be read in a table's note. */
  problemsOf(name: string): WorldTypeProblem[] {
    return this.find(name)?.problems ?? [];
  }

  /** What the generators' "Default" World types means now (Default space, else the first table). */
  defaultName(): string | undefined {
    return defaultWorldTypesName(this.list().map((t) => t.name), DEFAULT_WORLD_TYPES);
  }

  /**
   * The space generators' role tables from the World types option's value
   * (SP1), for a palette. `source` undefined: no table (None, or none at
   * all), so equal odds; `missing`: the picked table isn't there.
   */
  sourceFor(value: string | undefined, palette: readonly (string | { name: string })[]): { source?: TableSource; missing?: string } {
    const name = chosenWorldTypes(value, this.list().map((t) => t.name), this.defaultName());
    if (!name) return {};
    const t = this.get(name);
    return t ? { source: worldTypesSource(t, palette) } : { missing: name };
  }

  hasDefault(name: string): boolean {
    return name.trim().toLowerCase() === DEFAULT_WORLD_TYPES.toLowerCase();
  }

  /**
   * Set a table's rows, and its Stars / Sector features rows when given
   * (rows the note has that can't be read are kept as written).
   */
  async update(name: string, rows: readonly WorldTypeRow[], extras: WorldTypeExtras = {}): Promise<boolean> {
    await this.queue; // hand edits read first
    const e = this.find(name);
    if (!e) return false;
    const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
    if (!(f instanceof TFile)) return false;
    await this.enqueue(async () => {
      const content = await this.plugin.app.vault.read(f);
      const next = updateWorldTypes(content, rows, extras);
      if (next !== content) await this.plugin.app.vault.modify(f, next);
      this.take(f.path, next);
      this.publish();
    });
    return true;
  }

  /** A new table note (rows default to a copy of the shipped table). Returns its name, or an error. */
  async create(
    name: string,
    rows: readonly WorldTypeRow[] = DEFAULT_WORLD_TYPE_ROWS,
    extras: WorldTypeExtras = DEFAULT_WORLD_TYPE_EXTRAS,
  ): Promise<{ name: string } | { error: string }> {
    const clean = name.trim() ? biomeFileName(name.trim()) : "";
    if (!clean) return { error: "Give the table a name." };
    const folder = this.folder();
    const path = `${folder}/${clean}.md`;
    if (this.find(clean) || this.plugin.app.vault.getAbstractFileByPath(path)) return { error: `There's already a table called ${clean}.` };
    await this.enqueue(async () => {
      await this.ensureFolder(folder);
      const text = buildWorldTypes(clean, copyWorldTypeRows(rows), extras);
      await this.plugin.app.vault.create(path, text);
      this.take(path, text);
      this.publish();
    });
    return { name: clean };
  }

  /**
   * Put the shipped rows back into the "Default space" note (the old note
   * is backed up first), or write the note again if it was deleted.
   */
  async restoreDefault(name: string = DEFAULT_WORLD_TYPES): Promise<boolean> {
    if (!this.hasDefault(name)) return false;
    await this.queue;
    const e = this.find(DEFAULT_WORLD_TYPES);
    const f = e ? this.plugin.app.vault.getAbstractFileByPath(e.path) : null;
    await this.enqueue(async () => {
      if (f instanceof TFile) {
        const content = await this.plugin.app.vault.read(f);
        await this.backup("default-space", { [f.path]: content });
        const next = updateWorldTypes(content, DEFAULT_WORLD_TYPE_ROWS, DEFAULT_WORLD_TYPE_EXTRAS);
        if (next !== content) await this.plugin.app.vault.modify(f, next);
        this.take(f.path, next);
      } else {
        await this.writeDefault();
      }
      this.publish();
    });
    return true;
  }

  // ── vault events ───────────────────────────────────────────────────────

  onModify(f: TAbstractFile): void {
    if (!this.isTableFile(f)) return;
    void this.enqueue(async () => {
      if (await this.load(f)) this.publish();
    });
  }

  onDelete(f: TAbstractFile): void {
    if (!this.entries.has(f.path)) return;
    this.entries.delete(f.path);
    this.lastContent.delete(f.path);
    this.publish();
  }

  onRename(f: TAbstractFile, oldPath: string): void {
    const had = this.entries.delete(oldPath);
    this.lastContent.delete(oldPath);
    if (!this.isTableFile(f)) {
      if (had) this.publish();
      return;
    }
    void this.enqueue(async () => {
      await this.load(f);
      this.publish();
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private sorted(): Entry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  }

  private find(name: string): Entry | undefined {
    const k = name.trim().replace(/\.md$/i, "").toLowerCase();
    const list = this.sorted();
    return list.find((e) => e.path.toLowerCase() === `${k}.md` || e.path.toLowerCase() === k)
      ?? list.find((e) => e.name.toLowerCase() === k);
  }

  private publish(): void {
    for (const fn of this.listeners) fn();
  }

  private isTableFile(f: TAbstractFile): f is TFile {
    return f instanceof TFile && f.extension === "md" && !f.basename.startsWith("_")
      && f.path.startsWith(this.folder() + "/");
  }

  private files(): TFile[] {
    const root = this.plugin.app.vault.getAbstractFileByPath(this.folder());
    if (!(root instanceof TFolder)) return [];
    const out: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.path.endsWith(".md") && !child.name.startsWith("_")) out.push(child);
      }
    };
    walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Read one note (upgrading a format 1 note first). True when what it says changed. */
  private async load(f: TFile): Promise<boolean> {
    let content = await this.plugin.app.vault.read(f);
    if (this.lastContent.get(f.path) === content && this.entries.has(f.path)) return false;
    const upgraded = upgradeWorldTypes(content, { ...DEFAULT_WORLD_TYPE_EXTRAS, rows: DEFAULT_WORLD_TYPE_ROWS });
    if (upgraded !== content) {
      try {
        await this.backup("upgrade", { [f.path]: content });
        await this.plugin.app.vault.modify(f, upgraded);
        content = upgraded;
      } catch (e) {
        console.error("Hexmaker: couldn't add stars and sector features to", f.path, e);
      }
    }
    this.take(f.path, content);
    return true;
  }

  private take(path: string, content: string): void {
    const { rows, stars, features, problems } = parseWorldTypes(content);
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const entry: Entry = { path, name, rows, problems };
    if (stars) entry.stars = stars;
    if (features) entry.features = features;
    this.entries.set(path, entry);
    this.lastContent.set(path, content);
    this.report(path, name, problems);
  }

  private report(path: string, name: string, problems: WorldTypeProblem[]): void {
    const key = problems.map((p) => p.text).join("; ");
    if (this.reported.get(path) === key) return;
    this.reported.set(path, key);
    if (key && this.ready) new Notice(`World types ${name}: couldn't read ${key}.`, 8000);
  }

  private async seed(): Promise<void> {
    if (this.settings.worldTypesSeeded) return;
    if (!this.find(DEFAULT_WORLD_TYPES)) await this.writeDefault();
    this.settings.worldTypesSeeded = true;
    await this.plugin.saveSettings();
  }

  private async writeDefault(): Promise<void> {
    const folder = this.folder();
    const path = `${folder}/${DEFAULT_WORLD_TYPES}.md`;
    if (this.plugin.app.vault.getAbstractFileByPath(path)) return;
    await this.ensureFolder(folder);
    const text = buildWorldTypes(DEFAULT_WORLD_TYPES, copyWorldTypeRows(DEFAULT_WORLD_TYPE_ROWS), DEFAULT_WORLD_TYPE_EXTRAS);
    try {
      await this.plugin.app.vault.create(path, text);
      this.take(path, text);
    } catch (e) {
      console.error("Hexmaker: couldn't write the world types note", path, e);
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    const vault = this.plugin.app.vault;
    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!vault.getAbstractFileByPath(p)) {
        try { await vault.createFolder(p); } catch { /* made meanwhile */ }
      }
    }
  }

  private async backup(base: string, notes: Record<string, string>): Promise<void> {
    try {
      const dir = `${this.plugin.manifest.dir}/backups/world-types-${new Date().toISOString().slice(0, 10)}`;
      await writeJsonBackup(this.plugin.app.vault.adapter, dir, base, JSON.stringify({ savedAt: new Date().toISOString(), notes }));
    } catch (e) {
      console.error("Hexmaker: world types backup failed", e);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => {
      console.error("Hexmaker: world types", e);
    });
    return this.queue;
  }
}

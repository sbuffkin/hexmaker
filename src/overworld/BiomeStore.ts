/**
 * Biome notes in the vault (#50): `<biomes folder>/<name>.md`, one per
 * overworld biome, the built-ins included. The notes are the only copy:
 * nothing about a biome is kept in data.json except which shipped biomes
 * have been written into notes already (`biomesSeeded`), so a deleted one
 * never comes back.
 *
 * - init(): reads every note, then writes each shipped biome (biomePresets)
 *   that hasn't been seeded yet and has no note: once, never over a note.
 * - Hand edits are read back live (vault events); unreadable rows are
 *   reported once per edit and left as written.
 * - A biome's `id` (frontmatter) is what references use, so renaming the
 *   note keeps every region and transition that names it. A note without
 *   an `id` key gets its old id written in when it's renamed.
 * - A deleted note's biome is gone: regions made from it keep their
 *   terrain and show "unknown biome".
 *
 * Every change is handed to the lookups in biomes.ts (setBiomeSource).
 */

import { Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { writeJsonBackup } from "../backup";
import {
  BIOME_NOTE_MARKER,
  biomeFileName,
  biomeSlug,
  buildBiomeNote,
  parseBiomeNote,
  updateBiomeNote,
  type BiomeNoteFields,
  type BiomeNoteProblem,
  type BiomeStoreApi,
} from "./biomeNote";
import { BIOME_PRESETS, biomePreset } from "./biomePresets";
import { setBiomeSource } from "./biomes";

interface Entry {
  path: string;
  fields: BiomeNoteFields;
  problems: BiomeNoteProblem[];
  /** The note has its own `id:` key (else the id is its name's). */
  ownId: boolean;
}

/** Which presets to write: not seeded before, and no note has their id or their file name. */
export function presetsToSeed(
  seeded: readonly string[],
  ids: ReadonlySet<string>,
  fileTaken: (fileName: string) => boolean,
  presets: readonly BiomeNoteFields[] = BIOME_PRESETS,
): { write: BiomeNoteFields[]; done: string[] } {
  const write: BiomeNoteFields[] = [];
  const done: string[] = [];
  for (const p of presets) {
    if (seeded.includes(p.id)) continue;
    done.push(p.id);
    if (ids.has(p.id) || fileTaken(biomeFileName(p.label))) continue;
    write.push(p);
  }
  return { write, done };
}

/**
 * Shipped biomes whose notes (written before biome climates) get their
 * preset climate added: not done before, the note has the preset's id and
 * no climate of its own. Once per biome, so clearing a climate by hand
 * sticks (that biome is then only placed by hand).
 */
export function climatesToAdd(
  done: readonly string[],
  notes: readonly BiomeNoteFields[],
  presets: readonly BiomeNoteFields[] = BIOME_PRESETS,
): { add: BiomeNoteFields[]; done: string[] } {
  const add: BiomeNoteFields[] = [];
  const now: string[] = [];
  for (const p of presets) {
    if (!p.climate || done.includes(p.id)) continue;
    now.push(p.id);
    const note = notes.find((n) => n.id === p.id);
    if (note && !note.climate) add.push({ ...note, climate: biomePreset(p.id)?.climate });
  }
  return { add, done: now };
}

export class BiomeStore implements BiomeStoreApi {
  private entries = new Map<string, Entry>();
  private lastContent = new Map<string, string>();
  private reported = new Map<string, string>();
  private listeners = new Set<() => void>();
  private ready = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private plugin: HexmakerPlugin) {}

  isReady(): boolean {
    return this.ready;
  }

  folder(): string {
    const configured = normalizeFolder(this.plugin.settings.biomesFolder ?? "");
    if (configured) return configured;
    const world = normalizeFolder(this.plugin.settings.worldFolder ?? "");
    return world ? `${world}/biomes` : "biomes";
  }

  /** Call `fn` after every change to the biomes. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      for (const f of this.files()) await this.load(f);
      await this.seed();
      await this.seedClimates();
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

  // ── API ────────────────────────────────────────────────────────────────

  list(): BiomeNoteFields[] {
    return this.active().map((e) => e.fields);
  }

  get(name: string): BiomeNoteFields | undefined {
    return this.find(name)?.fields;
  }

  /** The note a biome lives in. */
  pathOf(name: string): string | undefined {
    return this.find(name)?.path;
  }

  /** What couldn't be read in a biome's note. */
  problemsOf(name: string): BiomeNoteProblem[] {
    return this.find(name)?.problems ?? [];
  }

  hasDefault(name: string): boolean {
    const e = this.find(name);
    return !!e && !!biomePreset(e.fields.id);
  }

  async update(name: string, patch: Partial<Omit<BiomeNoteFields, "id">>): Promise<boolean> {
    await this.queue; // hand edits read first
    const e = this.find(name);
    if (!e) return false;
    const tables = e.problems.filter((p) => p.where !== "settings");
    if (tables.length && (patch.mix || patch.transitions)) {
      new Notice(`Biome ${e.fields.label}: fix the rows that can't be read in its note first (${tables[0].text}).`);
      return false;
    }
    const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
    if (!(f instanceof TFile)) return false;
    const fields: BiomeNoteFields = { ...e.fields, ...patch, id: e.fields.id };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (fields as unknown as Record<string, unknown>)[k];
    await this.enqueue(async () => {
      const content = await this.plugin.app.vault.read(f);
      const next = updateBiomeNote(content, fields);
      if (next !== content) await this.plugin.app.vault.modify(f, next);
      this.take(f.path, f.basename, next);
      this.publish();
    });
    return true;
  }

  /** Write a new biome note. Returns its id, or an error. */
  async create(fields: Omit<BiomeNoteFields, "id"> & { id?: string }): Promise<{ id: string } | { error: string }> {
    const label = fields.label.trim();
    if (!label) return { error: "Give the biome a name." };
    let id = biomeSlug(fields.id ?? label) || "biome";
    const taken = new Set(this.active().map((e) => e.fields.id));
    for (let n = 2; taken.has(id); n++) id = `${biomeSlug(fields.id ?? label) || "biome"}-${n}`;
    const folder = this.folder();
    let path = `${folder}/${biomeFileName(label)}.md`;
    for (let n = 2; this.plugin.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${biomeFileName(label)} ${n}.md`;
    const full: BiomeNoteFields = { ...fields, id, label };
    await this.enqueue(async () => {
      await this.ensureFolder(folder);
      const text = buildBiomeNote(full);
      await this.plugin.app.vault.create(path, text);
      this.take(path, path.slice(path.lastIndexOf("/") + 1, -3), text);
      this.publish();
    });
    return { id };
  }

  async restoreDefault(name: string): Promise<boolean> {
    const e = this.find(name);
    const preset = e ? biomePreset(e.fields.id) : undefined;
    if (!e || !preset) return false;
    const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
    if (!(f instanceof TFile)) return false;
    await this.enqueue(async () => {
      const content = await this.plugin.app.vault.read(f);
      await this.backup(`biome-${e.fields.id}`, { [e.path]: content });
      // Keep the note's name for the label only if the user renamed it.
      const next = updateBiomeNote(content, { ...preset });
      if (next !== content) await this.plugin.app.vault.modify(f, next);
      this.take(f.path, f.basename, next);
      this.publish();
    });
    return true;
  }

  // ── vault events ───────────────────────────────────────────────────────

  onModify(f: TAbstractFile): void {
    if (!this.isBiomeFile(f)) return;
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
    const old = this.entries.get(oldPath);
    if (old) {
      this.entries.delete(oldPath);
      this.lastContent.delete(oldPath);
    }
    if (!this.isBiomeFile(f)) {
      if (old) this.publish();
      return;
    }
    void this.enqueue(async () => {
      await this.load(f);
      const now = this.entries.get(f.path);
      // A note whose id came from its old name keeps that id (references follow).
      if (old && now && !now.ownId && now.fields.id !== old.fields.id) {
        const fields = { ...now.fields, id: old.fields.id };
        const content = await this.plugin.app.vault.read(f);
        const next = updateBiomeNote(content, fields);
        if (next !== content) await this.plugin.app.vault.modify(f, next);
        this.take(f.path, f.basename, next);
      }
      this.publish();
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Entries in path order, one per id (the first note with an id wins). */
  private active(): Entry[] {
    const seen = new Set<string>();
    const out: Entry[] = [];
    for (const e of [...this.entries.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      if (seen.has(e.fields.id)) continue;
      seen.add(e.fields.id);
      out.push(e);
    }
    return out;
  }

  private find(name: string): Entry | undefined {
    const k = biomeSlug(name);
    const list = this.active();
    return list.find((e) => e.fields.id === k)
      ?? list.find((e) => biomeSlug(e.fields.label) === k)
      ?? list.find((e) => biomeSlug(e.path.slice(e.path.lastIndexOf("/") + 1, -3)) === k);
  }

  private publish(): void {
    if (this.ready) setBiomeSource(this.list());
    for (const fn of this.listeners) fn();
  }

  private inFolder(path: string): boolean {
    return path.startsWith(this.folder() + "/") && path.endsWith(".md");
  }

  private isBiomeFile(f: TAbstractFile): f is TFile {
    return f instanceof TFile && f.extension === "md" && !f.basename.startsWith("_") && this.inFolder(f.path);
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

  /** Read one note. True when what it says changed. */
  private async load(f: TFile): Promise<boolean> {
    const content = await this.plugin.app.vault.read(f);
    if (this.lastContent.get(f.path) === content && this.entries.has(f.path)) return false;
    this.take(f.path, f.basename ?? f.path.slice(f.path.lastIndexOf("/") + 1, -3), content);
    return true;
  }

  private take(path: string, basename: string, content: string): void {
    const { fields, problems } = parseBiomeNote(content, basename);
    const ownId = /^id\s*:\s*\S/m.test(content.split(/\r?\n---/)[0] ?? "");
    this.entries.set(path, { path, fields, problems, ownId });
    this.lastContent.set(path, content);
    this.report(path, fields.label, problems);
    const dup = [...this.entries.values()].find((e) => e.path !== path && e.fields.id === fields.id);
    if (dup && this.ready) new Notice(`Biome notes ${dup.path} and ${path} have the same id (${fields.id}); the first is used. Change one note's id.`);
  }

  private report(path: string, label: string, problems: BiomeNoteProblem[]): void {
    const key = problems.map((p) => `${p.where}: ${p.text}`).join("; ");
    if (this.reported.get(path) === key) return;
    this.reported.set(path, key);
    if (key && this.ready) new Notice(`Biome ${label}: couldn't read ${key}. Those rows are left as written.`, 8000);
  }

  private async seed(): Promise<void> {
    const s = this.plugin.settings;
    const seeded = s.biomesSeeded ?? [];
    const ids = new Set([...this.entries.values()].map((e) => e.fields.id));
    const folder = this.folder();
    const plan = presetsToSeed(seeded, ids, (name) => !!this.plugin.app.vault.getAbstractFileByPath(`${folder}/${name}.md`));
    if (!plan.done.length) return;
    if (plan.write.length) {
      await this.ensureFolder(folder);
      // Anything already in the folder is saved first (nothing is written over, but just in case).
      if (this.entries.size) {
        const notes: Record<string, string> = {};
        for (const [p, c] of this.lastContent) notes[p] = c;
        await this.backup("biomes-before-seeding", notes);
      }
      for (const p of plan.write) {
        const path = `${folder}/${biomeFileName(p.label)}.md`;
        const text = buildBiomeNote(p);
        try {
          await this.plugin.app.vault.create(path, text);
          this.take(path, biomeFileName(p.label), text);
        } catch (e) {
          console.error("Hexmaker: couldn't write biome note", path, e);
        }
      }
    }
    s.biomesSeeded = [...seeded, ...plan.done];
    await this.plugin.saveSettings();
  }

  /** Add the shipped climates to built-in notes written before climates existed (climatesToAdd). */
  private async seedClimates(): Promise<void> {
    const s = this.plugin.settings;
    const done = s.biomeClimatesSeeded ?? [];
    const plan = climatesToAdd(done, this.active().map((e) => e.fields));
    if (!plan.done.length) return;
    for (const fields of plan.add) {
      const e = this.active().find((x) => x.fields.id === fields.id);
      const f = e ? this.plugin.app.vault.getAbstractFileByPath(e.path) : null;
      if (!(f instanceof TFile)) continue;
      try {
        const content = await this.plugin.app.vault.read(f);
        // Only notes the plugin wrote (they carry its marker key); a note the user wrote by hand is theirs.
        if (!new RegExp(`^${BIOME_NOTE_MARKER}\\s*:`, "m").test(content.split(/\r?\n---/)[0] ?? "")) continue;
        const next = updateBiomeNote(content, fields);
        if (next !== content) await this.plugin.app.vault.modify(f, next);
        this.take(f.path, f.basename, next);
      } catch (err) {
        console.error("Hexmaker: couldn't add a climate to biome note", f.path, err);
      }
    }
    s.biomeClimatesSeeded = [...done, ...plan.done];
    await this.plugin.saveSettings();
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
      const dir = `${this.plugin.manifest.dir}/backups/biome-notes-${new Date().toISOString().slice(0, 10)}`;
      await writeJsonBackup(this.plugin.app.vault.adapter, dir, base, JSON.stringify({ savedAt: new Date().toISOString(), notes }));
    } catch (e) {
      console.error("Hexmaker: biome backup failed", e);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => {
      console.error("Hexmaker: biome notes", e);
    });
    return this.queue;
  }
}

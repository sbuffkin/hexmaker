import { Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainPalette } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildPaletteNote,
  paletteFileName,
  parsePaletteNote,
  readChildPalette,
  readSubmapDefaults,
  setChildPalette,
  setSubmapDefaults,
  submapDefaultsKey,
  terrainsEqual,
  updatePaletteNote,
} from "./paletteNote";
import { PALETTE_PRESETS, uniquePaletteName } from "./presets";
import { inferTerrainType } from "../terrainTypes";

/**
 * Fill in missing terrain types: a same-named terrain in a preset wins,
 * else the type is inferred from the name/category. Returns how many
 * terrains were typed.
 */
export function seedTerrainTypes(palettes: TerrainPalette[]): number {
  const known = new Map<string, string>();
  for (const p of PALETTE_PRESETS) for (const t of p.terrains) if (t.type) known.set(t.name.toLowerCase(), t.type);
  let n = 0;
  for (const pal of palettes) {
    for (const t of pal.terrains) {
      if (t.type) continue;
      const type = known.get(t.name.toLowerCase()) ?? inferTerrainType(t.name, t.category);
      if (type) { t.type = type; n++; }
    }
  }
  return n;
}

/**
 * Copy a note's metadata (`child-palette`, the Submap defaults table) onto
 * the palette. Returns true if anything changed.
 */
function applyNoteMeta(pal: TerrainPalette, content: string): boolean {
  let changed = false;
  const child = readChildPalette(content);
  if (pal.childPalette !== child) {
    if (child) pal.childPalette = child;
    else delete pal.childPalette;
    changed = true;
  }
  const defaults = readSubmapDefaults(content);
  if (submapDefaultsKey(pal.submapDefaults) !== submapDefaultsKey(defaults)) {
    if (defaults) pal.submapDefaults = defaults;
    else delete pal.submapDefaults;
    changed = true;
  }
  return changed;
}

/** A fresh note for a palette, metadata included. */
function newNote(pal: TerrainPalette): string {
  return setSubmapDefaults(buildPaletteNote(pal.terrains, pal.childPalette), pal.submapDefaults);
}

/**
 * Keeps `settings.terrainPalettes` and the palette notes in sync.
 *
 * Notes are the source of truth once migrated; `settings.terrainPalettes`
 * stays as the in-memory working copy (every reader is synchronous) and as a
 * cache in data.json so older plugin versions still load.
 *
 *  - memory → notes: `sync()` runs after every saveSettings(). It renames
 *    notes whose palette was renamed, creates notes for new palettes,
 *    rewrites the table of changed ones, and trashes notes whose palette was
 *    deleted. Callers that edit palettes need no palette-specific code.
 *  - notes → memory: vault events on the palettes folder re-parse the note
 *    and update the palette in place (terrains array identity preserved).
 *
 * Our own writes are recognised by comparing against `lastContent`, so a
 * sync never loops back through the vault event handlers.
 */
export class PaletteStore {
  /** Note path each palette object was last bound to (rename detection). */
  private boundPath = new WeakMap<TerrainPalette, string>();
  /** Paths of every palette note we have bound, for delete detection. */
  private knownPaths = new Set<string>();
  /** Content we last wrote or read per path. */
  private lastContent = new Map<string, string>();
  private ready = false;
  private attachedFolder = "";
  private reattachTimer: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private plugin: HexmakerPlugin) {}

  folder(): string {
    const configured = normalizeFolder(this.plugin.settings.palettesFolder ?? "");
    if (configured) return configured;
    const world = normalizeFolder(this.plugin.settings.worldFolder ?? "");
    return world ? `${world}/palettes` : "palettes";
  }

  private pathFor(name: string): string {
    return `${this.folder()}/${paletteFileName(name)}.md`;
  }

  /** Where a palette's note should live: beside its current note, else top level. */
  private targetPath(name: string, prev: string | undefined): string {
    if (!prev) return this.pathFor(name);
    const dir = prev.slice(0, prev.lastIndexOf("/"));
    return `${dir}/${paletteFileName(name)}.md`;
  }

  private inFolder(path: string): boolean {
    return path.startsWith(this.folder() + "/") && path.endsWith(".md");
  }

  private isPaletteFile(f: TAbstractFile): f is TFile {
    return f instanceof TFile && f.extension === "md" && !f.basename.startsWith("_") && this.inFolder(f.path);
  }

  private paletteFiles(): TFile[] {
    const root = this.plugin.app.vault.getAbstractFileByPath(this.folder());
    if (!(root instanceof TFolder)) return [];
    const out: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (this.isPaletteFile(child)) out.push(child);
      }
    };
    walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((e) => {
      console.error("Hexmaker: palette sync failed", e);
    });
    return this.queue;
  }

  private bind(pal: TerrainPalette, path: string, content: string): void {
    this.boundPath.set(pal, path);
    this.knownPaths.add(path);
    this.lastContent.set(path, content);
  }

  private async ensureFolder(): Promise<void> {
    const folder = this.folder();
    if (this.plugin.app.vault.getAbstractFileByPath(folder)) return;
    try {
      await this.plugin.app.vault.createFolder(folder);
    } catch {
      /* created concurrently */
    }
  }

  /** Rename a palette in memory and repoint every map that uses it. */
  private renamePalette(pal: TerrainPalette, newName: string): void {
    for (const m of this.plugin.settings.maps) {
      if (m.paletteName === pal.name) m.paletteName = newName;
    }
    pal.name = newName;
  }

  /**
   * Call once the vault is indexed (onLayoutReady). Converts legacy
   * settings-only palettes to notes the first time, then loads every note.
   */
  init(): Promise<void> {
    return this.enqueue(() => this.attach());
  }

  /** Bind to the current folder: migrate if needed, then load from notes. */
  private async attach(): Promise<void> {
    this.boundPath = new WeakMap();
    this.knownPaths.clear();
    this.lastContent.clear();
    this.attachedFolder = this.folder();
    await this.ensureFolder();
    const settings = this.plugin.settings;
    let dirty = false;

    // Migration (and safety net): when the folder holds no palette notes —
    // first run after upgrading, or the folder setting was pointed somewhere
    // new — write every in-memory palette, built-in or user-made, as a note.
    const existing: TFile[] = [];
    for (const f of this.paletteFiles()) {
      if (parsePaletteNote(await this.plugin.app.vault.cachedRead(f))) existing.push(f);
    }
    if (!settings.palettesMigrated || existing.length === 0) {
      const paletteNames = new Set(existing.map((f) => f.basename.toLowerCase()));
      for (const pal of settings.terrainPalettes) {
        const safe = paletteFileName(pal.name);
        if (paletteNames.has(safe.toLowerCase())) {
          // A palette note of that name already exists (e.g. synced from a
          // device that migrated first) — the note wins on load below.
          if (safe !== pal.name) this.renamePalette(pal, safe);
          continue;
        }
        let name = safe;
        if (this.plugin.app.vault.getAbstractFileByPath(this.pathFor(name))) {
          // Some unrelated note already has this name.
          const folder = this.plugin.app.vault.getAbstractFileByPath(this.folder());
          const siblings = folder instanceof TFolder
            ? folder.children.map((c) => c.name.replace(/.md$/, ""))
            : [];
          name = uniquePaletteName(safe, siblings);
        }
        if (name !== pal.name) this.renamePalette(pal, name);
        const content = newNote(pal);
        const path = this.pathFor(pal.name);
        this.bind(pal, path, content);
        await this.plugin.app.vault.create(path, content);
        paletteNames.add(name.toLowerCase());
      }
      if (!settings.palettesMigrated) {
        settings.palettesMigrated = true;
        new Notice(`Hexmaker: terrain palettes are now notes in "${this.folder()}".`);
      }
      dirty = true;
    }

    if (await this.loadAll()) dirty = true;
    // One-time: give existing palettes terrain types (from same-named
    // preset terrains, else inferred from the name). Later blanks are the
    // user's choice and stay blank.
    let seeded = false;
    if (!settings.terrainTypesSeeded) {
      seeded = seedTerrainTypes(settings.terrainPalettes) > 0;
      settings.terrainTypesSeeded = true;
      dirty = true;
    }
    this.ready = true;
    if (dirty) await this.persist();
    if (seeded) void this.sync();
  }

  /**
   * Replace the in-memory palette list with the notes on disk, reusing the
   * existing palette objects (matched by name) so open views and modals keep
   * valid references. Returns true when anything changed.
   */
  private async loadAll(): Promise<boolean> {
    const settings = this.plugin.settings;
    const byName = new Map(settings.terrainPalettes.map((p) => [p.name.toLowerCase(), p]));
    const next: TerrainPalette[] = [];
    let changed = false;
    for (const file of this.paletteFiles()) {
      const content = await this.plugin.app.vault.cachedRead(file);
      const terrains = parsePaletteNote(content);
      if (!terrains) continue;
      let pal = byName.get(file.basename.toLowerCase());
      if (pal && next.includes(pal)) pal = undefined; // same basename in two subfolders
      if (pal) {
        if (pal.name !== file.basename) {
          this.renamePalette(pal, file.basename);
          changed = true;
        }
        if (!terrainsEqual(pal.terrains, terrains)) {
          pal.terrains.splice(0, pal.terrains.length, ...terrains);
          changed = true;
        }
      } else {
        pal = { name: file.basename, terrains };
        changed = true;
      }
      if (applyNoteMeta(pal, content)) changed = true;
      this.bind(pal, file.path, content);
      next.push(pal);
    }
    if (next.length === 0) return changed; // never empty the list; the cache stays usable
    // Keep the existing palette order (the first palette is the fallback for
    // maps and the default for new ones); notes new to us go after, by path.
    const rank = new Map(settings.terrainPalettes.map((p, i) => [p, i]));
    next.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
    if (next.length !== settings.terrainPalettes.length || next.some((p, i) => p !== settings.terrainPalettes[i])) {
      changed = true;
    }
    settings.terrainPalettes = next;
    return changed;
  }

  /** Reload after data.json was replaced from outside (Obsidian Sync). */
  reload(): Promise<void> {
    if (!this.ready) return this.queue;
    return this.enqueue(async () => {
      if (await this.loadAll()) await this.persist();
    });
  }

  private async persist(): Promise<void> {
    await this.plugin.saveData(this.plugin.settings);
    this.plugin.refreshHexMap();
    this.plugin.refreshPaletteEditors();
  }

  /** memory → notes. Safe to call often; only touches notes that differ. */
  sync(): Promise<void> {
    if (!this.ready) return this.queue;
    return this.enqueue(async () => {
      if (this.folder() !== this.attachedFolder) {
        // Folder setting changed: start over against the new folder once the
        // user stops typing (settings save per keystroke — attaching at once
        // would seed "w", "wo", "wor"… with palette notes). Notes in the old
        // folder are left alone.
        window.clearTimeout(this.reattachTimer);
        this.reattachTimer = window.setTimeout(() => {
          void this.enqueue(async () => {
            if (this.folder() !== this.attachedFolder) await this.attach();
          });
        }, 1500);
        return;
      }
      const { vault, fileManager } = this.plugin.app;
      await this.ensureFolder();
      const claimed = new Set<string>();
      let renamedInMemory = false;

      for (const pal of this.plugin.settings.terrainPalettes) {
        // Two palettes can't share a file — the later one gets a suffix.
        const prev = this.boundPath.get(pal);
        let target = this.targetPath(pal.name, prev);
        if (claimed.has(target.toLowerCase())) {
          this.renamePalette(pal, uniquePaletteName(pal.name, this.plugin.settings.terrainPalettes.map((p) => p.name)));
          target = this.targetPath(pal.name, prev);
          renamedInMemory = true;
        }
        claimed.add(target.toLowerCase());

        let file = vault.getAbstractFileByPath(target);
        if (prev && prev !== target && !file) {
          const prevFile = vault.getAbstractFileByPath(prev);
          if (prevFile instanceof TFile) {
            this.knownPaths.delete(prev);
            this.lastContent.delete(prev);
            this.boundPath.set(pal, target);
            this.knownPaths.add(target);
            await fileManager.renameFile(prevFile, target);
            file = vault.getAbstractFileByPath(target);
          }
        }

        if (file instanceof TFile) {
          const current = await vault.read(file);
          const parsed = parsePaletteNote(current);
          const next = setSubmapDefaults(
            setChildPalette(
              parsed && terrainsEqual(parsed, pal.terrains)
                ? current
                : updatePaletteNote(current, pal.terrains),
              pal.childPalette,
            ),
            pal.submapDefaults,
          );
          if (next !== current) {
            this.lastContent.set(target, next);
            await vault.modify(file, next);
          }
          this.bind(pal, target, next);
        } else {
          const content = newNote(pal);
          this.bind(pal, target, content);
          await vault.create(target, content);
        }
      }

      // Palettes deleted in memory → trash their notes (only notes we own).
      for (const path of [...this.knownPaths]) {
        if (claimed.has(path.toLowerCase())) continue;
        this.knownPaths.delete(path);
        this.lastContent.delete(path);
        const file = vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await fileManager.trashFile(file);
      }

      if (renamedInMemory) await this.persist();
    });
  }

  /** The note backing a palette, if it has been written. */
  noteFor(name: string): TFile | undefined {
    const pal = this.plugin.getPaletteByName(name);
    const path = (pal && this.boundPath.get(pal)) ?? this.pathFor(name);
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : undefined;
  }

  // ── notes → memory (vault events) ──────────────────────────────────────────

  private paletteBoundTo(path: string): TerrainPalette | undefined {
    return this.plugin.settings.terrainPalettes.find((p) => this.boundPath.get(p) === path);
  }

  onModify(file: TAbstractFile): void {
    if (!this.ready || !this.isPaletteFile(file)) return;
    void this.enqueue(async () => {
      const content = await this.plugin.app.vault.read(file);
      if (this.lastContent.get(file.path) === content) return; // our own write
      const terrains = parsePaletteNote(content);
      if (!terrains) return; // mid-edit / table removed: keep the last good copy
      this.lastContent.set(file.path, content);
      let pal = this.paletteBoundTo(file.path)
        ?? this.plugin.settings.terrainPalettes.find((p) => p.name.toLowerCase() === file.basename.toLowerCase());
      let changed = false;
      if (pal) {
        if (!terrainsEqual(pal.terrains, terrains)) {
          pal.terrains.splice(0, pal.terrains.length, ...terrains);
          changed = true;
        }
      } else {
        pal = { name: file.basename, terrains };
        this.plugin.settings.terrainPalettes.push(pal);
        changed = true;
      }
      if (applyNoteMeta(pal, content)) changed = true;
      this.bind(pal, file.path, content);
      if (changed) await this.persist();
    });
  }

  onDelete(file: TAbstractFile): void {
    if (!this.ready || !(file instanceof TFile) || !this.knownPaths.has(file.path)) return;
    void this.enqueue(async () => {
      this.knownPaths.delete(file.path);
      this.lastContent.delete(file.path);
      const pal = this.paletteBoundTo(file.path);
      const list = this.plugin.settings.terrainPalettes;
      if (!pal || list.length <= 1) return; // keep at least one palette
      // Maps keep their paletteName so they reattach if the note comes back
      // (e.g. restored from trash, or delivered late by sync).
      list.splice(list.indexOf(pal), 1);
      await this.persist();
    });
  }

  onRename(file: TAbstractFile, oldPath: string): void {
    if (!this.ready || !(file instanceof TFile)) return;
    const wasOurs = this.knownPaths.has(oldPath);
    const isPalette = this.isPaletteFile(file);
    if (!wasOurs) {
      if (isPalette) this.onModify(file); // moved into the folder
      return;
    }
    void this.enqueue(async () => {
      const pal = this.paletteBoundTo(oldPath);
      this.knownPaths.delete(oldPath);
      const content = this.lastContent.get(oldPath);
      this.lastContent.delete(oldPath);
      if (!pal) return;
      if (!isPalette) {
        // Moved out of the palettes folder: same as a delete.
        const list = this.plugin.settings.terrainPalettes;
        if (list.length > 1) list.splice(list.indexOf(pal), 1);
        await this.persist();
        return;
      }
      if (content !== undefined) this.bind(pal, file.path, content);
      else this.boundPath.set(pal, file.path);
      this.knownPaths.add(file.path);
      if (pal.name !== file.basename) {
        this.renamePalette(pal, file.basename);
        await this.persist();
      }
    });
  }
}

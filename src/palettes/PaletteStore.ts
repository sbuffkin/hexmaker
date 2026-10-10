import { MarkdownView, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathType, TerrainPalette } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildPaletteNote,
  paletteFileName,
  parsePaletteNote,
  readChildPalette,
  readSubmapDefaults,
  refreshPaletteDerived,
  setChildPalette,
  setSubmapDefaults,
  submapDefaultsKey,
  terrainsEqual,
  updatePaletteNote,
  wrapPaletteColors,
} from "./paletteNote";
import { PALETTE_PRESETS, cloneSubmapDefaults, getPreset, uniquePaletteName } from "./presets";
import { clonePathTypes, parsePathTypes, pathTypesKey, setPathTypes, wrapPathTypeColors } from "./pathTypeTable";
import { writeJsonBackup } from "../backup";
import { fillLegacyPathTypes } from "./pathTypeLegacy";
import { DEFAULT_PATH_TYPES } from "../constants";
import { inferTerrainType, refinedSpaceType } from "../terrainTypes";
import { repointPaletteName } from "./paletteOptions";

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
 * One-time upgrade of data that used to be worked out from names at run
 * time, so from now on only what the palette note says counts:
 *  - space terrains typed before the space roles had their own types get
 *    them (a "moon" typed world becomes a moon; see refinedSpaceType);
 *  - an installed palette named like a built-in preset gets that preset's
 *    child palette and Submap defaults rows it doesn't have yet (they used
 *    to be borrowed from the preset by name on every lookup).
 * Returns how many palettes changed.
 */
export function upgradePaletteData(palettes: TerrainPalette[]): number {
  let n = 0;
  for (const pal of palettes) {
    let changed = false;
    for (const t of pal.terrains) {
      const refined = refinedSpaceType(t);
      if (refined) { t.type = refined; changed = true; }
    }
    const preset = getPreset(pal.name);
    if (preset?.childPalette && !pal.childPalette) {
      pal.childPalette = preset.childPalette;
      changed = true;
    }
    if (preset?.submapDefaults) {
      const missing = Object.keys(preset.submapDefaults).filter((k) => !pal.submapDefaults?.[k]);
      if (missing.length) {
        const rows = cloneSubmapDefaults(preset.submapDefaults);
        pal.submapDefaults = { ...(pal.submapDefaults ?? {}) };
        for (const k of missing) pal.submapDefaults[k] = rows[k];
        changed = true;
      }
    }
    if (changed) n++;
  }
  return n;
}

/**
 * Copy a note's metadata (`child-palette`, the Submap defaults table) onto
 * the palette. Returns true if anything changed.
 */
function applyNoteMeta(pal: TerrainPalette, content: string, legacy = false): boolean {
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
  // Path types: a note without the table keeps the ones we have (a slip
  // that breaks the table header mustn't wipe them; sync writes it back).
  const paths = parsePathTypes(content, { legacy });
  if (paths && pathTypesKey(pal.pathTypes) !== pathTypesKey(paths.types)) {
    if (pal.pathTypes) pal.pathTypes.splice(0, pal.pathTypes.length, ...paths.types);
    else pal.pathTypes = paths.types;
    changed = true;
  }
  return changed;
}

/**
 * The note with every derived or defaulted cell filled in: the terrain
 * table's Type and Impassable in parentheses, and the path types' behaviour
 * cells (blank ones written out). `pathTypes` is what the palette holds
 * (read with the rules that applied when it was loaded); without it the
 * note's own table is used. Unchanged when nothing is missing; a path-types
 * table with unreadable rows is left alone.
 */
export function refreshNoteDerived(content: string, pathTypes?: PathType[]): string {
  const next = wrapPathTypeColors(refreshPaletteDerived(content));
  const paths = parsePathTypes(next);
  if (!paths || paths.skipped.length || !paths.implicit) return next;
  return setPathTypes(next, pathTypes ?? paths.types);
}

/**
 * The note with every colour cell (terrain Color and Icon color, path type
 * Color) written as inline code, so Obsidian doesn't read `#14223d` as a
 * tag. Nothing else in the note changes; the same string when nothing needs to.
 */
export function wrapNoteColors(content: string): string {
  return wrapPathTypeColors(wrapPaletteColors(content));
}

/** A fresh note for a palette, metadata included. */
function newNote(pal: TerrainPalette): string {
  const note = setSubmapDefaults(buildPaletteNote(pal.terrains, pal.childPalette), pal.submapDefaults);
  return pal.pathTypes ? setPathTypes(note, pal.pathTypes) : note;
}

/**
 * Give every palette without path types a copy of the old plugin-wide list
 * (settings.pathTypes, else Road and River). Before path types moved into
 * palettes every map could draw every type, so copying them all keeps every
 * map's paths drawable. Returns how many palettes were filled.
 */
export function fillPalettePathTypes(palettes: TerrainPalette[], legacy: PathType[] | undefined): number {
  const source = legacy && legacy.length ? legacy : DEFAULT_PATH_TYPES;
  let n = 0;
  for (const pal of palettes) {
    if (pal.pathTypes) continue;
    pal.pathTypes = clonePathTypes(source);
    n++;
  }
  return n;
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
  /** Palette notes whose terrain table doesn't parse: never rewritten until
   *  fixed by hand (a sync would otherwise replace the half-edited note). */
  private broken = new Set<string>();
  /** Hand-edited notes whose derived cells wait until the user stops editing them. */
  private pendingDerived = new Set<string>();

  constructor(private plugin: HexmakerPlugin) {}

  folder(): string {
    const configured = normalizeFolder(this.plugin.settings.palettesFolder ?? "");
    if (configured) return configured;
    const world = normalizeFolder(this.plugin.settings.worldFolder ?? "");
    return world ? `${world}/palettes` : "palettes";
  }

  /** The note an installed palette lives in (where it's bound, else where it will be written). */
  notePathOf(name: string): string | undefined {
    const pal = this.plugin.settings.terrainPalettes.find((p) => p.name === name);
    if (!pal) return undefined;
    return this.boundPath.get(pal) ?? this.pathFor(name);
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

  /** Rename a palette in memory and repoint everything that names it. */
  private renamePalette(pal: TerrainPalette, newName: string): void {
    repointPaletteName(this.plugin.settings, pal.name, newName);
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
    // PA5: path types from older builds get explicit behaviour (from the old
    // name rules, once), so nothing changes look.
    if (!settings.pathTypesExplicit && fillLegacyPathTypes(settings.terrainPalettes, settings.pathTypes)) dirty = true;

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
        new Notice(`Hexmap World Creator: terrain palettes are now notes in "${this.folder()}".`);
      }
      dirty = true;
    }

    if (await this.loadAll()) dirty = true;
    // Path types moved from settings into palettes: every palette without
    // them gets the full old list, and the notes get their table below.
    const filled = fillPalettePathTypes(settings.terrainPalettes, settings.pathTypes) > 0;
    if (filled) dirty = true;
    // One-time: give existing palettes terrain types (from same-named
    // preset terrains, else inferred from the name). Later blanks are the
    // user's choice and stay blank.
    let seeded = false;
    if (!settings.terrainTypesSeeded) {
      seeded = seedTerrainTypes(settings.terrainPalettes) > 0;
      settings.terrainTypesSeeded = true;
      dirty = true;
    }
    // One-time: write into the palettes what used to be inferred from
    // names at run time (space role types, a preset's child palette and
    // Submap defaults). Runs after the seeding so freshly typed terrains
    // are upgraded too.
    let upgraded = false;
    if (!settings.paletteDataUpgraded) {
      upgraded = upgradePaletteData(settings.terrainPalettes) > 0;
      settings.paletteDataUpgraded = true;
      dirty = true;
    }
    // Colours in palette notes became inline code (Obsidian read `#14223d`
    // as a tag). Before the first pass that converts them, every palette
    // note is backed up; if that fails, the load-time pass waits for the
    // next load (a note the plugin rewrites in the meantime still converts).
    let refresh = true;
    if (!settings.paletteColorsCode) {
      refresh = await this.backupBeforeColorConversion();
      if (refresh) {
        settings.paletteColorsCode = true;
        dirty = true;
      }
    }
    this.ready = true;
    // Write seeded types into the notes now, in the same queued step. Queued
    // separately, an unload in between left notes untyped while settings
    // said seeding was done — and notes win on the next load.
    if (seeded || filled || upgraded) await this.syncNow();
    // Notes from older builds (or edited by hand since) get their derived
    // cells shown (the Impassable column, inferred types in parentheses)
    // and their colours written as inline code.
    if (refresh) for (const file of this.paletteFiles()) await this.refreshDerived(file);
    if (!settings.pathTypesExplicit) {
      settings.pathTypesExplicit = true;
      dirty = true;
    }
    if (dirty) await this.persist();
  }

  /**
   * Save the full text of every palette note (gzipped JSON in the plugin's
   * backups folder) when any of them still has colours that aren't inline
   * code. Returns false, after saying so, if the backup couldn't be saved.
   */
  private async backupBeforeColorConversion(): Promise<boolean> {
    const { vault } = this.plugin.app;
    const notes: Record<string, string> = {};
    let needed = false;
    for (const file of this.paletteFiles()) {
      const content = await vault.read(file);
      notes[file.path] = content;
      if (parsePaletteNote(content) && wrapNoteColors(content) !== content) needed = true;
    }
    if (!needed) return true;
    try {
      const dir = `${this.plugin.manifest.dir}/backups/palette-colours-${new Date().toISOString().slice(0, 10)}`;
      const json = JSON.stringify({ kind: "palette-colours", savedAt: new Date().toISOString(), notes });
      await writeJsonBackup(vault.adapter, dir, "palette-notes", json);
      return true;
    } catch (e) {
      console.error("Hexmaker: couldn't back up palette notes; their colours weren't converted", e);
      new Notice("Hexmaker: couldn't save a backup of the palette notes, so their colours weren't converted yet. It will try again next time.", 10000);
      return false;
    }
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
      if (applyNoteMeta(pal, content, !settings.pathTypesExplicit)) changed = true;
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
      const loaded = await this.loadAll();
      if (fillPalettePathTypes(this.plugin.settings.terrainPalettes, this.plugin.settings.pathTypes) || loaded) await this.persist();
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
    return this.enqueue(() => this.syncNow());
  }

  /** The body of sync(); call only from inside the queue. */
  private async syncNow(): Promise<void> {
    {
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
          if (!parsed) {
            // The user's table doesn't parse (mid-edit or a slip): leave the
            // note alone and say so once; it's picked up again when fixed.
            this.markBroken(target);
            this.bind(pal, target, current);
            continue;
          }
          // A note the user is typing in keeps its text (derived cells and
          // colour cells are brought up to date once they leave it).
          const editing = this.isBeingEdited(target);
          const base = parsed && terrainsEqual(parsed, pal.terrains)
            ? editing ? current : refreshPaletteDerived(current)
            : updatePaletteNote(current, pal.terrains);
          const withMeta = setSubmapDefaults(
            setChildPalette(editing ? base : wrapPathTypeColors(base), pal.childPalette),
            pal.submapDefaults,
          );
          const next = pal.pathTypes ? setPathTypes(withMeta, pal.pathTypes) : withMeta;
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
    }
  }

  /** Whether the user is typing in this note right now (active editor, not reading view). */
  private isBeingEdited(path: string): boolean {
    const view = this.plugin.app.workspace?.getActiveViewOfType?.(MarkdownView);
    return !!view && view.file?.path === path && view.getMode() === "source";
  }

  /**
   * Bring a palette note's derived cells up to date (call inside the queue).
   * Only a note that reads cleanly is touched; our write is recorded so the
   * modify event it fires is recognised as ours.
   */
  private async refreshDerived(file: TFile): Promise<void> {
    if (!this.knownPaths.has(file.path)) return;
    const { vault } = this.plugin.app;
    const current = await vault.read(file);
    if (!parsePaletteNote(current)) return;
    const next = refreshNoteDerived(current, this.paletteBoundTo(file.path)?.pathTypes);
    if (next === current) return;
    this.lastContent.set(file.path, next);
    await vault.modify(file, next);
  }

  /**
   * Refresh derived cells of hand-edited notes the user has stopped editing
   * (called when the active leaf changes). Rewriting a note mid-typing would
   * fight the cursor, so onModify leaves those for here.
   */
  flushPendingDerived(): void {
    if (!this.ready || !this.pendingDerived.size) return;
    for (const path of [...this.pendingDerived]) {
      if (this.isBeingEdited(path)) continue;
      this.pendingDerived.delete(path);
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) void this.enqueue(() => this.refreshDerived(file));
    }
  }

  private markBroken(path: string): void {
    if (this.broken.has(path)) return;
    this.broken.add(path);
    new Notice(
      `Hexmaker: can't read the terrain table in ${path}. It needs a header row with Terrain and Color columns, then a --- row. ` +
        "The note won't be changed until it reads again; the palette keeps its last working terrains.",
      0,
    );
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
      if (!terrains) {
        // Mid-edit or a slip: keep the last good copy, and don't write over it.
        this.markBroken(file.path);
        return;
      }
      if (this.broken.delete(file.path)) new Notice(`Hexmaker: palette "${file.basename}" reads fine again.`);
      const skipped = parsePathTypes(content)?.skipped ?? [];
      if (skipped.length) {
        new Notice(`Hexmaker: ${skipped.length} path type row${skipped.length === 1 ? "" : "s"} in "${file.basename}" ${skipped.length === 1 ? "has" : "have"} no name (or repeat${skipped.length === 1 ? "s" : ""} one), so ${skipped.length === 1 ? "it was" : "they were"} skipped: ${skipped.join("  ")}`, 10000);
      }
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
      if (fillPalettePathTypes([pal], this.plugin.settings.pathTypes)) changed = true;
      this.bind(pal, file.path, content);
      if (changed) await this.persist();
      // The hand edit may have changed what the derived cells should say
      // (a new type, a terrain added without a type): refresh them now, or
      // once the user leaves the note if they're still typing in it.
      if (refreshNoteDerived(content, pal.pathTypes) !== content) {
        if (this.isBeingEdited(file.path)) this.pendingDerived.add(file.path);
        else await this.refreshDerived(file);
      }
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

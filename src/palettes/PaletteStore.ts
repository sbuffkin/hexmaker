import { MarkdownView, TAbstractFile, TFile, TFolder } from "obsidian";
import { noticeBackground, noticeUpgrade } from "../ui/notify";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathType, TerrainPalette } from "../types";
import { normalizeFolder } from "../utils";
import {
  buildPaletteNote,
  colorIssuesText,
  paletteColorIssues,
  paletteFileName,
  parsePaletteNote,
  readChildPalette,
  readPaletteKind,
  readSubmapDefaults,
  refreshPaletteDerived,
  setChildPalette,
  setPaletteKind,
  setSubmapDefaults,
  submapDefaultsKey,
  terrainsEqual,
  updatePaletteNote,
  wrapPaletteColors,
} from "./paletteNote";
import { PALETTE_PRESETS, uniquePaletteName } from "./presets";
import { parsePathTypes, pathTableHasColumn, pathTypesKey, setPathTypes, wrapPathTypeColors } from "./pathTypeTable";
import { writeJsonBackup } from "../backup";
import { fillLegacyPathTypes, info as pathTypesExplicitInfo } from "../migrations/v1.5-path-types-explicit";
import { reportUpgrade } from "../migrations/upgradeReport";
import { seedTerrainTypes, info as terrainTypesInfo } from "../migrations/v1.5-palette-terrain-types";
import { writePaletteNotes, type PaletteMigrationHost } from "../migrations/v1.5-palettes-to-notes";
import { backupBeforeColorConversion } from "../migrations/v1.5-palette-colors-as-code";
import { upgradePaletteData, info as paletteDataInfo } from "../migrations/v1.5-palette-data";
import { fillPalettePathTypes, info as palettePathTypesInfo } from "../migrations/v1.5-palette-path-types";
import { ADDED_PRESET_TERRAINS, DEFAULT_PATH_TYPES } from "../constants";
import { registry } from "../modules";
import { applyPresetPathFields, applyPresetTerrains, planPresetPathFields, planPresetTerrains } from "./presetUpdates";
import { repointPaletteName } from "./paletteOptions";
import { TerrainRenameOffers } from "./renameOffer";

/** Local storage key (per device): what was last said about each palette note's colours. */
const COLOR_REPORTED_KEY = "hexmaker-palette-colors-reported";

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
  const kind = readPaletteKind(content);
  if (pal.kind !== kind) {
    if (kind) pal.kind = kind;
    else delete pal.kind;
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
function newNote(pal: TerrainPalette, childNote?: string): string {
  const note = setSubmapDefaults(buildPaletteNote(pal.terrains, pal.childPalette, pal.kind, childNote), pal.submapDefaults);
  return pal.pathTypes ? setPathTypes(note, pal.pathTypes) : note;
}

/** A palette's own copy (never alias a shared constant). */
export function clonePalette(p: TerrainPalette): TerrainPalette {
  return { name: p.name, terrains: p.terrains.map((t) => ({ ...t })), ...(p.kind ? { kind: p.kind } : {}) };
}

/**
 * The palette list as loaded from data.json: missing or not a list (a fresh
 * install, a broken file) → the defaults; any list, empty too, is kept as
 * the user left it (SM-DEL: deleted palettes stay deleted). The defaults
 * themselves (settings filled from DEFAULT_SETTINGS on a fresh install) are
 * copied, so editing a palette never changes the shipped constant.
 */
export function palettesOnLoad(saved: unknown, defaults: readonly TerrainPalette[]): TerrainPalette[] {
  return Array.isArray(saved) && saved !== defaults ? (saved as TerrainPalette[]) : defaults.map(clonePalette);
}

/** The default palettes not in `list` (by name, any case), in their own order. */
export function missingDefaults(list: readonly { name: string }[], defaults: readonly TerrainPalette[]): TerrainPalette[] {
  const have = new Set(list.map((p) => p.name.toLowerCase()));
  return defaults.filter((p) => !have.has(p.name.toLowerCase()));
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
  /** Palettes dropped at startup as deleted, by lower-cased name and note path: a note that turns up later (sync) brings its palette back. */
  private stash = new Map<string, { pal: TerrainPalette; index: number }>();
  private reattachTimer: number | undefined;
  private queue: Promise<void> = Promise.resolve();
  /** Palette notes whose terrain table doesn't parse: never rewritten until
   *  fixed by hand (a sync would otherwise replace the half-edited note). */
  private broken = new Set<string>();
  /** Hand-edited notes whose derived cells wait until the user stops editing them. */
  private pendingDerived = new Set<string>();
  /** Hand-edited notes whose colour problems and terrain renames wait until the user stops editing them. */
  private pendingReview = new Map<string, string>();
  /** What was last said about each note's colours (said again only when it changes). */
  private colorReported = new Map<string, string>();
  private colorReportedLoaded = false;
  /** Terrains renamed by hand: the "Rename everywhere" offers. */
  readonly renames: TerrainRenameOffers;

  constructor(private plugin: HexmakerPlugin) {
    this.renames = new TerrainRenameOffers(plugin);
  }

  /** Names a terrain was renamed to by hand, waiting for "Rename everywhere" (no new tables yet). */
  heldTerrainNames(): Set<string> {
    return this.renames.held();
  }

  /**
   * Say which colours in a palette note can't be read (drawn grey, kept as
   * typed) and which were read a safe way (written back so). Once per change.
   */
  private reportColors(path: string, name: string, content: string): void {
    const issues = paletteColorIssues(content);
    const sig = JSON.stringify(issues);
    // Remembered per device across restarts (local storage, never data.json):
    // the same unreadable colours aren't reported again on every start.
    if (!this.colorReportedLoaded) {
      this.colorReportedLoaded = true;
      const saved: unknown = this.plugin.app.loadLocalStorage?.(COLOR_REPORTED_KEY);
      if (saved && typeof saved === "object") for (const [p, s] of Object.entries(saved as Record<string, unknown>)) if (typeof s === "string") this.colorReported.set(p, s);
    }
    if ((this.colorReported.get(path) ?? "[]") === sig) return;
    this.colorReported.set(path, sig);
    this.plugin.app.saveLocalStorage?.(COLOR_REPORTED_KEY, Object.fromEntries(this.colorReported));
    const bad = issues.filter((i) => !i.fixed);
    const fixed = issues.filter((i) => i.fixed);
    const lines: string[] = [];
    if (bad.length) {
      lines.push(`palette "${name}" has ${bad.length === 1 ? "a color" : `${bad.length} colors`} it can't read, drawn grey until fixed in the note (your text is kept): ${colorIssuesText(bad)}.`);
    }
    if (fixed.length) lines.push(`${bad.length ? "Read" : `in palette "${name}", read`} ${colorIssuesText(fixed)}.`);
    if (lines.length) noticeBackground(lines.join(" "), 15000);
  }

  /**
   * Offer the renames found while loading (a palette note renamed by hand
   * while Obsidian was closed). Call once the map notes are loaded, so the
   * hexes still using the old names can be counted.
   */
  offerPendingRenames(): Promise<void> {
    return this.enqueue(async () => {
      for (const path of this.renames.paths()) {
        const pal = this.paletteBoundTo(path);
        if (pal && !this.isBeingEdited(path)) await this.renames.offer(path, pal.name);
      }
    });
  }

  /** A hand-edited note (as the user left it): report its colours and offer its renames. */
  private async review(path: string, content: string): Promise<void> {
    const pal = this.paletteBoundTo(path);
    if (!pal) return;
    this.reportColors(path, pal.name, content);
    await this.renames.offer(path, pal.name);
  }

  /** The palette notes have been read (palettes, impassable flags and path types are final). */
  isReady(): boolean {
    return this.ready;
  }

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

  /** The note of a palette's child palette, when that palette is installed (so `child-palette:` is a link). */
  private childNoteOf(pal: TerrainPalette): string | undefined {
    return pal.childPalette ? this.notePathOf(pal.childPalette) : undefined;
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

  /** What the palette migrations (src/migrations) need from the store. */
  private migrationHost(): PaletteMigrationHost {
    return {
      app: this.plugin.app,
      manifest: this.plugin.manifest,
      settings: this.plugin.settings,
      folder: () => this.folder(),
      pathFor: (name) => this.pathFor(name),
      paletteFiles: () => this.paletteFiles(),
      renamePalette: (pal, name) => this.renamePalette(pal, name),
      writeNote: async (pal, path) => {
        const content = newNote(pal, this.childNoteOf(pal));
        this.bind(pal, path, content);
        await this.plugin.app.vault.create(path, content);
      },
    };
  }

  /**
   * Call once the vault is indexed (onLayoutReady). Converts legacy
   * settings-only palettes to notes the first time, then loads every note.
   */
  init(): Promise<void> {
    return this.enqueue(() => this.attach(true));
  }

  /**
   * Bind to the current folder: migrate if needed, then load from notes.
   * `startup`: the folder is the one the palettes were saved in, so no
   * notes there means they were deleted (they stay deleted, SM-DEL); on a
   * folder change (not startup) every palette is written into the new one.
   */
  private async attach(startup = false): Promise<void> {
    this.boundPath = new WeakMap();
    this.knownPaths.clear();
    this.lastContent.clear();
    this.attachedFolder = this.folder();
    await this.ensureFolder();
    const settings = this.plugin.settings;
    let dirty = false;
    // PA5: path types from older builds get explicit behaviour (from the old
    // name rules, once), so nothing changes look.
    const legacyFilled = !settings.pathTypesExplicit && fillLegacyPathTypes(settings.terrainPalettes, settings.pathTypes) > 0;
    if (legacyFilled) dirty = true;

    // Migration (and safety net): when the folder holds no palette notes —
    // first run after upgrading, or the folder setting was pointed somewhere
    // new — write every in-memory palette, built-in or user-made, as a note.
    const existing: TFile[] = [];
    for (const f of this.paletteFiles()) {
      if (parsePaletteNote(await this.plugin.app.vault.cachedRead(f))) existing.push(f);
    }
    // Deleted palettes stay deleted (SM-DEL), but only on a positive record:
    // a palette whose note this plugin wrote or read in this same folder,
    // and that note is gone now. Anything without a record (an upgrade from
    // data.json-only palettes, a new or moved folder) is written as before.
    const rec = settings.paletteNotes;
    if (startup && rec && rec.folder === this.folder()) {
      const gone = settings.terrainPalettes.filter((p) => {
        const path = rec.notes[p.name];
        return !!path && !this.plugin.app.vault.getAbstractFileByPath(path);
      });
      if (gone.length) {
        await this.dropDeletedPalettes(gone);
        dirty = true;
      }
    }
    if (await writePaletteNotes(this.migrationHost(), existing)) dirty = true;

    if (await this.loadAll()) dirty = true;
    // Colours in palette notes became inline code (Obsidian read `#14223d`
    // as a tag). Before the first pass that converts them, every palette
    // note is backed up. If that backup fails, NO load-time pass may
    // rewrite a note (every note write puts colours in inline code): the
    // one-time passes below still apply in memory for this session, but
    // their flags stay unset and nothing is written, so all of it runs
    // again, backup first, on the next load. (A note the plugin rewrites
    // later because the user changed something still converts.)
    let refresh = true;
    if (!settings.paletteColorsCode) {
      refresh = await backupBeforeColorConversion(this.migrationHost());
      if (refresh) {
        settings.paletteColorsCode = true;
        dirty = true;
      }
    }
    const blocked = !refresh;
    // Terrains added to a bundled palette since it was installed: once each
    // (it takes its own backup; skipped entirely while notes can't change).
    const added = blocked ? false : await this.addNewPresetTerrains();
    if (added) dirty = true;
    // Path types moved from settings into palettes: every palette without
    // them gets the full old list, and the notes get their table below.
    const filled = fillPalettePathTypes(settings.terrainPalettes, settings.pathTypes) > 0;
    if (filled && !blocked) dirty = true;
    // Fields the shipped path types gained since (River's "Carves: water"):
    // once each, where the palette never set them (own backup; skipped
    // entirely while notes can't change).
    const pathFields = blocked ? false : await this.addNewPresetPathFields();
    if (pathFields) dirty = true;
    // One-time: give existing palettes terrain types (from same-named
    // preset terrains, else inferred from the name). Later blanks are the
    // user's choice and stay blank.
    let seeded = false;
    if (!settings.terrainTypesSeeded) {
      seeded = seedTerrainTypes(settings.terrainPalettes) > 0;
      if (!blocked) {
        settings.terrainTypesSeeded = true;
        dirty = true;
      }
    }
    // One-time: write into the palettes what used to be inferred from
    // names at run time (space role types, a preset's child palette and
    // Submap defaults). Runs after the seeding so freshly typed terrains
    // are upgraded too.
    let upgraded = false;
    if (!settings.paletteDataUpgraded) {
      upgraded = upgradePaletteData(settings.terrainPalettes) > 0;
      if (!blocked) {
        settings.paletteDataUpgraded = true;
        dirty = true;
      }
    }
    this.ready = true;
    // Write seeded types into the notes now, in the same queued step. Queued
    // separately, an unload in between left notes untyped while settings
    // said seeding was done — and notes win on the next load.
    if (!blocked && (seeded || filled || upgraded || added || pathFields)) await this.syncNow();
    // Notes from older builds (or edited by hand since) get their derived
    // cells shown (the Impassable column, inferred types in parentheses)
    // and their colours written as inline code.
    if (refresh) for (const file of this.paletteFiles()) await this.refreshDerived(file);
    if (!settings.pathTypesExplicit && !blocked) {
      settings.pathTypesExplicit = true;
      dirty = true;
    }
    if (this.recordNotes()) dirty = true;
    // The silent palette steps that changed something, for the upgrade note (MG1).
    if (!blocked) {
      const steps: { done: boolean; info: { id: string; change: string } }[] = [
        { done: legacyFilled, info: pathTypesExplicitInfo },
        { done: filled, info: palettePathTypesInfo },
        { done: seeded, info: terrainTypesInfo },
        { done: upgraded, info: paletteDataInfo },
      ];
      for (const st of steps) if (st.done) reportUpgrade({ text: st.info.change, ids: [st.info.id] });
    }
    if (dirty) await this.persist();
  }

  /**
   * Bring settings.paletteNotes up to date with the notes bound now (the
   * positive record deletion detection needs). True when it changed.
   */
  private recordNotes(): boolean {
    const notes: Record<string, string> = {};
    for (const pal of this.plugin.settings.terrainPalettes) {
      const path = this.boundPath.get(pal);
      if (path && this.knownPaths.has(path)) notes[pal.name] = path;
    }
    const next = { folder: this.attachedFolder, notes };
    if (JSON.stringify(next) === JSON.stringify(this.plugin.settings.paletteNotes)) return false;
    this.plugin.settings.paletteNotes = next;
    return true;
  }

  /**
   * Palettes whose notes (recorded in settings.paletteNotes) were deleted
   * while Obsidian was closed (SM-DEL): they go too, never re-created from
   * data.json's copy. That copy is backed up first (if the backup fails,
   * nothing is dropped). A note that turns up later at the same path or
   * name (sync delivering it late) brings its palette back (onModify).
   * Maps keep their palette name, so they reattach.
   */
  private async dropDeletedPalettes(gone: TerrainPalette[]): Promise<void> {
    const settings = this.plugin.settings;
    let where = "";
    try {
      const dir = `${this.plugin.manifest.dir}/backups/palettes-${new Date().toISOString().slice(0, 10)}`;
      where = await writeJsonBackup(this.plugin.app.vault.adapter, dir, "deleted-palettes", JSON.stringify({ savedAt: new Date().toISOString(), palettes: gone }));
    } catch (e) {
      console.error("Hexmap World Creator: couldn't back up the deleted palettes; they were kept", e);
      return;
    }
    const rec = settings.paletteNotes;
    for (const pal of gone) {
      const index = settings.terrainPalettes.indexOf(pal);
      this.stash.set(pal.name.toLowerCase(), { pal, index });
      const path = rec?.notes[pal.name];
      if (path) this.stash.set(path, { pal, index });
    }
    settings.terrainPalettes = settings.terrainPalettes.filter((p) => !gone.includes(p));
    noticeBackground(
      `the palette note${gone.length === 1 ? "" : "s"} of ${gone.map((p) => p.name).join(", ")} ${gone.length === 1 ? "was" : "were"} deleted, so ${gone.length === 1 ? "that palette is" : "those palettes are"} gone too. A copy is in ${where}.` +
        (settings.terrainPalettes.length ? "" : " Add palettes, or the defaults, in Settings → Terrain palettes."),
      15000,
    );
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
          // Renamed in the note while Obsidian was closed (or synced in):
          // offered once the maps are loaded (offerPendingRenames).
          this.renames.noteEdit(file.path, pal.terrains, terrains);
          pal.terrains.splice(0, pal.terrains.length, ...terrains);
          changed = true;
        }
      } else {
        pal = { name: file.basename, terrains };
        changed = true;
      }
      if (applyNoteMeta(pal, content, !settings.pathTypesExplicit)) changed = true;
      this.bind(pal, file.path, content);
      this.reportColors(file.path, pal.name, content);
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

  /**
   * Give installed copies of bundled palettes the terrains added to them
   * since (OW8), once each, after backing up the palette notes. A terrain
   * the palette already has is left exactly as the user made it. Returns
   * true when anything changed (settings or palettes).
   */
  private async addNewPresetTerrains(): Promise<boolean> {
    const settings = this.plugin.settings;
    const done = new Set(settings.presetTerrainsAdded ?? []);
    const plan = planPresetTerrains(settings.terrainPalettes, ADDED_PRESET_TERRAINS, done, (n) => PALETTE_PRESETS.find((p) => p.name === n)?.terrains);
    if (!plan.done.length) return false;
    if (plan.add.length) {
      try {
        const notes: Record<string, string> = {};
        for (const { palette } of plan.add) {
          const path = this.boundPath.get(palette);
          if (path) notes[path] = this.lastContent.get(path) ?? "";
        }
        const dir = `${this.plugin.manifest.dir}/backups/palettes-${new Date().toISOString().slice(0, 10)}`;
        await writeJsonBackup(this.plugin.app.vault.adapter, dir, "palettes-before-new-terrains", JSON.stringify({ savedAt: new Date().toISOString(), notes }));
      } catch (e) {
        // No backup, no change: try again next start.
        console.error("Hexmap World Creator: couldn't back up palette notes; new terrains not added", e);
        return false;
      }
      applyPresetTerrains(plan);
      const what = plan.add.map(({ palette, terrains }) => `${terrains.map((t) => t.name).join(", ")} to "${palette.name}"`).join("; ");
      noticeUpgrade(`added ${what}.`);
    }
    settings.presetTerrainsAdded = [...done, ...plan.done];
    return true;
  }

  /**
   * Give palettes' copies of the shipped path types the fields added to them
   * since (River's "Carves: water"), once each, after backing up the palette
   * notes. Only where the palette note never had the field (no column for
   * it): a value the user set or cleared is left alone. Returns true when
   * anything changed (settings or palettes).
   */
  private async addNewPresetPathFields(): Promise<boolean> {
    const settings = this.plugin.settings;
    const done = new Set(settings.presetPathFieldsAdded ?? []);
    const noteOf = (pal: TerrainPalette): string | undefined => {
      const path = this.boundPath.get(pal);
      return path === undefined ? undefined : this.lastContent.get(path);
    };
    const plan = planPresetPathFields(settings.terrainPalettes, registry.addedPresetPathFields(), done, DEFAULT_PATH_TYPES, (pal, field) => {
      const content = noteOf(pal);
      return content !== undefined && !pathTableHasColumn(content, field);
    });
    if (!plan.done.length) return false;
    if (plan.set.length) {
      try {
        const notes: Record<string, string> = {};
        for (const { palette } of plan.set) {
          const path = this.boundPath.get(palette);
          if (path) notes[path] = this.lastContent.get(path) ?? "";
        }
        const dir = `${this.plugin.manifest.dir}/backups/palettes-${new Date().toISOString().slice(0, 10)}`;
        await writeJsonBackup(this.plugin.app.vault.adapter, dir, "palettes-before-path-fields", JSON.stringify({ savedAt: new Date().toISOString(), notes }));
      } catch (e) {
        // No backup, no change: try again next start.
        console.error("Hexmap World Creator: couldn't back up palette notes; path types not updated", e);
        return false;
      }
      applyPresetPathFields(plan);
      const pals = [...new Set(plan.set.map((s) => s.palette.name))].map((n) => `"${n}"`).join(", ");
      const what = [...new Set(plan.set.map((s) => `${s.pathType.name} ${s.field === "carves" ? "carves" : "carve width"}: ${s.value}`))].join("; ");
      noticeUpgrade(`path types updated in ${pals} (${what}).`);
    }
    settings.presetPathFieldsAdded = [...done, ...plan.done];
    return true;
  }

  private async persist(): Promise<void> {
    await this.plugin.saveData(this.plugin.settings);
    // A terrain added in a palette note gets its tables (HG5).
    void this.plugin.ensureTablesForNewTerrains();
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
            setPaletteKind(setChildPalette(editing ? base : wrapPathTypeColors(base), pal.childPalette, this.childNoteOf(pal)), pal.kind),
            pal.submapDefaults,
          );
          const next = pal.pathTypes ? setPathTypes(withMeta, pal.pathTypes) : withMeta;
          if (next !== current) {
            this.lastContent.set(target, next);
            await vault.modify(file, next);
          }
          this.bind(pal, target, next);
        } else {
          const content = newNote(pal, this.childNoteOf(pal));
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

      if (renamedInMemory) {
        this.recordNotes();
        await this.persist();
      }
      // Notes written or trashed: keep the record deletion detection relies on.
      else if (this.recordNotes()) await this.plugin.saveData(this.plugin.settings);
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
    if (!this.ready) return;
    // Reviewed first, while the note still reads as the user left it.
    for (const [path, content] of [...this.pendingReview]) {
      if (this.isBeingEdited(path)) continue;
      this.pendingReview.delete(path);
      void this.enqueue(() => this.review(path, content));
    }
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
    noticeBackground(
      `can't read the terrain table in ${path}. It needs a header row with Terrain and Color columns, then a --- row. ` +
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
      if (this.broken.delete(file.path)) noticeBackground(`palette "${file.basename}" reads fine again.`);
      const skipped = parsePathTypes(content)?.skipped ?? [];
      if (skipped.length) {
        noticeBackground(`${skipped.length} path type row${skipped.length === 1 ? "" : "s"} in "${file.basename}" ${skipped.length === 1 ? "has" : "have"} no name (or repeat${skipped.length === 1 ? "s" : ""} one), so ${skipped.length === 1 ? "it was" : "they were"} skipped: ${skipped.join("  ")}`, 10000);
      }
      this.lastContent.set(file.path, content);
      let pal = this.paletteBoundTo(file.path)
        ?? this.plugin.settings.terrainPalettes.find((p) => p.name.toLowerCase() === file.basename.toLowerCase());
      let changed = false;
      if (pal) {
        if (!terrainsEqual(pal.terrains, terrains)) {
          // A terrain renamed here by hand: offered "Rename everywhere" once
          // the user leaves the note (before persist, so the new name's
          // tables wait for the answer).
          this.renames.noteEdit(file.path, pal.terrains, terrains);
          pal.terrains.splice(0, pal.terrains.length, ...terrains);
          changed = true;
        }
      } else {
        // A palette dropped at startup whose note arrived late (sync): back in its old place.
        const back = this.stash.get(file.path) ?? this.stash.get(file.basename.toLowerCase());
        const list = this.plugin.settings.terrainPalettes;
        if (back) {
          for (const [k, v] of [...this.stash]) if (v.pal === back.pal) this.stash.delete(k);
          pal = back.pal;
          if (pal.name !== file.basename) pal.name = file.basename;
          pal.terrains.splice(0, pal.terrains.length, ...terrains);
          list.splice(Math.min(back.index, list.length), 0, pal);
        } else {
          pal = { name: file.basename, terrains };
          list.push(pal);
        }
        changed = true;
      }
      if (applyNoteMeta(pal, content)) changed = true;
      if (fillPalettePathTypes([pal], this.plugin.settings.pathTypes)) changed = true;
      this.bind(pal, file.path, content);
      if (this.recordNotes()) changed = true;
      if (changed) await this.persist();
      // Colours it can't read and terrains renamed: said once the user
      // leaves the note (not at every pause while typing).
      if (this.isBeingEdited(file.path)) this.pendingReview.set(file.path, content);
      else {
        this.pendingReview.delete(file.path);
        await this.review(file.path, content);
      }
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
      // Deleted palettes stay deleted, the last one too (SM-DEL).
      if (!pal) return;
      // Maps keep their paletteName so they reattach if the note comes back
      // (e.g. restored from trash, or delivered late by sync).
      list.splice(list.indexOf(pal), 1);
      this.recordNotes();
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
        list.splice(list.indexOf(pal), 1);
        await this.persist();
        return;
      }
      if (content !== undefined) this.bind(pal, file.path, content);
      else this.boundPath.set(pal, file.path);
      this.renames.moved(oldPath, file.path);
      const review = this.pendingReview.get(oldPath);
      if (review !== undefined) {
        this.pendingReview.delete(oldPath);
        this.pendingReview.set(file.path, review);
      }
      this.knownPaths.add(file.path);
      if (pal.name !== file.basename) {
        this.renamePalette(pal, file.basename);
        await this.persist();
      }
    });
  }
}

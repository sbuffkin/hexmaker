/**
 * The plugin's settings on disk (data.json): loading them (settings-phase
 * migrations first, one read), saving them without the note-held paths,
 * skipping writes that change nothing, telling our own write echoed back
 * from an outside change, and recording the start-up upgrades. Split from
 * HexmakerPlugin (plan-architecture-refactor L1b); the plugin keeps
 * one-line delegations.
 *
 * INVARIANT (incident 2026-10-10): load() must not await between swapping
 * in the new settings and mapStore.adoptAll(), or a save in between sees
 * maps without their paths. tests/integration/settingsPersistence pins it.
 */
import { TFile } from "obsidian";
import { endNoticeBatch, type NoticeLink } from "../ui/notify";
import { HexMapView } from "../hex-map/HexMapView";
import { HexTableView } from "../hex-table/HexTableView";
import { fillLegacyPathTypes } from "../migrations/v1.5-path-types-explicit";
import {
  DEFAULT_PALETTE_NAME,
  DEFAULT_PATH_TYPES,
  DEFAULT_SETTINGS,
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
} from "../constants";
import { inferKindContent, resolveKindContent } from "../kindContent";
import { palettesOnLoad } from "../palettes/PaletteStore";
import { resolveMapKinds } from "../mapKinds";
import { resolveDefaultPalette, resolveExpandedDefault } from "../palettes/paletteOptions";
import { clonePathTypes } from "../palettes/pathTypeTable";
import { normalizeFolder } from "../utils";
import type {
  HexmakerPluginSettings,
} from "../types";
import { migrateMapData, pluginVersion } from "../compat";
import { withoutNotePaths } from "../maps/MapStore";
import { recordMigrationRun, runSettingsMigrations } from "../migrations/registry";
import { dataFormatOf, newerDataText, stampToSave, writtenByNewer } from "../migrations/stamp";
import { takeUpgradeReport } from "../migrations/upgradeReport";
import { writeUpgradeNote } from "../migrations/upgradeNote";
import changelog from "../../CHANGELOG.md";
import type HexmakerPlugin from "../HexmakerPlugin";

/** What SettingsPersistence uses of the plugin. */
export type SettingsHost = HexmakerPlugin;

export class SettingsPersistence {
  /** `writeRaw` is Obsidian's own Plugin.saveData (the plugin's saveData override delegates here). */
  constructor(private readonly plugin: SettingsHost, private readonly writeRaw: (data: unknown) => Promise<void>) {}

  async loadSettings(): Promise<void> {
    // The settings-phase migrations (src/migrations) run on the raw data
    // BEFORE Object.assign, so a moved key wins over DEFAULT_SETTINGS.
    // One read only: nothing may await between swapping in the new
    // settings and handing their maps to the map store (adoptAll below), or a
    // save in between would see maps without their paths (incident
    // 2026-10-10). rawData is an untouched copy for the "fresh install?" checks.
    const loaded = (await this.plugin.loadData()) as Record<string, unknown> | null;
    const rawData = loaded ? (JSON.parse(JSON.stringify(loaded)) as Record<string, unknown>) : null;
    this.onDisk = loaded ? JSON.stringify(loaded) : null;
    // An existing vault (not a fresh install): the version that last saved it, for the upgrade note.
    this.upgradeFrom = rawData ? { version: typeof rawData["savedWith"] === "string" ? rawData["savedWith"] : undefined } : null;
    const data = loaded ?? {};
    // Written by a newer build (its data stamp is newer than this build knows): say so once loaded.
    this.newerData = writtenByNewer(data) ? newerDataText(data["savedWith"], dataFormatOf(data)) : null;
    this.settingsMigrationsRan = runSettingsMigrations(data);

    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<HexmakerPluginSettings>);
    // The data stamp (src/migrations/stamp.ts): written with the next save, never lowered.
    this.plugin.settings.dataFormat = stampToSave(this.plugin.settings.dataFormat);
    // Own copy: the default is a shared constant, and editors push into lists.
    // (Kept only as the fallback palettes are filled from; see getPathTypes.)
    this.plugin.settings.pathTypes = clonePathTypes(this.plugin.settings.pathTypes ?? DEFAULT_PATH_TYPES);

    // Deep-clone the maps array so mutations to settings.maps never alias DEFAULT_SETTINGS.maps.
    // Object.assign does a shallow copy, so on first run (data===null) settings.maps IS
    // DEFAULT_SETTINGS.maps – pushing/mutating it would corrupt the constant for the session.
    this.plugin.settings.maps = Array.isArray(this.plugin.settings.maps)
      ? this.plugin.settings.maps
      : [];

    this.plugin.settings.maps = this.plugin.settings.maps.map((r) => migrateMapData(r, DEFAULT_PALETTE_NAME));
    // Reloaded (onExternalSettingsChange): data.json doesn't hold the paths
    // of maps whose note does, so the fresh map objects take the store's at
    // once. Missing paths mean "not loaded", never "no paths".
    this.plugin.mapStore.adoptAll();
    // Ensure terrainPalettes is valid. An empty list is the user's (every
    // palette deleted, SM-DEL): it stays empty; "Add default palettes" in
    // settings puts the defaults back on request.
    this.plugin.settings.terrainPalettes = palettesOnLoad(this.plugin.settings.terrainPalettes, DEFAULT_SETTINGS.terrainPalettes);
    // PA5: path types saved before every behaviour was an explicit option get
    // them filled in from the old name rules (once), so no map changes look.
    // Notes are migrated by PaletteStore on attach.
    if (!this.plugin.settings.pathTypesExplicit) fillLegacyPathTypes(this.plugin.settings.terrainPalettes, this.plugin.settings.pathTypes);
    if (!this.plugin.settings.hexOrientation) this.plugin.settings.hexOrientation = "pointy";
    if (!this.plugin.settings.tablesFolder)
      this.plugin.settings.tablesFolder = "world/tables";
    if (!this.plugin.settings.defaultTableDice) this.plugin.settings.defaultTableDice = 100;
    if (this.plugin.settings.questsFolder === undefined)
      this.plugin.settings.questsFolder = "";
    if (this.plugin.settings.featuresFolder === undefined)
      this.plugin.settings.featuresFolder = "";
    if (this.plugin.settings.factionsFolder === undefined)
      this.plugin.settings.factionsFolder = "";
    if (this.plugin.settings.hexEditorTerrainCollapsed === undefined)
      this.plugin.settings.hexEditorTerrainCollapsed = false;
    if (this.plugin.settings.hexEditorFeaturesCollapsed === undefined)
      this.plugin.settings.hexEditorFeaturesCollapsed = false;
    if (this.plugin.settings.hexEditorNotesCollapsed === undefined)
      this.plugin.settings.hexEditorNotesCollapsed = false;
    if (!Array.isArray(this.plugin.settings.rollTableExcludedFolders))
      this.plugin.settings.rollTableExcludedFolders = ["terrain"];
    if (!Array.isArray(this.plugin.settings.encounterTableExcludedFolders))
      this.plugin.settings.encounterTableExcludedFolders = ["terrain"];
    if (!this.plugin.settings.defaultMap) {
      this.plugin.settings.defaultMap = this.plugin.settings.maps[0]?.name ?? "default";
    }
    // Own copy (never alias DEFAULT_SETTINGS). Read from the raw data: unset
    // (new install / older data) = world, plus space if a palette has space
    // terrains already.
    this.plugin.settings.mapKinds = resolveMapKinds(data["mapKinds"], this.plugin.settings.terrainPalettes);
    // Shipped content per map type (SP3): an update has its types' content
    // already; a fresh install writes none until its setup picks the types.
    // Setup over without a pick: inferred, nothing installed (saved with the next save).
    this.plugin.settings.kindContent = inferKindContent({ ...this.plugin.settings, kindContent: resolveKindContent(rawData, this.plugin.settings.mapKinds) });
    // New maps default to Expanded on fresh installs only (GEN1): decided
    // once from the raw data, and saved with it.
    this.plugin.settings.expandedByDefault = resolveExpandedDefault(rawData);
    const firstExpanded = typeof rawData?.["expandedByDefault"] !== "boolean";
    // "Palette for new maps": seeded once from the above, then the user's.
    this.plugin.settings.defaultPalette = resolveDefaultPalette(rawData);
    const firstDefaultPalette = typeof rawData?.["defaultPalette"] !== "string";
    const firstKindContent = rawData?.["kindContent"] === undefined;
    if (firstKindContent || firstExpanded || firstDefaultPalette) await this.plugin.saveData(this.plugin.settings);
  }

  /**
   * Settings go to data.json without the paths of maps whose note holds them
   * (MapStore.holdsPaths): each map's roads and rivers live only in its map
   * note, which a person can read and edit. Maps not yet in a note keep them.
   */
  async saveData(data: unknown): Promise<void> {
    const ready = !!this.plugin.mapStore?.isReady();
    const out = data !== this.plugin.settings ? data : withoutNotePaths(this.plugin.settings, (name) => ready && this.plugin.mapStore.holdsPaths(name));
    // Same as what data.json holds (last loaded or written): don't touch the
    // file. Startup saves that change nothing then leave it alone (smoke C5).
    let text: string | null = null;
    try { text = JSON.stringify(out); } catch { /* not JSON-able: write it */ }
    if (text !== null && text === this.onDisk) return;
    this.rememberWrite(out);
    await this.writeRaw(out);
    this.onDisk = text;
  }

  /** Set when data.json was written by a newer build: the notice to show (see stamp.ts). */
  newerData: string | null = null;

  /** Settings-phase migrations that changed data.json on this load (recorded once settings exist). */
  private settingsMigrationsRan: string[] = [];

  /** Set for an existing vault: the version that last saved data.json (null: a fresh install). */
  private upgradeFrom: { version: string | undefined } | null = null;

  /**
   * After the start-up upgrades (MG1): record which migrations changed the
   * vault (data.json's migrationsRun), write the "Hexmaker upgrade <date>"
   * note when an existing vault was upgraded, and show the one combined
   * notice, linking the note. A fresh install gets no note.
   */
  async finishStartupUpgrades(): Promise<void> {
    const entries = takeUpgradeReport();
    let recorded = false;
    for (const id of [...this.settingsMigrationsRan, ...entries.flatMap((e) => e.ids ?? [])]) {
      if (recordMigrationRun(this.plugin.settings, id)) recorded = true;
    }
    this.settingsMigrationsRan = [];
    let link: NoticeLink | undefined;
    const now = pluginVersion(this.plugin);
    const upgraded = !!this.upgradeFrom && entries.length > 0 && (entries.some((e) => e.ids?.length) || this.upgradeFrom.version !== now);
    if (upgraded) {
      try {
        const path = await writeUpgradeNote(this.plugin.app, normalizeFolder(this.plugin.settings.worldFolder ?? ""), {
          date: new Date(),
          from: this.upgradeFrom?.version,
          to: now,
          entries,
          backupsFolder: this.plugin.backupsFolder(),
          changelog,
          pluginName: this.plugin.manifest.name ?? "Hexmap World Creator",
        });
        const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
        link = { text: `What changed, and the backups: ${name}`, open: () => void this.openVaultNote(path) };
      } catch (e) {
        console.error("Hexmap World Creator: couldn't write the upgrade note", e);
      }
    }
    endNoticeBatch(link);
    // Only data.json: the record must not make a fresh install write notes (F19).
    if (recorded && this.upgradeFrom) await this.plugin.saveData(this.plugin.settings);
  }

  /** Open a vault note in a new tab. */
  private async openVaultNote(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf("tab").openFile(file);
  }

  /** data.json's content as last loaded or written by this session (compact JSON). */
  private onDisk: string | null = null;

  /** What we wrote to data.json lately (compact JSON), to tell our own writes from outside changes. */
  private recentWrites: string[] = [];

  private rememberWrite(data: unknown): void {
    try {
      this.recentWrites.push(JSON.stringify(data));
      if (this.recentWrites.length > 20) this.recentWrites.shift();
    } catch { /* not JSON-able: never matches */ }
  }

  /** data.json holds exactly something this session wrote (an echo of our own save). */
  isOwnWrite(disk: unknown): boolean {
    if (disk === null || disk === undefined) return false;
    const text = JSON.stringify(disk);
    return this.recentWrites.includes(text);
  }

  async saveSettings(): Promise<void> {
    this.plugin.settings.savedWith = pluginVersion(this.plugin);
    this.plugin.settings.dataFormat = stampToSave(this.plugin.settings.dataFormat);
    // The setup just finished or was turned off without picking map types
    // (e.g. "Don't show again", a recipe): record its types, install nothing.
    this.plugin.settings.kindContent = inferKindContent(this.plugin.settings);
    await this.plugin.saveData(this.plugin.settings);
    // Mirror palette edits (from any editor) into the palette notes.
    void this.plugin.paletteStore.sync();
    // A terrain added anywhere (palette editor, terrain editor, a new or
    // imported palette) gets its empty tables (HG5).
    void this.plugin.ensureTablesForNewTerrains();
    void this.plugin.mapStore.sync();
    // Settings hold map-level state (paths, palette, grid size, overlays).
    // A save made from one view/window leaves sibling map views stale —
    // flag them so they re-render on next activation (issue #32). The
    // active map view (the one making the change) is skipped inside
    // markStaleFromExternal.
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
      if (leaf.view instanceof HexMapView) leaf.view.markStaleFromExternal();
    });
  }

  // Called by Obsidian Sync when it delivers a new data.json from another device.
  // Reloads settings into memory and refreshes all open views so the user sees
  // the synced state without a manual Obsidian restart.
  async onExternalSettingsChange(): Promise<void> {
    // Obsidian also fires this for our own saves when several land close
    // together (its watcher sees a write it hasn't recorded yet). Reloading
    // our own data would at best do nothing and at worst roll back changes
    // made since that save, so ignore anything we wrote ourselves.
    const disk = (await this.plugin.loadData()) as unknown;
    if (this.isOwnWrite(disk)) {
      this.onDisk = JSON.stringify(disk);
      return;
    }
    await this.plugin.loadSettings();
    // Map notes hold paths and map settings; the new data.json doesn't win.
    // Queued before any sync, so nothing writes the bare copy over a note.
    void this.plugin.mapStore.reloadFromNotes();
    // data.json carries a cached copy of the palettes; the notes win.
    await this.plugin.paletteStore.reload();
    this.plugin.loadAvailableIcons();
    this.plugin.refreshHexMap();
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach((leaf) => {
      if (leaf.view instanceof HexTableView) void leaf.view.loadTable();
    });
  }
}

import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { closeNoticeBatch } from "./ui/notify";
import { HexMapView } from "./hex-map/HexMapView";
import { HexTableView } from "./hex-table/HexTableView";
import { RandomTableView } from "./random-tables/RandomTableView";
import { HexmakerSettingTab } from "./HexmakerSettingTab";
import { registerRollerBlock } from "./random-tables/RollerBlock";
import { registerPaletteReadingView } from "./palettes/paletteReadingView";
import { locateRollTable, withRollerBlock } from "./random-tables/randomTable";
import { processTableNote } from "./random-tables/TableStore";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
  VIEW_TYPE_SETUP_WIZARD,
  VIEW_TYPE_GENERATOR,
  VIEW_TYPE_PALETTE_EDITOR,
} from "./constants";
import { SetupWizardView } from "./SetupWizardView";
import type { BiomeStore } from "./overworld/BiomeStore";
import { planKindContent } from "./kindContent";
import { PLACEHOLDER_MAP_NAME } from "./setupPlaceholder";
import type { WorldTypeStore } from "./space/WorldTypeStore";
import { createModuleStores, moduleCommands, moduleGenerators, moduleRefLinkers, moduleNoteRewrites, runOnEnabled, runOnKindsEnabled } from "./modules/runtime";
import type { GeneratorContribution, GeneratorHelpers, ModuleStore, RefLinker } from "./modules/types";
import { PaletteStore } from "./palettes/PaletteStore";
import { PathsService } from "./paths/PathsService";
import { RoutePins } from "./paths/routePins";
import { PaletteEditorView } from "./palettes/PaletteEditorView";
import { enabledKinds, isIconHiddenByKind, newTerrains, terrainsForTables, type MapKind, type SectionWordsFn } from "./mapKinds";
import { defaultPaletteFor } from "./palettes/paletteOptions";
import { contextKindsIn, kindForIn, sectionWordsIn } from "./maps/mapKindQueries";
import { declineModuleOffer, moduleOfferFor, moduleOfferText } from "./maps/moduleOffer";
import { registry } from "./modules";
import { isDebugMode, onDebugModeChange, setDebugMode } from "./ui/debugMode";
import {
  getPreset,
  presetToPalette,
} from "./palettes/presets";
import { normalizeFolder, makeTableTemplate, sortIcons } from "./utils";
import { shippedTablesToInstall } from "./random-tables/shippedTables";
import { BUNDLED_ICONS } from "./bundledIcons";
import type {
  HexmakerPluginSettings,
  MapData,
  PathType,
  SubmapDefault,
  TerrainColor,
  TerrainPalette,
} from "./types";
import { writeJsonBackup } from "./backup";
import { getTerrainFromFile, getHexRegionFromFile, clearPendingTerrain } from "./frontmatter";
import { MapStore } from "./maps/MapStore";
import { cellEdits, UndoBook } from "./undoBook";
import type { UndoItem } from "./hex-map/undoItems";
import { workModeOf, type ModeAction, type WorkMode } from "./workMode";
import { TableNotes } from "./random-tables/TableNotes";
import { type RoleTablePick } from "./worldgen/tableSources";
import { type RoleId } from "./worldgen/tableRoles";
import { ArrivalService } from "./arrival/ArrivalService";
import { EventsService } from "./arrival/EventsService";
import { type ArrivalMode } from "./arrival/arrival";
import type { RegionSettings } from "./types";
import { type HexMapDataView } from "./hexMapData";
import { CalloutMemory } from "./maps/calloutMemory";
import { type CalloutSyncResult } from "./maps/calloutSync";
import type { NoteRewrite } from "./migrations/noteRewrites";
import { migrate as migrateFlatTerrainTables } from "./migrations/v1.0-flat-terrain-tables-to-subfolders";
import { type RegionMapDataView } from "./regionMapData";
import { ConfirmModal } from "./worldgen/ConfirmModal";
import { HexPropsSync } from "./maps/hexPropsSync";
import { registerVaultEvents } from "./plugin/vaultEvents";
import { bindPorts } from "./ports";
import { migrateHexFilesToDefaultRegion, startOnLayoutReady } from "./plugin/startup";
import { registerCommands, registerEditorMenu } from "./plugin/commands";
import { registerProtocolHandlers } from "./plugin/protocolHandlers";
import {
  addLinkToSection,
  getLinksInSection,
  removeLinkFromSection,
} from "./sections";
import { GeneratorView } from "./worldgen/GeneratorView";
import { GeneratorPanel } from "./worldgen/GeneratorPanel";
import { type NotePickPurpose } from "./templateNotes";
import { MapsService, type NewMapOptions } from "./services/MapsService";
import { PaletteQueries } from "./services/PaletteQueries";
import { TemplatesService } from "./services/TemplatesService";
import { HexNotesService } from "./services/HexNotesService";
import { SettingsPersistence } from "./plugin/settingsPersistence";
export default class HexmakerPlugin extends Plugin {
  /** data.json: load, save, own-write echoes, outside changes (src/plugin/settingsPersistence.ts). */
  readonly settingsIO = new SettingsPersistence(this, (data) => super.saveData(data));
  /** Hex notes, their Map data callouts, and region / faction notes (src/services/HexNotesService.ts). */
  readonly hexNotes = new HexNotesService(this);
  /** Note templates and which notes pickers offer (src/services/TemplatesService.ts). */
  readonly templates = new TemplatesService(this);
  /** Palette lookups and installs (src/services/PaletteQueries.ts). */
  readonly palettes = new PaletteQueries(this);
  /** The map list: create, link, rename, restore (src/services/MapsService.ts). */
  readonly maps = new MapsService(this);
  settings: HexmakerPluginSettings;
  availableIcons: string[] = [];
  vaultIconsSet: Set<string> = new Set();
  paletteStore = new PaletteStore(this);
  /** Each module's note stores (src/modules/runtime.ts), made once with the plugin. */
  readonly moduleStores: ModuleStore[] = createModuleStores(this);
  /** A module's store by id. */
  moduleStore(id: string): ModuleStore | undefined {
    return this.moduleStores.find((s) => s.id === id);
  }
  /** Every module's built-in generators; worldgen/registry asks here so it never imports modules/runtime (import cycle). */
  moduleGenerators(helpers: GeneratorHelpers): GeneratorContribution[] { return moduleGenerators(this, helpers); }
  /** Overworld biome notes (#50; the World maps module's store). Module code only: undefined without World maps. */
  get biomeStore(): BiomeStore {
    return this.moduleStore("biomes") as BiomeStore;
  }
  /** World types tables for the space generators (the Space module's store). */
  get worldTypeStore(): WorldTypeStore {
    return this.moduleStore("world-types") as WorldTypeStore;
  }
  /** Each module's "ref-links" rewriters for its own notes (note format upgrade NF3). */
  get moduleRefLinks(): RefLinker[] {
    return moduleRefLinkers(this);
  }
  /** Each module's one-time rewrites of its own notes (the notes phase, after the core's). */
  get moduleNoteRewrites(): NoteRewrite[] {
    return moduleNoteRewrites(this);
  }
  /** The tables folder's notes in memory, for rolls the generators make (src/random-tables/TableNotes.ts). */
  tableNotes!: TableNotes;
  /** Places made on arrival: roll, make, reroll, lock (src/arrival). */
  arrival = new ArrivalService(this);
  /** The Events ledgers of once-only rows in map notes (SP6). */
  events = new EventsService(this);
  /** Per-hex map data, backed by one map note per map (src/maps). */
  mapStore = new MapStore(this);
  /** What each hex note's Map data callout last showed (phase 2: tells a hand edit from a stale copy). */
  calloutMemory = new CalloutMemory(() => this.app.vault.adapter, () => this.manifest.dir ?? "");
  /** Hex notes' terrain/area/icon/name properties, both ways (MG4, src/maps/hexPropsSync.ts). */
  hexProps = new HexPropsSync(this);
  /** Terrain names that have (or were offered) tables; new ones get theirs (HG5). */
  private tableTerrainNames: Set<string> | null = null;
  /** Table creation runs one batch at a time; awaiting any call waits for those before it. */
  private terrainTablesQueue: Promise<void> = Promise.resolve();
  /**
   * Every map's paths resolved to hex chains (one resolver, a route cache
   * per map). Readers use `paths.resolvedPathChains(map)`; nothing is
   * resolved until the map's terrain and palette are loaded.
   */
  paths = new PathsService({
    // The map's terrain is loaded (MapStore) and the palettes (PaletteStore).
    isMapReady: (map) => this.mapStore.isReady(map) && this.paletteStore.isReady(),
    getMap: (name) => this.getMap(name),
    orientation: () => this.settings.hexOrientation,
    stagger: (map) => map.staggerOffset ?? this.settings.staggerOffset ?? "odd",
    pathTypes: (map) => this.getMapPathTypes(map),
    palette: (map) => this.getMapPalette(map),
    hexData: (map) => this.mapStore.all(map),
    // Keep routes where they were when their inputs change (phase 7).
    routesChanging: (map) => this.pathPins.sync(map),
  });
  /** Keeps routes in place when terrain, the palette, the size or a type's routing changes (Decision 3). */
  pathPins = new RoutePins(this);
  /** Undo/redo, one queue per map per work mode, for as long as the vault is open (WM6). */
  undoBook = new UndoBook<UndoItem>();

  /** The palette and map stores have started (see startupWritesWait). */
  storesStarted: Promise<void> = Promise.resolve();
  /** A fresh install's stores are waiting for the setup wizard (F19). */
  startupWritesHeld = false;
  /** Let the stores start writing now (the world folder is confirmed, or setup was put off). */
  releaseStartupWrites: () => void = () => {};

  async onload() {
    await this.loadSettings();
    this.tableNotes = TableNotes.register(this);
    this.pathPins.attach();
    // Terrains known now (data.json's copy of the palettes). Any a palette
    // note adds while Obsidian was closed get their tables once the notes
    // are read (HG5).
    this.tableTerrainNames = new Set(this.tableTerrains().map((t) => t.name));
    // The module-level ports (icon pickers, number boxes, palette previews,
    // hex data, the work-mode gates): src/ports.ts, same order as ever.
    bindPorts(this);
    // One handler per vault / workspace event, in the order they always ran (src/plugin/vaultEvents.ts).
    registerVaultEvents(this);
    // The rest of start-up waits for the layout (src/plugin/startup.ts).
    this.app.workspace.onLayoutReady(() => startOnLayoutReady(this, this.settingsIO.newerData, () => this.finishStartupUpgrades()));

    await migrateHexFilesToDefaultRegion(this);

    this.registerView(VIEW_TYPE_SETUP_WIZARD, (leaf) => new SetupWizardView(leaf, this));
    this.registerView(VIEW_TYPE_HEX_MAP, (leaf) => new HexMapView(leaf, this));
    this.registerView(VIEW_TYPE_PALETTE_EDITOR, (leaf) => new PaletteEditorView(leaf, this));
    this.registerView(VIEW_TYPE_GENERATOR, (leaf) => new GeneratorView(leaf, this));
    this.registerView(
      VIEW_TYPE_HEX_TABLE,
      (leaf) => new HexTableView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_RANDOM_TABLES,
      (leaf) => new RandomTableView(leaf, this),
    );
    // Ribbon icon, commands and the file menu (src/plugin/commands.ts).
    registerCommands(this);
    this.addSettingTab(new HexmakerSettingTab(this.app, this));
    // Debug mode (per device, src/ui/debugMode.ts): "Debug" in the status
    // bar while it's on; clicking it turns it off. Pages with a Debug
    // subsection re-render when it changes.
    this.syncDebugStatus(isDebugMode(this.app));
    this.register(onDebugModeChange((on) => {
      this.syncDebugStatus(on);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)) {
        if (leaf.view instanceof GeneratorView) leaf.view.refresh();
      }
    }));

    // Register the embedded roller code block processor
    registerRollerBlock(this);
    // Palette notes in reading view: colour swatches, icon thumbnails and
    // path-style previews beside the table text.
    registerPaletteReadingView(this);

    // Right-click "Insert table roller" / "Insert map link" in any editor.
    registerEditorMenu(this);

    // obsidian:// actions: tables, workflows, map and hex links (src/plugin/protocolHandlers.ts).
    registerProtocolHandlers(this);
  }

  onunload() {
    closeNoticeBatch();
    this.pathPins.detach();
    void this.calloutMemory.save();
    this.hexProps.stop();
    void this.hexProps.memory.save();
    clearPendingTerrain();
  }

  openHexMap(): void {
    void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_MAP });
  }

  /**
   * Open the terrain generator page (or bring it forward), optionally with a
   * region and generator selected, or a biome (#50): a blend-field biome
   * opens as "Biome (blend field)", a generator-backed one opens its
   * generator (the page says which biomes use it).
   */
  async openTerrainGenerator(select: { mapName?: string; generatorPath?: string; paletteName?: string; biome?: string } = {}): Promise<void> {
    if (select.mapName) GeneratorPanel.mapName = select.mapName;
    if (select.paletteName) GeneratorPanel.paletteName = select.paletteName;
    if (select.generatorPath) {
      GeneratorPanel.selectedPath = select.generatorPath;
      GeneratorPanel.biome = "";
    }
    if (select.biome) {
      const b = (this.moduleStore("biomes") as BiomeStore | undefined)?.get(select.biome);
      const file = b?.generator ? this.app.vault.getAbstractFileByPath(`${b.generator}.md`) ?? this.app.vault.getAbstractFileByPath(b.generator) ?? this.app.metadataCache.getFirstLinkpathDest(b.generator, "") : null;
      if (b && file) {
        GeneratorPanel.selectedPath = file.path;
        GeneratorPanel.biome = "";
      } else if (b && !b.generator) GeneratorPanel.biome = b.id;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      (existing.view as GeneratorView).refresh();
      return;
    }
    await this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_GENERATOR, active: true });
  }

  /**
   * DJ-Q4: the shipped biome notes are written when the first overworld or
   * region is made (New overworld, a map given region settings, a region
   * created), not on start-up. Each is written once and never over a note,
   * so a deleted one stays deleted; later calls only top up new shipped ones.
   */
  async ensureOverworldBiomes(): Promise<void> {
    await (this.moduleStore("biomes") as BiomeStore | undefined)?.seedShipped(true);
  }

  /**
   * Sandbox-only helpers for dev/demo-world.mjs (OW7): set only when the
   * vault root holds the `.hexmaker-sandbox` marker. No command, no UI.
   */
  devTools?: Record<string, (...args: never[]) => unknown>;

  showMap(name: string): Promise<void> { return this.maps.showMap(name); }

  setMapWorkMode(mapName: string, mode: WorkMode): void { return this.maps.setMapWorkMode(mapName, mode); }

  openSetupWizard(): void {
    void this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_SETUP_WIZARD });
  }

  loadSettings(): Promise<void> { return this.settingsIO.loadSettings(); }

  async saveData(data: unknown): Promise<void> { return this.settingsIO.saveData(data); }

  private finishStartupUpgrades(): Promise<void> { return this.settingsIO.finishStartupUpgrades(); }

  /** The plugin's backups folder (vault-relative, under the config folder). */
  backupsFolder(): string {
    return `${this.manifest.dir ?? ""}/backups`;
  }


  saveSettings(): Promise<void> { return this.settingsIO.saveSettings(); }

  onExternalSettingsChange(): Promise<void> { return this.settingsIO.onExternalSettingsChange(); }

  /**
   * Filter a list of table files using a two-tier system:
   *  1. Per-file frontmatter (`filterKey: false` excludes, `filterKey: true` forces include)
   *  2. Folder-level exclusion list (paths relative to tablesFolder)
   */
  filterTableFiles(
    files: TFile[],
    filterKey: "roll-filter" | "encounter-filter",
    excludedFolders: string[],
  ): TFile[] {
    const folder = normalizeFolder(this.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";
    return files.filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm != null) {
        const val: unknown = fm[filterKey];
        if (val === false) return false;
        if (val === true) return true;
      }
      const rel = prefix ? f.path.slice(prefix.length) : f.path;
      return !excludedFolders.some((exc) => rel.startsWith(exc + "/"));
    });
  }

  /** Open (or focus) the palette editor page, optionally on one palette. */
  async openPaletteEditor(paletteName?: string): Promise<void> {
    if (paletteName) PaletteEditorView.paletteName = paletteName;
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PALETTE_EDITOR)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      if (paletteName && existing.view instanceof PaletteEditorView) existing.view.show(paletteName);
      return;
    }
    await this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_PALETTE_EDITOR, active: true });
  }

  /** Palettes changed from outside an editor page (note edit, map tool). */
  refreshPaletteEditors(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PALETTE_EDITOR)) {
      if (leaf.view instanceof PaletteEditorView) leaf.view.refreshFromStore();
    }
  }

  /** The status-bar "Debug" item, while debug mode is on. */
  private debugStatusEl: HTMLElement | null = null;

  private syncDebugStatus(on: boolean): void {
    if (on && !this.debugStatusEl) {
      const el = this.addStatusBarItem();
      el.addClass("mod-clickable", "duckmage-debug-status");
      el.setText("Debug");
      el.setAttr("aria-label", "Hexmaker debug mode is on. Click to turn it off.");
      el.setAttr("data-tooltip-position", "top");
      el.addEventListener("click", () => setDebugMode(this.app, false));
      this.debugStatusEl = el;
    } else if (!on && this.debugStatusEl) {
      this.debugStatusEl.remove();
      this.debugStatusEl = null;
    }
  }

  /**
   * Map types turned on/off (settings, setup wizard): reload the icon
   * pickers and re-render open pages that list palettes or generators so
   * the change shows at once. Modals read the setting when they open.
   */
  onMapKindsChanged(): void {
    this.loadAvailableIcons();
    this.refreshPaletteEditors();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)) {
      if (leaf.view instanceof GeneratorView) leaf.view.refresh();
    }
  }

  /** Redraw every open map view's New place bar (Reroll / Lock) only, never the grid: safe mid-stroke. */
  refreshPlaceBars(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
      if (leaf.view instanceof HexMapView) leaf.view.refreshPlaceBar();
    });
  }

  refreshHexMap(): void {
    // A tab restored at startup but not shown yet holds a deferred stand-in,
    // not a HexMapView, until it's opened (and it renders then anyway).
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
      if (leaf.view instanceof HexMapView) leaf.view.renderGrid();
    });
  }

  loadAvailableIcons() {
    this.vaultIconsSet = new Set();
    // Icon packs of disabled map types stay out of the pickers (palettes that
    // already use them still render — getIconUrl reads BUNDLED_ICONS).
    const pluginIcons: string[] = Array.from(BUNDLED_ICONS.keys())
      .filter((i) => !isIconHiddenByKind(this.settings, i));
    const vaultIcons: string[] = [];

    const iconsFolder = normalizeFolder(this.settings.iconsFolder ?? "");
    if (iconsFolder) {
      const folder = this.app.vault.getAbstractFileByPath(iconsFolder);
      if (folder instanceof TFolder) {
        for (const child of folder.children) {
          if (
            child instanceof TFile &&
            /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(child.name)
          ) {
            this.vaultIconsSet.add(child.name);
            vaultIcons.push(child.name);
          }
        }
      }
    }

    // Combine, deduplicate, then apply saved order (ordered first, remainder sorted)
    const all = [...new Set([...pluginIcons, ...vaultIcons])];
    const order = this.settings.iconOrder ?? [];
    const ordered = order.filter((i) => all.includes(i));
    const rest = sortIcons(all.filter((i) => !order.includes(i)));
    this.availableIcons = [...ordered, ...rest];
  }

  autoRegisterMapsFromVault(): Promise<void> { return this.maps.autoRegisterMapsFromVault(); }

  isLinkableNote(file: TFile, purpose: NotePickPurpose = "link"): boolean { return this.templates.isLinkableNote(file, purpose); }

  /**
   * Check whether a TFile is a workflow note (lives under the configured
   * workflows folder). Used to gate the workflow export command.
   */
  isWorkflowFile(file: TFile): boolean {
    const folder = normalizeFolder(this.settings.workflowsFolder ?? "");
    if (!folder) return false;
    return file.path.startsWith(folder + "/") && !file.basename.startsWith("_");
  }

  isHexFile(file: TFile): boolean { return this.hexNotes.isHexFile(file); }

  hexPath(x: number, y: number, mapName: string): string { return this.hexNotes.hexPath(x, y, mapName); }

  updateSubmapReferences(oldName: string, newName: string): Promise<void> { return this.maps.updateSubmapReferences(oldName, newName); }

  /** Build an embedded roller code block (path-less — reads the current file). */
  buildRollerLink(): string {
    return "```duckmage-roller\n```";
  }

  /**
   * Give a table note the roller block, replacing an old
   * obsidian://duckmage-roll link. Never touches "_" notes or notes with no
   * roll table. Returns true when the note changed.
   */
  async ensureRollerLink(filePath: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.basename.startsWith("_")) return false;
    let changed = false;
    await processTableNote(this.app, file, (content) => {
      if (!locateRollTable(content)?.recognized) return content;
      const next = withRollerBlock(content);
      changed = next !== content;
      return next;
    });
    return changed;
  }

  /**
   * Write the shipped table notes of the modules of `kinds` (default: the
   * map types that are on) that the tables folder doesn't have yet
   * (plan-tables-everywhere phase 6). A note that's there, edited or not,
   * is never touched; nothing is written when every one is there.
   * Returns the paths written.
   */
  async installShippedTables(kinds: readonly string[] = [...enabledKinds(this.settings)]): Promise<string[]> {
    const plan = shippedTablesToInstall(registry.shippedTables(kinds), normalizeFolder(this.settings.tablesFolder), (p) => !!this.app.vault.getAbstractFileByPath(p));
    const written: string[] = [];
    for (const t of plan) {
      const parts = t.path.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if (!this.app.vault.getAbstractFileByPath(dir)) {
          try { await this.app.vault.createFolder(dir); } catch { /* made meanwhile */ }
        }
      }
      try {
        await this.app.vault.create(t.path, t.text);
        this.tableNotes.put(t.path, t.text);
        written.push(t.path);
      } catch {
        /* made meanwhile */
      }
    }
    return written;
  }

  /** Add roller blocks to the table notes in the tables folder that lack one. */
  async ensureAllRollerLinks(): Promise<void> {
    const folder = normalizeFolder(this.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !prefix || f.path.startsWith(prefix));

    let count = 0;
    for (const file of files) {
      if (await this.ensureRollerLink(file.path)) count++;
    }
    // Nothing to report when every table already had its link (the setup
    // wizard runs this right after creating tables that include one).
    if (count > 0)
      new Notice(
        `Added roller links to ${count} table${count !== 1 ? "s" : ""}.`,
      );
  }

  /**
   * Create missing description/encounters table files for every terrain
   * (`terrains`, default: those of the enabled map types — a Space-only
   * vault gets none for the fantasy palettes; see terrainsForTables).
   */
  async ensureTerrainTables(
    terrains: TerrainColor[] = terrainsForTables(this.settings.terrainPalettes, enabledKinds(this.settings)),
    kinds: Iterable<string> = enabledKinds(this.settings),
  ): Promise<void> {
    const folder = normalizeFolder(this.settings.tablesFolder);

    // Generic section tables (landmark, hidden, secret) at the root of the tables folder
    for (const sectionType of ["landmark", "hidden", "secret"] as const) {
      const path = folder ? `${folder}/${sectionType}.md` : `${sectionType}.md`;
      if (!this.app.vault.getAbstractFileByPath(path)) {
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          try {
            await this.app.vault.createFolder(folder);
          } catch {
            /* may already exist */
          }
        }
        try {
          await this.app.vault.create(
            path,
            makeTableTemplate(
              this.settings.defaultTableDice,
              {
                "table-type": sectionType,
                "roll-filter": false,
                "encounter-filter": false,
              },
              this.buildRollerLink(),
            ),
          );
        } catch {
          /* ignore */
        }
      }
    }

    // The modules' shipped tables: the starter weather and rumours tables
    // (E2, rolled from the hex editor when the map and hex don't name their
    // own) and the space generators' optional role tables. Data, never
    // written over a note that's there.
    await this.installShippedTables([...kinds]);

    // Terrain-specific tables
    const subfolder = folder ? `${folder}/terrain` : "terrain";
    if (!this.app.vault.getAbstractFileByPath(subfolder)) {
      try {
        await this.app.vault.createFolder(subfolder);
      } catch {
        /* may already exist */
      }
    }

    // Ensure type subfolders exist
    for (const tableType of ["description", "encounters"] as const) {
      const typeSubfolder = `${subfolder}/${tableType}`;
      if (!this.app.vault.getAbstractFileByPath(typeSubfolder)) {
        try {
          await this.app.vault.createFolder(typeSubfolder);
        } catch {
          /* may already exist */
        }
      }
    }

    // Old flat-named tables ({name} - {type}.md) move into the type folders.
    await migrateFlatTerrainTables(this.app, subfolder, this.getAllTerrains().map((t) => t.name));

    // Create any still-missing table files
    await this.createTerrainTableFiles(terrains);
  }

  /**
   * Terrains whose description / encounter tables the vault keeps: those of
   * the enabled map types' palettes (terrainsForTables), plus every palette
   * a map uses.
   */
  tableTerrains(): TerrainColor[] {
    const inUse = this.settings.maps.map((m) => m.paletteName).filter((n): n is string => !!n);
    return terrainsForTables(this.settings.terrainPalettes, enabledKinds(this.settings), inUse);
  }

  /**
   * Give terrains created since the last check their tables (HG5): a new
   * terrain in any palette in use, from any editor, an imported palette or
   * a palette note edited by hand. The tables start empty (the usual
   * template, no rows). Only when the vault keeps tables (the tables folder
   * exists). Awaiting it waits for the files.
   */
  ensureTablesForNewTerrains(): Promise<void> {
    // A name a terrain was just renamed to by hand waits for the answer to
    // "Rename everywhere" (its old tables may move to it), and names typed
    // on the way there ("w", "wo"…) never get tables.
    const held = this.paletteStore?.heldTerrainNames() ?? new Set<string>();
    const terrains = this.tableTerrains().filter((t) => !held.has(t.name));
    const known = this.tableTerrainNames;
    this.tableTerrainNames = new Set(terrains.map((t) => t.name));
    const added = known ? newTerrains(known, terrains) : [];
    if (added.length) {
      this.terrainTablesQueue = this.terrainTablesQueue.then(async () => {
        const folder = normalizeFolder(this.settings.tablesFolder);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) return;
        await this.createTerrainTableFiles(added);
      }).catch((e) => console.error("Hexmaker: terrain tables", e));
    }
    return this.terrainTablesQueue;
  }

  /** Create each terrain's missing description / encounter table (empty). */
  private async createTerrainTableFiles(terrains: readonly TerrainColor[]): Promise<void> {
    if (!terrains.length) return;
    const folder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = folder ? `${folder}/terrain` : "terrain";
    for (const dir of [subfolder, `${subfolder}/description`, `${subfolder}/encounters`]) {
      if (this.app.vault.getAbstractFileByPath(dir)) continue;
      try {
        await this.app.vault.createFolder(dir);
      } catch {
        /* may already exist */
      }
    }
    for (const entry of terrains) {
      for (const tableType of ["description", "encounters"] as const) {
        const path = this.terrainTablePath(entry.name, tableType);
        if (this.app.vault.getAbstractFileByPath(path)) continue;
        try {
          await this.app.vault.create(
            path,
            makeTableTemplate(
              this.settings.defaultTableDice,
              // No `terrain:` key (T2): the table's path
              // ({tables}/terrain/{type}/{terrain}.md) links it to its terrain.
              {
                "table-type": tableType,
                "roll-filter": false,
                "encounter-filter": false,
              },
              this.buildRollerLink(),
            ),
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * For every hex note that has a terrain set, link its terrain's encounters table into
   * the hex's "Encounters Table" section (if not already linked).
   */
  async backfillTerrainLinks(): Promise<void> {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    const tablesFolder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

    const hexFiles = this.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    let linked = 0;
    for (const file of hexFiles) {
      const terrain = getTerrainFromFile(this.app, file.path);
      if (!terrain) continue;
      const tablePath = `${subfolder}/encounters/${terrain}.md`;
      const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
      if (!(tableFile instanceof TFile)) continue;

      const target = this.app.metadataCache.fileToLinktext(
        tableFile,
        file.path,
      );
      const linkText = `[[${target}]]`;
      const existing = await getLinksInSection(
        this.app,
        file.path,
        "Encounters Table",
      );
      if (existing.includes(target)) continue;

      await addLinkToSection(this.app, file.path, "Encounters Table", linkText);
      linked++;
    }
    new Notice(
      `Linked encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
    );
  }

  /**
   * Replace the terrain encounters-table link in a single hex's "Encounters Table" section.
   * Removes any existing link that resolves to a file in the terrain subfolder, then adds
   * the correct link for the new terrain (if non-null and the table file exists).
   */
  /** Whether `{tablesFolder}/terrain/encounters/{terrain}.md` exists. */
  hasTerrainEncounterTable(terrain: string): boolean {
    return this.terrainEncounterTable(terrain) !== null;
  }

  /** The terrain's encounters table file, if it has one. */
  terrainEncounterTable(terrain: string): TFile | null {
    const tablesFolder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";
    const file = this.app.vault.getAbstractFileByPath(`${subfolder}/encounters/${terrain}.md`);
    return file instanceof TFile ? file : null;
  }

  /**
   * Link text (relative to `sourcePath`) of the encounters table for the
   * hex's own terrain in the map note, or null. createHexNote links exactly
   * this, and views show it for hexes that have no note yet
   * (see displayedEncounterLinks).
   */
  terrainEncounterLinkFor(mapName: string, x: number, y: number, sourcePath: string): string | null {
    const terrain = this.mapStore.get(mapName, `${x}_${y}`)?.terrain;
    const table = terrain ? this.terrainEncounterTable(terrain) : null;
    return table ? this.app.metadataCache.fileToLinktext(table, sourcePath) : null;
  }

  /** The encounters table of the area hex (x, y) is in (`{tables}/regions/<area>.md`), if it has one. */
  areaEncounterTableFor(mapName: string, x: number, y: number): TFile | null {
    const area = this.mapStore.get(mapName, `${x}_${y}`)?.region;
    if (!area) return null;
    const folder = normalizeFolder(this.settings.tablesFolder);
    const file = this.app.vault.getAbstractFileByPath(`${folder ? `${folder}/` : ""}regions/${area}.md`);
    return file instanceof TFile ? file : null;
  }

  async syncHexEncounterTableLink(
    hexFilePath: string,
    terrain: string | null,
  ): Promise<void> {
    // The link lives in the hex note's body; a hex without a note gets it
    // when its note is created (createHexNote adds it).
    if (!(this.app.vault.getAbstractFileByPath(hexFilePath) instanceof TFile)) return;
    const tablesFolder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

    // Remove any links that point to a terrain encounters table
    const existing = await getLinksInSection(
      this.app,
      hexFilePath,
      "Encounters Table",
    );
    for (const linkTarget of existing) {
      const resolved = this.app.metadataCache.getFirstLinkpathDest(
        linkTarget,
        hexFilePath,
      );
      if (resolved && resolved.path.startsWith(subfolder + "/encounters/")) {
        await removeLinkFromSection(
          this.app,
          hexFilePath,
          "Encounters Table",
          linkTarget,
        );
      }
    }

    if (!terrain) return;

    const tablePath = `${subfolder}/encounters/${terrain}.md`;
    const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
    if (!(tableFile instanceof TFile)) return;
    const linkText = `[[${this.app.metadataCache.fileToLinktext(tableFile, hexFilePath)}]]`;
    await addLinkToSection(this.app, hexFilePath, "Encounters Table", linkText);
  }

  /**
   * For every hex note on the map, replace its terrain encounters-table link with the
   * one matching its current terrain.  Intended as a one-shot repair tool.
   */
  async refreshAllTerrainEncounterLinks(): Promise<void> {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    const hexFiles = this.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    for (const file of hexFiles) {
      const terrain = getTerrainFromFile(this.app, file.path) ?? null;
      await this.syncHexEncounterTableLink(file.path, terrain);
    }
    new Notice(
      `Refreshed encounter links for ${hexFiles.length} hex${hexFiles.length !== 1 ? "es" : ""}.`,
    );
  }

  // ── Region encounter tables ────────────────────────────────────────────────

  /** Create a region encounters table file if it does not already exist. */
  async ensureRegionTable(regionName: string): Promise<void> {
    const folder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = folder ? `${folder}/regions` : "regions";

    if (!this.app.vault.getAbstractFileByPath(subfolder)) {
      try {
        await this.app.vault.createFolder(subfolder);
      } catch {
        /* may already exist */
      }
    }

    const path = `${subfolder}/${regionName}.md`;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      try {
        await this.app.vault.create(
          path,
          makeTableTemplate(
            this.settings.defaultTableDice,
            {
              region: regionName,
              "table-type": "encounters",
              "roll-filter": false,
              "encounter-filter": false,
            },
            this.buildRollerLink(),
          ),
        );
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Add the region's encounters table link to a hex's "Encounters Table" section,
   * or remove it when regionName is null (hex removed from region).
   * Any existing link pointing into the regions subfolder is replaced.
   */
  async syncHexRegionTableLink(
    hexFilePath: string,
    regionName: string | null,
  ): Promise<void> {
    const tablesFolder = normalizeFolder(this.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/regions` : "regions";

    // Remove any existing region table link
    const existing = await getLinksInSection(
      this.app,
      hexFilePath,
      "Encounters Table",
    );
    for (const linkTarget of existing) {
      const resolved = this.app.metadataCache.getFirstLinkpathDest(
        linkTarget,
        hexFilePath,
      );
      if (resolved && resolved.path.startsWith(subfolder + "/")) {
        await removeLinkFromSection(
          this.app,
          hexFilePath,
          "Encounters Table",
          linkTarget,
        );
      }
    }

    if (!regionName) return;

    const tablePath = `${subfolder}/${regionName}.md`;
    const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
    if (!(tableFile instanceof TFile)) return;

    const linkText = `[[${this.app.metadataCache.fileToLinktext(tableFile, hexFilePath)}]]`;
    await addLinkToSection(this.app, hexFilePath, "Encounters Table", linkText);
  }

  /**
   * For every region note in the regions folder, ensure its encounters table exists.
   * For every hex note that has a `region` frontmatter key, ensure the region table
   * link is present in its "Encounters Table" section.
   */
  async backfillRegionLinks(): Promise<void> {
    const regionsFolder = normalizeFolder(this.settings.regionsFolder);
    const hexFolder = normalizeFolder(this.settings.hexFolder);

    // Ensure tables for all region notes (even unpainted ones)
    if (regionsFolder) {
      const regionFiles = this.app.vault
        .getMarkdownFiles()
        .filter(
          (f) =>
            !f.basename.startsWith("_") &&
            f.path.startsWith(regionsFolder + "/"),
        );
      for (const f of regionFiles) {
        await this.ensureRegionTable(f.basename);
      }
    }

    // Sync hex → region table links
    const hexFiles = this.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    let linked = 0;
    for (const file of hexFiles) {
      const region = getHexRegionFromFile(this.app, file.path);
      if (!region) continue;
      await this.syncHexRegionTableLink(file.path, region);
      linked++;
    }

    new Notice(
      `Linked area encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
    );
  }

  /** Update every hex note whose terrain matches oldName to newName.
   *  Reads file content directly (not the metadata cache) so successive renames
   *  don't miss hexes whose cache entry hasn't refreshed yet.
   *  Returns a Map of filePath → newName for use as terrain overrides when re-rendering. */
  async renameTerrainInHexes(
    oldName: string,
    newName: string,
    paletteName?: string,
  ): Promise<Map<string, string>> {
    // Terrain lives in map notes: rename it there (in memory now, notes
    // follow). Hex notes no longer carry terrain. Only maps drawn with
    // `paletteName` (when given): another palette's terrain of the same
    // name is a different terrain.
    const overrides = new Map<string, string>();
    for (const m of paletteName === undefined ? this.settings.maps : this.mapsOnPalette(paletteName)) {
      for (const [key, h] of this.mapStore.all(m.name)) {
        if (h.terrain !== oldName) continue;
        this.mapStore.set(m.name, key, { terrain: newName });
        const [x, y] = key.split("_").map(Number);
        overrides.set(this.hexPath(x, y, m.name), newName);
      }
      if (m.baseTerrain === oldName) m.baseTerrain = newName;
    }
    await this.mapStore.flush();
    return overrides;
  }

  /** Re-render all open hex map views, passing terrain overrides to bypass the stale metadata cache. */
  /**
   * Rename a palette terrain everywhere: hex notes using it, its terrain
   * table files, then the entry itself (saved). Used by the terrain entry
   * editor and the palette editor page.
   */
  async renameTerrain(entry: TerrainColor, newName: string): Promise<void> {
    const oldName = entry.name;
    if (!newName || newName === oldName) return;
    // The palette the entry is in (an entry in none, e.g. a stray copy,
    // renames on every map as before).
    const palette = this.settings.terrainPalettes.find((p) => p.terrains.includes(entry))?.name;
    const overrides = await this.renameTerrainInHexes(oldName, newName, palette);
    // Another palette still has a terrain of the old name: its tables stay
    // and the renamed one gets a copy.
    const shared = this.settings.terrainPalettes.some((p) => p.terrains.some((t) => t !== entry && t.name === oldName));
    await this.renameTerrainTables(oldName, newName, shared);
    entry.name = newName;
    await this.saveSettings();
    this.refreshHexMapWithOverrides(overrides);
    this.refreshHexTableTerrainRename(oldName, newName);
  }

  /** The terrain table files of a name that exist (description, encounters). */
  terrainTableFiles(name: string): TFile[] {
    return (["description", "encounters"] as const)
      .map((type) => this.app.vault.getAbstractFileByPath(this.terrainTablePath(name, type)))
      .filter((f): f is TFile => f instanceof TFile);
  }

  /**
   * "Rename everywhere" for a terrain already renamed in its palette (by
   * hand in the palette note): the hexes and base terrains of that
   * palette's maps, and the terrain's tables, follow it. The map notes and
   * tables it changes are backed up first; nothing changes when the backup
   * can't be saved. Returns the backup path, or null when it failed.
   */
  async renameTerrainEverywhere(paletteName: string, oldName: string, newName: string): Promise<string | null> {
    const maps = this.mapsOnPalette(paletteName);
    const notes: Record<string, string> = {};
    let where: string;
    try {
      for (const m of maps) {
        const text = await this.mapStore.readNoteText(m.name);
        if (text !== null) notes[this.mapStore.notePath(m.name)] = text;
      }
      for (const f of this.terrainTableFiles(oldName)) notes[f.path] = await this.app.vault.read(f);
      const dir = `${this.manifest.dir}/backups/terrain-rename-${new Date().toISOString().slice(0, 10)}`;
      const json = JSON.stringify({ kind: "terrain-rename", palette: paletteName, from: oldName, to: newName, savedAt: new Date().toISOString(), notes });
      where = await writeJsonBackup(this.app.vault.adapter, dir, "before-rename", json);
    } catch (e) {
      console.error("Hexmap World Creator: couldn't back up before renaming a terrain; nothing was changed", e);
      new Notice(`Couldn't save a backup, so "${oldName}" wasn't renamed. Nothing was changed.`, 10000);
      return null;
    }
    const overrides = await this.renameTerrainInHexes(oldName, newName, paletteName);
    // A palette that still has a terrain of the old name keeps its tables
    // (the renamed one gets a copy); otherwise they move.
    const shared = this.settings.terrainPalettes.some((p) => p.terrains.some((t) => t.name === oldName));
    await this.renameTerrainTables(oldName, newName, shared);
    await this.saveSettings();
    this.refreshHexMapWithOverrides(overrides);
    this.refreshHexTableTerrainRename(oldName, newName);
    return where;
  }

  private terrainTablePath(name: string, type: "description" | "encounters"): string {
    const folder = normalizeFolder(this.settings.tablesFolder);
    const sub = folder ? `${folder}/terrain` : "terrain";
    return `${sub}/${type}/${name}.md`;
  }

  /**
   * A renamed terrain's tables follow it (HG5): moved when no other terrain
   * has the old name (links to them are updated), copied when one does.
   * When there are none, the new name gets empty ones (via the save).
   */
  private async renameTerrainTables(oldName: string, newName: string, keepOld = true): Promise<void> {
    // Tables still being made for the old name (a just-added terrain) first.
    await this.terrainTablesQueue;
    for (const type of ["description", "encounters"] as const) {
      const oldPath = this.terrainTablePath(oldName, type);
      const newPath = this.terrainTablePath(newName, type);
      // Don't overwrite if the new terrain already has its own tables
      if (this.app.vault.getAbstractFileByPath(newPath)) continue;
      const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (!(oldFile instanceof TFile)) continue;
      if (!keepOld) {
        try {
          await this.app.fileManager.renameFile(oldFile, newPath);
          await this.app.vault.process(oldFile, (content) =>
            content
              .replace(/^terrain:[ \t].+$/m, `terrain: ${newName}`)
              .replace(/^.*obsidian:\/\/duckmage-roll.*$\n?/m, ""),
          );
          await this.ensureRollerLink(newPath);
        } catch { /* ignore */ }
        continue;
      }
      try {
        let content = await this.app.vault.read(oldFile);
        // Update the terrain frontmatter property to the new name
        content = content.replace(/^terrain:[ \t].+$/m, `terrain: ${newName}`);
        // Strip the old roller link so ensureRollerLink can add one with the correct path
        content = content.replace(/^.*obsidian:\/\/duckmage-roll.*$\n?/m, "");
        await this.app.vault.create(newPath, content);
        await this.ensureRollerLink(newPath);
      } catch { /* ignore */ }
    }
  }

  refreshHexMapWithOverrides(
    terrainOverrides: Map<string, string | null>,
  ): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
      if (leaf.view instanceof HexMapView) leaf.view.renderGrid(terrainOverrides);
    });
  }

  /** Update terrain filter sets in all open hex table views after a rename. */
  refreshHexTableTerrainRename(oldName: string, newName: string): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach((leaf) => {
      if (leaf.view instanceof HexTableView) leaf.view.renameTerrainInFilters(oldName, newName);
    });
  }

  /**
   * Name (or rename, or with "" unname) a hex. The name lives in the map
   * note; a hex that has a note also gets it as an alias, replacing the
   * previous name's alias and keeping any the user added.
   */
  /** Record an action done on `mapName` in its current work mode (WM6). */
  pushUndo(mapName: string, item: UndoItem): void {
    this.undoBook.push(mapName, workModeOf(this.getMap(mapName)), item);
  }

  /**
   * Run a map data edit (hex editor, biome and region actions) and record
   * the hexes it changed, field by field, in `mapName`'s queue for its
   * current mode. Edits that change nothing record nothing.
   */
  async undoableEdit<T>(mapName: string, fn: () => T | Promise<T>): Promise<T> {
    const { result, cells } = await this.mapStore.record(fn);
    const edits = cellEdits(cells);
    if (edits.length) this.pushUndo(mapName, { kind: "cells", edits });
    return result;
  }

  setHexName(mapName: string, x: number, y: number, raw: string): Promise<void> { return this.hexNotes.setHexName(mapName, x, y, raw); }

  hexCoordAlias(mapName: string, x: number | string, y: number | string): string { return this.hexNotes.hexCoordAlias(mapName, x, y); }

  syncMapCoordAliases(mapName: string, oldLabel: string): Promise<void> { return this.hexNotes.syncMapCoordAliases(mapName, oldLabel); }

  createHexNote(x: number, y: number, mapName: string, preloadedTemplate?: string, terrain?: string): Promise<TFile | null> { return this.hexNotes.createHexNote(x, y, mapName, preloadedTemplate, terrain); }

  appendToHexSection(x: number, y: number, mapName: string, section: string, text: string): Promise<void> { return this.hexNotes.appendToHexSection(x, y, mapName, section, text); }

  hexMapDataView(mapName: string, x: number, y: number): HexMapDataView { return this.hexNotes.hexMapDataView(mapName, x, y); }

  refreshHexMapData(mapName: string, x: number, y: number, insert = false): Promise<boolean> { return this.hexNotes.refreshHexMapData(mapName, x, y, insert); }

  syncHexMapData(mapName: string, x: number, y: number, opts: { insert?: boolean; quiet?: boolean } = {}): Promise<CalloutSyncResult> { return this.hexNotes.syncHexMapData(mapName, x, y, opts); }

  addMapDataToHexNotes(mapName: string): Promise<number> { return this.hexNotes.addMapDataToHexNotes(mapName); }

  regionOrFactionKind(file: TFile): "region" | "faction" | null { return this.hexNotes.regionOrFactionKind(file); }

  regionAndFactionNotes(): TFile[] { return this.hexNotes.regionAndFactionNotes(); }

  regionMapDataView(file: TFile, kind: "region" | "faction"): RegionMapDataView { return this.hexNotes.regionMapDataView(file, kind); }

  refreshRegionMapData(file: TFile, insert = false): Promise<boolean> { return this.hexNotes.refreshRegionMapData(file, insert); }

  updateRegionFactionMapData(): Promise<number> { return this.hexNotes.updateRegionFactionMapData(); }

  renameRegionInMaps(oldName: string, newName: string): number { return this.hexNotes.renameRegionInMaps(oldName, newName); }

  updateTokenMapReferences(oldName: string, newName: string): Promise<number> { return this.hexNotes.updateTokenMapReferences(oldName, newName); }

  loadHexTemplate(): Promise<string> { return this.templates.loadHexTemplate(); }

  templatesFolder(): string { return this.templates.templatesFolder(); }

  ensureTemplates(): Promise<void> { return this.templates.ensureTemplates(); }

  openNoteTemplate(path: string): Promise<void> { return this.templates.openNoteTemplate(path); }

  newLinkedNoteContent(section: string, title: string, fromHex?: string): Promise<string> { return this.templates.newLinkedNoteContent(section, title, fromHex); }

  withHexLocation(content: string, hexPath: string): string { return this.templates.withHexLocation(content, hexPath); }

  ensureHexTemplate(): Promise<void> { return this.templates.ensureHexTemplate(); }

  restoreMissingMap(name: string): Promise<boolean> { return this.maps.restoreMissingMap(name); }

  removeMapEntry(name: string): Promise<void> { return this.maps.removeMapEntry(name); }

  createNewMap(opts: NewMapOptions): Promise<{ name: string } | { error: string }> { return this.maps.createNewMap(opts); }

  generateHexNotesAt(mapName: string, cells: [string, string][], onProgress?: (done: number) => void): Promise<number> { return this.hexNotes.generateHexNotesAt(mapName, cells, onProgress); }

  generateHexNotes(mapName: string, xs: number[], ys: number[], onProgress?: (done: number) => void, terrainAt?: Map<string, string>): Promise<number> { return this.hexNotes.generateHexNotes(mapName, xs, ys, onProgress, terrainAt); }

  getMap(name: string): MapData | undefined { return this.maps.getMap(name); }

  mapLabel(name: string): string { return this.maps.mapLabel(name); }

  hexLinkAlias(hexPath: string): string { return this.hexNotes.hexLinkAlias(hexPath); }

  setMapDisplayName(name: string, typed: string): Promise<void> { return this.maps.setMapDisplayName(name, typed); }

  getPaletteByName(name: string): TerrainPalette | undefined { return this.palettes.getPaletteByName(name); }

  getPaletteOrPresetTerrains(name: string): TerrainColor[] { return this.palettes.getPaletteOrPresetTerrains(name); }

  getPaletteOrPresetKind(name: string): MapKind { return this.palettes.getPaletteOrPresetKind(name); }

  /**
   * Install the shipped content of map types that are on and haven't had
   * it yet (SP3, src/kindContent.ts): their palettes, biome notes (World)
   * and world types (Space). In the first setup, untouched shipped
   * palettes of types left off, that no map uses, are dropped again, and
   * "Palette for new maps" moves off a type that's off. Run when the setup
   * wizard picks the map types (`fromSetup`) and when a type is turned on
   * in settings.
   */
  async applyKindContent(opts: { fromSetup?: boolean } = {}): Promise<void> {
    const s = this.settings;
    const placeholder = s.maps.find((m) => m.name === PLACEHOLDER_MAP_NAME);
    // The shipped placeholder map doesn't count as using its palette while it's empty.
    const placeholderUnused = !!placeholder && this.mapStore.all(PLACEHOLDER_MAP_NAME).size === 0;
    const inUse = new Set(s.maps.filter((m) => !(placeholderUnused && m === placeholder)).map((m) => m.paletteName).filter(Boolean));
    const plan = planKindContent({
      kinds: [...enabledKinds(s)],
      done: s.kindContent,
      firstSetup: !!opts.fromSetup && !s.setupComplete,
      palettes: s.terrainPalettes,
      inUse,
      defaultPalette: s.defaultPalette,
    });
    if (plan.remove.length) s.terrainPalettes = s.terrainPalettes.filter((p) => !plan.remove.includes(p.name));
    for (const name of plan.install) {
      const preset = getPreset(name);
      if (preset) s.terrainPalettes.push(presetToPalette(preset));
    }
    if (plan.defaultPalette) s.defaultPalette = plan.defaultPalette;
    if (placeholder && plan.remove.includes(placeholder.paletteName)) placeholder.paletteName = defaultPaletteFor(s);
    s.kindContent = plan.done;
    await this.saveSettings();
    if (plan.newKinds.length) {
      await runOnKindsEnabled(this, plan.newKinds);
      await runOnEnabled(this, plan.newKinds);
    }
    this.onMapKindsChanged();
  }

  getPathTypes(paletteName: string | undefined): PathType[] { return this.palettes.getPathTypes(paletteName); }

  mapPaletteName(mapName: string | undefined): string { return this.palettes.mapPaletteName(mapName); }

  getMapPathTypes(mapName: string | undefined): PathType[] { return this.palettes.getMapPathTypes(mapName); }

  mapsOnPalette(paletteName: string): MapData[] { return this.palettes.mapsOnPalette(paletteName); }

  installPalettePreset(presetName: string, asName?: string, opts: { quiet?: boolean } = {}): Promise<string | undefined> { return this.palettes.installPalettePreset(presetName, asName, opts); }

  childPaletteFor(parentMap: string): string { return this.palettes.childPaletteFor(parentMap); }

  linkSubmap(parentMap: string, x: number, y: number, childMap: string, action: ModeAction = "link-map"): Promise<void> { return this.maps.linkSubmap(parentMap, x, y, childMap, action); }

  linkRegion(parentMap: string, x: number, y: number, childMap: string): Promise<boolean> { return this.maps.linkRegion(parentMap, x, y, childMap); }

  unlinkSubmap(parentMap: string, x: number, y: number, childMap?: string): Promise<void> { return this.maps.unlinkSubmap(parentMap, x, y, childMap); }

  setHexLocations(parentMap: string, x: number, y: number, locations: string[]): void { return this.maps.setHexLocations(parentMap, x, y, locations); }

  setRegionSettings(mapName: string, next: RegionSettings): Promise<void> { return this.maps.setRegionSettings(mapName, next); }

  parentOf(mapName: string): { map: string; hex: string } | undefined { return this.maps.parentOf(mapName); }

  roleTablesFor(mapName: string): Partial<Record<RoleId, RoleTablePick>> { return this.maps.roleTablesFor(mapName); }

  rolledMapName(parentMap: string, hexKey: string, seed?: number): string | undefined { return this.maps.rolledMapName(parentMap, hexKey, seed); }

  arrivalModeFor(mapName: string): { mode: ArrivalMode; from?: string } { return this.maps.arrivalModeFor(mapName); }

  /**
   * Turn a map type (its module) on: what Settings → Map types does, from
   * elsewhere (CM6's offer). Installs its shipped content the first time.
   */
  async enableMapKind(kind: MapKind): Promise<void> {
    const kinds = enabledKinds(this.settings);
    if (kinds.has(kind)) return;
    kinds.add(kind);
    this.settings.mapKinds = registry.kindIds().filter((id) => kinds.has(id));
    await this.saveSettings();
    await this.applyKindContent();
    this.refreshHexMap();
  }

  /**
   * CM6: `mapName` was opened on purpose (maps picker, region menu) and its
   * module is off: offer to turn it on. Never called from "New …" flows.
   * The map is open either way; "Not now" holds for the session.
   */
  offerModuleFor(mapName: string): void {
    const offer = moduleOfferFor(mapName, (m) => this.kindFor(m), this.settings);
    if (!offer) return;
    const text = moduleOfferText(this.mapLabel(mapName), offer);
    new ConfirmModal(this.app, text.heading, text.message, text.confirm, () => void this.enableMapKind(offer.kind), {
      cancelText: "Not now",
      onCancel: () => declineModuleOffer(offer.kind),
      offer: true,
    }).open();
  }

  /** The map shown in the active hex map view, if one is active. */
  activeMapName(): string | undefined {
    return this.app.workspace.getActiveViewOfType(HexMapView)?.activeMapName;
  }

  /**
   * Run a module's command by id (when it's available now): a module's
   * action reached from a core surface without importing the module.
   */
  async runModuleCommand(id: string): Promise<void> {
    const hit = moduleCommands().find((c) => c.command.id === id);
    if (!hit || (hit.command.available && !hit.command.available(this))) return;
    await hit.command.run(this);
  }

  submapDefaultFor(parentMap: string, terrain: string | null | undefined): SubmapDefault | undefined { return this.palettes.submapDefaultFor(parentMap, terrain); }

  saveSubmapDefault(parentMap: string, terrain: string, set: SubmapDefault, clear: (keyof SubmapDefault)[]): Promise<void> { return this.palettes.saveSubmapDefault(parentMap, terrain, set, clear); }

  missingDefaultPalettes(): string[] { return this.palettes.missingDefaultPalettes(); }

  addDefaultPalettes(): Promise<string[]> { return this.palettes.addDefaultPalettes(); }

  ensurePaletteInstalled(name: string): Promise<void> { return this.palettes.ensurePaletteInstalled(name); }

  getMapPalette(mapName: string): TerrainColor[] { return this.palettes.getMapPalette(mapName); }

  /**
   * The map types in context on `mapName`: its palette's and every
   * ancestor map's (a planet submap of a star system is in space). A type
   * offered in context (Space) has its generators shown there even when
   * it's off.
   */
  contextKinds(mapName: string): Set<MapKind> {
    return contextKindsIn(this, mapName);
  }

  /**
   * The map's type (owner call CM3): the nearest declared type up the map
   * tree, else the nearest its terrain types say. Undefined: no type.
   */
  kindFor(mapName: string): MapKind | undefined {
    return kindForIn(this, mapName);
  }

  /**
   * Display words for link sections on `mapName` (G4b): its map type's
   * (space maps say Settlements, Sites…), from the palettes of the map and
   * its parents. Headings in notes don't change. No map = the usual words.
   */
  sectionWordsFor(mapName: string | undefined): SectionWordsFn {
    return sectionWordsIn(this, mapName);
  }

  getAllTerrains(): TerrainColor[] { return this.palettes.getAllTerrains(); }

  getOrCreateMap(name: string): MapData { return this.maps.getOrCreateMap(name); }
}

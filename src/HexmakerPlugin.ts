import { Plugin, TFile, TFolder } from "obsidian";
import { closeNoticeBatch } from "./ui/notify";
import { HexMapView } from "./hex-map/HexMapView";
import { HexTableView } from "./hex-table/HexTableView";
import { RandomTableView } from "./random-tables/RandomTableView";
import { HexmakerSettingTab } from "./HexmakerSettingTab";
import { registerRollerBlock } from "./random-tables/RollerBlock";
import { registerPaletteReadingView } from "./palettes/paletteReadingView";
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
import { enabledKinds, isIconHiddenByKind, terrainsForTables, type MapKind, type SectionWordsFn } from "./mapKinds";
import { defaultPaletteFor } from "./palettes/paletteOptions";
import { contextKindsIn, kindForIn, sectionWordsIn } from "./maps/mapKindQueries";
import { declineModuleOffer, moduleOfferFor, moduleOfferText } from "./maps/moduleOffer";
import { registry } from "./modules";
import { isDebugMode, onDebugModeChange, setDebugMode } from "./ui/debugMode";
import {
  getPreset,
  presetToPalette,
} from "./palettes/presets";
import { normalizeFolder, sortIcons } from "./utils";
import { BUNDLED_ICONS } from "./bundledIcons";
import type {
  HexmakerPluginSettings,
  MapData,
  PathType,
  SubmapDefault,
  TerrainColor,
  TerrainPalette,
} from "./types";
import { clearPendingTerrain } from "./frontmatter";
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
import { type RegionMapDataView } from "./regionMapData";
import { ConfirmModal } from "./worldgen/ConfirmModal";
import { HexPropsSync } from "./maps/hexPropsSync";
import { registerVaultEvents } from "./plugin/vaultEvents";
import { bindPorts } from "./ports";
import { migrateHexFilesToDefaultRegion, startOnLayoutReady } from "./plugin/startup";
import { registerCommands, registerEditorMenu } from "./plugin/commands";
import { registerProtocolHandlers } from "./plugin/protocolHandlers";
import { GeneratorView } from "./worldgen/GeneratorView";
import { GeneratorPanel } from "./worldgen/GeneratorPanel";
import { type NotePickPurpose } from "./templateNotes";
import { MapsService, type NewMapOptions } from "./services/MapsService";
import { PaletteQueries } from "./services/PaletteQueries";
import { TemplatesService } from "./services/TemplatesService";
import { HexNotesService } from "./services/HexNotesService";
import { SettingsPersistence } from "./plugin/settingsPersistence";
import { TerrainTablesService } from "./services/TerrainTablesService";
export default class HexmakerPlugin extends Plugin {
  /** The map list: create, link, rename, restore (src/services/MapsService.ts). */
  readonly maps = new MapsService(this);
  /** Palette lookups and installs (src/services/PaletteQueries.ts). */
  readonly palettes = new PaletteQueries(this);
  /** Hex notes, their Map data callouts, and region / faction notes (src/services/HexNotesService.ts). */
  readonly hexNotes = new HexNotesService(this);
  /** Note templates and which notes pickers offer (src/services/TemplatesService.ts). */
  readonly templates = new TemplatesService(this);
  /** Terrain and area tables, roller blocks, terrain renames (src/services/TerrainTablesService.ts). */
  readonly terrainTables = new TerrainTablesService(this);
  /** data.json: load, save, own-write echoes, outside changes (src/plugin/settingsPersistence.ts). */
  readonly settingsIO = new SettingsPersistence(this, (data) => super.saveData(data));
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
    this.terrainTables.tableTerrainNames = new Set(this.tableTerrains().map((t) => t.name));
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

  openSetupWizard(): void {
    void this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_SETUP_WIZARD });
  }

  /** The plugin's backups folder (vault-relative, under the config folder). */
  backupsFolder(): string {
    return `${this.manifest.dir ?? ""}/backups`;
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

  /**
   * Check whether a TFile is a workflow note (lives under the configured
   * workflows folder). Used to gate the workflow export command.
   */
  isWorkflowFile(file: TFile): boolean {
    const folder = normalizeFolder(this.settings.workflowsFolder ?? "");
    if (!folder) return false;
    return file.path.startsWith(folder + "/") && !file.basename.startsWith("_");
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

  // One-line delegations: the code lives in the services; callers, tests and
  // module code keep calling the plugin.

  // ── Settings on disk (src/plugin/settingsPersistence.ts) ──
  loadSettings(): Promise<void> { return this.settingsIO.loadSettings(); }
  async saveData(data: unknown): Promise<void> { return this.settingsIO.saveData(data); }
  private finishStartupUpgrades(): Promise<void> { return this.settingsIO.finishStartupUpgrades(); }
  saveSettings(): Promise<void> { return this.settingsIO.saveSettings(); }
  onExternalSettingsChange(): Promise<void> { return this.settingsIO.onExternalSettingsChange(); }

  // ── Maps (src/services/MapsService.ts) ──
  showMap(name: string): Promise<void> { return this.maps.showMap(name); }
  setMapWorkMode(mapName: string, mode: WorkMode): void { return this.maps.setMapWorkMode(mapName, mode); }
  autoRegisterMapsFromVault(): Promise<void> { return this.maps.autoRegisterMapsFromVault(); }
  updateSubmapReferences(oldName: string, newName: string): Promise<void> { return this.maps.updateSubmapReferences(oldName, newName); }
  restoreMissingMap(name: string): Promise<boolean> { return this.maps.restoreMissingMap(name); }
  removeMapEntry(name: string): Promise<void> { return this.maps.removeMapEntry(name); }
  createNewMap(opts: NewMapOptions): Promise<{ name: string } | { error: string }> { return this.maps.createNewMap(opts); }
  getMap(name: string): MapData | undefined { return this.maps.getMap(name); }
  mapLabel(name: string): string { return this.maps.mapLabel(name); }
  setMapDisplayName(name: string, typed: string): Promise<void> { return this.maps.setMapDisplayName(name, typed); }
  linkSubmap(parentMap: string, x: number, y: number, childMap: string, action: ModeAction = "link-map"): Promise<void> { return this.maps.linkSubmap(parentMap, x, y, childMap, action); }
  linkRegion(parentMap: string, x: number, y: number, childMap: string): Promise<boolean> { return this.maps.linkRegion(parentMap, x, y, childMap); }
  unlinkSubmap(parentMap: string, x: number, y: number, childMap?: string): Promise<void> { return this.maps.unlinkSubmap(parentMap, x, y, childMap); }
  setHexLocations(parentMap: string, x: number, y: number, locations: string[]): void { return this.maps.setHexLocations(parentMap, x, y, locations); }
  setRegionSettings(mapName: string, next: RegionSettings): Promise<void> { return this.maps.setRegionSettings(mapName, next); }
  parentOf(mapName: string): { map: string; hex: string } | undefined { return this.maps.parentOf(mapName); }
  roleTablesFor(mapName: string): Partial<Record<RoleId, RoleTablePick>> { return this.maps.roleTablesFor(mapName); }
  rolledMapName(parentMap: string, hexKey: string, seed?: number): string | undefined { return this.maps.rolledMapName(parentMap, hexKey, seed); }
  arrivalModeFor(mapName: string): { mode: ArrivalMode; from?: string } { return this.maps.arrivalModeFor(mapName); }
  getOrCreateMap(name: string): MapData { return this.maps.getOrCreateMap(name); }

  // ── Palettes (src/services/PaletteQueries.ts) ──
  getPaletteByName(name: string): TerrainPalette | undefined { return this.palettes.getPaletteByName(name); }
  getPaletteOrPresetTerrains(name: string): TerrainColor[] { return this.palettes.getPaletteOrPresetTerrains(name); }
  getPaletteOrPresetKind(name: string): MapKind { return this.palettes.getPaletteOrPresetKind(name); }
  getPathTypes(paletteName: string | undefined): PathType[] { return this.palettes.getPathTypes(paletteName); }
  mapPaletteName(mapName: string | undefined): string { return this.palettes.mapPaletteName(mapName); }
  getMapPathTypes(mapName: string | undefined): PathType[] { return this.palettes.getMapPathTypes(mapName); }
  mapsOnPalette(paletteName: string): MapData[] { return this.palettes.mapsOnPalette(paletteName); }
  installPalettePreset(presetName: string, asName?: string, opts: { quiet?: boolean } = {}): Promise<string | undefined> { return this.palettes.installPalettePreset(presetName, asName, opts); }
  childPaletteFor(parentMap: string): string { return this.palettes.childPaletteFor(parentMap); }
  submapDefaultFor(parentMap: string, terrain: string | null | undefined): SubmapDefault | undefined { return this.palettes.submapDefaultFor(parentMap, terrain); }
  saveSubmapDefault(parentMap: string, terrain: string, set: SubmapDefault, clear: (keyof SubmapDefault)[]): Promise<void> { return this.palettes.saveSubmapDefault(parentMap, terrain, set, clear); }
  missingDefaultPalettes(): string[] { return this.palettes.missingDefaultPalettes(); }
  addDefaultPalettes(): Promise<string[]> { return this.palettes.addDefaultPalettes(); }
  ensurePaletteInstalled(name: string): Promise<void> { return this.palettes.ensurePaletteInstalled(name); }
  getMapPalette(mapName: string): TerrainColor[] { return this.palettes.getMapPalette(mapName); }
  getAllTerrains(): TerrainColor[] { return this.palettes.getAllTerrains(); }

  // ── Hex, region and faction notes (src/services/HexNotesService.ts) ──
  isHexFile(file: TFile): boolean { return this.hexNotes.isHexFile(file); }
  hexPath(x: number, y: number, mapName: string): string { return this.hexNotes.hexPath(x, y, mapName); }
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
  generateHexNotesAt(mapName: string, cells: [string, string][], onProgress?: (done: number) => void): Promise<number> { return this.hexNotes.generateHexNotesAt(mapName, cells, onProgress); }
  generateHexNotes(mapName: string, xs: number[], ys: number[], onProgress?: (done: number) => void, terrainAt?: Map<string, string>): Promise<number> { return this.hexNotes.generateHexNotes(mapName, xs, ys, onProgress, terrainAt); }
  hexLinkAlias(hexPath: string): string { return this.hexNotes.hexLinkAlias(hexPath); }

  // ── Note templates (src/services/TemplatesService.ts) ──
  isLinkableNote(file: TFile, purpose: NotePickPurpose = "link"): boolean { return this.templates.isLinkableNote(file, purpose); }
  loadHexTemplate(): Promise<string> { return this.templates.loadHexTemplate(); }
  templatesFolder(): string { return this.templates.templatesFolder(); }
  ensureTemplates(): Promise<void> { return this.templates.ensureTemplates(); }
  openNoteTemplate(path: string): Promise<void> { return this.templates.openNoteTemplate(path); }
  newLinkedNoteContent(section: string, title: string, fromHex?: string): Promise<string> { return this.templates.newLinkedNoteContent(section, title, fromHex); }
  withHexLocation(content: string, hexPath: string): string { return this.templates.withHexLocation(content, hexPath); }
  ensureHexTemplate(): Promise<void> { return this.templates.ensureHexTemplate(); }

  // ── Terrain and area tables (src/services/TerrainTablesService.ts) ──
  filterTableFiles(files: TFile[], filterKey: "roll-filter" | "encounter-filter", excludedFolders: string[]): TFile[] { return this.terrainTables.filterTableFiles(files, filterKey, excludedFolders); }
  buildRollerLink(): string { return this.terrainTables.buildRollerLink(); }
  ensureRollerLink(filePath: string): Promise<boolean> { return this.terrainTables.ensureRollerLink(filePath); }
  installShippedTables(kinds: readonly string[] = [...enabledKinds(this.settings)]): Promise<string[]> { return this.terrainTables.installShippedTables(kinds); }
  ensureAllRollerLinks(): Promise<void> { return this.terrainTables.ensureAllRollerLinks(); }
  ensureTerrainTables(terrains: TerrainColor[] = terrainsForTables(this.settings.terrainPalettes, enabledKinds(this.settings)), kinds: Iterable<string> = enabledKinds(this.settings)): Promise<void> { return this.terrainTables.ensureTerrainTables(terrains, kinds); }
  tableTerrains(): TerrainColor[] { return this.terrainTables.tableTerrains(); }
  ensureTablesForNewTerrains(): Promise<void> { return this.terrainTables.ensureTablesForNewTerrains(); }
  backfillTerrainLinks(): Promise<void> { return this.terrainTables.backfillTerrainLinks(); }
  hasTerrainEncounterTable(terrain: string): boolean { return this.terrainTables.hasTerrainEncounterTable(terrain); }
  terrainEncounterTable(terrain: string): TFile | null { return this.terrainTables.terrainEncounterTable(terrain); }
  terrainEncounterLinkFor(mapName: string, x: number, y: number, sourcePath: string): string | null { return this.terrainTables.terrainEncounterLinkFor(mapName, x, y, sourcePath); }
  areaEncounterTableFor(mapName: string, x: number, y: number): TFile | null { return this.terrainTables.areaEncounterTableFor(mapName, x, y); }
  syncHexEncounterTableLink(hexFilePath: string, terrain: string | null): Promise<void> { return this.terrainTables.syncHexEncounterTableLink(hexFilePath, terrain); }
  refreshAllTerrainEncounterLinks(): Promise<void> { return this.terrainTables.refreshAllTerrainEncounterLinks(); }
  ensureRegionTable(regionName: string): Promise<void> { return this.terrainTables.ensureRegionTable(regionName); }
  syncHexRegionTableLink(hexFilePath: string, regionName: string | null): Promise<void> { return this.terrainTables.syncHexRegionTableLink(hexFilePath, regionName); }
  backfillRegionLinks(): Promise<void> { return this.terrainTables.backfillRegionLinks(); }
  renameTerrainInHexes(oldName: string, newName: string, paletteName?: string): Promise<Map<string, string>> { return this.terrainTables.renameTerrainInHexes(oldName, newName, paletteName); }
  renameTerrain(entry: TerrainColor, newName: string): Promise<void> { return this.terrainTables.renameTerrain(entry, newName); }
  terrainTableFiles(name: string): TFile[] { return this.terrainTables.terrainTableFiles(name); }
  renameTerrainEverywhere(paletteName: string, oldName: string, newName: string): Promise<string | null> { return this.terrainTables.renameTerrainEverywhere(paletteName, oldName, newName); }
}

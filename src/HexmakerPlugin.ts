import { Editor, EventRef, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  exportSingleNoteAsPdf,
  exportSingleNoteAsMarkdown,
} from "./export/exporters/singleNote";
import { HexExportModal } from "./hex-map/HexExportModal";
import { MapExportModal } from "./export/MapExportModal";
import { WorkflowExportModal } from "./random-tables/WorkflowExportModal";
import { HexMapView } from "./hex-map/HexMapView";
import { NewOverworldModal } from "./hex-map/OverworldModals";
import { SANDBOX_MARKER, buildBenchWorld, buildDemoWorld } from "./overworld/demoWorld";
import { HexTableView } from "./hex-table/HexTableView";
import { RandomTableView } from "./random-tables/RandomTableView";
import { HexmakerSettingTab } from "./HexmakerSettingTab";
import { registerRollerBlock } from "./random-tables/RollerBlock";
import { registerPaletteReadingView } from "./palettes/paletteReadingView";
import { fillLegacyPathTypes } from "./palettes/pathTypeLegacy";
import { locateRollTable, withRollerBlock } from "./random-tables/randomTable";
import { maybePromptTableRanges, openTableRangesModal, runTableCheck } from "./random-tables/tableMaintenance";
import { processTableNote, TableStore } from "./random-tables/TableStore";
import { FileLinkSuggestModal } from "./hex-map/FileLinkSuggestModal";
import { MapLinkModal } from "./hex-map/MapLinkModal";
import {
  DEFAULT_PALETTE_NAME,
  DEFAULT_PATH_TYPES,
  DEFAULT_SETTINGS,
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
  VIEW_TYPE_SETUP_WIZARD,
  VIEW_TYPE_GENERATOR,
  VIEW_TYPE_PALETTE_EDITOR,
} from "./constants";
import { SetupWizardView } from "./SetupWizardView";
import { BiomeStore } from "./overworld/BiomeStore";
import { WorldTypeStore } from "./space/WorldTypeStore";
import { WorldTypesModal } from "./space/WorldTypesModal";
import { PaletteStore } from "./palettes/PaletteStore";
import { PathsService } from "./paths/PathsService";
import { RoutePins } from "./paths/routePins";
import { setPathEditMapLookup } from "./paths/editGate";
import { PaletteEditorView } from "./palettes/PaletteEditorView";
import { enabledKinds, isIconHiddenByKind, isSpacePalette, newTerrains, resolveMapKinds, sectionKindFor, sectionWordsFor, terrainsForTables, type SectionWordsFn } from "./mapKinds";
import { enableFeature, hasFeature, resolveFeatureLevel, shouldNudge, type AdvancedFeature, type FeatureLevel } from "./featureLevel";
import { defaultPaletteFor, resolveDefaultPalette, resolveExpandedDefault, setPaletteTerrainSource } from "./palettes/paletteOptions";
import { AdvancedNudgeModal, EnableFeatureModal } from "./advancedHints";
import { mapAncestors } from "./hex-map/submapNav";
import {
  getPreset,
  presetToPalette,
  uniquePaletteName,
} from "./palettes/presets";
import { clonePathTypes } from "./palettes/pathTypeTable";
import { normalizeFolder, makeTableTemplate, slugify, defaultIconPack, sortIcons } from "./utils";
import { STARTER_RUMORS, STARTER_WEATHER, starterTablePath } from "./regionTables";
import { setIconPackDefault } from "./HexmakerModal";
import { BUNDLED_ICONS } from "./bundledIcons";
import { parseWorkflow, buildWorkflowContent } from "./random-tables/workflow";
import type {
  HexmakerPluginSettings,
  MapData,
  PathType,
  SubmapDefault,
  TerrainColor,
  TerrainPalette,
} from "./types";
import DEFAULT_HEX_TEMPLATE from "./defaultHexTemplate.md";
import { migrateMapData, pluginVersion } from "./compat";
import { getTerrainFromFile, getHexRegionFromFile, clearPendingTerrain, setHexDataSource } from "./frontmatter";
import { MapStore, withoutNotePaths } from "./maps/MapStore";
import { setModeMapLookup } from "./modeGate";
import { cellEdits, UndoBook } from "./undoBook";
import type { UndoItem } from "./hex-map/undoItems";
import { lockedHint, workModeOf } from "./workMode";
import { withMapLink } from "./maps/mapNote";
import {
  addLocationPatch,
  applyRegionSettingsEdit,
  hexChildMaps,
  regionMapAt,
  regionsLocked,
  removeMapPatch,
  renameMapPatch,
  setRegionPatch,
} from "./maps/submaps";
import type { RegionSettings } from "./types";
import { mapDataLines, mapDataSyncMessage, planCalloutImport, setMapData, shownValues, type HexMapDataView } from "./hexMapData";
import { CalloutMemory } from "./maps/calloutMemory";
import { hexBiomeAt, overworldOf } from "./overworld/regionsVault";
import { BIOMES, biomeNoteOf } from "./overworld/biomes";
import { sameName } from "./hexBodyFields";
import { hasRegionMapData, regionUse, renameRegionInStore, renamedTokenMap, setRegionMapData, type RegionMapDataView } from "./regionMapData";
import { ConfirmModal } from "./worldgen/ConfirmModal";
import { displayNameFor, mapLabel } from "./maps/mapTree";
import { cleanHexName, coordAlias, syncHexAliases } from "./maps/hexNames";
import {
  addLinkToSection,
  getLinksInSection,
  removeLinkFromSection,
  insertLinkInSection,
  appendSectionText,
} from "./sections";
import { GeneratorView } from "./worldgen/GeneratorView";
import { GeneratorPanel } from "./worldgen/GeneratorPanel";
import { isLinkableNotePath, templateNoteRules, type NotePickPurpose, type TemplateNoteRules } from "./templateNotes";
import { DEFAULT_TOWN_TEMPLATE, fillNoteTemplate, hexTemplatePathFor, LOCATION_SECTIONS, noteTemplateFor, templatesFolderFor, townTemplatePathFor, withLocationLine } from "./noteTemplates";
export default class HexmakerPlugin extends Plugin {
  settings: HexmakerPluginSettings;
  availableIcons: string[] = [];
  vaultIconsSet: Set<string> = new Set();
  paletteStore = new PaletteStore(this);
  /** Overworld biome notes (#50). */
  biomeStore = new BiomeStore(this);
  /** World types tables for the space generators (src/space). */
  worldTypeStore = new WorldTypeStore(this);
  /** Per-hex map data, backed by one map note per map (src/maps). */
  mapStore = new MapStore(this);
  /** What each hex note's Map data callout last showed (phase 2: tells a hand edit from a stale copy). */
  calloutMemory = new CalloutMemory(() => this.app.vault.adapter, () => this.manifest.dir ?? "");
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

  async onload() {
    await this.loadSettings();
    this.pathPins.attach();
    // Terrains known now (data.json's copy of the palettes). Any a palette
    // note adds while Obsidian was closed get their tables once the notes
    // are read (HG5).
    this.tableTerrainNames = new Set(this.tableTerrains().map((t) => t.name));
    // Icon pickers open on the Space tab for space-only setups.
    setIconPackDefault(() => defaultIconPack(this.settings));
    // Palette pickers preview the picked palette's terrains (E4).
    setPaletteTerrainSource((name) => this.getPaletteOrPresetTerrains(name));
    setHexDataSource(this.mapStore);
    setPathEditMapLookup((name) => this.getMap(name));
    setModeMapLookup((name) => this.getMap(name));
    // Notes written by this plugin are read from memory until indexed (see frontmatter.ts).
    this.registerEvent(this.app.metadataCache.on("changed", (file) => clearPendingTerrain(file.path)));
    // Defer until vault metadata cache is ready; calling before layout-ready
    // returns null for all vault paths so custom icons are silently dropped.
    this.app.workspace.onLayoutReady(() => {
      this.loadAvailableIcons();
      // Palettes first (maps reference them), then map notes — which may
      // migrate per-hex data out of hex notes on the first run.
      void this.biomeStore.init();
      void this.worldTypeStore.init();
      const storesReady = this.paletteStore.init().then(() => this.mapStore.init());
      void storesReady.then(() => this.ensureTablesForNewTerrains());
      // Sandbox vaults (dev/demo-world.mjs) get the demo builders; nothing else does.
      void this.app.vault.adapter.exists(SANDBOX_MARKER).then((sandbox) => {
        if (!sandbox) return;
        this.devTools = {
          buildDemoWorld: (o) => buildDemoWorld(this, o),
          buildBenchWorld: (o) => buildBenchWorld(this, o),
          overworldStats: () => this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => (l.view instanceof HexMapView ? l.view.overworldStats() : null)),
        };
      });
      void this.autoRegisterMapsFromVault();
      // Hand edits to table notes (ranges, die, weights) are imported.
      TableStore.register(this);
      if (!this.settings.setupComplete && !this.settings.setupDismissed) {
        this.openSetupWizard();
      } else if (shouldNudge(this.settings, this.settings.maps.length)) {
        // A Simple user who's been at it a while: offer Advanced, once.
        this.settings.advancedNudgeAt = new Date().toISOString().slice(0, 10);
        // Saved once the map notes are loaded: a save before that writes
        // every map's (empty) path list back into data.json, though the
        // paths live in the map notes (smoke suite C5).
        void storesReady.then(() => this.saveSettings());
        new AdvancedNudgeModal(this.app, this).open();
      } else {
        // Once after updating: offer roll ranges for older tables (asks
        // first). After the stores load, for the same reason.
        void storesReady.then(() => maybePromptTableRanges(this));
      }
    });

    // Live-refresh the icon list when image files appear in / leave the
    // icons folder. Without this, icons dropped in via the OS file explorer
    // needed an Obsidian restart to show up in the pickers (forum report).
    const isIconFile = (path: string): boolean => {
      const folder = normalizeFolder(this.settings.iconsFolder ?? "");
      if (!folder) return false;
      return (
        path.startsWith(folder + "/") &&
        /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(path)
      );
    };
    this.registerEvent(
      this.app.vault.on("create", (f) => {
        if (isIconFile(f.path)) this.loadAvailableIcons();
        this.paletteStore.onModify(f);
        this.biomeStore.onModify(f);
        this.worldTypeStore.onModify(f);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (isIconFile(f.path)) this.loadAvailableIcons();
        this.paletteStore.onDelete(f);
        this.biomeStore.onDelete(f);
        this.worldTypeStore.onDelete(f);
        this.calloutMemory.forget(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (isIconFile(f.path) || isIconFile(oldPath)) this.loadAvailableIcons();
        this.paletteStore.onRename(f, oldPath);
        this.biomeStore.onRename(f, oldPath);
        this.worldTypeStore.onRename(f, oldPath);
        this.calloutMemory.rename(oldPath, f.path);
        if (f instanceof TFile) void this.onRegionNoteRenamed(f, oldPath);
      }),
    );
    // A region or faction note's Map data callout is refreshed when it's opened (R1).
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && this.regionOrFactionKind(file)) void this.refreshRegionMapData(file);
        this.onHexNoteFocus(file);
      }),
    );
    // Palette notes edited by hand (or by sync) flow back into the palettes.
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        this.paletteStore.onModify(f);
        this.biomeStore.onModify(f);
        this.worldTypeStore.onModify(f);
        this.mapStore.onModify(f);
      }),
    );
    // A hand-edited palette note's derived cells ("(yes)", "(mountains)")
    // are refreshed once the user stops editing it.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.paletteStore.flushPendingDerived()));

    await this.migrateHexFilesToDefaultRegion();

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
    this.addRibbonIcon("map", "Open hex map", () =>
      this.openHexMap(),
    );
    this.addCommand({
      id: "open-hex-map",
      name: "Open hex map",
      callback: () => this.openHexMap(),
    });
    this.addCommand({
      id: "open-hex-table",
      name: "Open hex table",
      callback: () =>
        void this.app.workspace
          .getLeaf()
          .setViewState({ type: VIEW_TYPE_HEX_TABLE }),
    });
    this.addCommand({
      id: "open-terrain-generator",
      name: "Open terrain generator",
      callback: () => void this.openTerrainGenerator(),
    });
    this.addCommand({
      id: "open-palette-editor",
      name: "Open palette editor",
      callback: () => void this.openPaletteEditor(),
    });
    this.addCommand({
      id: "edit-world-types",
      name: "Edit world types…",
      checkCallback: (checking) => {
        if (!hasFeature(this.settings, "generators") || !enabledKinds(this.settings).has("space")) return false;
        if (!checking) {
          const open = this.app.workspace.getActiveViewOfType(HexMapView);
          new WorldTypesModal(this.app, this, open?.activeMapName).open();
        }
        return true;
      },
    });
    this.addCommand({
      id: "new-overworld",
      name: "New overworld…",
      checkCallback: (checking) => {
        if (!hasFeature(this.settings, "regions")) return false;
        if (!checking) this.openNewOverworld();
        return true;
      },
    });
    this.addCommand({
      id: "map-go-up",
      name: "Go up to parent map",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(HexMapView);
        if (!view?.canNavigateUp()) return false;
        if (!checking) view.navigateUp();
        return true;
      },
    });
    this.addCommand({
      id: "map-go-back",
      name: "Go back to previous map",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(HexMapView);
        if (!view?.canNavigateBack()) return false;
        if (!checking) view.navigateBack();
        return true;
      },
    });
    this.addCommand({
      id: "map-go-forward",
      name: "Go forward to the next map",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(HexMapView);
        if (!view?.canNavigateForward()) return false;
        if (!checking) view.navigateForward();
        return true;
      },
    });
    this.addCommand({
      id: "open-random-tables",
      name: "Open random tables",
      callback: () =>
        void this.app.workspace
          .getLeaf()
          .setViewState({ type: VIEW_TYPE_RANDOM_TABLES }),
    });
    this.addCommand({
      id: "add-roll-ranges",
      name: "Add roll ranges to tables",
      callback: () => void openTableRangesModal(this),
    });
    this.addCommand({
      id: "check-tables",
      name: "Check tables",
      callback: () => void runTableCheck(this),
    });
    this.addCommand({
      id: "export-current-note-pdf",
      name: "Export current note to PDF",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) void exportSingleNoteAsPdf(this, file);
        return true;
      },
    });
    this.addCommand({
      id: "export-current-note-markdown",
      name: "Export current note to Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) void exportSingleNoteAsMarkdown(this, file);
        return true;
      },
    });
    this.addCommand({
      id: "export-current-hex",
      name: "Export current hex (structured PDF / Markdown)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file || !this.isHexFile(file)) return false;
        if (!checking) new HexExportModal(this.app, this, file).open();
        return true;
      },
    });
    this.addCommand({
      id: "export-current-workflow",
      name: "Export current workflow with rolled samples",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file || !this.isWorkflowFile(file)) return false;
        if (!checking) new WorkflowExportModal(this.app, this, file).open();
        return true;
      },
    });
    // Map export (PNG / PDF / hexcrawl manual): the same form as Maps →
    // Map data callouts (src/hexMapData.ts) in the open map's hex notes: an
    // opt-in for notes made before the template had one.
    this.addCommand({
      id: "add-map-data-to-hex-notes",
      name: "Add map data to this map's hex notes",
      checkCallback: (checking) => {
        const open = this.app.workspace.getActiveViewOfType(HexMapView)
          ?? this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => l.view).find((v): v is HexMapView => v instanceof HexMapView);
        const mapName = open?.activeMapName;
        if (!mapName || !this.getMap(mapName)) return false;
        if (!checking) {
          new ConfirmModal(
            this.app,
            "Add map data to hex notes",
            `Every hex note of "${this.mapLabel(mapName)}" gets a Map data box under its title showing its terrain, region and name from the map, kept up to date when you open the hex. Nothing else in the notes changes.`,
            "Add map data",
            () => void this.addMapDataToHexNotes(mapName).then((n) => new Notice(`Map data added or updated in ${n} hex note${n === 1 ? "" : "s"}.`)),
          ).open();
        }
        return true;
      },
    });
    // Map data callouts in region and faction notes (R1): which maps use
    // them, with hex counts. Adds the callout where it's missing.
    this.addCommand({
      id: "update-region-faction-map-data",
      name: "Update map data in region and faction notes",
      checkCallback: (checking) => {
        if (!this.regionAndFactionNotes().length) return false;
        if (!checking) {
          new ConfirmModal(
            this.app,
            "Update map data in region and faction notes",
            "Every region and faction note gets a Map data box under its title listing the maps that use it (with hex counts) and, for regions, the encounter table. It is kept up to date when you open the note. Nothing else in the notes changes.",
            "Update map data",
            () => void this.updateRegionFactionMapData().then((n) => new Notice(`Map data added or updated in ${n} note${n === 1 ? "" : "s"}.`)),
          ).open();
        }
        return true;
      },
    });
    // Export, for the map open in the hex map view (else the default map).
    this.addCommand({
      id: "export-current-map",
      name: "Export current map…",
      checkCallback: (checking) => {
        const open = this.app.workspace.getActiveViewOfType(HexMapView)
          ?? this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => l.view).find((v): v is HexMapView => v instanceof HexMapView);
        const mapName = [open?.activeMapName, this.settings.defaultMap, this.settings.maps[0]?.name]
          .find((n): n is string => !!n && !!this.getMap(n));
        if (!mapName) return false;
        if (!checking) new MapExportModal(this.app, this, mapName).open();
        return true;
      },
    });
    // File-menu items: right-click any markdown file → Export to PDF / Markdown
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("Export to PDF")
            .setIcon("file-down")
            .setSection("action")
            .onClick(() => void exportSingleNoteAsPdf(this, file)),
        );
        menu.addItem((item) =>
          item
            .setTitle("Export to Markdown")
            .setIcon("file-text")
            .setSection("action")
            .onClick(() => void exportSingleNoteAsMarkdown(this, file)),
        );
      }),
    );
    this.addSettingTab(new HexmakerSettingTab(this.app, this));

    // Register the embedded roller code block processor
    registerRollerBlock(this);
    // Palette notes in reading view: colour swatches, icon thumbnails and
    // path-style previews beside the table text.
    registerPaletteReadingView(this);

    // Right-click "Insert table roller" in any editor.
    // "editor-menu" is a valid Obsidian workspace event not yet in the official types.
    interface WorkspaceWithEditorMenu {
      on(name: "editor-menu", callback: (menu: Menu, editor: Editor) => void): EventRef;
    }
    this.registerEvent(
      (this.app.workspace as unknown as WorkspaceWithEditorMenu).on(
        "editor-menu",
        (menu: Menu, editor: Editor) => {
          menu.addItem((item) =>
            item
              .setTitle("Insert table roller")
              .setIcon("dice")
              .setSection("insert")
              .onClick(() => {
                new FileLinkSuggestModal(
                  this.app,
                  this,
                  (file) => {
                    const block = `\`\`\`duckmage-roller\n${file.path}\n\`\`\``;
                    editor.replaceSelection(block);
                  },
                  normalizeFolder(this.settings.tablesFolder),
                ).open();
              }),
          );
          menu.addItem((item) =>
            item
              .setTitle("Insert map link")
              .setIcon("map")
              .setSection("insert")
              .onClick(() => {
                new MapLinkModal(this.app, this, (mapName, linkText) => {
                  const vault = encodeURIComponent(this.app.vault.getName());
                  const map   = encodeURIComponent(mapName);
                  editor.replaceSelection(
                    `[${linkText}](obsidian://duckmage-openmap?vault=${vault}&map=${map})`,
                  );
                }).open();
              }),
          );
        },
      ),
    );

    interface WithOpenTable {
      openTable?(path: string): void;
    }
    this.registerObsidianProtocolHandler("duckmage-roll", (params) => {
      const filePath = params["file"];
      if (!filePath) return;
      const leaves = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_RANDOM_TABLES,
      );
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
        (leaves[0].view as unknown as WithOpenTable).openTable?.(filePath);
      } else {
        void this.app.workspace.getLeaf("tab").setViewState({
          type: VIEW_TYPE_RANDOM_TABLES,
          state: { filePath },
        });
      }
    });

    interface WithOpenWorkflow {
      openWorkflow?(path: string): void;
    }
    this.registerObsidianProtocolHandler("duckmage-workflow", (params) => {
      const filePath = params["file"];
      if (!filePath) return;
      const leaves = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_RANDOM_TABLES,
      );
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
        (leaves[0].view as unknown as WithOpenWorkflow).openWorkflow?.(
          filePath,
        );
      } else {
        void this.app.workspace.getLeaf("tab").setViewState({
          type: VIEW_TYPE_RANDOM_TABLES,
          state: { filePath, mode: "workflows" },
        });
      }
    });

    this.registerObsidianProtocolHandler("duckmage-openmap", (params) => {
      const mapName = params["map"];
      if (!mapName) return;
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
      if (leaves.length > 0) {
        // Revealing loads a deferred (restored, never shown) tab first.
        void this.app.workspace.revealLeaf(leaves[0]).then(() => {
          if (leaves[0].view instanceof HexMapView) leaves[0].view.navigateToMap(mapName);
        });
      } else {
        void this.app.workspace.getLeaf("tab")
          .setViewState({ type: VIEW_TYPE_HEX_MAP })
          .then(() => {
            const newLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
            if (newLeaves.length > 0) {
              (newLeaves[0].view as HexMapView).navigateToMap(mapName, { recordHistory: false });
            }
          });
      }
    });

    // Keep linkedFolder frontmatter in sync when a folder is renamed
    this.registerEvent(
      this.app.vault.on("rename", async (abstractFile, oldPath) => {
        if (!(abstractFile instanceof TFolder)) return;
        const oldFolder = normalizeFolder(oldPath);
        const newFolder = normalizeFolder(abstractFile.path);
        if (oldFolder === newFolder) return;

        const tablesPrefix = normalizeFolder(this.settings.tablesFolder);
        const tableFiles = this.app.vault
          .getMarkdownFiles()
          .filter(
            (f) => !tablesPrefix || f.path.startsWith(tablesPrefix + "/"),
          );

        for (const tableFile of tableFiles) {
          const lf: unknown =
            this.app.metadataCache.getFileCache(tableFile)?.frontmatter?.[
              "linkedFolder"
            ];
          if (!lf || typeof lf !== "string") continue;
          const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(lf);
          const lfClean = wikiLinkMatch ? wikiLinkMatch[1].trim() : lf;
          const lfNorm = normalizeFolder(lfClean);
          if (lfNorm !== oldFolder && !lfNorm.startsWith(oldFolder + "/"))
            continue;
          const updatedLf = newFolder + lfNorm.slice(oldFolder.length);
          await this.app.vault.process(tableFile, (content) =>
            content.replace(
              /^(linkedFolder:\s*).*$/m,
              `$1"[[${updatedLf}]]"`,
            ),
          );
        }
      }),
    );

    // Remove workflow steps that reference a deleted table file
    this.registerEvent(
      this.app.vault.on("delete", async (abstractFile: TAbstractFile) => {
        if (!(abstractFile instanceof TFile)) return;
        const tablesPrefix = normalizeFolder(this.settings.tablesFolder);
        if (tablesPrefix && !abstractFile.path.startsWith(tablesPrefix + "/"))
          return;

        // The table path stored in workflows has no .md extension
        const deletedTablePath = abstractFile.path.slice(0, -3);

        const wfPrefix = normalizeFolder(this.settings.workflowsFolder);
        const templatesPath = wfPrefix ? `${wfPrefix}/templates` : "templates";
        const workflowFiles = this.app.vault
          .getMarkdownFiles()
          .filter(
            (f) =>
              (!wfPrefix || f.path.startsWith(wfPrefix + "/")) &&
              !f.path.startsWith(templatesPath + "/") &&
              !f.basename.startsWith("_"),
          );

        for (const wfFile of workflowFiles) {
          await this.app.vault.process(wfFile, (content) => {
            const workflow = parseWorkflow(content, wfFile.basename);
            const filtered = workflow.steps.filter(
              (s) => s.tablePath !== deletedTablePath,
            );
            if (filtered.length === workflow.steps.length) return content;
            workflow.steps = filtered;
            // Everything else in the note (other columns, text after the table) stays.
            return buildWorkflowContent(workflow, { existing: content });
          });
        }
      }),
    );
  }

  onunload() {
    this.pathPins.detach();
    void this.calloutMemory.save();
    clearPendingTerrain();
  }

  private openHexMap(): void {
    void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_MAP });
  }

  /**
   * Open the terrain generator page (or bring it forward), optionally with a
   * region and generator selected, or a biome (#50): a blend-field biome
   * opens as "Biome (blend field)", a generator-backed one opens its
   * generator (the page says which biomes use it).
   */
  async openTerrainGenerator(select: { mapName?: string; generatorPath?: string; paletteName?: string; biome?: string } = {}): Promise<void> {
    // An Advanced feature: in Simple, offer to turn it on first.
    if (!hasFeature(this.settings, "generators")) {
      new EnableFeatureModal(this.app, this, "generators", () => void this.openTerrainGenerator(select)).open();
      return;
    }
    if (select.mapName) GeneratorPanel.mapName = select.mapName;
    if (select.paletteName) GeneratorPanel.paletteName = select.paletteName;
    if (select.generatorPath) {
      GeneratorPanel.selectedPath = select.generatorPath;
      GeneratorPanel.biome = "";
    }
    if (select.biome) {
      const b = this.biomeStore.get(select.biome);
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

  /** "New overworld…": a World biomes map with its region settings (and its regions). */
  openNewOverworld(): void {
    new NewOverworldModal(this.app, this, (name) => void this.showMap(name)).open();
  }

  /**
   * Sandbox-only helpers for dev/demo-world.mjs (OW7): set only when the
   * vault root holds the `.hexmaker-sandbox` marker. No command, no UI.
   */
  devTools?: {
    buildDemoWorld(opts?: { seed?: number }): Promise<unknown>;
    buildBenchWorld(opts?: { seed?: number; side?: number }): Promise<unknown>;
    /** The open map view's overworld layer timings. */
    overworldStats(): unknown;
  };

  /** Show a map in the hex map view, opening the view if it isn't open. */
  async showMap(name: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    // Revealing loads a deferred tab, so this is the map view by now.
    if (leaf.view instanceof HexMapView) leaf.view.switchMapFromModal(name);
  }

  openSetupWizard(): void {
    void this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_SETUP_WIZARD });
  }

  async loadSettings() {
    // One-time migration: rename settings keys "regions" → "maps" and "defaultRegion" → "defaultMap"
    // Must run on raw data BEFORE Object.assign so the migrated key wins over DEFAULT_SETTINGS.
    // One read only: nothing may await between swapping in the new
    // settings and handing their maps to the map store (adoptAll below), or a
    // save in between would see maps without their paths (incident
    // 2026-10-10). rawData is an untouched copy for the "fresh install?" checks.
    const loaded = (await this.loadData()) as Record<string, unknown> | null;
    const rawData = loaded ? (JSON.parse(JSON.stringify(loaded)) as Record<string, unknown>) : null;
    const data = loaded ?? {};
    if (data["regions"] !== undefined && data["maps"] === undefined) {
      data["maps"] = data["regions"];
    }
    delete data["regions"];
    if (data["defaultRegion"] !== undefined && data["defaultMap"] === undefined) {
      data["defaultMap"] = data["defaultRegion"];
    }
    delete data["defaultRegion"];

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<HexmakerPluginSettings>);
    // Own copy: the default is a shared constant, and editors push into lists.
    // (Kept only as the fallback palettes are filled from; see getPathTypes.)
    this.settings.pathTypes = clonePathTypes(this.settings.pathTypes ?? DEFAULT_PATH_TYPES);

    // Deep-clone the maps array so mutations to settings.maps never alias DEFAULT_SETTINGS.maps.
    // Object.assign does a shallow copy, so on first run (data===null) settings.maps IS
    // DEFAULT_SETTINGS.maps – pushing/mutating it would corrupt the constant for the session.
    this.settings.maps = Array.isArray(this.settings.maps)
      ? this.settings.maps
      : [];

    this.settings.maps = this.settings.maps.map((r) => migrateMapData(r, DEFAULT_PALETTE_NAME));
    // Reloaded (onExternalSettingsChange): data.json doesn't hold the paths
    // of maps whose note does, so the fresh map objects take the store's at
    // once. Missing paths mean "not loaded", never "no paths".
    this.mapStore.adoptAll();
    // Ensure terrainPalettes is valid
    if (
      !Array.isArray(this.settings.terrainPalettes) ||
      this.settings.terrainPalettes.length === 0
    ) {
      this.settings.terrainPalettes = DEFAULT_SETTINGS.terrainPalettes.map(
        (p) => ({
          name: p.name,
          terrains: p.terrains.map((t) => ({ ...t })),
        }),
      );
    }
    // PA5: path types saved before every behaviour was an explicit option get
    // them filled in from the old name rules (once), so no map changes look.
    // Notes are migrated by PaletteStore on attach.
    if (!this.settings.pathTypesExplicit) fillLegacyPathTypes(this.settings.terrainPalettes, this.settings.pathTypes);
    if (!this.settings.hexOrientation) this.settings.hexOrientation = "pointy";
    if (!this.settings.tablesFolder)
      this.settings.tablesFolder = "world/tables";
    if (!this.settings.defaultTableDice) this.settings.defaultTableDice = 100;
    if (this.settings.questsFolder === undefined)
      this.settings.questsFolder = "";
    if (this.settings.featuresFolder === undefined)
      this.settings.featuresFolder = "";
    if (this.settings.factionsFolder === undefined)
      this.settings.factionsFolder = "";
    if (this.settings.hexEditorTerrainCollapsed === undefined)
      this.settings.hexEditorTerrainCollapsed = false;
    if (this.settings.hexEditorFeaturesCollapsed === undefined)
      this.settings.hexEditorFeaturesCollapsed = false;
    if (this.settings.hexEditorNotesCollapsed === undefined)
      this.settings.hexEditorNotesCollapsed = false;
    if (!Array.isArray(this.settings.rollTableExcludedFolders))
      this.settings.rollTableExcludedFolders = ["terrain"];
    if (!Array.isArray(this.settings.encounterTableExcludedFolders))
      this.settings.encounterTableExcludedFolders = ["terrain"];
    if (!this.settings.defaultMap) {
      this.settings.defaultMap = this.settings.maps[0]?.name ?? "default";
    }
    // Own copy (never alias DEFAULT_SETTINGS). Read from the raw data: unset
    // (new install / older data) = world, plus space if a palette has space
    // terrains already.
    this.settings.mapKinds = resolveMapKinds(data["mapKinds"], this.settings.terrainPalettes);
    // Feature level, also from the raw data: an install that already had
    // settings (an update) gets Advanced so nothing it used disappears; a
    // fresh one starts Simple. Saved right away, so the next load doesn't
    // mistake a fresh install's first save for an update.
    this.settings.featureLevel = resolveFeatureLevel(rawData);
    this.settings.advancedFeatures = Array.isArray(data["advancedFeatures"]) ? (data["advancedFeatures"] as unknown[]).filter((f): f is string => typeof f === "string") : [];
    this.settings.dismissedHints = Array.isArray(data["dismissedHints"]) ? (data["dismissedHints"] as unknown[]).filter((f): f is string => typeof f === "string") : [];
    const firstLevel = rawData?.["featureLevel"] === undefined;
    if (!this.settings.installedAt) this.settings.installedAt = new Date().toISOString().slice(0, 10);
    // New maps default to Expanded on fresh installs only (GEN1): decided
    // once from the raw data, like the level, and saved with it.
    this.settings.expandedByDefault = resolveExpandedDefault(rawData);
    const firstExpanded = typeof rawData?.["expandedByDefault"] !== "boolean";
    // "Palette for new maps": seeded once from the above, then the user's.
    this.settings.defaultPalette = resolveDefaultPalette(rawData);
    const firstDefaultPalette = typeof rawData?.["defaultPalette"] !== "string";
    if (firstLevel || firstExpanded || firstDefaultPalette || !rawData?.["installedAt"]) await this.saveData(this.settings);
  }

  /**
   * Settings go to data.json without the paths of maps whose note holds them
   * (MapStore.holdsPaths): each map's roads and rivers live only in its map
   * note, which a person can read and edit. Maps not yet in a note keep them.
   */
  async saveData(data: unknown): Promise<void> {
    const out = data !== this.settings || !this.mapStore?.isReady() ? data : withoutNotePaths(this.settings, (name) => this.mapStore.holdsPaths(name));
    this.rememberWrite(out);
    return super.saveData(out);
  }

  /** What we wrote to data.json lately (compact JSON), to tell our own writes from outside changes. */
  private recentWrites: string[] = [];

  private rememberWrite(data: unknown): void {
    try {
      this.recentWrites.push(JSON.stringify(data));
      if (this.recentWrites.length > 20) this.recentWrites.shift();
    } catch { /* not JSON-able: never matches */ }
  }

  /** data.json holds exactly something this session wrote (an echo of our own save). */
  private isOwnWrite(disk: unknown): boolean {
    if (disk === null || disk === undefined) return false;
    const text = JSON.stringify(disk);
    return this.recentWrites.includes(text);
  }

  async saveSettings() {
    this.settings.savedWith = pluginVersion(this);
    await this.saveData(this.settings);
    // Mirror palette edits (from any editor) into the palette notes.
    void this.paletteStore.sync();
    // A terrain added anywhere (palette editor, terrain editor, a new or
    // imported palette) gets its empty tables (HG5).
    void this.ensureTablesForNewTerrains();
    void this.mapStore.sync();
    // Settings hold map-level state (paths, palette, grid size, overlays).
    // A save made from one view/window leaves sibling map views stale —
    // flag them so they re-render on next activation (issue #32). The
    // active map view (the one making the change) is skipped inside
    // markStaleFromExternal.
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
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
    if (this.isOwnWrite(await this.loadData())) return;
    await this.loadSettings();
    // Map notes hold paths and map settings; the new data.json doesn't win.
    // Queued before any sync, so nothing writes the bare copy over a note.
    void this.mapStore.reloadFromNotes();
    // data.json carries a cached copy of the palettes; the notes win.
    await this.paletteStore.reload();
    this.loadAvailableIcons();
    this.refreshHexMap();
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach((leaf) => {
      if (leaf.view instanceof HexTableView) void leaf.view.loadTable();
    });
  }

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
    // An Advanced feature: in Simple, offer to turn it on first.
    if (!hasFeature(this.settings, "palettes")) {
      new EnableFeatureModal(this.app, this, "palettes", () => void this.openPaletteEditor(paletteName)).open();
      return;
    }
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

  /**
   * Map types turned on/off (settings, setup wizard): reload the icon
   * pickers and re-render open pages that list palettes or generators so
   * the change shows at once. Modals read the setting when they open.
   */
  /** Switch between Simple and Advanced (settings, wizard, hints). */
  async setFeatureLevel(level: FeatureLevel): Promise<void> {
    this.settings.featureLevel = level;
    await this.saveSettings();
    this.onFeaturesChanged();
  }

  /** Turn on one Advanced feature while in Simple (see enableFeature). */
  async enableAdvancedFeature(f: AdvancedFeature): Promise<void> {
    enableFeature(this.settings, f);
    await this.saveSettings();
    this.onFeaturesChanged();
  }

  /** Turn off one Advanced feature that was turned on by itself (Simple only). */
  async disableAdvancedFeature(f: AdvancedFeature): Promise<void> {
    this.settings.advancedFeatures = this.settings.advancedFeatures.filter((x) => x !== f);
    await this.saveSettings();
    this.onFeaturesChanged();
  }

  /** Open modals that show or hide features (see onFeatureChange). */
  private featureListeners = new Set<() => void>();

  /**
   * Re-render when the feature level or an Advanced feature changes, e.g. a
   * modal whose hint turned one on. Returns the unsubscribe; call it on close.
   */
  onFeatureChange(fn: () => void): () => void {
    this.featureListeners.add(fn);
    return () => this.featureListeners.delete(fn);
  }

  /**
   * Feature level or an Advanced feature changed: re-render open pages and
   * modals that show or hide features.
   */
  onFeaturesChanged(): void {
    this.onMapKindsChanged();
    for (const fn of [...this.featureListeners]) fn();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES)) {
      if (leaf.view instanceof RandomTableView) leaf.view.refreshFeatures();
    }
  }

  onMapKindsChanged(): void {
    this.loadAvailableIcons();
    this.refreshPaletteEditors();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)) {
      if (leaf.view instanceof GeneratorView) leaf.view.refresh();
    }
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

  async autoRegisterMapsFromVault(): Promise<void> {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    if (!hexFolder) return;
    const root = this.app.vault.getAbstractFileByPath(hexFolder);
    if (!(root instanceof TFolder)) return;

    const registered = new Set(this.settings.maps.map((m) => m.name));
    const added: string[] = [];

    for (const child of root.children) {
      if (!(child instanceof TFolder)) continue;
      if (registered.has(child.name)) continue;

      // Infer grid bounds from hex note filenames (pattern: x_y.md)
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const file of child.children) {
        if (!(file instanceof TFile)) continue;
        const m = file.basename.match(/^(-?\d+)_(-?\d+)$/);
        if (!m) continue;
        const x = parseInt(m[1]), y = parseInt(m[2]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const cols = isFinite(maxX) ? maxX - minX + 1 : 20;
      const rows = isFinite(maxY) ? maxY - minY + 1 : 16;
      const offsetX = isFinite(minX) ? minX : 0;
      const offsetY = isFinite(minY) ? minY : 0;
      const paletteName =
        this.settings.terrainPalettes[0]?.name ?? DEFAULT_PALETTE_NAME;

      this.settings.maps.push({
        name: child.name,
        paletteName,
        gridSize: { cols, rows },
        gridOffset: { x: offsetX, y: offsetY },
        pathChains: [],
      });
      added.push(child.name);
    }

    if (added.length === 0) return;

    if (!this.settings.defaultMap || !registered.has(this.settings.defaultMap)) {
      this.settings.defaultMap = added[0];
    }
    await this.saveSettings();
    new Notice(
      `Hexmap World Creator: auto-registered ${added.length} map${added.length > 1 ? "s" : ""} from vault: ${added.join(", ")}`,
    );
  }

  /**
   * Whether a note may be offered in a note picker: never `_`-prefixed;
   * templates (the hex template, workflow templates, the core Templates or
   * Templater folder) only when the picker is for choosing a template
   * (`purpose` "template"). Use in every note picker.
   */
  isLinkableNote(file: TFile, purpose: NotePickPurpose = "link"): boolean {
    return isLinkableNotePath(file.path, file.basename, this.templateRules(), purpose);
  }

  private templateRules(): TemplateNoteRules {
    type Loose = {
      internalPlugins?: {
        getPluginById?(id: string): { enabled?: boolean; instance?: { options?: { folder?: string } } } | null;
      };
      plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } } | undefined> };
    };
    const loose = this.app as unknown as Loose;
    const core = loose.internalPlugins?.getPluginById?.("templates");
    const coreFolder = core?.enabled ? core.instance?.options?.folder : undefined;
    const templater = loose.plugins?.plugins?.["templater-obsidian"]?.settings?.templates_folder;
    return templateNoteRules(this.settings, [coreFolder, templater]);
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

  /**
   * Check whether a TFile is a hex note (lives under the configured hex
   * folder, basename matches the `x_y` coord pattern). Used to gate the
   * structured hex export command.
   */
  isHexFile(file: TFile): boolean {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    if (hexFolder && !file.path.startsWith(hexFolder + "/")) return false;
    return /^-?\d+_-?\d+$/.test(file.basename);
  }

  hexPath(x: number, y: number, mapName: string): string {
    const folder = normalizeFolder(this.settings.hexFolder);
    return folder
      ? `${folder}/${mapName}/${x}_${y}.md`
      : `${mapName}/${x}_${y}.md`;
  }

  /** A map was renamed: every hex's Region map / Locations link to it follows. */
  async updateSubmapReferences(oldName: string, newName: string): Promise<void> {
    for (const m of this.settings.maps) {
      for (const [key, h] of [...this.mapStore.all(m.name)]) {
        const patch = renameMapPatch(h, oldName, newName);
        if (patch) this.mapStore.set(m.name, key, patch);
      }
    }
    this.noParentMaps.clear();
    // Children of the renamed map keep their breadcrumb.
    for (const m of this.settings.maps) {
      if (m.parent?.map === oldName) m.parent.map = newName;
    }
  }

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

    // Starter weather and rumours tables (E2): rolled from the hex editor
    // when the map and hex don't name their own.
    for (const [section, rows] of [["weather", STARTER_WEATHER], ["hooks & rumors", STARTER_RUMORS]] as const) {
      const path = starterTablePath(folder, section);
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        await this.app.vault.create(
          path,
          makeTableTemplate(
            this.settings.defaultTableDice,
            {
              "table-type": section === "weather" ? "weather" : "rumors",
              "roll-filter": false,
              "encounter-filter": false,
            },
            this.buildRollerLink(),
            rows,
          ),
        );
      } catch {
        /* ignore */
      }
    }

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

    // Migrate any old flat-format files ({name} - {type}.md) to the new subfolder scheme
    for (const entry of this.getAllTerrains()) {
      for (const tableType of ["description", "encounters"] as const) {
        const oldPath = `${subfolder}/${entry.name} - ${tableType}.md`;
        const newPath = `${subfolder}/${tableType}/${entry.name}.md`;
        const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
        if (
          oldFile instanceof TFile &&
          !this.app.vault.getAbstractFileByPath(newPath)
        ) {
          try {
            await this.app.fileManager.renameFile(oldFile, newPath);
          } catch {
            /* ignore */
          }
        }
      }
    }

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
    const terrains = this.tableTerrains();
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
      `Linked region encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
    );
  }

  /** Update every hex note whose terrain matches oldName to newName.
   *  Reads file content directly (not the metadata cache) so successive renames
   *  don't miss hexes whose cache entry hasn't refreshed yet.
   *  Returns a Map of filePath → newName for use as terrain overrides when re-rendering. */
  async renameTerrainInHexes(
    oldName: string,
    newName: string,
  ): Promise<Map<string, string>> {
    // Terrain lives in map notes: rename it there (in memory now, notes
    // follow). Hex notes no longer carry terrain.
    const overrides = new Map<string, string>();
    for (const m of this.settings.maps) {
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
    const overrides = await this.renameTerrainInHexes(oldName, newName);
    // Another palette still has a terrain of the old name: its tables stay
    // and the renamed one gets a copy.
    const shared = this.settings.terrainPalettes.some((p) => p.terrains.some((t) => t !== entry && t.name === oldName));
    await this.renameTerrainTables(oldName, newName, shared);
    entry.name = newName;
    await this.saveSettings();
    this.refreshHexMapWithOverrides(overrides);
    this.refreshHexTableTerrainRename(oldName, newName);
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

  async setHexName(mapName: string, x: number, y: number, raw: string): Promise<void> {
    const key = `${x}_${y}`;
    const name = cleanHexName(raw);
    const old = this.mapStore.get(mapName, key)?.name;
    if ((old ?? "") === name) return;
    this.mapStore.set(mapName, key, { name: name || null }, "edit-note");
    // The "<map> x, y" alias rides along (added if the note lacks it).
    const coord = this.hexCoordAlias(mapName, x, y);
    await syncHexAliases(this.app, this.hexPath(x, y, mapName), [
      { from: old, to: name },
      { from: coord, to: coord },
    ]);
  }

  /** A hex note's "<map display name> x, y" alias (NM2). */
  hexCoordAlias(mapName: string, x: number | string, y: number | string): string {
    return coordAlias(this.mapLabel(mapName), x, y);
  }

  /**
   * A map's display name changed from `oldLabel` to its current one: swap
   * the "<map> x, y" alias on every hex note of the map. User aliases stay;
   * a note without the old alias gets the new one.
   */
  async syncMapCoordAliases(mapName: string, oldLabel: string): Promise<void> {
    const newLabel = this.mapLabel(mapName);
    if (newLabel === oldLabel) return;
    const folder = this.app.vault.getAbstractFileByPath(this.mapStore.mapFolder(mapName));
    if (!(folder instanceof TFolder)) return;
    for (const child of folder.children) {
      if (!(child instanceof TFile)) continue;
      const m = /^(-?\d+)_(-?\d+)$/.exec(child.basename);
      if (!m || child.extension !== "md") continue;
      await syncHexAliases(this.app, child.path, [
        { from: coordAlias(oldLabel, m[1], m[2]), to: coordAlias(newLabel, m[1], m[2]) },
      ]);
    }
  }

  /** Create a hex note from the configured template (or the built-in default). */
  async createHexNote(
    x: number,
    y: number,
    mapName: string,
    preloadedTemplate?: string,
    terrain?: string,
  ): Promise<TFile | null> {
    const path = this.hexPath(x, y, mapName);
    let content: string;

    if (preloadedTemplate !== undefined) {
      content = preloadedTemplate;
    } else {
      content = await this.loadHexTemplate();
    }

    content = content
      .replace(/\{\{x\}\}/g, String(x))
      .replace(/\{\{y\}\}/g, String(y))
      .replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`)
      .replace(/\{\{map\}\}/g, mapName);
    // Map data lives in the map note: the hex note links there instead of
    // carrying (possibly stale) terrain/region fields.
    content = withMapLink(content, mapName);
    if (terrain) this.mapStore.set(mapName, `${x}_${y}`, { terrain });
    // The template's Map data callout shows what the map has for this hex.
    const mapDataView = this.hexMapDataView(mapName, x, y);
    const withMapData = setMapData(content, mapDataView);
    // Remember what it shows, so a later hand edit is told from a stale copy.
    if (withMapData !== content) this.calloutMemory.set(path, shownValues(mapDataLines(mapDataView)));
    content = withMapData;
    // The hex's terrain (just set, or painted before it had a note) gets
    // its encounter-table link now rather than patched in later.
    const encounterLink = this.terrainEncounterLinkFor(mapName, x, y, path);
    if (encounterLink) {
      content = insertLinkInSection(content, "Encounters Table", `[[${encounterLink}]]`);
    }

    const hexBase = normalizeFolder(this.settings.hexFolder);
    const mapFolder = hexBase ? `${hexBase}/${mapName}` : mapName;
    if (!this.app.vault.getAbstractFileByPath(mapFolder)) {
      // Wrap in try/catch: a concurrent worker may have already created the folder.
      try {
        await this.app.vault.createFolder(mapFolder);
      } catch {
        /* exists */
      }
    }

    try {
      const file = await this.app.vault.create(path, content);
      // A named hex's note gets its name as an alias (X4), and every hex
      // note gets "<map> x, y" (NM2).
      const name = this.mapStore.get(mapName, `${x}_${y}`)?.name;
      await syncHexAliases(this.app, path, [
        { from: undefined, to: name },
        { from: undefined, to: this.hexCoordAlias(mapName, x, y) },
      ]);
      return file;
    } catch {
      // A concurrent worker may have created this file between our existence check and
      // this create call.  If the file now exists, use it rather than treating it as an error.
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      new Notice("Could not create note at " + path);
      return null;
    }
  }

  /**
   * Append text to a section of a hex's note, creating the note first if
   * the hex has none (P2 "Add to this hex").
   */
  async appendToHexSection(x: number, y: number, mapName: string, section: string, text: string): Promise<void> {
    const path = this.hexPath(x, y, mapName);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) file = await this.createHexNote(x, y, mapName);
    if (!(file instanceof TFile)) throw new Error(`Could not create the note for hex ${x}, ${y}`);
    await this.app.vault.process(file, (content) => appendSectionText(content, section, text));
  }

  /** Read the hex template once (used by bulk generation to avoid N redundant reads). */
  /** The hex note last opened in an editor (its callout is synced when another file opens). */
  private focusedHexNote: string | null = null;

  /**
   * A file opened in an editor: a hex note left behind has its Map data
   * callout synced (hand edits made in it go to the map), and a hex note
   * being opened gets its callout brought up to date before it's edited.
   * Not while the user is still in the note: rewriting it mid-typing would
   * fight the editor.
   */
  private onHexNoteFocus(file: TFile | null): void {
    const sync = (path: string) => {
      const loc = this.mapStore.isReady() ? this.mapStore.resolve(path) : null;
      if (!loc || !this.getMap(loc.map)) return;
      const [x, y] = loc.key.split("_").map(Number);
      void this.syncHexMapData(loc.map, x, y);
    };
    const prev = this.focusedHexNote;
    const next = file && this.mapStore.isReady() && this.mapStore.resolve(file.path) ? file.path : null;
    if (prev && prev !== file?.path) sync(prev);
    if (next && next !== prev) sync(next);
    this.focusedHexNote = next;
  }

  /** What the map has for a hex, for its note's Map data callout (src/hexMapData.ts). */
  hexMapDataView(mapName: string, x: number, y: number): HexMapDataView {
    const h = this.mapStore.get(mapName, `${x}_${y}`) ?? {};
    const ref = (m: string) => ({ map: m, label: this.mapLabel(m) });
    return {
      map: mapName, mapLabel: this.mapLabel(mapName), x, y, terrain: h.terrain, region: h.region, name: h.name,
      regionMap: h.regionMap ? ref(h.regionMap) : undefined,
      locations: h.locations?.length ? h.locations.map(ref) : undefined,
      biome: this.hexBiomeRef(mapName, `${x}_${y}`),
    };
  }

  /** An overworld hex's biome for its Map data callout: its label, and its biome note when it has one. */
  private hexBiomeRef(mapName: string, key: string): { label: string; note?: string } | undefined {
    if (!overworldOf(this, mapName)) return undefined;
    const id = hexBiomeAt(this, mapName, key);
    if (!id) return undefined;
    const label = biomeNoteOf(id)?.label ?? BIOMES.find((b) => b.id === id)?.label ?? id;
    return { label, note: this.biomeStore.pathOf(id) };
  }

  /**
   * Bring a hex note's Map data callout up to date with the map (or add one
   * when `insert`). Hand edits made inside the callout go to the map first
   * (phase 2, see `syncHexMapData`). Only writes when something changed; a
   * note without a callout is left alone unless `insert`. Returns whether
   * it wrote.
   */
  async refreshHexMapData(mapName: string, x: number, y: number, insert = false): Promise<boolean> {
    return (await this.syncHexMapData(mapName, x, y, { insert })).wrote;
  }

  /**
   * A hex note's Map data callout, both ways (phase 2): hand edits to
   * Terrain, Region or Name made since the plugin last wrote it go to the
   * map (through the work-mode gate, as one undo step), unless the map has
   * changed them since (the map is newer); then the callout is rewritten
   * to show the map. Edits that weren't applied stay in the callout as
   * "Not applied:" lines and lines it can't read as "Not read:" lines, and
   * a notice says so (unless `quiet`).
   */
  async syncHexMapData(
    mapName: string, x: number, y: number, opts: { insert?: boolean; quiet?: boolean } = {},
  ): Promise<{ wrote: boolean; applied: string[]; notApplied: string[]; unreadable: string[] }> {
    const out = { wrote: false, applied: [] as string[], notApplied: [] as string[], unreadable: [] as string[] };
    const path = this.hexPath(x, y, mapName);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return out;
    await this.calloutMemory.ready();
    // Read first: most notes need nothing, and a no-op process() still writes.
    const current = await this.app.vault.read(file);
    const now = () => shownValues(mapDataLines(this.hexMapDataView(mapName, x, y)));
    const plan = planCalloutImport(current, this.calloutMemory.get(path), now());
    // No callout and none to add: nothing to do.
    if (!plan && !opts.insert) return out;
    if (plan) {
      out.notApplied.push(...plan.notApplied);
      out.unreadable.push(...plan.unreadable);
      const edits = Object.entries(plan.apply) as [keyof typeof plan.apply, string | null][];
      if (edits.length) {
        await this.undoableEdit(mapName, async () => {
          const key = `${x}_${y}`;
          for (const [field, value] of edits) {
            const shown = `${field[0].toUpperCase()}${field.slice(1)}: ${value ?? "—"}`;
            if (field === "name") {
              await this.setHexName(mapName, x, y, value ?? "");
              out.applied.push(shown);
            } else if (field === "terrain") {
              // A terrain must be one the map's palette has (matched ignoring case).
              const terrain = value === null ? null : this.getMapPalette(mapName).find((t) => sameName(t.name, value))?.name;
              if (terrain === undefined) { out.notApplied.push(`${shown} (not in this map's palette)`); continue; }
              if (!this.mapStore.set(mapName, key, { terrain }, "paint-terrain")) { out.notApplied.push(`${shown} (${lockedHint("paint-terrain")})`); continue; }
              await this.syncHexEncounterTableLink(path, terrain);
              out.applied.push(shown);
            } else {
              if (!this.mapStore.set(mapName, key, { region: value }, "paint-region-area")) { out.notApplied.push(`${shown} (${lockedHint("paint-region-area")})`); continue; }
              out.applied.push(shown);
            }
          }
        });
      }
    }
    const view = this.hexMapDataView(mapName, x, y);
    const notes = [...out.notApplied.map((s) => `Not applied: ${s}`), ...out.unreadable.map((s) => `Not read: ${s}`)];
    const latest = await this.app.vault.read(file);
    if (setMapData(latest, view, opts.insert, notes) !== latest) {
      await this.app.vault.process(file, (content) => {
        const next = setMapData(content, view, opts.insert, notes);
        out.wrote = next !== content;
        return next;
      });
    }
    // Remember what the callout shows now, so the next edit is told from a stale copy.
    if (plan || opts.insert) this.calloutMemory.set(path, now());
    if (!opts.quiet) {
      const msg = mapDataSyncMessage(`${this.mapLabel(mapName)} ${x}, ${y}`, out);
      if (msg) new Notice(msg, 8000);
    }
    return out;
  }

  /** Add (or update) the Map data callout in every hex note of a map. Returns how many notes changed. */
  async addMapDataToHexNotes(mapName: string): Promise<number> {
    const hexBase = normalizeFolder(this.settings.hexFolder);
    const folder = this.app.vault.getAbstractFileByPath(hexBase ? `${hexBase}/${mapName}` : mapName);
    if (!(folder instanceof TFolder)) return 0;
    let n = 0;
    const totals = { applied: [] as string[], notApplied: [] as string[], unreadable: [] as string[] };
    for (const f of folder.children) {
      if (!(f instanceof TFile)) continue;
      const m = /^(-?\d+)_(-?\d+)\.md$/.exec(f.name);
      if (!m) continue;
      const r = await this.syncHexMapData(mapName, Number(m[1]), Number(m[2]), { insert: true, quiet: true });
      if (r.wrote) n++;
      totals.applied.push(...r.applied);
      totals.notApplied.push(...r.notApplied);
      totals.unreadable.push(...r.unreadable);
    }
    const msg = mapDataSyncMessage(this.mapLabel(mapName), totals);
    if (msg) new Notice(msg, 8000);
    return n;
  }

  // ── Region and faction notes (R1, R2) ────────────────────────────────────

  /** "region" / "faction" for a note in the regions / factions folder ("_" notes aren't). */
  regionOrFactionKind(file: TFile): "region" | "faction" | null {
    if (file.extension !== "md" || file.basename.startsWith("_")) return null;
    const inFolder = (setting: string) => {
      const folder = normalizeFolder(setting ?? "");
      return !!folder && file.path.startsWith(folder + "/");
    };
    if (inFolder(this.settings.regionsFolder)) return "region";
    if (inFolder(this.settings.factionsFolder)) return "faction";
    return null;
  }

  /** Every region and faction note. */
  regionAndFactionNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.regionOrFactionKind(f) !== null);
  }

  /** The maps that use a region or faction note, for its Map data callout. */
  regionMapDataView(file: TFile, kind: "region" | "faction"): RegionMapDataView {
    const maps = this.settings.maps.map((m) => ({ name: m.name, label: this.mapLabel(m.name) }));
    if (kind === "region") {
      const folder = normalizeFolder(this.settings.tablesFolder);
      const table = this.app.vault.getAbstractFileByPath(`${folder ? `${folder}/` : ""}regions/${file.basename}.md`);
      return {
        kind,
        maps: regionUse(file.basename, maps, (m) => this.mapStore.all(m).values()),
        encounterTable: table instanceof TFile ? this.app.metadataCache.fileToLinktext(table, file.path) : undefined,
      };
    }
    // Factions: hex notes that link the faction note, per map.
    const counts = new Map<string, number>();
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (!targets[file.path]) continue;
      const loc = this.mapStore.resolve(source);
      if (loc) counts.set(loc.map, (counts.get(loc.map) ?? 0) + 1);
    }
    return {
      kind,
      maps: maps
        .filter((m, i) => counts.get(m.name) && maps.findIndex((o) => o.name === m.name) === i)
        .map((m) => ({ map: m.name, label: m.label, hexes: counts.get(m.name) ?? 0 })),
    };
  }

  /**
   * Bring a region or faction note's Map data callout up to date (or add
   * one when `insert`). Only writes when something changed. Returns
   * whether it wrote.
   */
  async refreshRegionMapData(file: TFile, insert = false): Promise<boolean> {
    const kind = this.regionOrFactionKind(file);
    if (!kind || !this.mapStore.isReady()) return false;
    const current = await this.app.vault.read(file);
    if (!insert && !hasRegionMapData(current)) return false;
    const view = this.regionMapDataView(file, kind);
    // Read first: most notes need nothing, and a no-op process() still writes.
    if (setRegionMapData(current, view, insert) === current) return false;
    let wrote = false;
    await this.app.vault.process(file, (content) => {
      const next = setRegionMapData(content, view, insert);
      wrote = next !== content;
      return next;
    });
    return wrote;
  }

  /** Add or update the Map data callout in every region and faction note. Returns how many changed. */
  async updateRegionFactionMapData(): Promise<number> {
    await this.mapStore.flush();
    let n = 0;
    for (const f of this.regionAndFactionNotes()) {
      if (await this.refreshRegionMapData(f, true)) n++;
    }
    return n;
  }

  /**
   * A region note was renamed: hexes whose Region named it follow, through
   * the map store (the map notes are rewritten from it). Returns how many
   * hexes changed.
   */
  renameRegionInMaps(oldName: string, newName: string): number {
    return renameRegionInStore(this.mapStore, this.settings.maps.map((m) => m.name), oldName, newName);
  }

  /**
   * A note in the regions folder was renamed (R2): its hexes keep their
   * region, and its encounter table follows the name (unless the new name
   * already has one).
   */
  private async onRegionNoteRenamed(file: TFile, oldPath: string): Promise<void> {
    const folder = normalizeFolder(this.settings.regionsFolder ?? "");
    if (!folder || !oldPath.startsWith(folder + "/") || !/\.md$/i.test(oldPath)) return;
    const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const newName = file.basename;
    if (oldName === newName || oldName.startsWith("_") || !this.mapStore.isReady()) return;
    const n = this.renameRegionInMaps(oldName, newName);
    const tables = normalizeFolder(this.settings.tablesFolder);
    const sub = tables ? `${tables}/regions` : "regions";
    const table = this.app.vault.getAbstractFileByPath(`${sub}/${oldName}.md`);
    if (table instanceof TFile && !this.app.vault.getAbstractFileByPath(`${sub}/${newName}.md`)) {
      try {
        await this.app.fileManager.renameFile(table, `${sub}/${newName}.md`);
      } catch { /* the hexes still keep their region */ }
    }
    if (n) new Notice(`Region renamed: ${n} hex${n === 1 ? "" : "es"} now in "${newName}".`);
  }

  /** A map was renamed: tokens placed on it (`token-map`) follow. Returns how many notes changed. */
  async updateTokenMapReferences(oldName: string, newName: string): Promise<number> {
    let n = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.basename.startsWith("_")) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || renamedTokenMap(fm["token-map"], oldName, newName) === null) continue;
      await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
        const next = renamedTokenMap(front["token-map"], oldName, newName);
        if (next !== null) front["token-map"] = next;
      });
      n++;
    }
    return n;
  }

  private async loadHexTemplate(): Promise<string> {
    const templatePath = normalizeFolder(this.settings.templatePath ?? "");
    if (templatePath) {
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
      if (templateFile instanceof TFile) {
        try {
          return await this.app.vault.read(templateFile);
        } catch { /* fall through */ }
      }
      new Notice(`Hex template not found at "${templatePath}" — using built-in default.`);
      return DEFAULT_HEX_TEMPLATE;
    }
    // No path set: hex.md in the templates folder, if there is one (PA3).
    const inFolder = this.app.vault.getAbstractFileByPath(hexTemplatePathFor(this.settings));
    if (inFolder instanceof TFile) {
      try {
        return await this.app.vault.read(inFolder);
      } catch { /* fall through */ }
    }
    return DEFAULT_HEX_TEMPLATE;
  }

  /** The plugin's templates folder (PA3; see src/noteTemplates.ts). */
  templatesFolder(): string {
    return templatesFolderFor(this.settings);
  }

  /** Create a note template file from its built-in default if it's missing. */
  private async ensureTemplateFile(path: string, content: string): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch { /* exists */ }
    }
    try {
      await this.app.vault.create(path, content);
    } catch { /* created concurrently — fine */ }
  }

  /**
   * Make sure the templates folder holds every plugin note template: the
   * hex template (unless the user points templatePath elsewhere) and the
   * town template. Existing files are never overwritten.
   */
  async ensureTemplates(): Promise<void> {
    await this.ensureHexTemplate();
    await this.ensureTemplateFile(townTemplatePathFor(this.settings), DEFAULT_TOWN_TEMPLATE);
  }

  /**
   * Starting text for a note made from a link section's "create new" (towns
   * get the town template, written to the templates folder on first use;
   * encounter tables get a table). `title` fills {{title}}.
   */
  async newLinkedNoteContent(section: string, title: string, fromHex?: string): Promise<string> {
    if (section === "Encounters Table") return makeTableTemplate(this.settings.defaultTableDice);
    // Made from a hex: a place says where it is (R3).
    const located = (content: string) =>
      fromHex && LOCATION_SECTIONS.includes(section) ? this.withHexLocation(content, fromHex) : content;
    if (noteTemplateFor(section) !== "town") return located("");
    const path = townTemplatePathFor(this.settings);
    await this.ensureTemplateFile(path, DEFAULT_TOWN_TEMPLATE);
    const file = this.app.vault.getAbstractFileByPath(path);
    let template = DEFAULT_TOWN_TEMPLATE;
    if (file instanceof TFile) {
      try {
        template = await this.app.vault.read(file);
      } catch { /* use the default */ }
    }
    return located(fillNoteTemplate(template, title));
  }

  /** `content` with a `Location: [[hex|<map> x, y]]` line under its title (R3). */
  withHexLocation(content: string, hexPath: string): string {
    const loc = this.mapStore.resolve(hexPath);
    const [x, y] = loc ? loc.key.split("_") : [];
    const label = loc ? this.hexCoordAlias(loc.map, x, y) : this.hexLinkAlias(hexPath);
    return withLocationLine(content, hexPath, label);
  }

  /**
   * Ensure a hex template file exists on disk.
   * - If templatePath is set and the file exists: no-op.
   * - If templatePath is set but the file is missing: create it from the built-in default.
   * - If templatePath is blank: create hex.md in the templates folder (PA3)
   *   and persist the path.
   */
  async ensureHexTemplate(): Promise<void> {
    let templatePath = normalizeFolder(this.settings.templatePath ?? "");
    if (!templatePath) {
      templatePath = hexTemplatePathFor(this.settings);
      this.settings.templatePath = templatePath;
      await this.saveSettings();
    }
    await this.ensureTemplateFile(templatePath, DEFAULT_HEX_TEMPLATE);
  }

  /**
   * Create hex notes for every (x, y) in the cartesian product of xs × ys,
   * skipping any that already exist on disk.  Returns the number of notes created.
   */
  async createNewMap(
    rawName: string,
    cols: number,
    rows: number,
    paletteName: string,
    initialX = 0,
    initialY = 0,
    staggerOffset?: "odd" | "even",
    onProgress?: (done: number, total: number) => void,
    /** Optional generated terrain per hex, keyed "x_y". */
    terrainAt?: Map<string, string>,
    extra: {
      /** Terrain shown on unpainted hexes. Cells equal to it aren't
       *  written to the map note. Hex notes are created on use either way. */
      baseTerrain?: string;
      parent?: { map: string; hex: string };
      /** Silence the "generated N notes" notice (caller reports instead). */
      quiet?: boolean;
      /** Folder name (slug) to use instead of one made from rawName (NAV2). */
      slug?: string;
    } = {},
  ): Promise<{ name: string } | { error: string }> {
    if (!rawName.trim()) return { error: "Enter a map name." };
    const name = slugify(extra.slug?.trim() || rawName);
    if (!name) return { error: extra.slug ? "Enter a folder name." : "Enter a map name." };
    if (this.settings.maps.some((r) => r.name === name))
      return { error: `Map "${name}" already exists.` };

    await this.ensurePaletteInstalled(paletteName);

    const hexFolder = normalizeFolder(this.settings.hexFolder);
    const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch { /* already exists */ }
    }

    // The slug names the folder; the name as typed is what the UI shows.
    const displayName = displayNameFor(rawName, name);
    this.settings.maps.push({
      name,
      ...(displayName ? { displayName } : {}),
      paletteName,
      gridSize: { cols, rows },
      gridOffset: { x: initialX, y: initialY },
      pathChains: [],
      staggerOffset,
      createdWith: pluginVersion(this),
      // The GM layer starts off on a new map (round 6 S7: it was on for a
      // tester who never turned it on). Maps without the key keep the old
      // "on" default, so existing maps don't change.
      showGmLayer: false,
      ...(extra.baseTerrain ? { baseTerrain: extra.baseTerrain } : {}),
      ...(extra.parent ? { parent: extra.parent } : {}),
    });
    await this.saveSettings();

    // Notes on use: a new map writes no hex notes — terrain goes into the
    // map note, and a hex note appears when the hex first gets content.
    const cells = [...(terrainAt ?? new Map<string, string>())]
      .filter(([, t]) => t && t !== extra.baseTerrain)
      .map(([k, t]): [string, { terrain: string }] => [k, { terrain: t }]);
    this.mapStore.setMany(name, cells);
    onProgress?.(cols * rows, cols * rows);
    await this.mapStore.flush();
    if (!extra.quiet) new Notice(`Created map "${displayName ?? name}".`);

    return { name };
  }

  /**
   * Set terrain for specific hexes ("x_y" → terrain). With map notes this
   * writes map data only — hex notes are created when a hex gets content —
   * so it returns 0 notes created. Falls back to creating notes only if the
   * map store isn't ready yet.
   */
  async generateHexNotesAt(
    mapName: string,
    cells: [string, string][],
    onProgress?: (done: number) => void,
  ): Promise<number> {
    if (this.mapStore.isReady()) {
      this.mapStore.setMany(mapName, cells.filter(([, t]) => t).map(([k, t]) => [k, { terrain: t }]));
      onProgress?.(cells.length);
      await this.mapStore.flush();
      return 0;
    }
    const template = await this.loadHexTemplate();
    if (template === null) return 0;
    let created = 0;
    let done = 0;
    const CHUNK = 20;
    for (let i = 0; i < cells.length; i += CHUNK) {
      await Promise.all(
        cells.slice(i, i + CHUNK).map(async ([key, terrain]) => {
          const [x, y] = key.split("_").map(Number);
          if (!this.app.vault.getAbstractFileByPath(this.hexPath(x, y, mapName))) {
            if (await this.createHexNote(x, y, mapName, template, terrain)) created++;
          }
          done++;
        }),
      );
      onProgress?.(done);
    }
    return created;
  }

  async generateHexNotes(
    mapName: string,
    xs: number[],
    ys: number[],
    onProgress?: (done: number) => void,
    terrainAt?: Map<string, string>,
  ): Promise<number> {
    if (this.mapStore.isReady()) {
      const cells: [string, string][] = [];
      for (const x of xs) for (const y of ys) {
        const t = terrainAt?.get(`${x}_${y}`);
        if (t) cells.push([`${x}_${y}`, t]);
      }
      if (cells.length) return this.generateHexNotesAt(mapName, cells);
      onProgress?.(xs.length * ys.length);
      return 0;
    }
    // Read template once — avoids N vault reads for the same file
    const template = await this.loadHexTemplate();
    if (template === null) return 0;

    let created = 0;
    let done = 0;
    const CHUNK = 20;
    const pairs: [number, number][] = [];
    for (const x of xs) for (const y of ys) pairs.push([x, y]);
    for (let i = 0; i < pairs.length; i += CHUNK) {
      await Promise.all(
        pairs.slice(i, i + CHUNK).map(async ([x, y]) => {
          const path = this.hexPath(x, y, mapName);
          if (!this.app.vault.getAbstractFileByPath(path)) {
            const terrain = terrainAt?.get(`${x}_${y}`);
            // createHexNote writes the terrain and its encounter link in one go.
            if (await this.createHexNote(x, y, mapName, template, terrain)) created++;
          }
          done++;
        }),
      );
      onProgress?.(done);
    }
    return created;
  }

  getMap(name: string): MapData | undefined {
    return this.settings.maps.find((r) => r.name === name);
  }

  /** A map's name for the UI: its display name, else its slug (or `name` itself if unknown). */
  mapLabel(name: string): string {
    return mapLabel(this.getMap(name), name);
  }

  /**
   * How a back-link to a hex note reads: the hex's name, else
   * "<map> x, y" (round 6 S2). Paths outside the hex folder fall back to
   * the note's name.
   */
  hexLinkAlias(hexPath: string): string {
    const folder = normalizeFolder(this.settings.hexFolder);
    const rel = folder && hexPath.startsWith(folder + "/") ? hexPath.slice(folder.length + 1) : hexPath;
    const m = /^(.+)\/(-?\d+)_(-?\d+)\.md$/.exec(rel);
    if (!m) return rel.replace(/^.*\//, "").replace(/\.md$/i, "");
    const [, map, x, y] = m;
    const name = this.mapStore.get(map, `${x}_${y}`)?.name?.trim();
    return name || `${this.mapLabel(map)} ${x}, ${y}`;
  }

  /**
   * Rename a map for display only: the folder, map note and every
   * reference keep the slug. Blank (or the slug itself) clears it.
   */
  async setMapDisplayName(name: string, typed: string): Promise<void> {
    const map = this.getMap(name);
    if (!map) return;
    const oldLabel = this.mapLabel(name);
    map.displayName = displayNameFor(typed, name);
    await this.saveSettings();
    await this.syncMapCoordAliases(name, oldLabel);
  }

  getPaletteByName(name: string): TerrainPalette | undefined {
    return this.settings.terrainPalettes.find((p) => p.name === name);
  }

  /**
   * Terrains for an installed palette, or for a built-in preset that isn't
   * installed yet (lets new-map dropdowns preview presets before install).
   */
  getPaletteOrPresetTerrains(name: string): TerrainColor[] {
    return this.getPaletteByName(name)?.terrains ?? getPreset(name)?.terrains ?? [];
  }

  /**
   * Path types maps on this palette can draw, in picker order: the palette's
   * own list (the live array, so editors can change it in place), a preset's
   * when it isn't installed, else the old plugin-wide list or Road and River.
   */
  getPathTypes(paletteName: string | undefined): PathType[] {
    const pal = paletteName ? this.getPaletteByName(paletteName) : this.settings.terrainPalettes[0];
    const fallback = this.settings.pathTypes?.length ? this.settings.pathTypes : DEFAULT_PATH_TYPES;
    if (pal) return (pal.pathTypes ??= clonePathTypes(fallback));
    return (paletteName ? getPreset(paletteName)?.pathTypes : undefined) ?? fallback;
  }

  /** The palette a map actually uses: its own when installed, else the first. */
  mapPaletteName(mapName: string | undefined): string {
    const map = mapName ? this.getMap(mapName) : undefined;
    if (map?.paletteName && this.getPaletteByName(map.paletteName)) return map.paletteName;
    return this.settings.terrainPalettes[0]?.name ?? "";
  }

  /** Path types for a map: its palette's (see getPathTypes). */
  getMapPathTypes(mapName: string | undefined): PathType[] {
    return this.getPathTypes(this.mapPaletteName(mapName));
  }

  /** Maps whose palette is `paletteName` (see mapPaletteName). */
  mapsOnPalette(paletteName: string): MapData[] {
    return this.settings.maps.filter((m) => this.mapPaletteName(m.name) === paletteName);
  }

  /**
   * Add a copy of a built-in preset as a new palette (a unique name is chosen
   * if the preset's name is taken), with the preset's path types. Saves;
   * the palette note is written by the sync that follows. Returns the new
   * palette's name.
   */
  async installPalettePreset(presetName: string, asName?: string): Promise<string | undefined> {
    const preset = getPreset(presetName);
    if (!preset) return undefined;
    const name = uniquePaletteName(
      asName ?? preset.name,
      this.settings.terrainPalettes.map((p) => p.name),
    );
    const palette = presetToPalette(preset, name);
    this.settings.terrainPalettes.push(palette);
    await this.saveSettings();
    // Give the new terrains their description/encounters tables when the
    // vault uses terrain tables, so a submap's hexes get an encounters
    // table like the parent's (round 7: a system map installed "Space -
    // System" and its "ice planet" hex showed Encounters Table "None").
    await this.ensureTablesForNewTerrains();
    new Notice(`Added palette "${name}".`);
    return name;
  }

  /**
   * Palette to pre-select for a new submap of `parentMap`: the parent
   * palette's `childPalette` (its note's `child-palette`; the preset's only
   * while that preset isn't installed), else the parent's own palette, else
   * the palette for new maps. An installed palette is never topped up from
   * a same-named preset: clearing its child palette means none.
   */
  childPaletteFor(parentMap: string): string {
    const parentPaletteName = this.getMap(parentMap)?.paletteName;
    const parentPalette = parentPaletteName ? this.getPaletteByName(parentPaletteName) : undefined;
    const child = parentPalette
      ? parentPalette.childPalette
      : parentPaletteName ? getPreset(parentPaletteName)?.childPalette : undefined;
    if (child && (this.getPaletteByName(child) || getPreset(child))) return child;
    if (parentPalette) return parentPalette.name;
    return defaultPaletteFor(this.settings);
  }

  /**
   * Add `childMap` to the Locations of hex (x, y) on `parentMap` (K7: any
   * number per hex) and record the parent on the child map (first link
   * wins, so linking a shared map from a second hex doesn't move its
   * breadcrumb).
   */
  async linkSubmap(parentMap: string, x: number, y: number, childMap: string): Promise<void> {
    if (childMap === parentMap) return;
    const key = `${x}_${y}`;
    const patch = addLocationPatch(this.mapStore.get(parentMap, key), childMap);
    if (patch.locations && !this.mapStore.set(parentMap, key, patch, "link-map")) return;
    this.noParentMaps.clear();
    const child = this.getMap(childMap);
    if (child && !child.parent) {
      child.parent = { map: parentMap, hex: key };
      child.submapKind = "location";
      await this.saveSettings();
    }
  }

  /**
   * Make `childMap` the Region map of hex (x, y) on `parentMap`: the child
   * becomes a region of it (its record is the truth; the hex mirrors it).
   * Refused when the hex already has another region (one per hex).
   */
  async linkRegion(parentMap: string, x: number, y: number, childMap: string): Promise<boolean> {
    const key = `${x}_${y}`;
    const other = regionMapAt(this.settings.maps, parentMap, key);
    if (childMap === parentMap || (other && other.name !== childMap)) return false;
    const child = this.getMap(childMap);
    if (!child) return false;
    child.parent = { map: parentMap, hex: key };
    child.submapKind = "region";
    this.mapStore.set(parentMap, key, setRegionPatch(this.mapStore.get(parentMap, key), childMap));
    this.noParentMaps.clear();
    await this.saveSettings();
    return true;
  }

  /**
   * Unlink `childMap` (or, without one, every map) from hex (x, y): its
   * region and/or locations. A child whose parent was this hex loses it.
   */
  async unlinkSubmap(parentMap: string, x: number, y: number, childMap?: string): Promise<void> {
    const key = `${x}_${y}`;
    const h = this.mapStore.get(parentMap, key);
    const names = childMap ? [childMap] : hexChildMaps(h);
    let changed = false;
    for (const n of names) {
      const patch = removeMapPatch(this.mapStore.get(parentMap, key), n);
      if (Object.keys(patch).length && !this.mapStore.set(parentMap, key, patch, "link-map")) continue;
      const child = this.getMap(n);
      if (child?.parent?.map === parentMap && child.parent.hex === key) {
        delete child.parent;
        // A region without its hex is just a map (it keeps its world slot).
        delete child.submapKind;
        changed = true;
      }
    }
    this.noParentMaps.clear();
    if (changed) await this.saveSettings();
  }

  /** Reorder the Locations of hex (x, y). */
  setHexLocations(parentMap: string, x: number, y: number, locations: string[]): void {
    this.mapStore.set(parentMap, `${x}_${y}`, { locations: locations.length ? locations : null }, "link-map");
  }

  /** Save region settings on `mapName` (fixed fields stay put while it has regions). */
  async setRegionSettings(mapName: string, next: RegionSettings): Promise<void> {
    const map = this.getMap(mapName);
    if (!map) return;
    const locked = regionsLocked(this.settings.maps, mapName);
    map.regions = map.regions ? applyRegionSettingsEdit(map.regions, next, locked) : next;
    await this.saveSettings();
  }

  /**
   * The map `mapName` was opened from (as a region or location). Uses the
   * stored parent; for maps linked before parents were stored, scans the
   * hexes' Region map and Locations for it and remembers the first hit.
   */
  parentOf(mapName: string): { map: string; hex: string } | undefined {
    const map = this.getMap(mapName);
    if (!map) return undefined;
    if (map.parent && this.getMap(map.parent.map)) return map.parent;
    // Root maps have no parent; don't rescan the hex notes on every switch.
    if (this.noParentMaps.has(mapName)) return undefined;
    for (const m of this.settings.maps) {
      if (m.name === mapName) continue;
      for (const [key, h] of this.mapStore.all(m.name)) {
        if (h.regionMap !== mapName && !h.locations?.includes(mapName)) continue;
        map.parent = { map: m.name, hex: key };
        void this.saveSettings();
        return map.parent;
      }
    }
    this.noParentMaps.add(mapName);
    return undefined;
  }

  /** Maps whose parent scan came up empty this session (cleared on any link change). */
  private noParentMaps = new Set<string>();

  /**
   * Saved setup for a new submap made from a `terrain` hex on `parentMap`:
   * the parent palette's Submap defaults row for that terrain (from its
   * note). Only a preset that isn't installed answers from its own rows;
   * palettes installed before their preset gained defaults got the rows
   * copied in once (PaletteStore, `paletteDataUpgraded`), so a row the user
   * deletes stays deleted.
   */
  submapDefaultFor(parentMap: string, terrain: string | null | undefined): SubmapDefault | undefined {
    if (!terrain) return undefined;
    const paletteName = this.getMap(parentMap)?.paletteName;
    if (!paletteName) return undefined;
    const pal = this.getPaletteByName(paletteName);
    if (pal) return pal.submapDefaults?.[terrain];
    return getPreset(paletteName)?.submapDefaults?.[terrain];
  }

  /**
   * Remember (or forget) choices for new submaps of `terrain` on the parent
   * map's palette. `set` fields are stored; `clear` fields are removed.
   * Saved into the palette note's Submap defaults table by the sync.
   */
  async saveSubmapDefault(
    parentMap: string,
    terrain: string,
    set: SubmapDefault,
    clear: (keyof SubmapDefault)[],
  ): Promise<void> {
    const paletteName = this.getMap(parentMap)?.paletteName;
    const pal = paletteName ? this.getPaletteByName(paletteName) : undefined;
    if (!pal) return;
    // Start from what the user currently sees (see submapDefaultFor).
    const current: SubmapDefault = { ...(this.submapDefaultFor(parentMap, terrain) ?? {}) };
    for (const k of clear) delete current[k];
    Object.assign(current, set);
    const defaults = { ...(pal.submapDefaults ?? {}) };
    if (Object.keys(current).length) defaults[terrain] = current;
    else delete defaults[terrain];
    if (Object.keys(defaults).length) pal.submapDefaults = defaults;
    else delete pal.submapDefaults;
    await this.saveSettings();
  }

  /** Install `name` from the presets if no palette by that name exists yet. */
  async ensurePaletteInstalled(name: string): Promise<void> {
    if (this.getPaletteByName(name) || !getPreset(name)) return;
    await this.installPalettePreset(name);
  }

  getMapPalette(mapName: string): TerrainColor[] {
    const map = this.getMap(mapName);
    return (
      this.getPaletteByName(map?.paletteName ?? "")?.terrains ??
      this.settings.terrainPalettes[0]?.terrains ??
      []
    );
  }

  /**
   * Is `mapName` in space: its palette, or any ancestor map's (a planet
   * submap of a star system), is a space palette? Space generators are
   * offered there even when the Space map type is off.
   */
  isSpaceMap(mapName: string): boolean {
    const chain = [...mapAncestors(mapName, (m) => this.parentOf(m)?.map), mapName];
    return chain.some((m) => {
      const paletteName = this.getMap(m)?.paletteName;
      return !!paletteName && isSpacePalette(this.getPaletteOrPresetTerrains(paletteName));
    });
  }

  /**
   * Display words for link sections on `mapName` (G4b): its map type's
   * (space maps say Settlements, Sites…), from the palettes of the map and
   * its parents. Headings in notes don't change. No map = the usual words.
   */
  sectionWordsFor(mapName: string | undefined): SectionWordsFn {
    if (!mapName || !this.getMap(mapName)) return sectionWordsFor(undefined);
    const chain = [mapName, ...mapAncestors(mapName, (m) => this.parentOf(m)?.map).reverse()];
    const terrains = chain.map((m) => {
      const paletteName = this.getMap(m)?.paletteName;
      return paletteName ? this.getPaletteOrPresetTerrains(paletteName) : [];
    });
    return sectionWordsFor(sectionKindFor(terrains));
  }

  getAllTerrains(): TerrainColor[] {
    const seen = new Set<string>();
    const result: TerrainColor[] = [];
    for (const pal of this.settings.terrainPalettes) {
      for (const t of pal.terrains) {
        if (!seen.has(t.name)) {
          seen.add(t.name);
          result.push(t);
        }
      }
    }
    return result;
  }

  getOrCreateMap(name: string): MapData {
    let r = this.getMap(name);
    if (!r) {
      r = {
        name,
        paletteName: defaultPaletteFor(this.settings),
        gridSize: { cols: 20, rows: 16 },
        gridOffset: { x: 0, y: 0 },
        pathChains: [],
      };
      this.settings.maps.push(r);
    }
    return r;
  }

  private async migrateHexFilesToDefaultRegion(): Promise<void> {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    if (!hexFolder) return;

    // Scan first — only create the destination folder if there are actually
    // files to move. On a fresh install the scan returns nothing and we return
    // early, avoiding spurious folder creation before setup is complete.
    const candidates = this.app.vault.getMarkdownFiles().filter((f) => {
      const parent = f.parent?.path ?? "";
      return parent === hexFolder && /^-?\d+_-?\d+$/.test(f.basename);
    });
    if (candidates.length === 0) return;

    const defaultFolder = `${hexFolder}/default`;
    if (!this.app.vault.getAbstractFileByPath(defaultFolder)) {
      try {
        await this.app.vault.createFolder(defaultFolder);
      } catch {
        /* exists */
      }
    }
    let moved = 0;
    for (const file of candidates) {
      const newPath = `${defaultFolder}/${file.name}`;
      if (!this.app.vault.getAbstractFileByPath(newPath)) {
        try {
          await this.app.fileManager.renameFile(file, newPath);
          moved++;
        } catch {
          /* skip */
        }
      }
    }
    if (moved > 0)
      new Notice(
        `Hexmap World Creator: migrated ${moved} hex file(s) to "default" region.`,
      );
  }
}

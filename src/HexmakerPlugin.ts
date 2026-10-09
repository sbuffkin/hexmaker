import { Editor, EventRef, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  exportSingleNoteAsPdf,
  exportSingleNoteAsMarkdown,
} from "./export/exporters/singleNote";
import { HexExportModal } from "./hex-map/HexExportModal";
import { WorkflowExportModal } from "./random-tables/WorkflowExportModal";
import { HexMapView } from "./hex-map/HexMapView";
import { HexTableView } from "./hex-table/HexTableView";
import { RandomTableView } from "./random-tables/RandomTableView";
import { HexmakerSettingTab } from "./HexmakerSettingTab";
import { registerRollerBlock } from "./random-tables/RollerBlock";
import { FileLinkSuggestModal } from "./hex-map/FileLinkSuggestModal";
import { MapLinkModal } from "./hex-map/MapLinkModal";
import {
  DEFAULT_PALETTE_NAME,
  DEFAULT_SETTINGS,
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
  VIEW_TYPE_SETUP_WIZARD,
  VIEW_TYPE_GENERATOR,
  VIEW_TYPE_PALETTE_EDITOR,
} from "./constants";
import { SetupWizardView } from "./SetupWizardView";
import { PaletteStore } from "./palettes/PaletteStore";
import { PaletteEditorView } from "./palettes/PaletteEditorView";
import { isIconHiddenByKind, isSpacePalette, resolveMapKinds } from "./mapKinds";
import { mapAncestors } from "./hex-map/submapNav";
import {
  getPreset,
  mergePathTypes,
  presetToPalette,
  uniquePaletteName,
} from "./palettes/presets";
import { normalizeFolder, makeTableTemplate, slugify } from "./utils";
import { BUNDLED_ICONS } from "./bundledIcons";
import { parseWorkflow, buildWorkflowContent } from "./random-tables/workflow";
import type {
  HexmakerPluginSettings,
  MapData,
  SubmapDefault,
  TerrainColor,
  TerrainPalette,
} from "./types";
import DEFAULT_HEX_TEMPLATE from "./defaultHexTemplate.md";
import { migrateMapData, pluginVersion } from "./compat";
import { getTerrainFromFile, setTerrainInFile, setSubmapInFile, withFrontmatterField, notePendingTerrain, clearPendingTerrain } from "./frontmatter";
import {
  addLinkToSection,
  getLinksInSection,
  removeLinkFromSection,
  insertLinkInSection,
} from "./sections";
import { GeneratorView } from "./worldgen/GeneratorView";
import { GeneratorPanel } from "./worldgen/GeneratorPanel";
export default class HexmakerPlugin extends Plugin {
  settings: HexmakerPluginSettings;
  availableIcons: string[] = [];
  vaultIconsSet: Set<string> = new Set();
  paletteStore = new PaletteStore(this);

  async onload() {
    await this.loadSettings();
    // Notes written by this plugin are read from memory until indexed (see frontmatter.ts).
    this.registerEvent(this.app.metadataCache.on("changed", (file) => clearPendingTerrain(file.path)));
    // Defer until vault metadata cache is ready; calling before layout-ready
    // returns null for all vault paths so custom icons are silently dropped.
    this.app.workspace.onLayoutReady(() => {
      this.loadAvailableIcons();
      void this.paletteStore.init();
      void this.autoRegisterMapsFromVault();
      if (!this.settings.setupComplete && !this.settings.setupDismissed) {
        this.openSetupWizard();
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
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (isIconFile(f.path)) this.loadAvailableIcons();
        this.paletteStore.onDelete(f);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (isIconFile(f.path) || isIconFile(oldPath)) this.loadAvailableIcons();
        this.paletteStore.onRename(f, oldPath);
      }),
    );
    // Palette notes edited by hand (or by sync) flow back into the palettes.
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.paletteStore.onModify(f)),
    );

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
    this.addRibbonIcon("map", "Hexmaker: open hex map", () =>
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
      id: "open-random-tables",
      name: "Open random tables",
      callback: () =>
        void this.app.workspace
          .getLeaf()
          .setViewState({ type: VIEW_TYPE_RANDOM_TABLES }),
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
        void this.app.workspace.revealLeaf(leaves[0]);
        (leaves[0].view as HexMapView).navigateToMap(mapName);
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
            return buildWorkflowContent(workflow);
          });
        }
      }),
    );
  }

  onunload() {
    clearPendingTerrain();
  }

  private openHexMap(): void {
    void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_MAP });
  }

  /**
   * Open the terrain generator page (or bring it forward), optionally with a
   * region and generator selected.
   */
  async openTerrainGenerator(select: { mapName?: string; generatorPath?: string; paletteName?: string } = {}): Promise<void> {
    if (select.mapName) GeneratorPanel.mapName = select.mapName;
    if (select.paletteName) GeneratorPanel.paletteName = select.paletteName;
    if (select.generatorPath) GeneratorPanel.selectedPath = select.generatorPath;
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      (existing.view as GeneratorView).refresh();
      return;
    }
    await this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_GENERATOR, active: true });
  }

  /** Show a map in the hex map view, opening the view if it isn't open. */
  async showMap(name: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    (leaf.view as HexMapView).switchMapFromModal(name);
  }

  openSetupWizard(): void {
    void this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_SETUP_WIZARD });
  }

  async loadSettings() {
    // One-time migration: rename settings keys "regions" → "maps" and "defaultRegion" → "defaultMap"
    // Must run on raw data BEFORE Object.assign so the migrated key wins over DEFAULT_SETTINGS.
    const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    if (data["regions"] !== undefined && data["maps"] === undefined) {
      data["maps"] = data["regions"];
    }
    delete data["regions"];
    if (data["defaultRegion"] !== undefined && data["defaultMap"] === undefined) {
      data["defaultMap"] = data["defaultRegion"];
    }
    delete data["defaultRegion"];

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<HexmakerPluginSettings>);

    // Deep-clone the maps array so mutations to settings.maps never alias DEFAULT_SETTINGS.maps.
    // Object.assign does a shallow copy, so on first run (data===null) settings.maps IS
    // DEFAULT_SETTINGS.maps – pushing/mutating it would corrupt the constant for the session.
    this.settings.maps = Array.isArray(this.settings.maps)
      ? this.settings.maps
      : [];

    this.settings.maps = this.settings.maps.map((r) => migrateMapData(r, DEFAULT_PALETTE_NAME));
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
  }

  async saveSettings() {
    this.settings.savedWith = pluginVersion(this);
    await this.saveData(this.settings);
    // Mirror palette edits (from any editor) into the palette notes.
    void this.paletteStore.sync();
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
    await this.loadSettings();
    // data.json carries a cached copy of the palettes; the notes win.
    await this.paletteStore.reload();
    this.loadAvailableIcons();
    this.refreshHexMap();
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach((leaf) => {
      void (leaf.view as HexTableView).loadTable();
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
  onMapKindsChanged(): void {
    this.loadAvailableIcons();
    this.refreshPaletteEditors();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)) {
      if (leaf.view instanceof GeneratorView) leaf.view.refresh();
    }
  }

  refreshHexMap(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach((leaf) => {
      (leaf.view as HexMapView).renderGrid();
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
    const rest = all.filter((i) => !order.includes(i)).sort();
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
      `Hexmaker: auto-registered ${added.length} map${added.length > 1 ? "s" : ""} from vault: ${added.join(", ")}`,
    );
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

  /** Update duckmage-submap frontmatter in all hex notes when a map is renamed. */
  async updateSubmapReferences(oldName: string, newName: string): Promise<void> {
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => !hexFolder || f.path.startsWith(hexFolder + "/"),
    );
    for (const file of files) {
      const submap: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.["duckmage-submap"];
      if (submap !== oldName) continue;
      await setSubmapInFile(this.app, file.path, newName);
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

  /** Add a roller link to a table file if it doesn't already have one. */
  async ensureRollerLink(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;
    const link = this.buildRollerLink();
    await this.app.vault.process(file, (content) => {
      if (content.includes("obsidian://duckmage-roll") || content.includes("```duckmage-roller")) return content;
      const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
      const insertAt = fmMatch ? fmMatch[0].length : 0;
      return (
        content.slice(0, insertAt) +
        "\n" +
        link +
        "\n\n" +
        content.slice(insertAt)
      );
    });
  }

  /** Add roller blocks to all existing table files in the tables folder that don't have one. */
  async ensureAllRollerLinks(): Promise<void> {
    const folder = normalizeFolder(this.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !prefix || f.path.startsWith(prefix));

    let count = 0;
    for (const file of files) {
      let added = false;
      const link = this.buildRollerLink();
      await this.app.vault.process(file, (content) => {
        if (content.includes("obsidian://duckmage-roll") || content.includes("```duckmage-roller")) return content;
        added = true;
        const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
        const insertAt = fmMatch ? fmMatch[0].length : 0;
        return (
          content.slice(0, insertAt) +
          "\n" +
          link +
          "\n\n" +
          content.slice(insertAt)
        );
      });
      if (added) count++;
    }
    new Notice(
      `Hexmaker: added roller links to ${count} table${count !== 1 ? "s" : ""}.`,
    );
  }

  /** Create missing description/encounters table files for every terrain type in the palette. */
  async ensureTerrainTables(): Promise<void> {
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
    for (const entry of this.getAllTerrains()) {
      for (const tableType of ["description", "encounters"] as const) {
        const path = `${subfolder}/${tableType}/${entry.name}.md`;
        if (!this.app.vault.getAbstractFileByPath(path)) {
          try {
            await this.app.vault.create(
              path,
              makeTableTemplate(
                this.settings.defaultTableDice,
                {
                  terrain: entry.name,
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
      `Hexmaker: linked encounters tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
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

  async syncHexEncounterTableLink(
    hexFilePath: string,
    terrain: string | null,
  ): Promise<void> {
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
      `Hexmaker: refreshed encounter links for ${hexFiles.length} hex${hexFiles.length !== 1 ? "es" : ""}.`,
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
      const cache = this.app.metadataCache.getFileCache(file);
      const region: unknown = cache?.frontmatter?.["region"];
      if (typeof region !== "string" || !region) continue;
      await this.syncHexRegionTableLink(file.path, region);
      linked++;
    }

    new Notice(
      `Hexmaker: linked region encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
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
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    const candidates = this.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });
    const overrides = new Map<string, string>();
    const CHUNK = 10;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      await Promise.all(
        candidates.slice(i, i + CHUNK).map(async (f) => {
          // Read raw content — don't trust the stale metadata cache
          const content = await this.app.vault.read(f);
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (!fmMatch) return;
          const terrainLine = fmMatch[1].match(/^\s*terrain:\s*(.+)$/m);
          if (!terrainLine || terrainLine[1].trim() !== oldName) return;
          await setTerrainInFile(this.app, f.path, newName);
          overrides.set(f.path, newName);
        }),
      );
    }
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
    await this.renameTerrainTables(oldName, newName);
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

  private async renameTerrainTables(oldName: string, newName: string): Promise<void> {
    for (const type of ["description", "encounters"] as const) {
      const oldPath = this.terrainTablePath(oldName, type);
      const newPath = this.terrainTablePath(newName, type);
      // Don't overwrite if the new terrain already has its own tables
      if (this.app.vault.getAbstractFileByPath(newPath)) continue;
      const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (!(oldFile instanceof TFile)) continue;
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
      (leaf.view as HexMapView).renderGrid(terrainOverrides);
    });
  }

  /** Update terrain filter sets in all open hex table views after a rename. */
  refreshHexTableTerrainRename(oldName: string, newName: string): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach((leaf) => {
      (leaf.view as HexTableView).renameTerrainInFilters(oldName, newName);
    });
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
      .replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`);
    if (terrain) {
      content = withFrontmatterField(content, "terrain", terrain);
      // Add the terrain's encounter-table link now rather than reading the
      // note back and rewriting it after it's created.
      const table = this.terrainEncounterTable(terrain);
      if (table) {
        const linkText = `[[${this.app.metadataCache.fileToLinktext(table, path)}]]`;
        content = insertLinkInSection(content, "Encounters Table", linkText);
      }
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
      if (terrain) notePendingTerrain(path, terrain);
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

  /** Read the hex template once (used by bulk generation to avoid N redundant reads). */
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
    }
    return DEFAULT_HEX_TEMPLATE;
  }

  /**
   * Ensure a hex template file exists on disk.
   * - If templatePath is set and the file exists: no-op.
   * - If templatePath is set but the file is missing: create it from the built-in default.
   * - If templatePath is blank: create at {worldFolder}/hextemplate.md and persist the path.
   */
  async ensureHexTemplate(): Promise<void> {
    let templatePath = normalizeFolder(this.settings.templatePath ?? "");
    if (!templatePath) {
      const world = normalizeFolder(this.settings.worldFolder) || "world";
      templatePath = `${world}/hextemplate.md`;
      this.settings.templatePath = templatePath;
      await this.saveSettings();
    }
    if (!this.app.vault.getAbstractFileByPath(templatePath)) {
      try {
        await this.app.vault.create(templatePath, DEFAULT_HEX_TEMPLATE);
      } catch {
        /* created concurrently — fine */
      }
    }
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
      /** Terrain shown on unpainted hexes. When set, hex notes are created
       *  on use: only hexes that get a terrain other than the base get a
       *  note now; the rest appear when clicked, painted, or linked. */
      baseTerrain?: string;
      parent?: { map: string; hex: string };
      /** Silence the "generated N notes" notice (caller reports instead). */
      quiet?: boolean;
    } = {},
  ): Promise<{ name: string } | { error: string }> {
    const name = slugify(rawName);
    if (!name) return { error: "Enter a map name." };
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

    this.settings.maps.push({
      name,
      paletteName,
      gridSize: { cols, rows },
      gridOffset: { x: initialX, y: initialY },
      pathChains: [],
      staggerOffset,
      createdWith: pluginVersion(this),
      ...(extra.baseTerrain ? { baseTerrain: extra.baseTerrain } : {}),
      ...(extra.parent ? { parent: extra.parent } : {}),
    });
    await this.saveSettings();

    let created: number;
    if (extra.baseTerrain) {
      // Notes on use: write only hexes that differ from the base terrain.
      const painted = [...(terrainAt ?? new Map<string, string>())]
        .filter(([, t]) => t && t !== extra.baseTerrain);
      created = await this.generateHexNotesAt(name, painted, (done) => onProgress?.(done, painted.length));
    } else {
      const xs = Array.from({ length: cols }, (_, i) => i + initialX);
      const ys = Array.from({ length: rows }, (_, i) => i + initialY);
      const total = cols * rows;
      created = await this.generateHexNotes(
        name,
        xs,
        ys,
        (done) => onProgress?.(done, total),
        terrainAt,
      );
    }
    if (created > 0 && !extra.quiet)
      new Notice(
        `Hexmaker: generated ${created} hex note${created !== 1 ? "s" : ""} for "${name}".`,
      );

    return { name };
  }

  /** Create notes for specific hexes ("x_y" → terrain), skipping ones that exist. */
  async generateHexNotesAt(
    mapName: string,
    cells: [string, string][],
    onProgress?: (done: number) => void,
  ): Promise<number> {
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
   * Add a copy of a built-in preset as a new palette (a unique name is chosen
   * if the preset's name is taken) and merge the preset's path types. Saves;
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
    this.settings.terrainPalettes.push(presetToPalette(preset, name));
    const added = mergePathTypes(this.settings.pathTypes, preset.pathTypes);
    await this.saveSettings();
    new Notice(
      `Hexmaker: added palette "${name}"` +
        (added.length ? ` and path types ${added.join(", ")}.` : "."),
    );
    return name;
  }

  /**
   * Palette to pre-select for a new submap of `parentMap`: the parent
   * palette's `childPalette` (installed or a preset), else the parent's own
   * palette, else the first palette.
   */
  childPaletteFor(parentMap: string): string {
    const parentPaletteName = this.getMap(parentMap)?.paletteName;
    const parentPalette = parentPaletteName ? this.getPaletteByName(parentPaletteName) : undefined;
    const child = parentPalette?.childPalette ?? (parentPaletteName ? getPreset(parentPaletteName)?.childPalette : undefined);
    if (child && (this.getPaletteByName(child) || getPreset(child))) return child;
    if (parentPalette) return parentPalette.name;
    return this.settings.terrainPalettes[0]?.name ?? DEFAULT_PALETTE_NAME;
  }

  /**
   * Link hex (x, y) of `parentMap` to `childMap` as its submap: creates the
   * hex note if needed, writes `duckmage-submap`, and records the parent on
   * the child map (first link wins, so re-linking a shared submap from a
   * second hex doesn't move its breadcrumb).
   */
  async linkSubmap(parentMap: string, x: number, y: number, childMap: string): Promise<void> {
    const hexPath = this.hexPath(x, y, parentMap);
    if (!this.app.vault.getAbstractFileByPath(hexPath)) {
      await this.createHexNote(x, y, parentMap);
    }
    await setSubmapInFile(this.app, hexPath, childMap);
    this.noParentMaps.clear();
    const child = this.getMap(childMap);
    if (child && !child.parent && childMap !== parentMap) {
      child.parent = { map: parentMap, hex: `${x}_${y}` };
      await this.saveSettings();
    }
  }

  /** Remove the submap link from hex (x, y); clears the child's parent if it pointed here. */
  async unlinkSubmap(parentMap: string, x: number, y: number): Promise<void> {
    const hexPath = this.hexPath(x, y, parentMap);
    const fm: unknown = this.app.metadataCache.getCache(hexPath)?.frontmatter?.["duckmage-submap"];
    await setSubmapInFile(this.app, hexPath, null);
    this.noParentMaps.clear();
    const child = typeof fm === "string" ? this.getMap(fm) : undefined;
    if (child?.parent?.map === parentMap && child.parent.hex === `${x}_${y}`) {
      delete child.parent;
      await this.saveSettings();
    }
  }

  /**
   * The map `mapName` was opened from as a submap. Uses the stored parent;
   * for maps linked before parents were stored, scans hex notes for a
   * `duckmage-submap` pointing here and remembers the first hit.
   */
  parentOf(mapName: string): { map: string; hex: string } | undefined {
    const map = this.getMap(mapName);
    if (!map) return undefined;
    if (map.parent && this.getMap(map.parent.map)) return map.parent;
    // Root maps have no parent; don't rescan the hex notes on every switch.
    if (this.noParentMaps.has(mapName)) return undefined;
    const hexFolder = normalizeFolder(this.settings.hexFolder);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (hexFolder && !file.path.startsWith(hexFolder + "/")) continue;
      const submap: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.["duckmage-submap"];
      if (submap !== mapName) continue;
      const parentMap = file.parent?.name;
      if (!parentMap || parentMap === mapName || !this.getMap(parentMap)) continue;
      map.parent = { map: parentMap, hex: file.basename };
      void this.saveSettings();
      return map.parent;
    }
    this.noParentMaps.add(mapName);
    return undefined;
  }

  /** Maps whose parent scan came up empty this session (cleared on any link change). */
  private noParentMaps = new Set<string>();

  /**
   * Saved setup for a new submap made from a `terrain` hex on `parentMap`:
   * the parent palette's Submap defaults row for that terrain (from its
   * note), else the matching preset's row (palettes installed before the
   * preset gained defaults still get them).
   */
  submapDefaultFor(parentMap: string, terrain: string | null | undefined): SubmapDefault | undefined {
    if (!terrain) return undefined;
    const paletteName = this.getMap(parentMap)?.paletteName;
    if (!paletteName) return undefined;
    const own = this.getPaletteByName(paletteName)?.submapDefaults?.[terrain];
    if (own) return own;
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
    // Start from what the user currently sees (own row, else the preset row).
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
        paletteName: DEFAULT_PALETTE_NAME,
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
        `Hexmaker: migrated ${moved} hex file(s) to "default" region.`,
      );
  }
}

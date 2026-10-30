/**
 * The map view's shell (L2b, split out of HexMapView.onOpen): the view's
 * keyboard shortcuts, the top bar (view buttons, map nav group, undo / redo,
 * help), the two side panels, and the workspace / metadata-cache / store
 * listeners that keep an open map current. The view's onOpen calls these in
 * its original order; the DOM, text and listeners are the same.
 */
import type { App, Component, Scope, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { normalizeFolder } from "../../utils";
import { VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES } from "../../constants";
import { HexHelpModal } from "../HexHelpModal";
import { DrawingToolPanel, OverlayPanel } from "../HexSidePanel";
import { hexKeyFromBasename } from "../linkBadges";
import type { MapData, TokenEntry } from "../../types";
// World maps through the view, typed only.
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { OverworldLayer } from "../../overworld/overworldLayer";
import type { PainterContextMenu } from "../PainterContextMenu";
import type { PathTool } from "../pathTool";
import type { DrawingMode } from "../toolMode";
import type { MapToolbar } from "./mapToolbar";
import type { UndoController } from "./undoController";
import type { MapNavigation } from "./mapNavigation";
import type { TokenLayer } from "./tokenLayer";
import type { AreaOverlay } from "./areaOverlay";
import type { PathOverlay } from "./pathOverlay";
import type { GridLabels } from "./gridLabels";
import type { GridRenderer } from "./gridRenderer";

export interface MapShellHost extends Pick<Component, "registerEvent" | "register"> {
  plugin: HexmakerPlugin;
  leaf: WorkspaceLeaf;
  /** The view's keymap scope (made in onOpen). */
  scope(): Scope;
  viewportEl(): HTMLElement | null;
  activeMapName(): string;
  getActiveMap(): MapData;
  wm(): WorldMapsApi | undefined;
  overworldLayer(): OverworldLayer | undefined;
  drawingMode(): DrawingMode | null;
  isErasingMode(): boolean;
  activeParty(): TokenEntry | undefined;
  pathTool: Pick<PathTool, "escape" | "deleteKey">;
  toolbar: Pick<MapToolbar, "painterMenu" | "modeBarEl" | "exitPathMode" | "buildDrawingToolbarContent">;
  undos: Pick<UndoController, "updateUndoButton" | "strokePins" | "currentTerrainStroke">;
  nav: Pick<MapNavigation, "crumbsEl" | "navArrowsEl" | "sideCrumbsEl" | "arrivalBarEl" | "refreshMapNav">;
  tokens: Pick<TokenLayer, "selectParty" | "updateTokenLayer" | "tokenEntries">;
  areas: Pick<AreaOverlay, "cacheUpdated" | "updateFactionOverlay" | "clearFactionOverlay" | "updateRegionOverlay" | "clearRegionOverlay">;
  pathLayer: Pick<PathOverlay, "updateGmIcons">;
  labels: Pick<GridLabels, "refreshTerrainLegend" | "renderLinkBadges" | "drawHexNames" | "scheduleLinkBadges" | "scheduleTerrainLegend" | "scheduleHexNames">;
  grid: Pick<GridRenderer, "measuring" | "shownTerrain" | "requestTerrainSync">;
  undo(): Promise<void>;
  redo(): Promise<void>;
  navigateUp(): boolean;
  navigateBack(): boolean;
  navigateForward(): boolean;
  exitCurrentMode(): void;
  exitTerrainMode(): void;
  /** Open the Maps dialog on the view; `onChanged` runs when it changed something. */
  openMapModal(onChanged: () => void): void;
  /** The work-mode button, in the map nav group after the map button. */
  buildWorkModeBtn(group: HTMLElement): void;
  refreshViewHeader(): void;
  markStaleFromExternal(): void;
  onOverworldDataChange(map: string): void;
  renderGrid(): void;
}

export class MapShell {
  mapBtn: HTMLButtonElement | null = null;
  undoBtn: HTMLButtonElement | null = null;
  redoBtn: HTMLButtonElement | null = null;
  /** Toolbar rows (and the mode bar) along the top of the map: hexes are
   *  kept out from under them (see safeArea.ts). */
  topBandEls: HTMLElement[] = [];
  overlayPanel: OverlayPanel | null = null;
  toolsPanel: DrawingToolPanel | null = null;
  /** Set when another view/window mutated shared state while this view was
   *  inactive; consumed by a re-render on next activation (issue #32). */
  needsRerender = false;

  constructor(private host: MapShellHost) {}

  // The view's state, read live (the bodies below read it as `this.…`).
  private get plugin(): HexmakerPlugin { return this.host.plugin; }
  private get app(): App { return this.host.plugin.app; }
  private get leaf(): WorkspaceLeaf { return this.host.leaf; }
  private get scope(): Scope { return this.host.scope(); }
  private get viewportEl(): HTMLElement | null { return this.host.viewportEl(); }
  private get activeMapName(): string { return this.host.activeMapName(); }
  private get wm(): WorldMapsApi | undefined { return this.host.wm(); }
  private get overworldLayer(): OverworldLayer | undefined { return this.host.overworldLayer(); }
  private get drawingMode(): DrawingMode | null { return this.host.drawingMode(); }
  private get isErasingMode(): boolean { return this.host.isErasingMode(); }
  private get painterMenu(): PainterContextMenu | null { return this.host.toolbar.painterMenu; }
  private get modeBarEl(): HTMLElement | null { return this.host.toolbar.modeBarEl; }
  private get pathTool(): MapShellHost["pathTool"] { return this.host.pathTool; }
  private get toolbar(): MapShellHost["toolbar"] { return this.host.toolbar; }
  private get undos(): MapShellHost["undos"] { return this.host.undos; }
  private get nav(): MapShellHost["nav"] { return this.host.nav; }
  private get tokens(): MapShellHost["tokens"] { return this.host.tokens; }
  private get areas(): MapShellHost["areas"] { return this.host.areas; }
  private get pathLayer(): MapShellHost["pathLayer"] { return this.host.pathLayer; }
  private get labels(): MapShellHost["labels"] { return this.host.labels; }
  private get grid(): MapShellHost["grid"] { return this.host.grid; }
  private getActiveMap(): MapData { return this.host.getActiveMap(); }
  private activeParty(): TokenEntry | undefined { return this.host.activeParty(); }
  private undo(): Promise<void> { return this.host.undo(); }
  private redo(): Promise<void> { return this.host.redo(); }
  private navigateUp(): boolean { return this.host.navigateUp(); }
  private navigateBack(): boolean { return this.host.navigateBack(); }
  private navigateForward(): boolean { return this.host.navigateForward(); }
  private exitCurrentMode(): void { this.host.exitCurrentMode(); }
  private exitTerrainMode(): void { this.host.exitTerrainMode(); }
  private refreshViewHeader(): void { this.host.refreshViewHeader(); }
  private markStaleFromExternal(): void { this.host.markStaleFromExternal(); }
  private onOverworldDataChange(map: string): void { this.host.onOverworldDataChange(map); }
  private renderGrid(): void { this.host.renderGrid(); }
  private registerEvent(ref: Parameters<Component["registerEvent"]>[0]): void { this.host.registerEvent(ref); }
  private register(cb: Parameters<Component["register"]>[0]): void { this.host.register(cb); }

  updateMapBtnLabel(): void {
    this.mapBtn?.setText(`${this.plugin.mapLabel(this.activeMapName)} ▾`);
  }

  /**
   * View-scoped Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) via the
   * view's keymap Scope: Obsidian activates it only while this view is
   * active, in whichever window hosts it — unlike a document-level keydown
   * registered against onOpen-time `activeDocument`, which goes stale when
   * the tab is moved to a popout window (issue #32). Plus Alt+arrows.
   */
  registerUndoNavKeys(): void {
    this.scope.register(["Mod"], "z", (e: KeyboardEvent) => {
      e.preventDefault();
      void this.undo();
      return false;
    });
    this.scope.register(["Mod", "Shift"], "z", (e: KeyboardEvent) => {
      e.preventDefault();
      void this.redo();
      return false;
    });
    // Submap navigation: Alt+↑ up to the parent map, Alt+← back.
    this.scope.register(["Alt"], "ArrowUp", (e: KeyboardEvent) => {
      if (!this.navigateUp()) return;
      e.preventDefault();
      return false;
    });
    this.scope.register(["Alt"], "ArrowLeft", (e: KeyboardEvent) => {
      if (!this.navigateBack()) return;
      e.preventDefault();
      return false;
    });
    this.scope.register(["Alt"], "ArrowRight", (e: KeyboardEvent) => {
      if (!this.navigateForward()) return;
      e.preventDefault();
      return false;
    });
  }

  /** Esc and Backspace / Delete for the active tool. */
  registerToolKeys(): void {
    // Esc leaves the active tool (modals and menus handle their own Esc first).
    this.scope.register([], "Escape", () => {
      // An open tool menu takes the first Esc (Obsidian's keymap sees the
      // key before the menu's own listener would).
      if (this.painterMenu?.isOpen()) {
        this.painterMenu.close();
        return false;
      }
      if (this.drawingMode === null) {
        // Esc lets go of a selected party token (SF5).
        if (this.activeParty()) { this.tokens.selectParty(null); return false; }
        return true;
      }
      // The path tool steps out one level at a time (finish → deselect → leave).
      if (this.drawingMode === "path" && !this.isErasingMode && this.pathTool.escape()) return false;
      this.exitCurrentMode();
      return false;
    });
    // Path tool: Backspace / Delete removes the hovered anchor, else the active end's.
    for (const key of ["Backspace", "Delete"]) {
      this.scope.register([], key, () => {
        if (this.drawingMode !== "path" || this.isErasingMode) return true;
        return !this.pathTool.deleteKey();
      });
    }
  }

  /** The view buttons, the map nav group, undo / redo and help, along the top. */
  buildTopBar(controlsEl: HTMLElement): void {
    const tableBtn = controlsEl.createEl("button", {
      cls: "duckmage-table-btn",
      title: "Open hex table (middle-click for new tab)",
      text: "⊞",
    });
    tableBtn.addEventListener("click", () => {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE);
      if (existing.length > 0) {
        void this.app.workspace.revealLeaf(existing[0]);
      } else {
        void this.app.workspace
          .getLeaf()
          .setViewState({ type: VIEW_TYPE_HEX_TABLE });
      }
    });
    tableBtn.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      void this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_HEX_TABLE });
      void this.app.workspace.revealLeaf(this.leaf);
    });

    const rtBtn = controlsEl.createEl("button", {
      cls: "duckmage-rt-btn",
      title: "Open random tables (middle-click for new tab)",
      text: "🎲",
    });
    rtBtn.addEventListener("click", () => {
      const existing = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_RANDOM_TABLES,
      );
      if (existing.length > 0) {
        void this.app.workspace.revealLeaf(existing[0]);
      } else {
        void this.app.workspace
          .getLeaf()
          .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
      }
    });
    rtBtn.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      void this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
      void this.app.workspace.revealLeaf(this.leaf);
    });

    const mapNavGroup = controlsEl.createDiv({ cls: "duckmage-map-nav-group" });

    // Breadcrumb of parent maps (sector › system › …); filled by refreshMapNav.
    this.nav.crumbsEl = mapNavGroup.createDiv({ cls: "duckmage-map-crumbs" });
    this.nav.crumbsEl.hide();

    this.mapBtn = mapNavGroup.createEl("button", {
      cls: "duckmage-region-btn",
      title: "Manage maps",
    });
    this.updateMapBtnLabel();
    // ← ↑ → right after the map button, then the neighbours (flower / d-pad).
    this.nav.navArrowsEl = mapNavGroup.createDiv({ cls: "duckmage-map-nav-arrows" });
    this.nav.navArrowsEl.hide();
    this.nav.sideCrumbsEl = mapNavGroup.createDiv({ cls: "duckmage-map-crumbs duckmage-map-side-crumbs" });
    this.nav.sideCrumbsEl.hide();
    this.mapBtn.addEventListener("click", () =>
      this.host.openMapModal(() => {
        this.exitTerrainMode();
        this.toolbar.exitPathMode();
        this.undos.updateUndoButton();
        this.updateMapBtnLabel();
        this.nav.refreshMapNav();
        this.refreshViewHeader();
        this.renderGrid();
      }),
    );

    this.host.buildWorkModeBtn(mapNavGroup);
    this.nav.arrivalBarEl = mapNavGroup.createDiv({ cls: "duckmage-arrival-bar" });
    this.nav.arrivalBarEl.hide();
    this.nav.refreshMapNav();

    this.undoBtn = controlsEl.createEl("button", {
      cls: "duckmage-undo-btn-map",
      text: "↩",
      attr: { title: "Undo (up to 20)" },
    });
    this.undoBtn.disabled = true;
    this.undoBtn.addEventListener("click", () => {
      void this.undo();
    });

    this.redoBtn = controlsEl.createEl("button", {
      cls: "duckmage-undo-btn-map duckmage-redo-btn-map",
      text: "↪",
      attr: { title: "Redo" },
    });
    this.redoBtn.disabled = true;
    this.redoBtn.addEventListener("click", () => {
      void this.redo();
    });
    this.topBandEls = [tableBtn, rtBtn, mapNavGroup, this.undoBtn, this.redoBtn];
    if (this.modeBarEl) this.topBandEls.push(this.modeBarEl);

    const helpBtn = controlsEl.createEl("button", {
      cls: "duckmage-help-btn",
      title: "Controls & tools",
      text: "?",
    });
    helpBtn.addEventListener("click", () => new HexHelpModal(this.app).open());
  }

  /** The two side panels (drawing tools, layers), mutually exclusive. */
  buildSidePanels(controlsEl: HTMLElement): void {
    // Side panels — drawing tools (pencil) + overlays (layers), mutually exclusive
    this.toolsPanel = new DrawingToolPanel(controlsEl, (panel) =>
      this.toolbar.buildDrawingToolbarContent(panel),
    );
    const toolsPanel = this.toolsPanel;
    this.overlayPanel = new OverlayPanel(
      controlsEl,
      this.plugin,
      () => this.viewportEl,
      () => this.getActiveMap(),
      (show) => { if (show) this.areas.updateFactionOverlay(); else this.areas.clearFactionOverlay(); },
      (show) => { if (show) this.areas.updateRegionOverlay(); else this.areas.clearRegionOverlay(); },
      () => { this.pathLayer.updateGmIcons(); },
      // Redraw either way: hiding tokens also clears the party's lit steps.
      () => this.tokens.updateTokenLayer(),
      {
        onLegendChange: () => this.labels.refreshTerrainLegend(),
        // Badge size or kinds changed: redraw the badges and the legend.
        onBadgesChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.grid.measuring) {
            this.labels.renderLinkBadges(grid);
            this.labels.drawHexNames(grid, true);
          }
          this.labels.refreshTerrainLegend();
        },
        // Name font changed (NM3): redraw the names.
        onHexNameFontChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.grid.measuring) this.labels.drawHexNames(grid, true);
        },
        // Rows the modules add.
        rows: this.wm?.layerRows(this.plugin) ?? [],
        onRowChange: () => this.overworldLayer?.scheduleRedraw(),
      },
    );
    toolsPanel.onBeforeOpen = () => this.overlayPanel?.close();
    this.overlayPanel.onBeforeOpen = () => toolsPanel.close();
    // Opening or closing a panel never moves the map (round 7 R9: the map
    // slid left each time the layers panel opened). A panel may cover a few
    // hexes; fitting and centring a hex still keep clear of it.
  }

  /** Keep the open map current: other views, notes, paths, the map store. */
  registerListeners(): void {
    // Consume the cross-view stale flag: when the user switches to this
    // view (tab click, window focus change), catch up on mutations made
    // from other views/windows while it was inactive (issue #32).
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf !== this.leaf || !this.needsRerender) return;
        this.needsRerender = false;
        this.renderGrid();
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        // Clear stale pending/erased entries for this file
        this.areas.cacheUpdated(file.path);

        // A hex note of THIS map changed while this view was inactive
        // (edited from another view/window) → flag for catch-up render.
        const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
        const mapPrefix =
          (hexFolder ? hexFolder + "/" : "") + this.activeMapName + "/";
        if (file.path.startsWith(mapPrefix)) {
          this.markStaleFromExternal();
          // A hex note's links may have changed → its link badges.
          if (hexKeyFromBasename(file.basename)) this.labels.scheduleLinkBadges();
        }

        if (this.getActiveMap().showFactionOverlay) {
          const folder = normalizeFolder(this.plugin.settings.factionsFolder);
          const isFactionFile =
            !file.basename.startsWith("_") &&
            (folder ? file.path.startsWith(folder + "/") : true);
          if (isFactionFile) this.areas.updateFactionOverlay();
        }

        if (this.getActiveMap().showRegionOverlay) {
          const rFolder = normalizeFolder(this.plugin.settings.regionsFolder);
          const isRegionNoteFile =
            !file.basename.startsWith("_") &&
            (rFolder ? file.path.startsWith(rFolder + "/") : true);
          if (isRegionNoteFile) this.areas.updateRegionOverlay();
          // Also re-render when any hex file changes (region assignment may have changed)
          else this.areas.updateRegionOverlay();
        }

        // Refresh token layer when a token file changes (added, edited, or removed)
        const cache = this.app.metadataCache.getFileCache(file);
        const hasToken  = !!cache?.frontmatter?.["token"];
        const wasToken  = this.tokens.tokenEntries.some((t) => t.filePath === file.path);
        if (hasToken || wasToken) this.tokens.updateTokenLayer();
      }),
    );
    // A deleted hex note takes its badges with it.
    this.registerEvent(
      this.app.metadataCache.on("deleted", (file) => {
        if (hexKeyFromBasename(file.basename)) this.labels.scheduleLinkBadges();
      }),
    );
    // Paths that kept their route because of a terrain stroke: undone with it.
    this.register(
      this.plugin.pathPins.onPinned((r) => {
        if (r.map === this.activeMapName && this.undos.strokePins) this.undos.strokePins.push(r);
      }),
    );
    // Terrain painted / generated → the legend lists what the map now uses.
    this.register(
      this.plugin.mapStore.onChange((map) => {
        this.onOverworldDataChange(map);
        if (map !== this.activeMapName) return;
        // Painted from its overworld in another view: repaint those hexes now.
        if (this.grid.shownTerrain.size && !this.undos.currentTerrainStroke) this.grid.requestTerrainSync();
        this.labels.scheduleTerrainLegend();
        // A name set without a redraw (hex table, code, map note edit) shows up.
        this.labels.scheduleHexNames();
      }),
    );
  }
}

import { ItemView, Scope, TFile, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexEditorModal } from "./HexEditorModal";
import { getSubmapFromFile } from "../frontmatter";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { MapModal } from "./MapModal";
import { PathTool } from "./pathTool";
import { allows, lockedHint, TOOL_ACTIONS, WORK_MODES, WORK_MODE_TEXT, workModeOf, type ModeAction, type WorkMode } from "../workMode";
import { canDo } from "../modeGate";
import { ModeMenu } from "./modeMenu";
import { lockedNotice } from "./godOffer";
import { partyClick } from "../play/partyTravel";
import { nearestHex } from "./hitTest";
import type { MapData, MapPath, TokenEntry } from "../types";
import { worldMaps } from "../modules/runtime";
import type { WorldMapsApi } from "../modules/world-maps/api";
import type { DrawingToolPanel, OverlayPanel } from "./HexSidePanel";
import { regionMapAt } from "../maps/submaps";
// World maps (overworlds, regions, biomes, walking) through its hooks,
// typed only: worldMaps() is undefined in a build without it.
import type { OverworldLayer } from "../overworld/overworldLayer";
import type { OverworldMinimap } from "../overworld/overworldMinimap";
import type { BiomeHost } from "../overworld/BiomeModals";

import { BackgroundCalibration } from "./view/backgroundCalibration";
import { MapViewport } from "./view/mapViewport";
import { HexWrites } from "./view/hexWrites";
import { UndoController } from "./view/undoController";
import { AreaOverlay } from "./view/areaOverlay";
import { PathOverlay } from "./view/pathOverlay";
import { GridLabels } from "./view/gridLabels";
import { NeighbourShadow } from "./view/neighbourShadow";
import { MapToolbar } from "./view/mapToolbar";
import { MapInput } from "./view/mapInput";
import { MapNavigation } from "./view/mapNavigation";
import { HexContextMenu } from "./view/hexContextMenu";
import { TokenLayer } from "./view/tokenLayer";
import { GridEdgeButtons } from "./view/gridEdgeButtons";
import { HexSwap } from "./view/hexSwap";
import { GridRenderer } from "./view/gridRenderer";
import { HexPainter } from "./view/hexPainter";
import { MapShell } from "./view/mapShell";
import type { DrawingMode } from "./toolMode";
import type { TokenSnap } from "./undoItems";

export class HexMapView extends ItemView {
  plugin: HexmakerPlugin;
  /** Pan / zoom (view/mapViewport.ts). */
  private viewport: MapViewport;
  /** Pointer input (view/mapInput.ts). */
  private input: MapInput;
  /** The neighbour strip and seam joins (view/neighbourShadow.ts). */
  private shadow: NeighbourShadow;

  /** The path layer and the icons over it (view/pathOverlay.ts). */
  private pathLayer: PathOverlay;
  /** Coordinate labels, link badges, hex names, terrain legend (view/gridLabels.ts). */
  private labels: GridLabels;
  /** The grid DOM and the layers measured from it (view/gridRenderer.ts). */
  private grid: GridRenderer;
  /** Zoom at the last transform: a change redraws the names (readable size, NM3). */
  private namesZoom = 1;
  private controlsEl: HTMLElement | null = null;
  private viewportEl: HTMLElement | null = null;
  /** Background-image calibration (view/backgroundCalibration.ts). */
  private calibration: BackgroundCalibration;
  /** The drawing tools: their state, buttons and mode bar (view/mapToolbar.ts, view/toolState.ts). */
  private toolbar: MapToolbar;
  // The tool state lives on the toolbar; these keep the view's (and the
  // smoke suite's) reads and writes of it as they were.
  private get drawingMode(): DrawingMode | null { return this.toolbar.drawingMode; }
  private set drawingMode(v: DrawingMode | null) { this.toolbar.drawingMode = v; }
  private get isErasingMode(): boolean { return this.toolbar.isErasingMode; }
  private set isErasingMode(v: boolean) { this.toolbar.isErasingMode = v; }
  private get paintTerrainName(): string | null { return this.toolbar.paintTerrainName; }
  private set paintTerrainName(v: string | null) { this.toolbar.paintTerrainName = v; }
  private get paintIconName(): string | null { return this.toolbar.paintIconName; }
  private get paintIconGmOnly(): boolean { return this.toolbar.paintIconGmOnly; }
  private get terrainPickMode(): boolean { return this.toolbar.terrainPickMode; }
  private set terrainPickMode(v: boolean) { this.toolbar.terrainPickMode = v; }
  private get paintBrushSize(): 1 | 3 | 7 { return this.toolbar.paintBrushSize; }
  private set paintBrushSize(v: 1 | 3 | 7) { this.toolbar.paintBrushSize = v; }
  private get paintTablePath(): string | null { return this.toolbar.paintTablePath; }
  private get paintSubmapName(): string | null { return this.toolbar.paintSubmapName; }
  private get paintFactionPath(): string | null { return this.toolbar.paintFactionPath; }
  private get paintRegionPath(): string | null { return this.toolbar.paintRegionPath; }
  private get paintBiomeId(): string | null { return this.toolbar.paintBiomeId; }
  private get pendingTokenNotePath(): string | null { return this.toolbar.pendingTokenNotePath; }
  private get pendingTokenPlaceData(): NonNullable<TokenSnap["look"]> | null { return this.toolbar.pendingTokenPlaceData; }
  /** The paint tools' hex handlers and strokes (view/hexPainter.ts). */
  private painter: HexPainter;
  /** Keys, top bar, side panels and listeners made in onOpen (view/mapShell.ts). */
  private shell: MapShell;
  private get overlayPanel(): OverlayPanel | null { return this.shell.overlayPanel; }
  private get toolsPanel(): DrawingToolPanel | null { return this.shell.toolsPanel; }
  /** The path tool: drawing, selecting, reshaping (src/hex-map/pathTool.ts). */
  private pathTool: PathTool;
  private selectedHex: { x: number; y: number } | null = null;
  /** Paint writes (terrain, icon, GM icons), coalesced per hex (view/hexWrites.ts). */
  private writes: HexWrites;
  /** Faction and region overlays and their link tools (view/areaOverlay.ts). */
  private areas: AreaOverlay;
  private savingIndicatorEl: HTMLElement | null = null;
  // Undo / redo
  // (the queues live in plugin.undoBook: one per map per work mode, WM6)
  private stopUndoListen: (() => void) | null = null;
  /** Undo / redo and the strokes being painted (view/undoController.ts). */
  private undos: UndoController;
  /** Overworlds (OW1): every region's hexes stitched on one canvas, and the minimap. */
  private overworldLayer: OverworldLayer | undefined;
  private minimap: OverworldMinimap | undefined;
  private minimapTimer: number | null = null;
  activeMapName = "default";

  /** Path types the active map can draw: its palette's. */
  private mapPathTypes() {
    return this.plugin.getMapPathTypes(this.activeMapName);
  }
  /** Moving between maps: history, crumbs, arrows, neighbours (view/mapNavigation.ts). */
  private nav: MapNavigation;
  /** The hex right-click menus (view/hexContextMenu.ts). */
  private hexMenu: HexContextMenu;
  /** The map's work mode (Play / Build / God), always shown. */
  private workModeBtn: HTMLButtonElement | null = null;
  /** Tokens, the party and its steps (view/tokenLayer.ts). */
  private tokens: TokenLayer;
  /** The grid's +/− edge buttons (view/gridEdgeButtons.ts). */
  private edges: GridEdgeButtons;
  /** The swap tool's swap (view/hexSwap.ts). */
  private swap: HexSwap;

  constructor(leaf: WorkspaceLeaf, plugin: HexmakerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.pathTool = new PathTool({
      plugin: this.plugin,
      mapName: () => this.activeMapName,
      pointerLattice: (e) => this.pathLayer.pointerLattice(e),
      hexAtPoint: (x, y) => {
        const hexEl = this.hexElAt(this.contentEl.ownerDocument.elementFromPoint(x, y), x, y);
        return hexEl ? `${hexEl.dataset.x}_${hexEl.dataset.y}` : null;
      },
      ownerDocument: () => this.contentEl.ownerDocument,
      pushUndo: (map, before, after) => this.undos.pushPathUndo(map, before, after),
      redraw: () => this.pathLayer.updatePathOverlay(),
      refreshBar: () => this.toolbar.updateModeBar(),
      setGrabCursor: (on) => this.viewportEl?.toggleClass("duckmage-path-grab", on),
      typeChanged: () => this.toolbar.updateToolbarButtonStates(),
      neighbourStrip: () => this.shadow.strip(this.activeMapName),
      openNeighbour: (map, hex, arm) => {
        const [x, y] = hex.split("_").map(Number);
        this.nav.goToRegionHex(map, x, y);
        this.drawingMode = "path";
        arm();
        this.toolbar.updateToolbarButtonStates();
        this.pathLayer.updatePathOverlay();
      },
    });
    this.writes = new HexWrites({
      plugin: this.plugin,
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      renderGrid: () => this.renderGrid(),
      changed: () => this.updateSavingIndicator(),
    });
    this.undos = new UndoController({
      plugin: this.plugin,
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      wm: () => this.wm,
      writes: this.writes,
      calibration: { captureCalibration: (m) => this.calibration.captureCalibration(m), applyCalibrationSnapshot: (n, s) => this.calibration.applyCalibrationSnapshot(n, s) },
      undoButtons: () => ({ undo: this.shell.undoBtn, redo: this.shell.redoBtn }),
      applyTerrainToHexEl: (el, t) => this.painter.applyTerrainToHexEl(el, t),
      getFactionLinksFromCache: (p) => this.areas.getFactionLinksFromCache(p),
      applyFactionStroke: (e, w) => this.areas.applyFactionStroke(e, w),
      applyRegionStroke: (e, w) => this.areas.applyRegionStroke(e, w),
      executeHexSwap: (x1, y1, x2, y2, u) => this.swap.executeHexSwap(x1, y1, x2, y2, u),
      applyPathSnapshot: (m, p) => this.applyPathSnapshot(m, p),
      applyTokenSnap: (p, snap) => this.tokens.applyTokenSnap(p, snap),
      renderGrid: () => this.renderGrid(),
      updateModeBar: () => this.toolbar.updateModeBar(),
      updateGmIcons: () => this.pathLayer.updateGmIcons(),
      updatePathOverlay: () => this.pathLayer.updatePathOverlay(),
    });
    this.areas = new AreaOverlay({
      plugin: this.plugin,
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      getActiveMap: () => this.getActiveMap(),
      drawingMode: () => this.drawingMode,
      isErasingMode: () => this.isErasingMode,
      paintFactionPath: () => this.paintFactionPath,
      paintRegionPath: () => this.paintRegionPath,
      undos: this.undos,
    });
    this.shadow = new NeighbourShadow({
      plugin: this.plugin,
      getActiveStagger: () => this.getActiveStagger(),
      drawingMode: () => this.drawingMode,
      isErasingMode: () => this.isErasingMode,
      pathTool: () => this.pathTool,
      goToRegionHex: (map, x, y) => this.nav.goToRegionHex(map, x, y),
    });
    this.pathLayer = new PathOverlay({
      plugin: this.plugin,
      viewportEl: () => this.viewportEl,
      getActiveMap: () => this.getActiveMap(),
      getActiveStagger: () => this.getActiveStagger(),
      drawingMode: () => this.drawingMode,
      pathTool: () => this.pathTool,
      mapPathTypes: () => this.mapPathTypes(),
      wm: () => this.wm,
      seamJoins: (grid, region) => this.shadow.seamJoins(grid, region),
      renderGrid: () => this.renderGrid(),
    });
    this.labels = new GridLabels({
      plugin: this.plugin,
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      controlsEl: () => this.controlsEl,
      getActiveMap: () => this.getActiveMap(),
      zoom: () => this.viewport.zoom,
      measuring: () => this.grid.measuring,
      syncLegendToggle: () => this.overlayPanel?.syncLegendToggle(),
    });
    this.viewport = new MapViewport({
      plugin: this.plugin,
      viewportEl: () => this.viewportEl,
      getActiveMap: () => this.getActiveMap(),
      calibration: () => this.calibration,
      overlayEls: () => ({
        top: this.shell.topBandEls.filter((el) => el.isConnected),
        right: [this.toolsPanel, this.overlayPanel]
          .filter((p): p is DrawingToolPanel | OverlayPanel => !!p && p.isOpen)
          .map((p) => p.element),
        left: Array.from(this.controlsEl?.querySelectorAll<HTMLElement>(":scope > .duckmage-terrain-legend") ?? []),
      }),
      transformed: () => {
        // Names keep a readable size on screen (NM3): redraw once the zoom settles.
        if (this.viewport.zoom !== this.namesZoom) {
          this.namesZoom = this.viewport.zoom;
          this.labels.scheduleHexNames();
        }
        this.calibration.updateCalHandleScale();
        this.labels.onViewportMoved();
      },
      baked: () => {
        this.pathLayer.updatePathIcons();
        this.areas.updateFactionOverlay();
        this.areas.updateRegionOverlay();
        this.tokens.updateTokenLayer();
      },
      renderGrid: () => this.renderGrid(),
    });
    this.toolbar = new MapToolbar({
      plugin: this.plugin,
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      getActiveMap: () => this.getActiveMap(),
      wm: () => this.wm,
      owView: (map) => this.owView(map),
      modeAllows: (action) => this.modeAllows(action),
      pathTool: this.pathTool,
      mapPathTypes: () => this.mapPathTypes(),
      undos: { commitTerrainStroke: () => this.undos.commitTerrainStroke(), updateUndoButton: () => this.undos.updateUndoButton() },
      pathLayer: { updatePathOverlay: () => this.pathLayer.updatePathOverlay(), updateGmIcons: () => this.pathLayer.updateGmIcons() },
      overlayPanel: () => this.overlayPanel,
      toolsPanel: () => this.toolsPanel,
      centerOnHex: (x, y) => this.centerOnHex(x, y),
      applyWorkModeUi: () => this.applyWorkModeUi(),
      finishBiomeStroke: () => this.painter.finishBiomeStroke(),
      updateBrushHighlight: (x, y) => this.painter.updateBrushHighlight(x, y),
      showOverworldRegions: () => this.showOverworldRegions(),
      nextTokenFill: () => this.tokens.nextTokenFill(),
      renderGrid: () => this.renderGrid(),
    });
    this.painter = new HexPainter({
      plugin: this.plugin,
      viewportEl: () => this.viewportEl,
      activeMapName: () => this.activeMapName,
      getActiveMap: () => this.getActiveMap(),
      owView: (map) => this.owView(map),
      getActiveStagger: () => this.getActiveStagger(),
      wm: () => this.wm,
      overworldLayer: () => this.overworldLayer,
      toolbar: this.toolbar,
      undos: this.undos,
      writes: this.writes,
      pathLayer: this.pathLayer,
      modeAllows: (action) => this.modeAllows(action),
      hexElAt: (t, x, y) => this.hexElAt(t, x, y),
      renderGrid: (t, i) => this.renderGrid(t, i),
    });
    // The input handlers read the view live, and call its hex handlers
    // through it (the smoke suite wraps view.onHexClick).
    this.input = new MapInput({
      registerDomEvent: this.registerDomEvent.bind(this),
      register: this.register.bind(this),
      viewportEl: () => this.viewportEl,
      drawingMode: () => this.drawingMode,
      isErasingMode: () => this.isErasingMode,
      paintIconName: () => this.paintIconName,
      paintIconGmOnly: () => this.paintIconGmOnly,
      resetSubStrokeHint: () => { this.painter.subStrokeMissHinted = false; },
      biomeStroke: () => this.painter.biomeStroke,
      calibration: () => this.calibration,
      viewport: () => this.viewport,
      undos: () => this.undos,
      areas: () => this.areas,
      toolbar: () => this.toolbar,
      pathTool: () => this.pathTool,
      overworldLayer: () => this.overworldLayer,
      wm: () => this.wm,
      getActiveMap: () => this.getActiveMap(),
      owView: (map) => this.owView(map),
      modeAllows: (action) => this.modeAllows(action),
      exitCurrentMode: () => this.exitCurrentMode(),
      exitTerrainMode: () => this.exitTerrainMode(),
      hexElAt: (t, x, y) => this.hexElAt(t, x, y),
      labelHex: (el) => this.painter.labelHex(el),
      updateBrushHighlight: (x, y) => this.painter.updateBrushHighlight(x, y),
      onHexClick: (x, y, e) => this.onHexClick(x, y, e),
      onHexContextMenu: (e, x, y) => this.hexMenu.onHexContextMenu(e, x, y),
      onHexPaintClick: (x, y) => this.painter.onHexPaintClick(x, y),
      onHexIconClick: (x, y) => this.painter.onHexIconClick(x, y),
      removeOneGmIconFromHex: (el, x, y, icon) => this.painter.removeOneGmIconFromHex(el, x, y, icon),
      overworldHexKeyAt: (t, x, y) => this.painter.overworldHexKeyAt(t, x, y),
      startBiomeStroke: () => this.painter.startBiomeStroke(),
      finishBiomeStroke: () => this.painter.finishBiomeStroke(),
      subHexKeyAt: (x, y) => this.painter.subHexKeyAt(x, y),
      paintSubHexAt: (x, y) => this.painter.paintSubHexAt(x, y),
    });
    this.nav = new MapNavigation(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      mapBtn: () => this.shell.mapBtn,
      drawingMode: () => this.drawingMode,
      wm: () => this.wm,
      viewport: { measureOverlayInsets: () => this.viewport.measureOverlayInsets(), panBy: (dx, dy) => this.viewport.panBy(dx, dy) },
      undos: { updateUndoButton: () => this.undos.updateUndoButton() },
      toolbar: { exitPathMode: () => this.toolbar.exitPathMode() },
      switchToMap: (name) => this.switchToMap(name),
      exitCurrentMode: () => this.exitCurrentMode(),
      renderGrid: () => this.renderGrid(),
      centerOnHex: (x, y, w) => this.centerOnHex(x, y, w),
      setSelectedHex: (x, y) => this.setSelectedHex(x, y),
      refreshWorkModeBtn: () => this.refreshWorkModeBtn(),
      openHexEditorModal: (x, y) => this.openHexEditorModal(x, y),
      openEditRegion: (px, py, ow) => this.hexMenu.openEditRegion(px, py, ow),
      biomeHost: () => this.biomeHost(),
    });
    this.hexMenu = new HexContextMenu(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      drawingMode: () => this.drawingMode,
      overworldLayer: () => this.overworldLayer,
      wm: () => this.wm,
      getActiveMap: () => this.getActiveMap(),
      owView: (map) => this.owView(map),
      undos: { currentWorkMode: () => this.undos.currentWorkMode() },
      toolbar: { handleSwapButton: () => this.toolbar.handleSwapButton() },
      nav: { openLinkExistingMap: (x, y) => this.nav.openLinkExistingMap(x, y), enterRegionAt: (r, x, y) => this.nav.enterRegionAt(r, x, y) },
      setWorkMode: (mode) => this.setWorkMode(mode),
      navigateToMap: (name, opts) => this.navigateToMap(name, opts),
      openLocationsList: (x, y) => this.openLocationsList(x, y),
      openNewSubmapSetup: (x, y) => this.openNewSubmapSetup(x, y),
      arriveAt: (x, y) => this.arriveAt(x, y),
      createTokenAtHex: (x, y) => this.tokens.createTokenAtHex(x, y),
      openPlayLog: (x, y) => this.openPlayLog(x, y),
      setVisited: (keys, on) => this.tokens.setVisited(keys, on),
      centerOnHex: (x, y) => this.centerOnHex(x, y),
      linkTableToHex: (x, y, file) => this.painter.linkTableToHex(x, y, file),
      openRandomTableAtFile: (file) => this.openRandomTableAtFile(file),
      onHexSwapClick: (x, y) => this.swap.onHexSwapClick(x, y),
      paintOne: (x, y, terrain) => this.painter.paintOne(x, y, terrain),
      removeIconOverride: (x, y) => this.painter.removeIconOverride(x, y),
      biomeHost: () => this.biomeHost(),
      renderGrid: () => this.renderGrid(),
    });
    this.tokens = new TokenLayer(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      drawingMode: () => this.drawingMode,
      pendingTokenNotePath: () => this.pendingTokenNotePath,
      pendingTokenPlaceData: () => this.pendingTokenPlaceData,
      getActiveMap: () => this.getActiveMap(),
      getActiveStagger: () => this.getActiveStagger(),
      owView: (map) => this.owView(map),
      undos: {
        currentWorkMode: () => this.undos.currentWorkMode(),
        pushUndo: (item, mapName) => this.undos.pushUndo(item, mapName),
        pushTokenUndo: (path, mapName, before, after) => this.undos.pushTokenUndo(path, mapName, before, after),
      },
      zoom: () => this.viewport.zoom,
      toolbar: { exitTokenMode: () => this.toolbar.exitTokenMode() },
      hexMenu: {
        modeMenuOptions: () => this.hexMenu.modeMenuOptions(),
        addHexMenuItems: (menu, x, y, inToken) => this.hexMenu.addHexMenuItems(menu, x, y, inToken),
        addOverworldMenuItems: (menu, evt, x, y) => this.hexMenu.addOverworldMenuItems(menu, evt, x, y),
      },
      onHexClick: (x, y, e) => this.onHexClick(x, y, e),
      centerOnHex: (x, y) => this.centerOnHex(x, y),
      renderGrid: () => this.renderGrid(),
    });
    this.edges = new GridEdgeButtons(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      getActiveMap: () => this.getActiveMap(),
      viewport: () => this.viewport,
      calibration: { applyBgLayerVars: (layer, bg) => this.calibration.applyBgLayerVars(layer, bg) },
      modeAllows: (action) => this.modeAllows(action),
      renderGrid: (t, i) => this.renderGrid(t, i),
    });
    this.swap = new HexSwap(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      writes: this.writes,
      undos: this.undos,
      toolbar: this.toolbar,
      renderGrid: () => this.renderGrid(),
    });
    this.calibration = new BackgroundCalibration({
      plugin: this.plugin,
      contentEl: this.contentEl,
      viewportEl: () => this.viewportEl,
      zoom: () => this.viewport.zoom,
      getActiveMap: () => this.getActiveMap(),
      activeMapName: () => this.activeMapName,
      pushUndo: (item, mapName) => this.undos.pushUndo(item, mapName),
      updateUndoButton: () => this.undos.updateUndoButton(),
      renderGrid: () => this.renderGrid(),
      cancelZoomBake: () => this.viewport.cancelZoomBake(),
      registerDomEvent: (el, type, cb) => this.registerDomEvent(el, type, cb),
    });
    const wm = worldMaps();
    this.overworldLayer = wm ? new wm.OverworldLayer(plugin) : undefined;
    this.minimap = wm ? new wm.OverworldMinimap(plugin, this) : undefined;
    this.grid = new GridRenderer({
      plugin: this.plugin,
      contentEl: this.contentEl,
      viewportEl: () => this.viewportEl,
      controlsEl: () => this.controlsEl,
      activeMapName: () => this.activeMapName,
      getActiveMap: () => this.getActiveMap(),
      owView: (map) => this.owView(map),
      getActiveStagger: () => this.getActiveStagger(),
      selectedHex: () => this.selectedHex,
      drawingMode: () => this.drawingMode,
      overlayPanel: () => this.overlayPanel,
      overworldLayer: () => this.overworldLayer,
      minimap: () => this.minimap,
      calibration: this.calibration,
      labels: this.labels,
      shadow: this.shadow,
      pathLayer: this.pathLayer,
      areas: this.areas,
      tokens: this.tokens,
      toolbar: this.toolbar,
      hexMenu: this.hexMenu,
      refreshWorkModeBtn: () => this.refreshWorkModeBtn(),
      onHexClick: (x, y, e) => this.onHexClick(x, y, e),
      navigateToMap: (name) => this.navigateToMap(name),
      openLocationsList: (x, y) => this.openLocationsList(x, y),
      labelHex: (el, t, p) => this.painter.labelHex(el, t, p),
      applyTerrainToHexEl: (el, t) => this.painter.applyTerrainToHexEl(el, t),
      emptySlotOnMap: (hex) => this.emptySlotOnMap(hex),
    });
    this.shell = new MapShell({
      plugin: this.plugin,
      leaf: this.leaf,
      scope: () => this.scope!,
      registerEvent: this.registerEvent.bind(this),
      register: this.register.bind(this),
      viewportEl: () => this.viewportEl,
      activeMapName: () => this.activeMapName,
      getActiveMap: () => this.getActiveMap(),
      wm: () => this.wm,
      overworldLayer: () => this.overworldLayer,
      drawingMode: () => this.drawingMode,
      isErasingMode: () => this.isErasingMode,
      activeParty: () => this.activeParty(),
      pathTool: this.pathTool,
      toolbar: this.toolbar,
      undos: this.undos,
      nav: this.nav,
      tokens: this.tokens,
      areas: this.areas,
      pathLayer: this.pathLayer,
      labels: this.labels,
      grid: this.grid,
      undo: () => this.undo(),
      redo: () => this.redo(),
      navigateUp: () => this.navigateUp(),
      navigateBack: () => this.navigateBack(),
      navigateForward: () => this.navigateForward(),
      exitCurrentMode: () => this.exitCurrentMode(),
      exitTerrainMode: () => this.exitTerrainMode(),
      openMapModal: (onChanged) => new MapModal(this.app, this.plugin, this, onChanged).open(),
      buildWorkModeBtn: (group) => {
        this.workModeBtn = group.createEl("button", { cls: "duckmage-work-mode-btn" });
        this.workModeBtn.addEventListener("click", (e) => this.openWorkModeMenu(e));
      },
      refreshViewHeader: () => this.refreshViewHeader(),
      markStaleFromExternal: () => this.markStaleFromExternal(),
      onOverworldDataChange: (map) => this.onOverworldDataChange(map),
      renderGrid: () => this.renderGrid(),
    });
  }

  /** World maps' hooks (overworlds, regions, biomes, walking); undefined in a build without it. */
  private get wm(): WorldMapsApi | undefined {
    return worldMaps();
  }

  /** The overworld view a map shows ("biomes" or "regions"), or null when it isn't an overworld. */
  private owView(map: MapData): "regions" | "biomes" | null {
    return this.wm?.OverworldLayer.viewOf(this.plugin, map) ?? null;
  }

  /** Full redraw (the overworld view switch). */
  redraw(): void {
    this.renderGrid();
  }

  /** Timings of the overworld region layer's last draw (dev tools, bench). */
  overworldStats(): Record<string, number> {
    return { ...(this.overworldLayer?.lastStats ?? { ms: 0, builds: 0, regions: 0, cells: 0 }) };
  }

  getViewType(): string {
    return VIEW_TYPE_HEX_MAP;
  }
  getDisplayText(): string {
    return `Hex map — ${this.plugin.mapLabel(this.activeMapName)}`;
  }

  private getActiveMap(): MapData {
    return this.plugin.getOrCreateMap(this.activeMapName);
  }

  /**
   * Flag this view as stale after shared state (settings, hex notes) changed
   * elsewhere — another view of the same map, another window, or the settings
   * tab. No-op for the currently active map view, whose DOM is already
   * current (it made the change). The flag is consumed on next activation,
   * so hidden/backgrounded views catch up when the user switches to them
   * instead of staying stale until closed and reopened (issue #32).
   */
  markStaleFromExternal(): void {
    if (this.app.workspace.getActiveViewOfType(HexMapView) === this) return;
    this.shell.needsRerender = true;
  }

  private refreshViewHeader(): void {
    // Update both the inline view header title and the tab strip title.
    // Directly patching .view-header-title is needed because leaf.updateHeader()
    // alone doesn't always refresh the in-pane header in all Obsidian versions.
    const titleEl = this.containerEl.querySelector<HTMLElement>(".view-header-title");
    if (titleEl) titleEl.setText(this.getDisplayText());
    interface WithUpdateHeader { updateHeader?(): void; }
    (this.leaf as unknown as WithUpdateHeader).updateHeader?.();
  }

  switchToMap(name: string): void {
    // Save the departing map's viewport into the in-memory cache AND onto the
    // map itself, so the state survives both same-session switching and full
    // view reload. Skip until the view has placed its first map — before that
    // the zoom/pan are placeholder values, and saving them would clobber the
    // default map's stored viewport (e.g. a new tab immediately switching to
    // a submap).
    const snapshot = this.viewport.remember(this.activeMapName);
    if (snapshot) {
      const departing = this.plugin.getMap(this.activeMapName);
      if (departing) {
        departing.savedViewport = snapshot;
        void this.plugin.saveSettings();
      }
    }

    this.activeMapName = name;
    this.shell.updateMapBtnLabel();
    this.refreshViewHeader();
    this.viewport.restoreViewport(name);
    this.nav.refreshMapNav();
  }

  /** The map's view changed size: the top toolbar row may need to fold its breadcrumb. */
  onResize(): void {
    this.nav.fitTopBar();
  }

  /** The work-mode switch: names the map's mode; click to pick another. */
  private refreshWorkModeBtn(): void {
    this.applyWorkModeUi();
    // Reroll / Lock depend on the mode too (a locked place: God only).
    this.nav.refreshArrivalBar();
    const btn = this.workModeBtn;
    if (!btn) return;
    const mode = workModeOf(this.plugin.getMap(this.activeMapName));
    const text = WORK_MODE_TEXT[mode];
    btn.setText(text.label);
    btn.removeClass("is-play", "is-build", "is-god");
    btn.addClass(`is-${mode}`);
    const tip = `Mode: ${text.label}. ${text.desc} Click to change.`;
    btn.setAttr("title", tip);
    btn.setAttr("aria-label", tip);
  }

  private openWorkModeMenu(e: MouseEvent): void {
    const map = this.plugin.getMap(this.activeMapName);
    if (!map) return;
    const cur = workModeOf(map);
    // Play, Build and God in one list (owner 2026-10-12: God isn't in
    // Advanced); God is also offered where an action needs it (godOffer.ts).
    const menu = new ModeMenu(cur, { store: this.app });
    for (const m of WORK_MODES) {
      menu.add("mode.switch", `${WORK_MODE_TEXT[m].label}: ${WORK_MODE_TEXT[m].short}`, null, () => this.setWorkMode(m), { checked: m === cur, place: `WorkModeMenu.${m}` });
    }
    menu.showAtMouseEvent(e);
  }

  /** Switch the open map's work mode (saved in its map note as `mode:`). */
  setWorkMode(mode: WorkMode): void {
    const map = this.plugin.getMap(this.activeMapName);
    if (!map || workModeOf(map) === mode) return;
    // The current stroke belongs to the mode it was made in.
    this.undos.commitTerrainStroke();
    this.undos.commitIconStroke();
    map.workMode = mode;
    void this.plugin.saveSettings();
    // A tool the new mode locks is put down.
    if (this.drawingMode && !allows(mode, TOOL_ACTIONS[this.drawingMode])) this.exitCurrentMode();
    this.refreshWorkModeBtn();
    // The neighbour "+" buttons lock and unlock with the mode.
    this.nav.refreshSideCrumbs();
    this.applyWorkModeUi();
    // Each mode has its own undo queue (WM6).
    this.undos.updateUndoButton();
  }

  /**
   * Show the open map's mode on the UI: the drawing panel shows only the
   * tools the mode allows, with one line naming the mode that unlocks the
   * rest; the grid's +/− buttons follow (CSS on the mode class).
   */
  private applyWorkModeUi(): void {
    const mode = this.undos.currentWorkMode();
    this.contentEl.removeClass("duckmage-mode-play", "duckmage-mode-build", "duckmage-mode-god");
    this.contentEl.addClass(`duckmage-mode-${mode}`);
    this.toolbar.applyMode(mode, this.owView(this.getActiveMap()));
    // Shrinking is God's: in Build the − stays clickable and its click
    // offers to switch (modeAllows → lockedNotice), it isn't just greyed out.
    for (const b of this.contentEl.querySelectorAll<HTMLButtonElement>(".duckmage-shrink-btn")) {
      const ok = allows(mode, "shrink-map");
      b.toggleClass("is-locked", !ok);
      b.setAttr("aria-disabled", String(!ok));
      b.setAttr("title", ok ? "Remove this edge" : lockedHint("shrink-map"));
    }
  }

  /**
   * May the open map do `action` in its mode? When not, says which mode
   * would (one Notice) and returns false.
   */
  private modeAllows(action: ModeAction): boolean {
    if (canDo(this.activeMapName, action)) return true;
    // A God-only action: the Notice offers to switch the map to God.
    lockedNotice(this.plugin, this.activeMapName, lockedHint(action));
    return false;
  }

  /**
   * The one way to change maps from the UI (map list, breadcrumb, submap
   * badge, Ctrl+click, context menu, hex editor, Up/Back targets); see
   * MapNavigation.navigateToMap.
   */
  navigateToMap(name: string, opts: { recordHistory?: boolean; offerModule?: boolean } = {}): void {
    this.nav.navigateToMap(name, opts);
  }

  /** Open map `name` centred on hex (x, y), flashed and selected (a hex link). */
  goToHex(name: string, x: number, y: number, opts: { recordHistory?: boolean } = {}): void {
    this.nav.goToHex(name, x, y, opts);
  }

  navigateBack(): boolean {
    return this.nav.navigateBack();
  }

  navigateForward(): boolean {
    return this.nav.navigateForward();
  }

  navigateUp(): boolean {
    return this.nav.navigateUp();
  }

  canNavigateBack(): boolean {
    return this.nav.canNavigateBack();
  }

  canNavigateForward(): boolean {
    return this.nav.canNavigateForward();
  }

  canNavigateUp(): boolean {
    return this.nav.canNavigateUp();
  }

  /** "New map from this hex…" for hex (x, y). */
  openNewSubmapSetup(x: number, y: number): void {
    this.nav.openNewSubmapSetup(x, y);
  }

  /** Go into hex (x, y) where nothing exists yet (arrival). */
  async arriveAt(x: number, y: number): Promise<void> {
    await this.nav.arriveAt(x, y);
  }

  /** Redraw the New place bar (after a lock elsewhere). */
  refreshPlaceBar(): void {
    this.nav.refreshPlaceBar();
  }

  /** The hex's Locations list (search, open, unlink, reorder). */
  openLocationsList(x: number, y: number): void {
    this.nav.openLocationsList(x, y);
  }

  /** Change maps from a dialog. `offerModule`: picked on purpose (see navigateToMap). */
  public switchMapFromModal(name: string, opts: { offerModule?: boolean } = {}): void {
    this.navigateToMap(name, opts);
  }

  onOpen(): Promise<void> {
    // A map opened during a fresh setup: its stores must start (F19).
    this.plugin.releaseStartupWrites();
    // Initialise to the configured default map (falls back to first map or "default")
    this.activeMapName =
      this.plugin.settings.defaultMap ||
      this.plugin.settings.maps[0]?.name ||
      "default";

    // Obsidian reads getDisplayText() before onOpen() runs (getting the class-field
    // default), and the view-header DOM isn't attached yet at this point, so defer.
    window.requestAnimationFrame(() => this.refreshViewHeader());

    const { contentEl } = this;
    contentEl.addClass("duckmage-hex-map-container");
    // Undo entries can come from outside the view (hex editor, region editor).
    this.stopUndoListen?.();
    this.stopUndoListen = this.plugin.undoBook.onChange(() => this.undos.updateUndoButton());

    // A prior build (or a crashed view) may have left a calibration banner
    // attached to the document body. Sweep before we render so the user
    // doesn't see a phantom "Calibrating background" on a fresh view.
    this.calibration.sweepStrayCalibrationHelp();

    // The view's keymap scope: undo / redo and Alt+arrow navigation (view/mapShell.ts).
    this.scope = new Scope(this.app.scope);
    this.shell.registerUndoNavKeys();

    // clipEl clips the panning viewport; controlsEl overlays buttons without clipping
    const clipEl = contentEl.createDiv({ cls: "duckmage-hex-map-clip" });
    const controlsEl = contentEl.createDiv({
      cls: "duckmage-hex-map-controls",
    });
    this.controlsEl = controlsEl;

    this.viewportEl = clipEl.createDiv({ cls: "duckmage-hex-map-viewport" });
    this.viewport.applyTransform();

    this.toolbar.buildModeBar(controlsEl);

    // Esc, Backspace and Delete for the active tool (view/mapShell.ts).
    this.shell.registerToolKeys();

    this.grid.factionTooltipEl = contentEl.createDiv({ cls: "duckmage-faction-tooltip" });
    this.grid.factionTooltipEl.hide();

    // Pointer input: hover, wheel zoom, pan, paint strokes, tool menus (view/mapInput.ts).
    this.input.attach(contentEl, clipEl);

    // Expand buttons and view buttons — always visible (not collapsible)
    this.edges.createExpandButtons(controlsEl);

    // The top bar and the side panels (view/mapShell.ts).
    this.shell.buildTopBar(controlsEl);
    this.shell.buildSidePanels(controlsEl);

    // Saving indicator — appears while background writes are in flight
    this.savingIndicatorEl = controlsEl.createSpan({
      cls: "duckmage-saving-indicator",
      text: "Saving…",
    });

    // Keep the open map current (view/mapShell.ts).
    this.shell.registerListeners();

    // Reopen where the user left this map (onClose saves savedViewport);
    // first visit fits the whole grid.
    this.viewport.restoreViewport(this.activeMapName);
    this.nav.refreshMapNav();
    return Promise.resolve();
  }

  /** Is overworld hex "x_y" on the open map's grid (an empty brick there can take a biome)? */
  private emptySlotOnMap(hex: string): boolean {
    const [px, py] = hex.split("_").map(Number);
    return !!this.wm?.inOverworldGrid(this.getActiveMap(), px, py);
  }

  /** Leave a different active tool before switching to `next` (the smoke suite drives this). */
  private leaveOtherToolFor(next: DrawingMode): void {
    this.toolbar.leaveOtherToolFor(next);
  }

  /** Put the active tool down. */
  private exitCurrentMode(): void {
    this.toolbar.exitCurrentMode();
  }

  private exitTerrainMode(): void {
    this.toolbar.exitTerrainMode();
  }

  /** Open the drawing panel and the terrain picker (setup wizard). */
  openTerrainPicker(): void {
    this.toolbar.openTerrainPicker();
  }

  /** Confirm (or remove) an overworld path into its regions. */
  async runPathProjection(pathName: string, remove: boolean): Promise<void> {
    await this.toolbar.runPathProjection(pathName, remove);
  }

  /** The selected party token on this map, in Play. */
  private activeParty(): TokenEntry | undefined {
    return this.tokens.activeParty();
  }

  /** "Add to play log…" for hex (x, y) (SF3). */
  private openPlayLog(x: number, y: number): void {
    this.tokens.openPlayLog(x, y);
  }

  /** Enter calibration mode for the active map's bg image. No-op if no image. */
  enterBgCalibration(): void {
    this.calibration.enter();
  }

  /** Exit calibration. If `save`, persist the current transform. */
  async exitBgCalibration(save: boolean): Promise<void> {
    await this.calibration.exit(save);
  }

  /**
   * View teardown. If the user closes the tab/window while calibration is
   * active, persist whatever they had and tear down the banner so the next
   * view open doesn't inherit a half-dead calibration state.
   */
  async onClose(): Promise<void> {
    this.stopUndoListen?.();
    this.stopUndoListen = null;
    this.labels.dispose();
    this.grid.cancelMeasured();
    if (this.calibration.active) {
      await this.calibration.exit(true);
    }
    // Persist the viewport (zoom / pan / baked font-size) so the next view
    // open restores the exact frame we were looking at — calibration values
    // are sized to a specific zoom + font-size pair and drift wildly if those
    // are reset to defaults on reopen.
    if (this.viewportEl) {
      const map = this.plugin.getMap(this.activeMapName);
      if (map) {
        map.savedViewport = this.viewport.snapshot(this.viewportEl);
        await this.plugin.saveSettings();
      }
    }
  }

  /** Centre the view on a hex. `keepHexWidth` (on-screen px) keeps that hex
   *  size instead of zooming to the default 1.5× (crossing regions). */
  centerOnHex(x: number, y: number, keepHexWidth?: number): void {
    this.viewport.centerOnHex(x, y, keepHexWidth);
  }

  setSelectedHex(x: number, y: number): void {
    if (this.selectedHex) {
      this.viewportEl
        ?.querySelector<HTMLElement>(
          `[data-x="${this.selectedHex.x}"][data-y="${this.selectedHex.y}"]`,
        )
        ?.removeClass("is-selected");
    }
    this.selectedHex = { x, y };
    this.viewportEl
      ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
      ?.addClass("is-selected");
  }

  /**
   * The hex at a pointer position: the hex element under it, else (a press
   * in the gap between hexes or on a hex's clipped corner, which hits the
   * column/row box) the nearest hex within reach. Reads only.
   */
  private hexElAt(target: EventTarget | null, clientX: number, clientY: number): HTMLElement | null {
    const el = target instanceof HTMLElement ? target : null;
    if (!el) return null;
    const direct = el.closest<HTMLElement>(".duckmage-hex[data-x]");
    if (direct) return direct;
    const grid = el.closest<HTMLElement>(".duckmage-hex-map-grid");
    if (!grid) return null;
    const lane = el.closest<HTMLElement>(".duckmage-hex-col, .duckmage-hex-row");
    let pool: HTMLElement[];
    if (lane) {
      pool = [lane.previousElementSibling, lane, lane.nextElementSibling].flatMap((l) =>
        l instanceof HTMLElement ? Array.from(l.querySelectorAll<HTMLElement>(".duckmage-hex[data-x]")) : [],
      );
    } else if (el === grid) {
      pool = Array.from(grid.querySelectorAll<HTMLElement>(".duckmage-hex[data-x]"));
    } else {
      return null;
    }
    const boxes = pool.map((h) => {
      const r = h.getBoundingClientRect();
      return { x: Number(h.dataset.x), y: Number(h.dataset.y), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const hit = nearestHex(clientX, clientY, boxes);
    return hit ? pool.find((h) => Number(h.dataset.x) === hit.x && Number(h.dataset.y) === hit.y) ?? null : null;
  }

  /** Full DOM re-render of the grid (view/gridRenderer.ts). The optional
   *  overrides carry values not yet in the metadata cache / map store. */
  renderGrid(
    terrainOverrides?: Map<string, string | null>,
    iconOverrides?: Map<string, string | null>,
    gmIconsOverrides?: Map<string, string[]>,
  ): void {
    this.grid.renderGrid(terrainOverrides, iconOverrides, gmIconsOverrides);
  }

  private openHexEditorModal(x: number, y: number): void {
    this.setSelectedHex(x, y);
    const modal = new HexEditorModal(
      this.app,
      this.plugin,
      x,
      y,
      this.activeMapName,
      (t, i, gmIcons) => {
        if (t !== undefined || i !== undefined || gmIcons !== undefined) {
          this.renderGrid(t, i, gmIcons);
        } else {
          window.setTimeout(() => this.renderGrid(), 300);
        }
      },
      {
        gmLayerActive: this.getActiveMap().showGmLayer ?? true,
        onEnableGmLayer: () => {
          this.getActiveMap().showGmLayer = true;
          void this.plugin.saveSettings();
          this.overlayPanel?.syncToRegion();
          this.pathLayer.updateGmIcons();
        },
        onNavigate: (nx: number, ny: number) => this.setSelectedHex(nx, ny),
        onModalClose: () => {
          if (this.selectedHex) {
            this.viewportEl
              ?.querySelector<HTMLElement>(
                `[data-x="${this.selectedHex.x}"][data-y="${this.selectedHex.y}"]`,
              )
              ?.removeClass("is-selected");
            this.selectedHex = null;
          }
        },
        onSwitchMap: (name: string) => this.navigateToMap(name, { offerModule: true }),
        onNewChildMap: (hx: number, hy: number) => this.openNewSubmapSetup(hx, hy),
        onLinkExistingMap: (hx: number, hy: number) => this.nav.openLinkExistingMap(hx, hy),
        onManageLocations: (hx: number, hy: number) => this.openLocationsList(hx, hy),
        onCrossToRegion: (name: string, nx: number, ny: number) => this.nav.goToRegionHex(name, nx, ny, true),
      },
    );
    modal.open();
  }

  private async onHexClick(x: number, y: number, e?: MouseEvent): Promise<void> {
    if (this.drawingMode && !this.modeAllows(TOOL_ACTIONS[this.drawingMode])) {
      this.exitCurrentMode();
      return;
    }
    if (this.drawingMode === "path") {
      this.pathTool.click(x, y, e, this.isErasingMode);
      return;
    }
    if (this.drawingMode === "terrain") {
      this.painter.onHexPaintClick(x, y);
      return;
    }
    if (this.drawingMode === "icon") {
      this.painter.onHexIconClick(x, y);
      return;
    }
    if (this.drawingMode === "tableLink") {
      await this.painter.onHexTableLinkClick(x, y);
      return;
    }
    if (this.drawingMode === "submapLink") {
      await this.painter.onHexSubmapLinkClick(x, y);
      return;
    }
    if (this.drawingMode === "swap") {
      await this.swap.onHexSwapClick(x, y);
      return;
    }
    if (this.drawingMode === "placeToken") {
      await this.tokens.onHexTokenPlaceClick(x, y);
      return;
    }
    // The biome brush paints on press (and drag), not on click.
    if (this.drawingMode === "biome") return;

    // Play, a party token selected: a neighbouring hex is a step (SF5).
    if (!this.drawingMode && this.tokens.selectedParty && !e?.ctrlKey && !e?.metaKey && this.owView(this.getActiveMap()) !== "regions") {
      const party = this.activeParty();
      if (party && partyClick(party, `${x}_${y}`, this.plugin.settings.hexOrientation, this.getActiveStagger()) === "move") {
        await this.tokens.moveParty(party, `${x}_${y}`);
        return;
      }
    }

    // Overworlds: the full view jumps into the region at the clicked hex;
    // the biomes view (or a hex with no region yet) sets the hex's biome.
    const ow = this.owView(this.getActiveMap());
    const wm = this.wm;
    if (wm && ow && !e?.ctrlKey && !e?.metaKey) {
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      const cell = ow === "regions" && e && grid ? this.overworldLayer?.cellAt(grid, e.clientX, e.clientY) ?? null : null;
      // The brick under the pointer in the Regions view, else the hex clicked.
      const [px, py] = cell ? cell.parentHex.split("_").map(Number) : [x, y];
      const region = cell ? cell.region : regionMapAt(this.plugin.settings.maps, this.activeMapName, `${x}_${y}`)?.name;
      // Past the overworld's edge (the gap beside the bricks): nothing to set there.
      if (!region && cell && !this.emptySlotOnMap(cell.parentHex)) return;
      const act = wm.overworldLeftClick(this.getActiveMap(), !!region);
      if (act.kind === "enter" && region) {
        if (cell) this.nav.enterRegionAt(region, cell.x, cell.y);
        else this.navigateToMap(region);
      } else if (!region && this.plugin.arrival.canArrive(this.activeMapName, px, py)) {
        // Arrival on: going there makes the region from its biome (GM4).
        await this.arriveAt(px, py);
      } else if (act.kind === "place") this.hexMenu.openNewRegion(px, py);
      else if (act.kind === "hint") lockedNotice(this.plugin, this.activeMapName, act.hint);
      return;
    }

    // Ctrl/Cmd+click with no active tool: dive into the linked submap in
    // place (Up / Back return). Ctrl/Cmd+Shift+click opens it in a new tab.
    if (e?.ctrlKey || e?.metaKey) {
      const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
      const submap = getSubmapFromFile(this.app, hexPath);
      if (submap) {
        if (e.shiftKey) {
          const leaf = this.app.workspace.getLeaf("tab");
          void leaf.setViewState({ type: VIEW_TYPE_HEX_MAP }).then(() => {
            if (leaf.view instanceof HexMapView) leaf.view.navigateToMap(submap, { recordHistory: false });
          });
        } else {
          this.navigateToMap(submap);
        }
        return;
      }
      // No map there yet: arriving makes one (when the world makes places).
      if (!e.shiftKey && !ow && this.plugin.arrival.canArrive(this.activeMapName, x, y)) {
        await this.arriveAt(x, y);
        return;
      }
    }

    // No hex editor on an overworld (#49): it's the big-picture view.
    if (ow) return;
    this.openHexEditorModal(x, y);
  }

  private getActiveStagger(): "odd" | "even" {
    return this.getActiveMap().staggerOffset
      ?? this.plugin.settings.staggerOffset
      ?? "odd";
  }

  private async openRandomTableAtFile(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
    const leaf = leaves.length > 0
      ? leaves[0]
      : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES, active: true });
    await this.app.workspace.revealLeaf(leaf);
    interface WithOpenTable { openTable(path: string): void; }
    (leaf.view as unknown as WithOpenTable).openTable(file.path);
  }

  /** Show an overworld's Regions view (the terrain brush paints there). */
  private showOverworldRegions(): void {
    const map = this.getActiveMap();
    if (this.owView(map) !== "biomes") return;
    map.overworldView = "regions";
    void this.plugin.saveSettings();
    this.renderGrid();
  }

  /**
   * A map's hexes changed: rebuild that region's bitmap when it's a region
   * of the open overworld, redraw the biome marks when it's the open
   * overworld, refresh the minimap when it's the overworld behind it.
   */
  private onOverworldDataChange(map: string): void {
    const wm = this.wm;
    if (!wm) return;
    const active = this.getActiveMap();
    const home = wm.regionHome(this.plugin, active.name);
    const r = wm.overworldRefreshFor(this.plugin.getMap(map) ?? { name: map }, active.name, home?.overworld.name);
    // Any region, whatever this view shows: its bitmap is cached here too.
    if (r.invalidate) this.overworldLayer?.invalidate(r.invalidate);
    if (r.redrawLayer) this.overworldLayer?.scheduleRedraw();
    if (r.refreshMinimap) {
      if (this.minimapTimer !== null) window.clearTimeout(this.minimapTimer);
      this.minimapTimer = window.setTimeout(() => {
        this.minimapTimer = null;
        this.minimap?.render(this.contentEl, this.getActiveMap());
        // The region flower's petals are coloured by the overworld's biomes.
        this.nav.refreshSideCrumbs();
      }, 300);
    }
  }

  /** What the biome modals need from the view. */
  private biomeHost(): BiomeHost {
    return {
      app: this.app,
      plugin: this.plugin,
      enter: (name) => this.navigateToMap(name),
      changed: () => this.renderGrid(),
    };
  }

  /** Undo the last action done on this map in its current mode (WM6). */
  private async undo(): Promise<void> {
    await this.undos.undo();
  }

  private async redo(): Promise<void> {
    await this.undos.redo();
  }

  /** Wait (briefly) until every queued terrain write has landed in the map store. */
  private async terrainWritesSettled(): Promise<void> {
    await this.undos.terrainWritesSettled();
  }

  private applyPathSnapshot(mapName: string, paths: MapPath[]): Promise<void> {
    if (!this.plugin.getMap(mapName)) return Promise.resolve();
    this.pathTool.applySnapshot(mapName, paths);
    return Promise.resolve();
  }

  private updateSavingIndicator(): void {
    const count = this.writes.count;
    if (this.savingIndicatorEl) {
      if (count > 0) {
        this.savingIndicatorEl.setText(`${count} updates remaining`);
        this.savingIndicatorEl.addClass("is-active");
      } else {
        this.savingIndicatorEl.removeClass("is-active");
      }
    }
  }

}

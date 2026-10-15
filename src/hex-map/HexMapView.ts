import { ItemView, Notice, Scope, TFile, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder, getIconUrl, createIconEl } from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
} from "../frontmatter";
import type { CellEdit } from "../undoBook";
import { HexEditorModal } from "./HexEditorModal";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "../sections";
import { getSubmapFromFile } from "../frontmatter";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { MapModal } from "./MapModal";
import { PathTool } from "./pathTool";
import { allows, lockedHint, TOOL_ACTIONS, WORK_MODES, WORK_MODE_TEXT, workModeOf, type ModeAction, type WorkMode } from "../workMode";
import { canDo } from "../modeGate";
import { ModeMenu } from "./modeMenu";
import { lockedNotice } from "./godOffer";
import { partyClick } from "../play/partyTravel";
import { hexHoverLabel, pathFirst } from "./hexHover";
import { getHexNameFromFile } from "../frontmatter";
import { nearestHex } from "./hitTest";
import type { MapData, MapPath, TokenEntry } from "../types";
import { hexNeighbors } from "./hexGeometry";
import { worldMaps } from "../modules/runtime";
import type { WorldMapsApi } from "../modules/world-maps/api";
import { HexHelpModal } from "./HexHelpModal";
import { DrawingToolPanel, OverlayPanel } from "./HexSidePanel";
import { hexKeyFromBasename, linkedNotesText, linksBySection } from "./linkBadges";
import { regionMapAt } from "../maps/submaps";
// World maps (overworlds, regions, biomes, walking) through its hooks,
// typed only: worldMaps() is undefined in a build without it.
import type { OverworldLayer } from "../overworld/overworldLayer";
import type { OverworldMinimap } from "../overworld/overworldMinimap";
import type { BiomeHost } from "../overworld/BiomeModals";
import type { BiomeStroke } from "../overworld/biomePainter";
import { PainterContextMenu } from "./PainterContextMenu";

import { BackgroundCalibration } from "./view/backgroundCalibration";
import { MapViewport } from "./view/mapViewport";
import { HexWrites } from "./view/hexWrites";
import { UndoController } from "./view/undoController";
import { AreaOverlay } from "./view/areaOverlay";
import { parseGmIconsDataset, PathOverlay } from "./view/pathOverlay";
import { GridLabels } from "./view/gridLabels";
import { NeighbourShadow } from "./view/neighbourShadow";
import { MapToolbar } from "./view/mapToolbar";
import { MapInput } from "./view/mapInput";
import { MapNavigation } from "./view/mapNavigation";
import { HexContextMenu } from "./view/hexContextMenu";
import { TokenLayer } from "./view/tokenLayer";
import { GridEdgeButtons } from "./view/gridEdgeButtons";
import { HexSwap } from "./view/hexSwap";
import { GridRenderer, setHexColor } from "./view/gridRenderer";
import type { DrawingMode } from "./toolMode";
import type { IconUndoEntry, TokenSnap } from "./undoItems";

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
  /** On-map "which tool is on" bar (fresh-eyes T3). */
  private get modeBarEl(): HTMLElement | null { return this.toolbar.modeBarEl; }
  /** Toolbar rows (and the mode bar) along the top of the map: hexes are
   *  kept out from under them (see safeArea.ts). */
  private topBandEls: HTMLElement[] = [];
  /** The open (or last) right-click tool menu, so Esc can close it first. */
  private get painterMenu(): PainterContextMenu | null { return this.toolbar.painterMenu; }
  /** The biome brush's stroke being painted (overworlds only). */
  private biomeStroke: BiomeStroke<CellEdit> | null = null;
  private overlayPanel: OverlayPanel | null = null;
  private toolsPanel: DrawingToolPanel | null = null;
  /** The path tool: drawing, selecting, reshaping (src/hex-map/pathTool.ts). */
  private pathTool: PathTool;
  private brushHoverHexes: Array<[number, number]> = [];
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
  /** The "no region here" hint was shown this stroke (once is enough). */
  private subStrokeMissHinted = false;
  /** Overworlds (OW1): every region's hexes stitched on one canvas, and the minimap. */
  private overworldLayer: OverworldLayer | undefined;
  private minimap: OverworldMinimap | undefined;
  private minimapTimer: number | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  activeMapName = "default";

  /** Path types the active map can draw: its palette's. */
  private mapPathTypes() {
    return this.plugin.getMapPathTypes(this.activeMapName);
  }
  /** Set when another view/window mutated shared state while this view was
   *  inactive; consumed by a re-render on next activation (issue #32). */
  private needsRerender = false;
  /** Moving between maps: history, crumbs, arrows, neighbours (view/mapNavigation.ts). */
  private nav: MapNavigation;
  /** The hex right-click menus (view/hexContextMenu.ts). */
  private hexMenu: HexContextMenu;
  private mapBtn: HTMLButtonElement | null = null;
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
      undoButtons: () => ({ undo: this.undoBtn, redo: this.redoBtn }),
      applyTerrainToHexEl: (el, t) => this.applyTerrainToHexEl(el, t),
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
        top: this.topBandEls.filter((el) => el.isConnected),
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
      finishBiomeStroke: () => this.finishBiomeStroke(),
      updateBrushHighlight: (x, y) => this.updateBrushHighlight(x, y),
      showOverworldRegions: () => this.showOverworldRegions(),
      nextTokenFill: () => this.tokens.nextTokenFill(),
      renderGrid: () => this.renderGrid(),
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
      resetSubStrokeHint: () => { this.subStrokeMissHinted = false; },
      biomeStroke: () => this.biomeStroke,
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
      labelHex: (el) => this.labelHex(el),
      updateBrushHighlight: (x, y) => this.updateBrushHighlight(x, y),
      onHexClick: (x, y, e) => this.onHexClick(x, y, e),
      onHexContextMenu: (e, x, y) => this.hexMenu.onHexContextMenu(e, x, y),
      onHexPaintClick: (x, y) => this.onHexPaintClick(x, y),
      onHexIconClick: (x, y) => this.onHexIconClick(x, y),
      removeOneGmIconFromHex: (el, x, y, icon) => this.removeOneGmIconFromHex(el, x, y, icon),
      overworldHexKeyAt: (t, x, y) => this.overworldHexKeyAt(t, x, y),
      startBiomeStroke: () => this.startBiomeStroke(),
      finishBiomeStroke: () => this.finishBiomeStroke(),
      subHexKeyAt: (x, y) => this.subHexKeyAt(x, y),
      paintSubHexAt: (x, y) => this.paintSubHexAt(x, y),
    });
    this.nav = new MapNavigation(this.plugin, {
      activeMapName: () => this.activeMapName,
      viewportEl: () => this.viewportEl,
      mapBtn: () => this.mapBtn,
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
      linkTableToHex: (x, y, file) => this.linkTableToHex(x, y, file),
      openRandomTableAtFile: (file) => this.openRandomTableAtFile(file),
      onHexSwapClick: (x, y) => this.swap.onHexSwapClick(x, y),
      paintOne: (x, y, terrain) => this.paintOne(x, y, terrain),
      removeIconOverride: (x, y) => this.removeIconOverride(x, y),
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
      labelHex: (el, t, p) => this.labelHex(el, t, p),
      applyTerrainToHexEl: (el, t) => this.applyTerrainToHexEl(el, t),
      emptySlotOnMap: (hex) => this.emptySlotOnMap(hex),
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
    this.needsRerender = true;
  }

  private updateMapBtnLabel(): void {
    this.mapBtn?.setText(`${this.plugin.mapLabel(this.activeMapName)} ▾`);
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
    this.updateMapBtnLabel();
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

    // View-scoped Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) via the
    // view's keymap Scope: Obsidian activates it only while this view is
    // active, in whichever window hosts it — unlike a document-level keydown
    // registered against onOpen-time `activeDocument`, which goes stale when
    // the tab is moved to a popout window (issue #32).
    this.scope = new Scope(this.app.scope);
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

    // clipEl clips the panning viewport; controlsEl overlays buttons without clipping
    const clipEl = contentEl.createDiv({ cls: "duckmage-hex-map-clip" });
    const controlsEl = contentEl.createDiv({
      cls: "duckmage-hex-map-controls",
    });
    this.controlsEl = controlsEl;

    this.viewportEl = clipEl.createDiv({ cls: "duckmage-hex-map-viewport" });
    this.viewport.applyTransform();

    this.toolbar.buildModeBar(controlsEl);

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

    this.grid.factionTooltipEl = contentEl.createDiv({ cls: "duckmage-faction-tooltip" });
    this.grid.factionTooltipEl.hide();

    // Pointer input: hover, wheel zoom, pan, paint strokes, tool menus (view/mapInput.ts).
    this.input.attach(contentEl, clipEl);

    // Expand buttons and view buttons — always visible (not collapsible)
    this.edges.createExpandButtons(controlsEl);

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
      new MapModal(this.app, this.plugin, this, () => {
        this.exitTerrainMode();
        this.toolbar.exitPathMode();
        this.undos.updateUndoButton();
        this.updateMapBtnLabel();
        this.nav.refreshMapNav();
        this.refreshViewHeader();
        this.renderGrid();
      }).open(),
    );

    this.workModeBtn = mapNavGroup.createEl("button", { cls: "duckmage-work-mode-btn" });
    this.workModeBtn.addEventListener("click", (e) => this.openWorkModeMenu(e));
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

    // Saving indicator — appears while background writes are in flight
    this.savingIndicatorEl = controlsEl.createSpan({
      cls: "duckmage-saving-indicator",
      text: "Saving…",
    });

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

  /** The overworld hex under a point: the brick's parent hex in the Regions view, else the hex there. */
  private overworldHexKeyAt(target: EventTarget | null, clientX: number, clientY: number): string | null {
    const view = this.owView(this.getActiveMap());
    if (!view) return null;
    if (view === "regions") {
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      const cell = grid ? this.overworldLayer?.cellAt(grid, clientX, clientY) ?? null : null;
      return cell?.parentHex ?? null;
    }
    const hexEl = this.hexElAt(target, clientX, clientY);
    return hexEl ? `${hexEl.dataset.x}_${hexEl.dataset.y}` : null;
  }

  /** A new painter stroke on the open overworld (the last one finishes first). */
  private startBiomeStroke(): void {
    void this.finishBiomeStroke();
    const map = this.activeMapName;
    const biome = this.paintBiomeId;
    const wm = this.wm;
    if (!biome || !wm) return;
    this.biomeStroke = new wm.BiomeStroke<CellEdit>(async (key) => {
      const [px, py] = key.split("_").map(Number);
      const r = await wm.paintBiomeHex(this.plugin, map, px, py, biome);
      if ((r.step === "place" || r.step === "reshape") && !r.error && this.activeMapName === map) {
        // Show it now: the hex's overworld terrain and the layer (labels, region bricks).
        const el = this.viewportEl?.querySelector<HTMLElement>(`.duckmage-hex[data-x="${px}"][data-y="${py}"]`);
        if (el) this.applyTerrainToHexEl(el, this.plugin.mapStore.get(map, key)?.terrain ?? null);
        this.overworldLayer?.scheduleRedraw();
      }
      return r;
    });
  }

  /**
   * End the painter's stroke: once its hexes are done, one undo entry for
   * the regions it remade (in the overworld's queue for its mode), the
   * mode's hint if some hexes were locked, and a redraw.
   */
  private async finishBiomeStroke(): Promise<void> {
    const stroke = this.biomeStroke;
    if (!stroke) return;
    this.biomeStroke = null;
    const map = this.activeMapName;
    const r = await stroke.finish();
    if (r.edits.length) {
      this.undos.pushUndo({ kind: "cells", edits: r.edits }, map);
      this.undos.updateUndoButton();
    }
    // A placed biome is God's to change: that hint offers the switch.
    for (const h of r.hints) lockedNotice(this.plugin, map, h);
    if (r.errors.length) new Notice(r.errors[0]);
    // One notice per stroke for what it made ("Made Demo Bricks 2, 4.").
    const said = this.wm?.strokeNotice(r, (n) => this.plugin.mapLabel(n));
    if (said) new Notice(said);
    if ((r.changed || r.made.length) && this.activeMapName === map) this.renderGrid();
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
      this.onHexPaintClick(x, y);
      return;
    }
    if (this.drawingMode === "icon") {
      this.onHexIconClick(x, y);
      return;
    }
    if (this.drawingMode === "tableLink") {
      await this.onHexTableLinkClick(x, y);
      return;
    }
    if (this.drawingMode === "submapLink") {
      await this.onHexSubmapLinkClick(x, y);
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

  private getBrushHexes(x: number, y: number): [number, number][] {
    const center: [number, number] = [x, y];
    // Only terrain paints with a brush; every other tool works on one hex.
    if (this.paintBrushSize === 1 || this.drawingMode !== "terrain") return [center];
    const nb = hexNeighbors(x, y, this.plugin.settings.hexOrientation, this.getActiveStagger());
    // nb[2] and nb[3] are always adjacent to each other AND to center in both
    // orientations (verified from offset tables), forming a compact triangle.
    if (this.paintBrushSize === 3) return [center, nb[2], nb[3]];
    return [center, ...nb];
  }

  private updateBrushHighlight(x: number | null, y: number | null): void {
    for (const [hx, hy] of this.brushHoverHexes) {
      this.viewportEl
        ?.querySelector<HTMLElement>(`[data-x="${hx}"][data-y="${hy}"]`)
        ?.removeClass("duckmage-hex-brush-hover");
    }
    this.brushHoverHexes = [];
    if (x === null || y === null) return;
    this.brushHoverHexes = this.getBrushHexes(x, y);
    for (const [hx, hy] of this.brushHoverHexes) {
      this.viewportEl
        ?.querySelector<HTMLElement>(`[data-x="${hx}"][data-y="${hy}"]`)
        ?.addClass("duckmage-hex-brush-hover");
    }
  }

  private onHexPaintClick(x: number, y: number): void {
    if (this.drawingMode !== "terrain") return;

    // Eyedropper pick mode: sample this hex's terrain and switch to painting it
    if (this.terrainPickMode && !this.isErasingMode) {
      const sampled = getTerrainFromFile(
        this.app,
        this.plugin.hexPath(x, y, this.activeMapName),
      );
      this.terrainPickMode = false;
      this.paintTerrainName = sampled;
      this.toolbar.updateToolbarButtonStates();
      return;
    }

    const terrain = this.isErasingMode ? null : this.paintTerrainName;
    const palette = this.plugin.getMapPalette(this.activeMapName);
    const entry =
      terrain != null ? palette.find((p) => p.name === terrain) : undefined;

    for (const [hx, hy] of this.getBrushHexes(x, y)) {
      // ── Immediate visual update — no waiting for file I/O ───────────────
      const hexEl = this.viewportEl?.querySelector<HTMLElement>(
        `[data-x="${hx}"][data-y="${hy}"]`,
      );
      if (hexEl) {
        setHexColor(hexEl, entry?.color);
        hexEl.querySelector(".duckmage-hex-icon")?.remove();
        hexEl.querySelector(".duckmage-hex-dot")?.remove();
        if (entry?.icon) {
          const iconEl = createIconEl(
            hexEl,
            getIconUrl(this.plugin, entry.icon),
            entry.name,
            entry.iconColor,
            "duckmage-hex-icon",
          );
          hexEl.insertBefore(
            iconEl,
            hexEl.querySelector(".duckmage-hex-dot"),
          );
        }
        if (terrain !== null) hexEl.addClass("duckmage-hex-exists");
        // The pointer is usually still on this hex: refresh its label now (S18).
        this.labelHex(hexEl, terrain);
      }

      // ── Queue background file write (coalescing per-hex) ────────────────
      const path = this.plugin.hexPath(hx, hy, this.activeMapName);
      if (this.undos.currentTerrainStroke) {
        if (!this.undos.currentTerrainStroke.has(path)) {
          // The terrain before this stroke: a write still queued for the
          // hex, else the map data (the map note, via the store). Hex-note
          // frontmatter no longer holds terrain, so reading it made undo
          // clear a repainted hex instead of restoring it (smoke suite C6).
          const pending = this.writes.terrain.peek(path);
          const oldTerrain = pending ? pending.terrain : getTerrainFromFile(this.app, path);
          this.undos.currentTerrainStroke.set(path, {
            x: hx,
            y: hy,
            path,
            oldTerrain,
            newTerrain: terrain,
          });
        } else {
          this.undos.currentTerrainStroke.get(path)!.newTerrain = terrain;
        }
      }
      this.writes.terrain.schedule(path, { x: hx, y: hy, terrain });
    }
  }

  /**
   * Remove one occurrence of `icon` from this hex's GM-icon stack.
   * No-op if the icon isn't present. Records an undo entry so the
   * removal can be reversed. Used by the GM-paint right-click handler
   * — the inverse of the additive left-click paint.
   */
  private removeOneGmIconFromHex(
    hexEl: HTMLElement,
    x: number,
    y: number,
    icon: string,
  ): void {
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const priorList = parseGmIconsDataset(hexEl.dataset.gmIcons);
    const idx = priorList.lastIndexOf(icon);
    if (idx === -1) return; // nothing to remove
    const newList = [...priorList];
    newList.splice(idx, 1);

    // Record undo as a one-hex stroke. Same shape the painter uses.
    const undoEntry: IconUndoEntry = {
      x, y, path,
      oldIcon: priorList[0] ?? null,
      newIcon: newList[0] ?? null,
      isGm: true,
      oldGmList: priorList,
      newGmList: newList,
    };
    this.undos.pushUndo({ kind: "icon", entries: [undoEntry] });
    this.undos.updateUndoButton();

    if (newList.length > 0) {
      hexEl.dataset.gmIcons = JSON.stringify(newList);
    } else {
      delete hexEl.dataset.gmIcons;
    }
    this.pathLayer.updateGmIcons();
    this.writes.gmIcons.schedule(path, { x, y, list: [...newList] });
  }

  private onHexIconClick(x: number, y: number): void {
    if (this.drawingMode !== "icon") return;
    const icon = this.isErasingMode ? null : this.paintIconName;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );

    if (this.paintIconGmOnly) {
      // ── GM icon paint — APPEND mode (hexmaker#28). Each click adds
      // one of the selected icon to the hex's list (count goes up on
      // repeats). Eraser mode clears the entire list. The full list is
      // tracked on the stroke for proper undo (restores the pre-stroke
      // list verbatim, including duplicates).
      const priorList = parseGmIconsDataset(hexEl?.dataset.gmIcons);
      // First touch of this hex during the current stroke records the
      // pre-stroke list once; subsequent touches keep that snapshot and
      // only update the new list.
      let strokeEntry = this.undos.currentIconStroke?.get(path);
      if (!strokeEntry) {
        strokeEntry = {
          x, y, path,
          oldIcon: priorList[0] ?? null,
          newIcon: null,
          isGm: true,
          oldGmList: [...priorList],
          newGmList: [...priorList],
        };
        this.undos.currentIconStroke?.set(path, strokeEntry);
      }
      let newList: string[];
      if (this.isErasingMode) {
        // Eraser clears all GM icons on the hex.
        newList = [];
      } else if (icon) {
        newList = [...(strokeEntry.newGmList ?? priorList), icon];
      } else {
        newList = strokeEntry.newGmList ?? priorList;
      }
      strokeEntry.newGmList = newList;
      strokeEntry.newIcon = newList[0] ?? null; // keep legacy field consistent
      if (hexEl) {
        if (newList.length > 0) {
          hexEl.dataset.gmIcons = JSON.stringify(newList);
          hexEl.addClass("duckmage-hex-exists");
        } else {
          delete hexEl.dataset.gmIcons;
        }
      }
      this.pathLayer.updateGmIcons();
      this.writes.gmIcons.schedule(path, { x, y, list: [...newList] });
    } else {
      // ── Regular icon override ────────────────────────────────────────────
      if (this.undos.currentIconStroke && !this.undos.currentIconStroke.has(path)) {
        this.undos.currentIconStroke.set(path, {
          x, y, path,
          oldIcon: hexEl?.dataset.iconOverride ?? null,
          newIcon: icon,
          isGm: false,
        });
      } else {
        const existing = this.undos.currentIconStroke?.get(path);
        if (existing) existing.newIcon = icon;
      }
      if (hexEl) {
        hexEl.querySelector(".duckmage-hex-icon")?.remove();
        if (icon) {
          const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
          img.src = getIconUrl(this.plugin, icon);
          img.alt = icon;
          hexEl.insertBefore(img, hexEl.querySelector(".duckmage-hex-dot"));
          hexEl.dataset.iconOverride = icon;
        } else {
          delete hexEl.dataset.iconOverride;
        }
        if (icon !== null) hexEl.addClass("duckmage-hex-exists");
      }
      this.pathLayer.updatePathOverlay();
      this.writes.icon.schedule(path, { x, y, icon });
    }
  }

  private async onHexTableLinkClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "tableLink" || !this.paintTablePath) return;
    const tableFile = this.app.vault.getAbstractFileByPath(this.paintTablePath);
    if (!(tableFile instanceof TFile)) return;
    if (this.isErasingMode) {
      const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
      const target = this.app.metadataCache.fileToLinktext(tableFile, hexPath);
      await removeLinkFromSection(this.app, hexPath, "Encounters Table", target);
      return;
    }
    await this.linkTableToHex(x, y, tableFile);
  }

  private async onHexSubmapLinkClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "submapLink") return;
    if (this.isErasingMode) {
      await this.plugin.unlinkSubmap(this.activeMapName, x, y, this.paintSubmapName ?? undefined);
      this.renderGrid();
      return;
    }
    if (!this.paintSubmapName) return;
    await this.plugin.linkSubmap(this.activeMapName, x, y, this.paintSubmapName);
    this.renderGrid();

    // Visual feedback: ripple blip on the linked hex
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) {
      const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
      blip.addEventListener("animationend", () => blip.remove(), { once: true });
    }
  }

  private async linkTableToHex(x: number, y: number, tableFile: TFile): Promise<void> {
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);

    // Ensure the hex note exists
    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y, this.activeMapName);
      if (!(hexFile instanceof TFile)) return;
    }

    const target = this.app.metadataCache.fileToLinktext(tableFile, hexPath);
    const linkText = `[[${target}]]`;

    // Idempotent — only add if not already present
    const existing = await getLinksInSection(this.app, hexPath, "Encounters Table");
    if (existing.includes(target)) {
      new Notice(`Already linked on hex ${x}, ${y}`);
      return;
    }

    await addLinkToSection(this.app, hexPath, "Encounters Table", linkText);

    // Visual feedback: badge + ripple blip on the hex
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) {
      hexEl.addClass("duckmage-hex-table-linked");
      hexEl.addClass("duckmage-hex-exists");
      const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
      blip.addEventListener("animationend", () => blip.remove(), { once: true });
    }
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

  /**
   * A hex's tooltip / accessible name: name, terrain, coords, links.
   * `terrain` (when given) is the terrain just painted, ahead of its queued
   * write; otherwise a queued write wins over the saved map data. Called on
   * hover and right after a repaint (round 7 S18: the label said "void (map
   * base)" until the hex was hovered again).
   */
  private labelHex(hexEl: HTMLElement, terrain?: string | null, path?: string): void {
    const x = Number(hexEl.dataset.x);
    const y = Number(hexEl.dataset.y);
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    const pending = this.writes.terrain.peek(hexPath);
    const own = terrain !== undefined ? terrain : pending ? pending.terrain : getTerrainFromFile(this.app, hexPath);
    // The notes it links (towns, dungeons…), from the metadata cache (S3).
    const note = this.app.vault.getAbstractFileByPath(hexPath);
    const linked = note instanceof TFile ? linkedNotesText(linksBySection(this.app.metadataCache.getFileCache(note)), this.plugin.sectionWordsFor(this.activeMapName)) : "";
    // Biomes view: the region outline is hidden (every hex has one), so the
    // tooltip names the hex's region instead.
    const regionMap = this.owView(this.getActiveMap()) === "biomes" ? this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`)?.regionMap : undefined;
    const region = regionMap && this.plugin.getMap(regionMap) ? this.plugin.mapLabel(regionMap) : null;
    const label = pathFirst(path, hexHoverLabel(x, y, own, this.getActiveMap().baseTerrain ?? null, getHexNameFromFile(hexPath), linked, region));
    if (hexEl.title !== label) {
      hexEl.title = label;
      hexEl.setAttr("aria-label", label);
    }
  }

  private applyTerrainToHexEl(
    hexEl: HTMLElement,
    terrain: string | null,
  ): void {
    // Undo/redo repaints too: keep the hover label in step (S18).
    if (hexEl.title) this.labelHex(hexEl, terrain);
    const palette = this.plugin.getMapPalette(this.activeMapName);
    const entry =
      terrain != null ? palette.find((p) => p.name === terrain) : undefined;
    setHexColor(hexEl, entry?.color);
    hexEl.querySelector(".duckmage-hex-icon")?.remove();
    hexEl.querySelector(".duckmage-hex-dot")?.remove();
    if (entry?.icon) {
      try {
        const iconEl = createIconEl(
          hexEl,
          getIconUrl(this.plugin, entry.icon),
          entry.name,
          entry.iconColor,
          "duckmage-hex-icon",
        );
        hexEl.insertBefore(iconEl, hexEl.querySelector(".duckmage-hex-dot"));
      } catch (err) {
        console.warn(
          `[hexmaker] failed to render icon for terrain "${terrain}":`,
          err,
        );
      }
    }
    if (terrain !== null) hexEl.addClass("duckmage-hex-exists");
    else hexEl.removeClass("duckmage-hex-exists");
  }

  /** "x_y" of the region hex under a screen point in the full view (null: none). */
  private subHexKeyAt(clientX: number, clientY: number): string | null {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = grid ? this.overworldLayer?.cellAt(grid, clientX, clientY) ?? null : null;
    return cell ? `${cell.x}_${cell.y}` : null;
  }

  /**
   * Paint the region hex under a screen point (full view): written to that
   * region's map and locked, so regenerating the region keeps it. A brush
   * wider than one hex reaches across seams into the next region.
   */
  private paintSubHexAt(clientX: number, clientY: number): string | null {
    const wm = this.wm;
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = grid ? this.overworldLayer?.cellAt(grid, clientX, clientY) ?? null : null;
    if (!cell || !wm) return null;
    const ow = this.activeMapName;
    const owInfo = wm.overworldOf(this.plugin, ow);
    if (!owInfo) return null;
    const layout = owInfo.layout;
    if (this.terrainPickMode && !this.isErasingMode) {
      if (!cell.region) return null;
      this.terrainPickMode = false;
      this.paintTerrainName = this.plugin.mapStore.get(cell.region, `${cell.x}_${cell.y}`)?.terrain ?? null;
      this.toolbar.updateToolbarButtonStates();
      return null;
    }
    const terrain = this.isErasingMode ? null : this.paintTerrainName;
    // Each brushed cell goes into the region map that holds it (across
    // seams), written now so the layer, the minimap and any open view of
    // that region update during the stroke. Painted cells are locked.
    const { targets, missed } = wm.paintTargets(
      layout,
      wm.brushCells(layout, cell.x, cell.y, this.paintBrushSize),
      (hex) => regionMapAt(this.plugin.settings.maps, ow, hex)?.name,
    );
    if (!targets.length && missed && !this.subStrokeMissHinted) {
      this.subStrokeMissHinted = true;
      new Notice(wm.PAINT_NO_REGION_HINT);
    }
    for (const { map, key } of targets) {
      const cur = this.plugin.mapStore.get(map, key);
      const id = `${map}|${key}`;
      const prev = this.undos.currentSubStroke?.get(id);
      if (prev) prev.newTerrain = terrain;
      else this.undos.currentSubStroke?.set(id, { map, key, oldTerrain: cur?.terrain ?? null, oldLocked: !!cur?.locked, newTerrain: terrain });
      if (cur?.terrain === terrain && !!cur?.locked === !!terrain) continue;
      // A hand edit of the region (paint-terrain): it locks a new region (modeGate.noteHandEdit).
      this.plugin.mapStore.set(map, key, { terrain, locked: terrain ? true : null }, "paint-terrain");
    }
    return `${cell.x}_${cell.y}`;
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

  /** Set (or clear) one hex's terrain from a menu: mode-gated and undoable. */
  private paintOne(x: number, y: number, terrain: string | null): void {
    if (!this.modeAllows("paint-terrain")) return;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const old = getTerrainFromFile(this.app, path);
    if (old === terrain) return;
    this.undos.pushUndo({ kind: "terrain", entries: [{ x, y, path, oldTerrain: old, newTerrain: terrain }] });
    this.writes.terrain.schedule(path, { x, y, terrain });
    this.renderGrid();
  }

  /** "Remove icon override" from the hex menu: mode-gated and undoable. */
  private removeIconOverride(x: number, y: number): void {
    if (!this.modeAllows("paint-icon")) return;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const old = getIconOverrideFromFile(this.app, path);
    if (!old) return;
    this.undos.pushUndo({ kind: "icon", entries: [{ x, y, path, oldIcon: old, newIcon: null, isGm: false }] });
    this.writes.icon.schedule(path, { x, y, icon: null });
    this.renderGrid(undefined, new Map([[path, null]]));
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

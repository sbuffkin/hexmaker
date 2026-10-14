import { ItemView, Notice, Scope, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { COPY_HEX_LINK_TITLE, copyHexLink } from "./copyHexLink";
import { normalizeFolder, getIconUrl, createIconEl } from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  getFrontMatter,
  terrainFromFm,
  pendingTerrainOf,
  iconOverrideFromFm,
  gmIconsFromFm,
  readTokenPlace,
} from "../frontmatter";
import type { CellEdit } from "../undoBook";
import { HexEditorModal } from "./HexEditorModal";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "../sections";
import { getFactionColorFromFile, getSubmapFromFile, getHexMapsFromFile } from "../frontmatter";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { MapModal, renderMissingActions } from "./MapModal";
import { mapAncestors } from "./submapNav";
import { ancestorNeighbourCrumbs, neighbourCrumbs } from "../maps/mapTree";
import { PathTool } from "./pathTool";
import { flowerLayout, flowerPetals, MapHistory, navArrows, neighbourButton, PAD_SIDES, padButtonText } from "../maps/mapNav";
import { ADD_REGION_LOCKED_HINT, allows, canAdd, canRerollPlace, lockedHint, TOOL_ACTIONS, WORK_MODES, WORK_MODE_TEXT, workModeOf, type MenuActionId, type ModeAction, type WorkMode } from "../workMode";
import { canDo, guardWrite } from "../modeGate";
import { ModeMenu, type ModeMenuOptions } from "./modeMenu";
import { lockedNotice } from "./godOffer";
import { openNoteFocused } from "../openNote";
import { coordHaloColor } from "../coordStyle";
import { watchBiomesPathHover } from "./biomesPathHover";
import { mayAutoPan, revealDelta, usableInsets } from "./safeArea";
import { groupSize, pickTokenFill, tokenCoordShift, tokenGroupOffsets, tokenNamePlacement, tokenNameSide } from "./tokenDefaults";
import { markVisited, parseVisited, partyClick, unmarkVisited } from "../play/partyTravel";
import { addToPlayLog } from "../play/playLogWriter";
import { PlayLogModal } from "../play/PlayLogModal";
import { hexHoverLabel, hexKeyCoords, pathFirst, regionsViewTip } from "./hexHover";
import { whenSized } from "./whenSized";
import { getHexNameFromFile } from "../frontmatter";
import { nearestHex } from "./hitTest";
import type { MapData, MapPath, TokenEntry } from "../types";
import { hexNeighbors } from "./hexGeometry";
import { moduleHexMenu, moduleUnchartedKeys, runPartyEntered, worldMaps } from "../modules/runtime";
import type { WorldMapsApi } from "../modules/world-maps/api";
import { HexHelpModal } from "./HexHelpModal";
import { FolderTreePickerModal } from "./FolderTreePickerModal";
import { DrawingToolPanel, OverlayPanel } from "./HexSidePanel";
import { renderUnchartedLayer, unchartedKeys } from "./unchartedLayer";
import { hexKeyFromBasename, linkedNotesText, linksBySection } from "./linkBadges";
import { TokenModal } from "./TokenModal";
import { SubmapPickerModal } from "./SubmapPickerModal";
import { LocationsModal } from "./LocationsModal";
import { startNewChildMap, startNewLocation, type NewChildMapHost } from "./newChildMap";
import { hexChildMaps, newMapItemTitle, parentHexTerrain, regionMapAt, submapKindLabel, submapMenuPlan } from "../maps/submaps";
import { recipeOf } from "../worldgen/freshMap";
// World maps (overworlds, regions, biomes, walking) through its hooks,
// typed only: worldMaps() is undefined in a build without it.
import type { OverworldLayer } from "../overworld/overworldLayer";
import type { OverworldMinimap } from "../overworld/overworldMinimap";
import type { BiomeHost } from "../overworld/BiomeModals";
import type { BiomeStroke } from "../overworld/biomePainter";
import type { OverworldWalk } from "../overworld/WalkRegionModal";
import { FrameThrottle } from "../frameThrottle";
import { terrainDiff } from "./terrainDiff";
import type { Side } from "../worldgen/world";
import { neighbourSpec } from "../worldgen/neighbours";
import { TokenInfoModal } from "./TokenInfoModal";
import {
  getTokenDataFromCache,
  applyTokenFrontmatter,
  removeTokenFrontmatter,
  setTokenHex,
} from "../frontmatter";
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
import type { DrawingMode } from "./toolMode";
import type { IconUndoEntry, TokenSnap, UndoItem } from "./undoItems";

function nullOverrides(paths: string[]): Map<string, null> {
  return new Map(paths.map((p) => [p, null]));
}

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
  /** Cancels a renderGrid waiting for the grid to get a layout size. */
  private cancelMeasuredLayers: (() => void) | null = null;
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
  private get swapSource(): { x: number; y: number } | null { return this.toolbar.swapSource; }
  private set swapSource(v: { x: number; y: number } | null) { this.toolbar.swapSource = v; }
  private get swapDest(): { x: number; y: number } | null { return this.toolbar.swapDest; }
  private set swapDest(v: { x: number; y: number } | null) { this.toolbar.swapDest = v; }
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
  private factionTooltipEl: HTMLElement | null = null;
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
  /**
   * A region map's terrain as this view last drew it, so a brush stroke on
   * its overworld (in another view) repaints just the hexes it changed, live.
   * Empty for other maps.
   */
  private shownTerrain = new Map<string, string | null>();
  private terrainSync = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
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
  /** Back / Forward between maps, like a browser. */
  private history = new MapHistory();
  private mapBtn: HTMLButtonElement | null = null;
  /** ← ↑ →: always in that order, glyphs only (see mapNav.ts). */
  private navArrowsEl: HTMLElement | null = null;
  /** The map's work mode (Play / Build / God), always shown. */
  private workModeBtn: HTMLButtonElement | null = null;
  /** Reroll / Lock for a place made on arrival (refreshArrivalBar). */
  private arrivalBarEl: HTMLElement | null = null;
  private crumbsEl: HTMLElement | null = null;
  /** Sideways crumbs: the neighbouring regions of the open map. */
  private sideCrumbsEl: HTMLElement | null = null;
  private tokenEntries: TokenEntry[] = [];
  /** The party token selected in Play (its note path): a click on a neighbouring hex moves it (SF5). */
  private selectedParty: string | null = null;
  /** Where a party token was just moved, until the metadata cache has the write (path → "x_y"). */
  private partyMoves = new Map<string, string>();

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
        this.goToRegionHex(map, x, y);
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
      executeHexSwap: (x1, y1, x2, y2, u) => this.executeHexSwap(x1, y1, x2, y2, u),
      applyPathSnapshot: (m, p) => this.applyPathSnapshot(m, p),
      applyTokenSnap: (p, snap) => this.applyTokenSnap(p, snap),
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
      goToRegionHex: (map, x, y) => this.goToRegionHex(map, x, y),
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
      measuring: () => !!this.cancelMeasuredLayers,
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
        this.updateTokenLayer();
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
      nextTokenFill: () => this.nextTokenFill(),
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
      onHexContextMenu: (e, x, y) => this.onHexContextMenu(e, x, y),
      onHexPaintClick: (x, y) => this.onHexPaintClick(x, y),
      onHexIconClick: (x, y) => this.onHexIconClick(x, y),
      removeOneGmIconFromHex: (el, x, y, icon) => this.removeOneGmIconFromHex(el, x, y, icon),
      overworldHexKeyAt: (t, x, y) => this.overworldHexKeyAt(t, x, y),
      startBiomeStroke: () => this.startBiomeStroke(),
      finishBiomeStroke: () => this.finishBiomeStroke(),
      subHexKeyAt: (x, y) => this.subHexKeyAt(x, y),
      paintSubHexAt: (x, y) => this.paintSubHexAt(x, y),
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

  private missingEl: HTMLElement | null = null;

  /** Show (true) or clear (false) the missing-map empty state for the open map. */
  private renderMissingState(): boolean {
    this.missingEl?.remove();
    this.missingEl = null;
    const name = this.activeMapName;
    if (!this.plugin.mapStore.isMissing(name) || !this.controlsEl) return false;
    const box = this.controlsEl.createDiv({ cls: "duckmage-map-missing-state" });
    this.missingEl = box;
    box.createEl("h3", { text: `${this.plugin.mapLabel(name)} is missing` });
    box.createEl("p", { text: `Its folder and map note (${this.plugin.mapStore.notePath(name)}) were deleted. Restore writes the note back from the last saved copy; Remove drops the map from the list. No file is deleted.` });
    renderMissingActions(box, this.plugin, name, () => this.renderGrid());
    return true;
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
    this.refreshMapNav();
  }

  /**
   * The one way to change maps from the UI (map list, breadcrumb, submap
   * badge, Ctrl+click, context menu, hex editor, Up/Back targets). Exits the
   * active tool and clears undo — undo entries hold bare x/y and would apply
   * to the wrong map — and records history for Back. `offerModule`: the map
   * was picked on purpose (maps picker, region menu), so offer to turn its
   * module on when it's off (CM6). Never set from "New …" flows.
   */
  navigateToMap(name: string, opts: { recordHistory?: boolean; offerModule?: boolean } = {}): void {
    if (!this.plugin.getMap(name)) {
      new Notice(`Map "${name}" no longer exists.`);
      return;
    }
    if (name === this.activeMapName) {
      this.renderGrid();
      return;
    }
    this.exitCurrentMode();
    this.toolbar.exitPathMode();
    if (opts.recordHistory !== false) this.history.visit(this.activeMapName);
    this.switchToMap(name);
    // Each map keeps its own undo queues (WM6): show the new map's.
    this.undos.updateUndoButton();
    if (opts.offerModule) this.plugin.offerModuleFor(name);
  }

  /**
   * Open map `name` centred on hex (x, y), the hex flashed and selected: a
   * hex link (src/hexLink.ts, copied from the hex editor's centre dot).
   * Waits for the grid to be drawn and sized (a freshly opened view).
   */
  goToHex(name: string, x: number, y: number, opts: { recordHistory?: boolean } = {}): void {
    if (!this.plugin.getMap(name)) {
      new Notice(`Map "${name}" no longer exists.`);
      return;
    }
    if (name !== this.activeMapName) this.navigateToMap(name, opts);
    let tries = 0;
    const attempt = () => {
      if (this.activeMapName !== name) return;
      const clip = this.viewportEl?.parentElement;
      const hexEl = this.viewportEl?.querySelector(`[data-x="${x}"][data-y="${y}"]`);
      if ((!hexEl || !clip || clip.clientWidth === 0) && ++tries < 25) {
        window.setTimeout(attempt, 80);
        return;
      }
      this.setSelectedHex(x, y);
      this.centerOnHex(x, y);
      this.flashHex(x, y);
    };
    window.setTimeout(attempt, 80);
  }

  /** Back to the previously viewed map (skips maps deleted since). */
  navigateBack(): boolean {
    const prev = this.history.goBack(this.activeMapName, (m) => !!this.plugin.getMap(m));
    if (!prev) {
      this.refreshMapNav();
      return false;
    }
    this.navigateToMap(prev, { recordHistory: false });
    return true;
  }

  /** Forward again after Back. */
  navigateForward(): boolean {
    const next = this.history.goForward(this.activeMapName, (m) => !!this.plugin.getMap(m));
    if (!next) {
      this.refreshMapNav();
      return false;
    }
    this.navigateToMap(next, { recordHistory: false });
    return true;
  }

  canNavigateForward(): boolean {
    return this.history.peekForward(this.activeMapName, (m) => !!this.plugin.getMap(m)) !== undefined;
  }

  /** Up to the map this one is a submap of, flashing the hex we came from. */
  navigateUp(): boolean {
    const parent = this.plugin.parentOf(this.activeMapName);
    if (!parent) return false;
    this.navigateToMap(parent.map);
    const [x, y] = parent.hex.split("_").map(Number);
    window.requestAnimationFrame(() => this.flashHex(x, y));
    return true;
  }

  /**
   * "New map from this hex…" for hex (x, y): Region or Location (K1), then
   * the setup modal (size, palette, generator, preview). On create, links
   * the hex and enters the new map.
   */
  openNewSubmapSetup(x: number, y: number): void {
    startNewChildMap(this.childMapHost(), this.activeMapName, x, y);
  }

  /**
   * Go into hex (x, y) where nothing exists yet (arrival, GM4/SP4): its On
   * arrival table is rolled, its place made from the result with no form,
   * and the view enters it.
   */
  async arriveAt(x: number, y: number): Promise<void> {
    const from = this.activeMapName;
    const made = await this.plugin.arrival.arrive(from, x, y);
    if (made && this.activeMapName === from) this.navigateToMap(made);
    else this.renderGrid();
  }

  /** Redraw the New place bar (after a lock elsewhere: the Lock button, the first hand edit). */
  refreshPlaceBar(): void {
    this.refreshArrivalBar();
  }

  /**
   * The bar for a place made on arrival (GM4): Reroll makes it again (any
   * mode until locked, then God), Lock keeps it. Hidden on other maps.
   */
  private refreshArrivalBar(): void {
    const el = this.arrivalBarEl;
    if (!el) return;
    el.empty();
    const map = this.plugin.getMap(this.activeMapName);
    const state = map?.arrival?.trim().toLowerCase();
    const wasShown = el.isShown();
    // The toolbar row fits itself to what it holds (fitTopBar).
    const hide = () => { el.hide(); if (wasShown) this.fitTopBar(); };
    // Places made from a hex, and fresh maps made by New map → Generate (SF7: their recipe).
    const fresh = !map?.parent && !!recipeOf(map);
    if (!map || (state !== "open" && state !== "locked") || (!map.parent && !fresh)) { hide(); return; }
    const open = state === "open";
    // A locked place shows the bar only where it can still be rerolled (God).
    if (!open && !canRerollPlace(map)) { hide(); return; }
    el.show();
    // "New location" / "Locked region" (owner Q9/R1: never "place").
    const kind = fresh ? "Map" : submapKindLabel(map);
    const word = kind.toLowerCase();
    el.createSpan({ cls: "duckmage-arrival-bar-label", text: open ? `New ${word}` : `Locked ${word}` });
    const reroll = el.createEl("button", {
      text: "Reroll",
      attr: { title: open ? `Make this ${word} again with a new seed (its terrain and paths are replaced)` : `Make this locked ${word} again with a new seed (God mode)` },
    });
    reroll.addEventListener("click", () => void this.plugin.arrival.reroll(map.name).then(() => { this.refreshArrivalBar(); this.renderGrid(); }));
    if (open) {
      const lock = el.createEl("button", { text: "Lock", attr: { title: `Keep this ${word} as it is (rerolling it then needs ${WORK_MODE_TEXT.god.label} mode)` } });
      lock.addEventListener("click", () => void this.plugin.arrival.lock(map.name).then(() => this.refreshArrivalBar()));
    }
    this.fitTopBar();
  }

  /** "+ New location…" straight away (the Locations list's button). */
  private openNewLocationSetup(x: number, y: number): void {
    startNewLocation(this.childMapHost(), this.activeMapName, x, y);
  }

  private childMapHost(): NewChildMapHost {
    const parentMap = this.activeMapName;
    return {
      app: this.app,
      plugin: this.plugin,
      onCreated: (name) => {
        if (this.activeMapName === parentMap) this.navigateToMap(name);
        else this.renderGrid();
      },
      onEnter: (name) => this.navigateToMap(name),
    };
  }

  /** "Link existing map…" for hex (x, y): the picked map joins its locations. */
  private openLinkExistingMap(x: number, y: number): void {
    const parentMap = this.activeMapName;
    const linked = hexChildMaps(this.plugin.mapStore.get(parentMap, `${x}_${y}`));
    new SubmapPickerModal(
      this.app,
      this.plugin,
      undefined,
      (mapName) => {
        void this.plugin.linkSubmap(parentMap, x, y, mapName).then(() => this.renderGrid());
      },
      undefined,
      () => this.openNewLocationSetup(x, y),
      { title: "Link existing map", exclude: [...linked, parentMap] },
    ).open();
  }

  /** The hex's Locations list (search, open, unlink, reorder). */
  openLocationsList(x: number, y: number): void {
    new LocationsModal(this.app, this.plugin, this.activeMapName, x, y, {
      open: (name) => this.navigateToMap(name),
      newLocation: () => this.openNewLocationSetup(x, y),
      linkExisting: () => this.openLinkExistingMap(x, y),
      changed: () => this.renderGrid(),
    }).open();
  }

  canNavigateBack(): boolean {
    return this.previousMapName() !== undefined;
  }

  /** The map Back would go to (skips maps deleted since and the current one). */
  private previousMapName(): string | undefined {
    return this.history.peekBack(this.activeMapName, (m) => !!this.plugin.getMap(m));
  }

  canNavigateUp(): boolean {
    return this.plugin.parentOf(this.activeMapName) !== undefined;
  }

  /** Brief ripple on a hex so the eye lands on it after a map change. */
  private flashHex(x: number, y: number): void {
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) return;
    this.revealHexEl(hexEl);
    const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
    blip.addEventListener("animationend", () => blip.remove(), { once: true });
  }

  /** Pan just enough that a hex is fully visible, clear of the toolbar
   *  rows and an open side panel (round 4: the tools panel hid the hex a
   *  tester came back to from a submap). */
  private revealHexEl(hexEl: HTMLElement): void {
    if (!mayAutoPan(this.drawingMode)) return;
    const clipEl = this.viewportEl?.parentElement;
    if (!clipEl) return;
    const clip = clipEl.getBoundingClientRect();
    if (clip.width === 0 || clip.height === 0) return;
    const h = hexEl.getBoundingClientRect();
    const ins = usableInsets(clip.width, clip.height, this.viewport.measureOverlayInsets());
    const dx = revealDelta(h.left - clip.left, h.right - clip.left, ins.left, clip.width - ins.right);
    const dy = revealDelta(h.top - clip.top, h.bottom - clip.top, ins.top, clip.height - ins.bottom);
    if (dx === 0 && dy === 0) return;
    this.viewport.panBy(dx, dy);
  }

  /** Breadcrumb (ancestors), the ← ↑ → arrows and the neighbour widget for the active map. */
  private refreshMapNav(): void {
    this.refreshNavArrows();
    this.refreshWorkModeBtn();
    this.refreshSideCrumbs();
    const crumbs = this.crumbsEl;
    if (!crumbs) return;
    crumbs.empty();
    const ancestors = mapAncestors(this.activeMapName, (m) => this.plugin.parentOf(m)?.map);
    // The crumbs between the first and the last fold into one "…" when the
    // row is too narrow for them (fitTopBar); its tooltip and menu list them.
    const middle = ancestors.slice(1, -1);
    ancestors.forEach((name, i) => {
      const label = this.plugin.mapLabel(name);
      const isMiddle = i > 0 && i < ancestors.length - 1;
      const crumb = crumbs.createEl("button", {
        cls: `duckmage-map-crumb${isMiddle ? " duckmage-map-crumb-mid" : ""}`,
        text: label,
        attr: { title: `Go to ${label}` },
      });
      crumb.addEventListener("click", () => this.navigateToMap(name));
      crumbs.createSpan({ cls: `duckmage-map-crumb-sep${isMiddle ? " duckmage-map-crumb-mid" : ""}`, text: "›" });
      if (i === 0 && middle.length) {
        // Stands for the folded crumbs: the tooltip names them all, a click
        // goes to the nearest of them (one up from the last crumb shown).
        const nearest = middle[middle.length - 1];
        const more = crumbs.createEl("button", {
          cls: "duckmage-map-crumb duckmage-map-crumb-more",
          text: "…",
          attr: { title: `${middle.map((m) => this.plugin.mapLabel(m)).join(" › ")}\nGo to ${this.plugin.mapLabel(nearest)}` },
        });
        more.addEventListener("click", () => this.navigateToMap(nearest));
        crumbs.createSpan({ cls: "duckmage-map-crumb-sep duckmage-map-crumb-more", text: "›" });
      }
    });
    // What the hex this map was made from is ("from: barren world"), read
    // from the parent's map data (F11: a sector's world type was nowhere
    // in the system map made from it).
    const from = parentHexTerrain(this.plugin, this.activeMapName);
    if (from) {
      crumbs.createSpan({
        cls: "duckmage-map-crumb-from",
        text: `from: ${from.terrain}`,
        attr: { title: `Made from ${from.label}, a ${from.terrain} hex` },
      });
    }
    crumbs.toggle(ancestors.length > 0);
    this.fitTopBar();
  }

  /** The map's view changed size: the top toolbar row may need to fold its breadcrumb. */
  onResize(): void {
    this.fitTopBar();
  }

  /**
   * Keep the toolbar row clear of the top +/− buttons (the breadcrumb with
   * its "from: …" crowded them on deep maps). CSS caps the row short of the
   * side-panel buttons and lets the crumbs shrink (each with an ellipsis
   * and its full name in the tooltip); when they don't fit whole, the
   * middle ones fold into "…"; when the row still reaches the centred
   * +/− buttons, those move to the second row's right side; when the row
   * is still cramped there (its buttons overflow, or a crumb or the map
   * button is squeezed below its own size: "Dem…", "D…"), it wraps onto a
   * second line (user test 2026-10-12: the Build button covered the region
   * flower). Nothing in the row ever overlaps. Whatever sits below the row
   * starts at its measured bottom (--duckmage-top-band-bottom). Classes are
   * reset first, then read; the one write comes last.
   */
  private fitTopBar(): void {
    const crumbs = this.crumbsEl;
    const nav = crumbs?.parentElement;
    const controls = nav?.parentElement;
    if (!crumbs || !nav || !controls) return;
    const top = controls.querySelector(":scope > .duckmage-expand-group-top");
    const cut = (el: Element) => el.scrollWidth > el.clientWidth + 1;
    // Cut short by the row, not by its own max-width (a long name's ellipsis is fine).
    const squeezed = (el: Element) => {
      if (!el.instanceOf(HTMLElement) || el.clientWidth === 0 || !cut(el)) return false;
      const max = parseFloat(activeWindow.getComputedStyle(el).maxWidth);
      return !(Number.isFinite(max) && el.offsetWidth >= max - 1);
    };
    const cramped = () =>
      cut(nav) || squeezed(crumbs) || Array.from(crumbs.children).some(squeezed) || (!!this.mapBtn && squeezed(this.mapBtn));
    const fold = () => {
      crumbs.removeClass("is-folded");
      // Folded as soon as the crumbs don't fit whole (one is cut short or the row overflows).
      if (crumbs.querySelector(".duckmage-map-crumb-mid") && (cut(crumbs) || Array.from(crumbs.children).some(cut))) crumbs.addClass("is-folded");
    };
    const band = () => {
      const b = nav.getBoundingClientRect().bottom - controls.getBoundingClientRect().top;
      controls.setCssProps({ "--duckmage-top-band-bottom": `${Math.max(42, Math.ceil(b) + 6)}px` });
    };
    // First try: the row stops short of the centred +/- buttons.
    nav.removeClass("is-wrapped");
    nav.addClass("is-centred");
    controls.removeClass("duckmage-top-crowded");
    if (!nav.isConnected || nav.clientWidth === 0 || !top) { fold(); return; }
    fold();
    const right = Math.max(...Array.from(nav.children).map((c) => c.getBoundingClientRect().right));
    if (!cramped() && right + 8 <= top.getBoundingClientRect().left) { band(); return; }
    // The row's own buttons don't fit there: it takes the width and the +/- move down.
    nav.removeClass("is-centred");
    controls.addClass("duckmage-top-crowded");
    fold();
    // Still cramped with the width: the row wraps.
    if (cramped()) {
      nav.addClass("is-wrapped");
      fold();
    }
    band();
  }

  /**
   * ← back, ↑ parent, → forward: glyphs only, always in that order. When
   * any applies all three show (the others disabled) so they never shift;
   * the target map is in the tooltip.
   */
  private refreshNavArrows(): void {
    const el = this.navArrowsEl;
    if (!el) return;
    el.empty();
    const parent = this.plugin.parentOf(this.activeMapName);
    const arrows = navArrows({
      back: this.previousMapName(),
      up: parent?.map,
      forward: this.history.peekForward(this.activeMapName, (m) => !!this.plugin.getMap(m)),
    });
    el.toggle(arrows.length > 0);
    for (const a of arrows) {
      const label = !a.target
        ? { back: "Back (no previous map)", up: "Up (no parent map)", forward: "Forward (nothing to go forward to)" }[a.id]
        : a.id === "back" ? `Back to ${this.plugin.mapLabel(a.target)} (Alt+←)`
        : a.id === "up" ? `Up to ${this.plugin.mapLabel(a.target)}, hex ${hexKeyCoords(parent!.hex)} (Alt+↑)`
        : `Forward to ${this.plugin.mapLabel(a.target)} (Alt+→)`;
      const btn = el.createEl("button", {
        cls: `duckmage-map-nav-arrow duckmage-map-${a.id}-btn`,
        text: a.glyph,
        attr: { title: label, "aria-label": label, "data-nav": a.id },
      });
      btn.disabled = !a.target;
      btn.addEventListener("click", () => {
        if (a.id === "back") this.navigateBack();
        else if (a.id === "up") this.navigateUp();
        else this.navigateForward();
      });
    }
  }

  /** The work-mode switch: names the map's mode; click to pick another. */
  private refreshWorkModeBtn(): void {
    this.applyWorkModeUi();
    // Reroll / Lock depend on the mode too (a locked place: God only).
    this.refreshArrivalBar();
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
    this.refreshSideCrumbs();
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
   * The neighbours of the open map, one click away, always in the same
   * places: a hex flower for a region of an overworld (its six neighbouring
   * regions, empty petals where there's none yet), a d-pad for maps on a
   * world grid. Names are in the tooltips, not on the bar.
   */
  private refreshSideCrumbs(): void {
    const el = this.sideCrumbsEl;
    if (!el) return;
    el.empty();
    const maps = this.plugin.settings.maps;
    const wm = this.wm;
    const home = wm?.regionHome(this.plugin, this.activeMapName);
    if (wm && home) {
      const petals = flowerPetals(home.layout.orientation, home.layout.parentStagger, home.px, home.py);
      const palette = this.plugin.getMapPalette(home.overworld.name);
      const flower = el.createDiv({ cls: "duckmage-region-flower", attr: { role: "group", "aria-label": "Neighbouring regions" } });
      // 22px petals, spaced so none touch (flowerLayout); the card is sized to fit them.
      const fl = flowerLayout(petals);
      flower.setCssProps({ "--duckmage-flower-w": `${fl.width}px`, "--duckmage-flower-h": `${fl.height}px` });
      // The centre petal is this region: click it to edit the region.
      const here = flower.createEl("button", {
        cls: "duckmage-region-flower-petal is-here",
        attr: { title: `Here: ${this.plugin.mapLabel(this.activeMapName)}. Click to edit this region.`, "aria-label": "Edit region" },
      });
      here.setCssProps({ "--duckmage-petal-x": "0px", "--duckmage-petal-y": "0px" });
      here.addEventListener("click", () => this.openEditRegion(home.px, home.py, home.overworld.name));
      const lock = wm.walkLock(this.plugin, this.activeMapName, home.overworld.name);
      petals.forEach((p, i) => {
        const key = `${p.hex[0]}_${p.hex[1]}`;
        const region = regionMapAt(maps, home.overworld.name, key);
        const terrain = this.plugin.mapStore.get(home.overworld.name, key)?.terrain;
        const colour = terrain ? palette.find((t) => t.name === terrain)?.color : undefined;
        // An empty petal is new land: "+" walks into it (pick or roll its biome).
        const b = neighbourButton(p.bearing, region ? { name: region.name, label: this.plugin.mapLabel(region.name) } : undefined, {
          canMake: true,
          canAdd: !lock,
          lockedHint: lock ?? "",
          inGrid: wm.inOverworldGrid(home.overworld, p.hex[0], p.hex[1]),
        });
        const petal = flower.createEl("button", {
          cls: "duckmage-region-flower-petal" + (region ? "" : " is-empty is-new") + (b.action.kind === "locked" ? " is-locked" : ""),
          text: b.plus ? "+" : "",
          attr: { title: b.title, "aria-label": b.title, "data-side": p.bearing, "data-hex": key },
        });
        petal.setCssProps({ "--duckmage-petal-x": `${fl.at[i].x}px`, "--duckmage-petal-y": `${fl.at[i].y}px` });
        if (colour && region) petal.setCssProps({ "--duckmage-petal-bg": colour });
        petal.disabled = b.disabled;
        const action = b.action;
        if (action.kind === "go") petal.addEventListener("click", () => this.navigateToMap(action.target));
        else if (action.kind === "new") {
          petal.addEventListener("click", () => this.openWalk({ overworld: home.overworld.name, px: p.hex[0], py: p.hex[1], bearing: p.bearing }));
        }
      });
      el.show();
      return;
    }
    let side = neighbourCrumbs(this.plugin.getMap(this.activeMapName), maps);
    let via: string | null = null;
    if (side.length === 0) {
      // A submap: its parent's neighbours (round 6: one click, not two).
      const up = ancestorNeighbourCrumbs(this.activeMapName, maps, (m) => this.plugin.parentOf(m)?.map);
      if (up) {
        via = up.via;
        side = up.crumbs;
      }
    }
    if (!side.length) {
      el.hide();
      return;
    }
    const pad = el.createDiv({ cls: "duckmage-map-pad", attr: { role: "group", "aria-label": "Neighbouring maps" } });
    const active = this.plugin.getMap(this.activeMapName);
    for (const { side: s, glyph } of PAD_SIDES) {
      const c = side.find((x) => x.side === s);
      // An empty side of this map's own world is new land (the hex editor's
      // flower offers the same); a submap's borrowed pad only goes places.
      const b = neighbourButton(s, c ? { name: c.name, label: this.plugin.mapLabel(c.name) } : undefined, {
        canMake: !via && !!wm && neighbourSpec(this.plugin, this.activeMapName, s).ok,
        canAdd: canAdd(active),
        lockedHint: ADD_REGION_LOCKED_HINT,
      });
      const title = c && via ? `${s[0].toUpperCase() + s.slice(1)} of ${this.plugin.mapLabel(via)}: ${this.plugin.mapLabel(c.name)}` : b.title;
      const btn = pad.createEl("button", {
        cls: `duckmage-map-pad-btn is-${s}` + (b.plus ? " is-new" : "") + (b.action.kind === "locked" ? " is-locked" : ""),
        text: padButtonText(glyph, b.plus),
        attr: { title, "aria-label": title, "data-side": s },
      });
      btn.disabled = b.disabled;
      const action = b.action;
      if (action.kind === "go") btn.addEventListener("click", () => this.navigateToMap(action.target));
      else if (action.kind === "new") btn.addEventListener("click", () => this.openWalk(s));
    }
    el.show();
  }

  /**
   * Walk into new land from the open map (a "+" on the region flower or the
   * d-pad): pick or roll its biome, preview, create, then go there. The same
   * flow as the hex editor's neighbour flower: on an overworld, Edit
   * region's new-region mode; on an older side-by-side world, WalkRegionModal.
   */
  private openWalk(to: Side | OverworldWalk): void {
    const wm = this.wm;
    if (!wm) return;
    const from = this.activeMapName;
    const done = (name: string) => {
      if (this.activeMapName === from) this.navigateToMap(name);
      else this.refreshSideCrumbs();
    };
    // A region of an overworld: Edit region's new-region mode (direction label, grows the overworld, Create and go).
    if (typeof to !== "string") {
      const host = { ...this.biomeHost(), openLocations: () => undefined };
      new wm.EditRegionModal(host, to.overworld, to.px, to.py, { walk: { from, bearing: to.bearing }, onCreated: done }).open();
      return;
    }
    new wm.WalkRegionModal(this.app, this.plugin, from, to, done).open();
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
        if (this.activeParty()) { this.selectParty(null); return false; }
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

    this.factionTooltipEl = contentEl.createDiv({ cls: "duckmage-faction-tooltip" });
    this.factionTooltipEl.hide();

    // Pointer input: hover, wheel zoom, pan, paint strokes, tool menus (view/mapInput.ts).
    this.input.attach(contentEl, clipEl);

    // Expand buttons and view buttons — always visible (not collapsible)
    this.createExpandButtons(controlsEl);

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
    this.crumbsEl = mapNavGroup.createDiv({ cls: "duckmage-map-crumbs" });
    this.crumbsEl.hide();

    this.mapBtn = mapNavGroup.createEl("button", {
      cls: "duckmage-region-btn",
      title: "Manage maps",
    });
    this.updateMapBtnLabel();
    // ← ↑ → right after the map button, then the neighbours (flower / d-pad).
    this.navArrowsEl = mapNavGroup.createDiv({ cls: "duckmage-map-nav-arrows" });
    this.navArrowsEl.hide();
    this.sideCrumbsEl = mapNavGroup.createDiv({ cls: "duckmage-map-crumbs duckmage-map-side-crumbs" });
    this.sideCrumbsEl.hide();
    this.mapBtn.addEventListener("click", () =>
      new MapModal(this.app, this.plugin, this, () => {
        this.exitTerrainMode();
        this.toolbar.exitPathMode();
        this.undos.updateUndoButton();
        this.updateMapBtnLabel();
        this.refreshMapNav();
        this.refreshViewHeader();
        this.renderGrid();
      }).open(),
    );

    this.workModeBtn = mapNavGroup.createEl("button", { cls: "duckmage-work-mode-btn" });
    this.workModeBtn.addEventListener("click", (e) => this.openWorkModeMenu(e));
    this.arrivalBarEl = mapNavGroup.createDiv({ cls: "duckmage-arrival-bar" });
    this.arrivalBarEl.hide();
    this.refreshMapNav();

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
      () => this.updateTokenLayer(),
      {
        onLegendChange: () => this.labels.refreshTerrainLegend(),
        // Badge size or kinds changed: redraw the badges and the legend.
        onBadgesChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.cancelMeasuredLayers) {
            this.labels.renderLinkBadges(grid);
            this.labels.drawHexNames(grid, true);
          }
          this.labels.refreshTerrainLegend();
        },
        // Name font changed (NM3): redraw the names.
        onHexNameFontChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.cancelMeasuredLayers) this.labels.drawHexNames(grid, true);
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
        const wasToken  = this.tokenEntries.some((t) => t.filePath === file.path);
        if (hasToken || wasToken) this.updateTokenLayer();
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
        if (this.shownTerrain.size && !this.undos.currentTerrainStroke) this.terrainSync.request(() => this.syncShownTerrain());
        this.labels.scheduleTerrainLegend();
        // A name set without a redraw (hex table, code, map note edit) shows up.
        this.labels.scheduleHexNames();
      }),
    );

    // Reopen where the user left this map (onClose saves savedViewport);
    // first visit fits the whole grid.
    this.viewport.restoreViewport(this.activeMapName);
    this.refreshMapNav();
    return Promise.resolve();
  }

  /**
   * Effective horizontal scale of the grid container's CSS transform.
   * Used by the expand/shrink buttons so visual pan compensation accounts
   * for calibrated maps where the grid is non-uniformly scaled. Falls back
   * to the legacy uniform `gridDisplayScale`, then to 1.
   */
  private gridDisplayScaleX(map: MapData): number {
    return map.gridDisplayScaleX ?? map.gridDisplayScale ?? 1;
  }
  private gridDisplayScaleY(map: MapData): number {
    return map.gridDisplayScaleY ?? map.gridDisplayScale ?? 1;
  }

  /**
   * Apply pan + bg-image compensation after the grid grew/shrank on the
   * top/left side.
   *
   * Two compensations work together so an expand at the top (or left)
   * looks like "the canvas extended that way" instead of "everything
   * shifted":
   *
   * - **Pan**: existing hexes' in-container layout offset just grew by
   *   `stride`, which would shift them in viewport pixels by
   *   `stride * scale`. To freeze their screen position we shift the
   *   viewport translate by `-stride * scale * zoom`.
   * - **BG image**: that pan shift moves the bg image in screen space too
   *   (the bg layer is a viewport descendant). The bg image's
   *   `viewport-coord` position doesn't track the grid's layout change,
   *   so the bg/hex alignment breaks unless we also shift `bg.offsetY/X`
   *   by `+stride * scale` (matching the layout shift of the hexes).
   *   Net bg screen movement: zero. Alignment preserved.
   *
   * `direction: "above"` is the top / left case (one positive-side
   * compensation). `shrink: true` flips the sign — removing a top/left
   * row/col is the inverse of adding one.
   */
  private shiftForGridGrowth(
    opts: { axis: "row" | "col"; direction: "above"; shrink?: boolean },
    map: MapData,
  ): void {
    const stride = this.measureGridStride(opts.axis);
    if (stride === 0) return;
    const sign = opts.shrink ? -1 : 1;
    if (opts.axis === "row") {
      const sy = this.gridDisplayScaleY(map);
      this.viewport.panY -= sign * stride * sy * this.viewport.zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetY += sign * stride * sy;
      }
    } else {
      const sx = this.gridDisplayScaleX(map);
      this.viewport.panX -= sign * stride * sx * this.viewport.zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetX += sign * stride * sx;
      }
    }
    this.viewport.applyTransform();
    if (map.backgroundImage) {
      // Re-apply the bg layer's transform with the new offset so the visual
      // updates immediately, and persist the new offset.
      const layer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (layer) this.calibration.applyBgLayerVars(layer, map.backgroundImage);
      void this.plugin.saveSettings();
    }
  }

  /**
   * Layout stride between adjacent rows/cols, measured directly from two
   * consecutive elements in the DOM after render. This is more reliable
   * than computing from hex dimensions because it captures everything that
   * affects spacing: hex height + hex margin + row margin-bottom, etc.
   *
   * Returns 0 if there aren't enough elements to measure.
   */
  private measureGridStride(axis: "row" | "col"): number {
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    if (axis === "row") {
      if (isFlat) {
        // Flat-top: hexes stacked vertically inside a column with no overlap.
        // Measure the offsetTop delta between two consecutive hexes in the
        // same column.
        const col = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-col");
        const hexes = col?.querySelectorAll<HTMLElement>(".duckmage-hex");
        if (!hexes || hexes.length < 2) return 0;
        return hexes[1].offsetTop - hexes[0].offsetTop;
      }
      // Pointy-top: rows stack vertically inside the grid container. Measure
      // the offsetTop delta between the first two rows.
      const rows = this.viewportEl?.querySelectorAll<HTMLElement>(".duckmage-hex-row");
      if (!rows || rows.length < 2) return 0;
      return rows[1].offsetTop - rows[0].offsetTop;
    }
    // axis === "col"
    if (isFlat) {
      // Flat-top: columns are siblings in the grid container; measure delta.
      const cols = this.viewportEl?.querySelectorAll<HTMLElement>(".duckmage-hex-col");
      if (!cols || cols.length < 2) return 0;
      return cols[1].offsetLeft - cols[0].offsetLeft;
    }
    // Pointy-top: hexes within a row are side-by-side. Measure delta between
    // first two hexes in the first row.
    const row = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-row");
    const hexes = row?.querySelectorAll<HTMLElement>(".duckmage-hex");
    if (!hexes || hexes.length < 2) return 0;
    return hexes[1].offsetLeft - hexes[0].offsetLeft;
  }

  private createExpandButtons(container: HTMLElement): void {
    const dirs: Array<{
      groupCls: string;
      expandAction: () => Promise<void>;
      shrinkAction: () => Promise<void>;
      canShrink: () => boolean;
      edgePaths: () => string[];
    }> = [
      {
        groupCls: "duckmage-expand-group-top",
        expandAction: async () => {
          // Top expand: new row appears at the top of the flex column,
          // pushing existing rows down by one row stride in pre-transform
          // pixels. Two compensations together keep everything visually
          // anchored in screen space:
          //   1. panY shift offsets the screen-space movement of existing
          //      hexes (caused by their new in-container offset).
          //   2. bg.offsetY shift moves the bg image by the same viewport
          //      amount, so the bg image's alignment with the existing hex
          //      content is preserved — without this, the pan-only fix
          //      breaks the bg/hex relationship the user calibrated.
          this.getActiveMap().gridOffset.y--;
          this.getActiveMap().gridSize.rows++;
          await this.plugin.saveSettings();
          const r = this.getActiveMap();
          const xs = Array.from({ length: r.gridSize.cols }, (_, i) => r.gridOffset.x + i);
          const newPaths = xs.map((x) => this.plugin.hexPath(x, r.gridOffset.y, this.activeMapName));
          this.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          this.shiftForGridGrowth({ axis: "row", direction: "above" }, r);
          void this.plugin.generateHexNotes(this.activeMapName, xs, [r.gridOffset.y]);
        },
        shrinkAction: async () => {
          this.getActiveMap().gridSize.rows--;
          this.getActiveMap().gridOffset.y++;
          await this.plugin.saveSettings();
          this.renderGrid();
          this.shiftForGridGrowth({ axis: "row", direction: "above", shrink: true }, this.getActiveMap());
        },
        canShrink: () => this.getActiveMap().gridSize.rows > 1,
        edgePaths: () => {
          const r = this.getActiveMap();
          return Array.from({ length: r.gridSize.cols }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x + i, r.gridOffset.y, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-bottom",
        expandAction: async () => {
          this.getActiveMap().gridSize.rows++;
          await this.plugin.saveSettings();
          const r = this.getActiveMap();
          const newY = r.gridOffset.y + r.gridSize.rows - 1;
          const xs = Array.from({ length: r.gridSize.cols }, (_, i) => r.gridOffset.x + i);
          const newPaths = xs.map((x) => this.plugin.hexPath(x, newY, this.activeMapName));
          this.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          void this.plugin.generateHexNotes(this.activeMapName, xs, [newY]);
        },
        shrinkAction: async () => {
          this.getActiveMap().gridSize.rows--;
          await this.plugin.saveSettings();
          this.renderGrid();
        },
        canShrink: () => this.getActiveMap().gridSize.rows > 1,
        edgePaths: () => {
          const r = this.getActiveMap();
          const lastY = r.gridOffset.y + r.gridSize.rows - 1;
          return Array.from({ length: r.gridSize.cols }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x + i, lastY, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-left",
        expandAction: async () => {
          this.getActiveMap().gridOffset.x--;
          this.getActiveMap().gridSize.cols++;
          await this.plugin.saveSettings();
          const r = this.getActiveMap();
          const ys = Array.from({ length: r.gridSize.rows }, (_, i) => r.gridOffset.y + i);
          const newPaths = ys.map((y) => this.plugin.hexPath(r.gridOffset.x, y, this.activeMapName));
          this.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          this.shiftForGridGrowth({ axis: "col", direction: "above" }, r);
          void this.plugin.generateHexNotes(this.activeMapName, [r.gridOffset.x], ys);
        },
        shrinkAction: async () => {
          this.getActiveMap().gridSize.cols--;
          this.getActiveMap().gridOffset.x++;
          await this.plugin.saveSettings();
          this.renderGrid();
          this.shiftForGridGrowth({ axis: "col", direction: "above", shrink: true }, this.getActiveMap());
        },
        canShrink: () => this.getActiveMap().gridSize.cols > 1,
        edgePaths: () => {
          const r = this.getActiveMap();
          return Array.from({ length: r.gridSize.rows }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x, r.gridOffset.y + i, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-right",
        expandAction: async () => {
          this.getActiveMap().gridSize.cols++;
          await this.plugin.saveSettings();
          const r = this.getActiveMap();
          const newX = r.gridOffset.x + r.gridSize.cols - 1;
          const ys = Array.from({ length: r.gridSize.rows }, (_, i) => r.gridOffset.y + i);
          const newPaths = ys.map((y) => this.plugin.hexPath(newX, y, this.activeMapName));
          this.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          void this.plugin.generateHexNotes(this.activeMapName, [newX], ys);
        },
        shrinkAction: async () => {
          this.getActiveMap().gridSize.cols--;
          await this.plugin.saveSettings();
          this.renderGrid();
        },
        canShrink: () => this.getActiveMap().gridSize.cols > 1,
        edgePaths: () => {
          const r = this.getActiveMap();
          const lastX = r.gridOffset.x + r.gridSize.cols - 1;
          return Array.from({ length: r.gridSize.rows }, (_, i) =>
            this.plugin.hexPath(lastX, r.gridOffset.y + i, this.activeMapName),
          );
        },
      },
    ];

    // Neighbouring regions all share one size, so a map that has them can't grow or shrink.
    const sizeLocked = (): boolean => {
      if (!this.getActiveMap().world) return false;
      new Notice("This map has neighbouring regions, which all share one size. Detach it from them in the map list's properties tab to resize it.");
      return true;
    };
    for (const { groupCls, expandAction, shrinkAction, canShrink, edgePaths } of dirs) {
      const group = container.createDiv({
        cls: `duckmage-expand-group ${groupCls}`,
      });

      group.createEl("button", { cls: "duckmage-expand-btn", text: "+" })
        .addEventListener("click", () => {
          if (this.modeAllows("grow-map") && !sizeLocked()) void expandAction();
        });

      const shrinkBtn = group.createEl("button", {
        cls: "duckmage-shrink-btn",
        text: "−",
      });
      const warnEl = group.createSpan({ cls: "duckmage-shrink-warn", text: "⚠ has content" });

      const resetShrinkBtn = () => {
        shrinkBtn.removeClass("is-dirty", "is-confirming");
        shrinkBtn.setText("−");
        warnEl.removeClass("is-visible");
      };

      group.addEventListener("mouseleave", () => resetShrinkBtn());

      let pendingPaths: string[] = [];
      let confirmTimer: number | null = null;
      shrinkBtn.addEventListener("click", () => {
        if (!this.modeAllows("shrink-map") || !canShrink() || sizeLocked()) return;
        const paths = edgePaths();
        const dirty = paths.some((p) => this.hexHasContent(p));
        if (dirty && !shrinkBtn.hasClass("is-confirming")) {
          pendingPaths = paths;
          shrinkBtn.addClass("is-dirty", "is-confirming");
          shrinkBtn.setText("OK?");
          warnEl.addClass("is-visible");
          if (confirmTimer !== null) window.clearTimeout(confirmTimer);
          confirmTimer = window.setTimeout(() => {
            confirmTimer = null;
            pendingPaths = [];
            resetShrinkBtn();
          }, 3000);
          return;
        }
        if (confirmTimer !== null) { window.clearTimeout(confirmTimer); confirmTimer = null; }
        const toDelete = dirty ? pendingPaths : paths;
        pendingPaths = [];
        resetShrinkBtn();
        void (async () => {
          await shrinkAction();
          for (const p of toDelete) {
            const f = this.app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) await this.app.fileManager.trashFile(f);
          }
        })();
      });
    }
  }

  private hexHasContent(path: string): boolean {
    if (getTerrainFromFile(this.app, path)) return true;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    return !!cache?.links && cache.links.length > 0;
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

  // Insert an overlay span INSIDE the hex element so it's shaped by clip-path
  private highlightSwapHex(
    x: number,
    y: number,
    cls: "duckmage-hex-swap-source" | "duckmage-hex-swap-dest",
  ): void {
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (!hexEl) return;
    // Remove any existing overlay on this hex first
    hexEl
      .querySelector(".duckmage-hex-swap-source, .duckmage-hex-swap-dest")
      ?.remove();
    hexEl.createSpan({ cls });
  }

  private async onHexSwapClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "swap") return;

    // No source yet: select this hex as source
    if (!this.swapSource) {
      this.swapSource = { x, y };
      this.highlightSwapHex(x, y, "duckmage-hex-swap-source");
      return;
    }

    // Clicking the source again: cancel selection
    if (x === this.swapSource.x && y === this.swapSource.y) {
      this.swapSource = null;
      this.toolbar.clearSwapHighlights();
      return;
    }

    // Any other hex: execute swap immediately then deselect tool
    const src = { ...this.swapSource };
    this.toolbar.clearSwapHighlights();
    this.swapSource = null;
    this.swapDest = null;
    await this.executeHexSwap(src.x, src.y, x, y);
    this.toolbar.exitSwapMode();
  }

  // Double-click on the destination confirms the swap
  private onHexDblClick(_x: number, _y: number): void {
    // Path tool: a double-click is two clicks on one hex, and the second
    // one (on the active end) already finishes the branch.
  }

  /** Right-click → "Create token here": same TokenModal as the toolbar
   *  token tool, but the target hex is already known so the place-on-map
   *  step is skipped — saving writes the token frontmatter directly. */
  private createTokenAtHex(x: number, y: number): void {
    new TokenModal(
      this.app,
      this.plugin,
      undefined,
      "",
      { color: this.nextTokenFill() },
      (notePath, data) => {
        void this.placeToken(notePath, { ...data }, `${x}_${y}`);
      },
      undefined,
      "Create token",
    ).open();
  }

  /** Put a token (new or moved) on hex `hex` of the open map; undoable. */
  private async placeToken(notePath: string, look: NonNullable<TokenSnap["look"]>, hex: string): Promise<void> {
    const map = this.activeMapName;
    if (!guardWrite(map, "token")) return;
    const was = await readTokenPlace(this.app, notePath);
    this.undos.pushTokenUndo(notePath, map, was, { hex, map, visible: true, look });
    await applyTokenFrontmatter(this.app, notePath, { ...look, hex, map, visible: true });
    this.updateTokenLayer();
  }

  private async onHexTokenPlaceClick(x: number, y: number): Promise<void> {
    if (!this.pendingTokenNotePath || !this.pendingTokenPlaceData) return;
    await this.placeToken(this.pendingTokenNotePath, this.pendingTokenPlaceData, `${x}_${y}`);
    this.toolbar.exitTokenMode();
  }

  private async performSwap(pathA: string, pathB: string): Promise<void> {
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = hexBase
      ? `${hexBase}/${this.activeMapName}`
      : this.activeMapName;
    const tempPath = `${folder}/__swap_tmp.md`;

    // Recover from a previous partial swap that left a temp file
    const leftover = this.app.vault.getAbstractFileByPath(tempPath);
    if (leftover instanceof TFile) {
      // If pathB is now free, complete the partial swap; otherwise abort
      if (!this.app.vault.getAbstractFileByPath(pathB)) {
        await this.app.vault.rename(leftover, pathB);
        return;
      }
      new Notice("Swap: stale temp file found — check your hex folder.");
      return;
    }

    const fileA = this.app.vault.getAbstractFileByPath(pathA);
    const fileB = this.app.vault.getAbstractFileByPath(pathB);
    const hasA = fileA instanceof TFile;
    const hasB = fileB instanceof TFile;
    if (!hasA && !hasB) return;

    if (fileA instanceof TFile && !hasB) {
      await this.app.vault.rename(fileA, pathB);
    } else if (!hasA && fileB instanceof TFile) {
      await this.app.vault.rename(fileB, pathA);
    } else if (fileA instanceof TFile && fileB instanceof TFile) {
      await this.app.vault.rename(fileA, tempPath);
      await this.app.vault.rename(fileB, pathA);
      const tmp = this.app.vault.getAbstractFileByPath(tempPath);
      if (!(tmp instanceof TFile)) throw new Error("temp file missing");
      await this.app.vault.rename(tmp, pathB);
    }
  }

  private async executeHexSwap(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    isUndoRedo = false,
  ): Promise<void> {
    // Swapping moves notes and map data: God only (src/workMode.ts).
    if (!guardWrite(this.activeMapName, "swap-hexes")) return;
    const pathA = this.plugin.hexPath(x1, y1, this.activeMapName);
    const pathB = this.plugin.hexPath(x2, y2, this.activeMapName);

    // Discard any pending (not-yet-started) writes for the two paths.
    // Without this the flush loop would find no file after the rename and
    // call createHexNote(), recreating a ghost file at the old position.
    this.writes.discard([pathA, pathB]);

    // Wait for any already-in-flight flushes on these paths to finish before
    // renaming files — a flush that completes after the rename would write
    // terrain to the wrong file or recreate a file that was just moved.
    const deadline = Date.now() + 2000;
    while (
      this.writes.flushingAny([pathA, pathB]) &&
      Date.now() < deadline
    ) {
      await new Promise<void>((r) => window.setTimeout(r, 30));
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.performSwap(pathA, pathB);
        break;
      } catch (e) {
        if (attempt === 2) {
          new Notice(
            `Swap failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          this.renderGrid();
          return;
        }
        await new Promise<void>((r) => window.setTimeout(r, 300));
      }
    }

    // Immediate re-render so the map reflects the swap
    this.renderGrid();

    // Blip both positions in the freshly rendered grid
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      const hexEl = this.viewportEl?.querySelector<HTMLElement>(
        `[data-x="${x}"][data-y="${y}"]`,
      );
      if (hexEl) {
        const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
        blip.addEventListener("animationend", () => blip.remove(), {
          once: true,
        });
      }
    }

    if (!isUndoRedo) {
      const at = (x: number, y: number) => this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`) ?? null;
      this.undos.pushUndo({ kind: "swap", x1, y1, x2, y2, after: [at(x1, y1), at(x2, y2)] });
      this.undos.updateUndoButton();
    }
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
    this.cancelMeasuredLayers?.();
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

  renderGrid(
    terrainOverrides?: Map<string, string | null>,
    iconOverrides?: Map<string, string | null>,
    gmIconsOverrides?: Map<string, string[]>,
  ): void {
    if (!this.viewportEl) return;
    this.factionTooltipEl?.hide();
    this.viewportEl.empty();
    // A map whose note was deleted by hand (SM-DEL): a clear empty state
    // with Restore / Remove instead of an empty grid.
    if (this.renderMissingState()) return;

    const gap = this.plugin.settings.hexGap?.trim() || "0.15";
    this.viewportEl.style.setProperty(
      "--duckmage-hex-gap",
      /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap,
    );

    // Apply the coord-placement class so CSS can position HTML labels
    // top / middle / bottom inside the hex. The setting was previously
    // honoured only by the (now-removed) SVG coord-label copies; the
    // HTML labels need this class to know where to render.
    const placement = this.plugin.settings.coordPlacement ?? "bottom";
    this.viewportEl.removeClass(
      "duckmage-coord-top",
      "duckmage-coord-middle",
      "duckmage-coord-bottom",
    );
    this.viewportEl.addClass(`duckmage-coord-${placement}`);

    // Coord label size + font (settings → "Coordinate label"). Both flow
    // into CSS vars consumed by `.duckmage-coord-label-html`. Size is in em so it
    // scales with the hex; font family is one of Obsidian's CSS font vars.
    const coordFontSize = this.plugin.settings.coordFontSize ?? 0.8;
    const coordFontFamilyKey = this.plugin.settings.coordFontFamily ?? "interface";
    const coordFontFamily =
      coordFontFamilyKey === "monospace"
        ? "var(--font-monospace)"
        : coordFontFamilyKey === "serif"
          ? 'Georgia, Cambria, "Times New Roman", Times, serif'
          : "var(--font-interface)";
    const coordFontColor = this.plugin.settings.coordFontColor ?? "#ffffff";
    this.viewportEl.setCssProps({
      "--duckmage-coord-font-size": `${coordFontSize}em`,
      "--duckmage-coord-font-family": coordFontFamily,
      "--duckmage-coord-color": coordFontColor,
      // Halo opposite to the text colour: labels read on light terrain too.
      "--duckmage-coord-halo": coordHaloColor(coordFontColor),
    });

    const region = this.getActiveMap();

    // Background image layer (behind hex grid; shares the viewport's pan/zoom
    // transform via DOM nesting). Added first so it stacks under the grid.
    this.calibration.renderBackgroundImage(this.viewportEl, region);

    // Sync overlay checkboxes and CSS classes to the active region's saved state
    this.overlayPanel?.syncToRegion();

    const { cols, rows } = region.gridSize;
    const { x: ox, y: oy } = region.gridOffset;
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = hexBase
      ? `${hexBase}/${this.activeMapName}`
      : this.activeMapName;
    const palette = this.plugin.getMapPalette(this.activeMapName);
    // Index the palette by name once so `addHex` doesn't do a linear
    // `palette.find` per hex. Output identical; on a 30×20 map this is
    // ~600 fewer linear scans per renderGrid.
    const paletteByName = new Map(palette.map((p) => [p.name, p]));
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const owView = this.owView(region);
    const gridContainer = this.viewportEl.createDiv({
      cls: `duckmage-hex-map-grid${isFlat ? " duckmage-grid-flat" : ""}`,
    });
    // An overworld's Regions view shows only the regions (and blank bricks
    // where there's none yet): its own hexes stay as invisible click
    // targets, and their coordinates, names and badges are hidden (owner
    // playtest: "just show blank bricks rather than the hex one behind").
    const regionsView = owView === "regions";
    if (regionsView) {
      gridContainer.addClass("duckmage-ow-regions");
      // The region's name on hover, nothing drawn on the map. Once a frame,
      // read at the LAST pointer position (the first one of the frame left
      // a region's name up after the pointer had moved off it), and cleared
      // when the pointer leaves the grid.
      const hover = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
      const setTip = (tip: string) => { if (gridContainer.title !== tip) gridContainer.title = tip; };
      gridContainer.addEventListener("mousemove", (e) => {
        const { clientX, clientY } = e;
        hover.request(() => {
          const cell = this.overworldLayer?.cellAt(gridContainer, clientX, clientY) ?? null;
          const line = this.overworldLayer?.pathAt(gridContainer, clientX, clientY) ?? null;
          setTip(regionsViewTip(cell, {
            label: (r) => this.plugin.mapLabel(r),
            emptySlot: (h) => this.emptySlotOnMap(h),
            canAdd: canAdd(this.getActiveMap()),
            path: line?.names.join(", "),
          }));
        });
      });
      gridContainer.addEventListener("mouseleave", () => hover.request(() => setTip("")));
    } else if (owView === "biomes") {
      gridContainer.addClass("duckmage-ow-biomes");
      // A path between regions under the pointer: its name in the tooltip (O2).
      watchBiomesPathHover(gridContainer, (x, y) => this.overworldLayer?.pathAt(gridContainer, x, y)?.names.join(", "), (el, path) => this.labelHex(el, undefined, path));
    }

    // Apply optional independent grid transform (used for bg-image calibration).
    // Custom-property values default to identity in CSS when unset, so we
    // can safely write them unconditionally — no special-casing for the
    // un-calibrated default.
    this.calibration.applyGridLayerVars(gridContainer, region);

    if (this.calibration.active) this.calibration.attachGridCalibrationHandlers(gridContainer, region);

    // Pre-compute the set of existing hex notes for this map by walking the
    // hex folder's TFolder.children directly. Lets `addHex` check existence
    // via O(1) Set.has(path) instead of the per-hex
    // `vault.getAbstractFileByPath` round-trip. Output identical.
    const existingHexPaths = new Set<string>();
    const hexFolderObj = folder ? this.app.vault.getAbstractFileByPath(folder) : null;
    if (hexFolderObj instanceof TFolder) {
      for (const child of hexFolderObj.children) {
        if (child instanceof TFile && child.extension === "md") {
          existingHexPaths.add(child.path);
        }
      }
    }

    // Hexes the party has stood on (SF5): a mark the layers menu can hide.
    const visitedHexes = new Set(parseVisited(region.visited));
    const addHex = (parent: HTMLElement, x: number, y: number) => {
      const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
      const exists = existingHexPaths.has(path);
      // Fetch this hex's frontmatter ONCE; terrain/icon/gm-icons all derive
      // from it. Calling getTerrainFromFile + getIconOverrideFromFile +
      // getGmIconsFromFile separately would re-run getAbstractFileByPath +
      // getFileCache three times per hex (~11.5k redundant lookups on a
      // 3843-hex map).
      // Before the map store is ready (startup), fall back to frontmatter.
      const fromStore = this.plugin.mapStore.isReady();
      const fm = fromStore ? null : getFrontMatter(this.app, path);
      const stored = fromStore ? this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`) : undefined;
      // A note this plugin just wrote may not be indexed yet; its terrain is
      // held in memory until it is.
      const terrainKey = terrainOverrides?.has(path)
        ? terrainOverrides.get(path)!
        : fromStore ? stored?.terrain ?? null
        : fm ? terrainFromFm(fm) : pendingTerrainOf(path);
      // Hexes with no terrain (often no note at all — notes are created on
      // use) show the map's base terrain, e.g. "void" on a system map.
      const ownTerrain = terrainKey != null ? paletteByName.get(terrainKey) : undefined;
      const baseEntry = !ownTerrain && region.baseTerrain ? paletteByName.get(region.baseTerrain) : undefined;
      const terrainEntry = ownTerrain ?? baseEntry;

      const hexEl = parent.createDiv({
        cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
        attr: { "data-x": String(x), "data-y": String(y) },
      });
      hexEl.tabIndex = -1;

      if (regionsView) {
        hexEl.addEventListener("click", (e) => {
          void this.onHexClick(x, y, e);
        });
        hexEl.addEventListener("contextmenu", (evt) => this.onHexContextMenu(evt, x, y));
        return;
      }

      this.setHexColor(hexEl, terrainEntry?.color);

      const iconOverride = iconOverrides?.has(path)
        ? iconOverrides.get(path)!
        : fromStore ? stored?.icon ?? null : iconOverrideFromFm(fm);
      if (iconOverride) {
        // Render terrain icon as hidden fallback — shown by CSS when overrides are off
        if (terrainEntry?.icon) {
          createIconEl(
            hexEl,
            getIconUrl(this.plugin, terrainEntry.icon),
            terrainEntry.name,
            terrainEntry.iconColor,
            "duckmage-hex-terrain-icon",
          );
        }
        // Render the override icon (primary, visible by default)
        createIconEl(
          hexEl,
          getIconUrl(this.plugin, iconOverride),
          terrainEntry?.name ?? "",
          undefined,
          "duckmage-hex-icon duckmage-hex-override-icon",
        );
        // Tag the hex so the SVG overlay can elevate this icon above roads/rivers
        hexEl.dataset.iconOverride = iconOverride;
      } else if (terrainEntry?.icon) {
        createIconEl(
          hexEl,
          getIconUrl(this.plugin, terrainEntry.icon),
          terrainEntry.name,
          terrainEntry.iconColor,
          "duckmage-hex-icon",
        );
      }

      // Tag hex for GM icon overlay (rendered in path SVG when GM layer is active)
      // GM icons stored as a JSON-encoded array on the dataset; allows
      // multiple icons per hex (with duplicates representing a count).
      // Empty list → no attribute at all so the overlay query still
      // matches only hexes that have GM content. The override path
      // bypasses the metadata-cache read so the editor's just-written
      // list lands on the dataset immediately, no race.
      const gmIcons = gmIconsOverrides?.has(path)
        ? gmIconsOverrides.get(path)!
        : fromStore ? [...(stored?.gmIcons ?? [])] : gmIconsFromFm(fm);
      if (gmIcons.length > 0) hexEl.dataset.gmIcons = JSON.stringify(gmIcons);

      if (this.selectedHex?.x === x && this.selectedHex?.y === y)
        hexEl.addClass("is-selected");
      if (visitedHexes.has(`${x}_${y}`)) hexEl.addClass("duckmage-hex-visited");

      if (exists && !terrainEntry)
        hexEl.createSpan({ cls: "duckmage-hex-dot" });

      // Submap marker: shows which hexes drill down (a system in a sector,
      // a dungeon in a region). Clicking it enters the submap when no tool
      // is active; with a tool active the click falls through to the hex.
      // A Region map: a thin inner hex outline, except on an overworld
      // (either view), where every hex has a region and the outline says
      // nothing. Locations: the badge, with a count from two on; its
      // tooltip lists them.
      const legacySubmap: unknown = fromStore ? undefined : fm?.["duckmage-submap"];
      const regionMap = stored?.regionMap && this.plugin.getMap(stored.regionMap) ? stored.regionMap : undefined;
      const locations = (fromStore ? stored?.locations ?? [] : typeof legacySubmap === "string" && legacySubmap ? [legacySubmap] : [])
        .filter((m) => m !== regionMap && !!this.plugin.getMap(m));
      if (regionMap) {
        hexEl.addClass("duckmage-hex-has-region-map");
        if (!owView) hexEl.createSpan({
          cls: "duckmage-hex-region-outline",
          attr: { title: `Region: ${this.plugin.mapLabel(regionMap)} (Ctrl+click hex to enter)` },
        });
      }
      if (locations.length) {
        hexEl.addClass("duckmage-hex-has-submap");
        const names = locations.map((m) => this.plugin.mapLabel(m));
        const one = locations.length === 1;
        const title = one
          ? `Enter location: ${names[0]}${regionMap ? "" : " (Ctrl+click hex)"}`
          : `Locations: ${names.join(", ")} (click for the list)`;
        const badge = hexEl.createSpan({
          cls: "duckmage-hex-submap-badge" + (one ? "" : " has-count"),
          text: one ? "" : String(locations.length),
          attr: { title, "aria-label": title },
        });
        badge.addEventListener("click", (e) => {
          if (this.drawingMode) return;
          e.stopPropagation();
          if (one) this.navigateToMap(locations[0]);
          else this.openLocationsList(x, y);
        });
      }

      hexEl.addEventListener("click", (e) => {
        void this.onHexClick(x, y, e);
      });
      hexEl.addEventListener("dblclick", () => {
        void this.onHexDblClick(x, y);
      });
      hexEl.addEventListener("contextmenu", (evt) =>
        this.onHexContextMenu(evt, x, y),
      );
      if (region.showFactionOverlay && this.factionTooltipEl) {
        const tooltip = this.factionTooltipEl;
        hexEl.addEventListener("mouseenter", (e: MouseEvent) => {
          const factions = this.areas.getFactionLinksFromCache(path);
          if (factions.length === 0) { tooltip.hide(); return; }
          tooltip.empty();
          const factionsFolder = normalizeFolder(this.plugin.settings.factionsFolder);
          for (const name of factions) {
            const row = tooltip.createDiv({ cls: "duckmage-faction-tooltip-row" });
            const fPath = factionsFolder ? `${factionsFolder}/${name}.md` : `${name}.md`;
            const color = getFactionColorFromFile(this.app, fPath);
            const swatch = row.createSpan({ cls: "duckmage-faction-tooltip-swatch" });
            if (color) swatch.style.backgroundColor = color;
            row.createSpan({ text: name, cls: "duckmage-faction-tooltip-name" });
          }
          const containerRect = this.contentEl.getBoundingClientRect();
          tooltip.style.left = `${e.clientX - containerRect.left + 14}px`;
          tooltip.style.top = `${e.clientY - containerRect.top + 8}px`;
          tooltip.show();
        });
        hexEl.addEventListener("mouseleave", () => tooltip.hide());
      }
    };

    const stagger = this.getActiveStagger();
    const isStaggered = (n: number) =>
      stagger === "odd" ? n % 2 !== 0 : n % 2 === 0;

    if (isFlat) {
      // Flat-top: iterate columns; staggered columns shift down by half hex height
      for (let i = 0; i < cols; i++) {
        const x = ox + i;
        const colEl = gridContainer.createDiv({
          cls: `duckmage-hex-col${isStaggered(x) ? " duckmage-hex-col-offset" : ""}`,
        });
        for (let j = 0; j < rows; j++) {
          addHex(colEl, x, oy + j);
        }
      }
    } else {
      // Pointy-top: iterate rows; staggered rows shift right by half hex width
      for (let j = 0; j < rows; j++) {
        const y = oy + j;
        const rowEl = gridContainer.createDiv({
          cls: `duckmage-hex-row${isStaggered(y) ? " duckmage-hex-row-offset" : ""}`,
        });
        for (let i = 0; i < cols; i++) {
          addHex(rowEl, ox + i, y);
        }
      }
    }

    this.labels.refreshTerrainLegend();

    // Everything below measures hex positions. A grid that isn't laid out
    // yet (map tab in the background on plugin reload) measures 0 and would
    // put every label at 0,0, so wait until it has a size.
    this.cancelMeasuredLayers?.();
    this.labels.resetCoords();
    // whenSized may draw right away (the usual case): only keep the cancel
    // while it's still waiting, or later redraws (names, badges) think the
    // grid never got a size and skip (round 7: badge size didn't apply).
    let drawn = false;
    const cancel = whenSized(gridContainer, () => {
      drawn = true;
      this.cancelMeasuredLayers = null;
      if (gridContainer.isConnected) this.renderMeasuredLayers(gridContainer, region);
    });
    if (!drawn) this.cancelMeasuredLayers = cancel;
  }

  /** The layers placed from measured hex geometry (see renderGrid). */
  private renderMeasuredLayers(gridContainer: HTMLElement, region: MapData): void {
    this.snapshotShownTerrain(region);
    this.shadow.render(gridContainer, region);
    this.overworldLayer?.render(gridContainer, region);
    this.minimap?.render(this.contentEl, region);
    // The view switch or a hand-edited `mode:` may have changed what the bars say.
    this.toolbar.updateModeBar();
    this.refreshWorkModeBtn();
    this.pathLayer.renderPathOverlay(gridContainer);
    this.areas.renderRegionOverlay(gridContainer);
    this.areas.renderFactionOverlay(gridContainer);
    // Coord labels go LAST (and at z:10 in CSS) so they sit above the path
    // SVG, GM-icon overlay, faction overlay, and region overlay — paths
    // and icons can no longer cover up the hex coordinates.
    this.labels.renderCoordLabelsLayer(gridContainer);
    // Badges reuse the hex centres the coord labels just measured.
    this.labels.renderLinkBadges(gridContainer);
    // So does the uncharted marker (no layout reads of its own).
    renderUnchartedLayer(gridContainer, this.labels.coordPlacements, this.labels.coordGridSize, unchartedKeys(this.plugin.mapStore.all(this.activeMapName), moduleUnchartedKeys(this.plugin, this.activeMapName)));
    this.labels.drawHexNames(gridContainer);
    if (this.calibration.active) {
      this.calibration.renderCalibrationOutlines(gridContainer);
      this.calibration.applyCalibrationFocusStyles();
    }
    this.renderTokenLayer(gridContainer);
  }

  /** Switch to a neighbouring region and land on one of its hexes. */
  private goToRegionHex(mapName: string, x: number, y: number, openEditor = false): void {
    // Walking across keeps the hex size on screen (round 5: the zoom jumped
    // to a fixed 1.5× on arrival); the arrival hex is centred in the
    // uncovered part of the view.
    const hexWidth = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex")?.getBoundingClientRect().width;
    this.navigateToMap(mapName);
    window.setTimeout(() => {
      this.setSelectedHex(x, y);
      this.centerOnHex(x, y, hexWidth);
      if (openEditor) this.openHexEditorModal(x, y);
    }, 80);
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
        onLinkExistingMap: (hx: number, hy: number) => this.openLinkExistingMap(hx, hy),
        onManageLocations: (hx: number, hy: number) => this.openLocationsList(hx, hy),
        onCrossToRegion: (name: string, nx: number, ny: number) => this.goToRegionHex(name, nx, ny, true),
      },
    );
    modal.open();
  }

  /** Options for the map view's menus: debug mode, and the God offer on God-only items. */
  private modeMenuOptions(): ModeMenuOptions {
    return { store: this.app, onGod: () => this.setWorkMode("god") };
  }

  private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
    evt.preventDefault();
    // When any tool is active, the global capture-phase contextmenu handler
    // intercepts the event and shows the painter context menu — this handler
    // only fires when drawingMode === null.
    if (this.drawingMode !== null) return;

    // Items the map's work mode locks are left out, with one hint line
    // (for God-only items, an offer to switch: Swap hex).
    const menu = new ModeMenu(this.undos.currentWorkMode(), this.modeMenuOptions());
    // Overworlds are the big-picture view (#49): region-level items only,
    // no hex editor.
    if (this.owView(this.getActiveMap())) this.addOverworldMenuItems(menu, evt, x, y);
    else this.addHexMenuItems(menu, x, y);
    menu.showAtMouseEvent(evt);
  }

  /**
   * A hex's right-click items (also under a token's own items, F8: the
   * token covers the hex centre). `inTokenMenu` names the hex's note so it
   * isn't taken for the token's.
   */
  private addHexMenuItems(menu: ModeMenu, x: number, y: number, inTokenMenu = false): void {
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    // Terrain, icon and submap live in the map note, and a hex can have them
    // before its hex note exists (a generated map, a submap made from this
    // menu) — gating these on the note hid "Enter submap" and "Clear
    // terrain" on such hexes (fresh-eyes N3).
    const terrain = getTerrainFromFile(this.app, hexPath);
    const iconOverride = getIconOverrideFromFile(this.app, hexPath);
    const hexMaps = this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`)
      ?? { locations: getHexMapsFromFile(this.app, hexPath).locations };
    const childPlan = submapMenuPlan(hexMaps);

    // Maps from this hex (K7) come first, so entering what's there is the
    // obvious pick (C11): its region, then up to two locations by name, or
    // one "Locations (n)…" item that opens the list.
    const region = childPlan.region;
    const hasRegion = !!region && !!this.plugin.getMap(region);
    if (region && hasRegion) {
      menu.add("hex.enter-region", `Enter region: ${this.plugin.mapLabel(region)}`, "log-in", () => this.navigateToMap(region, { offerModule: true }));
    }
    for (const loc of childPlan.open) {
      menu.add("hex.open-location", `Open: ${this.plugin.mapLabel(loc)}`, "map-pin", () => {
        if (this.plugin.getMap(loc)) this.navigateToMap(loc, { offerModule: true });
        else this.openLocationsList(x, y);
      });
    }
    if (childPlan.listCount) {
      menu.add("hex.locations", `Locations (${childPlan.listCount})…`, "list", () => this.openLocationsList(x, y));
    }
    // Arrival (GM4): a world set to make places makes this hex's place on
    // the spot, in any mode, when it has none yet.
    const arrive = !hasRegion && !childPlan.open.length && !childPlan.listCount && this.plugin.arrival.canArrive(this.activeMapName, x, y);
    if (arrive) menu.add("hex.arrive", "Go there", "footprints", () => void this.arriveAt(x, y));
    if (arrive || hasRegion || childPlan.open.length || childPlan.listCount) menu.addSeparator();

    // The common jobs next: the hex's note, a token, centring.
    menu.add("hex.open-note", inTokenMenu ? "Open hex note" : "Open note", "file-text", () => {
      void (async () => {
        const existing = this.app.vault.getAbstractFileByPath(hexPath);
        const file =
          existing instanceof TFile
            ? existing
            : await this.plugin.createHexNote(x, y, this.activeMapName);
        if (file) await openNoteFocused(this.app, file);
      })();
    });
    menu.add("hex.create-token", "Create token here", "circle-user", () => this.createTokenAtHex(x, y));
    // Solo play (SF3): what happened here goes to the dated play log.
    menu.add("hex.log", "Add to play log…", "notebook-pen", () => this.openPlayLog(x, y));
    const visited = parseVisited(this.getActiveMap().visited).includes(`${x}_${y}`);
    menu.add("hex.visited", "Visited", "footprints", () => this.setVisited([`${x}_${y}`], !visited), { checked: visited, place: "MapView.hexVisited" });
    for (const it of moduleHexMenu(this.plugin, this.activeMapName, `${x}_${y}`)) menu.add(it.id as MenuActionId, it.label, it.icon, it.run, { place: it.placementId });
    menu.add("hex.center", "Center on this hex", "crosshair", () => this.centerOnHex(x, y));
    menu.add("hex.copy-link", COPY_HEX_LINK_TITLE, "link-2", () => copyHexLink(this.plugin, this.activeMapName, x, y));

    menu.addSeparator();

    // "Add another map…" once the hex has one (C11): a hex can hold several
    // locations, but the menu doesn't invite re-making the same map.
    menu.add("hex.new-map", newMapItemTitle(hexMaps), "plus", () => this.openNewSubmapSetup(x, y));
    menu.add("hex.link-map", "Link existing map…", "link", () => this.openLinkExistingMap(x, y));
    if (childPlan.open.length) {
      // Unlinking and reordering live in the list.
      menu.add("hex.manage-locations", "Manage locations…", "list", () => this.openLocationsList(x, y));
    }

    menu.add("hex.link-table", "Link table", "table", () => {
      new FolderTreePickerModal(
        this.app,
        this.plugin,
        this.plugin.settings.tablesFolder,
        "Link table",
        "Filter tables…",
        "No tables found.",
        (file) => void this.linkTableToHex(x, y, file),
        (file) => void this.openRandomTableAtFile(file),
      ).open();
    });

    menu.add("hex.swap", "Swap hex", "arrow-left-right", () => {
      if (this.drawingMode !== "swap") this.toolbar.handleSwapButton();
      void this.onHexSwapClick(x, y);
    });

    // ── Contextual delete options ──────────────────────────────────────────
    if (terrain || iconOverride) {
      menu.addSeparator();
      if (terrain) {
        menu.add("hex.clear-terrain", "Clear terrain", "eraser", () => {
          this.paintOne(x, y, null);
        });
      }
      if (iconOverride) {
        menu.add("hex.remove-icon", "Remove icon override", "image-off", () => {
          this.removeIconOverride(x, y);
        });
      }
    }
  }

  /**
   * An overworld hex's right-click items (overworldMenu): Enter region and
   * Edit region on a region, Set biome on an empty hex, Center, and the
   * hex's Locations. In the Regions view the brick under the pointer counts.
   */
  private addOverworldMenuItems(menu: ModeMenu, evt: MouseEvent, x: number, y: number): void {
    const wm = this.wm;
    if (!wm) return;
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = this.owView(this.getActiveMap()) === "regions" && grid
      ? this.overworldLayer?.cellAt(grid, evt.clientX, evt.clientY) ?? null : null;
    const [px, py] = cell ? cell.parentHex.split("_").map(Number) : [x, y];
    const key = `${px}_${py}`;
    const regionMap = regionMapAt(this.plugin.settings.maps, this.activeMapName, key);
    const region = regionMap?.name;
    const locations = this.plugin.mapStore.get(this.activeMapName, key)?.locations?.length ?? 0;
    const icons: Record<string, string> = { "enter-region": "log-in", "edit-region": "settings-2", reroll: "dices", lock: "lock", "set-biome": "trees", center: "crosshair", locations: "list" };
    // Reroll / Lock on a new (open) region: placed main (src/ui/placement.ts).
    const places: Record<string, string> = { reroll: "OverworldMenu.reroll", lock: "OverworldMenu.lock" };
    // Arrival (GM4): a world set to make places makes this hex's region on the spot, in any mode.
    if (!region && this.plugin.arrival.canArrive(this.activeMapName, px, py)) {
      menu.add("ow.arrive", "Go there", "footprints", () => void this.arriveAt(px, py));
      menu.addSeparator();
    }
    for (const it of wm.overworldMenu(this.getActiveMap(), !!region, locations, regionMap)) {
      const id = `ow.${it.id}` as const;
      const title = it.id === "enter-region" && region ? `Enter region: ${this.plugin.mapLabel(region)}` : it.enabled ? it.title : `${it.title} (${it.hint})`;
      menu.add(id, title, icons[it.id] ?? "dot", () => {
        if (it.id === "enter-region" && region) {
          if (cell) this.enterRegionAt(region, cell.x, cell.y);
          else this.navigateToMap(region);
        } else if (it.id === "edit-region") this.openEditRegion(px, py);
        else if (it.id === "reroll") void wm.rerollRegionAt(this.biomeHost(), this.activeMapName, px, py);
        else if (it.id === "lock" && region) void this.plugin.arrival.lock(region).then(() => this.renderGrid());
        else if (it.id === "set-biome") this.openNewRegion(px, py);
        else if (it.id === "center") this.centerOnHex(px, py);
        else if (it.id === "locations") this.openLocationsList(px, py);
      }, { disabled: !it.enabled, ...(places[it.id] ? { place: places[it.id] } : {}) });
    }
    menu.add("ow.copy-link", COPY_HEX_LINK_TITLE, "link-2", () => copyHexLink(this.plugin, this.activeMapName, px, py));
    // Mark the party (or anything) on the overworld: tokens sit on its hexes.
    menu.add("ow.create-token", "Create token here", "circle-user", () => this.createTokenAtHex(px, py));
  }

  /**
   * An empty hex of the open overworld (an empty brick, Set biome…): Edit
   * region in new-region mode. Nothing is made until its Create.
   */
  private openNewRegion(px: number, py: number): void {
    const wm = this.wm;
    if (!wm) return;
    new wm.EditRegionModal({ ...this.biomeHost(), openLocations: (hx, hy) => this.openLocationsList(hx, hy) }, this.activeMapName, px, py, {}).open();
  }

  /** Edit the region on hex (px, py) of `overworld` (default the open map; from inside a region, its overworld). */
  openEditRegion(px: number, py: number, overworld = this.activeMapName): void {
    const openLocations = (hx: number, hy: number) => {
      if (overworld === this.activeMapName) { this.openLocationsList(hx, hy); return; }
      // The list belongs to the overworld hex: go there first.
      this.navigateToMap(overworld);
      window.setTimeout(() => this.openLocationsList(hx, hy), 50);
    };
    const wm = this.wm;
    if (!wm) return;
    new wm.EditRegionModal({ ...this.biomeHost(), openLocations }, overworld, px, py).open();
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
      await this.onHexSwapClick(x, y);
      return;
    }
    if (this.drawingMode === "placeToken") {
      await this.onHexTokenPlaceClick(x, y);
      return;
    }
    // The biome brush paints on press (and drag), not on click.
    if (this.drawingMode === "biome") return;

    // Play, a party token selected: a neighbouring hex is a step (SF5).
    if (!this.drawingMode && this.selectedParty && !e?.ctrlKey && !e?.metaKey && this.owView(this.getActiveMap()) !== "regions") {
      const party = this.activeParty();
      if (party && partyClick(party, `${x}_${y}`, this.plugin.settings.hexOrientation, this.getActiveStagger()) === "move") {
        await this.moveParty(party, `${x}_${y}`);
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
        if (cell) this.enterRegionAt(region, cell.x, cell.y);
        else this.navigateToMap(region);
      } else if (!region && this.plugin.arrival.canArrive(this.activeMapName, px, py)) {
        // Arrival on: going there makes the region from its biome (GM4).
        await this.arriveAt(px, py);
      } else if (act.kind === "place") this.openNewRegion(px, py);
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
        this.setHexColor(hexEl, entry?.color);
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
   * Set (or clear) a hex cell's terrain background color, keeping the
   * `duckmage-hex-painted` marker class in sync. The bg-image stylesheet uses
   * that class — rather than a `:not([style*="background-color"])`
   * attribute-substring selector, which is measurably slower for the engine to
   * match across the thousands of hexes on a large map — to decide which empty
   * hexes fall transparent over the image.
   */
  private setHexColor(hexEl: HTMLElement, color: string | undefined | null): void {
    if (color) {
      hexEl.style.backgroundColor = color;
      hexEl.addClass("duckmage-hex-painted");
    } else {
      hexEl.style.removeProperty("background-color");
      hexEl.removeClass("duckmage-hex-painted");
    }
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
    this.setHexColor(hexEl, entry?.color);
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

  /** Remember a region map's terrain as drawn (see shownTerrain). */
  private snapshotShownTerrain(map: MapData): void {
    this.shownTerrain.clear();
    if (map.submapKind !== "region") return;
    const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
    for (let y = oy; y < oy + rows; y++) {
      for (let x = ox; x < ox + cols; x++) this.shownTerrain.set(`${x}_${y}`, this.plugin.mapStore.get(map.name, `${x}_${y}`)?.terrain ?? null);
    }
  }

  /** Repaint the hexes whose terrain changed since they were drawn (see shownTerrain). */
  private syncShownTerrain(): void {
    const map = this.activeMapName;
    const changes = terrainDiff(this.shownTerrain, (k) => this.plugin.mapStore.get(map, k)?.terrain);
    for (const [key, terrain] of changes) {
      this.shownTerrain.set(key, terrain);
      const [x, y] = key.split("_");
      const el = this.viewportEl?.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
      if (el) this.applyTerrainToHexEl(el, terrain);
    }
  }

  /** Show an overworld's Regions view (the terrain brush paints there). */
  private showOverworldRegions(): void {
    const map = this.getActiveMap();
    if (this.owView(map) !== "biomes") return;
    map.overworldView = "regions";
    void this.plugin.saveSettings();
    this.renderGrid();
  }

  /** Enter a region from the overworld, centred on (and flashing) the hex that was clicked. */
  private enterRegionAt(region: string, x: number, y: number): void {
    this.navigateToMap(region);
    window.requestAnimationFrame(() => {
      this.centerOnHex(x, y);
      window.requestAnimationFrame(() => this.flashHex(x, y));
    });
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
        this.refreshSideCrumbs();
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

  /** Put a token where a snapshot says (null: it stops being a token). */
  private async applyTokenSnap(path: string, snap: TokenSnap | null): Promise<void> {
    // Undo/redo says where it is now, not a party step still on its way.
    this.partyMoves.delete(path);
    if (!snap) await removeTokenFrontmatter(this.app, path);
    else await applyTokenFrontmatter(this.app, path, { ...(snap.look ?? {}), hex: snap.hex, map: snap.map, visible: snap.visible ?? true });
    this.updateTokenLayer();
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

  // ── Token layer ───────────────────────────────────────────────────────────

  /** Default fill for a new token: the palette colour least used on this
   *  map, so new tokens don't all come out the same blue. */
  private nextTokenFill(): string {
    this.loadTokensForMap();
    return pickTokenFill(this.tokenEntries.map((t) => t.color));
  }

  private loadTokensForMap(): void {
    this.tokenEntries = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const entry = getTokenDataFromCache(this.app, file);
      if (entry && entry.map === this.activeMapName) {
        // A party step not in the cache yet shows where it went.
        const moved = this.partyMoves.get(entry.filePath);
        if (moved !== undefined) {
          if (moved === entry.hex) this.partyMoves.delete(entry.filePath);
          else entry.hex = moved;
        }
        this.tokenEntries.push(entry);
      }
    }
  }

  private buildTokenCenterMap(gridContainer: HTMLElement): Map<string, { cx: number; cy: number }> {
    const centerMap = new Map<string, { cx: number; cy: number }>();
    gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex").forEach((hexEl) => {
      const x = Number(hexEl.dataset.x);
      const y = Number(hexEl.dataset.y);
      let ox = hexEl.offsetWidth / 2, oy = hexEl.offsetHeight / 2;
      let cur: HTMLElement | null = hexEl;
      // Walk to gridContainer (NOT viewportEl) so overlay coords are
      // gridContainer-relative — the SVG is appended inside gridContainer
      // so it inherits any gridDisplay transform.
      while (cur && cur !== gridContainer) {
        ox += cur.offsetLeft;
        oy += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
      }
      centerMap.set(`${x}_${y}`, { cx: ox, cy: oy });
    });
    return centerMap;
  }

  private renderTokenLayer(gridContainer: HTMLElement): void {
    this.drawTokenLayer(gridContainer);
    // The selected party's steps (SF5), after the tokens are read.
    this.markPartySteps(gridContainer);
  }

  private drawTokenLayer(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector(".duckmage-token-layer")?.remove();
    if (this.getActiveMap().showTokens === false) { this.tokenEntries = []; return; }
    this.loadTokensForMap();
    if (this.tokenEntries.length === 0) return;

    const centerMap = this.buildTokenCenterMap(gridContainer);
    // Read the geometry before any write (no layout thrash).
    const firstHexEl = gridContainer.querySelector<HTMLElement>(".duckmage-hex");
    const spread = Math.min(firstHexEl?.offsetWidth ?? 64, firstHexEl?.offsetHeight ?? 64) * 0.28;
    const emPx = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    // Token layer is a child of gridContainer (not viewportEl) so its
    // absolute-positioned tokens use the same coordinate space as
    // `buildTokenCenterMap` returns (which walks up to gridContainer).
    // Previously the layer was a viewportEl child, which made every token
    // off by exactly the viewport's `padding: 1em` — visible as
    // "tokens not centered on hexes". Matches the path / faction / region
    // overlay pattern (1.4.0 fix). Covered by
    // examples/hex-token-alignment/ in the frontend-testing suite.
    const layer = gridContainer.createDiv({ cls: "duckmage-token-layer" });
    // Spread radius (above): a fraction of the hex's short dimension so offsets scale with zoom.
    const showCoords = this.getActiveMap().showCoords !== false;
    const inPlay = this.undos.currentWorkMode() === "play";

    // Group visible tokens by hex key, preserving entry order.
    const byHex = new Map<string, TokenEntry[]>();
    for (const token of this.tokenEntries) {
      if (!token.visible) continue;
      if (!centerMap.has(token.hex)) continue;
      if (!byHex.has(token.hex)) byHex.set(token.hex, []);
      byHex.get(token.hex)!.push(token);
    }

    // Names go on the side away from the hex coordinate (F4).
    const nameSide = tokenNameSide(this.plugin.settings.coordPlacement);
    for (const [hexKey, tokens] of byHex) {
      const offsets = tokenGroupOffsets(tokens.length);
      // Off the hex's coordinate (SF5: the token hid the hex number).
      const shift = tokenCoordShift({
        placement: this.plugin.settings.coordPlacement,
        showCoords,
        emPx,
        coordFontSize: this.plugin.settings.coordFontSize,
        tokens: tokens.map((t, i) => ({ dy: offsets[i][1] * spread, size: t.size ?? "md" })),
      });
      const c0 = centerMap.get(hexKey)!;
      const center = { cx: c0.cx, cy: c0.cy + shift };

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const [odx, ody] = offsets[i];
        const size = token.size ?? "md";
        const tokenEl = layer.createDiv({
          cls: `duckmage-token duckmage-token-${token.shape} duckmage-token-size-${size}`,
        });
        tokenEl.style.left = `${center.cx + odx * spread}px`;
        tokenEl.style.top  = `${center.cy + ody * spread}px`;
        tokenEl.title      = token.party ? `${token.title} (party)` : token.title;
        if (token.party) tokenEl.addClass("is-party");
        if (token.party && inPlay && this.selectedParty === token.filePath) tokenEl.addClass("is-selected");
        if (token.color)  tokenEl.style.setProperty("--token-color",  token.color);
        if (token.border) tokenEl.style.setProperty("--token-border", token.border);

        if (token.icon) {
          const img = tokenEl.createEl("img", { cls: "duckmage-token-icon" });
          img.src = getIconUrl(this.plugin, token.icon);
          img.alt = token.title;
        } else {
          tokenEl.createSpan({
            cls: "duckmage-token-label",
            text: token.title.charAt(0).toUpperCase(),
          });
        }

        // Name under the token (N5): a sibling, not a child — hexagon
        // tokens clip their children. Hidden by the "Token names" toggle
        // except while the token is hovered (CSS). Tokens sharing a hex
        // list their names one per line under the group (no overlap).
        const place = tokenNamePlacement(offsets, i, nameSide);
        const nameEl = layer.createDiv({
          cls: `duckmage-token-name duckmage-token-name-${tokens.length > 1 ? groupSize(tokens) : size} is-${nameSide}`,
          text: token.title,
        });
        nameEl.setCssProps({
          "--duckmage-token-x": `${center.cx + place.dx * spread}px`,
          "--duckmage-token-y": `${center.cy + place.dy * spread}px`,
          "--duckmage-token-name-line": String(place.line),
        });
        if (token.color) nameEl.setCssProps({ "--token-color": token.color });
        if (tokens.length > 1) nameEl.addClass("is-stacked");

        const snapToken = { ...token }; // capture for closures

        tokenEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.drawingMode !== null) return;
          this.showTokenContextMenu(e, snapToken);
        });

        // Single mousedown handler — startTokenDrag calls onClickInstead if
        // no drag occurs. A plain click opens the token's hex, like clicking
        // the hex itself: the token sits on the hex centre and used to eat
        // the click target (round 5). Its info card is in the right-click
        // menu. (With a tool on, tokens let clicks through to the hex: CSS.)
        tokenEl.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || this.drawingMode !== null) return;
          e.stopPropagation();
          this.startTokenDrag(snapToken, tokenEl, e, centerMap, () => {
            // Play: clicking the party picks it up (or puts it down) (SF5).
            if (snapToken.party && this.undos.currentWorkMode() === "play") {
              this.selectParty(this.selectedParty === snapToken.filePath ? null : snapToken.filePath);
              return;
            }
            const [hx, hy] = snapToken.hex.split("_").map(Number);
            if (Number.isFinite(hx) && Number.isFinite(hy)) void this.onHexClick(hx, hy, e);
          });
        });
      }
    }
  }

  /** Select the party token `path` in Play (null: none); its neighbouring hexes light up. */
  private selectParty(path: string | null): void {
    this.selectedParty = path;
    this.updateTokenLayer();
  }

  /** The selected party token on this map, in Play. */
  private activeParty(): TokenEntry | undefined {
    if (!this.selectedParty || this.undos.currentWorkMode() !== "play") return undefined;
    return this.tokenEntries.find((t) => t.filePath === this.selectedParty && t.party && t.visible);
  }

  /** Light the hexes the selected party can step to (and nothing else). */
  private markPartySteps(gridContainer: HTMLElement): void {
    gridContainer.querySelectorAll(".duckmage-party-step").forEach((el) => el.removeClass("duckmage-party-step"));
    const party = this.activeParty();
    if (!party) return;
    const [px, py] = party.hex.split("_").map(Number);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    for (const [nx, ny] of hexNeighbors(px, py, this.plugin.settings.hexOrientation, this.getActiveStagger())) {
      gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${nx}"][data-y="${ny}"]`)?.addClass("duckmage-party-step");
    }
  }

  /** Move the party one step to `hex` (clicked or dragged) and mark both hexes visited; one undo with what modules filled. */
  private async moveParty(party: TokenEntry, hex: string, dragged = false): Promise<void> {
    if (!guardWrite(party.map, "token")) return;
    const step = { map: party.map, from: party.hex, to: hex, token: party.filePath };
    this.partyMoves.set(party.filePath, hex);
    this.setVisited([step.from, hex], true);
    if (!dragged) this.updateTokenLayer();
    const moved = setTokenHex(this.app, party.filePath, hex, party.map);
    const filled = await runPartyEntered(this.plugin, step);
    const token: UndoItem = { kind: "token", path: party.filePath, before: { hex: step.from, map: party.map }, after: { hex, map: party.map } };
    this.undos.pushUndo(filled.length ? { kind: "group", items: [token, ...filled] } : token, party.map);
    await moved;
    if (filled.length) this.renderGrid();
  }

  /** Mark hexes of the open map visited (or not), saved in its map note. */
  private setVisited(keys: string[], on: boolean): void {
    const map = this.getActiveMap();
    const before = parseVisited(map.visited);
    const after = on ? markVisited(before, ...keys) : keys.reduce((l, k) => unmarkVisited(l, k), before);
    if (after.length === before.length && after.every((k, i) => k === before[i])) return;
    map.visited = after;
    void this.plugin.saveSettings();
    this.applyVisitedMarks();
  }

  /** Visited marks ← the map's list, without a re-render. */
  private applyVisitedMarks(): void {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (!grid) return;
    const set = new Set(parseVisited(this.getActiveMap().visited));
    grid.querySelectorAll<HTMLElement>(".duckmage-hex").forEach((el) => {
      el.toggleClass("duckmage-hex-visited", set.has(`${el.dataset.x}_${el.dataset.y}`));
    });
  }

  /** "Add to play log…" for hex (x, y) (SF3). */
  private openPlayLog(x: number, y: number): void {
    new PlayLogModal(this.app, `${this.plugin.mapLabel(this.activeMapName)} ${x}, ${y}`, (text) =>
      addToPlayLog(this.plugin, this.activeMapName, x, y, text),
    ).open();
  }

  private updateTokenLayer(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) return;
    this.renderTokenLayer(gridContainer);
  }

  private startTokenDrag(
    token: TokenEntry,
    tokenEl: HTMLElement,
    startEvt: MouseEvent,
    centerMap: Map<string, { cx: number; cy: number }>,
    onClickInstead: () => void,
  ): void {
    const startClientX = startEvt.clientX;
    const startClientY = startEvt.clientY;
    const origLeft = parseFloat(tokenEl.style.left);
    const origTop  = parseFloat(tokenEl.style.top);
    let isDragging  = false;
    let closestHex: string | null = null;

    const onMove = (e: MouseEvent) => {
      if (!isDragging) {
        if (Math.hypot(e.clientX - startClientX, e.clientY - startClientY) < 4) return;
        isDragging = true;
        tokenEl.addClass("duckmage-token-dragging");
      }
      const dx = (e.clientX - startClientX) / this.viewport.zoom;
      const dy = (e.clientY - startClientY) / this.viewport.zoom;
      tokenEl.style.left = `${origLeft + dx}px`;
      tokenEl.style.top  = `${origTop  + dy}px`;

      const cx = origLeft + dx;
      const cy = origTop  + dy;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const [key, center] of centerMap) {
        const dist = Math.hypot(center.cx - cx, center.cy - cy);
        if (dist < bestDist) { bestDist = dist; best = key; }
      }
      if (best !== closestHex) {
        if (closestHex) { const [px, py] = closestHex.split("_").map(Number); this.viewportEl?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.removeClass("duckmage-token-drop-target"); }
        closestHex = best;
        if (best) { const [px, py] = best.split("_").map(Number); this.viewportEl?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.addClass("duckmage-token-drop-target"); }
      }
    };

    const onUp = () => {
      activeDocument.removeEventListener("mousemove", onMove);
      activeDocument.removeEventListener("mouseup", onUp);
      tokenEl.removeClass("duckmage-token-dragging");

      if (closestHex) { const [px, py] = closestHex.split("_").map(Number); this.viewportEl?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.removeClass("duckmage-token-drop-target"); }

      if (!isDragging) { onClickInstead(); return; }

      if (closestHex && closestHex !== token.hex) {
        // Snap to the new hex centre now; the cache `changed` event re-renders the layer once the
        // write lands (updateTokenLayer() here would draw the stale hex, then flicker on `changed`).
        const newCenter = centerMap.get(closestHex);
        if (newCenter) {
          tokenEl.style.left = `${newCenter.cx}px`;
          tokenEl.style.top  = `${newCenter.cy}px`;
        }
        if (guardWrite(token.map, "token")) {
          // Dragging the party still travels: both hexes count as visited (SF5), and the step explores.
          if (token.party && token.map === this.activeMapName) void this.moveParty(token, closestHex, true);
          else {
            this.undos.pushTokenUndo(token.filePath, token.map, { hex: token.hex, map: token.map }, { hex: closestHex, map: token.map });
            void setTokenHex(this.app, token.filePath, closestHex, token.map);
          }
        }
      } else {
        const orig = centerMap.get(token.hex);
        if (orig) {
          tokenEl.style.left = `${orig.cx}px`;
          tokenEl.style.top  = `${orig.cy}px`;
        }
      }
    };

    activeDocument.addEventListener("mousemove", onMove);
    activeDocument.addEventListener("mouseup", onUp);
  }

  private openTokenEditor(token: TokenEntry): void {
    new TokenModal(
      this.app,
      this.plugin,
      token.filePath,
      token.title,
      { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, description: token.description, party: token.party, logFolder: token.logFolder },
      (_notePath, data) => {
        void applyTokenFrontmatter(this.app, token.filePath, data)
          .then(() => this.updateTokenLayer());
      },
      () => this.removeToken(token),
    ).open();
  }

  /** A token's place and look, for undo of making or removing it. */
  private tokenSnap(token: TokenEntry): TokenSnap {
    return {
      hex: token.hex,
      map: token.map,
      visible: token.visible,
      look: { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, tokenLink: token.tokenLink, description: token.description, party: token.party, logFolder: token.logFolder ?? "" },
    };
  }

  /** Remove a token from the map (the note stays); undoable. */
  private removeToken(token: TokenEntry): void {
    if (!guardWrite(token.map, "token")) return;
    this.undos.pushTokenUndo(token.filePath, token.map, this.tokenSnap(token), null);
    void removeTokenFrontmatter(this.app, token.filePath)
      .then(() => this.updateTokenLayer());
  }

  private openTokenInfo(token: TokenEntry): void {
    new TokenInfoModal(
      this.app,
      token,
      (x, y) => this.centerOnHex(x, y),
      () => this.removeToken(token),
      () => this.openTokenEditor(token),
    ).open();
  }

  private showTokenContextMenu(evt: MouseEvent, token: TokenEntry): void {
    const menu = new ModeMenu(this.undos.currentWorkMode(), this.modeMenuOptions());
    menu.add("token.edit", "Edit token", "pencil", () => this.openTokenEditor(token));
    menu.add("token.info", "Token info", "info", () => this.openTokenInfo(token));
    // SF5: any token can be the party (moves by clicking a neighbour in Play).
    menu.add("token.party", "Party token", "users", () => {
      if (token.party && this.selectedParty === token.filePath) this.selectedParty = null;
      void applyTokenFrontmatter(this.app, token.filePath, { party: !token.party }).then(() => this.updateTokenLayer());
    }, { checked: !!token.party });
    menu.add("token.open-note", "Open note", "file-text", () => {
      const file = this.app.vault.getAbstractFileByPath(token.filePath);
      if (file instanceof TFile) void openNoteFocused(this.app, file);
    });
    menu.addSeparator();
    menu.add("token.remove", "Remove token", "trash", () => this.removeToken(token));
    // The token covers its hex's centre, so the hex's own items follow
    // (F8: right-clicking "where the ship is" only gave the token's menu).
    const [hx, hy] = token.hex.split("_").map(Number);
    if (token.map === this.activeMapName && Number.isFinite(hx) && Number.isFinite(hy)) {
      menu.addSeparator();
      const hexName = this.plugin.mapStore.get(this.activeMapName, `${hx}_${hy}`)?.name?.trim();
      menu.addLabel(hexName ? `This hex: ${hexName}` : `This hex: ${hx}, ${hy}`);
      if (this.owView(this.getActiveMap())) this.addOverworldMenuItems(menu, evt, hx, hy);
      else this.addHexMenuItems(menu, hx, hy, true);
    }
    menu.showAtMouseEvent(evt);
  }
}

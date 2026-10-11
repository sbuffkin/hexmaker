import { ItemView, Notice, Scope, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder, getIconUrl, createIconEl } from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  getFrontMatter,
  terrainFromFm,
  pendingTerrainOf,
  iconOverrideFromFm,
  gmIconsFromFm,
  setGmIconsInFile,
  setTerrainInFile,
  setIconOverrideInFile,
  getGmIconsFromFile,
  readTokenPlace,
} from "../frontmatter";
import { cellPatch, currentCellEdits, sameValue, stillCurrent, UNDO_DEPTH, type UndoDirection } from "../undoBook";
import { HexEditorModal } from "./HexEditorModal";
import { TerrainPickerModal } from "./TerrainPickerModal";
import { IconPickerModal } from "./IconPickerModal";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "../sections";
import { getFactionColorFromFile, getRegionColorFromFile, getFactionStyleFromFile, getRegionStyleFromFile, setHexRegionInFile, getHexRegionFromFile, getSubmapFromFile, getHexMapsFromFile, type OverlayStyle } from "../frontmatter";
import { buildSvgPattern, colorToIdToken, type OverlayPatternKey } from "../overlayPatterns";
import { renderHexPreview } from "./overlayPatternControls";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { MapModal, renderMissingActions } from "./MapModal";
import { mapAncestors } from "./submapNav";
import { ancestorNeighbourCrumbs, neighbourCrumbs } from "../maps/mapTree";
import { toolModeLabel } from "./toolMode";
import { PathTool } from "./pathTool";
import type { PinRecord } from "../paths/routePins";
import { pathListSummary } from "./pathTool";
import { flowerPetals, MapHistory, navArrows, neighbourButton, PAD_SIDES } from "../maps/mapNav";
import { ADD_REGION_LOCKED_HINT, allows, canAdd, lockedHint, lockedSummary, TOOL_ACTIONS, WORK_MODES, WORK_MODE_TEXT, workModeOf, type ModeAction, type WorkMode } from "../workMode";
import { canDo, guardWrite } from "../modeGate";
import { ModeMenu } from "./modeMenu";
import { REGION_AREAS_TOOL } from "./toolMode";
import { openNoteFocused } from "../openNote";
import { coordHaloColor } from "../coordStyle";
import { ghostPathRuns, ghostRunPoints, seamJoinKey, seamJoins, seamPoint, type ShadowRef } from "./ghostPaths";
import { fitToSafeArea, mayAutoPan, overlayInsets, revealDelta, unionBoxes, usableInsets, zoomForHexWidth, NO_INSETS, type Box, type Insets } from "./safeArea";
import { wheelZoomLog, wheelZoomsMap } from "./wheelZoom";
import { groupSize, pickTokenFill, tokenGroupOffsets, tokenNamePlacement } from "./tokenDefaults";
import { hexHoverLabel, hexKeyCoords, overlayClosed, pointerMovedFrom } from "./hexHover";
import { renderHexNameLayer } from "./hexNameLayer";
import { resolveNameFont } from "./hexNameFont";
import { whenSized } from "./whenSized";
import { getHexNameFromFile } from "../frontmatter";
import { nearestHex } from "./hitTest";
import { PathPickerModal } from "./PathPickerModal";
import { impassableNames } from "../impassable";
import type { MapData, MapPath, TokenEntry } from "../types";
import { hexNeighbors, smoothPath, sharpPath } from "./hexGeometry";
import {
  applyAffine,
  calibrateAffine,
  END_DOT_PX,
  HANDLE_PX,
  fmt,
  latticeCenter,
  pxToLattice,
  type LatticeAffine,
  type LatticeGrid,
} from "../paths/pathGeometry";
import { moonPlanetLinks, tether } from "./moonLinks";
import { GotoHexModal } from "./GotoHexModal";
import { HexHelpModal } from "./HexHelpModal";
import { FolderTreePickerModal } from "./FolderTreePickerModal";
import { FactionPickerModal } from "./FactionPickerModal";
import { GeoRegionPickerModal } from "./GeoRegionPickerModal";
import { DrawingToolPanel, OverlayPanel } from "./HexSidePanel";
import { BADGE_INFO, badgeNameLimit, badgeSize, hexKeyFromBasename, hiddenBadges, legendBadgeKinds, linkedNotesText, linksBySection, linkSectionsFromCache, renderLinkBadgeLayer, type BadgeSection } from "./linkBadges";
import { legendSize, MAP_LEGEND_NAME_MAX, renderTerrainLegend, usedTerrainEntries } from "./terrainLegend";
import { TokenModal } from "./TokenModal";
import { SubmapPickerModal } from "./SubmapPickerModal";
import { LocationsModal } from "./LocationsModal";
import { startNewChildMap, startNewLocation, type NewChildMapHost } from "./newChildMap";
import { hexChildMaps, regionMapAt, submapMenuPlan } from "../maps/submaps";
import { OverworldLayer } from "./overworldLayer";
import { OverworldMinimap } from "./overworldMinimap";
import { BiomePickerModal, type BiomeHost } from "./BiomeModals";
import { EditRegionModal } from "./EditRegionModal";
import { inOverworldGrid, overworldOf, regionHome, regionPalette, walkLock } from "../overworld/regionsVault";
import { applyProjectionUndo, confirmOverworldPath, draftPathNames, isPathOverworld, prepareProjectionUndo, removeOverworldPath } from "../overworld/overworldPaths";
import { draftsAfterEdit, isApplied } from "../overworld/pathProjection";
import { brushCells, FrameThrottle, terrainDiff, overworldLeftClick, overworldMenu, PAINT_LOCKED_HINT, PAINT_NO_REGION_HINT, paintTargets } from "../overworld/overworldInput";
import { WalkRegionModal, type OverworldWalk } from "../worldgen/WalkRegionModal";
import type { Side } from "../worldgen/world";
import { withFeature } from "../advancedHints";
import { overworldRefreshFor } from "../overworld/overworldChanges";
import { RegionNavigateModal } from "./RegionNavigateModal";
import { neighbourShadow, neighbourSpec } from "../worldgen/neighbours";
import { TokenInfoModal } from "./TokenInfoModal";
import {
  getTokenDataFromCache,
  applyTokenFrontmatter,
  removeTokenFrontmatter,
  setTokenHex,
} from "../frontmatter";
import { PainterContextMenu } from "./PainterContextMenu";

import type { CalibrateSnapshot, FactionUndoEntry, IconUndoEntry, RegionUndoEntry, SubHexUndoEntry, TerrainUndoEntry, TokenSnap, UndoItem } from "./undoItems";

function nullOverrides(paths: string[]): Map<string, null> {
  return new Map(paths.map((p) => [p, null]));
}

/**
 * GM icon sub-grid positions inside a hex. 7 slots arranged as a small
 * honeycomb (top-row of 2, middle-row of 3, bottom-row of 2), filled
 * in reading order — first icon lands top-left, second top-right, etc.
 * Values are unit offsets in [-1, +1]; multiply by the hex's
 * half-width/half-height (`spread`) to get pixel offsets.
 *
 * Layout:
 *      0   1
 *    2   3   4
 *      5   6
 *
 * Used by `renderPathOverlay`'s GM-icon section so multiple icons on
 * the same hex form a hex-shaped cluster (matches the user's request
 * in hexmaker#28 for "a sort of grid, a hex-subgrid").
 */
const GM_ICON_HEX_SUBGRID: [number, number][] = [
  [-0.34, -0.55], // NW
  [+0.34, -0.55], // NE
  [-0.62,  0.00], // W
  [ 0.00,  0.00], // C
  [+0.62,  0.00], // E
  [-0.34, +0.55], // SW
  [+0.34, +0.55], // SE
];

/** The path layer's measurement of one grid (see calibratePathLayer). */
interface PathLayerCalibration {
  grid: HTMLElement;
  lattice: LatticeGrid;
  /** Lattice units → em in the grid's frame. */
  affine: LatticeAffine;
  /** A hex's drawn radius, em: path widths (lattice units) scale by it. */
  hexRadius: number;
  /** A hex element's size, em. */
  hexW: number;
  hexH: number;
}

export class HexMapView extends ItemView {
  plugin: HexmakerPlugin;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private zoomSettleTimer: number | null = null;
  // Coord labels are created only for on-screen hexes big enough to read
  // (see syncCoordLabels). Placements are measured once per renderGrid.
  private coordPlacements: { key: string; ox: number; oy: number }[] = [];
  /** The neighbour strip last drawn (map name + its hexes), so the path
   *  overlay can join paths across the seam (round 6 U8). */
  private lastShadow: { map: string; shadow: ReadonlyMap<string, ShadowRef> } | null = null;
  /** The seam joins the neighbour strip was drawn with: drawing or erasing
   *  a path that changes them redraws the strip. */
  private shadowJoinKey = "";

  /** Paths of the open map that meet a neighbour's path across the seam. */
  private currentSeamJoins(region: MapData) {
    const s = this.lastShadow;
    if (!s || s.map !== region.name || !s.shadow.size) return [];
    const orientation = this.plugin.settings.hexOrientation;
    const stagger = this.getActiveStagger();
    const touches = (a: string, b: string) => {
      const [x, y] = a.split("_").map(Number);
      return hexNeighbors(x, y, orientation, stagger).some(([nx, ny]) => `${nx}_${ny}` === b);
    };
    return seamJoins(this.plugin.paths.resolvedPathChains(region.name), s.shadow, (m) => this.plugin.paths.resolvedPathChains(m), touches);
  }
  private coordGridSize = { w: 1, h: 1 };
  private coordLabels = new Map<string, HTMLElement>();
  // Link badges + terrain legend refresh on note / map-store changes (debounced).
  private badgeTimer: number | null = null;
  /** Badge kinds some hex of the map shows (for the legend). */
  private badgeKindsOnMap: BadgeSection[] = [];
  /** Link sections per hex ("x_y") from the last badge render; names keep clear of them. */
  private badgeSectionsByHex = new Map<string, BadgeSection[]>();
  /** Cancels a renderGrid waiting for the grid to get a layout size. */
  private cancelMeasuredLayers: (() => void) | null = null;
  private legendTimer: number | null = null;
  private namesTimer: number | null = null;
  /** Names the hex-name layer was last drawn with ("x_y=name" lines), to skip no-op redraws. */
  private drawnHexNames = "";
  /** Zoom at the last transform: a change redraws the names (readable size, NM3). */
  private namesZoom = 1;
  private controlsEl: HTMLElement | null = null;
  private settleTimer: number | null = null;
  // Wheel-zoom rAF coalescing. Wheel events fire faster than the browser
  // paints (esp. trackpads). We sum the log-zoom delta of all events that
  // arrive in one frame and apply them as ONE transform update on the next
  // rAF tick. This is the entire smoothing mechanism — no easing tail,
  // no inertia. The visual lands EXACTLY where the cumulative wheel deltas
  // placed it; when the user stops scrolling, the visual stops moving.
  //
  // Smoothness during a fast scroll comes naturally from trackpad event
  // deltas being small (deltaY≈2-10 per event) so visual motion between
  // events is sub-pixel. For mouse wheels (deltaY≈100 per notch) each
  // notch is one visible step — that's what the user wants ("stop where
  // I stopped scrolling") and it's not actually clunky because the rAF
  // batching keeps the paint cadence tight.
  private pendingZoomLog = 0;
  private pendingZoomPivot: { cx: number; cy: number } | null = null;
  private zoomFrameId: number | null = null;
  private viewportEl: HTMLElement | null = null;
  // Cached bg-image layer reused across renders (see renderBackgroundImage) so
  // renderGrid()'s viewportEl.empty() doesn't force an image re-decode each time.
  private bgLayerEl: HTMLElement | null = null;
  private bgLayerSrc: string | null = null;
  // Single-canvas terrain-colour snapshot shown during a calibration drag in
  // place of the 3843 hex cells (see buildCalibrationSnapshot).
  private calSnapshotEl: HTMLCanvasElement | null = null;
  private drawingMode:
    | "path"
    | "terrain"
    | "icon"
    | "tableLink"
    | "submapLink"
    | "factionLink"
    | "regionLink"
    | "swap"
    | "placeToken"
    | null = null;
  private isErasingMode = false;
  /** On-map "which tool is on" bar (fresh-eyes T3); text set in updateModeBar. */
  private modeBarEl: HTMLElement | null = null;
  private modeBarTextEl: HTMLElement | null = null;
  /** Toolbar rows (and the mode bar) along the top of the map: hexes are
   *  kept out from under them (see safeArea.ts). */
  private topBandEls: HTMLElement[] = [];
  /** Time of the last right-click while a tool was active (double-right-click exits). */
  private lastToolContextMenuAt = 0;
  /** The open (or last) right-click tool menu, so Esc can close it first. */
  private painterMenu: PainterContextMenu | null = null;
  private pathToolbarBtn: HTMLButtonElement | null = null;
  private pathBtnSwatch: HTMLElement | null = null;
  private terrainToolbarBtn: HTMLButtonElement | null = null;
  private terrainBtnPreview: HTMLSpanElement | null = null;
  private iconToolbarBtn: HTMLButtonElement | null = null;
  private iconBtnPreview: HTMLImageElement | null = null;
  private tableLinkBtn: HTMLButtonElement | null = null;
  private tableLinkBtnLabel: HTMLSpanElement | null = null;
  private paintTablePath: string | null = null;
  private submapLinkBtn: HTMLButtonElement | null = null;
  private submapLinkBtnLabel: HTMLSpanElement | null = null;
  private paintSubmapName: string | null = null;
  private factionLinkBtn: HTMLButtonElement | null = null;
  private factionLinkBtnLabel: HTMLSpanElement | null = null;
  private paintFactionPath: string | null = null;
  private regionLinkBtn: HTMLButtonElement | null = null;
  private regionLinkBtnLabel: HTMLSpanElement | null = null;
  private paintRegionPath: string | null = null;
  private swapBtn: HTMLButtonElement | null = null;
  private overlayPanel: OverlayPanel | null = null;
  private toolsPanel: DrawingToolPanel | null = null;
  private swapSource: { x: number; y: number } | null = null;
  private swapDest: { x: number; y: number } | null = null;
  /** The path tool: drawing, selecting, reshaping (src/hex-map/pathTool.ts). */
  private pathTool: PathTool;
  /** Pins made while a terrain stroke is painted or its writes land (see routePins.ts). */
  private strokePins: PinRecord[] | null = null;
  /** Path tool controls in the mode bar (shown while drawing a path). */
  private modeBarRouteEl: HTMLElement | null = null;
  private paintTerrainName: string | null = null;
  private paintIconName: string | null = null;
  private paintIconGmOnly = false;
  private terrainPickMode = false;
  private paintBrushSize: 1 | 3 | 7 = 1;
  private brushHoverHexes: Array<[number, number]> = [];
  private selectedHex: { x: number; y: number } | null = null;
  // Per-hex write queues: always stores the *latest* desired value so rapid
  // repaints of the same hex coalesce into at most one queued write.
  private pendingTerrainWrites = new Map<
    string,
    { x: number; y: number; terrain: string | null }
  >();
  private pendingIconWrites = new Map<
    string,
    { x: number; y: number; icon: string | null }
  >();
  // GM icon writes are coalesced per-hex. The value is the full list to
  // write — multi-add semantics. Empty list means "clear all GM icons."
  private pendingGmIconWrites = new Map<
    string,
    { x: number; y: number; list: string[] }
  >();
  private flushing = new Set<string>(); // "t:<path>", "i:<path>", or "g:<path>"
  // Per-map viewport state saved when navigating away; restored on return (or fit on first visit).
  // fontSize must be saved alongside zoom/panX/panY because bakeZoom() encodes the visual zoom
  // into viewportEl.style.fontSize and resets this.zoom to 1. Restoring without the fontSize
  // would apply the wrong scale on the incoming map.
  private mapViewport = new Map<string, { zoom: number; panX: number; panY: number; fontSize: string }>();
  private factionTooltipEl: HTMLElement | null = null;
  // Faction links painted but not yet reflected in the metadata cache
  private pendingFactionLinks = new Map<string, Set<string>>();
  // Faction links erased but cache may still reflect them — excluded from overlay
  private erasedFactionLinks = new Map<string, Set<string>>();
  // Region painted/erased but not yet in metadata cache
  private pendingRegions = new Map<string, string>(); // hexPath → regionBasename
  private erasedRegions = new Set<string>();           // hexPaths with cleared region
  private savingIndicatorEl: HTMLElement | null = null;
  // Undo / redo
  // (the queues live in plugin.undoBook: one per map per work mode, WM6)
  private stopUndoListen: (() => void) | null = null;
  private currentTerrainStroke: Map<string, TerrainUndoEntry> | null = null;
  private currentIconStroke: Map<string, IconUndoEntry> | null = null;
  private currentFactionStroke: Map<string, FactionUndoEntry> | null = null;
  private currentRegionStroke: Map<string, RegionUndoEntry> | null = null;
  private currentSubStroke: Map<string, SubHexUndoEntry> | null = null;
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
  private overworldLayer!: OverworldLayer;
  private minimap!: OverworldMinimap;
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
  private crumbsEl: HTMLElement | null = null;
  /** Sideways crumbs: the neighbouring regions of the open map. */
  private sideCrumbsEl: HTMLElement | null = null;
  /** False until the first map's viewport is placed (restored or fitted). */
  private viewportReady = false;
  private tokenEntries: TokenEntry[] = [];
  private pendingTokenNotePath: string | null = null;
  private pendingTokenPlaceData: { icon?: string; shape: import("../types").TokenShape; size: import("../types").TokenSize; color?: string; border?: string; description?: string } | null = null;
  private tokenBtn: HTMLButtonElement | null = null;
  /** The drawing panel's one line naming the mode that unlocks the hidden tools. */
  private toolsLockedEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HexmakerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.pathTool = new PathTool({
      plugin: this.plugin,
      mapName: () => this.activeMapName,
      pointerLattice: (e) => this.pointerLattice(e),
      hexAtPoint: (x, y) => {
        const hexEl = this.hexElAt(this.contentEl.ownerDocument.elementFromPoint(x, y), x, y);
        return hexEl ? `${hexEl.dataset.x}_${hexEl.dataset.y}` : null;
      },
      ownerDocument: () => this.contentEl.ownerDocument,
      pushUndo: (map, before, after) => this.pushPathUndo(map, before, after),
      redraw: () => this.updatePathOverlay(),
      refreshBar: () => this.updateModeBar(),
      setGrabCursor: (on) => this.viewportEl?.toggleClass("duckmage-path-grab", on),
      typeChanged: () => this.updateToolbarButtonStates(),
    });
    this.overworldLayer = new OverworldLayer(plugin);
    this.minimap = new OverworldMinimap(plugin, this);
  }

  /** Full redraw (the overworld view switch). */
  redraw(): void {
    this.renderGrid();
  }

  /** Timings of the overworld region layer's last draw (dev tools, bench). */
  overworldStats(): { ms: number; builds: number; regions: number; cells: number } {
    return { ...this.overworldLayer.lastStats };
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
    if (this.viewportEl && this.viewportReady) {
      const snapshot = {
        zoom: this.zoom,
        panX: this.panX,
        panY: this.panY,
        fontSize: this.viewportEl.style.fontSize ?? "",
      };
      this.mapViewport.set(this.activeMapName, snapshot);
      const departing = this.plugin.getMap(this.activeMapName);
      if (departing) {
        departing.savedViewport = snapshot;
        void this.plugin.saveSettings();
      }
    }

    this.activeMapName = name;
    this.updateMapBtnLabel();
    this.refreshViewHeader();
    this.restoreViewport(name);
    this.refreshMapNav();
  }

  /**
   * Show `name` at its last viewport: the in-memory cache (live state from
   * this session), else the persisted savedViewport (survives view
   * close/reopen), else fit the whole grid (first visit).
   */
  private restoreViewport(name: string): void {
    const stored = this.mapViewport.get(name) ?? this.plugin.getMap(name)?.savedViewport;
    if (stored) {
      this.zoom = stored.zoom;
      this.panX = stored.panX;
      this.panY = stored.panY;
      this.setViewportFontSize(stored.fontSize);
      this.applyTransform();
      this.renderGrid();
      // A saved position can leave the grid off-screen or too small to see
      // (e.g. saved while the view had no size). Re-fit rather than show an
      // empty view.
      window.requestAnimationFrame(() => {
        this.refitIfLost();
        this.viewportReady = true;
      });
    } else {
      this.zoom = 1; this.panX = 0; this.panY = 0;
      this.setViewportFontSize("");
      this.applyTransform();
      this.renderGrid();
      window.requestAnimationFrame(() => {
        this.fitGridToView();
        this.viewportReady = true;
      });
    }
  }

  /**
   * The one way to change maps from the UI (map list, breadcrumb, submap
   * badge, Ctrl+click, context menu, hex editor, Up/Back targets). Exits the
   * active tool and clears undo — undo entries hold bare x/y and would apply
   * to the wrong map — and records history for Back.
   */
  navigateToMap(name: string, opts: { recordHistory?: boolean } = {}): void {
    if (!this.plugin.getMap(name)) {
      new Notice(`Map "${name}" no longer exists.`);
      return;
    }
    if (name === this.activeMapName) {
      this.renderGrid();
      return;
    }
    this.exitCurrentMode();
    this.exitPathMode();
    if (opts.recordHistory !== false) this.history.visit(this.activeMapName);
    this.switchToMap(name);
    // Each map keeps its own undo queues (WM6): show the new map's.
    this.updateUndoButton();
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
      (mapName, created) => {
        void (async () => {
          await this.plugin.linkSubmap(parentMap, x, y, mapName);
          // A freshly made map is where the user wants to be next.
          if (created && this.activeMapName === parentMap) this.navigateToMap(mapName);
          else this.renderGrid();
        })();
      },
      undefined,
      { map: parentMap, x, y },
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
    const ins = usableInsets(clip.width, clip.height, this.measureOverlayInsets());
    const dx = revealDelta(h.left - clip.left, h.right - clip.left, ins.left, clip.width - ins.right);
    const dy = revealDelta(h.top - clip.top, h.bottom - clip.top, ins.top, clip.height - ins.bottom);
    if (dx === 0 && dy === 0) return;
    this.panX += dx;
    this.panY += dy;
    this.applyTransform();
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
    for (const name of ancestors) {
      const label = this.plugin.mapLabel(name);
      const crumb = crumbs.createEl("button", {
        cls: "duckmage-map-crumb",
        text: label,
        attr: { title: `Go to ${label}` },
      });
      crumb.addEventListener("click", () => this.navigateToMap(name));
      crumbs.createSpan({ cls: "duckmage-map-crumb-sep", text: "›" });
    }
    crumbs.toggle(ancestors.length > 0);
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
    const menu = new ModeMenu(cur);
    for (const m of WORK_MODES) {
      menu.add("mode.switch", `${WORK_MODE_TEXT[m].label}: ${WORK_MODE_TEXT[m].desc}`, null, () => this.setWorkMode(m), { checked: m === cur });
    }
    menu.showAtMouseEvent(e);
  }

  /** Switch the open map's work mode (saved in its map note as `mode:`). */
  setWorkMode(mode: WorkMode): void {
    const map = this.plugin.getMap(this.activeMapName);
    if (!map || workModeOf(map) === mode) return;
    // The current stroke belongs to the mode it was made in.
    this.commitTerrainStroke();
    this.commitIconStroke();
    map.workMode = mode;
    void this.plugin.saveSettings();
    // A tool the new mode locks is put down.
    if (this.drawingMode && !allows(mode, TOOL_ACTIONS[this.drawingMode])) this.exitCurrentMode();
    this.refreshWorkModeBtn();
    // The neighbour "+" buttons lock and unlock with the mode.
    this.refreshSideCrumbs();
    this.applyWorkModeUi();
    // Each mode has its own undo queue (WM6).
    this.updateUndoButton();
  }

  /**
   * Show the open map's mode on the UI: the drawing panel shows only the
   * tools the mode allows, with one line naming the mode that unlocks the
   * rest; the grid's +/− buttons follow (CSS on the mode class).
   */
  private applyWorkModeUi(): void {
    const mode = this.currentWorkMode();
    this.contentEl.removeClass("duckmage-mode-play", "duckmage-mode-build", "duckmage-mode-god");
    this.contentEl.addClass(`duckmage-mode-${mode}`);
    const tools: [HTMLElement | null, ModeAction][] = [
      [this.terrainToolbarBtn, TOOL_ACTIONS.terrain],
      [this.iconToolbarBtn, TOOL_ACTIONS.icon],
      [this.pathToolbarBtn, TOOL_ACTIONS.path],
      [this.tableLinkBtn, TOOL_ACTIONS.tableLink],
      [this.submapLinkBtn, TOOL_ACTIONS.submapLink],
      [this.factionLinkBtn, TOOL_ACTIONS.factionLink],
      [this.regionLinkBtn, TOOL_ACTIONS.regionLink],
      [this.tokenBtn, TOOL_ACTIONS.placeToken],
    ];
    const locked: ModeAction[] = [];
    for (const [btn, action] of tools) {
      const ok = allows(mode, action);
      btn?.toggle(ok);
      if (!ok) locked.push(action);
    }
    const hint = lockedSummary(locked);
    if (this.toolsLockedEl) {
      this.toolsLockedEl.setText(hint ?? "");
      this.toolsLockedEl.toggle(!!hint);
    }
    for (const b of this.contentEl.querySelectorAll<HTMLButtonElement>(".duckmage-shrink-btn")) {
      b.disabled = !allows(mode, "shrink-map");
      b.setAttr("title", allows(mode, "shrink-map") ? "Remove this edge" : lockedHint("shrink-map"));
    }
  }

  /**
   * May the open map do `action` in its mode? When not, says which mode
   * would (one Notice) and returns false.
   */
  private modeAllows(action: ModeAction): boolean {
    if (canDo(this.activeMapName, action)) return true;
    new Notice(lockedHint(action));
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
    const home = regionHome(this.plugin, this.activeMapName);
    if (home) {
      const petals = flowerPetals(home.layout.orientation, home.layout.parentStagger, home.px, home.py);
      const palette = this.plugin.getMapPalette(home.overworld.name);
      const flower = el.createDiv({ cls: "duckmage-region-flower", attr: { role: "group", "aria-label": "Neighbouring regions" } });
      const R = 12; // px from the middle to a petal's centre
      // The centre petal is this region: click it for Edit region….
      const here = flower.createEl("button", {
        cls: "duckmage-region-flower-petal is-here",
        attr: { title: `Here: ${this.plugin.mapLabel(this.activeMapName)}. Click to edit this region.`, "aria-label": "Edit region" },
      });
      here.setCssProps({ "--duckmage-petal-x": "0px", "--duckmage-petal-y": "0px" });
      here.addEventListener("click", () => this.openEditRegion(home.px, home.py, home.overworld.name));
      const lock = walkLock(this.plugin, this.activeMapName, home.overworld.name);
      for (const p of petals) {
        const key = `${p.hex[0]}_${p.hex[1]}`;
        const region = regionMapAt(maps, home.overworld.name, key);
        const terrain = this.plugin.mapStore.get(home.overworld.name, key)?.terrain;
        const colour = terrain ? palette.find((t) => t.name === terrain)?.color : undefined;
        // An empty petal is new land: "+" walks into it (pick or roll its biome).
        const b = neighbourButton(p.bearing, region ? { name: region.name, label: this.plugin.mapLabel(region.name) } : undefined, {
          canMake: true,
          canAdd: !lock,
          lockedHint: lock ?? "",
          inGrid: inOverworldGrid(home.overworld, p.hex[0], p.hex[1]),
        });
        const petal = flower.createEl("button", {
          cls: "duckmage-region-flower-petal" + (region ? "" : " is-empty is-new") + (b.action.kind === "locked" ? " is-locked" : ""),
          text: b.plus ? "+" : "",
          attr: { title: b.title, "aria-label": b.title, "data-side": p.bearing, "data-hex": key },
        });
        petal.setCssProps({ "--duckmage-petal-x": `${(p.dx * R).toFixed(1)}px`, "--duckmage-petal-y": `${(p.dy * R).toFixed(1)}px` });
        if (colour && region) petal.setCssProps({ "--duckmage-petal-bg": colour });
        petal.disabled = b.disabled;
        const action = b.action;
        if (action.kind === "go") petal.addEventListener("click", () => this.navigateToMap(action.target));
        else if (action.kind === "new") {
          petal.addEventListener("click", () => this.openWalk({ overworld: home.overworld.name, px: p.hex[0], py: p.hex[1], bearing: p.bearing }));
        }
      }
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
        canMake: !via && neighbourSpec(this.plugin, this.activeMapName, s).ok,
        canAdd: canAdd(active),
        lockedHint: ADD_REGION_LOCKED_HINT,
      });
      const title = c && via ? `${s[0].toUpperCase() + s.slice(1)} of ${this.plugin.mapLabel(via)}: ${this.plugin.mapLabel(c.name)}` : b.title;
      const btn = pad.createEl("button", {
        cls: `duckmage-map-pad-btn is-${s}` + (b.plus ? " is-new" : "") + (b.action.kind === "locked" ? " is-locked" : ""),
        text: b.plus ? "+" : glyph,
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
   * flow as the hex editor's neighbour flower (WalkRegionModal).
   */
  private openWalk(to: Side | OverworldWalk): void {
    const from = this.activeMapName;
    const open = () => new WalkRegionModal(this.app, this.plugin, from, to, (name) => {
      if (this.activeMapName === from) this.navigateToMap(name);
      else this.refreshSideCrumbs();
    }).open();
    // A side-by-side world picks a terrain generator; an overworld needs neither feature.
    if (typeof to === "string") withFeature(this.plugin, "regions", () => withFeature(this.plugin, "generators", open));
    else open();
  }

  public switchMapFromModal(name: string): void {
    this.navigateToMap(name);
  }

  onOpen(): Promise<void> {
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
    this.stopUndoListen = this.plugin.undoBook.onChange(() => this.updateUndoButton());

    // A prior build (or a crashed view) may have left a calibration banner
    // attached to the document body. Sweep before we render so the user
    // doesn't see a phantom "Calibrating background" on a fresh view.
    this.sweepStrayCalibrationHelp();

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
    this.applyTransform();

    // Mode bar: paint/draw tools are sticky, so say which one is on and how
    // to stop it (fresh-eyes T3). Hidden while no tool is active.
    this.modeBarEl = controlsEl.createDiv({
      cls: "duckmage-mode-bar",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.modeBarTextEl = this.modeBarEl.createSpan({ cls: "duckmage-mode-bar-text" });
    this.modeBarRouteEl = this.modeBarEl.createSpan({ cls: "duckmage-mode-bar-route" });
    this.modeBarRouteEl.hide();
    this.modeBarEl.createSpan({
      cls: "duckmage-mode-bar-hint",
      text: "Right-click: options · Esc: stop",
    });
    const modeBarStop = this.modeBarEl.createEl("button", {
      cls: "duckmage-mode-bar-stop",
      text: "✕",
      attr: { title: "Stop this tool", "aria-label": "Stop this tool" },
    });
    modeBarStop.addEventListener("click", () => this.exitCurrentMode());
    this.modeBarEl.hide();

    // Esc leaves the active tool (modals and menus handle their own Esc first).
    this.scope.register([], "Escape", () => {
      // An open tool menu takes the first Esc (Obsidian's keymap sees the
      // key before the menu's own listener would).
      if (this.painterMenu?.isOpen()) {
        this.painterMenu.close();
        return false;
      }
      if (this.drawingMode === null) return true;
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

    this.registerDomEvent(clipEl, "mouseleave", () => {
      this.updateBrushHighlight(null, null);
    });

    // A modal or menu closing over the map leaves the hex under the unmoved
    // pointer lit as if hovered (round 5: a stray highlight after Create
    // token). Pause the hover highlight until the pointer really moves.
    const doc = contentEl.ownerDocument;
    let lastPointer = { x: -1, y: -1 };
    let hoverPausedAt: { x: number; y: number } | null = null;
    this.registerDomEvent(doc, "mousemove", (e: MouseEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!pointerMovedFrom(hoverPausedAt, e.clientX, e.clientY)) return;
      hoverPausedAt = null;
      this.viewportEl?.removeClass("duckmage-hover-paused");
    });
    const overlayWatch = new MutationObserver((records) => {
      if (!records.some((r) => overlayClosed(Array.from(r.removedNodes)))) return;
      hoverPausedAt = { ...lastPointer };
      this.viewportEl?.addClass("duckmage-hover-paused");
    });
    overlayWatch.observe(doc.body, { childList: true });
    this.register(() => overlayWatch.disconnect());

    // Hover info: a hex's terrain + coords as its tooltip / accessible name.
    // One delegated listener, filled in on first hover of each hex — no
    // per-hex listeners or per-render work on big maps, and always the
    // current terrain (painting doesn't re-render the grid).
    this.registerDomEvent(clipEl, "mouseover", (e: MouseEvent) => {
      const hexEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(".duckmage-hex[data-x]");
      // Regions view: the grid's own tooltip names the region under the pointer.
      if (hexEl && !hexEl.closest(".duckmage-ow-regions")) this.labelHex(hexEl);
    });

    // ── Zoom (scroll wheel, no modifier required) ──────────────────────────
    // Delta-aware + rAF-batched (see wheelZoom.ts). Mouse notch (deltaY=100)
    // → ~1.16× per event. Trackpads (deltaY≈2-10) → tiny per-event factors
    // that look smooth because many events fire per frame and the rAF tick
    // applies them as one update. NO easing tail — the visual lands exactly
    // at the cumulative wheel delta and stops the frame after the last event.
    this.registerDomEvent(
      contentEl,
      "wheel",
      (e: WheelEvent) => {
        // Over the toolbar panels/menus the wheel scrolls them; with a modal
        // open it belongs to the modal (fresh-eyes round 3: "scroll-to-zoom
        // when I meant to scroll the modal").
        const overMap = e.target instanceof Node && clipEl.contains(e.target);
        const modalOpen = !!contentEl.ownerDocument.body.querySelector(":scope > .modal-container");
        if (!wheelZoomsMap(overMap, modalOpen)) {
          if (modalOpen) e.preventDefault();
          return;
        }
        // Calibration mode: image/grid wheel handlers own plain-wheel scaling
        // (they stopPropagation), so this only fires for Ctrl/Cmd+wheel
        // (which the layer handlers explicitly let through) or wheels outside
        // both layers. Treat both as a viewport zoom.
        e.preventDefault();
        const rect = contentEl.getBoundingClientRect();
        this.pendingZoomLog += wheelZoomLog(e.deltaY, e.deltaMode);
        this.pendingZoomPivot = {
          cx: e.clientX - rect.left,
          cy: e.clientY - rect.top,
        };
        if (this.zoomFrameId !== null) return;
        this.zoomFrameId = window.requestAnimationFrame(() => {
          this.zoomFrameId = null;
          this.flushPendingZoom();
        });
      },
      { passive: false },
    );

    // ── Pan (click-drag) & Terrain drag-paint ─────────────────────────────
    let isDragging = false;
    let hasDragged = false;
    let dragStartX = 0,
      dragStartY = 0,
      panStartX = 0,
      panStartY = 0;
    let isTerrainPainting = false;
    let lastPaintedKey: string | null = null;
    let isRightDragging = false;
    let rightDragMoved = false;

    this.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
      // Calibration mode owns left-click drag (image + grid handlers manage it)
      if (this.bgCalibrating && e.button === 0) return;
      // Middle click: always pan
      if (e.button === 1) {
        e.preventDefault(); // suppress auto-scroll cursor
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panStartX = this.panX;
        panStartY = this.panY;
        this.viewportEl?.addClass("is-dragging");
        beginDrag();
        return;
      }
      // Right click with no active tool: pan (contextmenu suppressed if drag occurs)
      if (e.button === 2 && this.drawingMode === null) {
        isRightDragging = true;
        rightDragMoved = false;
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panStartX = this.panX;
        panStartY = this.panY;
        this.viewportEl?.addClass("is-dragging");
        beginDrag();
        return;
      }
      if (e.button !== 0) return;
      // The map's work mode may lock the active tool: say so once, put it down.
      if (this.drawingMode && !this.modeAllows(TOOL_ACTIONS[this.drawingMode])) {
        this.exitCurrentMode();
        hasDragged = true;
        return;
      }
      // Overworld full view: the terrain tool paints the regions' own hexes.
      if (this.drawingMode === "terrain" && OverworldLayer.viewOf(this.plugin, this.getActiveMap()) === "biomes") {
        // The brush paints the regions, so it works in the Regions view.
        this.showOverworldRegions();
        hasDragged = true;
        return;
      }
      if (this.drawingMode === "terrain" && this.overworldLayer.showsRegions(this.getActiveMap())) {
        if (!canAdd(this.getActiveMap())) {
          new Notice(PAINT_LOCKED_HINT);
          hasDragged = true;
          return;
        }
        this.subStrokeMissHinted = false;
        isTerrainPainting = true;
        lastPaintedKey = null;
        this.currentTerrainStroke = new Map();
        this.currentSubStroke = new Map();
        lastPaintedKey = this.paintSubHexAt(e.clientX, e.clientY);
        hasDragged = true;
        beginDrag();
        return;
      }
      if (this.drawingMode === "terrain" || this.drawingMode === "icon" || this.drawingMode === "factionLink" || this.drawingMode === "regionLink") {
        isTerrainPainting = true;
        lastPaintedKey = null;
        if (this.drawingMode === "terrain") {
          this.currentTerrainStroke = new Map();
          this.strokePins = [];
        }
        else if (this.drawingMode === "icon")
          this.currentIconStroke = new Map();
        else if (this.drawingMode === "factionLink")
          this.currentFactionStroke = new Map();
        else if (this.drawingMode === "regionLink")
          this.currentRegionStroke = new Map();
        // Paint the hex under the cursor immediately (or the nearest one
        // when the press landed in the gap between hexes).
        const hexEl = this.hexElAt(e.target, e.clientX, e.clientY);
        if (hexEl) {
          const x = Number(hexEl.dataset.x);
          const y = Number(hexEl.dataset.y);
          lastPaintedKey = `${x}_${y}`;
          if (this.drawingMode === "terrain") this.onHexPaintClick(x, y);
          else if (this.drawingMode === "icon") this.onHexIconClick(x, y);
          else if (this.drawingMode === "factionLink") void this.onHexFactionPaintClick(x, y);
          else void this.onHexRegionPaintClick(x, y);
          hasDragged = true; // suppress the subsequent click event
        }
        beginDrag();
        return; // skip pan setup
      }
      // The path tool takes a press on a point or line of its type (drag to reshape).
      if (this.drawingMode === "path" && this.pathTool.pointerDown(e, this.isErasingMode)) return;
      // Any other active tool (road, river, tableLink, swap):
      // let the click event handle it — don't set up drag/pan so hasDragged
      // never swallows the click.
      if (this.drawingMode !== null) return;
      isDragging = true;
      hasDragged = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = this.panX;
      panStartY = this.panY;
      this.viewportEl?.addClass("is-dragging");
      beginDrag();
    });

    // Hover brush highlight (no button held) — element-level so it keeps
    // working after "Move to new window" re-parents the view into a popout
    // document (issue #32). Stroke-time highlight is owned by onDragMove.
    this.registerDomEvent(contentEl, "mousemove", (e: MouseEvent) => {
      if (isTerrainPainting) return;
      if (this.drawingMode === "path" && e.buttons === 0) this.pathTool.pointerMove(e, this.isErasingMode);
      if (this.drawingMode === "terrain" || this.drawingMode === "icon") {
        const hexEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(
          ".duckmage-hex",
        );
        if (hexEl) {
          this.updateBrushHighlight(
            Number(hexEl.dataset.x),
            Number(hexEl.dataset.y),
          );
        } else {
          this.updateBrushHighlight(null, null);
        }
      }
    });

    // Pan / paint-stroke tracking. Document-level listeners are attached to
    // the document that owns the view AT DRAG START and removed on mouseup.
    // A fixed onOpen-time `activeDocument` registration goes stale when the
    // tab is moved to a popout window — the listeners stay on the main
    // window's document and drags silently die (issue #32).
    let dragDoc: Document | null = null;
    const onDragMove = (e: MouseEvent) => {
      if (isTerrainPainting && this.currentSubStroke) {
        const key = this.subHexKeyAt(e.clientX, e.clientY);
        if (key && key !== lastPaintedKey) lastPaintedKey = this.paintSubHexAt(e.clientX, e.clientY);
        return;
      }
      if (isTerrainPainting) {
        const el = dragDoc?.elementFromPoint(e.clientX, e.clientY) ?? null;
        const hexEl = this.hexElAt(el, e.clientX, e.clientY);
        if (hexEl) {
          const x = Number(hexEl.dataset.x);
          const y = Number(hexEl.dataset.y);
          const key = `${x}_${y}`;
          if (key !== lastPaintedKey) {
            lastPaintedKey = key;
            if (this.drawingMode === "terrain") this.onHexPaintClick(x, y);
            else if (this.drawingMode === "icon") this.onHexIconClick(x, y);
            else if (this.drawingMode === "factionLink") void this.onHexFactionPaintClick(x, y);
            else void this.onHexRegionPaintClick(x, y);
          }
          this.updateBrushHighlight(x, y);
        } else {
          this.updateBrushHighlight(null, null);
        }
        return;
      }
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!hasDragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        hasDragged = true;
        if (isRightDragging) rightDragMoved = true;
      }
      if (hasDragged) {
        this.panX = panStartX + dx;
        this.panY = panStartY + dy;
        this.applyTransform();
      }
    };
    const onDragUp = () => {
      if (isTerrainPainting) {
        if (this.drawingMode === "terrain") this.commitTerrainStroke();
        else if (this.drawingMode === "icon") this.commitIconStroke();
        else if (this.drawingMode === "factionLink") this.commitFactionStroke();
        else if (this.drawingMode === "regionLink") this.commitRegionStroke();
      }
      isTerrainPainting = false;
      lastPaintedKey = null;
      isDragging = false;
      isRightDragging = false;
      this.viewportEl?.removeClass("is-dragging");
      endDrag();
    };
    const beginDrag = () => {
      endDrag(); // defensive: never stack a second registration
      dragDoc = contentEl.ownerDocument;
      dragDoc.addEventListener("mousemove", onDragMove);
      dragDoc.addEventListener("mouseup", onDragUp);
    };
    const endDrag = () => {
      if (!dragDoc) return;
      dragDoc.removeEventListener("mousemove", onDragMove);
      dragDoc.removeEventListener("mouseup", onDragUp);
      dragDoc = null;
    };
    this.register(endDrag); // don't leak listeners if the view closes mid-drag

    // Swallow clicks that ended a drag so hex click-handlers don't fire
    this.registerDomEvent(
      contentEl,
      "click",
      (e: MouseEvent) => {
        if (hasDragged) {
          e.stopPropagation();
          hasDragged = false;
        }
      },
      { capture: true },
    );

    // When any tool is active, right-click shows the painter context menu.
    // EXCEPTION: in GM-only paint mode, right-click on a hex REMOVES one
    // of the currently-selected icon from that hex's GM stack (inverse
    // of the additive left-click) — that's the symmetric multi-icon UX
    // requested in hexmaker#28. Right-click off-hex still shows the
    // painter menu so the user can change tools etc.
    this.registerDomEvent(
      contentEl,
      "contextmenu",
      (e: MouseEvent) => {
        if (rightDragMoved) {
          e.preventDefault();
          e.stopPropagation();
          rightDragMoved = false;
          return;
        }
        if (this.drawingMode === null) return;
        e.preventDefault();
        e.stopPropagation();
        // Double-right-click anywhere exits the tool (as the help says).
        const now = performance.now();
        const isDouble = now - this.lastToolContextMenuAt < 400;
        this.lastToolContextMenuAt = isDouble ? 0 : now;
        if (isDouble) {
          this.painterMenu?.close();
          this.exitCurrentMode();
          return;
        }
        const hexEl = this.hexElAt(e.target, e.clientX, e.clientY);
        const hexX = hexEl ? Number(hexEl.dataset.x) : null;
        const hexY = hexEl ? Number(hexEl.dataset.y) : null;
        if (
          this.drawingMode === "icon" &&
          this.paintIconGmOnly &&
          !this.isErasingMode &&
          this.paintIconName &&
          hexEl && hexX !== null && hexY !== null
        ) {
          this.removeOneGmIconFromHex(hexEl, hexX, hexY, this.paintIconName);
          return;
        }
        // Path tool: right-click an anchor of a path of the tool's type
        // deletes it; on such a path (or Shift on an anchor), the menu adds
        // that path's actions; on another type's path, "Switch to <type>".
        let pathItems: { label: string; onClick: () => void }[] = [];
        if (this.drawingMode === "path" && !this.isErasingMode) {
          const r = this.pathTool.contextMenu(e);
          if (r && "handled" in r) return;
          if (r) pathItems = [...r.items, ...this.overworldPathItems(this.pathTool.labelState().selected)];
        }
        this.showPainterContextMenu(e.clientX, e.clientY, hexX, hexY, pathItems);
      },
      { capture: true },
    );

    // A click or right-click in the gap between hexes (or on a hex's clipped
    // corner) lands on the column box, not a hex: send it to the nearest
    // hex (round 5: "two dead clicks before the first hex editor opened").
    // Hexes, tokens and the neighbour strip handle their own clicks.
    const onGap = (e: MouseEvent): { x: number; y: number } | null => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (!t || t.closest(".duckmage-hex, .duckmage-token, .duckmage-region-shadow-hex")) return null;
      const hexEl = this.hexElAt(t, e.clientX, e.clientY);
      return hexEl ? { x: Number(hexEl.dataset.x), y: Number(hexEl.dataset.y) } : null;
    };
    this.registerDomEvent(clipEl, "click", (e: MouseEvent) => {
      const hex = onGap(e);
      if (hex) void this.onHexClick(hex.x, hex.y, e);
    });
    this.registerDomEvent(clipEl, "contextmenu", (e: MouseEvent) => {
      if (this.drawingMode !== null) return; // the tool menu (capture) owns it
      const hex = onGap(e);
      if (hex) this.onHexContextMenu(e, hex.x, hex.y);
    });

    // Double-clicking off the hex grid (but inside the viewport) exits terrain/icon mode
    this.registerDomEvent(contentEl, "dblclick", (e: MouseEvent) => {
      if (this.drawingMode !== "terrain" && this.drawingMode !== "icon") return;
      const inViewport = (e.target as HTMLElement).closest(
        ".duckmage-hex-map-viewport",
      );
      const onHex = (e.target as HTMLElement).closest(".duckmage-hex");
      if (inViewport && !onHex) {
        if (this.drawingMode === "terrain") this.exitTerrainMode();
        else this.exitIconMode();
      }
    });

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
        this.exitPathMode();
        this.updateUndoButton();
        this.updateMapBtnLabel();
        this.refreshMapNav();
        this.refreshViewHeader();
        this.renderGrid();
      }).open(),
    );

    this.workModeBtn = mapNavGroup.createEl("button", { cls: "duckmage-work-mode-btn" });
    this.workModeBtn.addEventListener("click", (e) => this.openWorkModeMenu(e));
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
      this.buildDrawingToolbarContent(panel),
    );
    const toolsPanel = this.toolsPanel;
    this.overlayPanel = new OverlayPanel(
      controlsEl,
      this.plugin,
      () => this.viewportEl,
      () => this.getActiveMap(),
      (show) => { if (show) this.updateFactionOverlay(); else this.clearFactionOverlay(); },
      (show) => { if (show) this.updateRegionOverlay(); else this.clearRegionOverlay(); },
      () => { this.updateGmIcons(); },
      (show) => { if (show) this.updateTokenLayer(); else this.viewportEl?.querySelector(".duckmage-token-layer")?.remove(); },
      {
        onLegendChange: () => this.refreshTerrainLegend(),
        // Badge size or kinds changed: redraw the badges and the legend.
        onBadgesChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.cancelMeasuredLayers) {
            this.renderLinkBadges(grid);
            this.drawHexNames(grid, true);
          }
          this.refreshTerrainLegend();
        },
        // Name font changed (NM3): redraw the names.
        onHexNameFontChange: () => {
          const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
          if (grid && !this.cancelMeasuredLayers) this.drawHexNames(grid, true);
        },
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
        this.pendingFactionLinks.delete(file.path);
        this.erasedFactionLinks.delete(file.path);
        this.pendingRegions.delete(file.path);
        this.erasedRegions.delete(file.path);

        // A hex note of THIS map changed while this view was inactive
        // (edited from another view/window) → flag for catch-up render.
        const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
        const mapPrefix =
          (hexFolder ? hexFolder + "/" : "") + this.activeMapName + "/";
        if (file.path.startsWith(mapPrefix)) {
          this.markStaleFromExternal();
          // A hex note's links may have changed → its link badges.
          if (hexKeyFromBasename(file.basename)) this.scheduleLinkBadges();
        }

        if (this.getActiveMap().showFactionOverlay) {
          const folder = normalizeFolder(this.plugin.settings.factionsFolder);
          const isFactionFile =
            !file.basename.startsWith("_") &&
            (folder ? file.path.startsWith(folder + "/") : true);
          if (isFactionFile) this.updateFactionOverlay();
        }

        if (this.getActiveMap().showRegionOverlay) {
          const rFolder = normalizeFolder(this.plugin.settings.regionsFolder);
          const isRegionNoteFile =
            !file.basename.startsWith("_") &&
            (rFolder ? file.path.startsWith(rFolder + "/") : true);
          if (isRegionNoteFile) this.updateRegionOverlay();
          // Also re-render when any hex file changes (region assignment may have changed)
          else this.updateRegionOverlay();
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
        if (hexKeyFromBasename(file.basename)) this.scheduleLinkBadges();
      }),
    );
    // Paths that kept their route because of a terrain stroke: undone with it.
    this.register(
      this.plugin.pathPins.onPinned((r) => {
        if (r.map === this.activeMapName && this.strokePins) this.strokePins.push(r);
      }),
    );
    // Terrain painted / generated → the legend lists what the map now uses.
    this.register(
      this.plugin.mapStore.onChange((map) => {
        this.onOverworldDataChange(map);
        if (map !== this.activeMapName) return;
        // Painted from its overworld in another view: repaint those hexes now.
        if (this.shownTerrain.size && !this.currentTerrainStroke) this.terrainSync.request(() => this.syncShownTerrain());
        this.scheduleTerrainLegend();
        // A name set without a redraw (hex table, code, map note edit) shows up.
        this.scheduleHexNames();
      }),
    );

    // Reopen where the user left this map (onClose saves savedViewport);
    // first visit fits the whole grid.
    this.restoreViewport(this.activeMapName);
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
      this.panY -= sign * stride * sy * this.zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetY += sign * stride * sy;
      }
    } else {
      const sx = this.gridDisplayScaleX(map);
      this.panX -= sign * stride * sx * this.zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetX += sign * stride * sx;
      }
    }
    this.applyTransform();
    if (map.backgroundImage) {
      // Re-apply the bg layer's transform with the new offset so the visual
      // updates immediately, and persist the new offset.
      const layer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (layer) this.applyBgLayerVars(layer, map.backgroundImage);
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

  private buildDrawingToolbarContent(toolbar: HTMLElement): void {
    const centerHexBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-center-hex-btn",
      text: "Center hex",
    });
    centerHexBtn.addEventListener("click", () => {
      new GotoHexModal(this.app, (x, y) => this.centerOnHex(x, y)).open();
    });

    this.terrainToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.terrainToolbarBtn.createSpan({ text: "Terrain" });
    this.terrainBtnPreview = this.terrainToolbarBtn.createSpan({
      cls: "duckmage-terrain-btn-preview",
    });
    this.terrainToolbarBtn.addEventListener("click", () =>
      this.handleTerrainButton(),
    );

    this.iconToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.iconToolbarBtn.createSpan({ text: "Icon" });
    this.iconBtnPreview = this.iconToolbarBtn.createEl("img", {
      cls: "duckmage-icon-btn-preview",
    });
    this.iconToolbarBtn.addEventListener("click", () =>
      this.handleIconButton(),
    );

    this.pathToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-path",
    });
    this.pathToolbarBtn.createSpan({ text: "Path" });
    this.pathBtnSwatch = this.pathToolbarBtn.createSpan({
      cls: "duckmage-path-btn-swatch",
    });
    this.pathToolbarBtn.addEventListener("click", () =>
      this.handlePathButton(),
    );

    this.tableLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.tableLinkBtnLabel = this.tableLinkBtn.createSpan({
      text: "Link table",
    });
    this.tableLinkBtn.addEventListener("click", () =>
      this.handleTableLinkButton(),
    );

    this.submapLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.submapLinkBtnLabel = this.submapLinkBtn.createSpan({
      text: "Link submap",
    });
    this.submapLinkBtn.addEventListener("click", () =>
      this.handleSubmapLinkButton(),
    );

    this.factionLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.factionLinkBtnLabel = this.factionLinkBtn.createSpan({
      text: "Factions",
    });
    this.factionLinkBtn.addEventListener("click", () =>
      this.handleFactionLinkButton(),
    );

    this.regionLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.regionLinkBtnLabel = this.regionLinkBtn.createSpan({
      text: REGION_AREAS_TOOL,
    });
    this.regionLinkBtn.addEventListener("click", () =>
      this.handleRegionLinkButton(),
    );

    this.tokenBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-token",
      text: "Token",
    });
    this.tokenBtn.addEventListener("click", () => this.handleTokenButton());

    // Tools the map's mode locks are hidden; this line says how to get them.
    this.toolsLockedEl = toolbar.createDiv({ cls: "duckmage-tools-locked" });
    this.toolsLockedEl.hide();
    this.applyWorkModeUi();
  }

  private showPainterContextMenu(
    clientX: number,
    clientY: number,
    hexX: number | null,
    hexY: number | null,
    pathItems: { label: string; onClick: () => void }[] = [],
  ): void {
    const mode = this.drawingMode;
    let onSwitch: (() => void) | null = null;
    let switchLabel = "Switch";
    const extra: { label: string; onClick: () => void }[] = [];
    const erasing = this.isErasingMode;

    const toggleEraseMode = () => {
      this.isErasingMode = !erasing;
      this.updateToolbarButtonStates();
    };

    if (mode === "terrain") {
      onSwitch = () => this.handleTerrainButton();
      switchLabel = "Switch terrain";
      extra.push({ label: erasing ? "Paint mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "icon") {
      onSwitch = () => this.openIconPicker();
      switchLabel = "Switch icon";
      extra.push({ label: erasing ? "Paint mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "tableLink") {
      onSwitch = () => this.handleTableLinkButton(true);
      switchLabel = "Switch table";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "submapLink") {
      onSwitch = () => this.handleSubmapLinkButton(true);
      switchLabel = "Switch submap";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "factionLink") {
      onSwitch = () => this.handleFactionLinkButton();
      switchLabel = "Switch faction";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "regionLink") {
      onSwitch = () => this.handleRegionLinkButton();
      switchLabel = "Switch region";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "path") {
      onSwitch = () => this.handlePathButton();
      switchLabel = "Switch path type";
      extra.push({ label: erasing ? "Draw mode" : "Erase mode", onClick: toggleEraseMode });
      if (!erasing) extra.push({ label: "New path", onClick: () => this.pathTool.startNewPath() });
    } else if (mode === "placeToken") {
      onSwitch = () => this.handleTokenButton(true);
      switchLabel = "Switch token";
    }
    // swap: no picker → onSwitch stays null, menu shows only "Exit tool"

    this.painterMenu?.close();
    // The path under the pointer comes first, above a separator (#48).
    this.painterMenu = new PainterContextMenu(onSwitch, () => this.exitCurrentMode(), switchLabel, extra, mode === "path" ? pathItems : []);
    this.painterMenu.open(clientX, clientY);
  }

  /**
   * Called when a picker's choice switches to tool `next`: properly leave a
   * different active tool first (commits its pending stroke). Staying in the
   * same tool keeps its state.
   */
  private leaveOtherToolFor(next: NonNullable<typeof this.drawingMode>): void {
    if (this.drawingMode !== null && this.drawingMode !== next) this.exitCurrentMode();
  }

  private exitCurrentMode(): void {
    this.isErasingMode = false;
    if (this.drawingMode === "terrain") this.exitTerrainMode();
    else if (this.drawingMode === "icon") this.exitIconMode();
    else if (this.drawingMode === "tableLink") this.exitTableLinkMode();
    else if (this.drawingMode === "submapLink") this.exitSubmapLinkMode();
    else if (this.drawingMode === "factionLink") this.exitFactionLinkMode();
    else if (this.drawingMode === "regionLink") this.exitRegionLinkMode();
    else if (this.drawingMode === "swap") this.exitSwapMode();
    else if (this.drawingMode === "placeToken") this.exitTokenMode();
    else {
      if (this.drawingMode === "path") this.exitPathMode();
      this.drawingMode = null;
      this.updateToolbarButtonStates();
      this.updatePathOverlay();
    }
  }

  private exitPathMode(): void {
    this.pathTool.reset();
  }

  openTerrainPicker(): void {
    this.toolsPanel?.open();
    this.handleTerrainButton();
  }

  private handleTerrainButton(): void {
    if (this.drawingMode !== "terrain" && !this.modeAllows(TOOL_ACTIONS.terrain)) return;
    // Keep the current tool while the picker is open: closing it without a
    // pick (Escape, clicking away, or after only changing the brush size)
    // must leave painting exactly as it was. It used to exit terrain mode
    // here first, so any of those turned the tool off.
    if (this.drawingMode === "terrain") this.commitTerrainStroke();

    // Show crosshair on the viewport while the picker is open
    this.viewportEl?.addClass("duckmage-terrain-picking");

    // On an overworld the brush paints its regions' hexes, so it offers
    // the regions' palette, and picking a terrain shows the Regions view.
    const owInfo = overworldOf(this.plugin, this.activeMapName);
    // Always open the picker — even if already active, so user can switch terrain
    new TerrainPickerModal(
      this.app,
      this.plugin,
      owInfo ? regionPalette(this.plugin, owInfo.map) : this.plugin.getMapPalette(this.activeMapName),
      (terrainName: string | null) => {
        this.viewportEl?.removeClass("duckmage-terrain-picking");
        this.leaveOtherToolFor("terrain");
        this.drawingMode = "terrain";
        this.isErasingMode = false;
        this.terrainPickMode = false;
        this.paintTerrainName = terrainName;
        this.paintIconName = null;
        this.updateToolbarButtonStates();
        this.showOverworldRegions();
      },
      () => {
        // Eyedropper: enter terrain mode in pick-from-map state
        this.viewportEl?.removeClass("duckmage-terrain-picking");
        this.leaveOtherToolFor("terrain");
        this.drawingMode = "terrain";
        this.isErasingMode = false;
        this.terrainPickMode = true;
        this.paintTerrainName = null;
        this.updateToolbarButtonStates();
        this.showOverworldRegions();
      },
      () => {
        // Dismissed without selecting
        this.viewportEl?.removeClass("duckmage-terrain-picking");
      },
      this.paintBrushSize,
      (size) => {
        this.paintBrushSize = size;
      },
    ).open();
  }

  private exitTerrainMode(): void {
    if (this.drawingMode !== "terrain") return;
    this.commitTerrainStroke();
    this.drawingMode = null;
    this.paintTerrainName = null;
    this.terrainPickMode = false;
    this.isErasingMode = false;
    this.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  private handleIconButton(): void {
    if (this.drawingMode !== "icon" && !this.modeAllows(TOOL_ACTIONS.icon)) return;
    if (this.drawingMode === "icon") { this.exitIconMode(); return; }
    this.openIconPicker();
  }

  /**
   * Pick an icon to paint. Like the terrain picker, the current tool stays
   * active until an icon is actually picked, so dismissing it changes nothing.
   */
  private openIconPicker(): void {
    new IconPickerModal(
      this.app,
      this.plugin,
      (iconName: string | null, gmOnly: boolean) => {
        this.leaveOtherToolFor("icon");
        this.drawingMode = "icon";
        this.isErasingMode = false;
        this.paintIconName = iconName;
        this.paintIconGmOnly = gmOnly;
        this.paintTerrainName = null;
        // The terrain brush size is kept: icons always paint one hex
        // (getBrushHexes), so switching to icons and back doesn't reset it.
        // Auto-enable the GM layer when the user picks a GM-only paint —
        // otherwise their painted icons are silently invisible because the
        // layer is hidden. Mirrors the showFactionOverlay-on-paint
        // auto-enable in onHexFactionPaintClick.
        if (gmOnly) {
          const map = this.getActiveMap();
          if (!(map.showGmLayer ?? true)) {
            map.showGmLayer = true;
            void this.plugin.saveSettings();
            this.overlayPanel?.syncToRegion();
            this.updateGmIcons();
          }
        }
        this.updateToolbarButtonStates();
      },
      this.paintIconGmOnly,
    ).open();
  }

  private exitIconMode(): void {
    if (this.drawingMode !== "icon") return;
    this.drawingMode = null;
    this.paintIconName = null;
    // NB: do NOT reset paintIconGmOnly here — the user's preference for
    // GM-vs-regular icon paint persists across mode toggles. Otherwise
    // every re-open of the icon picker reverts to "regular" and the GM
    // checkbox starts off, even for a user who's been working in GM
    // mode for the whole session.
    this.isErasingMode = false;
    this.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  /** `keep`: opened from the tool's own right-click menu; stay in the tool unless something is picked. */
  private handleTableLinkButton(keep = false): void {
    if (this.drawingMode !== "tableLink" && !this.modeAllows(TOOL_ACTIONS.tableLink)) return;
    if (!keep && this.drawingMode === "tableLink") { this.exitTableLinkMode(); return; }
    new FolderTreePickerModal(
      this.app,
      this.plugin,
      this.plugin.settings.tablesFolder,
      "Select table",
      "Filter tables…",
      "No tables found.",
      (file) => {
        this.leaveOtherToolFor("tableLink");
        this.drawingMode = "tableLink";
        this.isErasingMode = false;
        this.paintTablePath = file.path;
        this.updateToolbarButtonStates();
      },
      () => {
        void this.app.workspace
          .getLeaf("tab")
          .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
      },
    ).open();
  }

  private exitTableLinkMode(): void {
    if (this.drawingMode !== "tableLink") return;
    this.drawingMode = null;
    this.paintTablePath = null;
    this.isErasingMode = false;
    this.updateToolbarButtonStates();
  }

  private handleSubmapLinkButton(keep = false): void {
    if (this.drawingMode !== "submapLink" && !this.modeAllows(TOOL_ACTIONS.submapLink)) return;
    if (!keep && this.drawingMode === "submapLink") { this.exitSubmapLinkMode(); return; }
    new SubmapPickerModal(
      this.app,
      this.plugin,
      undefined,
      (mapName) => {
        this.leaveOtherToolFor("submapLink");
        this.drawingMode = "submapLink";
        this.isErasingMode = false;
        this.paintSubmapName = mapName;
        this.updateToolbarButtonStates();
      },
      undefined,
    ).open();
  }

  private exitSubmapLinkMode(): void {
    if (this.drawingMode !== "submapLink") return;
    this.drawingMode = null;
    this.paintSubmapName = null;
    this.isErasingMode = false;
    this.updateToolbarButtonStates();
  }

  private handleFactionLinkButton(): void {
    if (this.drawingMode !== "factionLink" && !this.modeAllows(TOOL_ACTIONS.factionLink)) return;
    new FactionPickerModal(this.app, this.plugin, (filePath) => {
      this.leaveOtherToolFor("factionLink");
      this.drawingMode = "factionLink";
      this.isErasingMode = false;
      this.paintFactionPath = filePath;
      this.updateToolbarButtonStates();
    }, () => {
      this.drawingMode = "factionLink";
      this.isErasingMode = true;
      this.updateToolbarButtonStates();
    }).open();
  }

  private exitFactionLinkMode(): void {
    if (this.drawingMode !== "factionLink") return;
    this.drawingMode = null;
    this.paintFactionPath = null;
    this.isErasingMode = false;
    this.updateToolbarButtonStates();
  }

  private handleRegionLinkButton(): void {
    if (this.drawingMode !== "regionLink" && !this.modeAllows(TOOL_ACTIONS.regionLink)) return;
    new GeoRegionPickerModal(this.app, this.plugin, (filePath) => {
      this.leaveOtherToolFor("regionLink");
      this.drawingMode = "regionLink";
      this.isErasingMode = false;
      this.paintRegionPath = filePath;
      this.updateToolbarButtonStates();
      // Auto-enable region overlay when entering paint mode
      if (!this.getActiveMap().showRegionOverlay) {
        this.getActiveMap().showRegionOverlay = true;
        void this.plugin.saveSettings();
        this.overlayPanel?.syncToRegion();
      }
    }, () => {
      this.drawingMode = "regionLink";
      this.isErasingMode = true;
      this.updateToolbarButtonStates();
    }).open();
  }

  private exitRegionLinkMode(): void {
    if (this.drawingMode !== "regionLink") return;
    this.drawingMode = null;
    this.paintRegionPath = null;
    this.isErasingMode = false;
    this.updateToolbarButtonStates();
  }

  private handleTokenButton(keep = false): void {
    if (this.drawingMode !== "placeToken" && !this.modeAllows(TOOL_ACTIONS.placeToken)) return;
    if (!keep && this.drawingMode === "placeToken") {
      this.exitTokenMode();
      return;
    }
    new TokenModal(
      this.app,
      this.plugin,
      undefined,
      "",
      { color: this.nextTokenFill() },
      (notePath, data) => {
        this.leaveOtherToolFor("placeToken");
        this.pendingTokenNotePath  = notePath;
        this.pendingTokenPlaceData = { icon: data.icon, shape: data.shape, size: data.size, color: data.color, border: data.border, description: data.description };
        this.drawingMode = "placeToken";
        this.isErasingMode = false;
        this.updateToolbarButtonStates();
      },
    ).open();
  }

  private exitTokenMode(): void {
    if (this.drawingMode !== "placeToken") return;
    this.drawingMode = null;
    this.pendingTokenNotePath = null;
    this.pendingTokenPlaceData = null;
    this.updateToolbarButtonStates();
  }

  private handleSwapButton(): void {
    if (this.drawingMode !== "swap" && !this.modeAllows(TOOL_ACTIONS.swap)) return;
    if (this.drawingMode === "swap") {
      this.exitSwapMode();
    } else {
      this.drawingMode = "swap";
      this.isErasingMode = false;
      this.swapSource = null;
      this.swapDest = null;
      this.updateToolbarButtonStates();
    }
  }

  private exitSwapMode(): void {
    if (this.drawingMode !== "swap") return;
    this.drawingMode = null;
    this.clearSwapHighlights();
    this.swapSource = null;
    this.swapDest = null;
    this.updateToolbarButtonStates();
  }

  // Remove all swap overlay spans from the viewport DOM
  private clearSwapHighlights(): void {
    this.viewportEl
      ?.querySelectorAll(".duckmage-hex-swap-source, .duckmage-hex-swap-dest")
      .forEach((el) => el.remove());
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
      this.clearSwapHighlights();
      return;
    }

    // Any other hex: execute swap immediately then deselect tool
    const src = { ...this.swapSource };
    this.clearSwapHighlights();
    this.swapSource = null;
    this.swapDest = null;
    await this.executeHexSwap(src.x, src.y, x, y);
    this.exitSwapMode();
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
        void this.placeToken(notePath, {
          icon: data.icon,
          shape: data.shape,
          size: data.size,
          color: data.color,
          border: data.border,
          description: data.description,
        }, `${x}_${y}`);
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
    this.pushTokenUndo(notePath, map, was, { hex, map, visible: true, look });
    await applyTokenFrontmatter(this.app, notePath, { ...look, hex, map, visible: true });
    this.updateTokenLayer();
  }

  private async onHexTokenPlaceClick(x: number, y: number): Promise<void> {
    if (!this.pendingTokenNotePath || !this.pendingTokenPlaceData) return;
    await this.placeToken(this.pendingTokenNotePath, this.pendingTokenPlaceData, `${x}_${y}`);
    this.exitTokenMode();
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
    this.pendingTerrainWrites.delete(pathA);
    this.pendingTerrainWrites.delete(pathB);
    this.pendingIconWrites.delete(pathA);
    this.pendingIconWrites.delete(pathB);
    this.pendingGmIconWrites.delete(pathA);
    this.pendingGmIconWrites.delete(pathB);

    // Wait for any already-in-flight flushes on these paths to finish before
    // renaming files — a flush that completes after the rename would write
    // terrain to the wrong file or recreate a file that was just moved.
    const flushKeys = [
      `t:${pathA}`, `t:${pathB}`,
      `i:${pathA}`, `i:${pathB}`,
      `g:${pathA}`, `g:${pathB}`,
    ];
    const deadline = Date.now() + 2000;
    while (
      flushKeys.some((k) => this.flushing.has(k)) &&
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
      this.pushUndo({ kind: "swap", x1, y1, x2, y2, after: [at(x1, y1), at(x2, y2)] });
      this.updateUndoButton();
    }
  }

  private updateToolbarButtonStates(): void {
    const erasing = this.isErasingMode;
    this.pathToolbarBtn?.toggleClass("is-active", this.drawingMode === "path");
    this.pathToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "path");
    // Update path button swatch color to show active type
    if (this.pathBtnSwatch) {
      const current = this.pathTool.currentType();
      const activeType = current
        ? this.mapPathTypes().find((p) => p.name === current)
        : this.mapPathTypes()[0];
      if (activeType) {
        this.pathBtnSwatch.setCssProps({
          "--duckmage-bg": activeType.color,
        });
        this.pathBtnSwatch.show();
      } else {
        this.pathBtnSwatch.hide();
      }
    }
    this.terrainToolbarBtn?.toggleClass(
      "is-active",
      this.drawingMode === "terrain",
    );
    this.iconToolbarBtn?.toggleClass("is-active", this.drawingMode === "icon");
    this.tableLinkBtn?.toggleClass(
      "is-active",
      this.drawingMode === "tableLink",
    );
    this.submapLinkBtn?.toggleClass(
      "is-active",
      this.drawingMode === "submapLink",
    );
    this.factionLinkBtn?.toggleClass(
      "is-active",
      this.drawingMode === "factionLink",
    );
    this.regionLinkBtn?.toggleClass(
      "is-active",
      this.drawingMode === "regionLink",
    );
    this.swapBtn?.toggleClass("is-active", this.drawingMode === "swap");
    this.tokenBtn?.toggleClass("is-active", this.drawingMode === "placeToken");
    this.viewportEl?.toggleClass(
      "duckmage-draw-mode",
      this.drawingMode !== null,
    );
    this.viewportEl?.toggleClass(
      "duckmage-terrain-paint",
      this.drawingMode === "terrain" && !this.terrainPickMode,
    );

    // Icon button preview
    if (this.drawingMode === "icon" && this.paintIconName) {
      if (this.iconBtnPreview) {
        this.iconBtnPreview.src = getIconUrl(this.plugin, this.paintIconName);
        this.iconBtnPreview.show();
      }
    } else {
      if (this.iconBtnPreview) this.iconBtnPreview.hide();
    }
    if (this.drawingMode === "terrain") {
      if (this.terrainPickMode) {
        // Eyedropper waiting for a click — show ⌖ as the preview
        this.terrainToolbarBtn?.removeClass("is-terrain-preview");
        this.terrainToolbarBtn?.addClass("is-eyedropper-active");
        if (this.terrainBtnPreview) {
          this.terrainBtnPreview.setCssProps({ "--duckmage-bg": "" });
          this.terrainBtnPreview.show();
          this.terrainBtnPreview.textContent = "⌖";
        }
      } else {
        if (this.terrainBtnPreview) this.terrainBtnPreview.textContent = "";
        this.terrainToolbarBtn?.removeClass("is-eyedropper-active");
        const entry = this.paintTerrainName
          ? this.plugin
              .getMapPalette(this.activeMapName)
              .find((p) => p.name === this.paintTerrainName)
          : undefined;
        if (entry) {
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.addClass("is-terrain-preview");
            this.terrainToolbarBtn.setCssProps({
              "--duckmage-border-color": entry.color,
            });
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.setCssProps({
              "--duckmage-bg": entry.color,
            });
            this.terrainBtnPreview.show();
          }
        } else {
          // Clear mode — show active state without a color
          this.terrainToolbarBtn?.removeClass("is-terrain-preview");
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.hide();
          }
        }
      }
    } else {
      this.terrainToolbarBtn?.removeClass("is-terrain-preview");
      this.terrainToolbarBtn?.removeClass("is-eyedropper-active");
      if (this.terrainBtnPreview) {
        this.terrainBtnPreview.hide();
      }
    }

    const prefix = erasing ? "Erase: " : "Link: ";

    // Table link button label
    if (this.tableLinkBtnLabel) {
      if (this.drawingMode === "tableLink" && this.paintTablePath) {
        const name = this.paintTablePath.split("/").pop()?.replace(/.md$/, "") ?? "Table";
        this.tableLinkBtnLabel.setText(prefix + name);
      } else {
        this.tableLinkBtnLabel.setText("Link table");
      }
    }
    this.tableLinkBtn?.toggleClass("is-erase", erasing && this.drawingMode === "tableLink");

    // Submap link button label
    if (this.submapLinkBtnLabel) {
      if (this.drawingMode === "submapLink") {
        this.submapLinkBtnLabel.setText(erasing ? "Erase submap" : (this.paintSubmapName ? "Link: " + this.plugin.mapLabel(this.paintSubmapName) : "Link submap"));
      } else {
        this.submapLinkBtnLabel.setText("Link submap");
      }
    }
    this.submapLinkBtn?.toggleClass("is-erase", erasing && this.drawingMode === "submapLink");

    // Faction link button label
    if (this.factionLinkBtnLabel) {
      if (this.drawingMode === "factionLink" && this.paintFactionPath) {
        const name = this.paintFactionPath.split("/").pop()?.replace(/.md$/, "") ?? "Faction";
        this.factionLinkBtnLabel.setText(erasing ? "Erase: " + name : "Link: " + name);
      } else {
        this.factionLinkBtnLabel.setText("Factions");
      }
    }
    this.factionLinkBtn?.toggleClass("is-erase", erasing && this.drawingMode === "factionLink");

    // Region link button label
    if (this.regionLinkBtnLabel) {
      if (this.drawingMode === "regionLink" && this.paintRegionPath) {
        const name = this.paintRegionPath.split("/").pop()?.replace(/.md$/, "") ?? "Region";
        this.regionLinkBtnLabel.setText(erasing ? "Erase: " + name : "Paint: " + name);
      } else {
        this.regionLinkBtnLabel.setText(REGION_AREAS_TOOL);
      }
    }
    this.regionLinkBtn?.toggleClass("is-erase", erasing && this.drawingMode === "regionLink");

    // Terrain / icon erase visual feedback
    this.terrainToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "terrain");
    this.iconToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "icon");

    this.updateModeBar();
  }

  /** Show which tool is on (and how to stop it) on the map itself. */
  private updateModeBar(): void {
    if (!this.modeBarEl || !this.modeBarTextEl) return;
    const label = toolModeLabel({
      mode: this.drawingMode,
      erasing: this.isErasingMode,
      terrainName: this.paintTerrainName,
      terrainPick: this.terrainPickMode,
      regionHexes: OverworldLayer.viewOf(this.plugin, this.getActiveMap()) === "regions",
      iconName: this.paintIconName,
      iconGmOnly: this.paintIconGmOnly,
      pathTypeName: this.pathTool.currentType(),
      pathAuto: this.pathTool.autoRoute,
      pathDrawing: this.pathTool.labelState().drawing,
      pathSelected: this.pathTool.labelState().selected,
      pathSummary: this.pathTool.labelState().summary,
      pathNew: this.pathTool.labelState().forceNew,
      pathNote: this.pathTool.labelState().note,
      tablePath: this.paintTablePath,
      submapName: this.paintSubmapName,
      factionPath: this.paintFactionPath,
      regionPath: this.paintRegionPath,
    });
    this.renderRouteControls();
    const changed = this.modeBarTextEl.getText() !== (label ?? "");
    this.modeBarTextEl.setText(label ?? "");
    this.modeBarEl.toggle(label !== null);
    // The path tool says more and has more controls: its text wraps instead of being cut off.
    this.modeBarEl.toggleClass("is-path", this.drawingMode === "path");
    this.modeBarTextEl.setAttr("title", label ?? "");
    if (label === null || !changed) return;
    // A tool just started or changed: pulse the bar so it's noticed
    // (round 4: a tester never saw it). The map does NOT move here: a tool
    // is on now, and a slide under the cursor sends the next click to the
    // wrong hex (round 5, see mayAutoPan).
    const bar = this.modeBarEl;
    bar.removeClass("is-new");
    window.requestAnimationFrame(() => bar.addClass("is-new"));
  }

  private applyTransform(): void {
    if (this.viewportEl) {
      this.viewportEl.setCssProps({
        "--duckmage-vp-tx": `${this.panX}px`,
        "--duckmage-vp-ty": `${this.panY}px`,
        "--duckmage-vp-scale": String(this.zoom),
      });
    }
    // Names keep a readable size on screen (NM3): redraw once the zoom settles.
    if (this.zoom !== this.namesZoom) {
      this.namesZoom = this.zoom;
      this.scheduleHexNames();
    }
    this.updateCalHandleScale();
    this.onViewportMoved();
  }

  /**
   * Keep the calibration resize handles a constant on-screen size. A handle is
   * a child of the element it resizes (the bg image layer or the grid), so its
   * rendered size is `handleCss × parentScale × viewportZoom`. Cancelling only
   * the zoom leaves the parent's own scale (bg image ~4.8×, grid ~0.35×) in,
   * which made image handles huge and grid handles tiny, so each handle gets
   * `--duckmage-cal-scale = 1 / (zoom × parentScale)` and the chain cancels to 1.
   */
  private updateCalHandleScale(): void {
    if (!this.bgCalibrating || !this.viewportEl) return;
    const z = Math.max(0.01, this.zoom);
    // Written on the handles themselves, not their parent: an inherited
    // custom property changed on the grid would re-style every hex
    // beneath it on each zoom frame.
    const setHandleScale = (parent: HTMLElement, scale: number) => {
      parent
        .querySelectorAll<HTMLElement>(":scope > .duckmage-calibration-handle")
        .forEach((h) => h.setCssProps({ "--duckmage-cal-scale": String(scale) }));
    };
    const map = this.getActiveMap();
    const bgLayer = this.viewportEl.querySelector<HTMLElement>(
      ".duckmage-bg-image-layer",
    );
    if (bgLayer && map.backgroundImage) {
      const s = Math.max(0.01, map.backgroundImage.scale);
      setHandleScale(bgLayer, 1 / (z * s));
    }
    const grid = this.viewportEl.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (grid) {
      const legacy = map.gridDisplayScale ?? 1;
      // Average the two axes — handles are uniform squares, so per-axis
      // anisotropy is invisible at handle size.
      const sx = map.gridDisplayScaleX ?? legacy;
      const sy = map.gridDisplayScaleY ?? legacy;
      const gs = Math.max(0.01, (sx + sy) / 2);
      setHandleScale(grid, 1 / (z * gs));
    }
  }

  /**
   * Coalesce a drag's mousemove to at most once per animation frame (latest
   * event wins) so calibration drag/resize don't issue redundant CSS-var
   * writes — and the style recalcs they trigger — several times per painted
   * frame. `stop()` flushes the final position and cancels any pending frame;
   * call it from mouseup so the release lands exactly under the cursor.
   *
   * When `window.DUCKMAGE_PERF` is truthy it records, for the drag's lifetime:
   * mousemove count, frames run, mean synchronous work() time per frame, and
   * the median inter-frame gap — logged on stop(). A cheap work() paired with a
   * large frame gap means the drag is paint/composite-bound (the scene, not our
   * JS) — the expected signature when resizing over a big background image.
   */
  private coalesceDragMove(
    label: string,
    work: (ev: MouseEvent) => void,
  ): { onMove: (ev: MouseEvent) => void; stop: () => void } {
    // Swap the 3843 hex cells for a single-canvas colour snapshot for the
    // drag's duration: build the snapshot, then add the class that hides the
    // real cells. Transforming one canvas per frame is a single composite op vs
    // re-rasterising every cell (a translate alone measured ~373ms/frame).
    this.buildCalibrationSnapshot();
    this.viewportEl?.addClass("duckmage-calibrating-drag");
    let latest: MouseEvent | null = null;
    let frameId: number | null = null;
    const perf = !!(window as unknown as { DUCKMAGE_PERF?: unknown })
      .DUCKMAGE_PERF;
    let moves = 0,
      frames = 0,
      workMs = 0,
      lastTickAt = 0;
    const gaps: number[] = [];
    const run = (ev: MouseEvent) => {
      if (!perf) {
        work(ev);
        return;
      }
      const now = performance.now();
      if (lastTickAt) gaps.push(now - lastTickAt);
      lastTickAt = now;
      work(ev);
      workMs += performance.now() - now;
      frames++;
    };
    const tick = () => {
      frameId = null;
      if (latest) {
        run(latest);
        latest = null;
      }
    };
    return {
      onMove: (ev: MouseEvent) => {
        if (perf) moves++;
        latest = ev;
        if (frameId === null) frameId = window.requestAnimationFrame(tick);
      },
      stop: () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          frameId = null;
        }
        if (latest) {
          run(latest);
          latest = null;
        }
        this.viewportEl?.removeClass("duckmage-calibrating-drag");
        this.removeCalibrationSnapshot();
        if (perf) {
          const sorted = gaps.slice().sort((a, b) => a - b);
          const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
          console.warn(
            `[duckmage perf] ${label}: moves=${moves} frames=${frames} ` +
              `workMs/frame=${(workMs / Math.max(1, frames)).toFixed(2)} ` +
              `medianFrameGapMs=${med.toFixed(1)}`,
          );
        }
      },
    };
  }

  private bgCalibrating = false;
  /**
   * Which calibration target the user last clicked. Arrow keys nudge whichever
   * is focused. Cleared on exit.
   */
  private bgCalibrationFocus: "image" | "grid" | null = null;
  /** Coalesce a stream of arrow-key nudges into a single undo entry. */
  private nudgeUndoTimer: number | null = null;
  private nudgeUndoBefore: CalibrateSnapshot | null = null;
  /** Bake-on-quiet timer that tears down the calibration snapshot after a burst
   *  of arrow-key nudges goes quiet (arrow keys have no mouseup to end on). */
  private calActivityTimer: number | null = null;
  /** Snapshot the bg image + grid display transforms for the active map. */
  private captureCalibration(map: MapData): CalibrateSnapshot {
    const bg = map.backgroundImage;
    const legacy = map.gridDisplayScale ?? 1;
    return {
      bg: bg
        ? {
            offsetX: bg.offsetX,
            offsetY: bg.offsetY,
            scale: bg.scale,
            rotation: bg.rotation ?? 0,
            opacity: bg.opacity ?? 1,
          }
        : undefined,
      grid: {
        scaleX: map.gridDisplayScaleX ?? legacy,
        scaleY: map.gridDisplayScaleY ?? legacy,
        offsetX: map.gridDisplayOffsetX ?? 0,
        offsetY: map.gridDisplayOffsetY ?? 0,
        legacyScale: legacy,
      },
    };
  }

  private pushCalibrationUndo(
    mapName: string,
    before: CalibrateSnapshot,
    after: CalibrateSnapshot,
  ): void {
    // Skip no-op snapshots (drag that didn't actually move anything)
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.pushUndo({ kind: "calibrate", mapName, before, after }, mapName);
    this.updateUndoButton();
  }

  /** Restore a CalibrateSnapshot back onto a map and persist. */
  private async applyCalibrationSnapshot(
    mapName: string,
    snap: CalibrateSnapshot,
  ): Promise<void> {
    const map = this.plugin.settings.maps.find((m) => m.name === mapName);
    if (!map) return;
    if (snap.bg && map.backgroundImage) {
      map.backgroundImage.offsetX = snap.bg.offsetX;
      map.backgroundImage.offsetY = snap.bg.offsetY;
      map.backgroundImage.scale = snap.bg.scale;
      map.backgroundImage.rotation = snap.bg.rotation;
      map.backgroundImage.opacity = snap.bg.opacity;
    }
    map.gridDisplayScaleX = snap.grid.scaleX;
    map.gridDisplayScaleY = snap.grid.scaleY;
    map.gridDisplayOffsetX = snap.grid.offsetX;
    map.gridDisplayOffsetY = snap.grid.offsetY;
    map.gridDisplayScale = snap.grid.legacyScale;
    await this.plugin.saveSettings();
    this.renderGrid();
  }

  /**
   * Write the bg image's translate / rotate / scale / opacity to the layer
   * as CSS custom properties. The actual `transform` declaration lives in
   * `.duckmage-bg-image-layer`'s CSS rule — JS only feeds the variables in,
   * which keeps the obsidianmd no-static-styles-assignment rule happy.
   */
  private applyBgLayerVars(
    layer: HTMLElement,
    bg: { offsetX: number; offsetY: number; rotation?: number; scale: number; opacity?: number },
  ): void {
    layer.setCssProps({
      "--duckmage-bg-tx": `${bg.offsetX}px`,
      "--duckmage-bg-ty": `${bg.offsetY}px`,
      "--duckmage-bg-rot": `${bg.rotation ?? 0}deg`,
      "--duckmage-bg-scale": String(bg.scale),
      "--duckmage-bg-opacity": String(bg.opacity ?? 1),
    });
  }

  /**
   * Same pattern for the grid container's gridDisplay transform.
   */
  private applyGridLayerVars(
    grid: HTMLElement,
    map: MapData,
  ): void {
    const legacy = map.gridDisplayScale ?? 1;
    const sx = map.gridDisplayScaleX ?? legacy;
    const sy = map.gridDisplayScaleY ?? legacy;
    const ox = map.gridDisplayOffsetX ?? 0;
    const oy = map.gridDisplayOffsetY ?? 0;
    grid.setCssProps({
      "--duckmage-grid-tx": `${ox}px`,
      "--duckmage-grid-ty": `${oy}px`,
      "--duckmage-grid-sx": String(sx),
      "--duckmage-grid-sy": String(sy),
    });
  }

  private renderBackgroundImage(viewportEl: HTMLElement, map: MapData): void {
    const bg = map.backgroundImage;
    viewportEl.toggleClass("has-bg-image", !!bg?.path);
    viewportEl.toggleClass("is-bg-calibrating", this.bgCalibrating && !!bg?.path);
    if (!bg?.path) {
      this.bgLayerEl = null;
      this.bgLayerSrc = null;
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(bg.path);
    if (!(file instanceof TFile)) {
      this.bgLayerEl = null;
      this.bgLayerSrc = null;
      return;
    }

    const src = this.app.vault.adapter.getResourcePath(bg.path);

    // Reuse the cached layer+img across renders when the image is unchanged.
    // renderGrid() calls viewportEl.empty() every render, which detaches the
    // layer but leaves our JS reference (and its already-decoded bitmap) alive.
    // Re-attaching it avoids recreating the <img> and forcing the browser to
    // re-decode + re-rasterise the (large, scaled) image on every single
    // render — the churn that makes editing a bg-image map sluggish. We skip
    // reuse during calibration so its drag/wheel handlers are wired exactly as
    // before (fresh layer each render, as the old code did).
    if (this.bgLayerEl && this.bgLayerSrc === src && !this.bgCalibrating) {
      viewportEl.prepend(this.bgLayerEl);
      this.applyBgLayerVars(this.bgLayerEl, bg);
      return;
    }

    const layer = viewportEl.createDiv({ cls: "duckmage-bg-image-layer" });
    this.applyBgLayerVars(layer, bg);
    const img = layer.createEl("img", { cls: "duckmage-bg-image" });
    img.src = src;
    img.alt = "";
    img.draggable = false;
    this.bgLayerEl = layer;
    this.bgLayerSrc = src;

    if (this.bgCalibrating) this.attachCalibrationHandlers(layer, map);
  }

  /**
   * Attach drag-move + wheel-scale handlers to the bg image layer.
   * Mutates map.backgroundImage in real time; caller saves on exit.
   */
  private attachCalibrationHandlers(layer: HTMLElement, map: MapData): void {
    const bg = map.backgroundImage;
    if (!bg) return;

    layer.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).classList.contains("duckmage-calibration-handle")) {
        this.setCalibrationFocus("image");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.setCalibrationFocus("image");
      const startX = e.clientX, startY = e.clientY;
      const startOX = bg.offsetX, startOY = bg.offsetY;
      const zoom = this.zoom;
      const before = this.captureCalibration(map);
      const { onMove, stop } = this.coalesceDragMove("bg-move", (ev) => {
        bg.offsetX = startOX + (ev.clientX - startX) / zoom;
        bg.offsetY = startOY + (ev.clientY - startY) / zoom;
        this.applyBgLayerVars(layer, bg);
      });
      const onUp = () => {
        activeDocument.removeEventListener("mousemove", onMove);
        activeDocument.removeEventListener("mouseup", onUp);
        stop();
        this.pushCalibrationUndo(this.activeMapName, before, this.captureCalibration(map));
      };
      activeDocument.addEventListener("mousemove", onMove);
      activeDocument.addEventListener("mouseup", onUp);
    });

    // Wheel intentionally NOT bound here: scrolling falls through to the
    // viewport zoom handler so the user can zoom in/out for precision.
    // Resize handles are the only way to change image scale in calibration.

    // Corner resize handles (aspect-locked since image proportions matter)
    let bgResizeBefore: CalibrateSnapshot | null = null;
    this.attachResizeHandles(layer, {
      aspectLocked: true,
      getStartTransform: () => ({
        tx: bg.offsetX,
        ty: bg.offsetY,
        sx: bg.scale,
        sy: bg.scale,
      }),
      onResize: ({ tx, ty, sx }) => {
        bg.offsetX = tx;
        bg.offsetY = ty;
        bg.scale = Math.max(0.05, Math.min(20, sx));
        this.applyBgLayerVars(layer, bg);
        this.updateCalHandleScale();
      },
      onDragStart: () => { bgResizeBefore = this.captureCalibration(map); },
      onDragEnd: () => {
        if (bgResizeBefore) {
          this.pushCalibrationUndo(this.activeMapName, bgResizeBefore, this.captureCalibration(map));
          bgResizeBefore = null;
        }
      },
    });
  }

  /**
   * Attach drag-move + wheel-scale handlers + 8 resize handles (4 corners,
   * 4 edges) to the hex grid container. Corner drags = uniform scale,
   * top/bottom edges = vertical-only stretch, left/right edges = horizontal-
   * only stretch. The vertical stretch is the "hex aspect" knob the user
   * specifically asked for.
   */
  private attachGridCalibrationHandlers(grid: HTMLElement, map: MapData): void {
    const applyGridTransform = () => {
      this.applyGridLayerVars(grid, map);
    };

    // Move the grid by dragging its body (anywhere not on a handle)
    grid.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).classList.contains("duckmage-calibration-handle")) {
        this.setCalibrationFocus("grid");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.setCalibrationFocus("grid");
      const startX = e.clientX, startY = e.clientY;
      const startOX = map.gridDisplayOffsetX ?? 0;
      const startOY = map.gridDisplayOffsetY ?? 0;
      const zoom = this.zoom;
      const before = this.captureCalibration(map);
      const { onMove, stop } = this.coalesceDragMove("grid-move", (ev) => {
        map.gridDisplayOffsetX = startOX + (ev.clientX - startX) / zoom;
        map.gridDisplayOffsetY = startOY + (ev.clientY - startY) / zoom;
        applyGridTransform();
      });
      const onUp = () => {
        activeDocument.removeEventListener("mousemove", onMove);
        activeDocument.removeEventListener("mouseup", onUp);
        stop();
        this.pushCalibrationUndo(this.activeMapName, before, this.captureCalibration(map));
      };
      activeDocument.addEventListener("mousemove", onMove);
      activeDocument.addEventListener("mouseup", onUp);
    });

    // Wheel intentionally NOT bound: falls through to viewport zoom so the
    // user can zoom for precision. Resize handles are the only way to
    // change grid scale during calibration.

    let gridResizeBefore: CalibrateSnapshot | null = null;
    this.attachResizeHandles(grid, {
      aspectLocked: false,
      getStartTransform: () => {
        const legacy = map.gridDisplayScale ?? 1;
        return {
          tx: map.gridDisplayOffsetX ?? 0,
          ty: map.gridDisplayOffsetY ?? 0,
          sx: map.gridDisplayScaleX ?? legacy,
          sy: map.gridDisplayScaleY ?? legacy,
        };
      },
      onResize: ({ tx, ty, sx, sy }) => {
        map.gridDisplayOffsetX = tx;
        map.gridDisplayOffsetY = ty;
        map.gridDisplayScaleX = Math.max(0.1, Math.min(20, sx));
        map.gridDisplayScaleY = Math.max(0.1, Math.min(20, sy));
        if (Math.abs(sx - sy) < 0.001) map.gridDisplayScale = sx;
        applyGridTransform();
        this.updateCalHandleScale();
      },
      onDragStart: () => { gridResizeBefore = this.captureCalibration(map); },
      onDragEnd: () => {
        if (gridResizeBefore) {
          this.pushCalibrationUndo(this.activeMapName, gridResizeBefore, this.captureCalibration(map));
          gridResizeBefore = null;
        }
      },
    });
  }

  /**
   * Add 8 resize handles (4 corners + 4 edges) to a positioned element.
   * `onResize` is called with the scale factor change (x and y, possibly 1)
   * relative to the start of the drag — caller multiplies its current scale
   * by the factor and re-applies its transform.
   *
   * If `aspectLocked`, edge handles are disabled and corner drags constrain
   * factor.x = factor.y (using whichever axis the cursor moved further on).
   */
  /**
   * Attach 8 resize handles around `el`. Caller must use
   * `transform-origin: 0 0` so the anchor math below works.
   *
   * Standard direct-manipulation rule: the side the user grabs moves with
   * the cursor; the **opposite** side stays fixed in screen space. We
   * achieve that by adjusting `translate` alongside `scale` on every
   * mousemove. See `topics/design/notes/resize-handle-anchor-rule` for the
   * derivation. The math (anchor at object-local (ax, ay)):
   *
   *   tx_new = tx_old + ax * (sx_old - sx_new)
   *   ty_new = ty_old + ay * (sy_old - sy_new)
   */
  private attachResizeHandles(
    el: HTMLElement,
    opts: {
      aspectLocked: boolean;
      getStartTransform: () => { tx: number; ty: number; sx: number; sy: number };
      onResize: (next: { tx: number; ty: number; sx: number; sy: number }) => void;
      onDragStart?: () => void;
      onDragEnd?: () => void;
    },
  ): void {
    type Handle =
      | "nw" | "n" | "ne"
      | "w"        | "e"
      | "sw" | "s" | "se";
    const handles: Handle[] = opts.aspectLocked
      ? ["nw", "ne", "sw", "se"]
      : ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

    for (const h of handles) {
      const handle = el.createDiv({
        cls: `duckmage-calibration-handle duckmage-calibration-handle-${h}`,
      });
      handle.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        opts.onDragStart?.();

        const rect = el.getBoundingClientRect();
        const start = opts.getStartTransform();
        const viewportZoom = this.zoom; // CSS scale on the viewport wrapper
        // Pre-transform dimensions (W0, H0): rect is post-everything, so undo
        // both the element's own scale AND the viewport zoom to recover.
        const W0 = rect.width / (start.sx * viewportZoom);
        const H0 = rect.height / (start.sy * viewportZoom);

        // Object-local anchor: the corner opposite the grabbed handle, in
        // pre-transform pixel space (W0 / H0).
        const ax = h.includes("e") ? 0 : h.includes("w") ? W0 : W0 / 2;
        const ay = h.includes("s") ? 0 : h.includes("n") ? H0 : H0 / 2;

        const startX = e.clientX, startY = e.clientY;
        const { onMove, stop } = this.coalesceDragMove(`resize-${h}`, (ev) => {
          // Cursor delta in screen pixels → pre-transform pixels (undo viewport zoom)
          const dx = (ev.clientX - startX) / viewportZoom;
          const dy = (ev.clientY - startY) / viewportZoom;

          // New scale: only the dimension matching the grabbed axis changes.
          // Edge handles leave the perpendicular scale untouched.
          let sxNew = start.sx, syNew = start.sy;
          if (h.includes("e")) sxNew = Math.max(0.05, (W0 * start.sx + dx) / W0);
          if (h.includes("w")) sxNew = Math.max(0.05, (W0 * start.sx - dx) / W0);
          if (h.includes("s")) syNew = Math.max(0.05, (H0 * start.sy + dy) / H0);
          if (h.includes("n")) syNew = Math.max(0.05, (H0 * start.sy - dy) / H0);
          if (opts.aspectLocked) {
            const fx = sxNew / start.sx;
            const fy = syNew / start.sy;
            const dom = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy;
            sxNew = start.sx * dom;
            syNew = start.sy * dom;
          }

          // Translate adjustment to keep the anchor pinned in screen space.
          const txNew = start.tx + ax * (start.sx - sxNew);
          const tyNew = start.ty + ay * (start.sy - syNew);

          opts.onResize({ tx: txNew, ty: tyNew, sx: sxNew, sy: syNew });
        });
        const onUp = () => {
          activeDocument.removeEventListener("mousemove", onMove);
          activeDocument.removeEventListener("mouseup", onUp);
          stop();
          opts.onDragEnd?.();
        };
        activeDocument.addEventListener("mousemove", onMove);
        activeDocument.addEventListener("mouseup", onUp);
      });
    }
  }

  private calibrationHelpEl: HTMLElement | null = null;

  /** Enter calibration mode for the active map's bg image. No-op if no image. */
  enterBgCalibration(): void {
    const map = this.getActiveMap();
    if (!map.backgroundImage?.path) {
      new Notice("Pick a background image first.");
      return;
    }
    this.bgCalibrating = true;
    this.bgCalibrationFocus = null;
    // Cancel any pending bake — if it fires mid-calibration it changes the
    // viewport font-size, which resizes the em-based hex grid while the SVG
    // outline polygons (in pixel coords) stay at their pre-bake size, and we
    // get the visual two-grids drift the user reported.
    if (this.zoomSettleTimer !== null) {
      window.clearTimeout(this.zoomSettleTimer);
      this.zoomSettleTimer = null;
    }
    if (this.zoomFrameId !== null) {
      window.cancelAnimationFrame(this.zoomFrameId);
      this.zoomFrameId = null;
      this.pendingZoomLog = 0;
      this.pendingZoomPivot = null;
    }
    this.registerDomEvent(activeDocument, "keydown", (e: KeyboardEvent) => {
      if (!this.bgCalibrating) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void this.exitBgCalibration(true);
        return;
      }
      this.handleCalibrationArrowKey(e);
    });
    this.renderGrid();
    // Handles are created during renderGrid; size them to the current zoom +
    // per-layer scale now that they exist.
    this.updateCalHandleScale();
    this.showCalibrationHelp();
  }

  /** Update DOM classes so the focused calibration target gets a brighter outline. */
  private applyCalibrationFocusStyles(): void {
    if (!this.viewportEl) return;
    const layer = this.viewportEl.querySelector<HTMLElement>(".duckmage-bg-image-layer");
    const grid = this.viewportEl.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    layer?.toggleClass("is-focused", this.bgCalibrationFocus === "image");
    grid?.toggleClass("is-focused", this.bgCalibrationFocus === "grid");
  }

  /** Set the calibration focus target (called from layer/grid mousedown). */
  private setCalibrationFocus(target: "image" | "grid"): void {
    if (this.bgCalibrationFocus === target) return;
    this.bgCalibrationFocus = target;
    this.applyCalibrationFocusStyles();
  }

  /**
   * Arrow keys nudge whichever calibration target was last clicked. Step is
   * 1 CSS px (or 10 px with Shift). Sequential presses coalesce into a single
   * undo entry via a 500ms debounce.
   */
  private handleCalibrationArrowKey(e: KeyboardEvent): void {
    if (!this.bgCalibrationFocus) return;
    const dirX = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const dirY = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (dirX === 0 && dirY === 0) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const map = this.getActiveMap();
    if (this.nudgeUndoBefore === null) {
      this.nudgeUndoBefore = this.captureCalibration(map);
    }
    if (this.bgCalibrationFocus === "image" && map.backgroundImage) {
      map.backgroundImage.offsetX += dirX * step;
      map.backgroundImage.offsetY += dirY * step;
      const layer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (layer) this.applyBgLayerVars(layer, map.backgroundImage);
    } else if (this.bgCalibrationFocus === "grid") {
      map.gridDisplayOffsetX = (map.gridDisplayOffsetX ?? 0) + dirX * step;
      map.gridDisplayOffsetY = (map.gridDisplayOffsetY ?? 0) + dirY * step;
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) this.applyGridLayerVars(grid, map);
    }
    // Swap in the cheap colour snapshot for the nudge burst (same lever as the
    // mouse drag) so held/repeated arrows don't re-rasterise every hex cell.
    this.markCalibrationActivity();
    if (this.nudgeUndoTimer !== null) window.clearTimeout(this.nudgeUndoTimer);
    this.nudgeUndoTimer = window.setTimeout(() => {
      const after = this.captureCalibration(map);
      if (this.nudgeUndoBefore) {
        this.pushCalibrationUndo(this.activeMapName, this.nudgeUndoBefore, after);
      }
      this.nudgeUndoBefore = null;
      this.nudgeUndoTimer = null;
    }, 500);
  }

  /** Exit calibration. If `save`, persist the current transform. */
  async exitBgCalibration(save: boolean): Promise<void> {
    if (!this.bgCalibrating) return;
    this.bgCalibrating = false;
    this.bgCalibrationFocus = null;
    // Tear down any active snapshot/drag state (renderGrid below rebuilds the
    // grid, but the class lives on the persistent viewportEl and the settle
    // timer could otherwise fire after exit).
    if (this.calActivityTimer !== null) {
      window.clearTimeout(this.calActivityTimer);
      this.calActivityTimer = null;
    }
    this.viewportEl?.removeClass("duckmage-calibrating-drag");
    this.removeCalibrationSnapshot();
    // Flush any pending arrow-nudge undo entry so the final state is recorded
    if (this.nudgeUndoTimer !== null) {
      window.clearTimeout(this.nudgeUndoTimer);
      this.nudgeUndoTimer = null;
      if (this.nudgeUndoBefore) {
        const after = this.captureCalibration(this.getActiveMap());
        this.pushCalibrationUndo(this.activeMapName, this.nudgeUndoBefore, after);
        this.nudgeUndoBefore = null;
      }
    }
    this.hideCalibrationHelp();
    if (save) await this.plugin.saveSettings();
    this.renderGrid();
  }

  private showCalibrationHelp(): void {
    this.hideCalibrationHelp();
    // Anchor to contentEl so Obsidian tears it down on view close.
    // Single-button chip — just a check mark to commit + esc as the
    // documented secondary. Smaller footprint, less visual noise than
    // the prior banner.
    const chip = this.contentEl.createDiv({ cls: "duckmage-calibration-help" });
    const lockBtn = chip.createEl("button", {
      cls: "duckmage-calibration-commit mod-cta",
      attr: { title: "Done calibrating (esc)", "aria-label": "Done calibrating" },
    });
    lockBtn.setText("✓");
    lockBtn.addEventListener("click", () => void this.exitBgCalibration(true));
    this.calibrationHelpEl = chip;
  }

  private hideCalibrationHelp(): void {
    this.calibrationHelpEl?.remove();
    this.calibrationHelpEl = null;
  }

  /**
   * Defensive: remove any stray `.duckmage-calibration-help` from the document
   * body, in case a prior plugin build (or a crash mid-calibration) left one
   * attached. Called from onOpen so a freshly opened view starts clean.
   */
  private sweepStrayCalibrationHelp(): void {
    activeDocument.querySelectorAll(".duckmage-calibration-help").forEach((el) => {
      // Don't remove our own (just-created) banner if it lives in contentEl
      if (!this.contentEl.contains(el)) el.remove();
    });
  }

  /**
   * View teardown. If the user closes the tab/window while calibration is
   * active, persist whatever they had and tear down the banner so the next
   * view open doesn't inherit a half-dead calibration state.
   */
  async onClose(): Promise<void> {
    this.stopUndoListen?.();
    this.stopUndoListen = null;
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    if (this.badgeTimer !== null) window.clearTimeout(this.badgeTimer);
    this.cancelMeasuredLayers?.();
    if (this.legendTimer !== null) window.clearTimeout(this.legendTimer);
    if (this.namesTimer !== null) window.clearTimeout(this.namesTimer);
    if (this.bgCalibrating) {
      await this.exitBgCalibration(true);
    }
    // Persist the viewport (zoom / pan / baked font-size) so the next view
    // open restores the exact frame we were looking at — calibration values
    // are sized to a specific zoom + font-size pair and drift wildly if those
    // are reset to defaults on reopen.
    if (this.viewportEl) {
      const map = this.plugin.getMap(this.activeMapName);
      if (map) {
        map.savedViewport = {
          zoom: this.zoom,
          panX: this.panX,
          panY: this.panY,
          fontSize: this.viewportEl.style.fontSize ?? "",
        };
        await this.plugin.saveSettings();
      }
    }
  }

  /**
   * Draw bright hex outlines over the grid during calibration. CSS `border`
   * can't draw the diagonal hex edges (it's clipped to the rectangle by
   * `clip-path`), so we paint one stroked polygon per hex into an SVG that
   * lives inside the gridContainer — same DOM ancestor as the hexes, so it
   * inherits the gridDisplayScale transform automatically. Verified
   * against the local sandbox in dev/hex-calibration-sandbox.html.
   */
  private renderCalibrationOutlines(gridContainer: HTMLElement): void {
    const hexEls = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex"),
    );
    if (hexEls.length === 0) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-calibration-outlines-svg");
    svg.setAttribute("width", String(gridContainer.offsetWidth));
    svg.setAttribute("height", String(gridContainer.offsetHeight));
    svg.setAttribute("viewBox", `0 0 ${gridContainer.offsetWidth} ${gridContainer.offsetHeight}`);

    const isFlat = this.plugin.settings.hexOrientation === "flat";

    const positionInGrid = (el: HTMLElement): { x: number; y: number } => {
      let x = 0, y = 0;
      let cur: HTMLElement | null = el;
      while (cur && cur !== gridContainer) {
        x += cur.offsetLeft;
        y += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
      }
      return { x, y };
    };

    for (const hex of hexEls) {
      const { x, y } = positionInGrid(hex);
      const w = hex.offsetWidth, h = hex.offsetHeight;
      const pts: [number, number][] = isFlat
        ? [
            [w * 0.25, 0], [w * 0.75, 0], [w, h * 0.5],
            [w * 0.75, h], [w * 0.25, h], [0, h * 0.5],
          ]
        : [
            [w * 0.5, 0], [w, h * 0.25], [w, h * 0.75],
            [w * 0.5, h], [0, h * 0.75], [0, h * 0.25],
          ];
      const poly = activeDocument.createElementNS(svgNS, "polygon");
      poly.setAttribute(
        "points",
        pts.map((p) => `${(p[0] + x).toFixed(1)},${(p[1] + y).toFixed(1)}`).join(" "),
      );
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#22d3ee");
      poly.setAttribute("stroke-width", "2");
      poly.setAttribute("stroke-linejoin", "round");
      svg.appendChild(poly);
    }

    gridContainer.appendChild(svg);
  }

  /**
   * Draw the current terrain colours as filled hexagons onto a single <canvas>
   * laid over the grid, then (via the `duckmage-calibrating-drag` CSS class)
   * hide the real hex cells. During a calibration drag the grid's transform is
   * mutated every frame; transforming this one canvas is a single composite op,
   * versus re-rasterising 3843 clip-path cells (~373ms/frame). Synchronous and
   * one-shot at drag start (~tens of ms); torn down on release. Geometry mirrors
   * renderCalibrationOutlines so the snapshot lines up exactly with the cells.
   */
  private buildCalibrationSnapshot(): void {
    if (!this.viewportEl || this.calSnapshotEl) return;
    const gridContainer = this.viewportEl.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) return;
    const W = gridContainer.offsetWidth;
    const H = gridContainer.offsetHeight;
    if (W === 0 || H === 0) return;
    const canvas = createEl("canvas", { cls: "duckmage-calibration-snapshot" });
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isFlat = this.plugin.settings.hexOrientation === "flat";
    // Read phase only — no DOM writes, so offset reads cost a single layout.
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hex) => {
        const color = hex.style.backgroundColor;
        if (!color) return; // empty hex → transparent, nothing to draw
        let x = 0,
          y = 0;
        let cur: HTMLElement | null = hex;
        while (cur && cur !== gridContainer) {
          x += cur.offsetLeft;
          y += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        const w = hex.offsetWidth,
          h = hex.offsetHeight;
        const pts: [number, number][] = isFlat
          ? [
              [w * 0.25, 0], [w * 0.75, 0], [w, h * 0.5],
              [w * 0.75, h], [w * 0.25, h], [0, h * 0.5],
            ]
          : [
              [w * 0.5, 0], [w, h * 0.25], [w, h * 0.75],
              [w * 0.5, h], [0, h * 0.75], [0, h * 0.25],
            ];
        ctx.beginPath();
        pts.forEach((p, i) => {
          const px = p[0] + x,
            py = p[1] + y;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      });

    gridContainer.prepend(canvas);
    this.calSnapshotEl = canvas;
  }

  private removeCalibrationSnapshot(): void {
    this.calSnapshotEl?.remove();
    this.calSnapshotEl = null;
  }

  /**
   * Show the colour snapshot during a burst of arrow-key nudges and tear it
   * down once the keys go quiet. Arrow keys have no mouseup to end on, so —
   * like zoom's bake-on-quiet — we (re)arm a short settle timer on each nudge;
   * when it finally fires, the real hex cells come back. Without this, every
   * nudge (and every key-repeat while held) re-rasterised all 3843 cells.
   */
  private markCalibrationActivity(): void {
    if (!this.calSnapshotEl) {
      this.buildCalibrationSnapshot();
      this.viewportEl?.addClass("duckmage-calibrating-drag");
    }
    if (this.calActivityTimer !== null)
      window.clearTimeout(this.calActivityTimer);
    this.calActivityTimer = window.setTimeout(() => {
      this.calActivityTimer = null;
      this.viewportEl?.removeClass("duckmage-calibrating-drag");
      this.removeCalibrationSnapshot();
    }, 200);
  }

  /** Re-fit the grid if it's entirely outside the view or its hexes are too small to see. */
  private refitIfLost(): void {
    const clipEl = this.viewportEl?.parentElement;
    const gridEl = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const hexEl = gridEl?.querySelector<HTMLElement>("[data-x]");
    if (!clipEl || !gridEl || !hexEl) return;
    const clip = clipEl.getBoundingClientRect();
    if (clip.width === 0 || clip.height === 0) return; // hidden; measure next time
    const grid = gridEl.getBoundingClientRect();
    const overlapW = Math.min(grid.right, clip.right) - Math.max(grid.left, clip.left);
    const overlapH = Math.min(grid.bottom, clip.bottom) - Math.max(grid.top, clip.top);
    const tooSmall = hexEl.getBoundingClientRect().width < 4;
    if (overlapW < 40 || overlapH < 40 || tooSmall) this.fitGridToView();
  }

  private fitGridToView(): void {
    const clipEl  = this.viewportEl?.parentElement;
    const gridEl  = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (!clipEl || !gridEl) return;
    // Measure at base font size (no baked zoom) so the scale calculation is clean.
    this.setViewportFontSize("");
    const clipW = clipEl.clientWidth;
    const clipH = clipEl.clientHeight;
    const gridW = gridEl.offsetWidth;
    const gridH = gridEl.offsetHeight;
    if (clipW === 0 || clipH === 0 || gridW === 0 || gridH === 0) return;
    // Fit the map's content (edge hexes plus the neighbour strip) into the
    // part of the view the toolbar rows and an open side panel don't cover,
    // so no hex starts out hidden under them. Content is measured on screen
    // and mapped back to unzoomed viewport units (screen = clip + pan + v·zoom).
    const clipRect = clipEl.getBoundingClientRect();
    const content = this.measureContentBox();
    const z0 = Math.max(0.01, this.zoom);
    const vx = content ? (content.left - clipRect.left - this.panX) / z0 : 0;
    const vy = content ? (content.top - clipRect.top - this.panY) / z0 : 0;
    const vw = content ? (content.right - content.left) / z0 : gridW;
    const vh = content ? (content.bottom - content.top) / z0 : gridH;
    const fit = fitToSafeArea(clipW, clipH, vw, vh, this.measureOverlayInsets());
    this.zoom = fit.zoom;
    this.panX = fit.panX - vx * fit.zoom;
    this.panY = fit.panY - vy * fit.zoom;
    this.applyTransform();
  }

  /** Screen box of the map's content: the grid's edge hexes (a flat-top
   *  grid's last column pokes out of the grid element) and the neighbour
   *  strip. Reads only. */
  private measureContentBox(): Box | null {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (!grid) return null;
    const map = this.getActiveMap();
    const { x: ox, y: oy } = map.gridOffset;
    const { cols, rows } = map.gridSize;
    const edge = [`[data-x="${ox}"]`, `[data-x="${ox + cols - 1}"]`, `[data-y="${oy}"]`, `[data-y="${oy + rows - 1}"]`]
      .map((s) => `.duckmage-hex${s}`)
      .join(", ");
    const els = [
      grid,
      ...Array.from(grid.querySelectorAll<HTMLElement>(edge)),
      ...Array.from(grid.querySelectorAll<HTMLElement>(".duckmage-region-shadow-hex")),
    ];
    return unionBoxes(els.map((el) => el.getBoundingClientRect()));
  }

  /**
   * How far the toolbar rows (with the mode bar) and an open side panel
   * reach into the map view, in px from the clip's edges. Reads only.
   */
  private measureOverlayInsets(): Insets {
    const clipEl = this.viewportEl?.parentElement;
    if (!clipEl) return NO_INSETS;
    const clip = clipEl.getBoundingClientRect();
    if (clip.width === 0 || clip.height === 0) return NO_INSETS;
    const box = (el: HTMLElement): Box => el.getBoundingClientRect();
    const top = this.topBandEls.filter((el) => el.isConnected).map(box);
    const right = [this.toolsPanel, this.overlayPanel]
      .filter((p): p is DrawingToolPanel | OverlayPanel => !!p && p.isOpen)
      .map((p) => box(p.element));
    return overlayInsets(clip, top, right);
  }

  private flushPendingZoom(): void {
    if (this.pendingZoomLog === 0 || !this.pendingZoomPivot) {
      this.pendingZoomLog = 0;
      this.pendingZoomPivot = null;
      return;
    }
    const factor = Math.exp(this.pendingZoomLog);
    const { cx, cy } = this.pendingZoomPivot;
    const newZoom = Math.min(5, Math.max(0.2, this.zoom * factor));
    const realFactor = newZoom / this.zoom;
    this.panX = cx - (cx - this.panX) * realFactor;
    this.panY = cy - (cy - this.panY) * realFactor;
    this.zoom = newZoom;
    this.pendingZoomLog = 0;
    this.pendingZoomPivot = null;
    this.applyTransform();
    // Bake after a short debounce. With no easing tail, we can be aggressive
    // — 80ms ≈ 5 frames of quiet — short enough that coords un-blur fast,
    // long enough that a continuous scroll never bakes mid-stream.
    this.scheduleZoomBake();
  }

  private scheduleZoomBake(): void {
    // During calibration we keep zoom as a CSS transform on the viewport
    // (instead of baking it into font-size) so the SVG outline overlay,
    // the hex grid, and the bg image all scale together as a single unit.
    if (this.bgCalibrating) return;
    // Same reasoning whenever a background image is present, but permanently:
    // baking grows the em-based hex grid via font-size while the px-based bg
    // image is grown through a separate `* F` multiply (see bakeZoom). Those
    // two paths only match under exact arithmetic — device-pixel snapping of
    // the em layout on fractional/Retina DPR (e.g. macOS) rounds differently
    // than the smoothly-scaled bg transform, so the grid visibly jumps off the
    // image the instant zoom settles. Keeping zoom as a single composited
    // viewport scale() makes grid + bg scale as one unit → no drift on any DPR.
    // Trade-off: hexes upscale via the compositor (slightly soft) at high zoom
    // over a bg, which is acceptable and matches calibration-mode behaviour.
    if (this.getActiveMap().backgroundImage) return;
    if (this.zoomSettleTimer !== null) window.clearTimeout(this.zoomSettleTimer);
    // 80ms ≈ 5 frames of quiet — short enough that coords un-blur quickly
    // after a scroll stops, long enough that a continuous wheel stream
    // never triggers a mid-stream bake (which would tear down/rebuild SVGs
    // and cost a noticeable hitch).
    this.zoomSettleTimer = window.setTimeout(() => {
      this.zoomSettleTimer = null;
      this.bakeZoom();
    }, 80);
  }

  private setViewportFontSize(fs: string): void {
    if (!this.viewportEl) return;
    this.viewportEl.style.fontSize = fs;
  }

  // Bake the current CSS scale() into the viewport's font-size so the DOM
  // renders natively at the zoomed size instead of upscaling a compositor
  // bitmap (which causes pixelation). Pan offsets stay correct because layout
  // coordinates scale by the same factor as the transform did.
  private bakeZoom(): void {
    if (!this.viewportEl || this.zoom === 1) return;
    // Defensive: do NOT bake while calibrating. Even if a pending timer fires
    // here (shouldn't, since enterBgCalibration cancels it and
    // scheduleZoomBake bails when calibrating), baking mid-calibration drifts
    // the SVG outline from the hex grid.
    if (this.bgCalibrating) return;
    const F = this.zoom;
    const currentFs = parseFloat(getComputedStyle(this.viewportEl).fontSize);

    // The path layer is placed in em (lattice units, see renderPathOverlay),
    // so it grows with the font size and is NOT rebuilt here. The icon
    // layer over it holds px positions computed against the pre-bake hex
    // sizes: tear it down FIRST, before the font-size mutation below, so no
    // paint frame shows icons stranded where the hexes used to be; it is
    // rebuilt via `updatePathIcons()` further down. Sandbox repro of the
    // pre-fix slip: dev/coord-slip-sandbox.html.
    this.viewportEl.querySelector("svg.duckmage-path-icons-svg")?.remove();
    this.viewportEl.removeClass("duckmage-svg-labels-active");
    // Same for the faction/region overlays — they also hold pre-bake
    // pixel positions and would visibly mis-align during the transition.
    this.viewportEl.querySelector("svg.duckmage-faction-svg")?.remove();
    this.viewportEl.querySelector(".duckmage-faction-legend")?.remove();
    this.viewportEl.querySelector("svg.duckmage-region-svg")?.remove();
    this.viewportEl.querySelector(".duckmage-region-labels-layer")?.remove();

    this.viewportEl.style.fontSize = `${currentFs * F}px`;
    this.zoom = 1;
    this.applyTransform();

    // bakeZoom grows em-based things (hex grid CSS dimensions) by F, but
    // pixel-based calibration transforms (bg image offset/scale, grid display
    // offset) do not naturally grow. Multiplying them here by F preserves
    // their position and size relative to the now-bigger hex grid — so a
    // calibrated bg image stays aligned across wheel zooming.
    // Scale-multipliers (gridDisplayScaleX/Y) are unitless and do NOT change.
    const map = this.getActiveMap();
    if (map.backgroundImage) {
      map.backgroundImage.offsetX *= F;
      map.backgroundImage.offsetY *= F;
      map.backgroundImage.scale *= F;
      const bgLayer = this.viewportEl.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (bgLayer) this.applyBgLayerVars(bgLayer, map.backgroundImage);
    }
    if (
      map.gridDisplayOffsetX !== undefined ||
      map.gridDisplayOffsetY !== undefined ||
      map.gridDisplayScaleX !== undefined ||
      map.gridDisplayScaleY !== undefined ||
      map.gridDisplayScale !== undefined
    ) {
      map.gridDisplayOffsetX = (map.gridDisplayOffsetX ?? 0) * F;
      map.gridDisplayOffsetY = (map.gridDisplayOffsetY ?? 0) * F;
      const gridContainer = this.viewportEl.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (gridContainer) this.applyGridLayerVars(gridContainer, map);
    }
    // Also persist the new viewport state — font-size just baked from the
    // viewport zoom, so the saved snapshot has to follow.
    map.savedViewport = {
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      fontSize: this.viewportEl.style.fontSize ?? "",
    };
    void this.plugin.saveSettings();

    this.updatePathIcons();
    this.updateFactionOverlay();
    this.updateRegionOverlay();
    this.updateTokenLayer();
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

  /** Centre the view on a hex. `keepHexWidth` (on-screen px) keeps that hex
   *  size instead of zooming to the default 1.5× (crossing regions). */
  centerOnHex(x: number, y: number, keepHexWidth?: number): void {
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (!hexEl) {
      new Notice(`Hex ${x}, ${y} is not in the current grid.`);
      return;
    }

    const clipEl = this.viewportEl?.parentElement;
    if (!clipEl) return;

    // Use getBoundingClientRect for reliable positions — the offsetParent chain
    // can silently break (e.g. fixed-position ancestors), causing wrong results.
    const hexRect = hexEl.getBoundingClientRect();
    const clipRect = clipEl.getBoundingClientRect();

    // Back-compute the hex centre in pre-transform viewport coordinates
    const hexScreenX = hexRect.left + hexRect.width / 2;
    const hexScreenY = hexRect.top + hexRect.height / 2;
    const hexViewX = (hexScreenX - clipRect.left - this.panX) / this.zoom;
    const hexViewY = (hexScreenY - clipRect.top - this.panY) / this.zoom;

    const targetZoom = keepHexWidth ? zoomForHexWidth(keepHexWidth, hexRect.width, this.zoom) : 1.5;
    // Centre in the part of the view no toolbar or open panel covers.
    const ins = usableInsets(clipRect.width, clipRect.height, this.measureOverlayInsets());
    const midX = ins.left + (clipRect.width - ins.left - ins.right) / 2;
    const midY = ins.top + (clipRect.height - ins.top - ins.bottom) / 2;
    this.zoom = targetZoom;
    this.panX = midX - hexViewX * targetZoom;
    this.panY = midY - hexViewY * targetZoom;
    this.applyTransform();
    this.scheduleZoomBake();
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
    this.renderBackgroundImage(this.viewportEl, region);

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
    const owView = OverworldLayer.viewOf(this.plugin, region);
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
      // The region's name on hover, nothing drawn on the map.
      let pending = false;
      gridContainer.addEventListener("mousemove", (e) => {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(() => {
          pending = false;
          const cell = this.overworldLayer.cellAt(gridContainer, e.clientX, e.clientY);
          const tip = !cell ? ""
            : cell.region ? `${this.plugin.mapLabel(cell.region)}: click to go there`
            : `No region yet (hex ${cell.parentHex.replace("_", ", ")})` + (canAdd(this.getActiveMap()) ? ": click to set its biome" : "");
          if (gridContainer.title !== tip) gridContainer.title = tip;
        });
      });
    } else if (owView === "biomes") gridContainer.addClass("duckmage-ow-biomes");

    // Apply optional independent grid transform (used for bg-image calibration).
    // Custom-property values default to identity in CSS when unset, so we
    // can safely write them unconditionally — no special-casing for the
    // un-calibrated default.
    this.applyGridLayerVars(gridContainer, region);

    if (this.bgCalibrating) this.attachGridCalibrationHandlers(gridContainer, region);

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
          const factions = this.getFactionLinksFromCache(path);
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

    this.refreshTerrainLegend();

    // Everything below measures hex positions. A grid that isn't laid out
    // yet (map tab in the background on plugin reload) measures 0 and would
    // put every label at 0,0, so wait until it has a size.
    this.cancelMeasuredLayers?.();
    this.coordPlacements = [];
    this.coordLabels.clear();
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
    this.renderNeighbourShadow(gridContainer, region);
    this.overworldLayer.render(gridContainer, region);
    this.minimap.render(this.contentEl, region);
    // The view switch or a hand-edited `mode:` may have changed what the bars say.
    this.updateModeBar();
    this.refreshWorkModeBtn();
    this.renderPathOverlay(gridContainer);
    this.renderRegionOverlay(gridContainer);
    this.renderFactionOverlay(gridContainer);
    // Coord labels go LAST (and at z:10 in CSS) so they sit above the path
    // SVG, GM-icon overlay, faction overlay, and region overlay — paths
    // and icons can no longer cover up the hex coordinates.
    this.renderCoordLabelsLayer(gridContainer);
    // Badges reuse the hex centres the coord labels just measured.
    this.renderLinkBadges(gridContainer);
    this.drawHexNames(gridContainer);
    if (this.bgCalibrating) {
      this.renderCalibrationOutlines(gridContainer);
      this.applyCalibrationFocusStyles();
    }
    this.renderTokenLayer(gridContainer);
  }

  /**
   * Neighbouring regions' terrain just past this map's edges, dimmed (1–3
   * hexes deep by map size). Clicking one asks to go to that region.
   *
   * Drawn on its own layer so the grid itself (and anything calibrated to
   * it) doesn't move: hex spacing is read from hexes already laid out, all
   * reads first, then the writes (see the read-then-write rule in CLAUDE.md).
   */
  private renderNeighbourShadow(gridContainer: HTMLElement, region: MapData): void {
    this.lastShadow = null;
    this.shadowJoinKey = "";
    gridContainer.querySelectorAll(".duckmage-region-shadow-layer").forEach((el) => el.remove());
    if (!region.world) return;
    const shadow = neighbourShadow(this.plugin, region);
    this.lastShadow = { map: region.name, shadow };
    if (!shadow.size) return;
    const { x: ox, y: oy } = region.gridOffset;
    const { cols, rows } = region.gridSize;
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const stagger = this.getActiveStagger();
    const shifted = (n: number) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0) ? 1 : 0;

    // ── Reads ──
    const hexAt = (x: number, y: number) => gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    const origin = hexAt(ox, oy);
    if (!origin) return;
    const g = gridContainer.getBoundingClientRect();
    const sx = gridContainer.offsetWidth ? g.width / gridContainer.offsetWidth : 1;
    const sy = gridContainer.offsetHeight ? g.height / gridContainer.offsetHeight : 1;
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - g.left) / sx, y: (r.top + r.height / 2 - g.top) / sy, w: r.width / sx, h: r.height / sy };
    };
    const A = centre(origin);
    // Positions are written in em: zooming bakes a new font size into the
    // grid and the hexes (sized in em) resize with it; px would be left behind.
    const em = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    const right = cols > 1 ? hexAt(ox + 1, oy) : null, below = rows > 1 ? hexAt(ox, oy + 1) : null;
    const B = right ? centre(right) : null, C = below ? centre(below) : null;
    let place: (x: number, y: number) => { x: number; y: number };
    if (isFlat) {
      const colPitch = B ? B.x - A.x : A.w * 0.75;
      const rowPitch = C ? C.y - A.y : A.h;
      place = (x, y) => ({ x: A.x + (x - ox) * colPitch, y: A.y + (y - oy) * rowPitch + (shifted(x) - shifted(ox)) * (rowPitch / 2) });
    } else {
      const colPitch = B ? B.x - A.x : A.w;
      const rowPitch = C ? C.y - A.y : A.h * 0.75;
      place = (x, y) => ({ x: A.x + (x - ox) * colPitch + (shifted(y) - shifted(oy)) * (colPitch / 2), y: A.y + (y - oy) * rowPitch });
    }
    const palettes = new Map<string, Map<string, string>>();
    const colorOf = (map: string, terrain?: string) => {
      if (!terrain) return undefined;
      let p = palettes.get(map);
      if (!p) palettes.set(map, (p = new Map(this.plugin.getMapPalette(map).map((t) => [t.name, t.color]))));
      return p.get(terrain);
    };
    const items = [...shadow].map(([key, s]) => {
      const [x, y] = key.split("_").map(Number);
      return { s, at: place(x, y), color: colorOf(s.map, s.terrain) };
    });
    // The neighbours' roads and rivers across the strip (read-only), so a
    // path here can be drawn to meet them (round 4: testers lined roads up
    // by eye). In em, like the strip's hexes; a dot marks where one ends.
    // Each neighbour's paths in its own palette's styles.
    const typeOf = (map: string, name: string) => this.plugin.getMapPathTypes(map).find((t) => t.name === name);
    const centreEm = (key: string) => {
      const [x, y] = key.split("_").map(Number);
      const p = place(x, y);
      return { cx: p.x / em, cy: p.y / em };
    };
    // A neighbour path that ends where one of ours does draws on to the
    // shared edge (no end dot there): the two read as one road (round 6 U8).
    const joins = this.currentSeamJoins(region);
    this.shadowJoinKey = seamJoinKey(joins);
    const joinedAt = (run: { map: string; typeName: string }, key: string) =>
      joins.find((j) => j.map === run.map && j.typeName === run.typeName && j.other === key);
    const ghostPaths = ghostPathRuns(shadow, (m) => this.plugin.paths.resolvedPathChains(m)).flatMap((run) => {
      const pt = typeOf(run.map, run.typeName);
      if (!pt) return [];
      const pts = ghostRunPoints(run, centreEm);
      const startJoin = run.stubStart ? undefined : joinedAt(run, run.hexes[0]);
      const endJoin = run.stubEnd ? undefined : joinedAt(run, run.hexes[run.hexes.length - 1]);
      const ends = [run.stubStart || startJoin ? null : pts[0], run.stubEnd || endJoin ? null : pts[pts.length - 1]]
        .filter((p): p is { cx: number; cy: number } => p !== null);
      if (startJoin) pts.unshift(seamPoint(centreEm(startJoin.other), centreEm(startJoin.own)));
      if (endJoin) pts.push(seamPoint(centreEm(endJoin.other), centreEm(endJoin.own)));
      return [{ run, pt, pts, ends }];
    });
    const gridWEm = gridContainer.offsetWidth / em;
    const gridHEm = gridContainer.offsetHeight / em;

    // ── Writes ──
    const layer = gridContainer.createDiv({ cls: "duckmage-region-shadow-layer" });
    for (const { s, at, color } of items) {
      // Not a .duckmage-hex: painting, overlays and labels all look for those.
      const el = layer.createDiv({
        cls: "duckmage-region-shadow-hex",
        attr: { title: `${this.plugin.mapLabel(s.map)}: hex ${s.x}, ${s.y}`, "data-region": s.map },
      });
      el.setCssProps({
        "--duckmage-shadow-x": `${(at.x - A.w / 2) / em}em`,
        "--duckmage-shadow-y": `${(at.y - A.h / 2) / em}em`,
        "--duckmage-shadow-w": `${A.w / em}em`,
        "--duckmage-shadow-h": `${A.h / em}em`,
        ...(color ? { "--duckmage-shadow-color": color } : {}),
      });
      el.addEventListener("click", () => {
        new RegionNavigateModal(this.app, this.plugin, { map: s.map, x: s.x, y: s.y }, () => this.goToRegionHex(s.map, s.x, s.y)).open();
      });
    }

    if (ghostPaths.length > 0 && gridWEm > 0 && gridHEm > 0) {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = activeDocument.createElementNS(svgNS, "svg");
      svg.classList.add("duckmage-region-shadow-paths");
      // One user unit = 1em of the grid, so it scales with zoom like the strip.
      svg.setAttribute("viewBox", `0 0 ${gridWEm} ${gridHEm}`);
      svg.setAttribute("preserveAspectRatio", "none");
      const dashFor: Record<string, number[]> = { dashed: [8, 4], dotted: [2, 4] };
      for (const { run, pt, pts, ends } of ghostPaths) {
        const path = activeDocument.createElementNS(svgNS, "path");
        path.setAttribute("d", smoothPath(pts));
        path.setAttribute("stroke", pt.color);
        path.setAttribute("stroke-width", String(pt.width / em));
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("fill", "none");
        const dash = dashFor[pt.lineStyle];
        if (dash) path.setAttribute("stroke-dasharray", dash.map((d) => d / em).join(" "));
        path.setAttribute("data-region", run.map);
        svg.appendChild(path);
        for (const end of ends) {
          const dot = activeDocument.createElementNS(svgNS, "circle");
          dot.setAttribute("class", "duckmage-region-shadow-path-end");
          dot.setAttribute("cx", String(end.cx));
          dot.setAttribute("cy", String(end.cy));
          dot.setAttribute("r", String(Math.max(3, pt.width * 0.9) / em));
          dot.setAttribute("fill", pt.color);
          svg.appendChild(dot);
        }
      }
      layer.appendChild(svg);
    }
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
          this.updateGmIcons();
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
        onSwitchMap: (name: string) => this.navigateToMap(name),
        onNewChildMap: (hx: number, hy: number) => this.openNewSubmapSetup(hx, hy),
        onLinkExistingMap: (hx: number, hy: number) => this.openLinkExistingMap(hx, hy),
        onManageLocations: (hx: number, hy: number) => this.openLocationsList(hx, hy),
        onCrossToRegion: (name: string, nx: number, ny: number) => this.goToRegionHex(name, nx, ny, true),
      },
    );
    modal.open();
  }

  private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
    evt.preventDefault();
    // When any tool is active, the global capture-phase contextmenu handler
    // intercepts the event and shows the painter context menu — this handler
    // only fires when drawingMode === null.
    if (this.drawingMode !== null) return;

    // Overworlds are the big-picture view (#49): region-level items only,
    // no hex editor.
    if (OverworldLayer.viewOf(this.plugin, this.getActiveMap())) {
      this.showOverworldMenu(evt, x, y);
      return;
    }

    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    // Terrain, icon and submap live in the map note, and a hex can have them
    // before its hex note exists (a generated map, a submap made from this
    // menu) — gating these on the note hid "Enter submap" and "Clear
    // terrain" on such hexes (fresh-eyes N3).
    const terrain = getTerrainFromFile(this.app, hexPath);
    const iconOverride = getIconOverrideFromFile(this.app, hexPath);
    const childPlan = submapMenuPlan(this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`)
      ?? { locations: getHexMapsFromFile(this.app, hexPath).locations });

    // Items the map's work mode locks are left out, with one hint line.
    const menu = new ModeMenu(this.currentWorkMode());

    menu.add("hex.center", "Center on this hex", "crosshair", () => this.centerOnHex(x, y));

    menu.addSeparator();

    menu.add("hex.open-note", "Open note", "file-text", () => {
      void (async () => {
        const existing = this.app.vault.getAbstractFileByPath(hexPath);
        const file =
          existing instanceof TFile
            ? existing
            : await this.plugin.createHexNote(x, y, this.activeMapName);
        if (file) await openNoteFocused(this.app, file);
      })();
    });

    // Maps from this hex (K7): its region, then up to two locations by
    // name, or one "Locations (n)…" item that opens the list.
    const region = childPlan.region;
    if (region && this.plugin.getMap(region)) {
      menu.add("hex.enter-region", `Enter region: ${this.plugin.mapLabel(region)}`, "log-in", () => this.navigateToMap(region));
    }
    for (const loc of childPlan.open) {
      menu.add("hex.open-location", `Open: ${this.plugin.mapLabel(loc)}`, "map-pin", () => {
        if (this.plugin.getMap(loc)) this.navigateToMap(loc);
        else this.openLocationsList(x, y);
      });
    }
    if (childPlan.listCount) {
      menu.add("hex.locations", `Locations (${childPlan.listCount})…`, "list", () => this.openLocationsList(x, y));
    }
    menu.add("hex.new-map", "New map from this hex…", "plus", () => this.openNewSubmapSetup(x, y));
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
        () => {
          void this.app.workspace
            .getLeaf("tab")
            .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
        },
        (file) => void this.openRandomTableAtFile(file),
      ).open();
    });

    menu.add("hex.swap", "Swap hex", "arrow-left-right", () => {
      if (this.drawingMode !== "swap") this.handleSwapButton();
      void this.onHexSwapClick(x, y);
    });

    menu.add("hex.create-token", "Create token here", "circle-user", () => this.createTokenAtHex(x, y));

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

    menu.showAtMouseEvent(evt);
  }

  /**
   * An overworld hex's right-click menu (overworldMenu): Enter region and
   * Edit region… on a region, Set biome… on an empty hex, Center, and the
   * hex's Locations. In the Regions view the brick under the pointer counts.
   */
  private showOverworldMenu(evt: MouseEvent, x: number, y: number): void {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = OverworldLayer.viewOf(this.plugin, this.getActiveMap()) === "regions" && grid
      ? this.overworldLayer.cellAt(grid, evt.clientX, evt.clientY) : null;
    const [px, py] = cell ? cell.parentHex.split("_").map(Number) : [x, y];
    const key = `${px}_${py}`;
    const region = regionMapAt(this.plugin.settings.maps, this.activeMapName, key)?.name;
    const locations = this.plugin.mapStore.get(this.activeMapName, key)?.locations?.length ?? 0;
    const menu = new ModeMenu(this.currentWorkMode());
    const icons: Record<string, string> = { "enter-region": "log-in", "edit-region": "settings-2", "set-biome": "trees", center: "crosshair", locations: "list" };
    for (const it of overworldMenu(this.getActiveMap(), !!region, locations)) {
      const id = `ow.${it.id}` as const;
      const title = it.id === "enter-region" && region ? `Enter region: ${this.plugin.mapLabel(region)}` : it.enabled ? it.title : `${it.title} (${it.hint})`;
      menu.add(id, title, icons[it.id] ?? "dot", () => {
        if (it.id === "enter-region" && region) {
          if (cell) this.enterRegionAt(region, cell.x, cell.y);
          else this.navigateToMap(region);
        } else if (it.id === "edit-region") this.openEditRegion(px, py);
        else if (it.id === "set-biome") new BiomePickerModal(this.biomeHost(), this.activeMapName, px, py).open();
        else if (it.id === "center") this.centerOnHex(px, py);
        else if (it.id === "locations") this.openLocationsList(px, py);
      }, { disabled: !it.enabled });
    }
    // Mark the party (or anything) on the overworld: tokens sit on its hexes.
    menu.add("ow.create-token", "Create token here", "circle-user", () => this.createTokenAtHex(px, py));
    menu.showAtMouseEvent(evt);
  }

  /** "Edit region…" for the region on hex (px, py) of `overworld` (default the open map; from inside a region, its overworld). */
  openEditRegion(px: number, py: number, overworld = this.activeMapName): void {
    const openLocations = (hx: number, hy: number) => {
      if (overworld === this.activeMapName) { this.openLocationsList(hx, hy); return; }
      // The list belongs to the overworld hex: go there first.
      this.navigateToMap(overworld);
      window.setTimeout(() => this.openLocationsList(hx, hy), 50);
    };
    new EditRegionModal({ ...this.biomeHost(), openLocations }, overworld, px, py).open();
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

    // Overworlds: the full view jumps into the region at the clicked hex;
    // the biomes view (or a hex with no region yet) sets the hex's biome.
    const ow = OverworldLayer.viewOf(this.plugin, this.getActiveMap());
    if (ow && !e?.ctrlKey && !e?.metaKey) {
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      const cell = ow === "regions" && e && grid ? this.overworldLayer.cellAt(grid, e.clientX, e.clientY) : null;
      // The brick under the pointer in the Regions view, else the hex clicked.
      const [px, py] = cell ? cell.parentHex.split("_").map(Number) : [x, y];
      const region = cell ? cell.region : regionMapAt(this.plugin.settings.maps, this.activeMapName, `${x}_${y}`)?.name;
      const act = overworldLeftClick(this.getActiveMap(), !!region);
      if (act.kind === "enter" && region) {
        if (cell) this.enterRegionAt(region, cell.x, cell.y);
        else this.navigateToMap(region);
      } else if (act.kind === "place") new BiomePickerModal(this.biomeHost(), this.activeMapName, px, py).open();
      else if (act.kind === "hint") new Notice(act.hint);
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
      this.updateToolbarButtonStates();
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
      if (this.currentTerrainStroke) {
        if (!this.currentTerrainStroke.has(path)) {
          // The terrain before this stroke: a write still queued for the
          // hex, else the map data (the map note, via the store). Hex-note
          // frontmatter no longer holds terrain, so reading it made undo
          // clear a repainted hex instead of restoring it (smoke suite C6).
          const pending = this.pendingTerrainWrites.get(path);
          const oldTerrain = pending ? pending.terrain : getTerrainFromFile(this.app, path);
          this.currentTerrainStroke.set(path, {
            x: hx,
            y: hy,
            path,
            oldTerrain,
            newTerrain: terrain,
          });
        } else {
          this.currentTerrainStroke.get(path)!.newTerrain = terrain;
        }
      }
      this.scheduleTerrainWrite(hx, hy, path, terrain);
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
    const priorList = this.parseGmIconsDataset(hexEl.dataset.gmIcons);
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
    this.pushUndo({ kind: "icon", entries: [undoEntry] });
    this.updateUndoButton();

    if (newList.length > 0) {
      hexEl.dataset.gmIcons = JSON.stringify(newList);
    } else {
      delete hexEl.dataset.gmIcons;
    }
    this.updateGmIcons();
    this.scheduleGmIconsListWrite(x, y, path, newList);
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
      const priorList = this.parseGmIconsDataset(hexEl?.dataset.gmIcons);
      // First touch of this hex during the current stroke records the
      // pre-stroke list once; subsequent touches keep that snapshot and
      // only update the new list.
      let strokeEntry = this.currentIconStroke?.get(path);
      if (!strokeEntry) {
        strokeEntry = {
          x, y, path,
          oldIcon: priorList[0] ?? null,
          newIcon: null,
          isGm: true,
          oldGmList: [...priorList],
          newGmList: [...priorList],
        };
        this.currentIconStroke?.set(path, strokeEntry);
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
      this.updateGmIcons();
      this.scheduleGmIconsListWrite(x, y, path, newList);
    } else {
      // ── Regular icon override ────────────────────────────────────────────
      if (this.currentIconStroke && !this.currentIconStroke.has(path)) {
        this.currentIconStroke.set(path, {
          x, y, path,
          oldIcon: hexEl?.dataset.iconOverride ?? null,
          newIcon: icon,
          isGm: false,
        });
      } else {
        const existing = this.currentIconStroke?.get(path);
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
      this.updatePathOverlay();
      this.scheduleIconWrite(x, y, path, icon);
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

  private async onHexFactionPaintClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "factionLink" || !this.paintFactionPath) return;
    if (this.isErasingMode) { await this.onHexFactionEraseClick(x, y); return; }
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    const factionFile = this.app.vault.getAbstractFileByPath(this.paintFactionPath);
    if (!(factionFile instanceof TFile)) return;

    const factionBasename = factionFile.basename;

    // Skip silently if already painted (pending or cache both use basenames now)
    if (this.getFactionLinksFromCache(hexPath).includes(factionBasename)) return;

    // Record for undo (first touch only — it was absent before this stroke)
    if (this.currentFactionStroke && !this.currentFactionStroke.has(hexPath + "\0" + factionBasename)) {
      this.currentFactionStroke.set(hexPath + "\0" + factionBasename, {
        hexPath, factionBasename, factionFilePath: this.paintFactionPath, wasPresent: false,
      });
    }

    // Update the overlay IMMEDIATELY (synchronous) — no awaits before this point
    // If this faction was previously erased (still in cache), un-erase it
    this.erasedFactionLinks.get(hexPath)?.delete(factionBasename);
    const pending = this.pendingFactionLinks.get(hexPath) ?? new Set<string>();
    pending.add(factionBasename);
    this.pendingFactionLinks.set(hexPath, pending);
    if (this.getActiveMap().showFactionOverlay) this.updateFactionOverlay();

    // Create hex note if it doesn't exist yet
    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y, this.activeMapName);
      if (!(hexFile instanceof TFile)) {
        // Note creation failed — revert pending entry
        this.pendingFactionLinks.get(hexPath)?.delete(factionBasename);
        return;
      }
    }

    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) hexEl.addClass("duckmage-hex-exists");

    // Write the link in the background — addLinkToSection deduplicates internally
    const target = this.app.metadataCache.fileToLinktext(factionFile, hexPath);
    await addLinkToSection(this.app, hexPath, "Factions", `[[${target}]]`);
  }

  private async onHexFactionEraseClick(x: number, y: number): Promise<void> {
    if (!this.paintFactionPath) return;
    const factionFile = this.app.vault.getAbstractFileByPath(this.paintFactionPath);
    if (!(factionFile instanceof TFile)) return;

    const factionBasename = factionFile.basename;
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);

    if (!this.getFactionLinksFromCache(hexPath).includes(factionBasename)) return;

    // Record for undo (first touch only — it was present before this stroke)
    if (this.currentFactionStroke && !this.currentFactionStroke.has(hexPath + "\0" + factionBasename)) {
      this.currentFactionStroke.set(hexPath + "\0" + factionBasename, {
        hexPath, factionBasename, factionFilePath: this.paintFactionPath, wasPresent: true,
      });
    }

    // Update overlay immediately (synchronous): remove from pending, add to erased
    this.pendingFactionLinks.get(hexPath)?.delete(factionBasename);
    const erased = this.erasedFactionLinks.get(hexPath) ?? new Set<string>();
    erased.add(factionBasename);
    this.erasedFactionLinks.set(hexPath, erased);
    if (this.getActiveMap().showFactionOverlay) this.updateFactionOverlay();

    // Remove from file in the background
    const target = this.app.metadataCache.fileToLinktext(factionFile, hexPath);
    await removeLinkFromSection(this.app, hexPath, "Factions", target);
  }

  // ── Per-hex coalescing write queues ────────────────────────────────────────
  //
  // Only the *latest* painted value is ever queued per hex. If the user repaints
  // hex A five times while the first write is in-flight, we perform exactly two
  // writes: the in-flight one and then the final value. No writes are lost; no
  // stale intermediate value can overwrite a newer one.

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
  private labelHex(hexEl: HTMLElement, terrain?: string | null): void {
    const x = Number(hexEl.dataset.x);
    const y = Number(hexEl.dataset.y);
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    const pending = this.pendingTerrainWrites.get(hexPath);
    const own = terrain !== undefined ? terrain : pending ? pending.terrain : getTerrainFromFile(this.app, hexPath);
    // The notes it links (towns, dungeons…), from the metadata cache (S3).
    const note = this.app.vault.getAbstractFileByPath(hexPath);
    const linked = note instanceof TFile ? linkedNotesText(linksBySection(this.app.metadataCache.getFileCache(note)), this.plugin.sectionWordsFor(this.activeMapName)) : "";
    // Biomes view: the region outline is hidden (every hex has one), so the
    // tooltip names the hex's region instead.
    const regionMap = OverworldLayer.viewOf(this.plugin, this.getActiveMap()) === "biomes" ? this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`)?.regionMap : undefined;
    const region = regionMap && this.plugin.getMap(regionMap) ? this.plugin.mapLabel(regionMap) : null;
    const label = hexHoverLabel(x, y, own, this.getActiveMap().baseTerrain ?? null, getHexNameFromFile(hexPath), linked, region);
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

  private commitSubStroke(): void {
    const stroke = this.currentSubStroke;
    this.currentSubStroke = null;
    if (!stroke || stroke.size === 0) return;
    this.pushUndo({ kind: "subhex", entries: [...stroke.values()] });
    this.updateUndoButton();
  }

  /** Undo / redo a full-view stroke: each touched region map gets its hexes back. */
  private applySubStroke(entries: SubHexUndoEntry[], which: "old" | "new"): void {
    for (const e of entries) {
      const terrain = which === "old" ? e.oldTerrain : e.newTerrain;
      const locked = which === "old" ? e.oldLocked : true;
      this.plugin.mapStore.set(e.map, e.key, { terrain, locked: locked || null });
    }
    void this.plugin.mapStore.flush();
  }

  /** "x_y" of the region hex under a screen point in the full view (null: none). */
  private subHexKeyAt(clientX: number, clientY: number): string | null {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = grid ? this.overworldLayer.cellAt(grid, clientX, clientY) : null;
    return cell ? `${cell.x}_${cell.y}` : null;
  }

  /**
   * Paint the region hex under a screen point (full view): written to that
   * region's map and locked, so regenerating the region keeps it. A brush
   * wider than one hex reaches across seams into the next region.
   */
  private paintSubHexAt(clientX: number, clientY: number): string | null {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = grid ? this.overworldLayer.cellAt(grid, clientX, clientY) : null;
    if (!cell) return null;
    const ow = this.activeMapName;
    const owInfo = overworldOf(this.plugin, ow);
    if (!owInfo) return null;
    const layout = owInfo.layout;
    if (this.terrainPickMode && !this.isErasingMode) {
      if (!cell.region) return null;
      this.terrainPickMode = false;
      this.paintTerrainName = this.plugin.mapStore.get(cell.region, `${cell.x}_${cell.y}`)?.terrain ?? null;
      this.updateToolbarButtonStates();
      return null;
    }
    const terrain = this.isErasingMode ? null : this.paintTerrainName;
    // Each brushed cell goes into the region map that holds it (across
    // seams), written now so the layer, the minimap and any open view of
    // that region update during the stroke. Painted cells are locked.
    const { targets, missed } = paintTargets(
      layout,
      brushCells(layout, cell.x, cell.y, this.paintBrushSize),
      (hex) => regionMapAt(this.plugin.settings.maps, ow, hex)?.name,
    );
    if (!targets.length && missed && !this.subStrokeMissHinted) {
      this.subStrokeMissHinted = true;
      new Notice(PAINT_NO_REGION_HINT);
    }
    for (const { map, key } of targets) {
      const cur = this.plugin.mapStore.get(map, key);
      const id = `${map}|${key}`;
      const prev = this.currentSubStroke?.get(id);
      if (prev) prev.newTerrain = terrain;
      else this.currentSubStroke?.set(id, { map, key, oldTerrain: cur?.terrain ?? null, oldLocked: !!cur?.locked, newTerrain: terrain });
      if (cur?.terrain === terrain && !!cur?.locked === !!terrain) continue;
      this.plugin.mapStore.set(map, key, { terrain, locked: terrain ? true : null });
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
    if (OverworldLayer.viewOf(this.plugin, map) !== "biomes") return;
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
    const active = this.getActiveMap();
    const home = regionHome(this.plugin, active.name);
    const r = overworldRefreshFor(this.plugin.getMap(map) ?? { name: map }, active.name, home?.overworld.name);
    // Any region, whatever this view shows: its bitmap is cached here too.
    if (r.invalidate) this.overworldLayer.invalidate(r.invalidate);
    if (r.redrawLayer) this.overworldLayer.scheduleRedraw();
    if (r.refreshMinimap) {
      if (this.minimapTimer !== null) window.clearTimeout(this.minimapTimer);
      this.minimapTimer = window.setTimeout(() => {
        this.minimapTimer = null;
        this.minimap.render(this.contentEl, this.getActiveMap());
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
    this.pushUndo({ kind: "terrain", entries: [{ x, y, path, oldTerrain: old, newTerrain: terrain }] });
    this.scheduleTerrainWrite(x, y, path, terrain);
    this.renderGrid();
  }

  /** "Remove icon override" from the hex menu: mode-gated and undoable. */
  private removeIconOverride(x: number, y: number): void {
    if (!this.modeAllows("paint-icon")) return;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const old = getIconOverrideFromFile(this.app, path);
    if (!old) return;
    this.pushUndo({ kind: "icon", entries: [{ x, y, path, oldIcon: old, newIcon: null, isGm: false }] });
    this.scheduleIconWrite(x, y, path, null);
    this.renderGrid(undefined, new Map([[path, null]]));
  }

  private commitTerrainStroke(): void {
    this.commitSubStroke();
    if (!this.currentTerrainStroke || this.currentTerrainStroke.size === 0) {
      this.currentTerrainStroke = null;
      return;
    }
    const entries = [...this.currentTerrainStroke.values()];
    // Pins made by this stroke's writes (some land after the mouse is up).
    const pins = this.strokePins ?? [];
    this.strokePins = pins;
    this.pushUndo({ kind: "terrain", entries, pins });
    this.currentTerrainStroke = null;
    this.updateUndoButton();
    void this.releaseStrokePins(pins);
  }

  private commitIconStroke(): void {
    if (!this.currentIconStroke || this.currentIconStroke.size === 0) {
      this.currentIconStroke = null;
      return;
    }
    const entries = [...this.currentIconStroke.values()];
    this.pushUndo({ kind: "icon", entries });
    this.currentIconStroke = null;
    this.updateUndoButton();
  }

  private commitFactionStroke(): void {
    if (!this.currentFactionStroke || this.currentFactionStroke.size === 0) {
      this.currentFactionStroke = null;
      return;
    }
    const entries = [...this.currentFactionStroke.values()];
    this.pushUndo({ kind: "faction", entries });
    this.currentFactionStroke = null;
    this.updateUndoButton();
  }

  private commitRegionStroke(): void {
    if (!this.currentRegionStroke || this.currentRegionStroke.size === 0) {
      this.currentRegionStroke = null;
      return;
    }
    const entries = [...this.currentRegionStroke.values()];
    this.pushUndo({ kind: "region", entries });
    this.currentRegionStroke = null;
    this.updateUndoButton();
  }

  /** Record an action in this map's queue for its current mode (WM6). */
  private pushUndo(item: UndoItem, mapName = this.activeMapName): void {
    this.plugin.pushUndo(mapName, item);
  }

  /** The open map's work mode: its undo queue is the one the buttons use. */
  private currentWorkMode(): WorkMode {
    return workModeOf(this.plugin.getMap(this.activeMapName));
  }

  private undoBusy = false;

  /** Undo the last action done on this map in its current mode (WM6). */
  private async undo(): Promise<void> {
    await this.undoStep("undo");
  }

  private async redo(): Promise<void> {
    await this.undoStep("redo");
  }

  /**
   * One undo or redo step from this map's queue for its mode. An entry whose
   * target changed since (in another mode, or by hand) is skipped part by
   * part, so it never reverts the newer change (prepareUndo).
   */
  private async undoStep(dir: UndoDirection): Promise<void> {
    if (this.undoBusy) return;
    this.undoBusy = true;
    try {
      // Reads below compare against what's stored: let queued writes land.
      await this.terrainWritesSettled();
      const item = await this.plugin.undoBook.step(this.activeMapName, this.currentWorkMode(), dir, (it, d) => this.prepareUndo(it, d));
      if (item) await this.applyUndo(item, dir);
    } finally {
      this.undoBusy = false;
      this.updateUndoButton();
    }
  }

  /**
   * The part of `item` whose target still shows what the entry left there
   * (undo: its "after"; redo: its "before"), or null when none does.
   */
  private async prepareUndo(item: UndoItem, dir: UndoDirection): Promise<UndoItem | null> {
    const store = this.plugin.mapStore;
    const keep = <E>(parts: E[], current: (p: E) => unknown, before: (p: E) => unknown, after: (p: E) => unknown) =>
      stillCurrent(parts, dir, current, before, after);
    switch (item.kind) {
      case "terrain": {
        const entries = keep(item.entries, (e) => getTerrainFromFile(this.app, e.path), (e) => e.oldTerrain, (e) => e.newTerrain);
        return entries ? { ...item, entries } : null;
      }
      case "icon": {
        const list = (l: string[] | undefined, one: string | null) => l ?? (one !== null ? [one] : []);
        const entries = keep(
          item.entries,
          (e) => (e.isGm ? getGmIconsFromFile(this.app, e.path) : getIconOverrideFromFile(this.app, e.path)),
          (e) => (e.isGm ? list(e.oldGmList, e.oldIcon) : e.oldIcon),
          (e) => (e.isGm ? list(e.newGmList, e.newIcon) : e.newIcon),
        );
        return entries ? { ...item, entries } : null;
      }
      case "faction": {
        const entries = keep(item.entries, (e) => this.getFactionLinksFromCache(e.hexPath).includes(e.factionBasename), (e) => e.wasPresent, (e) => !e.wasPresent);
        return entries ? { ...item, entries } : null;
      }
      case "region": {
        const entries = keep(item.entries, (e) => getHexRegionFromFile(this.app, e.hexPath), (e) => e.oldRegion, (e) => e.newRegion);
        return entries ? { ...item, entries } : null;
      }
      case "subhex": {
        const entries = keep(item.entries, (e) => store.get(e.map, e.key)?.terrain ?? null, (e) => e.oldTerrain, (e) => e.newTerrain);
        return entries ? { ...item, entries } : null;
      }
      case "swap": {
        if (!item.after) return item;
        const now = [store.get(this.activeMapName, `${item.x1}_${item.y1}`) ?? null, store.get(this.activeMapName, `${item.x2}_${item.y2}`) ?? null];
        // A swap is its own inverse: before it, the two hexes held each other's data.
        const want = dir === "undo" ? item.after : [item.after[1], item.after[0]];
        return sameValue(now, want) ? item : null;
      }
      case "path": {
        const want = dir === "undo" ? item.after : item.before;
        return sameValue(store.paths(item.mapName), want) ? item : null;
      }
      case "calibrate": {
        const map = this.plugin.getMap(item.mapName);
        if (!map) return null;
        return sameValue(this.captureCalibration(map), dir === "undo" ? item.after : item.before) ? item : null;
      }
      case "cells": {
        const edits = currentCellEdits(item.edits, dir, (m, k) => store.get(m, k) as Record<string, unknown> | undefined);
        return edits ? { ...item, edits } : null;
      }
      case "projection":
        return prepareProjectionUndo(this.plugin, item, dir);
      case "token": {
        const now = await readTokenPlace(this.app, item.path);
        const want = dir === "undo" ? item.after : item.before;
        const place = (t: TokenSnap | null) => (t ? { hex: t.hex, map: t.map } : null);
        return sameValue(now, place(want)) ? item : null;
      }
    }
  }

  /** Apply a prepared entry (undo: back to "before"; redo: to "after"). */
  private async applyUndo(item: UndoItem, dir: UndoDirection): Promise<void> {
    const which = dir === "undo" ? "old" : "new";
    if (item.kind === "terrain") {
      if (dir === "undo") {
        this.strokePins = null;
        this.applyStroke(item.entries, "old");
        // Once the old terrain is back, the anchors the stroke pinned go too.
        if (item.pins?.length) {
          const pins = item.pins;
          await this.terrainWritesSettled();
          this.plugin.pathPins.rerouteInstead(pins);
        }
      } else {
        // Repainting pins the routes again (and they're recorded afresh).
        item.pins = [];
        this.strokePins = item.pins;
        this.applyStroke(item.entries, "new");
        void this.releaseStrokePins(item.pins);
      }
    } else if (item.kind === "icon") {
      await this.applyIconStroke(item.entries, which);
    } else if (item.kind === "faction") {
      await this.applyFactionStroke(item.entries, which);
    } else if (item.kind === "region") {
      await this.applyRegionStroke(item.entries, which);
    } else if (item.kind === "subhex") {
      this.applySubStroke(item.entries, which);
    } else if (item.kind === "swap") {
      await this.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else if (item.kind === "calibrate") {
      await this.applyCalibrationSnapshot(item.mapName, dir === "undo" ? item.before : item.after);
    } else if (item.kind === "path") {
      await this.applyPathSnapshot(item.mapName, dir === "undo" ? item.before : item.after);
    } else if (item.kind === "cells") {
      for (const e of item.edits) this.plugin.mapStore.set(e.map, e.key, cellPatch(e, dir));
      this.renderGrid();
    } else if (item.kind === "projection") {
      applyProjectionUndo(this.plugin, item, dir);
      void this.plugin.saveSettings();
      this.renderGrid();
      this.updateModeBar();
    } else {
      await this.applyTokenSnap(item.path, dir === "undo" ? item.before : item.after);
    }
  }

  /** Put a token where a snapshot says (null: it stops being a token). */
  private async applyTokenSnap(path: string, snap: TokenSnap | null): Promise<void> {
    if (!snap) await removeTokenFrontmatter(this.app, path);
    else await applyTokenFrontmatter(this.app, path, { ...(snap.look ?? {}), hex: snap.hex, map: snap.map, visible: snap.visible ?? true });
    this.updateTokenLayer();
  }

  /** Record a token change for undo (from a token's data before and after). */
  private pushTokenUndo(path: string, mapName: string, before: TokenSnap | null, after: TokenSnap | null): void {
    if (sameValue(before, after)) return;
    this.pushUndo({ kind: "token", path, before, after }, mapName);
  }

  private applyPathSnapshot(mapName: string, paths: MapPath[]): Promise<void> {
    if (!this.plugin.getMap(mapName)) return Promise.resolve();
    this.pathTool.applySnapshot(mapName, paths);
    return Promise.resolve();
  }

  /** Wait (briefly) until every queued terrain write has landed in the map store. */
  private async terrainWritesSettled(): Promise<void> {
    const busy = () => this.pendingTerrainWrites.size > 0 || [...this.flushing].some((k) => k.startsWith("t:"));
    for (let i = 0; i < 100 && busy(); i++) await new Promise<void>((r) => window.setTimeout(r, 50));
  }

  /** Stop collecting pins into `pins` once the stroke's writes have landed. */
  private async releaseStrokePins(pins: PinRecord[]): Promise<void> {
    await this.terrainWritesSettled();
    if (this.strokePins === pins) this.strokePins = null;
  }

  private applyStroke(stroke: TerrainUndoEntry[], which: "old" | "new"): void {
    for (const entry of stroke) {
      const terrain = which === "old" ? entry.oldTerrain : entry.newTerrain;
      try {
        const hexEl = this.viewportEl?.querySelector<HTMLElement>(
          `[data-x="${entry.x}"][data-y="${entry.y}"]`,
        );
        if (hexEl) this.applyTerrainToHexEl(hexEl, terrain);
      } catch (err) {
        console.warn(
          `[hexmaker] stroke visual update failed for ${entry.path}:`,
          err,
        );
      }
      try {
        this.scheduleTerrainWrite(entry.x, entry.y, entry.path, terrain);
      } catch (err) {
        console.warn(
          `[hexmaker] stroke write scheduling failed for ${entry.path}:`,
          err,
        );
      }
    }
  }

  private async applyIconStroke(entries: IconUndoEntry[], which: "old" | "new"): Promise<void> {
    for (const entry of entries) {
      const icon = which === "old" ? entry.oldIcon : entry.newIcon;
      const hexEl = this.viewportEl?.querySelector<HTMLElement>(
        `[data-x="${entry.x}"][data-y="${entry.y}"]`,
      );
      if (entry.isGm) {
        // Prefer the full list snapshot (recorded by the multi-add
        // painter); fall back to a single-icon list for stroke entries
        // recorded by older paint paths that only knew about one icon.
        const list = which === "old"
          ? (entry.oldGmList ?? (entry.oldIcon !== null ? [entry.oldIcon] : []))
          : (entry.newGmList ?? (entry.newIcon !== null ? [entry.newIcon] : []));
        if (hexEl) {
          if (list.length > 0) hexEl.dataset.gmIcons = JSON.stringify(list);
          else delete hexEl.dataset.gmIcons;
        }
        this.scheduleGmIconsListWrite(entry.x, entry.y, entry.path, list);
      } else {
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
            // Restore the terrain icon that the override was hiding
            const terrain = getTerrainFromFile(this.app, entry.path);
            this.applyTerrainToHexEl(hexEl, terrain);
          }
        }
        this.scheduleIconWrite(entry.x, entry.y, entry.path, icon);
      }
    }
    if (entries.some((e) => e.isGm)) this.updateGmIcons();
    this.updatePathOverlay();
  }

  private async applyFactionStroke(entries: FactionUndoEntry[], which: "old" | "new"): Promise<void> {
    for (const entry of entries) {
      const shouldBePresent = which === "old" ? entry.wasPresent : !entry.wasPresent;
      const factionFile = this.app.vault.getAbstractFileByPath(entry.factionFilePath);
      if (!(factionFile instanceof TFile)) continue;
      const target = this.app.metadataCache.fileToLinktext(factionFile, entry.hexPath);
      if (shouldBePresent) {
        this.erasedFactionLinks.get(entry.hexPath)?.delete(entry.factionBasename);
        const pending = this.pendingFactionLinks.get(entry.hexPath) ?? new Set<string>();
        pending.add(entry.factionBasename);
        this.pendingFactionLinks.set(entry.hexPath, pending);
        await addLinkToSection(this.app, entry.hexPath, "Factions", `[[${target}]]`);
      } else {
        this.pendingFactionLinks.get(entry.hexPath)?.delete(entry.factionBasename);
        const erased = this.erasedFactionLinks.get(entry.hexPath) ?? new Set<string>();
        erased.add(entry.factionBasename);
        this.erasedFactionLinks.set(entry.hexPath, erased);
        await removeLinkFromSection(this.app, entry.hexPath, "Factions", target);
      }
    }
    if (this.getActiveMap().showFactionOverlay) this.updateFactionOverlay();
  }

  private async applyRegionStroke(entries: RegionUndoEntry[], which: "old" | "new"): Promise<void> {
    for (const entry of entries) {
      const region = which === "old" ? entry.oldRegion : entry.newRegion;
      if (region) {
        this.erasedRegions.delete(entry.hexPath);
        this.pendingRegions.set(entry.hexPath, region);
      } else {
        this.pendingRegions.delete(entry.hexPath);
        this.erasedRegions.add(entry.hexPath);
      }
      await setHexRegionInFile(this.app, entry.hexPath, region);
      void this.plugin.syncHexRegionTableLink(entry.hexPath, region);
    }
    if (this.getActiveMap().showRegionOverlay) this.updateRegionOverlay();
  }

  private updateUndoButton(): void {
    // The buttons act on this map's queue for its current mode, and say so.
    const mode = this.currentWorkMode();
    const label = WORK_MODE_TEXT[mode].label;
    const book = this.plugin.undoBook;
    if (this.undoBtn) {
      this.undoBtn.disabled = !book.canUndo(this.activeMapName, mode);
      this.undoBtn.setAttr("title", `Undo (${label} mode, up to ${UNDO_DEPTH})`);
    }
    if (this.redoBtn) {
      this.redoBtn.disabled = !book.canRedo(this.activeMapName, mode);
      this.redoBtn.setAttr("title", `Redo (${label} mode)`);
    }
  }

  private updateSavingIndicator(): void {
    const count =
      this.pendingTerrainWrites.size +
      this.pendingIconWrites.size +
      this.pendingGmIconWrites.size +
      this.flushing.size;
    if (this.savingIndicatorEl) {
      if (count > 0) {
        this.savingIndicatorEl.setText(`${count} updates remaining`);
        this.savingIndicatorEl.addClass("is-active");
      } else {
        this.savingIndicatorEl.removeClass("is-active");
      }
    }
  }

  private scheduleTerrainWrite(
    x: number,
    y: number,
    path: string,
    terrain: string | null,
  ): void {
    this.pendingTerrainWrites.set(path, { x, y, terrain });
    this.updateSavingIndicator();
    if (!this.flushing.has(`t:${path}`)) void this.flushTerrainWrites(path);
  }

  private async flushTerrainWrites(path: string): Promise<void> {
    const key = `t:${path}`;
    this.flushing.add(key);
    this.updateSavingIndicator();
    try {
      while (this.pendingTerrainWrites.has(path)) {
        const { x, y, terrain } = this.pendingTerrainWrites.get(path)!;
        this.pendingTerrainWrites.delete(path);
        let attempt = 0;
        while (true) {
          if (attempt > 0)
            await new Promise<void>((r) =>
              window.setTimeout(r, Math.min(200 * (1 << (attempt - 1)), 2000)),
            );
          try {
            // Map data lives in the map note once the store is ready, so
            // painting never needs (or creates) a hex note.
            const onDisk = this.plugin.mapStore.isReady() || !!this.app.vault.getAbstractFileByPath(path);
            if (terrain === null) {
              if (onDisk) {
                await setTerrainInFile(this.app, path, null);
                void this.plugin.syncHexEncounterTableLink(path, null);
              }
            } else {
              if (!onDisk) {
                if (
                  !(await this.plugin.createHexNote(
                    x,
                    y,
                    this.activeMapName,
                  ))
                ) {
                  this.renderGrid();
                  return;
                }
                this.viewportEl
                  ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
                  ?.addClass("duckmage-hex-exists");
              }
              await setTerrainInFile(this.app, path, terrain);
              void this.plugin.syncHexEncounterTableLink(path, terrain);
            }
            break; // success
          } catch (err) {
            attempt++;
            console.warn(
              `[duckmage] terrain write attempt ${attempt} failed for ${path}:`,
              err,
            );
          }
        }
      }
    } finally {
      this.flushing.delete(key);
      this.updateSavingIndicator();
    }
  }

  private scheduleIconWrite(
    x: number,
    y: number,
    path: string,
    icon: string | null,
  ): void {
    this.pendingIconWrites.set(path, { x, y, icon });
    this.updateSavingIndicator();
    if (!this.flushing.has(`i:${path}`)) void this.flushIconWrites(path);
  }

  private async flushIconWrites(path: string): Promise<void> {
    const key = `i:${path}`;
    this.flushing.add(key);
    this.updateSavingIndicator();
    try {
      while (this.pendingIconWrites.has(path)) {
        const { x, y, icon } = this.pendingIconWrites.get(path)!;
        this.pendingIconWrites.delete(path);
        let attempt = 0;
        while (true) {
          if (attempt > 0)
            await new Promise<void>((r) =>
              window.setTimeout(r, Math.min(200 * (1 << (attempt - 1)), 2000)),
            );
          try {
            // Map data lives in the map note once the store is ready, so
            // painting never needs (or creates) a hex note.
            const onDisk = this.plugin.mapStore.isReady() || !!this.app.vault.getAbstractFileByPath(path);
            if (icon === null) {
              if (onDisk) await setIconOverrideInFile(this.app, path, null);
            } else {
              if (!onDisk) {
                if (
                  !(await this.plugin.createHexNote(
                    x,
                    y,
                    this.activeMapName,
                  ))
                ) {
                  this.renderGrid();
                  return;
                }
                this.viewportEl
                  ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
                  ?.addClass("duckmage-hex-exists");
              }
              await setIconOverrideInFile(this.app, path, icon);
            }
            break; // success
          } catch (err) {
            attempt++;
            console.warn(
              `[duckmage] icon write attempt ${attempt} failed for ${path}:`,
              err,
            );
          }
        }
      }
    } finally {
      this.flushing.delete(key);
      this.updateSavingIndicator();
    }
  }

  /**
   * Queue a write of the full GM-icon list for a hex (multi-add per
   * hexmaker#28). Coalesces rapid mutations on the same hex into a
   * single flush — only the latest list is persisted. Empty list
   * clears all GM icons on the hex.
   */
  private scheduleGmIconsListWrite(
    x: number,
    y: number,
    path: string,
    list: string[],
  ): void {
    this.pendingGmIconWrites.set(path, { x, y, list: [...list] });
    this.updateSavingIndicator();
    if (!this.flushing.has(`g:${path}`)) void this.flushGmIconWrites(path);
  }

  private async flushGmIconWrites(path: string): Promise<void> {
    const key = `g:${path}`;
    this.flushing.add(key);
    this.updateSavingIndicator();
    try {
      while (this.pendingGmIconWrites.has(path)) {
        const { x, y, list } = this.pendingGmIconWrites.get(path)!;
        this.pendingGmIconWrites.delete(path);
        let attempt = 0;
        while (true) {
          if (attempt > 0)
            await new Promise<void>((r) =>
              window.setTimeout(r, Math.min(200 * (1 << (attempt - 1)), 2000)),
            );
          try {
            // Map data lives in the map note once the store is ready, so
            // painting never needs (or creates) a hex note.
            const onDisk = this.plugin.mapStore.isReady() || !!this.app.vault.getAbstractFileByPath(path);
            if (list.length === 0) {
              if (onDisk) await setGmIconsInFile(this.app, path, []);
            } else {
              if (!onDisk) {
                if (
                  !(await this.plugin.createHexNote(
                    x,
                    y,
                    this.activeMapName,
                  ))
                ) {
                  this.renderGrid();
                  return;
                }
                this.viewportEl
                  ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
                  ?.addClass("duckmage-hex-exists");
              }
              await setGmIconsInFile(this.app, path, list);
            }
            break; // success
          } catch (err) {
            attempt++;
            console.warn(
              `[duckmage] gm-icon write attempt ${attempt} failed for ${path}:`,
              err,
            );
          }
        }
      }
    } finally {
      this.flushing.delete(key);
      this.updateSavingIndicator();
    }
  }

  /**
   * Open the path-type picker. Clicking the Path button while drawing reopens
   * it (like Terrain) instead of silently turning the tool off (fresh-eyes
   * T7); leave the tool with right-click → Exit tool, Esc, or the mode bar.
   */
  private handlePathButton(): void {
    if (this.drawingMode !== "path" && !this.modeAllows(TOOL_ACTIONS.path)) return;
    new PathPickerModal(
      this.app,
      this.plugin,
      this.plugin.mapPaletteName(this.activeMapName),
      this.pathTool.typeName,
      (typeName) => {
        this.leaveOtherToolFor("path");
        // A new type ends the branch being drawn; re-picking the type keeps it going.
        if (this.drawingMode !== "path") this.exitPathMode();
        this.pathTool.setType(typeName);
        this.drawingMode = "path";
        this.isErasingMode = false;
        this.updateToolbarButtonStates();
        this.updatePathOverlay();
      },
      () => {
        if (this.drawingMode !== "path") this.updateToolbarButtonStates();
      },
      () => {
        this.drawingMode = "path";
        this.isErasingMode = true;
        this.updateToolbarButtonStates();
        this.updatePathOverlay();
      },
      {
        value: this.pathTool.autoRoute,
        onChange: (on) => this.pathTool.setAutoRoute(on),
        noImpassable: impassableNames(this.plugin.getMapPalette(this.activeMapName)).length === 0,
      },
      {
        list: (() => {
          // Ends, forks and size from the resolved routes (#48), so similar
          // names (Road 2 … Road 6) can be told apart. Names stay the user's.
          const resolved = this.plugin.paths.resolved(this.activeMapName);
          const types = this.plugin.getMapPathTypes(this.activeMapName).map((t) => t.name);
          return this.plugin.mapStore.paths(this.activeMapName).map((p) => ({ name: p.name, typeName: p.typeName, summary: pathListSummary(p, resolved, types) }));
        })(),
        selected: this.pathTool.selected,
        onPick: (name) => {
          this.leaveOtherToolFor("path");
          this.drawingMode = "path";
          this.isErasingMode = false;
          this.pathTool.selectPath(name);
          // Show it: the list is for paths that are hard to find on the map.
          const first = this.plugin.mapStore.paths(this.activeMapName).find((q) => q.name === name)?.branches[0]?.anchors[0];
          if (first) { const [hx, hy] = first.split("_").map(Number); this.centerOnHex(hx, hy); }
          this.updateToolbarButtonStates();
          this.updatePathOverlay();
        },
      },
    ).open();
  }

  /** The path tool's controls in the mode bar (src/hex-map/pathTool.ts). */
  private renderRouteControls(): void {
    const el = this.modeBarRouteEl;
    if (!el) return;
    el.empty();
    const show = this.drawingMode === "path" && !this.isErasingMode;
    el.toggle(show);
    if (show) this.pathTool.renderBarControls(el);
    // An overworld's selected path: confirm it into its regions from the bar too.
    const selected = show ? this.pathTool.labelState().selected : null;
    const confirm = this.overworldPathItems(selected)[0];
    if (confirm) {
      const btn = el.createEl("button", {
        text: confirm.label,
        cls: "duckmage-mode-bar-route-toggle duckmage-path-confirm-btn",
        attr: { title: "Put this path into every region it crosses, joined at the seams (one undo step)." },
      });
      btn.addEventListener("click", confirm.onClick);
    }
  }

  /**
   * An overworld path's region actions (path menu, mode bar): "Confirm into
   * regions" for a draft, "Update regions" + "Remove from regions" for a
   * confirmed one. None on other maps, or when the mode doesn't allow it.
   */
  private overworldPathItems(pathName: string | null): { label: string; onClick: () => void }[] {
    const mapName = this.activeMapName;
    if (!pathName || !isPathOverworld(this.plugin, mapName) || !canDo(mapName, "edit-path")) return [];
    const p = this.plugin.mapStore.paths(mapName).find((q) => q.name === pathName);
    if (!p) return [];
    const run = (remove: boolean) => () => void this.runPathProjection(pathName, remove);
    return isApplied(p)
      ? [{ label: "Update regions", onClick: run(false) }, { label: "Remove from regions", onClick: run(true) }]
      : [{ label: "Confirm into regions", onClick: run(false) }];
  }

  /** Confirm (or remove) an overworld path into its regions, and say what happened. */
  async runPathProjection(pathName: string, remove: boolean): Promise<void> {
    const mapName = this.activeMapName;
    const res = remove ? await removeOverworldPath(this.plugin, mapName, pathName) : await confirmOverworldPath(this.plugin, mapName, pathName);
    if ("error" in res) {
      new Notice(res.error);
      return;
    }
    const n = res.regions.length;
    const where = n === 1 ? "1 region" : `${n} regions`;
    const msg = remove ? `${pathName}: taken out of ${where}.` : `${pathName}: ${n ? `in ${where}` : "crosses no regions yet"}.`;
    const skipped = res.skipped.length ? ` ${res.skipped.length} still loading: confirm again in a moment.` : "";
    new Notice(msg + skipped);
    this.updateUndoButton();
    this.renderGrid();
    this.updateModeBar();
  }

  private pushPathUndo(mapName: string, before: MapPath[], after: MapPath[]): void {
    // A confirmed overworld path that was just reshaped, retyped or renamed
    // is a draft again until it's confirmed into its regions once more.
    const drafted = draftsAfterEdit(before, after);
    if (drafted !== after) {
      this.plugin.mapStore.setPaths(mapName, drafted);
      after = drafted;
    }
    this.pushUndo({ kind: "path", mapName, before, after }, mapName);
    this.updateUndoButton();
  }

  /**
   * A pointer position in the path layer's lattice units (for hit-testing
   * paths): one read of the grid's box and font size per event, no writes,
   * inverted through the layer's calibration. Null before it's calibrated.
   */
  private pointerLattice(e: { clientX: number; clientY: number }): { cx: number; cy: number } | null {
    const calib = this.pathCalib;
    const grid = calib?.grid;
    if (!calib || !grid || !grid.isConnected) return null;
    const style = getComputedStyle(grid);
    const em = parseFloat(style.fontSize) || 16;
    const g = grid.getBoundingClientRect();
    const layoutW = parseFloat(style.width) || grid.offsetWidth;
    const layoutH = parseFloat(style.height) || grid.offsetHeight;
    const sx = layoutW ? g.width / layoutW : 1;
    const sy = layoutH ? g.height / layoutH : 1;
    const ex = (e.clientX - g.left) / sx / em;
    const ey = (e.clientY - g.top) / sy / em;
    const a = calib.affine;
    return { cx: (ex - a.tx) / a.sx, cy: (ey - a.ty) / a.sy };
  }

  /**
   * The path layer's calibration (lattice → em for this grid) and what it
   * was last drawn with. Measured once per grid (renderGrid rebuilds the
   * grid); in em, so zoom bakes need no rebuild.
   */
  private pathCalib: PathLayerCalibration | null = null;
  private pathLayerKey = "";

  /**
   * Measure the grid once for the path layer: three hexes (the origin, the
   * far end of its row, the far end of its column), all reads, no writes.
   * Their centres fix the affine from lattice units to em in the grid's own
   * frame, which absorbs the CSS gap and any calibrated grid transform.
   */
  private calibratePathLayer(gridContainer: HTMLElement, region: MapData): PathLayerCalibration | null {
    if (this.pathCalib?.grid === gridContainer) return this.pathCalib;
    const { x: ox, y: oy } = region.gridOffset;
    const { cols, rows } = region.gridSize;
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const lattice: LatticeGrid = { orientation: this.plugin.settings.hexOrientation, stagger: this.getActiveStagger() };
    const hexAt = (x: number, y: number) => gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    const origin = hexAt(ox, oy);
    if (!origin) return null;
    const style = getComputedStyle(gridContainer);
    const em = parseFloat(style.fontSize) || 16;
    const g = gridContainer.getBoundingClientRect();
    // Client px → the grid's own px (the viewport zoom and grid transforms
    // scale both); the computed width is fractional, unlike offsetWidth.
    const layoutW = parseFloat(style.width) || gridContainer.offsetWidth;
    const layoutH = parseFloat(style.height) || gridContainer.offsetHeight;
    const sx = layoutW ? g.width / layoutW : 1;
    const sy = layoutH ? g.height / layoutH : 1;
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - g.left) / sx / em, y: (r.top + r.height / 2 - g.top) / sy / em, w: r.width / sx / em, h: r.height / sy / em };
    };
    const A = centre(origin);
    if (!A.w || !A.h) return null;
    const farX = cols > 1 ? hexAt(ox + cols - 1, oy) : null;
    const farY = rows > 1 ? hexAt(ox, oy + rows - 1) : null;
    const hexRadius = isFlat ? A.w / 2 : A.h / 2;
    const affine = calibrateAffine(
      { key: `${ox}_${oy}`, at: A },
      farX ? { key: `${ox + cols - 1}_${oy}`, at: centre(farX) } : null,
      farY ? { key: `${ox}_${oy + rows - 1}`, at: centre(farY) } : null,
      lattice,
      hexRadius,
    );
    this.pathCalib = { grid: gridContainer, lattice, affine, hexRadius, hexW: A.w, hexH: A.h };
    this.pathLayerKey = "";
    return this.pathCalib;
  }

  /**
   * Paths of the open map: resolved by the plugin's paths service (nothing
   * until the map's terrain and palette are loaded), turned into lattice
   * polylines (src/paths/pathGeometry.ts, the same ones the PNG export
   * draws), placed in em. One `<path data-path data-branch>` per branch.
   * Stroke widths scale with the hexes (lattice units × the hex radius), so
   * the map looks the same at every zoom. Rebuilt only when what it draws
   * changes; zoom bakes leave it alone.
   */
  private renderPathOverlay(gridContainer: HTMLElement): void {
    const region = this.getActiveMap();
    // A path edit that starts or ends a seam join redraws the neighbour
    // strip, so its road reaches the shared edge too (round 6 U8).
    const joins = this.currentSeamJoins(region);
    if (this.lastShadow?.map === region.name && seamJoinKey(joins) !== this.shadowJoinKey) {
      this.renderNeighbourShadow(gridContainer, region);
    }

    // ── Reads (one calibration per grid) ──
    const calib = this.calibratePathLayer(gridContainer, region);
    // The same strokes the PNG export draws (plugin.paths.strokes); only
    // the seam stubs are the view's own.
    const strokes = calib
      ? this.plugin.paths.strokes(region.name, {
          seamEnd: (typeName, hex) => joins.find((j) => j.typeName === typeName && j.own === hex)?.other,
        })
      : [];
    const em = (pts: { cx: number; cy: number }[]) =>
      applyAffine(pts, calib!.affine).map((p) => ({ cx: Number(fmt(p.cx)), cy: Number(fmt(p.cy)) }));
    const scale = calib?.hexRadius ?? 0;
    const lines = strokes.map((s) => {
      const pts = em(s.pts);
      return {
        s,
        d: s.smooth ? smoothPath(pts) : sharpPath(pts),
        width: fmt(s.width * scale),
        dash: s.dash.map((d) => fmt(d * scale)).join(" "),
      };
    });
    // Moons tied to their planet (S11): a faint tether across the edge they
    // share, by terrain type (src/hex-map/moonLinks.ts). Under the paths.
    const moonLines: { d: string; width: string; dash: string }[] = [];
    if (calib) {
      const terrain = new Map<string, string>();
      for (const [k, h] of this.plugin.mapStore.all(region.name)) if (h.terrain) terrain.set(k, h.terrain);
      const links = moonPlanetLinks(terrain, this.plugin.getMapPalette(region.name), calib.lattice.orientation, calib.lattice.stagger);
      for (const [moon, planet] of links) {
        const [a, b] = em(tether(latticeCenter(moon, calib.lattice), latticeCenter(planet, calib.lattice)));
        moonLines.push({ d: `M${fmt(a.cx)} ${fmt(a.cy)}L${fmt(b.cx)} ${fmt(b.cy)}`, width: fmt(0.07 * scale), dash: `${fmt(0.1 * scale)} ${fmt(0.08 * scale)}` });
      }
    }
    // The path tool: the selected path highlighted, its anchor handles
    // (ends bigger: continue from there) and the dot where clicks add.
    const tool = calib && this.drawingMode === "path" ? this.pathTool.overlay() : null;
    let dot: { cx: string; cy: string; r: string; sw: string; color: string } | null = null;
    const handles: { cx: string; cy: string; r: string; sw: string; hover: boolean }[] = [];
    if (calib && tool) {
      const activeType = this.mapPathTypes().find((p) => p.name === this.pathTool.currentType());
      if (tool.active) {
        const [c] = em([latticeCenter(tool.active, calib.lattice)]);
        dot = {
          cx: fmt(c.cx),
          cy: fmt(c.cy),
          r: fmt(pxToLattice(END_DOT_PX.r) * scale),
          sw: fmt(pxToLattice(END_DOT_PX.stroke) * scale),
          color: activeType?.color ?? "#888888",
        };
      }
      for (const h of tool.handles) {
        const [c] = em([latticeCenter(h.hex, calib.lattice)]);
        handles.push({
          cx: fmt(c.cx),
          cy: fmt(c.cy),
          r: fmt(pxToLattice(h.end ? HANDLE_PX.end : HANDLE_PX.r) * scale),
          sw: fmt(pxToLattice(HANDLE_PX.stroke) * scale),
          hover: h.hover,
        });
      }
    }
    const selected = tool?.selected ?? null;
    // On an overworld, paths not yet confirmed into their regions are drafts (drawn faded).
    const drafts = draftPathNames(this.plugin, region.name);
    const key = JSON.stringify([lines.map((l) => [l.s.path, l.s.branch, l.d, l.width, l.dash, l.s.color, drafts.has(l.s.path)]), dot, handles, selected, moonLines]);
    const existing = gridContainer.querySelector("svg.duckmage-path-svg");
    const existingHandles = gridContainer.querySelector("svg.duckmage-path-handles-svg");
    const wantLines = lines.length > 0 || moonLines.length > 0;
    const wantHandles = !!dot || handles.length > 0;

    // ── Writes ──
    if (key !== this.pathLayerKey || wantLines !== !!existing || wantHandles !== !!existingHandles) {
      existing?.remove();
      existingHandles?.remove();
      this.pathLayerKey = key;
      const svgNS = "http://www.w3.org/2000/svg";
      // One user unit = 1em of the grid (it overflows for seam stubs).
      const emSvg = (cls: string): SVGSVGElement => {
        const s = activeDocument.createElementNS(svgNS, "svg");
        s.classList.add(cls);
        s.setAttribute("width", "1em");
        s.setAttribute("height", "1em");
        s.setAttribute("viewBox", "0 0 1 1");
        return s;
      };
      if (wantLines) {
        const svg = emSvg("duckmage-path-svg");
        for (const m of moonLines) {
          const tie = activeDocument.createElementNS(svgNS, "path");
          tie.setAttribute("class", "duckmage-svg-path-line duckmage-moon-link");
          tie.setAttribute("d", m.d);
          tie.setAttribute("stroke-width", m.width);
          tie.setAttribute("stroke-dasharray", m.dash);
          tie.setAttribute("stroke-linecap", "round");
          tie.setAttribute("fill", "none");
          svg.appendChild(tie);
        }
        // The selected path's halo, under every line.
        for (const l of lines) {
          if (l.s.path !== selected) continue;
          const halo = activeDocument.createElementNS(svgNS, "path");
          halo.setAttribute("class", "duckmage-svg-path-line duckmage-svg-path-selected");
          halo.setAttribute("d", l.d);
          halo.setAttribute("stroke", l.s.color);
          halo.setAttribute("stroke-width", fmt(Number(l.width) * 2.6));
          halo.setAttribute("stroke-linecap", "round");
          halo.setAttribute("stroke-linejoin", "round");
          halo.setAttribute("fill", "none");
          halo.setAttribute("opacity", "0.3");
          svg.appendChild(halo);
        }
        for (const l of lines) {
          const path = activeDocument.createElementNS(svgNS, "path");
          path.setAttribute("class", drafts.has(l.s.path) ? "duckmage-svg-path-line duckmage-svg-path-draft" : "duckmage-svg-path-line");
          path.setAttribute("d", l.d);
          path.setAttribute("stroke", l.s.color);
          path.setAttribute("stroke-width", l.width);
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("fill", "none");
          if (l.dash) path.setAttribute("stroke-dasharray", l.dash);
          path.setAttribute("data-path", l.s.path);
          path.setAttribute("data-branch", String(l.s.branch));
          svg.appendChild(path);
        }
        // Under the icon layer (elevated and GM icons sit above paths).
        const icons = gridContainer.querySelector("svg.duckmage-path-icons-svg");
        if (icons) gridContainer.insertBefore(svg, icons);
        else gridContainer.appendChild(svg);
      }
      // The tool's handles and active-end dot get their own layer, over
      // the icon layer (terrain, elevated override and GM icons), so a
      // handle is never hidden under an icon (#48). Hit-testing is pure
      // math, so they stay grabbable whatever is drawn over the hex.
      if (wantHandles) {
        const svg = emSvg("duckmage-path-handles-svg");
        for (const h of handles) {
          const handle = activeDocument.createElementNS(svgNS, "circle");
          handle.setAttribute("class", "duckmage-svg-path-line duckmage-svg-path-handle");
          handle.setAttribute("cx", h.cx);
          handle.setAttribute("cy", h.cy);
          handle.setAttribute("r", h.r);
          handle.setAttribute("fill", h.hover ? "#ffd84d" : "white");
          handle.setAttribute("stroke", "#222222");
          handle.setAttribute("stroke-width", h.sw);
          svg.appendChild(handle);
        }
        if (dot) {
          const circle = activeDocument.createElementNS(svgNS, "circle");
          circle.setAttribute("class", "duckmage-svg-path-line");
          circle.setAttribute("cx", dot.cx);
          circle.setAttribute("cy", dot.cy);
          circle.setAttribute("r", dot.r);
          circle.setAttribute("fill", dot.color);
          circle.setAttribute("stroke", "white");
          circle.setAttribute("stroke-width", dot.sw);
          circle.setAttribute("opacity", "0.9");
          svg.appendChild(circle);
        }
        gridContainer.appendChild(svg);
      }
    }
    this.renderPathIconsLayer(gridContainer);
  }

  /** Redraw only the icon layer (after a zoom bake: its sizes are in px). */
  private updatePathIcons(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (gridContainer) this.renderPathIconsLayer(gridContainer);
  }

  /**
   * Override icons elevated above the paths, and GM-layer icons: their own
   * SVG over the path layer, placed from the path layer's calibration (no
   * per-hex layout reads). Rebuilt on zoom bakes (icon and badge sizes are
   * px, as they always were).
   */
  private renderPathIconsLayer(gridContainer: HTMLElement): void {
    gridContainer.querySelector("svg.duckmage-path-icons-svg")?.remove();
    this.viewportEl?.removeClass("duckmage-svg-labels-active");
    // Restore any icons that were hidden when the previous SVG elevated them
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex-icon[data-svg-elevated]")
      .forEach((img) => {
        img.show();
        img.removeAttribute("data-svg-elevated");
      });

    const region = this.getActiveMap();
    const gmLayerActive = region.showGmLayer ?? true;
    const overrides = Array.from(gridContainer.querySelectorAll<HTMLElement>("[data-icon-override]"));
    const gmHexes = gmLayerActive ? Array.from(gridContainer.querySelectorAll<HTMLElement>("[data-gm-icons]")) : [];
    if (!overrides.length && !gmHexes.length) return;
    const calib = this.calibratePathLayer(gridContainer, region);
    if (!calib) return;

    // ── Reads: the font size (em → px) and the layer's size, once ──
    const emPx = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    const svgW = gridContainer.offsetLeft + gridContainer.offsetWidth + 20;
    const svgH = gridContainer.offsetTop + gridContainer.offsetHeight + 20;
    const w = calib.hexW * emPx;
    const h = calib.hexH * emPx;
    const at = (hexEl: HTMLElement) => {
      const [p] = applyAffine([latticeCenter(`${hexEl.dataset.x!}_${hexEl.dataset.y!}`, calib.lattice)], calib.affine);
      return { cx: p.cx * emPx, cy: p.cy * emPx };
    };

    // ── Writes ──
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-path-icons-svg");
    svg.setAttribute("width", String(svgW));
    svg.setAttribute("height", String(svgH));

    // Elevate override icons above roads/rivers by rendering them inside the SVG.
    for (const hexEl of overrides) {
      const iconName = hexEl.dataset.iconOverride!;
      const pos = at(hexEl);
      const origImg = hexEl.querySelector<HTMLElement>(".duckmage-hex-icon");
      if (origImg) {
        origImg.hide();
        origImg.setAttribute("data-svg-elevated", "1");
      }
      const imgEl = activeDocument.createElementNS(svgNS, "image");
      const iconW = w * 0.78;
      const iconH = h * 0.78;
      imgEl.setAttribute("x", String(pos.cx - iconW / 2));
      imgEl.setAttribute("y", String(pos.cy - iconH / 2));
      imgEl.setAttribute("width", String(iconW));
      imgEl.setAttribute("height", String(iconH));
      imgEl.setAttribute("href", getIconUrl(this.plugin, iconName));
      imgEl.setAttribute("opacity", "0.75");
      imgEl.setAttribute("class", "duckmage-svg-icon-override");
      svg.appendChild(imgEl);
    }

    // NOTE: coord labels are NO LONGER rendered in the SVG. The SVG
    // copies were a stable source of "label drift on zoom" — the SVG's
    // pixel positions are computed against pre-bake hex sizes, so any
    // paint frame between the bake's font-size change and the SVG
    // rebuild shows labels visibly stranded relative to the now-bigger
    // hexes. The HTML labels in `.duckmage-coord-labels-layer` are placed
    // at a % of the grid, so they track the hex layout across font-size
    // changes, and we rely on those instead. Trade-off: a path
    // or GM icon drawn through a hex can visually obscure that hex's
    // coord label. Acceptable cost vs. the slip — see
    // dev/coord-slip-validator.html for the regression test.

    // GM layer icons — additive badges, terrain icon untouched.
    // hexmaker#28: a hex can carry MULTIPLE GM icons (with duplicates
    // representing a count of that icon). Each unique icon takes one
    // slot from the GM_ICON_HEX_SUBGRID, filled in reading order so the
    // FIRST added icon lands top-left and additions flow right then
    // down. Up to 7 unique icons display; further additions are kept
    // in frontmatter but don't render. A "×N" badge appears on a slot
    // when its icon was added 2+ times.
    for (const hexEl of gmHexes) {
      const list = this.parseGmIconsDataset(hexEl.dataset.gmIcons);
      if (list.length === 0) continue;
      const pos = at(hexEl);

      // Count occurrences per icon, preserving first-seen order.
      const counts = new Map<string, number>();
      for (const ic of list) counts.set(ic, (counts.get(ic) ?? 0) + 1);
      const slots = Array.from(counts.entries()).slice(0, GM_ICON_HEX_SUBGRID.length);
      const slotCount = slots.length;

      // Spread = half the hex's short dimension so the sub-grid fits
      // comfortably inside the parent hex's bounds.
      const spread = Math.min(w, h) * 0.42;
      // Icon size shrinks as the sub-grid fills so neighbouring icons
      // don't overlap. Single-icon hexes keep ~legacy size.
      const sizeFactor = slotCount === 1 ? 0.40
        : slotCount <= 2 ? 0.30
        : slotCount <= 4 ? 0.26
        : 0.22;
      const size = Math.round(w * sizeFactor);

      slots.forEach(([iconName, count], slotIdx) => {
        const [odx, ody] = GM_ICON_HEX_SUBGRID[slotIdx];
        // Icons are positioned by top-left corner; subtract half the
        // size so the icon CENTER lands on the sub-grid slot.
        const ix = pos.cx + odx * spread - size / 2;
        const iy = pos.cy + ody * spread - size / 2;
        const imgEl = activeDocument.createElementNS(svgNS, "image");
        imgEl.setAttribute("x", String(ix));
        imgEl.setAttribute("y", String(iy));
        imgEl.setAttribute("width", String(size));
        imgEl.setAttribute("height", String(size));
        imgEl.setAttribute("href", getIconUrl(this.plugin, iconName));
        imgEl.setAttribute("class", "duckmage-svg-gm-icon");
        svg.appendChild(imgEl);

        if (count > 1) {
          // Badge sits at the bottom-right corner of the icon glyph,
          // tucked inside the icon's bounding box so it tracks the
          // icon even at small sizes.
          const badgeEl = activeDocument.createElementNS(svgNS, "text");
          badgeEl.setAttribute("x", String(ix + size));
          badgeEl.setAttribute("y", String(iy + size));
          badgeEl.setAttribute("text-anchor", "end");
          badgeEl.setAttribute("dominant-baseline", "alphabetic");
          badgeEl.setAttribute("class", "duckmage-svg-gm-icon-count");
          badgeEl.textContent = `×${count}`;
          svg.appendChild(badgeEl);
        }
      });
    }

    this.viewportEl?.addClass("duckmage-svg-labels-active");
    gridContainer.appendChild(svg);
  }

  // Coord labels render in a sibling layer of the path/faction SVGs
  // (CSS z-index: 10 vs path z:5, faction z:4, region z:3) so they sit
  // above every overlay — paths, GM icons, faction tint, region tint.
  // Each label is positioned by percentage of gridContainer dimensions
  // so it auto-rescales through bake-zoom font-size mutations without
  // needing rebuild. Same pattern used for region labels.
  private renderCoordLabelsLayer(gridContainer: HTMLElement): void {
    gridContainer
      .querySelector(".duckmage-coord-labels-layer")
      ?.remove();
    this.coordLabels.clear();
    const gw = gridContainer.offsetWidth || 1;
    const gh = gridContainer.offsetHeight || 1;
    this.coordGridSize = { w: gw, h: gh };

    // CRITICAL: read every hex's offset geometry FIRST, into a plain array,
    // before creating any label DOM. Interleaving offset reads with DOM writes
    // forces a full synchronous layout per hex — O(n²) layout thrash that
    // stalled opening large maps for ~20s at chult's 3843 hexes (see
    // dev/coord-label-thrash-bench).
    const placements: { key: string; ox: number; oy: number }[] = [];
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hexEl) => {
        // Hex center in gridContainer-local pixel coords (unaffected by
        // CSS transform; offsetParent walks stop at gridContainer).
        let ox = hexEl.offsetWidth / 2;
        let oy = hexEl.offsetHeight / 2;
        let cur: HTMLElement | null = hexEl;
        while (cur && cur !== gridContainer) {
          ox += cur.offsetLeft;
          oy += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        placements.push({ key: `${hexEl.dataset.x},${hexEl.dataset.y}`, ox, oy });
      });
    this.coordPlacements = placements;

    gridContainer.createDiv({ cls: "duckmage-coord-labels-layer" });
    this.syncCoordLabels();
  }

  /**
   * While the viewport moves it is a composited layer (`is-moving` →
   * will-change: transform), so pan/zoom frames only re-composite. Once it
   * settles the class comes off, which makes Chromium re-raster at the
   * current zoom: a promoted layer is otherwise only rastered at the scale
   * it was promoted at, so zooming in over a bg image (where zoom is never
   * baked into font-size) left hexes and labels soft and jagged.
   */
  private onViewportMoved(): void {
    this.viewportEl?.addClass("is-moving");
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.viewportEl?.removeClass("is-moving");
      this.syncCoordLabels();
    }, 150);
  }

  /**
   * Create labels for hexes inside the visible area (plus a margin) and drop
   * the rest. Text is the most expensive thing on the map — a label for all
   * 3843 chult hexes cost ~170 ms of every renderGrid — and when zoomed out
   * far enough to see a big map the labels are a few pixels tall, so below
   * MIN_LABEL_PX none are drawn. Labels sit at a % of the grid, so they
   * track font-size zoom bakes without a rebuild.
   */
  private syncCoordLabels(): void {
    const MIN_LABEL_PX = 5;
    const layer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-coord-labels-layer");
    const grid = layer?.parentElement;
    const clip = this.viewportEl?.parentElement;
    if (!layer || !grid || !clip) return;

    // Reads first (one layout flush), then writes. Measure the grid, not the
    // layer: the layer covers it exactly but is display:none while
    // coordinates are hidden, and labels must be ready when they're shown.
    const rect = grid.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    const { w: gw, h: gh } = this.coordGridSize;
    const sx = rect.width / gw;
    const sy = rect.height / gh;
    const labelPx =
      parseFloat(getComputedStyle(layer).fontSize) *
      (this.plugin.settings.coordFontSize ?? 0.8) *
      Math.min(sx, sy);

    const wanted = new Set<string>();
    if (sx > 0 && sy > 0 && labelPx >= MIN_LABEL_PX) {
      const mx = clipRect.width * 0.25;
      const my = clipRect.height * 0.25;
      const x0 = (clipRect.left - mx - rect.left) / sx;
      const x1 = (clipRect.right + mx - rect.left) / sx;
      const y0 = (clipRect.top - my - rect.top) / sy;
      const y1 = (clipRect.bottom + my - rect.top) / sy;
      for (const p of this.coordPlacements) {
        if (p.ox >= x0 && p.ox <= x1 && p.oy >= y0 && p.oy <= y1) wanted.add(p.key);
      }
    }

    for (const [key, el] of this.coordLabels) {
      if (!wanted.has(key)) {
        el.remove();
        this.coordLabels.delete(key);
      }
    }
    for (const p of this.coordPlacements) {
      if (!wanted.has(p.key) || this.coordLabels.has(p.key)) continue;
      const label = layer.createDiv({ cls: "duckmage-coord-label-html", text: p.key });
      label.setCssProps({
        "--duckmage-coord-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
        "--duckmage-coord-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
      });
      this.coordLabels.set(p.key, label);
    }
  }

  // ── Link badges + terrain legend (see linkBadges.ts / terrainLegend.ts) ──

  /**
   * Corner badges for the hex notes of this map that link towns, dungeons,
   * features, quests or factions. Reads only the metadata cache of the map's
   * existing notes and positions from `coordPlacements` (no layout reads);
   * the layers menu hides them by CSS class.
   */
  private renderLinkBadges(gridContainer: HTMLElement): void {
    const sections = new Map<string, BadgeSection[]>();
    const folder = this.app.vault.getAbstractFileByPath(this.plugin.mapStore.mapFolder(this.activeMapName));
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const key = hexKeyFromBasename(child.basename);
        if (!key) continue;
        const found = linkSectionsFromCache(this.app.metadataCache.getFileCache(child));
        if (found.length) sections.set(key, found);
      }
    }
    this.badgeSectionsByHex = sections;
    const map = this.getActiveMap();
    renderLinkBadgeLayer(gridContainer, this.coordPlacements, this.coordGridSize, sections, badgeSize(map.linkBadgeSize), this.plugin.sectionWordsFor(this.activeMapName));
    // The legend lists the kinds on the map: redraw it when they change.
    const kinds = [...new Set([...sections.values()].flat())];
    if (kinds.sort().join() !== [...this.badgeKindsOnMap].sort().join()) {
      this.badgeKindsOnMap = kinds;
      this.refreshTerrainLegend();
    }
  }

  private scheduleLinkBadges(): void {
    if (this.badgeTimer !== null) window.clearTimeout(this.badgeTimer);
    this.badgeTimer = window.setTimeout(() => {
      this.badgeTimer = null;
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) {
        this.renderLinkBadges(grid);
        // Badges came or went: names make room for them.
        if (!this.cancelMeasuredLayers) this.drawHexNames(grid, true);
      }
    }, 300);
  }

  private scheduleHexNames(): void {
    if (this.namesTimer !== null) window.clearTimeout(this.namesTimer);
    this.namesTimer = window.setTimeout(() => {
      this.namesTimer = null;
      // A grid still waiting for a size draws its names when it gets one.
      if (this.cancelMeasuredLayers) return;
      const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) this.drawHexNames(grid, true);
    }, 300);
  }

  /** (Re)draw the hex-name layer; with `onlyIfChanged`, skip when no name changed. */
  private drawHexNames(gridContainer: HTMLElement, onlyIfChanged = false): void {
    const names = this.hexNames();
    const fills = this.hexNameFills(names);
    // The fill is in the signature: repainting a named hex can flip its name's tone.
    // Badges in the signature too: names make room for them (R8).
    const limits = this.nameBadgeLimits(names);
    // The font and the grid's on-screen size too: a name's size has a
    // readable floor (NM3), so zooming can change its layout.
    const font = resolveNameFont(this.getActiveMap(), this.plugin.settings);
    const screenEm = names.size ? (parseFloat(getComputedStyle(gridContainer).fontSize) || 16) * this.zoom : 0;
    const sig = [...names].map(([k, n]) => `${k}=${n}|${fills.get(k) ?? ""}|${limits.get(k) ?? ""}`).sort().join("\n")
      + `\nfont=${font.family}|${font.scale}|${font.bold}|${font.italic}|${screenEm.toFixed(1)}`;
    if (onlyIfChanged && sig === this.drawnHexNames) return;
    this.drawnHexNames = sig;
    renderHexNameLayer(gridContainer, names, fills, this.plugin.settings.coordPlacement ?? "bottom", limits, font, this.zoom);
  }

  /** How far right each named hex's name may reach: clear of its shown badges (R8). */
  private nameBadgeLimits(names: ReadonlyMap<string, string>): Map<string, number> {
    const out = new Map<string, number>();
    const map = this.getActiveMap();
    if (!(map.showLinkBadges ?? true)) return out;
    const hidden = new Set(hiddenBadges(map));
    const size = badgeSize(map.linkBadgeSize);
    const flat = this.plugin.settings.hexOrientation === "flat";
    for (const key of names.keys()) {
      const n = (this.badgeSectionsByHex.get(key) ?? []).filter((s) => !hidden.has(s)).length;
      if (n) out.set(key, badgeNameLimit(size, flat, n));
    }
    return out;
  }

  /** Terrain colour under each named hex (map data + palette; no DOM reads). */
  private hexNameFills(names: ReadonlyMap<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    if (!names.size) return out;
    const byName = new Map<string, string>();
    for (const t of this.plugin.getMapPalette(this.activeMapName)) if (!byName.has(t.name)) byName.set(t.name, t.color);
    const base = this.getActiveMap().baseTerrain;
    for (const key of names.keys()) {
      const terrain = this.plugin.mapStore.get(this.activeMapName, key)?.terrain ?? base;
      const color = terrain ? byName.get(terrain) : undefined;
      if (color) out.set(key, color);
    }
    return out;
  }

  private scheduleTerrainLegend(): void {
    if (this.legendTimer !== null) window.clearTimeout(this.legendTimer);
    this.legendTimer = window.setTimeout(() => {
      this.legendTimer = null;
      this.refreshTerrainLegend();
    }, 250);
  }

  /** The terrains used on this map (own terrain, or the base terrain where unset). */
  private refreshTerrainLegend(): void {
    const parent = this.controlsEl;
    if (!parent) return;
    const settings = this.plugin.settings;
    if (!(settings.showTerrainLegend ?? true)) {
      parent.querySelector(":scope > .duckmage-terrain-legend")?.remove();
      return;
    }
    const map = this.getActiveMap();
    const { cols, rows } = map.gridSize;
    const { x: ox, y: oy } = map.gridOffset;
    const used: string[] = [];
    let painted = 0;
    for (const [key, h] of this.plugin.mapStore.all(this.activeMapName)) {
      if (!h.terrain) continue;
      const [x, y] = key.split("_").map(Number);
      if (x < ox || y < oy || x >= ox + cols || y >= oy + rows) continue;
      used.push(h.terrain);
      painted++;
    }
    if (map.baseTerrain && painted < cols * rows) used.push(map.baseTerrain);
    const entries = usedTerrainEntries(this.plugin.getMapPalette(this.activeMapName), used);
    // The link badge kinds on the map, as on the PNG legend (round 7 R8),
    // named for the map type (G4b).
    const words = this.plugin.sectionWordsFor(this.activeMapName);
    const badges = legendBadgeKinds(this.badgeKindsOnMap, map.showLinkBadges ?? true, hiddenBadges(map))
      .map((s) => ({ label: words(s).label, icon: BADGE_INFO[s].icon, cls: BADGE_INFO[s].cls }));
    // Pinned to the view's bottom-left, small, names cut short; folds to
    // a "Legend" chip (MK2).
    renderTerrainLegend(parent, entries, {
      badges,
      size: legendSize(settings.terrainLegendSize, "s"),
      cls: "duckmage-terrain-legend-map",
      maxName: MAP_LEGEND_NAME_MAX,
      collapsed: settings.terrainLegendCollapsed ?? false,
      onCollapse: (collapsed) => {
        settings.terrainLegendCollapsed = collapsed;
        void this.plugin.saveSettings();
        this.refreshTerrainLegend();
      },
      iconUrl: (icon) => getIconUrl(this.plugin, icon),
      onSize: (size) => {
        settings.terrainLegendSize = size;
        void this.plugin.saveSettings();
        this.refreshTerrainLegend();
      },
      onHide: () => {
        settings.showTerrainLegend = false;
        void this.plugin.saveSettings();
        this.overlayPanel?.syncLegendToggle();
        this.refreshTerrainLegend();
      },
    });
  }


  private updatePathOverlay(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) {
      this.renderGrid();
      return;
    }
    this.renderPathOverlay(gridContainer);
  }

  // GM icons live inside the path SVG. Re-render that SVG only if the grid
  // already exists — never fall back to renderGrid (would cause infinite loop
  // when called from syncToRegion inside an in-progress renderGrid).
  /**
   * Decode the JSON-encoded list stored on `data-gm-icons`. Returns []
   * for missing / malformed values so callers can safely iterate.
   */
  private parseGmIconsDataset(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  private updateGmIcons(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderPathOverlay(gridContainer);
  }

  private updateFactionOverlay(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderFactionOverlay(gridContainer);
  }

  private clearFactionOverlay(): void {
    this.viewportEl?.querySelector("svg.duckmage-faction-svg")?.remove();
    this.viewportEl?.querySelector(".duckmage-faction-legend")?.remove();
  }

  private renderFactionOverlay(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector("svg.duckmage-faction-svg")?.remove();
    this.viewportEl?.querySelector(".duckmage-faction-legend")?.remove();
    if (!this.getActiveMap().showFactionOverlay) return;

    const hexEls = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex"),
    );
    if (hexEls.length === 0) return;

    // ── Build center map ──────────────────────────────────────────────────────
    let hexW = 0, hexH = 0, gapPx = 0;
    const centerMap = new Map<string, { cx: number; cy: number }>();
    for (const hexEl of hexEls) {
      if (hexW === 0) {
        hexW = hexEl.offsetWidth;
        hexH = hexEl.offsetHeight;
        gapPx = parseFloat(window.getComputedStyle(hexEl).marginTop) || 0;
      }
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
      centerMap.set(`${hexEl.dataset.x}_${hexEl.dataset.y}`, { cx: ox, cy: oy });
    }

    // ── Build faction color + style maps ──────────────────────────────────────
    const folder = normalizeFolder(this.plugin.settings.factionsFolder);
    const factionColorMap = new Map<string, string>();
    const factionStyleMap = new Map<string, OverlayStyle>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (folder && !f.path.startsWith(folder + "/")) continue;
      const color = getFactionColorFromFile(this.app, f.path);
      if (color) {
        factionColorMap.set(f.basename, color);
        factionStyleMap.set(f.basename, getFactionStyleFromFile(this.app, f.path));
      }
    }

    // ── Group hexes by faction name ───────────────────────────────────────────
    const factionHexKeys = new Map<string, string[]>();
    for (const hexEl of hexEls) {
      const gx = Number(hexEl.dataset.x);
      const gy = Number(hexEl.dataset.y);
      const hexPath = this.plugin.hexPath(gx, gy, this.activeMapName);
      const links = this.getFactionLinksFromCache(hexPath);
      const key = `${gx}_${gy}`;
      for (const link of links) {
        if (!factionHexKeys.has(link)) factionHexKeys.set(link, []);
        factionHexKeys.get(link)!.push(key);
      }
    }
    if (factionHexKeys.size === 0) return;

    // ── SVG setup ─────────────────────────────────────────────────────────────
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-faction-svg");
    const w = gridContainer.offsetLeft + gridContainer.offsetWidth + 20;
    const h = gridContainer.offsetTop + gridContainer.offsetHeight + 20;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));

    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const W = hexW, H = hexH;
    const r = isFlat ? W / 2 : H / 2;
    const scale = r > 0 ? (r + gapPx) / r : 1;

    const hexVerts = (cx: number, cy: number): [number, number][] => {
      const pts = isFlat
        ? [ [-W/4, -H/2], [W/4, -H/2], [W/2, 0], [W/4, H/2], [-W/4, H/2], [-W/2, 0] ]
        : [ [0, -H/2], [W/2, -H/4], [W/2, H/4], [0, H/2], [-W/2, H/4], [-W/2, -H/4] ];
      return pts.map(([dx, dy]) => [cx + dx * scale, cy + dy * scale]);
    };

    const vk = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const ek = (v1: [number, number], v2: [number, number]) => {
      const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    };

    const activeFactions: { name: string; color: string; style: OverlayStyle }[] = [];
    let hasElements = false;

    // ── Shared <defs> for SVG patterns (deduped by key|color|scale) ───────────
    const defsEl = activeDocument.createElementNS(svgNS, "defs");
    svg.appendChild(defsEl);
    const patternIds = new Map<string, string>();
    const ensurePattern = (
      key: OverlayPatternKey,
      color: string,
      scale: number,
    ): string | null => {
      if (key === "solid") return null;
      const cacheKey = `${key}|${color}|${scale}`;
      const cached = patternIds.get(cacheKey);
      if (cached) return cached;
      const id = `dm-fac-pat-${key}-${colorToIdToken(color)}-${scale}`;
      const el = buildSvgPattern(activeDocument, { id, pattern: key, color, scale });
      if (!el) return null;
      defsEl.appendChild(el);
      patternIds.set(cacheKey, id);
      return id;
    };

    for (const [factionName, hexKeys] of factionHexKeys) {
      const color = factionColorMap.get(factionName);
      if (!color) continue;
      const style = factionStyleMap.get(factionName) ?? { pattern: "solid" as OverlayPatternKey, scale: 16, opacity: 0.45, outlineWidth: 1.5 };
      const patternId = ensurePattern(style.pattern, color, style.scale);
      const fillVal = patternId ? `url(#${patternId})` : color;

      // ── Edge counting ─────────────────────────────────────────────────────
      type EdgeEntry = { v1: [number, number]; v2: [number, number]; count: number };
      const edgeCounts = new Map<string, EdgeEntry>();

      for (const key of hexKeys) {
        const pos = centerMap.get(key);
        if (!pos) continue;
        const verts = hexVerts(pos.cx, pos.cy);
        for (let i = 0; i < 6; i++) {
          const v1 = verts[i], v2 = verts[(i + 1) % 6];
          const k = ek(v1, v2);
          const ex = edgeCounts.get(k);
          if (ex) { ex.count++; } else { edgeCounts.set(k, { v1, v2, count: 1 }); }
        }
      }

      // ── Build vertex adjacency from boundary edges ─────────────────────────
      const coordOf = new Map<string, [number, number]>();
      type AdjEntry = { key: string; coord: [number, number]; edgeKey: string };
      const vertAdj = new Map<string, AdjEntry[]>();

      for (const { v1, v2, count } of edgeCounts.values()) {
        if (count !== 1) continue;
        const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
        const edgeKey = ek(v1, v2);
        coordOf.set(k1, v1); coordOf.set(k2, v2);
        if (!vertAdj.has(k1)) vertAdj.set(k1, []);
        if (!vertAdj.has(k2)) vertAdj.set(k2, []);
        vertAdj.get(k1)!.push({ key: k2, coord: v2, edgeKey });
        vertAdj.get(k2)!.push({ key: k1, coord: v1, edgeKey });
      }

      if (coordOf.size === 0) continue;

      // ── Walk all closed rings ──────────────────────────────────────────────
      const usedEdges = new Set<string>();
      const rings: [number, number][][] = [];

      for (const { v1, v2, count } of edgeCounts.values()) {
        if (count !== 1) continue;
        const initKey = ek(v1, v2);
        if (usedEdges.has(initKey)) continue;

        usedEdges.add(initKey);
        const ring: [number, number][] = [v1, v2];
        const startK = vk(v1[0], v1[1]);
        let curK = vk(v2[0], v2[1]);

        let safety = 0;
        while (curK !== startK && safety++ < 10_000) {
          const next = (vertAdj.get(curK) ?? []).find(
            (e) => !usedEdges.has(e.edgeKey),
          );
          if (!next) break;
          usedEdges.add(next.edgeKey);
          if (next.key === startK) break;
          ring.push(next.coord);
          curK = next.key;
        }

        if (ring.length >= 3) rings.push(ring);
      }

      if (rings.length === 0) continue;

      // ── Render filled blob(s) ─────────────────────────────────────────────
      const g = activeDocument.createElementNS(svgNS, "g");
      g.setAttribute("opacity", String(style.opacity));
      svg.appendChild(g);

      for (const ring of rings) {
        const d =
          ring
            .map(
              (c, i) =>
                `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`,
            )
            .join(" ") + " Z";
        const path = activeDocument.createElementNS(svgNS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", fillVal);
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", String(style.outlineWidth));
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("paint-order", "stroke fill");
        g.appendChild(path);
      }

      activeFactions.push({ name: factionName, color, style });
      hasElements = true;
    }

    if (!hasElements) return;

    // Insert before path SVG so roads/labels render on top. Anchored in
    // gridContainer so the overlay inherits the gridDisplay transform.
    const pathSvg = gridContainer.querySelector("svg.duckmage-path-svg");
    if (pathSvg) {
      gridContainer.insertBefore(svg, pathSvg);
    } else {
      gridContainer.appendChild(svg);
    }

    this.renderFactionLegend(activeFactions, gridContainer);
  }

  private renderFactionLegend(
    factions: { name: string; color: string; style: OverlayStyle }[],
    gridContainer: HTMLElement,
  ): void {
    if (!this.viewportEl) return;
    const legend = this.viewportEl.createDiv({ cls: "duckmage-faction-legend" });
    // Position the card to the right of the hex grid in the viewport canvas
    const gridRight = gridContainer.offsetLeft + gridContainer.offsetWidth;
    legend.style.left = `${gridRight + 24}px`;
    legend.style.top = `${gridContainer.offsetTop}px`;
    const orientation = this.plugin.settings.hexOrientation;
    const LEGEND_HEX_PX = 32;
    // Shrink the pattern so more repeats fit in the small swatch (the user's
    // scale slider is sized for on-map hexes, ~96 px wide).
    const LEGEND_PATTERN_MULT = LEGEND_HEX_PX / 96;
    for (const { name, color, style } of [...factions].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = legend.createDiv({ cls: "duckmage-faction-legend-row" });
      const swatch = row.createDiv({ cls: "duckmage-faction-legend-swatch" });
      renderHexPreview(swatch, {
        color,
        style,
        orientation,
        hexSizePx: LEGEND_HEX_PX,
        patternScaleMultiplier: LEGEND_PATTERN_MULT,
      });
      row.createSpan({ text: name, cls: "duckmage-faction-legend-name" });
    }
  }

  private getFactionLinksFromCache(hexFilePath: string): string[] {
    const file = this.app.vault.getAbstractFileByPath(hexFilePath);
    const fromCache: string[] = [];

    if (file instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) {
        const headings = cache.headings ?? [];
        const factionHeading = headings.find(
          (h) => h.heading === "Factions" && h.level === 3,
        );
        if (factionHeading) {
          const factionStart = factionHeading.position.start.offset;
          const nextHeading = headings.find(
            (h) => h.position.start.offset > factionStart && h.level <= 3,
          );
          const factionEnd = nextHeading?.position.start.offset ?? Infinity;
          fromCache.push(
            ...(cache.links ?? [])
              .filter(
                (lk) =>
                  lk.position.start.offset > factionStart &&
                  lk.position.start.offset < factionEnd,
              )
              .map((lk) => {
                // Normalize to basename — fileToLinktext may return a path when names clash
                const raw = lk.link.split("|")[0].split("#")[0].trim();
                return raw.split("/").pop() ?? raw;
              }),
          );
        }
      }
    }

    const pending = this.pendingFactionLinks.get(hexFilePath);
    const erased = this.erasedFactionLinks.get(hexFilePath);

    const merged = new Set(fromCache);
    if (pending) for (const name of pending) merged.add(name);
    if (erased) for (const name of erased) merged.delete(name);
    return [...merged];
  }

  // ── Region overlay ─────────────────────────────────────────────────────────

  private async onHexRegionPaintClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "regionLink" || !this.paintRegionPath) return;
    if (this.isErasingMode) { await this.onHexRegionEraseClick(x, y); return; }
    const regionFile = this.app.vault.getAbstractFileByPath(this.paintRegionPath);
    if (!(regionFile instanceof TFile)) return;
    const regionBasename = regionFile.basename;
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);

    const oldRegion = this.getHexRegionFromCache(hexPath);
    if (oldRegion === regionBasename) return;

    // Record for undo (first touch only)
    if (this.currentRegionStroke && !this.currentRegionStroke.has(hexPath)) {
      this.currentRegionStroke.set(hexPath, { hexPath, oldRegion, newRegion: regionBasename });
    } else {
      const existing = this.currentRegionStroke?.get(hexPath);
      if (existing) existing.newRegion = regionBasename;
    }

    // Update pending state before await so overlay refreshes immediately
    this.erasedRegions.delete(hexPath);
    this.pendingRegions.set(hexPath, regionBasename);
    if (this.getActiveMap().showRegionOverlay) this.updateRegionOverlay();

    await setHexRegionInFile(this.app, hexPath, regionBasename);
    void this.plugin.syncHexRegionTableLink(hexPath, regionBasename);
  }

  private async onHexRegionEraseClick(x: number, y: number): Promise<void> {
    if (!this.paintRegionPath) return;
    const regionFile = this.app.vault.getAbstractFileByPath(this.paintRegionPath);
    if (!(regionFile instanceof TFile)) return;
    const regionBasename = regionFile.basename;
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);

    const currentRegion = this.getHexRegionFromCache(hexPath);
    if (currentRegion !== regionBasename) return;

    // Record for undo (first touch only)
    if (this.currentRegionStroke && !this.currentRegionStroke.has(hexPath)) {
      this.currentRegionStroke.set(hexPath, { hexPath, oldRegion: currentRegion, newRegion: null });
    } else {
      const existing = this.currentRegionStroke?.get(hexPath);
      if (existing) existing.newRegion = null;
    }

    this.pendingRegions.delete(hexPath);
    this.erasedRegions.add(hexPath);
    if (this.getActiveMap().showRegionOverlay) this.updateRegionOverlay();

    await setHexRegionInFile(this.app, hexPath, null);
    void this.plugin.syncHexRegionTableLink(hexPath, null);
  }

  private getHexRegionFromCache(hexFilePath: string): string | null {
    if (this.erasedRegions.has(hexFilePath)) return null;
    const pending = this.pendingRegions.get(hexFilePath);
    if (pending !== undefined) return pending;
    return getHexRegionFromFile(this.app, hexFilePath);
  }

  private updateRegionOverlay(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderRegionOverlay(gridContainer);
  }

  private clearRegionOverlay(): void {
    this.viewportEl?.querySelector("svg.duckmage-region-svg")?.remove();
    this.viewportEl?.querySelector(".duckmage-region-labels-layer")?.remove();
  }

  private renderRegionOverlay(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector("svg.duckmage-region-svg")?.remove();
    this.viewportEl?.querySelector(".duckmage-region-labels-layer")?.remove();
    if (!this.getActiveMap().showRegionOverlay) return;

    const hexEls = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex"),
    );
    if (hexEls.length === 0) return;

    // ── Build center map ────────────────────────────────────────────────────
    let hexW = 0, hexH = 0, gapPx = 0;
    const centerMap = new Map<string, { cx: number; cy: number }>();
    for (const hexEl of hexEls) {
      if (hexW === 0) {
        hexW = hexEl.offsetWidth;
        hexH = hexEl.offsetHeight;
        gapPx = parseFloat(window.getComputedStyle(hexEl).marginTop) || 0;
      }
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
      centerMap.set(`${hexEl.dataset.x}_${hexEl.dataset.y}`, { cx: ox, cy: oy });
    }

    // ── Build region → hex keys map ─────────────────────────────────────────
    const regionHexKeys = new Map<string, string[]>();
    for (const hexEl of hexEls) {
      const gx = Number(hexEl.dataset.x);
      const gy = Number(hexEl.dataset.y);
      const hexFilePath = this.plugin.hexPath(gx, gy, this.activeMapName);
      const regionName = this.getHexRegionFromCache(hexFilePath);
      if (!regionName) continue;
      const key = `${gx}_${gy}`;
      if (!regionHexKeys.has(regionName)) regionHexKeys.set(regionName, []);
      regionHexKeys.get(regionName)!.push(key);
    }
    if (regionHexKeys.size === 0) return;

    // ── Region color + style maps ───────────────────────────────────────────
    const folder = normalizeFolder(this.plugin.settings.regionsFolder);
    const regionColorMap = new Map<string, string>();
    const regionStyleMap = new Map<string, OverlayStyle>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.basename.startsWith("_")) continue;
      if (folder && !f.path.startsWith(folder + "/")) continue;
      const color = getRegionColorFromFile(this.app, f.path);
      if (color) {
        regionColorMap.set(f.basename, color);
        regionStyleMap.set(f.basename, getRegionStyleFromFile(this.app, f.path));
      }
    }

    // ── SVG setup ───────────────────────────────────────────────────────────
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-region-svg");
    const svgW = gridContainer.offsetLeft + gridContainer.offsetWidth + 40;
    const svgH = gridContainer.offsetTop + gridContainer.offsetHeight + 40;
    svg.setAttribute("width", String(svgW));
    svg.setAttribute("height", String(svgH));

    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const W = hexW, H = hexH;
    const r = isFlat ? W / 2 : H / 2;
    // Expanded vertices: adjacent same-region hexes' shared vertices coincide exactly
    const scale = r > 0 ? (r + gapPx) / r : 1;

    const hexVerts = (cx: number, cy: number): [number, number][] => {
      const pts = isFlat
        ? [ [-W/4, -H/2], [W/4, -H/2], [W/2, 0], [W/4, H/2], [-W/4, H/2], [-W/2, 0] ]
        : [ [0, -H/2], [W/2, -H/4], [W/2, H/4], [0, H/2], [-W/2, H/4], [-W/2, -H/4] ];
      return pts.map(([dx, dy]) => [cx + dx * scale, cy + dy * scale]);
    };

    const vk = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const ek = (v1: [number, number], v2: [number, number]) => {
      const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    };

    let hasElements = false;

    // ── Shared <defs> for SVG patterns (deduped) ────────────────────────────
    const regionDefsEl = activeDocument.createElementNS(svgNS, "defs");
    svg.appendChild(regionDefsEl);
    const regionPatternIds = new Map<string, string>();
    const ensureRegionPattern = (
      key: OverlayPatternKey,
      color: string,
      scale: number,
    ): string | null => {
      if (key === "solid") return null;
      const cacheKey = `${key}|${color}|${scale}`;
      const cached = regionPatternIds.get(cacheKey);
      if (cached) return cached;
      const id = `dm-reg-pat-${key}-${colorToIdToken(color)}-${scale}`;
      const el = buildSvgPattern(activeDocument, { id, pattern: key, color, scale });
      if (!el) return null;
      regionDefsEl.appendChild(el);
      regionPatternIds.set(cacheKey, id);
      return id;
    };

    // Region labels are emitted as HTML below the SVG-blob loop. Collected
    // here so each region's PCA-rotated name can be rendered as a
    // gridContainer-relative HTML <div> instead of an SVG <text> — that
    // way the label tracks the em-based hex layout perfectly across
    // font-size changes (no slip-on-zoom).
    const regionLabels: Array<{
      name: string;
      mx: number;
      my: number;
      n: number;
      angle: number;
    }> = [];

    for (const [regionName, hexKeys] of regionHexKeys) {
      const color = regionColorMap.get(regionName);
      if (!color) continue;
      const style = regionStyleMap.get(regionName) ?? { pattern: "solid" as OverlayPatternKey, scale: 16, opacity: 0.45, outlineWidth: 1.5 };
      const patternId = ensureRegionPattern(style.pattern, color, style.scale);
      const fillVal = patternId ? `url(#${patternId})` : color;

      // ── Edge counting ───────────────────────────────────────────────────
      type EdgeEntry = { v1: [number, number]; v2: [number, number]; count: number };
      const edgeCounts = new Map<string, EdgeEntry>();
      const hexCenters: { cx: number; cy: number }[] = [];

      for (const key of hexKeys) {
        const pos = centerMap.get(key);
        if (!pos) continue;
        hexCenters.push(pos);
        const verts = hexVerts(pos.cx, pos.cy);
        for (let i = 0; i < 6; i++) {
          const v1 = verts[i], v2 = verts[(i + 1) % 6];
          const k = ek(v1, v2);
          const ex = edgeCounts.get(k);
          if (ex) { ex.count++; } else { edgeCounts.set(k, { v1, v2, count: 1 }); }
        }
      }

      // ── Build vertex adjacency from boundary edges ──────────────────────
      const coordOf = new Map<string, [number, number]>();
      type AdjEntry = { key: string; coord: [number, number]; edgeKey: string };
      const vertAdj = new Map<string, AdjEntry[]>();

      for (const { v1, v2, count } of edgeCounts.values()) {
        if (count !== 1) continue;
        const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
        const edgeKey = ek(v1, v2);
        coordOf.set(k1, v1); coordOf.set(k2, v2);
        if (!vertAdj.has(k1)) vertAdj.set(k1, []);
        if (!vertAdj.has(k2)) vertAdj.set(k2, []);
        vertAdj.get(k1)!.push({ key: k2, coord: v2, edgeKey });
        vertAdj.get(k2)!.push({ key: k1, coord: v1, edgeKey });
      }

      if (coordOf.size === 0) continue;

      // ── Walk all closed rings (handles disconnected islands) ────────────
      const usedEdges = new Set<string>();
      const rings: [number, number][][] = [];

      for (const { v1, v2, count } of edgeCounts.values()) {
        if (count !== 1) continue;
        const initKey = ek(v1, v2);
        if (usedEdges.has(initKey)) continue;

        usedEdges.add(initKey);
        const ring: [number, number][] = [v1, v2];
        const startK = vk(v1[0], v1[1]);
        let curK = vk(v2[0], v2[1]);

        let safety = 0;
        while (curK !== startK && safety++ < 10_000) {
          const next = (vertAdj.get(curK) ?? []).find(
            (e) => !usedEdges.has(e.edgeKey),
          );
          if (!next) break;
          usedEdges.add(next.edgeKey);
          if (next.key === startK) break;
          ring.push(next.coord);
          curK = next.key;
        }

        if (ring.length >= 3) rings.push(ring);
      }

      if (rings.length === 0) continue;

      // ── PCA label angle ─────────────────────────────────────────────────
      const n = hexCenters.length;
      const mx = hexCenters.reduce((s, p) => s + p.cx, 0) / n;
      const my = hexCenters.reduce((s, p) => s + p.cy, 0) / n;
      let labelAngle = 0;
      if (n > 1) {
        const sxx = hexCenters.reduce((s, p) => s + (p.cx - mx) ** 2, 0);
        const syy = hexCenters.reduce((s, p) => s + (p.cy - my) ** 2, 0);
        const sxy = hexCenters.reduce((s, p) => s + (p.cx - mx) * (p.cy - my), 0);
        let ang = (Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI / 2;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        labelAngle = ang;
      }

      // ── Render filled blob(s) ───────────────────────────────────────────
      const g = activeDocument.createElementNS(svgNS, "g");
      g.setAttribute("opacity", String(style.opacity));
      svg.appendChild(g);

      for (const ring of rings) {
        const d =
          ring
            .map(
              (c, i) =>
                `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`,
            )
            .join(" ") + " Z";
        const path = activeDocument.createElementNS(svgNS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", fillVal);
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", String(style.outlineWidth));
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("paint-order", "stroke fill");
        g.appendChild(path);
      }

      // Capture the region label spec; the labels themselves are rendered
      // as HTML below (NOT in the SVG) so they don't slip-on-zoom — same
      // reason coord labels were moved out of the SVG. mx/my are in
      // gridContainer-local pixel coords at THIS render's hex layout;
      // we convert them to percentages of the grid's pixel dimensions so
      // the labels rescale automatically when font-size changes.
      regionLabels.push({
        name: regionName,
        mx, my,
        n,
        angle: labelAngle,
      });

      hasElements = true;
    }

    if (!hasElements) return;

    // Regions render below factions and paths. Anchored in gridContainer so
    // the overlay inherits the gridDisplay transform.
    const factionSvg = gridContainer.querySelector("svg.duckmage-faction-svg");
    const pathSvg = gridContainer.querySelector("svg.duckmage-path-svg");
    const insertBefore = factionSvg ?? pathSvg ?? null;
    if (insertBefore) {
      gridContainer.insertBefore(svg, insertBefore);
    } else {
      gridContainer.appendChild(svg);
    }

    // Region name labels — rendered as HTML inside gridContainer so they
    // ride the em-based grid layout instead of pixel-pinned SVG text.
    // The position is converted from gridContainer-local pixels (mx/my)
    // to percentages so the labels stay anchored when font-size mutates
    // during a bake-zoom transition. PCA rotation is preserved via the
    // CSS transform (rotation composed after the centering translate).
    if (regionLabels.length > 0) {
      const gw = gridContainer.offsetWidth || 1;
      const gh = gridContainer.offsetHeight || 1;
      const labelsLayer = gridContainer.createDiv({
        cls: "duckmage-region-labels-layer",
      });
      for (const lbl of regionLabels) {
        const fontSize = Math.round(Math.min(10 + 3 * Math.sqrt(lbl.n), 52));
        const el = labelsLayer.createDiv({
          cls: "duckmage-region-label",
          text: lbl.name,
        });
        const leftPct = (lbl.mx / gw) * 100;
        const topPct = (lbl.my / gh) * 100;
        el.setCssProps({
          "--duckmage-region-label-left": `${leftPct.toFixed(3)}%`,
          "--duckmage-region-label-top": `${topPct.toFixed(3)}%`,
          "--duckmage-region-label-angle": `${lbl.angle.toFixed(1)}deg`,
          "--duckmage-region-label-font-size": `${fontSize}px`,
        });
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

  /** "x_y" → name for the active map's named hexes (map note data). */
  private hexNames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, h] of this.plugin.mapStore.all(this.activeMapName)) if (h.name) out.set(key, h.name);
    return out;
  }

  private renderTokenLayer(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector(".duckmage-token-layer")?.remove();
    if (this.getActiveMap().showTokens === false) return;
    this.loadTokensForMap();
    if (this.tokenEntries.length === 0) return;

    const centerMap = this.buildTokenCenterMap(gridContainer);
    // Token layer is a child of gridContainer (not viewportEl) so its
    // absolute-positioned tokens use the same coordinate space as
    // `buildTokenCenterMap` returns (which walks up to gridContainer).
    // Previously the layer was a viewportEl child, which made every token
    // off by exactly the viewport's `padding: 1em` — visible as
    // "tokens not centered on hexes". Matches the path / faction / region
    // overlay pattern (1.4.0 fix). Covered by
    // examples/hex-token-alignment/ in the frontend-testing suite.
    const layer = gridContainer.createDiv({ cls: "duckmage-token-layer" });

    // Spread radius: fraction of the hex's short dimension so offsets scale with zoom.
    const firstHexEl = gridContainer.querySelector<HTMLElement>(".duckmage-hex");
    const spread = Math.min(firstHexEl?.offsetWidth ?? 64, firstHexEl?.offsetHeight ?? 64) * 0.28;

    // Group visible tokens by hex key, preserving entry order.
    const byHex = new Map<string, TokenEntry[]>();
    for (const token of this.tokenEntries) {
      if (!token.visible) continue;
      if (!centerMap.has(token.hex)) continue;
      if (!byHex.has(token.hex)) byHex.set(token.hex, []);
      byHex.get(token.hex)!.push(token);
    }

    for (const [hexKey, tokens] of byHex) {
      const center = centerMap.get(hexKey)!;
      const offsets = tokenGroupOffsets(tokens.length);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const [odx, ody] = offsets[i];
        const size = token.size ?? "md";
        const tokenEl = layer.createDiv({
          cls: `duckmage-token duckmage-token-${token.shape} duckmage-token-size-${size}`,
        });
        tokenEl.style.left = `${center.cx + odx * spread}px`;
        tokenEl.style.top  = `${center.cy + ody * spread}px`;
        tokenEl.title      = token.title;
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
        const place = tokenNamePlacement(offsets, i);
        const nameEl = layer.createDiv({
          cls: `duckmage-token-name duckmage-token-name-${tokens.length > 1 ? groupSize(tokens) : size}`,
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
            const [hx, hy] = snapToken.hex.split("_").map(Number);
            if (Number.isFinite(hx) && Number.isFinite(hy)) void this.onHexClick(hx, hy, e);
          });
        });
      }
    }
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
      const dx = (e.clientX - startClientX) / this.zoom;
      const dy = (e.clientY - startClientY) / this.zoom;
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
        if (closestHex) {
          const [px, py] = closestHex.split("_").map(Number);
          this.viewportEl
            ?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)
            ?.removeClass("duckmage-token-drop-target");
        }
        closestHex = best;
        if (best) {
          const [px, py] = best.split("_").map(Number);
          this.viewportEl
            ?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)
            ?.addClass("duckmage-token-drop-target");
        }
      }
    };

    const onUp = () => {
      activeDocument.removeEventListener("mousemove", onMove);
      activeDocument.removeEventListener("mouseup", onUp);
      tokenEl.removeClass("duckmage-token-dragging");

      if (closestHex) {
        const [px, py] = closestHex.split("_").map(Number);
        this.viewportEl
          ?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)
          ?.removeClass("duckmage-token-drop-target");
      }

      if (!isDragging) {
        onClickInstead();
        return;
      }

      if (closestHex && closestHex !== token.hex) {
        // Snap to new hex center immediately; the cache `changed` event re-renders the layer
        // once the write lands. Calling updateTokenLayer() here would render stale cache
        // data (old hex), then re-render again on the changed event — causing visible flicker.
        const newCenter = centerMap.get(closestHex);
        if (newCenter) {
          tokenEl.style.left = `${newCenter.cx}px`;
          tokenEl.style.top  = `${newCenter.cy}px`;
        }
        if (guardWrite(token.map, "token")) {
          this.pushTokenUndo(token.filePath, token.map, { hex: token.hex, map: token.map }, { hex: closestHex, map: token.map });
          void setTokenHex(this.app, token.filePath, closestHex, token.map);
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
      { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, description: token.description },
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
      look: { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, tokenLink: token.tokenLink, description: token.description },
    };
  }

  /** Remove a token from the map (the note stays); undoable. */
  private removeToken(token: TokenEntry): void {
    if (!guardWrite(token.map, "token")) return;
    this.pushTokenUndo(token.filePath, token.map, this.tokenSnap(token), null);
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
    const menu = new ModeMenu(this.currentWorkMode());
    menu.add("token.info", "Token info", "info", () => this.openTokenInfo(token));
    menu.add("token.edit", "Edit token", "pencil", () => this.openTokenEditor(token));
    menu.add("token.open-note", "Open note", "file-text", () => {
      const file = this.app.vault.getAbstractFileByPath(token.filePath);
      if (file instanceof TFile) void openNoteFocused(this.app, file);
    });
    menu.addSeparator();
    menu.add("token.remove", "Remove token", "trash", () => this.removeToken(token));
    menu.showAtMouseEvent(evt);
  }
}

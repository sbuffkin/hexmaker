import { ItemView, Menu, Notice, Scope, TFile, TFolder, WorkspaceLeaf } from "obsidian";
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
  Frontmatter,
} from "../frontmatter";
import { HexEditorModal } from "./HexEditorModal";
import { TerrainPickerModal } from "./TerrainPickerModal";
import { IconPickerModal } from "./IconPickerModal";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "../sections";
import { getFactionColorFromFile, getRegionColorFromFile, getFactionStyleFromFile, getRegionStyleFromFile, setHexRegionInFile, getHexRegionFromFile, getSubmapFromFile, type OverlayStyle } from "../frontmatter";
import { buildSvgPattern, colorToIdToken, type OverlayPatternKey } from "../overlayPatterns";
import { renderHexPreview } from "./overlayPatternControls";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { MapModal } from "./MapModal";
import { mapAncestors } from "./submapNav";
import { pathClickOutcome, toolModeLabel } from "./toolMode";
import { PathPickerModal } from "./PathPickerModal";
import type { MapData, PathChain, TokenEntry } from "../types";
import {
  hexNeighbors,
  smoothPath,
  sharpPath,
  offsetPolyline,
  computeLaneOffsets,
  buildMeanderPts,
  buildEdgePts,
} from "./hexGeometry";
import { GotoHexModal } from "./GotoHexModal";
import { HexHelpModal } from "./HexHelpModal";
import { FolderTreePickerModal } from "./FolderTreePickerModal";
import { FactionPickerModal } from "./FactionPickerModal";
import { GeoRegionPickerModal } from "./GeoRegionPickerModal";
import { DrawingToolPanel, OverlayPanel } from "./HexSidePanel";
import { TokenModal } from "./TokenModal";
import { SubmapPickerModal } from "./SubmapPickerModal";
import { NewMapSetupModal } from "../worldgen/NewMapSetupModal";
import { RegionNavigateModal } from "./RegionNavigateModal";
import { neighbourShadow } from "../worldgen/neighbours";
import { TokenInfoModal } from "./TokenInfoModal";
import {
  getTokenDataFromCache,
  applyTokenFrontmatter,
  removeTokenFrontmatter,
  setTokenHex,
} from "../frontmatter";
import { PainterContextMenu } from "./PainterContextMenu";

type TerrainUndoEntry = {
  x: number;
  y: number;
  path: string;
  oldTerrain: string | null;
  newTerrain: string | null;
};
type IconUndoEntry = {
  x: number;
  y: number;
  path: string;
  oldIcon: string | null;
  newIcon: string | null;
  isGm: boolean;
  /** Full GM-icon list before/after the stroke. Only populated when
   *  isGm=true and the new painter (multi-add) path mutated this hex.
   *  Undo restores the full list; legacy oldIcon/newIcon kept for
   *  back-compat with strokes recorded before the multi-add change. */
  oldGmList?: string[];
  newGmList?: string[];
};
type FactionUndoEntry = {
  hexPath: string;
  factionBasename: string;
  factionFilePath: string;
  /** Whether the faction link was present before this stroke began. */
  wasPresent: boolean;
};
type RegionUndoEntry = {
  hexPath: string;
  oldRegion: string | null;
  newRegion: string | null;
};
interface CalibrateSnapshot {
  bg?: { offsetX: number; offsetY: number; scale: number; rotation: number; opacity: number };
  grid: { scaleX: number; scaleY: number; offsetX: number; offsetY: number; legacyScale: number };
}

type UndoItem =
  | { kind: "terrain"; entries: TerrainUndoEntry[] }
  | { kind: "icon"; entries: IconUndoEntry[] }
  | { kind: "faction"; entries: FactionUndoEntry[] }
  | { kind: "region"; entries: RegionUndoEntry[] }
  | { kind: "swap"; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: "path";
      mapName: string;
      before: PathChain[];
      after: PathChain[];
    }
  | {
      kind: "calibrate";
      mapName: string;
      before: CalibrateSnapshot;
      after: CalibrateSnapshot;
    };

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

// Returns [dx, dy] unit offsets (multiply by spread radius) for N tokens on one hex.
// Presets keep 1-5 tokens visually distinct; 6+ use an even radial ring.
function tokenGroupOffsets(n: number): [number, number][] {
  const PRESETS: [number, number][][] = [
    [[0, 0]],
    [[-0.55, 0], [0.55, 0]],
    [[0, -0.6], [-0.55, 0.4], [0.55, 0.4]],
    [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]],
    [[0, -0.65], [-0.6, -0.15], [0.6, -0.15], [-0.38, 0.55], [0.38, 0.55]],
  ];
  if (n >= 1 && n <= 5) return PRESETS[n - 1];
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [Math.cos(a) * 0.65, Math.sin(a) * 0.65];
  });
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
  private coordGridSize = { w: 1, h: 1 };
  private coordLabels = new Map<string, HTMLElement>();
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
  // The last-clicked hex key and the specific chain being extended
  private activePathTypeName: string | null = null;
  private activePathEnd: string | null = null;
  private activePathChain: PathChain | null = null;
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
  private readonly UNDO_DEPTH = 20;
  private undoStack: UndoItem[] = [];
  private redoStack: UndoItem[] = [];
  private currentTerrainStroke: Map<string, TerrainUndoEntry> | null = null;
  private currentIconStroke: Map<string, IconUndoEntry> | null = null;
  private currentFactionStroke: Map<string, FactionUndoEntry> | null = null;
  private currentRegionStroke: Map<string, RegionUndoEntry> | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  activeMapName = "default";
  /** Set when another view/window mutated shared state while this view was
   *  inactive; consumed by a re-render on next activation (issue #32). */
  private needsRerender = false;
  private mapHistory: string[] = [];
  private mapBtn: HTMLButtonElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private upBtn: HTMLButtonElement | null = null;
  private crumbsEl: HTMLElement | null = null;
  /** False until the first map's viewport is placed (restored or fitted). */
  private viewportReady = false;
  private tokenEntries: TokenEntry[] = [];
  private pendingTokenNotePath: string | null = null;
  private pendingTokenPlaceData: { icon?: string; shape: import("../types").TokenShape; size: import("../types").TokenSize; color?: string; border?: string; description?: string } | null = null;
  private tokenBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HexmakerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HEX_MAP;
  }
  getDisplayText(): string {
    return `Hex map — ${this.activeMapName}`;
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
    this.mapBtn?.setText(`${this.activeMapName} ▾`);
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
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoButton();
    if (opts.recordHistory !== false) {
      this.mapHistory.push(this.activeMapName);
      if (this.mapHistory.length > 50) this.mapHistory.shift();
    }
    this.switchToMap(name);
  }

  /** Back to the previously viewed map (skips maps deleted since). */
  navigateBack(): boolean {
    while (this.mapHistory.length > 0) {
      const prev = this.mapHistory.pop()!;
      if (!this.plugin.getMap(prev) || prev === this.activeMapName) continue;
      this.navigateToMap(prev, { recordHistory: false });
      return true;
    }
    this.refreshMapNav();
    return false;
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
   * "New submap…" for hex (x, y): the setup modal (size, palette, generator,
   * base terrain, preview). On create, links the hex and enters the new map;
   * "Open in generator" also opens the Generator view on it.
   */
  openNewSubmapSetup(x: number, y: number): void {
    const parentMap = this.activeMapName;
    new NewMapSetupModal(
      this.app,
      this.plugin,
      ({ name }) => {
        void (async () => {
          await this.plugin.linkSubmap(parentMap, x, y, name);
          if (this.activeMapName === parentMap) this.navigateToMap(name);
          else this.renderGrid();
        })();
      },
      { map: parentMap, x, y },
    ).open();
  }

  canNavigateBack(): boolean {
    return this.previousMapName() !== undefined;
  }

  /** The map Back would go to (skips maps deleted since and the current one). */
  private previousMapName(): string | undefined {
    for (let i = this.mapHistory.length - 1; i >= 0; i--) {
      const m = this.mapHistory[i];
      if (m !== this.activeMapName && this.plugin.getMap(m)) return m;
    }
    return undefined;
  }

  canNavigateUp(): boolean {
    return this.plugin.parentOf(this.activeMapName) !== undefined;
  }

  /** Brief ripple on a hex so the eye lands on it after a map change. */
  private flashHex(x: number, y: number): void {
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) return;
    const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
    blip.addEventListener("animationend", () => blip.remove(), { once: true });
  }

  /** Breadcrumb (ancestors), Up and Back buttons for the active map. */
  private refreshMapNav(): void {
    // Both buttons name the map they go to (fresh-eyes T4: "↑ up" vs
    // "← back" wasn't self-explanatory): Parent = the map this one is a
    // submap of; Previous = the map viewed before this one (like a browser).
    const prev = this.previousMapName();
    if (this.backBtn) {
      if (prev) {
        this.backBtn.show();
        const label = `Back to the previous map: ${prev} (Alt+←)`;
        this.backBtn.title = label;
        this.backBtn.setAttr("aria-label", label);
      } else {
        this.backBtn.hide();
      }
    }

    const parent = this.plugin.parentOf(this.activeMapName);
    if (this.upBtn) {
      if (parent) {
        this.upBtn.show();
        const label = `Up to the parent map: ${parent.map}, hex ${parent.hex.replace("_", ", ")} (Alt+↑)`;
        this.upBtn.title = label;
        this.upBtn.setAttr("aria-label", label);
      } else {
        this.upBtn.hide();
      }
    }

    const crumbs = this.crumbsEl;
    if (!crumbs) return;
    crumbs.empty();
    const ancestors = mapAncestors(this.activeMapName, (m) => this.plugin.parentOf(m)?.map);
    for (const name of ancestors) {
      const crumb = crumbs.createEl("button", {
        cls: "duckmage-map-crumb",
        text: name,
        attr: { title: `Go to ${name}` },
      });
      crumb.addEventListener("click", () => this.navigateToMap(name));
      crumbs.createSpan({ cls: "duckmage-map-crumb-sep", text: "›" });
    }
    crumbs.toggle(ancestors.length > 0);
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

    // clipEl clips the panning viewport; controlsEl overlays buttons without clipping
    const clipEl = contentEl.createDiv({ cls: "duckmage-hex-map-clip" });
    const controlsEl = contentEl.createDiv({
      cls: "duckmage-hex-map-controls",
    });

    this.viewportEl = clipEl.createDiv({ cls: "duckmage-hex-map-viewport" });
    this.applyTransform();

    // Mode bar: paint/draw tools are sticky, so say which one is on and how
    // to stop it (fresh-eyes T3). Hidden while no tool is active.
    this.modeBarEl = controlsEl.createDiv({
      cls: "duckmage-mode-bar",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.modeBarTextEl = this.modeBarEl.createSpan({ cls: "duckmage-mode-bar-text" });
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
      this.exitCurrentMode();
      return false;
    });

    this.factionTooltipEl = contentEl.createDiv({ cls: "duckmage-faction-tooltip" });
    this.factionTooltipEl.hide();

    this.registerDomEvent(clipEl, "mouseleave", () => {
      this.updateBrushHighlight(null, null);
    });

    // ── Zoom (scroll wheel, no modifier required) ──────────────────────────
    // Delta-aware + rAF-batched. Mouse notch (deltaY=100) → ~1.33× per event.
    // Trackpads (deltaY≈2-10) → tiny per-event factors that look smooth
    // because many events fire per frame and the rAF tick applies them as
    // one update. NO easing tail — the visual lands exactly at the
    // cumulative wheel delta and stops the frame after the last event.
    const ZOOM_SENSITIVITY = 0.0028;
    this.registerDomEvent(
      contentEl,
      "wheel",
      (e: WheelEvent) => {
        // Calibration mode: image/grid wheel handlers own plain-wheel scaling
        // (they stopPropagation), so this only fires for Ctrl/Cmd+wheel
        // (which the layer handlers explicitly let through) or wheels outside
        // both layers. Treat both as a viewport zoom.
        e.preventDefault();
        const rect = contentEl.getBoundingClientRect();
        // Normalize deltaY across deltaMode (LINE: ~33px/line, PAGE: ~400px).
        const PX_PER_LINE = 33;
        const PX_PER_PAGE = 400;
        const dyPx =
          e.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? e.deltaY * PX_PER_LINE
            : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? e.deltaY * PX_PER_PAGE
            : e.deltaY;
        this.pendingZoomLog += -dyPx * ZOOM_SENSITIVITY;
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
      if (this.drawingMode === "terrain" || this.drawingMode === "icon" || this.drawingMode === "factionLink" || this.drawingMode === "regionLink") {
        isTerrainPainting = true;
        lastPaintedKey = null;
        if (this.drawingMode === "terrain")
          this.currentTerrainStroke = new Map();
        else if (this.drawingMode === "icon")
          this.currentIconStroke = new Map();
        else if (this.drawingMode === "factionLink")
          this.currentFactionStroke = new Map();
        else if (this.drawingMode === "regionLink")
          this.currentRegionStroke = new Map();
        // Paint the hex under the cursor immediately
        const hexEl = (e.target as HTMLElement).closest<HTMLElement>(
          ".duckmage-hex",
        );
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
      if (isTerrainPainting) {
        const el = dragDoc?.elementFromPoint(
          e.clientX,
          e.clientY,
        ) as HTMLElement | null;
        const hexEl = el?.closest<HTMLElement>(".duckmage-hex");
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
        const hexEl = (e.target as HTMLElement).closest<HTMLElement>(".duckmage-hex");
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
        // Path tool: right-click a hex of the path type being drawn removes
        // it from its chain, as the help says (fresh-eyes T2). Anywhere else
        // still opens the tool menu.
        if (
          this.drawingMode === "path" &&
          hexX !== null && hexY !== null &&
          this.pathChainWithHex(`${hexX}_${hexY}`, this.activePathTypeName)
        ) {
          void this.onHexPathDeleteClick(hexX, hexY, this.activePathTypeName);
          return;
        }
        this.showPainterContextMenu(e.clientX, e.clientY, hexX, hexY);
      },
      { capture: true },
    );

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
    this.mapBtn.addEventListener("click", () =>
      new MapModal(this.app, this.plugin, this, () => {
        this.exitTerrainMode();
        this.exitPathMode();
        this.undoStack = [];
        this.redoStack = [];
        this.updateUndoButton();
        this.updateMapBtnLabel();
        this.refreshViewHeader();
        this.renderGrid();
      }).open(),
    );

    this.upBtn = mapNavGroup.createEl("button", {
      cls: "duckmage-map-up-btn",
      text: "↑ parent map",
    });
    this.upBtn.hide();
    this.upBtn.addEventListener("click", () => this.navigateUp());

    this.backBtn = mapNavGroup.createEl("button", {
      cls: "duckmage-map-back-btn",
      text: "← previous map",
    });
    this.backBtn.hide();
    this.backBtn.addEventListener("click", () => this.navigateBack());
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
    );
    toolsPanel.onBeforeOpen = () => this.overlayPanel?.close();
    this.overlayPanel.onBeforeOpen = () => toolsPanel.close();

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
        if (file.path.startsWith(mapPrefix)) this.markStaleFromExternal();

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
          if (!sizeLocked()) void expandAction();
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
        if (!canShrink() || sizeLocked()) return;
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
      text: "Regions",
    });
    this.regionLinkBtn.addEventListener("click", () =>
      this.handleRegionLinkButton(),
    );

    this.tokenBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-token",
      text: "Token",
    });
    this.tokenBtn.addEventListener("click", () => this.handleTokenButton());
  }

  private showPainterContextMenu(
    clientX: number,
    clientY: number,
    hexX: number | null,
    hexY: number | null,
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
    } else if (mode === "placeToken") {
      onSwitch = () => this.handleTokenButton(true);
      switchLabel = "Switch token";
    }
    // swap: no picker → onSwitch stays null, menu shows only "Exit tool"

    this.painterMenu?.close();
    this.painterMenu = new PainterContextMenu(onSwitch, () => this.exitCurrentMode(), switchLabel, extra);
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
    this.activePathEnd = null;
    this.activePathChain = null;
  }

  openTerrainPicker(): void {
    this.toolsPanel?.open();
    this.handleTerrainButton();
  }

  private handleTerrainButton(): void {
    // Keep the current tool while the picker is open: closing it without a
    // pick (Escape, clicking away, or after only changing the brush size)
    // must leave painting exactly as it was. It used to exit terrain mode
    // here first, so any of those turned the tool off.
    if (this.drawingMode === "terrain") this.commitTerrainStroke();

    // Show crosshair on the viewport while the picker is open
    this.viewportEl?.addClass("duckmage-terrain-picking");

    // Always open the picker — even if already active, so user can switch terrain
    new TerrainPickerModal(
      this.app,
      this.plugin,
      this.plugin.getMapPalette(this.activeMapName),
      (terrainName: string | null) => {
        this.viewportEl?.removeClass("duckmage-terrain-picking");
        this.leaveOtherToolFor("terrain");
        this.drawingMode = "terrain";
        this.isErasingMode = false;
        this.terrainPickMode = false;
        this.paintTerrainName = terrainName;
        this.paintIconName = null;
        this.updateToolbarButtonStates();
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
      () => { /* unlink not meaningful in tool mode */ },
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
    if (!keep && this.drawingMode === "placeToken") {
      this.exitTokenMode();
      return;
    }
    new TokenModal(
      this.app,
      this.plugin,
      undefined,
      "",
      {},
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
  private onHexDblClick(x: number, y: number): void {
    if (this.drawingMode === "path") {
      this.exitPathMode();
      this.updatePathOverlay();
      return;
    }
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
      {},
      (notePath, data) => {
        void applyTokenFrontmatter(this.app, notePath, {
          icon: data.icon,
          shape: data.shape,
          size: data.size,
          color: data.color,
          border: data.border,
          description: data.description,
          hex: `${x}_${y}`,
          map: this.activeMapName,
          visible: true,
        }).then(() => this.updateTokenLayer());
      },
      undefined,
      "Create token",
    ).open();
  }

  private async onHexTokenPlaceClick(x: number, y: number): Promise<void> {
    if (!this.pendingTokenNotePath || !this.pendingTokenPlaceData) return;
    const hexKey = `${x}_${y}`;
    await applyTokenFrontmatter(this.app, this.pendingTokenNotePath, {
      ...this.pendingTokenPlaceData,
      hex: hexKey,
      map: this.activeMapName,
      visible: true,
    });
    this.exitTokenMode();
    this.updateTokenLayer();
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
      this.undoStack.push({ kind: "swap", x1, y1, x2, y2 });
      if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      this.updateUndoButton();
    }
  }

  private updateToolbarButtonStates(): void {
    const erasing = this.isErasingMode;
    this.pathToolbarBtn?.toggleClass("is-active", this.drawingMode === "path");
    this.pathToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "path");
    // Update path button swatch color to show active type
    if (this.pathBtnSwatch) {
      const activeType = this.activePathTypeName
        ? this.plugin.settings.pathTypes.find(
            (p) => p.name === this.activePathTypeName,
          )
        : this.plugin.settings.pathTypes[0];
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
        this.submapLinkBtnLabel.setText(erasing ? "Erase submap" : (this.paintSubmapName ? "Link: " + this.paintSubmapName : "Link submap"));
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
        this.regionLinkBtnLabel.setText("Regions");
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
      iconName: this.paintIconName,
      iconGmOnly: this.paintIconGmOnly,
      pathTypeName: this.activePathTypeName,
      tablePath: this.paintTablePath,
      submapName: this.paintSubmapName,
      factionPath: this.paintFactionPath,
      regionPath: this.paintRegionPath,
    });
    this.modeBarTextEl.setText(label ?? "");
    this.modeBarEl.toggle(label !== null);
  }

  private applyTransform(): void {
    if (this.viewportEl) {
      this.viewportEl.setCssProps({
        "--duckmage-vp-tx": `${this.panX}px`,
        "--duckmage-vp-ty": `${this.panY}px`,
        "--duckmage-vp-scale": String(this.zoom),
      });
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
    this.undoStack.push({ kind: "calibrate", mapName, before, after });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
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
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
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
    const raw = Math.min(clipW / gridW, clipH / gridH) * 0.92;
    this.zoom  = Math.min(5, Math.max(0.2, raw));
    this.panX  = (clipW - gridW * this.zoom) / 2;
    this.panY  = (clipH - gridH * this.zoom) / 2;
    this.applyTransform();
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

    // Tear down the path SVG FIRST, before the font-size mutation below.
    // The path SVG holds coord labels at pixel positions computed against
    // the pre-bake hex sizes. After font-size grows the hexes, those
    // pixel positions point to where the hexes USED to be, so any paint
    // frame between the font-size change and the SVG rebuild shows
    // labels visibly shifted up-left from the hexes. By removing the
    // SVG (and its `duckmage-svg-labels-active` class) here, the
    // intermediate frame shows only the HTML labels in
    // `.duckmage-coord-labels-layer`, which sit at a % of the grid and so
    // track the hex layout across font-size changes. The new path SVG is rebuilt
    // via `updatePathOverlay()` further down. Sandbox repro of the
    // pre-fix slip: dev/coord-slip-sandbox.html.
    this.viewportEl.querySelector("svg.duckmage-path-svg")?.remove();
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

    this.updatePathOverlay();
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

  centerOnHex(x: number, y: number): void {
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (!hexEl) {
      new Notice(`Hex ${x},${y} is not in the current grid.`);
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

    const targetZoom = 1.5;
    this.zoom = targetZoom;
    this.panX = clipRect.width / 2 - hexViewX * targetZoom;
    this.panY = clipRect.height / 2 - hexViewY * targetZoom;
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
    const gridContainer = this.viewportEl.createDiv({
      cls: `duckmage-hex-map-grid${isFlat ? " duckmage-grid-flat" : ""}`,
    });

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
      const submapName: unknown = fromStore ? stored?.submap : fm?.["duckmage-submap"];
      if (typeof submapName === "string" && submapName && this.plugin.getMap(submapName)) {
        hexEl.addClass("duckmage-hex-has-submap");
        const badge = hexEl.createSpan({
          cls: "duckmage-hex-submap-badge",
          attr: { title: `Enter submap: ${submapName} (Ctrl+click hex)`, "aria-label": `Enter submap ${submapName}` },
        });
        badge.addEventListener("click", (e) => {
          if (this.drawingMode) return;
          e.stopPropagation();
          this.navigateToMap(submapName);
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

    this.renderNeighbourShadow(gridContainer, region);
    this.renderPathOverlay(gridContainer);
    this.renderRegionOverlay(gridContainer);
    this.renderFactionOverlay(gridContainer);
    // Coord labels go LAST (and at z:10 in CSS) so they sit above the path
    // SVG, GM-icon overlay, faction overlay, and region overlay — paths
    // and icons can no longer cover up the hex coordinates.
    this.renderCoordLabelsLayer(gridContainer);
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
    if (!region.world) return;
    const shadow = neighbourShadow(this.plugin, region);
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

    // ── Writes ──
    const layer = gridContainer.createDiv({ cls: "duckmage-region-shadow-layer" });
    for (const { s, at, color } of items) {
      // Not a .duckmage-hex: painting, overlays and labels all look for those.
      const el = layer.createDiv({
        cls: "duckmage-region-shadow-hex",
        attr: { title: `${s.map}: hex ${s.x}, ${s.y}`, "data-region": s.map },
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
  }

  /** Switch to a neighbouring region and land on one of its hexes. */
  private goToRegionHex(mapName: string, x: number, y: number, openEditor = false): void {
    this.navigateToMap(mapName);
    window.setTimeout(() => {
      this.setSelectedHex(x, y);
      this.centerOnHex(x, y);
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

    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    // Terrain, icon and submap live in the map note, and a hex can have them
    // before its hex note exists (a generated map, a submap made from this
    // menu) — gating these on the note hid "Enter submap" and "Clear
    // terrain" on such hexes (fresh-eyes N3).
    const terrain = getTerrainFromFile(this.app, hexPath);
    const iconOverride = getIconOverrideFromFile(this.app, hexPath);
    const submap = getSubmapFromFile(this.app, hexPath);

    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Center on this hex")
        .setIcon("crosshair")
        .onClick(() => this.centerOnHex(x, y)),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Open note")
        .setIcon("file-text")
        .onClick(async () => {
          const existing = this.app.vault.getAbstractFileByPath(hexPath);
          const file =
            existing instanceof TFile
              ? existing
              : await this.plugin.createHexNote(x, y, this.activeMapName);
          if (file) await this.app.workspace.getLeaf().openFile(file);
        }),
    );

    if (submap) {
      menu.addItem((item) =>
        item
          .setTitle(`Enter submap: ${submap}`)
          .setIcon("log-in")
          .onClick(() => this.navigateToMap(submap)),
      );
    }

    if (!submap) {
      menu.addItem((item) =>
        item
          .setTitle("New submap…")
          .setIcon("map-plus")
          .onClick(() => this.openNewSubmapSetup(x, y)),
      );
    }

    menu.addItem((item) =>
      item
        .setTitle(submap ? "Change submap…" : "Link existing map…")
        .setIcon("map-pin")
        .onClick(() => {
          const parentMap = this.activeMapName;
          const current = getSubmapFromFile(this.app, hexPath);
          new SubmapPickerModal(
            this.app,
            this.plugin,
            current,
            (mapName, created) => {
              void (async () => {
                await this.plugin.linkSubmap(parentMap, x, y, mapName);
                // A freshly made submap is where the user wants to be next.
                if (created && this.activeMapName === parentMap) this.navigateToMap(mapName);
                else this.renderGrid();
              })();
            },
            () => {
              void this.plugin.unlinkSubmap(parentMap, x, y).then(() => this.renderGrid());
            },
            { map: parentMap, x, y },
            () => this.openNewSubmapSetup(x, y),
          ).open();
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle("Link table")
        .setIcon("table")
        .onClick(() => {
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
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle("Swap hex")
        .setIcon("arrow-left-right")
        .onClick(() => {
          if (this.drawingMode !== "swap") this.handleSwapButton();
          void this.onHexSwapClick(x, y);
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle("Create token here")
        .setIcon("circle-user")
        .onClick(() => this.createTokenAtHex(x, y)),
    );

    // ── Contextual delete options ──────────────────────────────────────────
    if (terrain || iconOverride) {
      menu.addSeparator();
      if (terrain) {
        menu.addItem((item) =>
          item.setTitle("Clear terrain").setIcon("eraser")
            .onClick(() => {
              this.scheduleTerrainWrite(x, y, hexPath, null);
              this.renderGrid();
            }),
        );
      }
      if (iconOverride) {
        menu.addItem((item) =>
          item.setTitle("Remove icon override").setIcon("image-off")
            .onClick(() => {
              this.scheduleIconWrite(x, y, hexPath, null);
              this.renderGrid(undefined, new Map([[hexPath, null]]));
            }),
        );
      }
    }

    menu.showAtMouseEvent(evt);
  }

  private async onHexClick(x: number, y: number, e?: MouseEvent): Promise<void> {
    if (this.drawingMode === "path") {
      if (this.isErasingMode) { await this.onHexPathDeleteClick(x, y); return; }
      await this.onHexPathDrawClick(x, y);
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
      }

      // ── Queue background file write (coalescing per-hex) ────────────────
      const path = this.plugin.hexPath(hx, hy, this.activeMapName);
      if (this.currentTerrainStroke) {
        if (!this.currentTerrainStroke.has(path)) {
          const fmCache: Frontmatter | undefined =
            this.app.metadataCache.getCache(path)?.frontmatter;
          const oldTerrain = fmCache?.terrain ?? null;
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
    this.undoStack.push({ kind: "icon", entries: [undoEntry] });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
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
      await this.plugin.unlinkSubmap(this.activeMapName, x, y);
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
      new Notice(`Already linked on ${x},${y}`);
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

  private applyTerrainToHexEl(
    hexEl: HTMLElement,
    terrain: string | null,
  ): void {
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

  private commitTerrainStroke(): void {
    if (!this.currentTerrainStroke || this.currentTerrainStroke.size === 0) {
      this.currentTerrainStroke = null;
      return;
    }
    const entries = [...this.currentTerrainStroke.values()];
    this.undoStack.push({ kind: "terrain", entries });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.currentTerrainStroke = null;
    this.updateUndoButton();
  }

  private commitIconStroke(): void {
    if (!this.currentIconStroke || this.currentIconStroke.size === 0) {
      this.currentIconStroke = null;
      return;
    }
    const entries = [...this.currentIconStroke.values()];
    this.undoStack.push({ kind: "icon", entries });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.currentIconStroke = null;
    this.updateUndoButton();
  }

  private commitFactionStroke(): void {
    if (!this.currentFactionStroke || this.currentFactionStroke.size === 0) {
      this.currentFactionStroke = null;
      return;
    }
    const entries = [...this.currentFactionStroke.values()];
    this.undoStack.push({ kind: "faction", entries });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.currentFactionStroke = null;
    this.updateUndoButton();
  }

  private commitRegionStroke(): void {
    if (!this.currentRegionStroke || this.currentRegionStroke.size === 0) {
      this.currentRegionStroke = null;
      return;
    }
    const entries = [...this.currentRegionStroke.values()];
    this.undoStack.push({ kind: "region", entries });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.currentRegionStroke = null;
    this.updateUndoButton();
  }

  private async undo(): Promise<void> {
    const item = this.undoStack.pop();
    if (!item) return;
    this.redoStack.push(item);
    if (item.kind === "terrain") {
      this.applyStroke(item.entries, "old");
    } else if (item.kind === "icon") {
      await this.applyIconStroke(item.entries, "old");
    } else if (item.kind === "faction") {
      await this.applyFactionStroke(item.entries, "old");
    } else if (item.kind === "region") {
      await this.applyRegionStroke(item.entries, "old");
    } else if (item.kind === "swap") {
      await this.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else if (item.kind === "calibrate") {
      await this.applyCalibrationSnapshot(item.mapName, item.before);
    } else {
      await this.applyPathSnapshot(item.mapName, item.before);
    }
    this.updateUndoButton();
  }

  private async redo(): Promise<void> {
    const item = this.redoStack.pop();
    if (!item) return;
    this.undoStack.push(item);
    if (item.kind === "terrain") {
      this.applyStroke(item.entries, "new");
    } else if (item.kind === "icon") {
      await this.applyIconStroke(item.entries, "new");
    } else if (item.kind === "faction") {
      await this.applyFactionStroke(item.entries, "new");
    } else if (item.kind === "region") {
      await this.applyRegionStroke(item.entries, "new");
    } else if (item.kind === "swap") {
      await this.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else if (item.kind === "calibrate") {
      await this.applyCalibrationSnapshot(item.mapName, item.after);
    } else {
      await this.applyPathSnapshot(item.mapName, item.after);
    }
    this.updateUndoButton();
  }

  private async applyPathSnapshot(
    mapName: string,
    chains: PathChain[],
  ): Promise<void> {
    const region = this.plugin.getMap(mapName);
    if (!region) return;
    region.pathChains = this.cloneChains(chains);
    // Clear active chain tracking — the restored state may not match
    this.exitPathMode();
    await this.plugin.saveSettings();
    this.updatePathOverlay();
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
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
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
    new PathPickerModal(
      this.app,
      this.plugin,
      this.activePathTypeName,
      (typeName) => {
        this.leaveOtherToolFor("path");
        // A new type starts a new chain rather than continuing the old one;
        // re-picking the type being drawn keeps the chain going.
        if (this.drawingMode !== "path" || typeName !== this.activePathTypeName) this.exitPathMode();
        this.activePathTypeName = typeName;
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
    ).open();
  }

  /** Deep-clone a pathChains array for undo/redo snapshot. */
  private cloneChains(chains: PathChain[]): PathChain[] {
    return chains.map((c) => ({ typeName: c.typeName, hexes: [...c.hexes] }));
  }

  private pushPathUndo(
    mapName: string,
    before: PathChain[],
    after: PathChain[],
  ): void {
    this.undoStack.push({ kind: "path", mapName, before, after });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButton();
  }

  private async onHexPathDrawClick(x: number, y: number): Promise<void> {
    if (!this.activePathTypeName) return;
    const key = `${x}_${y}`;
    const region = this.getActiveMap();
    const chains = region.pathChains.filter(
      (c) => c.typeName === this.activePathTypeName,
    );
    const before = this.cloneChains(region.pathChains);

    let neighbourKeys: string[] = [];
    if (this.activePathEnd !== null) {
      const [ax, ay] = this.activePathEnd.split("_").map(Number);
      neighbourKeys = hexNeighbors(
        ax,
        ay,
        this.plugin.settings.hexOrientation,
        this.getActiveStagger(),
      ).map(([nx, ny]) => `${nx}_${ny}`);
    }
    const outcome = pathClickOutcome(this.activePathEnd, key, neighbourKeys);
    // Clicking the end again would stack a second one-hex chain on it.
    if (outcome === "same") return;
    if (outcome === "restart") {
      // Paths don't auto-route between distant hexes; say so instead of
      // silently leaving a lone dot (fresh-eyes T7).
      new Notice("Paths go hex by hex: click a hex next to the end of the path. Started a new path here.");
      // A one-hex chain is never drawn (a line needs two hexes), so the
      // abandoned start would linger invisibly in the map data: drop it.
      const abandoned = this.activePathChain;
      if (abandoned && abandoned.hexes.length === 1) {
        const i = region.pathChains.indexOf(abandoned);
        if (i !== -1) region.pathChains.splice(i, 1);
        this.activePathChain = null;
      }
    }

    // ── If adjacent to active end, extend that chain ─────────────────────
    if (this.activePathEnd !== null) {
      if (outcome === "extend") {
        let target: PathChain | undefined;
        if (
          this.activePathChain !== null &&
          this.activePathChain.hexes[this.activePathChain.hexes.length - 1] ===
            this.activePathEnd
        ) {
          target = this.activePathChain;
        } else {
          target = chains.find(
            (c) => c.hexes[c.hexes.length - 1] === this.activePathEnd,
          );
        }
        if (target) {
          target.hexes.push(key);
          this.activePathEnd = key;
          this.activePathChain = target;
          this.pushPathUndo(
            region.name,
            before,
            this.cloneChains(region.pathChains),
          );
          await this.plugin.saveSettings();
          this.updatePathOverlay();
          return;
        }
      }
    }

    // ── Not adjacent (or no active chain) — start a new chain ────────────
    const newChain: PathChain = {
      typeName: this.activePathTypeName,
      hexes: [key],
    };
    region.pathChains.push(newChain);
    this.activePathEnd = key;
    this.activePathChain = newChain;
    this.pushPathUndo(region.name, before, this.cloneChains(region.pathChains));
    await this.plugin.saveSettings();
    this.updatePathOverlay();
  }

  /** First path chain (of `typeName`, or any type when null) through hex `key`. */
  private pathChainWithHex(key: string, typeName: string | null): PathChain | undefined {
    return this.getActiveMap().pathChains.find(
      (c) => (typeName === null || c.typeName === typeName) && c.hexes.includes(key),
    );
  }

  /** Remove hex (x, y) from the first chain through it — only chains of
   *  `typeName` when given (right-click while drawing that type). */
  private async onHexPathDeleteClick(x: number, y: number, typeName: string | null = null): Promise<void> {
    const key = `${x}_${y}`;
    const region = this.getActiveMap();
    const chains = region.pathChains;
    const before = this.cloneChains(region.pathChains);

    for (let ci = 0; ci < chains.length; ci++) {
      if (typeName !== null && chains[ci].typeName !== typeName) continue;
      const pos = chains[ci].hexes.indexOf(key);
      if (pos === -1) continue;

      const chain = chains[ci];
      const isActiveChain = chain === this.activePathChain;

      if (chain.hexes.length === 1) {
        // Remove entire chain from region.pathChains
        const idx = region.pathChains.indexOf(chain);
        if (idx !== -1) region.pathChains.splice(idx, 1);
        if (isActiveChain) this.activePathChain = null;
      } else if (pos === 0) {
        chain.hexes.splice(0, 1);
      } else if (pos === chain.hexes.length - 1) {
        chain.hexes.splice(pos, 1);
      } else {
        // Split: replace with two chains
        const left: PathChain = {
          typeName: chain.typeName,
          hexes: chain.hexes.slice(0, pos),
        };
        const right: PathChain = {
          typeName: chain.typeName,
          hexes: chain.hexes.slice(pos + 1),
        };
        const idx = region.pathChains.indexOf(chain);
        if (idx !== -1) region.pathChains.splice(idx, 1, left, right);
        if (isActiveChain) this.activePathChain = null;
      }

      if (this.activePathEnd === key) {
        // Removing the end of the path being drawn steps it back one hex,
        // so drawing carries on from there.
        const stepBack = pos === chain.hexes.length && chain.hexes.length > 0;
        this.activePathEnd = stepBack ? chain.hexes[chain.hexes.length - 1] : null;
        this.activePathChain = stepBack ? chain : null;
      }

      this.pushPathUndo(
        region.name,
        before,
        this.cloneChains(region.pathChains),
      );
      await this.plugin.saveSettings();
      this.updatePathOverlay();
      return;
    }
  }

  private renderPathOverlay(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector("svg.duckmage-path-svg")?.remove();
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
    const hasContent =
      region.pathChains.some((c) => c.hexes.length > 0) ||
      this.activePathEnd !== null ||
      (gmLayerActive && gridContainer.querySelector("[data-gm-icons]") !== null);
    if (!hasContent) return;

    // Build hex center map — offsetLeft/offsetTop are unaffected by CSS transform
    const centerMap = new Map<string, { cx: number; cy: number }>();
    let hexW = 0,
      hexH = 0;
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hexEl) => {
        const x = Number(hexEl.dataset.x);
        const y = Number(hexEl.dataset.y);
        if (hexW === 0) {
          hexW = hexEl.offsetWidth;
          hexH = hexEl.offsetHeight;
        }
        let ox = hexEl.offsetWidth / 2;
        let oy = hexEl.offsetHeight / 2;
        let cur: HTMLElement | null = hexEl;
        // Walk only up to gridContainer so coords are gridContainer-relative.
        // The SVG itself lives inside gridContainer and inherits any
        // gridDisplay transform — otherwise the overlay drifts away from
        // the scaled hex grid on calibrated maps.
        while (cur && cur !== gridContainer) {
          ox += cur.offsetLeft;
          oy += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        centerMap.set(`${x}_${y}`, { cx: ox, cy: oy });
      });

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-path-svg");
    const w = gridContainer.offsetLeft + gridContainer.offsetWidth + 20;
    const h = gridContainer.offsetTop + gridContainer.offsetHeight + 20;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));

    const DASH_ARRAYS: Record<string, string> = {
      solid: "",
      dashed: "8 4",
      dotted: "2 4",
    };

    const appendPath = (
      pts: { cx: number; cy: number }[],
      color: string,
      strokeWidth: number,
      dashArray = "",
      smooth = true,
    ) => {
      const path = activeDocument.createElementNS(svgNS, "path");
      path.setAttribute("class", "duckmage-svg-path-line");
      path.setAttribute("d", smooth ? smoothPath(pts) : sharpPath(pts));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(strokeWidth));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("fill", "none");
      if (dashArray) path.setAttribute("stroke-dasharray", dashArray);
      svg.appendChild(path);
    };

    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const hexRadius = isFlat ? hexW / 2 : hexH / 2;

    // Flatten every chain into a render list in path-type definition order,
    // pairing each chain with its resolved type. Stable order = draw order.
    const renderables = this.plugin.settings.pathTypes.flatMap((pt) =>
      region.pathChains
        .filter((c) => c.typeName === pt.name)
        .map((chain) => ({ chain, pt })),
    );

    // Assign each chain a perpendicular "lane" offset so chains that share a
    // route (e.g. a road and a river on the same hexes) render side by side
    // instead of one stroke covering the other (issue #30). Chains that don't
    // share any segment with another keep offset 0 → pixel-identical output.
    const laneOffset = computeLaneOffsets(
      renderables.map((r) => ({
        hexes: r.chain.hexes,
        width: r.pt.width,
        typeName: r.pt.name,
      })),
    );

    renderables.forEach(({ chain, pt }, idx) => {
      const dash = DASH_ARRAYS[pt.lineStyle] ?? "";
      let pts: { cx: number; cy: number }[];
      let smooth: boolean;
      if (pt.routing === "meander") {
        pts = buildMeanderPts(chain.hexes, centerMap);
        smooth = true;
      } else if (pt.routing === "edge") {
        pts = buildEdgePts(chain.hexes, centerMap, isFlat, hexRadius);
        smooth = false;
      } else {
        pts = chain.hexes
          .map((k) => centerMap.get(k))
          .filter((p): p is { cx: number; cy: number } => !!p);
        smooth = true;
      }
      if (pts.length < 2) return;
      pts = offsetPolyline(pts, laneOffset[idx]);
      appendPath(pts, pt.color, pt.width, dash, smooth);
    });

    // Small circle to mark the active endpoint (only visible in path mode)
    if (this.drawingMode === "path" && this.activePathEnd) {
      const activeType = this.activePathTypeName
        ? this.plugin.settings.pathTypes.find(
            (p) => p.name === this.activePathTypeName,
          )
        : undefined;
      const color = activeType?.color ?? "#888888";
      const pos = centerMap.get(this.activePathEnd);
      if (pos) {
        const circle = activeDocument.createElementNS(svgNS, "circle");
        circle.setAttribute("class", "duckmage-svg-path-line");
        circle.setAttribute("cx", String(pos.cx));
        circle.setAttribute("cy", String(pos.cy));
        circle.setAttribute("r", "5");
        circle.setAttribute("fill", color);
        circle.setAttribute("stroke", "white");
        circle.setAttribute("stroke-width", "1.5");
        circle.setAttribute("opacity", "0.9");
        svg.appendChild(circle);
      }
    }

    // Elevate override icons above roads/rivers by rendering them inside the SVG.
    gridContainer
      .querySelectorAll<HTMLElement>("[data-icon-override]")
      .forEach((hexEl) => {
        const iconName = hexEl.dataset.iconOverride!;
        const key = `${hexEl.dataset.x!}_${hexEl.dataset.y!}`;
        const pos = centerMap.get(key);
        if (!pos) return;
        const origImg = hexEl.querySelector<HTMLElement>(".duckmage-hex-icon");
        if (origImg) {
          origImg.hide();
          origImg.setAttribute("data-svg-elevated", "1");
        }
        const imgEl = activeDocument.createElementNS(svgNS, "image");
        const iconW = hexEl.offsetWidth * 0.78;
        const iconH = hexEl.offsetHeight * 0.78;
        imgEl.setAttribute("x", String(pos.cx - iconW / 2));
        imgEl.setAttribute("y", String(pos.cy - iconH / 2));
        imgEl.setAttribute("width", String(iconW));
        imgEl.setAttribute("height", String(iconH));
        imgEl.setAttribute("href", getIconUrl(this.plugin, iconName));
        imgEl.setAttribute("opacity", "0.75");
        imgEl.setAttribute("class", "duckmage-svg-icon-override");
        svg.appendChild(imgEl);
      });

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
    if (gmLayerActive) {
      gridContainer
        .querySelectorAll<HTMLElement>("[data-gm-icons]")
        .forEach((hexEl) => {
          const list = this.parseGmIconsDataset(hexEl.dataset.gmIcons);
          if (list.length === 0) return;
          const key = `${hexEl.dataset.x!}_${hexEl.dataset.y!}`;
          const pos = centerMap.get(key);
          if (!pos) return;

          // Count occurrences per icon, preserving first-seen order.
          const counts = new Map<string, number>();
          for (const ic of list) counts.set(ic, (counts.get(ic) ?? 0) + 1);
          const slots = Array.from(counts.entries()).slice(0, GM_ICON_HEX_SUBGRID.length);
          const slotCount = slots.length;

          const w = hexEl.offsetWidth;
          const h = hexEl.offsetHeight;
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
              // icon even at small sizes (was drifting away with the old
              // `* 0.9 / * 1.02` offset which scaled badge-to-icon
              // distance independent of the actual icon position).
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

        const snapToken = { ...token }; // capture for closures

        tokenEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.drawingMode !== null) return;
          this.showTokenContextMenu(e, snapToken);
        });

        // Single mousedown handler — startTokenDrag calls onClickInstead if no drag occurs.
        tokenEl.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || this.drawingMode !== null) return;
          e.stopPropagation();
          this.startTokenDrag(snapToken, tokenEl, e, centerMap, () => {
            new TokenInfoModal(
              this.app,
              snapToken,
              (x, y) => this.centerOnHex(x, y),
              () => {
                void removeTokenFrontmatter(this.app, snapToken.filePath)
                  .then(() => this.updateTokenLayer());
              },
              () => this.openTokenEditor(snapToken),
            ).open();
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
        void setTokenHex(this.app, token.filePath, closestHex, token.map);
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
      () => {
        void removeTokenFrontmatter(this.app, token.filePath)
          .then(() => this.updateTokenLayer());
      },
    ).open();
  }

  private showTokenContextMenu(evt: MouseEvent, token: TokenEntry): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Edit token")
        .setIcon("pencil")
        .onClick(() => this.openTokenEditor(token)),
    );

    menu.addItem((item) =>
      item
        .setTitle("Open note")
        .setIcon("file-text")
        .onClick(() => {
          const file = this.app.vault.getAbstractFileByPath(token.filePath);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf("tab").openFile(file);
          }
        }),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Remove token")
        .setIcon("trash")
        .onClick(() => {
          void removeTokenFrontmatter(this.app, token.filePath)
            .then(() => this.updateTokenLayer());
        }),
    );

    menu.showAtMouseEvent(evt);
  }
}

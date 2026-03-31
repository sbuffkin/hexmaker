import {
  ItemView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder, getIconUrl, createIconEl } from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  setTerrainInFile,
  setIconOverrideInFile,
  Frontmatter,
} from "../frontmatter";
import { HexEditorModal } from "./HexEditorModal";
import { TerrainPickerModal } from "./TerrainPickerModal";
import { IconPickerModal } from "./IconPickerModal";
import { addLinkToSection, getLinksInSection } from "../sections";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "../constants";
import { RegionModal } from "./RegionModal";
import { PathPickerModal } from "./PathPickerModal";
import type { RegionData, PathChain } from "../types";
import { hexNeighbors, smoothPath, sharpPath, buildMeanderPts, buildEdgePts } from "./hexGeometry";
import { GotoHexModal } from "./GotoHexModal";
import { HexHelpModal } from "./HexHelpModal";
import { FolderTreePickerModal } from "./FolderTreePickerModal";

type TerrainUndoEntry = {
  x: number;
  y: number;
  path: string;
  oldTerrain: string | null;
  newTerrain: string | null;
};
type UndoItem =
  | { kind: "terrain"; entries: TerrainUndoEntry[] }
  | { kind: "swap"; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: "path";
      regionName: string;
      before: PathChain[];
      after: PathChain[];
    };

export class HexMapView extends ItemView {
  plugin: HexmakerPlugin;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private viewportEl: HTMLElement | null = null;
  private drawingMode:
    | "path"
    | "terrain"
    | "icon"
    | "tableLink"
    | "factionLink"
    | "swap"
    | null = null;
  private pathToolbarBtn: HTMLButtonElement | null = null;
  private pathBtnSwatch: HTMLElement | null = null;
  private terrainToolbarBtn: HTMLButtonElement | null = null;
  private terrainBtnPreview: HTMLSpanElement | null = null;
  private iconToolbarBtn: HTMLButtonElement | null = null;
  private iconBtnPreview: HTMLImageElement | null = null;
  private tableLinkBtn: HTMLButtonElement | null = null;
  private tableLinkBtnLabel: HTMLSpanElement | null = null;
  private paintTablePath: string | null = null;
  private factionLinkBtn: HTMLButtonElement | null = null;
  private factionLinkBtnLabel: HTMLSpanElement | null = null;
  private paintFactionPath: string | null = null;
  private swapBtn: HTMLButtonElement | null = null;
  private swapSource: { x: number; y: number } | null = null;
  private swapDest: { x: number; y: number } | null = null;
  // The last-clicked hex key and the specific chain being extended
  private activePathTypeName: string | null = null;
  private activePathEnd: string | null = null;
  private activePathChain: PathChain | null = null;
  private paintTerrainName: string | null = null;
  private paintIconName: string | null = null;
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
  private flushing = new Set<string>(); // "t:<path>" or "i:<path>"
  private savingIndicatorEl: HTMLElement | null = null;
  // Undo / redo
  private readonly UNDO_DEPTH = 20;
  private undoStack: UndoItem[] = [];
  private redoStack: UndoItem[] = [];
  private currentTerrainStroke: Map<string, TerrainUndoEntry> | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  activeRegionName = "default";
  private regionBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HexmakerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HEX_MAP;
  }
  getDisplayText(): string {
    return `Hex map — ${this.activeRegionName}`;
  }

  private getActiveRegion(): RegionData {
    return this.plugin.getOrCreateRegion(this.activeRegionName);
  }

  private updateRegionBtnLabel(): void {
    this.regionBtn?.setText(`${this.activeRegionName} ▾`);
  }

  async onOpen(): Promise<void> {
    // Initialise to the configured default region (falls back to first region or "default")
    this.activeRegionName =
      this.plugin.settings.defaultRegion ||
      this.plugin.settings.regions[0]?.name ||
      "default";

    const { contentEl } = this;
    contentEl.addClass("duckmage-hex-map-container");

    // clipEl clips the panning viewport; controlsEl overlays buttons without clipping
    const clipEl = contentEl.createDiv({ cls: "duckmage-hex-map-clip" });
    const controlsEl = contentEl.createDiv({
      cls: "duckmage-hex-map-controls",
    });

    this.viewportEl = clipEl.createDiv({ cls: "duckmage-hex-map-viewport" });
    this.applyTransform();

    this.registerDomEvent(clipEl, "mouseleave", () => {
      this.updateBrushHighlight(null, null);
    });

    // ── Zoom (scroll wheel, no modifier required) ──────────────────────────
    this.registerDomEvent(
      contentEl,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = contentEl.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newZoom = Math.min(5, Math.max(0.2, this.zoom * factor));
        this.panX = cx - (cx - this.panX) * (newZoom / this.zoom);
        this.panY = cy - (cy - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
        this.applyTransform();
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

    this.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
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
        return;
      }
      if (e.button !== 0) return;
      if (this.drawingMode === "terrain" || this.drawingMode === "icon") {
        isTerrainPainting = true;
        lastPaintedKey = null;
        if (this.drawingMode === "terrain")
          this.currentTerrainStroke = new Map();
        // Paint the hex under the cursor immediately
        const hexEl = (e.target as HTMLElement).closest<HTMLElement>(
          ".duckmage-hex",
        );
        if (hexEl) {
          const x = Number(hexEl.dataset.x);
          const y = Number(hexEl.dataset.y);
          lastPaintedKey = `${x}_${y}`;
          if (this.drawingMode === "terrain") this.onHexPaintClick(x, y);
          else this.onHexIconClick(x, y);
          hasDragged = true; // suppress the subsequent click event
        }
        return; // skip pan setup
      }
      // Any other active tool (road, river, tableLink, factionLink, swap):
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
    });

    this.registerDomEvent(document, "mousemove", (e: MouseEvent) => {
      if (isTerrainPainting) {
        const el = document.elementFromPoint(
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
          }
          this.updateBrushHighlight(x, y);
        } else {
          this.updateBrushHighlight(null, null);
        }
        return;
      }
      if (this.drawingMode === "terrain" || this.drawingMode === "icon") {
        const el = document.elementFromPoint(
          e.clientX,
          e.clientY,
        ) as HTMLElement | null;
        const hexEl = el?.closest<HTMLElement>(".duckmage-hex");
        if (hexEl) {
          this.updateBrushHighlight(
            Number(hexEl.dataset.x),
            Number(hexEl.dataset.y),
          );
        } else {
          this.updateBrushHighlight(null, null);
        }
      }
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!hasDragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4))
        hasDragged = true;
      if (hasDragged) {
        this.panX = panStartX + dx;
        this.panY = panStartY + dy;
        this.applyTransform();
      }
    });

    this.registerDomEvent(document, "mouseup", () => {
      if (isTerrainPainting && this.drawingMode === "terrain")
        this.commitTerrainStroke();
      isTerrainPainting = false;
      lastPaintedKey = null;
      isDragging = false;
      this.viewportEl?.removeClass("is-dragging");
    });

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
      { capture: true } as AddEventListenerOptions,
    );

    // Right-click: on a hex in road/river mode → let onHexContextMenu handle the delete.
    // Double-right-click off a hex → exit the active tool.
    let lastOffHexRightClick = 0;
    this.registerDomEvent(
      contentEl,
      "contextmenu",
      (e: MouseEvent) => {
        if (this.drawingMode === null) return;
        const onHex = (e.target as HTMLElement).closest(".duckmage-hex");
        if (onHex && this.drawingMode === "path") return;
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - lastOffHexRightClick < 400) {
          lastOffHexRightClick = 0;
          if (this.drawingMode === "terrain") this.exitTerrainMode();
          else if (this.drawingMode === "icon") this.exitIconMode();
          else if (this.drawingMode === "tableLink") this.exitTableLinkMode();
          else if (this.drawingMode === "factionLink")
            this.exitFactionLinkMode();
          else if (this.drawingMode === "swap") this.exitSwapMode();
          else {
            if (this.drawingMode === "path") this.exitPathMode();
            this.drawingMode = null;
            this.updateToolbarButtonStates();
            this.updatePathOverlay();
          }
        } else {
          lastOffHexRightClick = now;
        }
      },
      { capture: true } as AddEventListenerOptions,
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
        this.app.workspace.revealLeaf(existing[0]);
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
      this.app.workspace.revealLeaf(this.leaf);
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
        this.app.workspace.revealLeaf(existing[0]);
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
      this.app.workspace.revealLeaf(this.leaf);
    });

    this.regionBtn = controlsEl.createEl("button", {
      cls: "duckmage-region-btn",
      title: "Manage regions",
    });
    this.updateRegionBtnLabel();
    this.regionBtn.addEventListener("click", () =>
      new RegionModal(this.app, this.plugin, this, () => {
        this.exitTerrainMode();
        this.exitPathMode();
        this.undoStack = [];
        this.redoStack = [];
        this.updateUndoButton();
        this.updateRegionBtnLabel();
        interface WithUpdateHeader {
          updateHeader?(): void;
        }
        (this.leaf as unknown as WithUpdateHeader).updateHeader?.();
        this.renderGrid();
      }).open(),
    );

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

    // Toggle button — always visible, collapses/restores only the drawing tools
    const toggleBtn = controlsEl.createEl("button", {
      cls: "duckmage-toolbar-toggle-btn",
      title: "Hide tools",
    });
    toggleBtn.setText("≡");
    toggleBtn.addEventListener("click", () => {
      const collapsed = controlsEl.hasClass("duckmage-toolbar-collapsed");
      controlsEl.toggleClass("duckmage-toolbar-collapsed", !collapsed);
      toggleBtn.title = collapsed ? "Hide tools" : "Show tools";
    });

    // Drawing toolbar column — right side, collapses when toggled
    this.createDrawingToolbar(controlsEl);

    // Saving indicator — appears while background writes are in flight
    this.savingIndicatorEl = controlsEl.createEl("span", {
      cls: "duckmage-saving-indicator",
      text: "Saving…",
    });

    this.renderGrid();
  }

  private createExpandButtons(container: HTMLElement): void {
    const dirs = [
      {
        cls: "duckmage-expand-top",
        action: async () => {
          this.getActiveRegion().gridOffset.y--;
          this.getActiveRegion().gridSize.rows++;
          await this.plugin.saveSettings();
          this.renderGrid();
          const r = this.getActiveRegion();
          const xs = Array.from(
            { length: r.gridSize.cols },
            (_, i) => r.gridOffset.x + i,
          );
          void this.plugin.generateHexNotes(this.activeRegionName, xs, [
            r.gridOffset.y,
          ]);
        },
      },
      {
        cls: "duckmage-expand-bottom",
        action: async () => {
          this.getActiveRegion().gridSize.rows++;
          await this.plugin.saveSettings();
          this.renderGrid();
          const r = this.getActiveRegion();
          const newY = r.gridOffset.y + r.gridSize.rows - 1;
          const xs = Array.from(
            { length: r.gridSize.cols },
            (_, i) => r.gridOffset.x + i,
          );
          void this.plugin.generateHexNotes(this.activeRegionName, xs, [newY]);
        },
      },
      {
        cls: "duckmage-expand-left",
        action: async () => {
          this.getActiveRegion().gridOffset.x--;
          this.getActiveRegion().gridSize.cols++;
          await this.plugin.saveSettings();
          this.renderGrid();
          const r = this.getActiveRegion();
          const ys = Array.from(
            { length: r.gridSize.rows },
            (_, i) => r.gridOffset.y + i,
          );
          void this.plugin.generateHexNotes(
            this.activeRegionName,
            [r.gridOffset.x],
            ys,
          );
        },
      },
      {
        cls: "duckmage-expand-right",
        action: async () => {
          this.getActiveRegion().gridSize.cols++;
          await this.plugin.saveSettings();
          this.renderGrid();
          const r = this.getActiveRegion();
          const newX = r.gridOffset.x + r.gridSize.cols - 1;
          const ys = Array.from(
            { length: r.gridSize.rows },
            (_, i) => r.gridOffset.y + i,
          );
          void this.plugin.generateHexNotes(this.activeRegionName, [newX], ys);
        },
      },
    ];
    for (const { cls, action } of dirs) {
      const btn = container.createEl("button", {
        cls: `duckmage-expand-btn ${cls}`,
        text: "+",
      });
      btn.addEventListener("click", action);
    }
  }

  private createDrawingToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "duckmage-draw-toolbar" });

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

    this.factionLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.factionLinkBtnLabel = this.factionLinkBtn.createSpan({
      text: "Link faction",
    });
    this.factionLinkBtn.addEventListener("click", () =>
      this.handleFactionLinkButton(),
    );
  }

  private exitPathMode(): void {
    this.activePathEnd = null;
    this.activePathChain = null;
  }

  private handleTerrainButton(): void {
    // Show crosshair on the viewport while the picker is open
    this.viewportEl?.addClass("duckmage-terrain-picking");

    // Always open the picker — even if already active, so user can switch terrain
    new TerrainPickerModal(
      this.app,
      this.plugin,
      this.plugin.getRegionPalette(this.activeRegionName),
      (terrainName: string | null) => {
        this.viewportEl?.removeClass("duckmage-terrain-picking");
        this.drawingMode = "terrain";
        this.terrainPickMode = false;
        this.paintTerrainName = terrainName;
        this.paintIconName = null;
        this.updateToolbarButtonStates();
      },
      () => {
        // Eyedropper: enter terrain mode in pick-from-map state
        this.viewportEl?.removeClass("duckmage-terrain-picking");
        this.drawingMode = "terrain";
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
    this.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  private handleIconButton(): void {
    new IconPickerModal(this.app, this.plugin, (iconName: string | null) => {
      this.drawingMode = "icon";
      this.paintIconName = iconName;
      this.paintTerrainName = null;
      this.updateToolbarButtonStates();
    }).open();
  }

  private exitIconMode(): void {
    if (this.drawingMode !== "icon") return;
    this.drawingMode = null;
    this.paintIconName = null;
    this.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  private handleTableLinkButton(): void {
    new FolderTreePickerModal(
      this.app,
      this.plugin,
      this.plugin.settings.tablesFolder,
      "Select table",
      "Filter tables…",
      "No tables found.",
      (file) => {
        this.drawingMode = "tableLink";
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
    this.updateToolbarButtonStates();
  }

  private handleFactionLinkButton(): void {
    new FolderTreePickerModal(
      this.app,
      this.plugin,
      this.plugin.settings.factionsFolder,
      "Select faction",
      "Filter factions…",
      "No factions found.",
      (file) => {
        this.drawingMode = "factionLink";
        this.paintFactionPath = file.path;
        this.updateToolbarButtonStates();
      },
    ).open();
  }

  private exitFactionLinkMode(): void {
    if (this.drawingMode !== "factionLink") return;
    this.drawingMode = null;
    this.paintFactionPath = null;
    this.updateToolbarButtonStates();
  }

  private handleSwapButton(): void {
    if (this.drawingMode === "swap") {
      this.exitSwapMode();
    } else {
      this.drawingMode = "swap";
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
  private async onHexDblClick(x: number, y: number): Promise<void> {
    if (this.drawingMode === "path") {
      this.exitPathMode();
      this.updatePathOverlay();
      return;
    }
  }

  private async performSwap(pathA: string, pathB: string): Promise<void> {
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = hexBase
      ? `${hexBase}/${this.activeRegionName}`
      : this.activeRegionName;
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
    const pathA = this.plugin.hexPath(x1, y1, this.activeRegionName);
    const pathB = this.plugin.hexPath(x2, y2, this.activeRegionName);

    // Discard any pending (not-yet-started) writes for the two paths.
    // Without this the flush loop would find no file after the rename and
    // call createHexNote(), recreating a ghost file at the old position.
    this.pendingTerrainWrites.delete(pathA);
    this.pendingTerrainWrites.delete(pathB);
    this.pendingIconWrites.delete(pathA);
    this.pendingIconWrites.delete(pathB);

    // Wait for any already-in-flight flushes on these paths to finish before
    // renaming files — a flush that completes after the rename would write
    // terrain to the wrong file or recreate a file that was just moved.
    const flushKeys = [`t:${pathA}`, `t:${pathB}`, `i:${pathA}`, `i:${pathB}`];
    const deadline = Date.now() + 2000;
    while (
      flushKeys.some((k) => this.flushing.has(k)) &&
      Date.now() < deadline
    ) {
      await new Promise<void>((r) => setTimeout(r, 30));
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
        await new Promise<void>((r) => setTimeout(r, 300));
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
    this.pathToolbarBtn?.toggleClass("is-active", this.drawingMode === "path");
    // Update path button swatch color to show active type
    if (this.pathBtnSwatch) {
      const activeType = this.activePathTypeName
        ? this.plugin.settings.pathTypes.find(
            (p) => p.name === this.activePathTypeName,
          )
        : this.plugin.settings.pathTypes[0];
      if (activeType) {
        this.pathBtnSwatch.setCssProps({
          "background-color": activeType.color,
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
    this.factionLinkBtn?.toggleClass(
      "is-active",
      this.drawingMode === "factionLink",
    );
    this.swapBtn?.toggleClass("is-active", this.drawingMode === "swap");
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
        if (this.terrainToolbarBtn) {
          this.terrainToolbarBtn.setCssProps({
            "border-color": "var(--interactive-accent)",
            color: "var(--interactive-accent)",
          });
        }
        if (this.terrainBtnPreview) {
          this.terrainBtnPreview.setCssProps({ "background-color": "" });
          this.terrainBtnPreview.show();
          this.terrainBtnPreview.textContent = "⌖";
        }
      } else {
        if (this.terrainBtnPreview) this.terrainBtnPreview.textContent = "";
        const entry = this.paintTerrainName
          ? this.plugin
              .getRegionPalette(this.activeRegionName)
              .find((p) => p.name === this.paintTerrainName)
          : undefined;
        if (entry) {
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.setCssProps({ "border-color": entry.color });
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.setCssProps({
              "background-color": entry.color,
            });
            this.terrainBtnPreview.show();
          }
        } else {
          // Clear mode — show active state without a color
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.setCssProps({ "border-color": "" });
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.hide();
          }
        }
      }
    } else {
      if (this.terrainToolbarBtn) {
        this.terrainToolbarBtn.setCssProps({ "border-color": "", color: "" });
      }
      if (this.terrainBtnPreview) {
        this.terrainBtnPreview.hide();
      }
    }

    // Table link button label
    if (this.tableLinkBtnLabel) {
      if (this.drawingMode === "tableLink" && this.paintTablePath) {
        const name =
          this.paintTablePath.split("/").pop()?.replace(/.md$/, "") ?? "Table";
        this.tableLinkBtnLabel.setText("Link: " + name);
      } else {
        this.tableLinkBtnLabel.setText("Link table");
      }
    }

    // Faction link button label
    if (this.factionLinkBtnLabel) {
      if (this.drawingMode === "factionLink" && this.paintFactionPath) {
        const name =
          this.paintFactionPath.split("/").pop()?.replace(/.md$/, "") ??
          "Faction";
        this.factionLinkBtnLabel.setText("Link: " + name);
      } else {
        this.factionLinkBtnLabel.setText("Link faction");
      }
    }
  }
  private applyTransform(): void {
    if (this.viewportEl) {
      this.viewportEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
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
  }

  renderGrid(
    terrainOverrides?: Map<string, string | null>,
    iconOverrides?: Map<string, string | null>,
  ): void {
    if (!this.viewportEl) return;
    this.viewportEl.empty();

    const gap = this.plugin.settings.hexGap?.trim() || "0.15";
    this.viewportEl.style.setProperty(
      "--duckmage-hex-gap",
      /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap,
    );

    const region = this.getActiveRegion();
    const { cols, rows } = region.gridSize;
    const { x: ox, y: oy } = region.gridOffset;
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = hexBase
      ? `${hexBase}/${this.activeRegionName}`
      : this.activeRegionName;
    const palette = this.plugin.getRegionPalette(this.activeRegionName);
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const gridContainer = this.viewportEl.createDiv({
      cls: `duckmage-hex-map-grid${isFlat ? " duckmage-grid-flat" : ""}`,
    });

    const addHex = (parent: HTMLElement, x: number, y: number) => {
      const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
      const exists =
        this.app.vault.getAbstractFileByPath(path) instanceof TFile;
      const terrainKey = terrainOverrides?.has(path)
        ? terrainOverrides.get(path)!
        : getTerrainFromFile(this.app, path);
      const terrainEntry =
        terrainKey != null
          ? palette.find((p) => p.name === terrainKey)
          : undefined;

      const hexEl = parent.createDiv({
        cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
        attr: { "data-x": String(x), "data-y": String(y) },
      });
      hexEl.tabIndex = -1;

      if (terrainEntry?.color) hexEl.style.backgroundColor = terrainEntry.color;

      const iconOverride = iconOverrides?.has(path)
        ? iconOverrides.get(path)!
        : getIconOverrideFromFile(this.app, path);
      const iconToShow = iconOverride ?? terrainEntry?.icon;
      if (iconToShow) {
        const iconColor = iconOverride ? undefined : terrainEntry?.iconColor;
        createIconEl(
          hexEl,
          getIconUrl(this.plugin, iconToShow),
          terrainEntry?.name ?? "",
          iconColor,
          "duckmage-hex-icon",
        );
      }
      // Tag override icons so the SVG overlay can elevate them above roads/rivers
      if (iconOverride) hexEl.dataset.iconOverride = iconOverride;

      if (this.selectedHex?.x === x && this.selectedHex?.y === y)
        hexEl.addClass("is-selected");

      hexEl.createSpan({ cls: "duckmage-hex-label", text: `${x},${y}` });
      if (exists && !terrainEntry)
        hexEl.createSpan({ cls: "duckmage-hex-dot" });

      hexEl.addEventListener("click", () => this.onHexClick(x, y));
      hexEl.addEventListener("dblclick", () => this.onHexDblClick(x, y));
      hexEl.addEventListener("contextmenu", (evt) =>
        this.onHexContextMenu(evt, x, y),
      );
    };

    if (isFlat) {
      // Flat-top: iterate columns; odd columns shift down by half hex height
      for (let i = 0; i < cols; i++) {
        const x = ox + i;
        const colEl = gridContainer.createDiv({
          cls: `duckmage-hex-col${x % 2 !== 0 ? " duckmage-hex-col-offset" : ""}`,
        });
        for (let j = 0; j < rows; j++) {
          addHex(colEl, x, oy + j);
        }
      }
    } else {
      // Pointy-top: iterate rows; odd rows shift right by half hex width
      for (let j = 0; j < rows; j++) {
        const y = oy + j;
        const rowEl = gridContainer.createDiv({
          cls: `duckmage-hex-row${y % 2 !== 0 ? " duckmage-hex-row-offset" : ""}`,
        });
        for (let i = 0; i < cols; i++) {
          addHex(rowEl, ox + i, y);
        }
      }
    }

    this.renderPathOverlay(gridContainer);
  }

  private openHexEditorModal(x: number, y: number): void {
    this.setSelectedHex(x, y);
    const modal = new HexEditorModal(
      this.app,
      this.plugin,
      x,
      y,
      this.activeRegionName,
      (t, i) => {
        if (t !== undefined || i !== undefined) {
          this.renderGrid(t, i);
        } else {
          setTimeout(() => this.renderGrid(), 300);
        }
      },
      (nx, ny) => this.setSelectedHex(nx, ny),
      () => {
        if (this.selectedHex) {
          this.viewportEl
            ?.querySelector<HTMLElement>(
              `[data-x="${this.selectedHex.x}"][data-y="${this.selectedHex.y}"]`,
            )
            ?.removeClass("is-selected");
          this.selectedHex = null;
        }
      },
    );
    modal.open();
  }

  private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
    evt.preventDefault();
    if (this.drawingMode === "path") {
      void this.onHexPathDeleteClick(x, y);
      return;
    }
    if (this.drawingMode === "swap") {
      this.exitSwapMode();
      return;
    }

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
          const path = this.plugin.hexPath(x, y, this.activeRegionName);
          const existing = this.app.vault.getAbstractFileByPath(path);
          const file =
            existing instanceof TFile
              ? existing
              : await this.plugin.createHexNote(x, y, this.activeRegionName);
          if (file) await this.app.workspace.getLeaf().openFile(file);
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

    menu.showAtMouseEvent(evt);
  }

  private async onHexClick(x: number, y: number): Promise<void> {
    if (this.drawingMode === "path") {
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
    if (this.drawingMode === "factionLink") {
      await this.onHexFactionLinkClick(x, y);
      return;
    }
    if (this.drawingMode === "swap") {
      await this.onHexSwapClick(x, y);
      return;
    }

    this.openHexEditorModal(x, y);
  }

  private getBrushHexes(x: number, y: number): [number, number][] {
    const center: [number, number] = [x, y];
    if (this.paintBrushSize === 1) return [center];
    const nb = hexNeighbors(x, y, this.plugin.settings.hexOrientation);
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
    if (this.terrainPickMode) {
      const sampled = getTerrainFromFile(
        this.app,
        this.plugin.hexPath(x, y, this.activeRegionName),
      );
      this.terrainPickMode = false;
      this.paintTerrainName = sampled;
      this.updateToolbarButtonStates();
      return;
    }

    const terrain = this.paintTerrainName;
    const palette = this.plugin.getRegionPalette(this.activeRegionName);
    const entry =
      terrain != null ? palette.find((p) => p.name === terrain) : undefined;

    for (const [hx, hy] of this.getBrushHexes(x, y)) {
      // ── Immediate visual update — no waiting for file I/O ───────────────
      const hexEl = this.viewportEl?.querySelector<HTMLElement>(
        `[data-x="${hx}"][data-y="${hy}"]`,
      );
      if (hexEl) {
        hexEl.style.backgroundColor = entry?.color ?? "";
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
            hexEl.querySelector(".duckmage-hex-label"),
          );
        }
        if (terrain !== null) hexEl.addClass("duckmage-hex-exists");
      }

      // ── Queue background file write (coalescing per-hex) ────────────────
      const path = this.plugin.hexPath(hx, hy, this.activeRegionName);
      if (this.currentTerrainStroke) {
        if (!this.currentTerrainStroke.has(path)) {
          const oldTerrain =
            (
              this.app.metadataCache.getCache(path)?.frontmatter as
                | Frontmatter
                | undefined
            )?.terrain ?? null;
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

  private onHexIconClick(x: number, y: number): void {
    if (this.drawingMode !== "icon") return;
    const icon = this.paintIconName;
    const path = this.plugin.hexPath(x, y, this.activeRegionName);

    // ── Immediate visual update ────────────────────────────────────────────
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) {
      hexEl.querySelector(".duckmage-hex-icon")?.remove();
      if (icon) {
        const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = icon;
        hexEl.insertBefore(img, hexEl.querySelector(".duckmage-hex-label"));
        hexEl.dataset.iconOverride = icon;
      } else {
        delete hexEl.dataset.iconOverride;
      }
      if (icon !== null) hexEl.addClass("duckmage-hex-exists");
    }
    this.updatePathOverlay();

    // ── Queue background file write (coalescing per-hex) ──────────────────
    this.scheduleIconWrite(x, y, path, icon);
  }

  private async onHexTableLinkClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "tableLink" || !this.paintTablePath) return;
    const hexPath = this.plugin.hexPath(x, y, this.activeRegionName);
    const tableFile = this.app.vault.getAbstractFileByPath(this.paintTablePath);
    if (!(tableFile instanceof TFile)) return;

    // Ensure the hex note exists
    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y, this.activeRegionName);
      if (!(hexFile instanceof TFile)) return;
    }

    const target = this.app.metadataCache.fileToLinktext(tableFile, hexPath);
    const linkText = `[[${target}]]`;

    // Idempotent — only add if not already present
    const existing = await getLinksInSection(
      this.app,
      hexPath,
      "Encounters Table",
    );
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
      if (!hexEl.querySelector(".duckmage-hex-link-badge")) {
        hexEl.createSpan({ cls: "duckmage-hex-link-badge", text: "📋" });
      }
      const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
      blip.addEventListener("animationend", () => blip.remove(), {
        once: true,
      });
    }
  }

  private async onHexFactionLinkClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "factionLink" || !this.paintFactionPath) return;
    const hexPath = this.plugin.hexPath(x, y, this.activeRegionName);
    const factionFile = this.app.vault.getAbstractFileByPath(
      this.paintFactionPath,
    );
    if (!(factionFile instanceof TFile)) return;

    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y, this.activeRegionName);
      if (!(hexFile instanceof TFile)) return;
    }

    const target = this.app.metadataCache.fileToLinktext(factionFile, hexPath);
    const linkText = `[[${target}]]`;
    const existing = await getLinksInSection(this.app, hexPath, "Factions");
    if (existing.includes(target)) {
      new Notice(`Already linked on ${x},${y}`);
      return;
    }

    await addLinkToSection(this.app, hexPath, "Factions", linkText);

    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) {
      hexEl.addClass("duckmage-hex-exists");
      const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
      blip.addEventListener("animationend", () => blip.remove(), {
        once: true,
      });
    }
  }

  // ── Per-hex coalescing write queues ────────────────────────────────────────
  //
  // Only the *latest* painted value is ever queued per hex. If the user repaints
  // hex A five times while the first write is in-flight, we perform exactly two
  // writes: the in-flight one and then the final value. No writes are lost; no
  // stale intermediate value can overwrite a newer one.

  private applyTerrainToHexEl(
    hexEl: HTMLElement,
    terrain: string | null,
  ): void {
    const palette = this.plugin.getRegionPalette(this.activeRegionName);
    const entry =
      terrain != null ? palette.find((p) => p.name === terrain) : undefined;
    hexEl.style.backgroundColor = entry?.color ?? "";
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
        hexEl.insertBefore(iconEl, hexEl.querySelector(".duckmage-hex-label"));
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
    this.redoStack = []; // new paint invalidates redo history
    this.currentTerrainStroke = null;
    this.updateUndoButton();
  }

  private async undo(): Promise<void> {
    const item = this.undoStack.pop();
    if (!item) return;
    this.redoStack.push(item);
    if (item.kind === "terrain") {
      this.applyStroke(item.entries, "old");
    } else if (item.kind === "swap") {
      await this.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else {
      await this.applyPathSnapshot(item.regionName, item.before);
    }
    this.updateUndoButton();
  }

  private async redo(): Promise<void> {
    const item = this.redoStack.pop();
    if (!item) return;
    this.undoStack.push(item);
    if (item.kind === "terrain") {
      this.applyStroke(item.entries, "new");
    } else if (item.kind === "swap") {
      await this.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else {
      await this.applyPathSnapshot(item.regionName, item.after);
    }
    this.updateUndoButton();
  }

  private async applyPathSnapshot(
    regionName: string,
    chains: PathChain[],
  ): Promise<void> {
    const region = this.plugin.getRegion(regionName);
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

  private updateUndoButton(): void {
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
  }

  private updateSavingIndicator(): void {
    const count =
      this.pendingTerrainWrites.size +
      this.pendingIconWrites.size +
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
              setTimeout(r, Math.min(200 * (1 << (attempt - 1)), 2000)),
            );
          try {
            const onDisk = !!this.app.vault.getAbstractFileByPath(path);
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
                    this.activeRegionName,
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
              setTimeout(r, Math.min(200 * (1 << (attempt - 1)), 2000)),
            );
          try {
            const onDisk = !!this.app.vault.getAbstractFileByPath(path);
            if (icon === null) {
              if (onDisk) await setIconOverrideInFile(this.app, path, null);
            } else {
              if (!onDisk) {
                if (
                  !(await this.plugin.createHexNote(
                    x,
                    y,
                    this.activeRegionName,
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

  private handlePathButton(): void {
    new PathPickerModal(
      this.app,
      this.plugin,
      this.activePathTypeName,
      (typeName) => {
        this.activePathTypeName = typeName;
        this.drawingMode = "path";
        this.updateToolbarButtonStates();
        this.updatePathOverlay();
      },
      () => {
        if (this.drawingMode !== "path") this.updateToolbarButtonStates();
      },
    ).open();
  }

  /** Deep-clone a pathChains array for undo/redo snapshot. */
  private cloneChains(chains: PathChain[]): PathChain[] {
    return chains.map((c) => ({ typeName: c.typeName, hexes: [...c.hexes] }));
  }

  private pushPathUndo(
    regionName: string,
    before: PathChain[],
    after: PathChain[],
  ): void {
    this.undoStack.push({ kind: "path", regionName, before, after });
    if (this.undoStack.length > this.UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButton();
  }

  private async onHexPathDrawClick(x: number, y: number): Promise<void> {
    if (!this.activePathTypeName) return;
    const key = `${x}_${y}`;
    const region = this.getActiveRegion();
    const chains = region.pathChains.filter(
      (c) => c.typeName === this.activePathTypeName,
    );
    const before = this.cloneChains(region.pathChains);

    // ── If adjacent to active end, extend that chain ─────────────────────
    if (this.activePathEnd !== null) {
      const [ax, ay] = this.activePathEnd.split("_").map(Number);
      const isAdjacent = hexNeighbors(ax, ay, this.plugin.settings.hexOrientation).some(
        ([nx, ny]) => nx === x && ny === y,
      );
      if (isAdjacent) {
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

  private async onHexPathDeleteClick(x: number, y: number): Promise<void> {
    const key = `${x}_${y}`;
    const region = this.getActiveRegion();
    const chains = this.activePathTypeName
      ? region.pathChains.filter((c) => c.typeName === this.activePathTypeName)
      : region.pathChains;
    const before = this.cloneChains(region.pathChains);

    for (let ci = 0; ci < chains.length; ci++) {
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
        this.activePathEnd = null;
        this.activePathChain = null;
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

    const region = this.getActiveRegion();
    const hasContent =
      region.pathChains.some((c) => c.hexes.length > 0) ||
      this.activePathEnd !== null;
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
        while (cur && cur !== this.viewportEl) {
          ox += cur.offsetLeft;
          oy += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        centerMap.set(`${x}_${y}`, { cx: ox, cy: oy });
      });

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
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
      const path = document.createElementNS(svgNS, "path");
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

    // Draw all path types in definition order
    for (const pt of this.plugin.settings.pathTypes) {
      const typeChains = region.pathChains.filter(
        (c) => c.typeName === pt.name,
      );
      const dash = DASH_ARRAYS[pt.lineStyle] ?? "";
      for (const chain of typeChains) {
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
        if (pts.length >= 2) appendPath(pts, pt.color, pt.width, dash, smooth);
      }
    }

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
        const circle = document.createElementNS(svgNS, "circle");
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
        const imgEl = document.createElementNS(svgNS, "image");
        const iconW = hexEl.offsetWidth * 0.78;
        const iconH = hexEl.offsetHeight * 0.78;
        imgEl.setAttribute("x", String(pos.cx - iconW / 2));
        imgEl.setAttribute("y", String(pos.cy - iconH / 2));
        imgEl.setAttribute("width", String(iconW));
        imgEl.setAttribute("height", String(iconH));
        imgEl.setAttribute("href", getIconUrl(this.plugin, iconName));
        imgEl.setAttribute("opacity", "0.75");
        svg.appendChild(imgEl);
      });

    // Render all hex coordinate labels as SVG text so they sit above roads,
    // rivers, and icons regardless of CSS stacking context.
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hexEl) => {
        const x = hexEl.dataset.x!;
        const y = hexEl.dataset.y!;
        const pos = centerMap.get(`${x}_${y}`);
        if (!pos) return;
        const hasTerrain = !!hexEl.style.backgroundColor;
        const textEl = document.createElementNS(svgNS, "text");
        textEl.setAttribute("x", String(pos.cx));
        // Nudge label toward bottom of hex (same visual position as the HTML label)
        textEl.setAttribute("y", String(pos.cy + hexEl.offsetHeight * 0.28));
        textEl.setAttribute("text-anchor", "middle");
        textEl.setAttribute("dominant-baseline", "middle");
        textEl.setAttribute("font-size", String(hexEl.offsetHeight * 0.12));
        textEl.setAttribute("font-weight", "600");
        if (hasTerrain) {
          textEl.setAttribute("fill", "#ffffff");
          textEl.setAttribute("paint-order", "stroke");
          textEl.setAttribute("stroke", "rgba(0,0,0,0.85)");
          textEl.setAttribute("stroke-width", "2");
          textEl.setAttribute("stroke-linejoin", "round");
        } else {
          textEl.setAttribute("fill", "var(--text-muted)");
        }
        textEl.setAttribute("pointer-events", "none");
        textEl.textContent = `${x},${y}`;
        svg.appendChild(textEl);
      });

    this.viewportEl?.addClass("duckmage-svg-labels-active");
    this.viewportEl?.appendChild(svg);
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
}


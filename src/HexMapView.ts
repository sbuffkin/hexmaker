import { App, ItemView, MarkdownRenderer, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import HELP_CONTENT from "./help.md";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder, getIconUrl } from "./utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  setTerrainInFile,
  setIconOverrideInFile,
} from "./frontmatter";
import { HexEditorModal } from "./HexEditorModal";
import { TerrainPickerModal } from "./TerrainPickerModal";
import { IconPickerModal } from "./IconPickerModal";
import { addLinkToSection, getLinksInSection } from "./sections";
import {
  VIEW_TYPE_HEX_MAP,
  VIEW_TYPE_HEX_TABLE,
  VIEW_TYPE_RANDOM_TABLES,
} from "./constants";

export class HexMapView extends ItemView {
  plugin: DuckmagePlugin;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private viewportEl: HTMLElement | null = null;
  private drawingMode:
    | "road"
    | "river"
    | "terrain"
    | "icon"
    | "tableLink"
    | "factionLink"
    | "swap"
    | null = null;
  private roadToolbarBtn: HTMLButtonElement | null = null;
  private riverToolbarBtn: HTMLButtonElement | null = null;
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
  private activeRoadEnd: string | null = null;
  private activeRiverEnd: string | null = null;
  private activeRoadChain: string[] | null = null;
  private activeRiverChain: string[] | null = null;
  private paintTerrainName: string | null = null;
  private paintIconName: string | null = null;
  private terrainPickMode = false;
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

  constructor(leaf: WorkspaceLeaf, plugin: DuckmagePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HEX_MAP;
  }
  getDisplayText(): string {
    return "Hex map";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("duckmage-hex-map-container");

    // clipEl clips the panning viewport; controlsEl overlays buttons without clipping
    const clipEl = contentEl.createDiv({ cls: "duckmage-hex-map-clip" });
    const controlsEl = contentEl.createDiv({
      cls: "duckmage-hex-map-controls",
    });

    this.viewportEl = clipEl.createDiv({ cls: "duckmage-hex-map-viewport" });
    this.applyTransform();

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
        }
        return;
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
        if (
          onHex &&
          (this.drawingMode === "road" || this.drawingMode === "river")
        )
          return;
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
            this.drawingMode = null;
            this.updateToolbarButtonStates();
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

    this.createExpandButtons(controlsEl);
    this.createDrawingToolbar(controlsEl);

    const tableBtn = controlsEl.createEl("button", {
      cls: "duckmage-table-btn",
      title: "Open hex table",
      text: "⊞",
    });
    tableBtn.addEventListener("click", () => {
      this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_HEX_TABLE });
    });

    const rtBtn = controlsEl.createEl("button", {
      cls: "duckmage-rt-btn",
      title: "Open random tables",
      text: "🎲",
    });
    rtBtn.addEventListener("click", () => {
      this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
    });

    const gotoBtn = controlsEl.createEl("button", {
      cls: "duckmage-goto-btn",
      title: "Go to hex",
      text: "⌖",
    });
    gotoBtn.addEventListener("click", () => {
      new GotoHexModal(this.app, (x, y) => this.centerOnHex(x, y)).open();
    });

    const helpBtn = controlsEl.createEl("button", {
      cls: "duckmage-help-btn",
      title: "Controls & tools",
      text: "?",
    });
    helpBtn.addEventListener("click", () => new HexHelpModal(this.app).open());

    this.renderGrid();
  }

  private createExpandButtons(container: HTMLElement): void {
    const dirs = [
      {
        cls: "duckmage-expand-top",
        action: async () => {
          this.plugin.settings.gridOffset.y--;
          this.plugin.settings.gridSize.rows++;
          await this.plugin.saveSettings();
          this.renderGrid();
        },
      },
      {
        cls: "duckmage-expand-bottom",
        action: async () => {
          this.plugin.settings.gridSize.rows++;
          await this.plugin.saveSettings();
          this.renderGrid();
        },
      },
      {
        cls: "duckmage-expand-left",
        action: async () => {
          this.plugin.settings.gridOffset.x--;
          this.plugin.settings.gridSize.cols++;
          await this.plugin.saveSettings();
          this.renderGrid();
        },
      },
      {
        cls: "duckmage-expand-right",
        action: async () => {
          this.plugin.settings.gridSize.cols++;
          await this.plugin.saveSettings();
          this.renderGrid();
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
    this.roadToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn",
      text: "Road",
    });
    this.riverToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn",
      text: "River",
    });
    this.terrainToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.terrainToolbarBtn.createSpan({ text: "Terrain" });
    this.terrainBtnPreview = this.terrainToolbarBtn.createSpan({
      cls: "duckmage-terrain-btn-preview",
    });
    this.iconToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.iconToolbarBtn.createSpan({ text: "Icon" });
    this.iconBtnPreview = this.iconToolbarBtn.createEl("img", {
      cls: "duckmage-icon-btn-preview",
    });
    this.tableLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.tableLinkBtnLabel = this.tableLinkBtn.createSpan({
      text: "Link Table",
    });
    this.factionLinkBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    this.factionLinkBtnLabel = this.factionLinkBtn.createSpan({
      text: "Link Faction",
    });
    this.swapBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn",
      text: "Swap Hexes",
    });

    this.roadToolbarBtn.addEventListener("click", () =>
      this.setDrawingMode("road"),
    );
    this.riverToolbarBtn.addEventListener("click", () =>
      this.setDrawingMode("river"),
    );
    this.terrainToolbarBtn.addEventListener("click", () =>
      this.handleTerrainButton(),
    );
    this.iconToolbarBtn.addEventListener("click", () =>
      this.handleIconButton(),
    );
    this.tableLinkBtn.addEventListener("click", () =>
      this.handleTableLinkButton(),
    );
    this.factionLinkBtn.addEventListener("click", () =>
      this.handleFactionLinkButton(),
    );
    this.swapBtn.addEventListener("click", () => this.handleSwapButton());
  }

  private setDrawingMode(mode: "road" | "river"): void {
    this.drawingMode = this.drawingMode === mode ? null : mode;
    this.paintTerrainName = null;
    this.paintIconName = null;
    this.updateToolbarButtonStates();
    this.updateRoadRiverOverlay(); // refresh active-end marker visibility
  }

  private handleTerrainButton(): void {
    // Show crosshair on the viewport while the picker is open
    this.viewportEl?.addClass("duckmage-terrain-picking");

    // Always open the picker — even if already active, so user can switch terrain
    new TerrainPickerModal(
      this.app,
      this.plugin,
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
    ).open();
  }

  private exitTerrainMode(): void {
    if (this.drawingMode !== "terrain") return;
    this.drawingMode = null;
    this.paintTerrainName = null;
    this.terrainPickMode = false;
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
    this.updateToolbarButtonStates();
  }

  private handleTableLinkButton(): void {
    new TablePickerModal(this.app, this.plugin, (file) => {
      this.drawingMode = "tableLink";
      this.paintTablePath = file.path;
      this.updateToolbarButtonStates();
    }).open();
  }

  private exitTableLinkMode(): void {
    if (this.drawingMode !== "tableLink") return;
    this.drawingMode = null;
    this.paintTablePath = null;
    this.updateToolbarButtonStates();
  }

  private handleFactionLinkButton(): void {
    new FactionPickerModal(this.app, this.plugin, (file) => {
      this.drawingMode = "factionLink";
      this.paintFactionPath = file.path;
      this.updateToolbarButtonStates();
    }).open();
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
    hexEl.querySelector(".duckmage-hex-swap-source, .duckmage-hex-swap-dest")?.remove();
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

    const src = this.swapSource;

    // Clicking the source again: cancel selection entirely
    if (x === src.x && y === src.y) {
      this.swapSource = null;
      this.swapDest = null;
      this.clearSwapHighlights();
      return;
    }

    // Clicking the current dest again (at any speed): confirm the swap
    if (this.swapDest && x === this.swapDest.x && y === this.swapDest.y) {
      const src = { ...this.swapSource };
      const dst = { ...this.swapDest };
      this.swapSource = null;
      this.swapDest = null;
      this.clearSwapHighlights();
      await this.executeHexSwap(src.x, src.y, dst.x, dst.y);
      return;
    }

    // Set or change destination
    // Clear old dest overlay (but keep source overlay)
    this.viewportEl
      ?.querySelectorAll(".duckmage-hex-swap-dest")
      .forEach((el) => el.remove());
    this.swapDest = { x, y };
    this.highlightSwapHex(x, y, "duckmage-hex-swap-dest");
  }

  // Double-click on the destination confirms the swap
  private async onHexDblClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "swap") return;
    if (!this.swapSource || !this.swapDest) return;
    if (x !== this.swapDest.x || y !== this.swapDest.y) return;

    const src = { ...this.swapSource };
    const dst = { ...this.swapDest };
    this.swapSource = null;
    this.swapDest = null;
    this.clearSwapHighlights();

    await this.executeHexSwap(src.x, src.y, dst.x, dst.y);
    // Stay in swap mode for chained swaps
  }

  private async performSwap(pathA: string, pathB: string): Promise<void> {
    const folder = normalizeFolder(this.plugin.settings.hexFolder);
    const tempPath = folder ? `${folder}/__swap_tmp.md` : `__swap_tmp.md`;

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

    if (hasA && !hasB) {
      await this.app.vault.rename(fileA, pathB);
    } else if (!hasA && hasB) {
      await this.app.vault.rename(fileB as TFile, pathA);
    } else {
      await this.app.vault.rename(fileA as TFile, tempPath);
      await this.app.vault.rename(fileB as TFile, pathA);
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
  ): Promise<void> {
    const pathA = this.plugin.hexPath(x1, y1);
    const pathB = this.plugin.hexPath(x2, y2);

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
    const flushKeys = [
      `t:${pathA}`, `t:${pathB}`,
      `i:${pathA}`, `i:${pathB}`,
    ];
    const deadline = Date.now() + 2000;
    while (flushKeys.some(k => this.flushing.has(k)) && Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, 30));
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.performSwap(pathA, pathB);
        break;
      } catch (e) {
        if (attempt === 2) {
          new Notice(`Swap failed: ${e instanceof Error ? e.message : String(e)}`);
          this.renderGrid();
          return;
        }
        await new Promise<void>((r) => setTimeout(r, 300));
      }
    }

    // Immediate re-render so the map reflects the swap
    this.renderGrid();

    // Blip both positions in the freshly rendered grid
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      const hexEl = this.viewportEl?.querySelector<HTMLElement>(
        `[data-x="${x}"][data-y="${y}"]`,
      );
      if (hexEl) {
        const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
        blip.addEventListener("animationend", () => blip.remove(), { once: true });
      }
    }
  }

  private updateToolbarButtonStates(): void {
    this.roadToolbarBtn?.toggleClass("is-active", this.drawingMode === "road");
    this.riverToolbarBtn?.toggleClass(
      "is-active",
      this.drawingMode === "river",
    );
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
        this.iconBtnPreview.style.display = "inline-block";
      }
    } else {
      if (this.iconBtnPreview) this.iconBtnPreview.style.display = "none";
    }
    if (this.drawingMode === "terrain") {
      if (this.terrainPickMode) {
        // Eyedropper waiting for a click — show ⌖ as the preview
        if (this.terrainToolbarBtn) {
          this.terrainToolbarBtn.style.borderColor =
            "var(--interactive-accent)";
          this.terrainToolbarBtn.style.color = "var(--interactive-accent)";
        }
        if (this.terrainBtnPreview) {
          this.terrainBtnPreview.style.backgroundColor = "";
          this.terrainBtnPreview.style.display = "inline-block";
          this.terrainBtnPreview.textContent = "⌖";
        }
      } else {
        if (this.terrainBtnPreview) this.terrainBtnPreview.textContent = "";
        const entry = this.paintTerrainName
          ? this.plugin.settings.terrainPalette.find(
              (p) => p.name === this.paintTerrainName,
            )
          : undefined;
        if (entry) {
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.style.borderColor = entry.color;
            this.terrainToolbarBtn.style.color = entry.color;
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.style.backgroundColor = entry.color;
            this.terrainBtnPreview.style.display = "inline-block";
          }
        } else {
          // Clear mode — show active state without a color
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.style.borderColor = "";
            this.terrainToolbarBtn.style.color = "";
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.style.display = "none";
          }
        }
      }
    } else {
      if (this.terrainToolbarBtn) {
        this.terrainToolbarBtn.style.borderColor = "";
        this.terrainToolbarBtn.style.color = "";
      }
      if (this.terrainBtnPreview) {
        this.terrainBtnPreview.style.display = "none";
      }
    }

    // Table link button label
    if (this.tableLinkBtnLabel) {
      if (this.drawingMode === "tableLink" && this.paintTablePath) {
        const name =
          this.paintTablePath.split("/").pop()?.replace(/.md$/, "") ?? "Table";
        this.tableLinkBtnLabel.setText("Link: " + name);
      } else {
        this.tableLinkBtnLabel.setText("Link Table");
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
        this.factionLinkBtnLabel.setText("Link Faction");
      }
    }
  }
  private applyTransform(): void {
    if (this.viewportEl) {
      this.viewportEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
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
    const hexRect  = hexEl.getBoundingClientRect();
    const clipRect = clipEl.getBoundingClientRect();

    // Back-compute the hex centre in pre-transform viewport coordinates
    const hexScreenX = hexRect.left + hexRect.width  / 2;
    const hexScreenY = hexRect.top  + hexRect.height / 2;
    const hexViewX = (hexScreenX - clipRect.left - this.panX) / this.zoom;
    const hexViewY = (hexScreenY - clipRect.top  - this.panY) / this.zoom;

    const targetZoom = 1.5;
    this.zoom = targetZoom;
    this.panX = clipRect.width  / 2 - hexViewX * targetZoom;
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

    const { cols, rows } = this.plugin.settings.gridSize;
    const { x: ox, y: oy } = this.plugin.settings.gridOffset;
    const folder = normalizeFolder(this.plugin.settings.hexFolder);
    const palette = this.plugin.settings.terrainPalette ?? [];
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
        const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
        img.src = getIconUrl(this.plugin, iconToShow);
        img.alt = terrainEntry?.name ?? "";
      }
      // Tag override icons so the SVG overlay can elevate them above roads/rivers
      if (iconOverride) hexEl.dataset.iconOverride = iconOverride;

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

    this.renderRoadRiverOverlay(gridContainer);
  }

  private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
    evt.preventDefault();
    if (this.drawingMode === "road" || this.drawingMode === "river") {
      this.onHexDeleteClick(x, y);
      return;
    }
    new HexEditorModal(this.app, this.plugin, x, y, (t, i) => {
      if (t !== undefined || i !== undefined) {
        // Terrain/icon changed — immediate update with explicit overrides avoids cache race
        this.renderGrid(t, i);
      } else {
        // Link-only change — defer so metadata cache has time to repopulate after vault.modify
        setTimeout(() => this.renderGrid(), 300);
      }
    }).open();
  }

  private async onHexClick(x: number, y: number): Promise<void> {
    if (this.drawingMode === "road" || this.drawingMode === "river") {
      await this.onHexDrawClick(x, y);
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

    const path = this.plugin.hexPath(x, y);
    const abstract = this.app.vault.getAbstractFileByPath(path);
    let fileToOpen: TFile | null = abstract instanceof TFile ? abstract : null;

    if (!fileToOpen) {
      fileToOpen = await this.plugin.createHexNote(x, y);
      if (fileToOpen) this.renderGrid();
      else return;
    }

    await this.app.workspace.getLeaf(false).openFile(fileToOpen);
  }

  private onHexPaintClick(x: number, y: number): void {
    if (this.drawingMode !== "terrain") return;

    // Eyedropper pick mode: sample this hex's terrain and switch to painting it
    if (this.terrainPickMode) {
      const sampled = getTerrainFromFile(this.app, this.plugin.hexPath(x, y));
      this.terrainPickMode = false;
      this.paintTerrainName = sampled;
      this.updateToolbarButtonStates();
      return;
    }

    const terrain = this.paintTerrainName;
    const path = this.plugin.hexPath(x, y);
    const palette = this.plugin.settings.terrainPalette ?? [];
    const entry =
      terrain != null ? palette.find((p) => p.name === terrain) : undefined;

    // ── Immediate visual update — no waiting for file I/O ─────────────────
    const hexEl = this.viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) {
      hexEl.style.backgroundColor = entry?.color ?? "";
      hexEl.querySelector(".duckmage-hex-icon")?.remove();
      hexEl.querySelector(".duckmage-hex-dot")?.remove();
      if (entry?.icon) {
        const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
        img.src = getIconUrl(this.plugin, entry.icon);
        img.alt = entry.name;
        hexEl.insertBefore(img, hexEl.querySelector(".duckmage-hex-label"));
      }
      if (terrain !== null) hexEl.addClass("duckmage-hex-exists");
    }

    // ── Queue background file write (coalescing per-hex) ──────────────────
    this.scheduleTerrainWrite(x, y, path, terrain);
  }

  private onHexIconClick(x: number, y: number): void {
    if (this.drawingMode !== "icon") return;
    const icon = this.paintIconName;
    const path = this.plugin.hexPath(x, y);

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
    this.updateRoadRiverOverlay();

    // ── Queue background file write (coalescing per-hex) ──────────────────
    this.scheduleIconWrite(x, y, path, icon);
  }

  private async onHexTableLinkClick(x: number, y: number): Promise<void> {
    if (this.drawingMode !== "tableLink" || !this.paintTablePath) return;
    const hexPath = this.plugin.hexPath(x, y);
    const tableFile = this.app.vault.getAbstractFileByPath(this.paintTablePath);
    if (!(tableFile instanceof TFile)) return;

    // Ensure the hex note exists
    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y);
      if (!(hexFile instanceof TFile)) return;
    }

    const linkText = `[[${this.app.metadataCache.fileToLinktext(tableFile, hexPath)}]]`;

    // Idempotent — only add if not already present
    const existing = await getLinksInSection(
      this.app,
      hexPath,
      "Encounters Table",
    );
    const target = this.app.metadataCache.fileToLinktext(tableFile, hexPath);
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
    const hexPath = this.plugin.hexPath(x, y);
    const factionFile = this.app.vault.getAbstractFileByPath(
      this.paintFactionPath,
    );
    if (!(factionFile instanceof TFile)) return;

    let hexFile = this.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.plugin.createHexNote(x, y);
      if (!(hexFile instanceof TFile)) return;
    }

    const linkText = `[[${this.app.metadataCache.fileToLinktext(factionFile, hexPath)}]]`;
    const existing = await getLinksInSection(this.app, hexPath, "Factions");
    const target = this.app.metadataCache.fileToLinktext(factionFile, hexPath);
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

  private scheduleTerrainWrite(
    x: number,
    y: number,
    path: string,
    terrain: string | null,
  ): void {
    this.pendingTerrainWrites.set(path, { x, y, terrain });
    if (!this.flushing.has(`t:${path}`)) void this.flushTerrainWrites(path);
  }

  private async flushTerrainWrites(path: string): Promise<void> {
    const key = `t:${path}`;
    this.flushing.add(key);
    try {
      while (this.pendingTerrainWrites.has(path)) {
        const { x, y, terrain } = this.pendingTerrainWrites.get(path)!;
        this.pendingTerrainWrites.delete(path);
        try {
          if (terrain === null) {
            if (this.app.vault.getAbstractFileByPath(path) instanceof TFile)
              await setTerrainInFile(this.app, path, null);
          } else {
            if (
              !(this.app.vault.getAbstractFileByPath(path) instanceof TFile)
            ) {
              if (!(await this.plugin.createHexNote(x, y))) {
                // Note creation failed — reconcile visual with disk state
                this.renderGrid();
                return;
              }
              this.viewportEl
                ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
                ?.addClass("duckmage-hex-exists");
            }
            await setTerrainInFile(this.app, path, terrain);
          }
        } catch (err) {
          console.error(`[duckmage] terrain write failed for ${path}:`, err);
          this.renderGrid(); // reconcile visual with disk state
          return;
        }
      }
    } finally {
      this.flushing.delete(key);
    }
  }

  private scheduleIconWrite(
    x: number,
    y: number,
    path: string,
    icon: string | null,
  ): void {
    this.pendingIconWrites.set(path, { x, y, icon });
    if (!this.flushing.has(`i:${path}`)) void this.flushIconWrites(path);
  }

  private async flushIconWrites(path: string): Promise<void> {
    const key = `i:${path}`;
    this.flushing.add(key);
    try {
      while (this.pendingIconWrites.has(path)) {
        const { x, y, icon } = this.pendingIconWrites.get(path)!;
        this.pendingIconWrites.delete(path);
        try {
          if (icon === null) {
            if (this.app.vault.getAbstractFileByPath(path) instanceof TFile)
              await setIconOverrideInFile(this.app, path, null);
          } else {
            if (
              !(this.app.vault.getAbstractFileByPath(path) instanceof TFile)
            ) {
              if (!(await this.plugin.createHexNote(x, y))) {
                this.renderGrid();
                return;
              }
              this.viewportEl
                ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
                ?.addClass("duckmage-hex-exists");
            }
            await setIconOverrideInFile(this.app, path, icon);
          }
        } catch (err) {
          console.error(`[duckmage] icon write failed for ${path}:`, err);
          this.renderGrid();
          return;
        }
      }
    } finally {
      this.flushing.delete(key);
    }
  }

  private async onHexDrawClick(x: number, y: number): Promise<void> {
    const key = `${x}_${y}`;
    const chains =
      this.drawingMode === "road"
        ? this.plugin.settings.roadChains
        : this.plugin.settings.riverChains;
    const activeEnd =
      this.drawingMode === "road" ? this.activeRoadEnd : this.activeRiverEnd;
    const activeChain =
      this.drawingMode === "road"
        ? this.activeRoadChain
        : this.activeRiverChain;

    // ── If adjacent to active end, extend that chain ─────────────────────
    if (activeEnd !== null) {
      const [ax, ay] = activeEnd.split("_").map(Number);
      const isAdjacent = this.hexNeighbors(ax, ay).some(
        ([nx, ny]) => nx === x && ny === y,
      );
      if (isAdjacent) {
        // Prefer tracked reference; fall back to last-element scan
        let target: string[] | undefined;
        if (
          activeChain !== null &&
          activeChain[activeChain.length - 1] === activeEnd
        ) {
          target = activeChain;
        } else {
          target = chains.find((c) => c[c.length - 1] === activeEnd);
        }
        if (target) {
          target.push(key);
          if (this.drawingMode === "road") {
            this.activeRoadEnd = key;
            this.activeRoadChain = target;
          } else {
            this.activeRiverEnd = key;
            this.activeRiverChain = target;
          }
          await this.plugin.saveSettings();
          this.updateRoadRiverOverlay();
          return;
        }
      }
    }

    // ── Not adjacent (or no active chain) — start a new chain ────────────
    const newChain = [key];
    chains.push(newChain);
    if (this.drawingMode === "road") {
      this.activeRoadEnd = key;
      this.activeRoadChain = newChain;
    } else {
      this.activeRiverEnd = key;
      this.activeRiverChain = newChain;
    }
    await this.plugin.saveSettings();
    this.updateRoadRiverOverlay();
  }

  private async onHexDeleteClick(x: number, y: number): Promise<void> {
    const key = `${x}_${y}`;
    const chains =
      this.drawingMode === "road"
        ? this.plugin.settings.roadChains
        : this.plugin.settings.riverChains;

    for (let ci = 0; ci < chains.length; ci++) {
      const pos = chains[ci].indexOf(key);
      if (pos === -1) continue;

      const chain = chains[ci];
      const activeChain =
        this.drawingMode === "road"
          ? this.activeRoadChain
          : this.activeRiverChain;
      const isActiveChain = chain === activeChain;

      if (chain.length === 1) {
        chains.splice(ci, 1);
        if (isActiveChain) {
          if (this.drawingMode === "road") this.activeRoadChain = null;
          else this.activeRiverChain = null;
        }
      } else if (pos === 0) {
        chain.splice(0, 1); // in-place; reference stays valid
      } else if (pos === chain.length - 1) {
        chain.splice(pos, 1); // in-place; reference stays valid
      } else {
        chains.splice(ci, 1, chain.slice(0, pos), chain.slice(pos + 1));
        if (isActiveChain) {
          if (this.drawingMode === "road") this.activeRoadChain = null;
          else this.activeRiverChain = null;
        }
      }

      if (this.drawingMode === "road" && this.activeRoadEnd === key) {
        this.activeRoadEnd = null;
        this.activeRoadChain = null;
      }
      if (this.drawingMode === "river" && this.activeRiverEnd === key) {
        this.activeRiverEnd = null;
        this.activeRiverChain = null;
      }

      await this.plugin.saveSettings();
      this.updateRoadRiverOverlay();
      return;
    }
  }

  private hexNeighbors(x: number, y: number): [number, number][] {
    if (this.plugin.settings.hexOrientation === "flat") {
      // Flat-top, odd-q offset (odd columns shifted down)
      return x % 2 === 0
        ? [
            [x, y - 1],
            [x, y + 1],
            [x + 1, y - 1],
            [x + 1, y],
            [x - 1, y - 1],
            [x - 1, y],
          ]
        : [
            [x, y - 1],
            [x, y + 1],
            [x + 1, y],
            [x + 1, y + 1],
            [x - 1, y],
            [x - 1, y + 1],
          ];
    }
    // Pointy-top, odd-r offset (odd rows shifted right)
    return y % 2 === 0
      ? [
          [x + 1, y],
          [x - 1, y],
          [x - 1, y - 1],
          [x, y - 1],
          [x - 1, y + 1],
          [x, y + 1],
        ]
      : [
          [x + 1, y],
          [x - 1, y],
          [x, y - 1],
          [x + 1, y - 1],
          [x, y + 1],
          [x + 1, y + 1],
        ];
  }

  private renderRoadRiverOverlay(gridContainer: HTMLElement): void {
    this.viewportEl?.querySelector("svg.duckmage-road-river-svg")?.remove();
    // Restore any icons that were hidden when the previous SVG elevated them
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex-icon[data-svg-elevated]")
      .forEach((img) => {
        img.style.display = "";
        img.removeAttribute("data-svg-elevated");
      });

    const roadChains = this.plugin.settings.roadChains ?? [];
    const riverChains = this.plugin.settings.riverChains ?? [];
    const hasContent =
      roadChains.some((c) => c.length > 0) ||
      riverChains.some((c) => c.length > 0) ||
      this.activeRoadEnd !== null ||
      this.activeRiverEnd !== null;
    if (!hasContent) return;

    // Build hex center map — offsetLeft/offsetTop are unaffected by CSS transform
    const centerMap = new Map<string, { cx: number; cy: number }>();
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hexEl) => {
        const x = Number(hexEl.dataset.x);
        const y = Number(hexEl.dataset.y);
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
    svg.classList.add("duckmage-road-river-svg");
    const w = gridContainer.offsetLeft + gridContainer.offsetWidth + 20;
    const h = gridContainer.offsetTop + gridContainer.offsetHeight + 20;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:5;";

    // Build a smooth path through an ordered list of points using quadratic
    // bezier curves — corners are rounded by curving through midpoints.
    const smoothPath = (pts: { cx: number; cy: number }[]): string => {
      if (pts.length < 2) return "";
      if (pts.length === 2) {
        return `M ${pts[0].cx} ${pts[0].cy} L ${pts[1].cx} ${pts[1].cy}`;
      }
      const mx = (a: { cx: number }, b: { cx: number }) => (a.cx + b.cx) / 2;
      const my = (a: { cy: number }, b: { cy: number }) => (a.cy + b.cy) / 2;
      let d = `M ${pts[0].cx} ${pts[0].cy}`;
      d += ` L ${mx(pts[0], pts[1])} ${my(pts[0], pts[1])}`;
      for (let i = 1; i < pts.length - 1; i++) {
        d += ` Q ${pts[i].cx} ${pts[i].cy} ${mx(pts[i], pts[i + 1])} ${my(pts[i], pts[i + 1])}`;
      }
      d += ` L ${pts[pts.length - 1].cx} ${pts[pts.length - 1].cy}`;
      return d;
    };

    const appendPath = (
      pts: { cx: number; cy: number }[],
      color: string,
      strokeWidth: number,
    ) => {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", smoothPath(pts));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(strokeWidth));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("fill", "none");
      svg.appendChild(path);
    };

    // Roads: each chain draws fully — crossings are fine.
    const drawChains = (
      chains: string[][],
      color: string,
      strokeWidth: number,
    ) => {
      for (const chain of chains) {
        const pts = chain
          .map((k) => centerMap.get(k))
          .filter((p): p is { cx: number; cy: number } => !!p);
        if (pts.length >= 2) appendPath(pts, color, strokeWidth);
      }
    };

    // Rivers: draw each chain, truncating where it meets an already-drawn
    // chain (tributary merges into main river). Chains that begin at an
    // already-drawn hex are drawn from the last contiguous drawn hex
    // outward, so a branch that starts mid-river still renders correctly.
    const drawRiverChains = (
      chains: string[][],
      color: string,
      strokeWidth: number,
    ) => {
      const drawn = new Set<string>();
      for (const chain of chains) {
        // Skip leading hexes that are already drawn by a prior chain,
        // backing up one so the first segment connects at the junction.
        let start = 0;
        while (start < chain.length - 1 && drawn.has(chain[start])) start++;
        const drawStart = Math.max(0, start - 1);

        // Always render to the end — never cut off at interior intersections.
        const pts = chain
          .slice(drawStart)
          .map((k) => centerMap.get(k))
          .filter((p): p is { cx: number; cy: number } => !!p);
        if (pts.length >= 2) appendPath(pts, color, strokeWidth);
        for (const key of chain) drawn.add(key);
      }
    };

    // Small circle to mark the active endpoint (only visible in drawing mode)
    const drawActiveEndMarker = (activeEnd: string | null, color: string) => {
      if (!activeEnd) return;
      const pos = centerMap.get(activeEnd);
      if (!pos) return;
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(pos.cx));
      circle.setAttribute("cy", String(pos.cy));
      circle.setAttribute("r", "5");
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "white");
      circle.setAttribute("stroke-width", "1.5");
      circle.setAttribute("opacity", "0.9");
      svg.appendChild(circle);
    };

    drawRiverChains(riverChains, this.plugin.settings.riverColor, 3);
    drawChains(roadChains, this.plugin.settings.roadColor, 4);

    if (this.drawingMode === "road")
      drawActiveEndMarker(this.activeRoadEnd, this.plugin.settings.roadColor);
    if (this.drawingMode === "river")
      drawActiveEndMarker(this.activeRiverEnd, this.plugin.settings.riverColor);

    // Elevate override icons above roads/rivers by rendering them inside the SVG,
    // then re-render the coordinate label on top of the icon.
    gridContainer
      .querySelectorAll<HTMLElement>("[data-icon-override]")
      .forEach((hexEl) => {
        const iconName = hexEl.dataset.iconOverride!;
        const x = hexEl.dataset.x!;
        const y = hexEl.dataset.y!;
        const key = `${x}_${y}`;
        const pos = centerMap.get(key);
        if (!pos) return;
        const origImg = hexEl.querySelector<HTMLElement>(".duckmage-hex-icon");
        if (origImg) {
          origImg.style.display = "none";
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

        // Coordinate label on top of the icon — mirrors .duckmage-hex-label styling
        const textEl = document.createElementNS(svgNS, "text");
        textEl.setAttribute("x", String(pos.cx));
        textEl.setAttribute("y", String(pos.cy));
        textEl.setAttribute("text-anchor", "middle");
        textEl.setAttribute("dominant-baseline", "middle");
        textEl.setAttribute("font-size", String(hexEl.offsetHeight * 0.12));
        textEl.setAttribute("font-weight", "600");
        textEl.setAttribute("fill", "#ffffff");
        textEl.setAttribute("paint-order", "stroke");
        textEl.setAttribute("stroke", "rgba(0,0,0,0.85)");
        textEl.setAttribute("stroke-width", "2");
        textEl.setAttribute("stroke-linejoin", "round");
        textEl.textContent = `${x},${y}`;
        svg.appendChild(textEl);
      });

    this.viewportEl?.appendChild(svg);
  }

  private updateRoadRiverOverlay(): void {
    const gridContainer = this.viewportEl?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) {
      this.renderGrid();
      return;
    }
    this.renderRoadRiverOverlay(gridContainer);
  }
}

// ── Go-to-hex modal ──────────────────────────────────────────────────────────

class GotoHexModal extends Modal {
  private xInput: HTMLInputElement | null = null;
  private yInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private onConfirm: (x: number, y: number) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Go to hex");
    const { contentEl } = this;
    contentEl.addClass("duckmage-goto-modal");

    const row = contentEl.createDiv({ cls: "duckmage-goto-row" });
    row.createSpan({ text: "X:" });
    this.xInput = row.createEl("input", {
      type: "number",
      cls: "duckmage-goto-input",
    });
    row.createSpan({ text: "Y:" });
    this.yInput = row.createEl("input", {
      type: "number",
      cls: "duckmage-goto-input",
    });

    const go = () => {
      const x = parseInt(this.xInput?.value ?? "", 10);
      const y = parseInt(this.yInput?.value ?? "", 10);
      if (!isNaN(x) && !isNaN(y)) {
        this.onConfirm(x, y);
        this.close();
      }
    };

    const goBtn = contentEl.createEl("button", {
      text: "Go",
      cls: "mod-cta duckmage-goto-btn-confirm",
    });
    goBtn.addEventListener("click", go);
    [this.xInput, this.yInput].forEach((input) =>
      input?.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") go();
      }),
    );

    this.xInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Table picker modal ────────────────────────────────────────────────────────

interface FileNode {
  type: "file";
  file: TFile;
}
interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TPickerNode[];
}
type TPickerNode = FileNode | FolderNode;

class TablePickerModal extends Modal {
  private filterQuery = "";
  private collapsedFolders: Set<string> = new Set();
  private listEl: HTMLElement | null = null;
  private plugin: DuckmagePlugin;
  private onChoose: (file: TFile) => void;

  constructor(
    app: App,
    plugin: DuckmagePlugin,
    onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    this.titleEl.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;";
    this.titleEl.createSpan({ text: "Select table" });
    const openViewBtn = this.titleEl.createEl("button", {
      cls: "duckmage-rt-icon-btn",
      text: "🎲",
      title: "Open random tables view",
    });
    openViewBtn.addEventListener("click", () => {
      this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
    });

    const { contentEl } = this;
    contentEl.addClass("duckmage-table-picker-modal");

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "duckmage-rt-search",
    });
    search.placeholder = "Filter tables…";
    search.addEventListener("input", () => {
      this.filterQuery = search.value.toLowerCase().trim();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({
      cls: "duckmage-table-picker-list duckmage-rt-list",
    });
    this.renderList();
    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";

    let files = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          (!prefix || f.path.startsWith(prefix)) && !f.basename.startsWith("_"),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (this.filterQuery) {
      files = files.filter((f) => {
        const rel = prefix ? f.path.slice(prefix.length) : f.path;
        return rel.toLowerCase().includes(this.filterQuery);
      });
    }

    if (files.length === 0) {
      this.listEl.createSpan({
        text: "No tables found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const tree = this.buildTree(files, prefix);
    this.renderNodes(this.listEl, tree, this.filterQuery !== "");
  }

  private buildTree(files: TFile[], prefix: string): TPickerNode[] {
    const root: FolderNode = {
      type: "folder",
      name: "",
      path: "",
      children: [],
    };
    for (const file of files) {
      const rel = prefix ? file.path.slice(prefix.length) : file.path;
      const parts = rel.split("/");
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        const path = parts.slice(0, i + 1).join("/");
        let child = cur.children.find(
          (c): c is FolderNode => c.type === "folder" && c.name === name,
        );
        if (!child) {
          child = { type: "folder", name, path, children: [] };
          cur.children.push(child);
        }
        cur = child;
      }
      cur.children.push({ type: "file", file });
    }
    return root.children;
  }

  private renderNodes(
    container: HTMLElement,
    nodes: TPickerNode[],
    forceExpanded: boolean,
  ): void {
    for (const node of nodes) {
      if (node.type === "folder") {
        const isCollapsed =
          !forceExpanded && this.collapsedFolders.has(node.path);
        const folderEl = container.createDiv({ cls: "duckmage-rt-folder" });
        const header = folderEl.createDiv({ cls: "duckmage-rt-folder-header" });
        const arrow = header.createSpan({
          cls: "duckmage-rt-folder-arrow",
          text: isCollapsed ? "▶" : "▼",
        });
        header.createSpan({ cls: "duckmage-rt-folder-name", text: node.name });
        const childrenEl = folderEl.createDiv({
          cls: "duckmage-rt-folder-children",
        });
        if (isCollapsed) childrenEl.style.display = "none";
        this.renderNodes(childrenEl, node.children, forceExpanded);
        header.addEventListener("click", () => {
          const nowCollapsed = !this.collapsedFolders.has(node.path);
          if (nowCollapsed) {
            this.collapsedFolders.add(node.path);
            childrenEl.style.display = "none";
            arrow.textContent = "▶";
          } else {
            this.collapsedFolders.delete(node.path);
            childrenEl.style.display = "";
            arrow.textContent = "▼";
          }
        });
      } else {
        const row = container.createDiv({ cls: "duckmage-rt-list-item" });
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => {
          this.onChoose(node.file);
          this.close();
        });
      }
    }
  }
}

// ── Faction picker modal ──────────────────────────────────────────────────────

class FactionPickerModal extends Modal {
  private filterQuery = "";
  private collapsedFolders: Set<string> = new Set();
  private listEl: HTMLElement | null = null;
  private plugin: DuckmagePlugin;
  private onChoose: (file: TFile) => void;

  constructor(
    app: App,
    plugin: DuckmagePlugin,
    onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    this.titleEl.setText("Select faction");
    const { contentEl } = this;
    contentEl.addClass("duckmage-table-picker-modal");

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "duckmage-rt-search",
    });
    search.placeholder = "Filter factions…";
    search.addEventListener("input", () => {
      this.filterQuery = search.value.toLowerCase().trim();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({
      cls: "duckmage-table-picker-list duckmage-rt-list",
    });
    this.renderList();
    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const folder = normalizeFolder(this.plugin.settings.factionsFolder);
    const prefix = folder ? folder + "/" : "";

    let files = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          (!prefix || f.path.startsWith(prefix)) && !f.basename.startsWith("_"),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (this.filterQuery) {
      files = files.filter((f) => {
        const rel = prefix ? f.path.slice(prefix.length) : f.path;
        return rel.toLowerCase().includes(this.filterQuery);
      });
    }

    if (files.length === 0) {
      this.listEl.createSpan({
        text: "No factions found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const tree = this.buildTree(files, prefix);
    this.renderNodes(this.listEl, tree, this.filterQuery !== "");
  }

  private buildTree(files: TFile[], prefix: string): TPickerNode[] {
    const root: FolderNode = {
      type: "folder",
      name: "",
      path: "",
      children: [],
    };
    for (const file of files) {
      const rel = prefix ? file.path.slice(prefix.length) : file.path;
      const parts = rel.split("/");
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        const path = parts.slice(0, i + 1).join("/");
        let child = cur.children.find(
          (c): c is FolderNode => c.type === "folder" && c.name === name,
        );
        if (!child) {
          child = { type: "folder", name, path, children: [] };
          cur.children.push(child);
        }
        cur = child;
      }
      cur.children.push({ type: "file", file });
    }
    return root.children;
  }

  private renderNodes(
    container: HTMLElement,
    nodes: TPickerNode[],
    forceExpanded: boolean,
  ): void {
    for (const node of nodes) {
      if (node.type === "folder") {
        const isCollapsed =
          !forceExpanded && this.collapsedFolders.has(node.path);
        const folderEl = container.createDiv({ cls: "duckmage-rt-folder" });
        const header = folderEl.createDiv({ cls: "duckmage-rt-folder-header" });
        const arrow = header.createSpan({
          cls: "duckmage-rt-folder-arrow",
          text: isCollapsed ? "▶" : "▼",
        });
        header.createSpan({ cls: "duckmage-rt-folder-name", text: node.name });
        const childrenEl = folderEl.createDiv({
          cls: "duckmage-rt-folder-children",
        });
        if (isCollapsed) childrenEl.style.display = "none";
        this.renderNodes(childrenEl, node.children, forceExpanded);
        header.addEventListener("click", () => {
          const nowCollapsed = !this.collapsedFolders.has(node.path);
          if (nowCollapsed) {
            this.collapsedFolders.add(node.path);
            childrenEl.style.display = "none";
            arrow.textContent = "▶";
          } else {
            this.collapsedFolders.delete(node.path);
            childrenEl.style.display = "";
            arrow.textContent = "▼";
          }
        });
      } else {
        const row = container.createDiv({ cls: "duckmage-rt-list-item" });
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => {
          this.onChoose(node.file);
          this.close();
        });
      }
    }
  }
}

class HexHelpModal extends Modal {
  onOpen(): void {
    this.titleEl.setText("Hex map — controls & tools");
    this.contentEl.addClass("duckmage-help-modal");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void MarkdownRenderer.render(this.app, HELP_CONTENT, this.contentEl, "", this as any);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

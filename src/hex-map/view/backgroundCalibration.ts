/**
 * Background-image calibration (L2a, split out of HexMapView): the bg image
 * layer, its drag / resize / arrow-nudge handlers, the grid's display
 * transform, the outline overlay and the colour snapshot shown during a drag.
 * The view reaches it through `CalibrationHost` (PathToolHost precedent).
 */
import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { MapData } from "../../types";
import type { CalibrateSnapshot, UndoItem } from "../undoItems";
import { attachResizeHandles, coalesceDragMove, type DragMove, type ResizeOpts } from "./calibrationDrag";

export interface CalibrationHost {
  plugin: HexmakerPlugin;
  contentEl: HTMLElement;
  viewportEl(): HTMLElement | null;
  /** The viewport's current CSS scale (before a bake). */
  zoom(): number;
  getActiveMap(): MapData;
  activeMapName(): string;
  pushUndo(item: UndoItem, mapName: string): void;
  updateUndoButton(): void;
  renderGrid(): void;
  /** Cancel a pending zoom bake / wheel frame (a bake mid-calibration drifts the outlines). */
  cancelZoomBake(): void;
  registerDomEvent(el: Document, type: "keydown", cb: (e: KeyboardEvent) => void): void;
}

export class BackgroundCalibration {
  /** Calibration mode is on. */
  active = false;
  constructor(private host: CalibrationHost) {}

  // Cached bg-image layer reused across renders (see renderBackgroundImage) so
  // renderGrid()'s viewportEl.empty() doesn't force an image re-decode each time.
  private bgLayerEl: HTMLElement | null = null;
  private bgLayerSrc: string | null = null;
  // Single-canvas terrain-colour snapshot shown during a calibration drag in
  // place of the 3843 hex cells (see buildCalibrationSnapshot).
  private calSnapshotEl: HTMLCanvasElement | null = null;

  /**
   * Keep the calibration resize handles a constant on-screen size. A handle is
   * a child of the element it resizes (the bg image layer or the grid), so its
   * rendered size is `handleCss × parentScale × viewportZoom`. Cancelling only
   * the zoom leaves the parent's own scale (bg image ~4.8×, grid ~0.35×) in,
   * which made image handles huge and grid handles tiny, so each handle gets
   * `--duckmage-cal-scale = 1 / (zoom × parentScale)` and the chain cancels to 1.
   */
  updateCalHandleScale(): void {
    const vp = this.host.viewportEl();
    if (!this.active || !vp) return;
    const z = Math.max(0.01, this.host.zoom());
    // Written on the handles themselves, not their parent: an inherited
    // custom property changed on the grid would re-style every hex
    // beneath it on each zoom frame.
    const setHandleScale = (parent: HTMLElement, scale: number) => {
      parent
        .querySelectorAll<HTMLElement>(":scope > .duckmage-calibration-handle")
        .forEach((h) => h.setCssProps({ "--duckmage-cal-scale": String(scale) }));
    };
    const map = this.host.getActiveMap();
    const bgLayer = vp.querySelector<HTMLElement>(
      ".duckmage-bg-image-layer",
    );
    if (bgLayer && map.backgroundImage) {
      const s = Math.max(0.01, map.backgroundImage.scale);
      setHandleScale(bgLayer, 1 / (z * s));
    }
    const grid = vp.querySelector<HTMLElement>(
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

  /** A drag's mousemove, once per frame, over the colour snapshot (see calibrationDrag.ts). */
  private coalesceDragMove(label: string, work: (ev: MouseEvent) => void): DragMove {
    return coalesceDragMove(
      label,
      work,
      () => {
        this.buildCalibrationSnapshot();
        this.host.viewportEl()?.addClass("duckmage-calibrating-drag");
      },
      () => {
        this.host.viewportEl()?.removeClass("duckmage-calibrating-drag");
        this.removeCalibrationSnapshot();
      },
    );
  }

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
  captureCalibration(map: MapData): CalibrateSnapshot {
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
    this.host.pushUndo({ kind: "calibrate", mapName, before, after }, mapName);
    this.host.updateUndoButton();
  }

  /** Restore a CalibrateSnapshot back onto a map and persist. */
  async applyCalibrationSnapshot(
    mapName: string,
    snap: CalibrateSnapshot,
  ): Promise<void> {
    const map = this.host.plugin.settings.maps.find((m) => m.name === mapName);
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
    await this.host.plugin.saveSettings();
    this.host.renderGrid();
  }

  /**
   * Write the bg image's translate / rotate / scale / opacity to the layer
   * as CSS custom properties. The actual `transform` declaration lives in
   * `.duckmage-bg-image-layer`'s CSS rule — JS only feeds the variables in,
   * which keeps the obsidianmd no-static-styles-assignment rule happy.
   */
  applyBgLayerVars(
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
  applyGridLayerVars(
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

  renderBackgroundImage(viewportEl: HTMLElement, map: MapData): void {
    const bg = map.backgroundImage;
    viewportEl.toggleClass("has-bg-image", !!bg?.path);
    viewportEl.toggleClass("is-bg-calibrating", this.active && !!bg?.path);
    if (!bg?.path) {
      this.bgLayerEl = null;
      this.bgLayerSrc = null;
      return;
    }
    const file = this.host.plugin.app.vault.getAbstractFileByPath(bg.path);
    if (!(file instanceof TFile)) {
      this.bgLayerEl = null;
      this.bgLayerSrc = null;
      return;
    }

    const src = this.host.plugin.app.vault.adapter.getResourcePath(bg.path);

    // Reuse the cached layer+img across renders when the image is unchanged.
    // renderGrid() calls viewportEl.empty() every render, which detaches the
    // layer but leaves our JS reference (and its already-decoded bitmap) alive.
    // Re-attaching it avoids recreating the <img> and forcing the browser to
    // re-decode + re-rasterise the (large, scaled) image on every single
    // render — the churn that makes editing a bg-image map sluggish. We skip
    // reuse during calibration so its drag/wheel handlers are wired exactly as
    // before (fresh layer each render, as the old code did).
    if (this.bgLayerEl && this.bgLayerSrc === src && !this.active) {
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

    if (this.active) this.attachCalibrationHandlers(layer, map);
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
      const zoom = this.host.zoom();
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
        this.pushCalibrationUndo(this.host.activeMapName(), before, this.captureCalibration(map));
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
          this.pushCalibrationUndo(this.host.activeMapName(), bgResizeBefore, this.captureCalibration(map));
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
  attachGridCalibrationHandlers(grid: HTMLElement, map: MapData): void {
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
      const zoom = this.host.zoom();
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
        this.pushCalibrationUndo(this.host.activeMapName(), before, this.captureCalibration(map));
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
          this.pushCalibrationUndo(this.host.activeMapName(), gridResizeBefore, this.captureCalibration(map));
          gridResizeBefore = null;
        }
      },
    });
  }

  /** The 8 resize handles (see calibrationDrag.ts). */
  private attachResizeHandles(el: HTMLElement, opts: ResizeOpts): void {
    attachResizeHandles(el, opts, () => this.host.zoom(), (label, work) => this.coalesceDragMove(label, work));
  }

  private calibrationHelpEl: HTMLElement | null = null;

  /** Enter calibration mode for the active map's bg image. No-op if no image. */
  enter(): void {
    const map = this.host.getActiveMap();
    if (!map.backgroundImage?.path) {
      new Notice("Pick a background image first.");
      return;
    }
    this.active = true;
    this.bgCalibrationFocus = null;
    // Cancel any pending bake — if it fires mid-calibration it changes the
    // viewport font-size, which resizes the em-based hex grid while the SVG
    // outline polygons (in pixel coords) stay at their pre-bake size, and we
    // get the visual two-grids drift the user reported.
    this.host.cancelZoomBake();
    this.host.registerDomEvent(activeDocument, "keydown", (e: KeyboardEvent) => {
      if (!this.active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void this.exit(true);
        return;
      }
      this.handleCalibrationArrowKey(e);
    });
    this.host.renderGrid();
    // Handles are created during renderGrid; size them to the current zoom +
    // per-layer scale now that they exist.
    this.updateCalHandleScale();
    this.showCalibrationHelp();
  }

  /** Update DOM classes so the focused calibration target gets a brighter outline. */
  applyCalibrationFocusStyles(): void {
    const vp = this.host.viewportEl();
    if (!vp) return;
    const layer = vp.querySelector<HTMLElement>(".duckmage-bg-image-layer");
    const grid = vp.querySelector<HTMLElement>(".duckmage-hex-map-grid");
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
    const map = this.host.getActiveMap();
    if (this.nudgeUndoBefore === null) {
      this.nudgeUndoBefore = this.captureCalibration(map);
    }
    if (this.bgCalibrationFocus === "image" && map.backgroundImage) {
      map.backgroundImage.offsetX += dirX * step;
      map.backgroundImage.offsetY += dirY * step;
      const layer = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (layer) this.applyBgLayerVars(layer, map.backgroundImage);
    } else if (this.bgCalibrationFocus === "grid") {
      map.gridDisplayOffsetX = (map.gridDisplayOffsetX ?? 0) + dirX * step;
      map.gridDisplayOffsetY = (map.gridDisplayOffsetY ?? 0) + dirY * step;
      const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) this.applyGridLayerVars(grid, map);
    }
    // Swap in the cheap colour snapshot for the nudge burst (same lever as the
    // mouse drag) so held/repeated arrows don't re-rasterise every hex cell.
    this.markCalibrationActivity();
    if (this.nudgeUndoTimer !== null) window.clearTimeout(this.nudgeUndoTimer);
    this.nudgeUndoTimer = window.setTimeout(() => {
      const after = this.captureCalibration(map);
      if (this.nudgeUndoBefore) {
        this.pushCalibrationUndo(this.host.activeMapName(), this.nudgeUndoBefore, after);
      }
      this.nudgeUndoBefore = null;
      this.nudgeUndoTimer = null;
    }, 500);
  }

  /** Exit calibration. If `save`, persist the current transform. */
  async exit(save: boolean): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.bgCalibrationFocus = null;
    // Tear down any active snapshot/drag state (renderGrid below rebuilds the
    // grid, but the class lives on the persistent viewportEl and the settle
    // timer could otherwise fire after exit).
    if (this.calActivityTimer !== null) {
      window.clearTimeout(this.calActivityTimer);
      this.calActivityTimer = null;
    }
    this.host.viewportEl()?.removeClass("duckmage-calibrating-drag");
    this.removeCalibrationSnapshot();
    // Flush any pending arrow-nudge undo entry so the final state is recorded
    if (this.nudgeUndoTimer !== null) {
      window.clearTimeout(this.nudgeUndoTimer);
      this.nudgeUndoTimer = null;
      if (this.nudgeUndoBefore) {
        const after = this.captureCalibration(this.host.getActiveMap());
        this.pushCalibrationUndo(this.host.activeMapName(), this.nudgeUndoBefore, after);
        this.nudgeUndoBefore = null;
      }
    }
    this.hideCalibrationHelp();
    if (save) await this.host.plugin.saveSettings();
    this.host.renderGrid();
  }

  private showCalibrationHelp(): void {
    this.hideCalibrationHelp();
    // Anchor to contentEl so Obsidian tears it down on view close.
    // Single-button chip — just a check mark to commit + esc as the
    // documented secondary. Smaller footprint, less visual noise than
    // the prior banner.
    const chip = this.host.contentEl.createDiv({ cls: "duckmage-calibration-help" });
    const lockBtn = chip.createEl("button", {
      cls: "duckmage-calibration-commit mod-cta",
      attr: { title: "Done calibrating (esc)", "aria-label": "Done calibrating" },
    });
    lockBtn.setText("✓");
    lockBtn.addEventListener("click", () => void this.exit(true));
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
  sweepStrayCalibrationHelp(): void {
    activeDocument.querySelectorAll(".duckmage-calibration-help").forEach((el) => {
      // Don't remove our own (just-created) banner if it lives in contentEl
      if (!this.host.contentEl.contains(el)) el.remove();
    });
  }

  /**
   * Draw bright hex outlines over the grid during calibration. CSS `border`
   * can't draw the diagonal hex edges (it's clipped to the rectangle by
   * `clip-path`), so we paint one stroked polygon per hex into an SVG that
   * lives inside the gridContainer — same DOM ancestor as the hexes, so it
   * inherits the gridDisplayScale transform automatically. Verified
   * against the local sandbox in dev/hex-calibration-sandbox.html.
   */
  renderCalibrationOutlines(gridContainer: HTMLElement): void {
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

    const isFlat = this.host.plugin.settings.hexOrientation === "flat";

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
    const vp = this.host.viewportEl();
    if (!vp || this.calSnapshotEl) return;
    const gridContainer = vp.querySelector<HTMLElement>(
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

    const isFlat = this.host.plugin.settings.hexOrientation === "flat";
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
      this.host.viewportEl()?.addClass("duckmage-calibrating-drag");
    }
    if (this.calActivityTimer !== null)
      window.clearTimeout(this.calActivityTimer);
    this.calActivityTimer = window.setTimeout(() => {
      this.calActivityTimer = null;
      this.host.viewportEl()?.removeClass("duckmage-calibrating-drag");
      this.removeCalibrationSnapshot();
    }, 200);
  }
}

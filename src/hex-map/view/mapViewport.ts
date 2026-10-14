/**
 * The map's pan / zoom (L2b, split out of HexMapView): the viewport
 * transform, wheel zoom batched per frame, the zoom bake into font-size,
 * fitting / centring in the part of the view no overlay covers, and each
 * map's last viewport. The view reaches it through `ViewportHost`.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { MapData } from "../../types";
import { fitToSafeArea, overlayInsets, unionBoxes, usableInsets, zoomForHexWidth, NO_INSETS, type Box, type Insets } from "../safeArea";
import { wheelZoomLog } from "../wheelZoom";
import type { BackgroundCalibration } from "./backgroundCalibration";

/** A map's viewport: zoom, pan and the font size a zoom bake left. */
export interface ViewportSnapshot {
  zoom: number;
  panX: number;
  panY: number;
  fontSize: string;
}

export interface ViewportHost {
  plugin: HexmakerPlugin;
  viewportEl(): HTMLElement | null;
  getActiveMap(): MapData;
  calibration(): Pick<BackgroundCalibration, "active" | "applyBgLayerVars" | "applyGridLayerVars">;
  /** What lies over the map: toolbar rows (top), open side panels (right), the legend (left). */
  overlayEls(): { top: HTMLElement[]; right: HTMLElement[]; left: HTMLElement[] };
  /** After each transform write (names' readable size, calibration handles, coord labels). */
  transformed(): void;
  /** After a zoom bake: redraw the layers placed in px. */
  baked(): void;
  renderGrid(): void;
}

export class MapViewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  /** False until the first map's viewport is placed (restored or fitted). */
  ready = false;
  private zoomSettleTimer: number | null = null;
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
  // Per-map viewport state saved when navigating away; restored on return (or fit on first visit).
  // fontSize must be saved alongside zoom/panX/panY because bakeZoom() encodes the visual zoom
  // into viewportEl.style.fontSize and resets this.zoom to 1. Restoring without the fontSize
  // would apply the wrong scale on the incoming map.
  private mapViewport = new Map<string, ViewportSnapshot>();

  constructor(private host: ViewportHost) {}

  applyTransform(): void {
    const viewportEl = this.host.viewportEl();
    if (viewportEl) {
      viewportEl.setCssProps({
        "--duckmage-vp-tx": `${this.panX}px`,
        "--duckmage-vp-ty": `${this.panY}px`,
        "--duckmage-vp-scale": String(this.zoom),
      });
    }
    this.host.transformed();
  }

  /** Pan by a screen delta. */
  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.applyTransform();
  }

  /** The viewport now (zoom, pan, the baked font size). */
  snapshot(viewportEl: HTMLElement): ViewportSnapshot {
    return {
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      fontSize: viewportEl.style.fontSize ?? "",
    };
  }

  /**
   * Keep map `name`'s viewport for this session and return it; null until
   * the view has placed its first map (the zoom/pan are placeholders then).
   */
  remember(name: string): ViewportSnapshot | null {
    const viewportEl = this.host.viewportEl();
    if (!viewportEl || !this.ready) return null;
    const snapshot = this.snapshot(viewportEl);
    this.mapViewport.set(name, snapshot);
    return snapshot;
  }

  /**
   * Show `name` at its last viewport: the in-memory cache (live state from
   * this session), else the persisted savedViewport (survives view
   * close/reopen), else fit the whole grid (first visit).
   */
  restoreViewport(name: string): void {
    const stored = this.mapViewport.get(name) ?? this.host.plugin.getMap(name)?.savedViewport;
    if (stored) {
      this.zoom = stored.zoom;
      this.panX = stored.panX;
      this.panY = stored.panY;
      this.setViewportFontSize(stored.fontSize);
      this.applyTransform();
      this.host.renderGrid();
      // A saved position can leave the grid off-screen or too small to see
      // (e.g. saved while the view had no size). Re-fit rather than show an
      // empty view.
      window.requestAnimationFrame(() => {
        this.refitIfLost();
        this.ready = true;
      });
    } else {
      this.zoom = 1; this.panX = 0; this.panY = 0;
      this.setViewportFontSize("");
      this.applyTransform();
      this.host.renderGrid();
      window.requestAnimationFrame(() => {
        this.fitGridToView();
        this.ready = true;
      });
    }
  }

  /** Cancel a pending zoom bake and wheel frame (calibration keeps zoom as a transform). */
  cancelZoomBake(): void {
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
  }

  /** Re-fit the grid if it's entirely outside the view or its hexes are too small to see. */
  private refitIfLost(): void {
    const viewportEl = this.host.viewportEl();
    const clipEl = viewportEl?.parentElement;
    const gridEl = viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
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

  fitGridToView(): void {
    const viewportEl = this.host.viewportEl();
    const clipEl  = viewportEl?.parentElement;
    const gridEl  = viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
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
    const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (!grid) return null;
    const map = this.host.getActiveMap();
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
   * How far the toolbar rows (with the mode bar), an open side panel and
   * the legend reach into the map view, in px from the clip's edges. Reads only.
   */
  measureOverlayInsets(): Insets {
    const clipEl = this.host.viewportEl()?.parentElement;
    if (!clipEl) return NO_INSETS;
    const clip = clipEl.getBoundingClientRect();
    if (clip.width === 0 || clip.height === 0) return NO_INSETS;
    const box = (el: HTMLElement): Box => el.getBoundingClientRect();
    const els = this.host.overlayEls();
    const top = els.top.map(box);
    const right = els.right.map(box);
    // The legend, pinned bottom-left over the map.
    const left = els.left.map(box);
    return overlayInsets(clip, top, right, undefined, left);
  }

  /** A wheel step at a point (px from the view's corner), applied on the next frame. */
  queueWheelZoom(e: WheelEvent, rect: DOMRect): void {
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

  scheduleZoomBake(): void {
    // During calibration we keep zoom as a CSS transform on the viewport
    // (instead of baking it into font-size) so the SVG outline overlay,
    // the hex grid, and the bg image all scale together as a single unit.
    if (this.host.calibration().active) return;
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
    if (this.host.getActiveMap().backgroundImage) return;
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
    const viewportEl = this.host.viewportEl();
    if (!viewportEl) return;
    viewportEl.style.fontSize = fs;
  }

  // Bake the current CSS scale() into the viewport's font-size so the DOM
  // renders natively at the zoomed size instead of upscaling a compositor
  // bitmap (which causes pixelation). Pan offsets stay correct because layout
  // coordinates scale by the same factor as the transform did.
  private bakeZoom(): void {
    const viewportEl = this.host.viewportEl();
    if (!viewportEl || this.zoom === 1) return;
    // Defensive: do NOT bake while calibrating. Even if a pending timer fires
    // here (shouldn't, since enterBgCalibration cancels it and
    // scheduleZoomBake bails when calibrating), baking mid-calibration drifts
    // the SVG outline from the hex grid.
    const calibration = this.host.calibration();
    if (calibration.active) return;
    const F = this.zoom;
    const currentFs = parseFloat(getComputedStyle(viewportEl).fontSize);

    // The path layer is placed in em (lattice units, see renderPathOverlay),
    // so it grows with the font size and is NOT rebuilt here. The icon
    // layer over it holds px positions computed against the pre-bake hex
    // sizes: tear it down FIRST, before the font-size mutation below, so no
    // paint frame shows icons stranded where the hexes used to be; it is
    // rebuilt via `updatePathIcons()` further down. Sandbox repro of the
    // pre-fix slip: dev/coord-slip-sandbox.html.
    viewportEl.querySelector("svg.duckmage-path-icons-svg")?.remove();
    viewportEl.removeClass("duckmage-svg-labels-active");
    // Same for the faction/region overlays — they also hold pre-bake
    // pixel positions and would visibly mis-align during the transition.
    viewportEl.querySelector("svg.duckmage-faction-svg")?.remove();
    viewportEl.querySelector(".duckmage-faction-legend")?.remove();
    viewportEl.querySelector("svg.duckmage-region-svg")?.remove();
    viewportEl.querySelector(".duckmage-region-labels-layer")?.remove();

    viewportEl.style.fontSize = `${currentFs * F}px`;
    this.zoom = 1;
    this.applyTransform();

    // bakeZoom grows em-based things (hex grid CSS dimensions) by F, but
    // pixel-based calibration transforms (bg image offset/scale, grid display
    // offset) do not naturally grow. Multiplying them here by F preserves
    // their position and size relative to the now-bigger hex grid — so a
    // calibrated bg image stays aligned across wheel zooming.
    // Scale-multipliers (gridDisplayScaleX/Y) are unitless and do NOT change.
    const map = this.host.getActiveMap();
    if (map.backgroundImage) {
      map.backgroundImage.offsetX *= F;
      map.backgroundImage.offsetY *= F;
      map.backgroundImage.scale *= F;
      const bgLayer = viewportEl.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (bgLayer) calibration.applyBgLayerVars(bgLayer, map.backgroundImage);
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
      const gridContainer = viewportEl.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (gridContainer) calibration.applyGridLayerVars(gridContainer, map);
    }
    // Also persist the new viewport state — font-size just baked from the
    // viewport zoom, so the saved snapshot has to follow.
    map.savedViewport = this.snapshot(viewportEl);
    void this.host.plugin.saveSettings();

    this.host.baked();
  }

  /** Centre the view on a hex. `keepHexWidth` (on-screen px) keeps that hex
   *  size instead of zooming to the default 1.5× (crossing regions). */
  centerOnHex(x: number, y: number, keepHexWidth?: number): void {
    const viewportEl = this.host.viewportEl();
    const hexEl = viewportEl?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (!hexEl) {
      new Notice(`Hex ${x}, ${y} is not in the current grid.`);
      return;
    }

    const clipEl = viewportEl?.parentElement;
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
}

/**
 * The map's pointer input (L2i, split out of HexMapView.onOpen): hover
 * (brush highlight, hex labels, the pause after a modal closes), wheel
 * zoom, pan by drag, paint strokes (terrain, icon, faction, region, biome,
 * full-view region hexes), the tools' right-click menu and clicks in the
 * gaps between hexes. Hex clicks go to the view's onHexClick / onHexContextMenu.
 */
import { Notice, type Component } from "obsidian";
import type { CellEdit } from "../../undoBook";
import { canAdd, TOOL_ACTIONS, type ModeAction } from "../../workMode";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { BiomeStroke } from "../../overworld/biomePainter";
import type { OverworldLayer } from "../../overworld/overworldLayer";
import type { MapData } from "../../types";
import { overlayClosed, pointerMovedFrom } from "../hexHover";
import type { PainterContextMenuOption } from "../PainterContextMenu";
import type { PathTool } from "../pathTool";
import type { DrawingMode } from "../toolMode";
import { wheelZoomsMap } from "../wheelZoom";
import type { AreaOverlay } from "./areaOverlay";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { MapToolbar } from "./mapToolbar";
import type { MapViewport } from "./mapViewport";
import type { UndoController } from "./undoController";
import { hexKey } from "../../hexKey";

/** What the input handlers read and call on the view (read live, at event time). */
export interface MapInputHost extends Pick<Component, "registerDomEvent" | "register"> {
  viewportEl(): HTMLElement | null;
  drawingMode(): DrawingMode | null;
  isErasingMode(): boolean;
  paintIconName(): string | null;
  paintIconGmOnly(): boolean;
  /** A stroke starts: the "no region here" hint may show once again. */
  resetSubStrokeHint(): void;
  biomeStroke(): BiomeStroke<CellEdit> | null;
  calibration(): Pick<BackgroundCalibration, "active">;
  viewport(): Pick<MapViewport, "panX" | "panY" | "applyTransform" | "queueWheelZoom">;
  undos(): Pick<UndoController,
    "currentTerrainStroke" | "currentIconStroke" | "currentFactionStroke" | "currentRegionStroke" | "currentSubStroke" | "strokePins"
    | "commitTerrainStroke" | "commitIconStroke" | "commitFactionStroke" | "commitRegionStroke">;
  areas(): Pick<AreaOverlay, "onHexFactionPaintClick" | "onHexRegionPaintClick">;
  toolbar(): Pick<MapToolbar, "overworldPathItems" | "showPainterContextMenu">;
  pathTool(): PathTool;
  overworldLayer(): OverworldLayer | undefined;
  wm(): WorldMapsApi | undefined;
  getActiveMap(): MapData;
  owView(map: MapData): "regions" | "biomes" | null;
  modeAllows(action: ModeAction): boolean;
  exitCurrentMode(): void;
  exitTerrainMode(): void;
  hexElAt(target: EventTarget | null, clientX: number, clientY: number): HTMLElement | null;
  labelHex(hexEl: HTMLElement): void;
  updateBrushHighlight(x: number | null, y: number | null): void;
  /** A hex click (through the view, so a wrapper on view.onHexClick sees it). */
  onHexClick(x: number, y: number, e?: MouseEvent): Promise<void>;
  onHexContextMenu(evt: MouseEvent, x: number, y: number): void;
  onHexPaintClick(x: number, y: number): void;
  onHexIconClick(x: number, y: number): void;
  removeOneGmIconFromHex(hexEl: HTMLElement, x: number, y: number, iconName: string): void;
  overworldHexKeyAt(target: EventTarget | null, clientX: number, clientY: number): string | null;
  startBiomeStroke(): void;
  finishBiomeStroke(): Promise<void>;
  subHexKeyAt(clientX: number, clientY: number): string | null;
  paintSubHexAt(clientX: number, clientY: number): string | null;
}

export class MapInput {
  constructor(private host: MapInputHost) {}

  /** Wire the pointer handlers on the view's content (`clipEl`: the map's clipping viewport). */
  attach(contentEl: HTMLElement, clipEl: HTMLElement): void {
    this.host.registerDomEvent(clipEl, "mouseleave", () => {
      this.host.updateBrushHighlight(null, null);
    });

    // A modal or menu closing over the map leaves the hex under the unmoved
    // pointer lit as if hovered (round 5: a stray highlight after Create
    // token). Pause the hover highlight until the pointer really moves.
    const doc = contentEl.ownerDocument;
    let lastPointer = { x: -1, y: -1 };
    let hoverPausedAt: { x: number; y: number } | null = null;
    this.host.registerDomEvent(doc, "mousemove", (e: MouseEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!pointerMovedFrom(hoverPausedAt, e.clientX, e.clientY)) return;
      hoverPausedAt = null;
      this.host.viewportEl()?.removeClass("duckmage-hover-paused");
    });
    const overlayWatch = new MutationObserver((records) => {
      if (!records.some((r) => overlayClosed(Array.from(r.removedNodes)))) return;
      hoverPausedAt = { ...lastPointer };
      this.host.viewportEl()?.addClass("duckmage-hover-paused");
    });
    overlayWatch.observe(doc.body, { childList: true });
    this.host.register(() => overlayWatch.disconnect());

    // Hover info: a hex's terrain + coords as its tooltip / accessible name.
    // One delegated listener, filled in on first hover of each hex — no
    // per-hex listeners or per-render work on big maps, and always the
    // current terrain (painting doesn't re-render the grid).
    this.host.registerDomEvent(clipEl, "mouseover", (e: MouseEvent) => {
      const hexEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(".duckmage-hex[data-x]");
      // Regions view: the grid's own tooltip names the region under the pointer.
      if (hexEl && !hexEl.closest(".duckmage-ow-regions")) this.host.labelHex(hexEl);
    });

    // ── Zoom (scroll wheel, no modifier required) ──────────────────────────
    // Delta-aware + rAF-batched (see wheelZoom.ts). Mouse notch (deltaY=100)
    // → ~1.16× per event. Trackpads (deltaY≈2-10) → tiny per-event factors
    // that look smooth because many events fire per frame and the rAF tick
    // applies them as one update. NO easing tail — the visual lands exactly
    // at the cumulative wheel delta and stops the frame after the last event.
    this.host.registerDomEvent(
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
        this.host.viewport().queueWheelZoom(e, rect);
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

    this.host.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
      // Calibration mode owns left-click drag (image + grid handlers manage it)
      if (this.host.calibration().active && e.button === 0) return;
      // Middle click: always pan
      if (e.button === 1) {
        e.preventDefault(); // suppress auto-scroll cursor
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panStartX = this.host.viewport().panX;
        panStartY = this.host.viewport().panY;
        this.host.viewportEl()?.addClass("is-dragging");
        beginDrag();
        return;
      }
      // Right click with no active tool: pan (contextmenu suppressed if drag occurs)
      if (e.button === 2 && this.host.drawingMode() === null) {
        isRightDragging = true;
        rightDragMoved = false;
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        panStartX = this.host.viewport().panX;
        panStartY = this.host.viewport().panY;
        this.host.viewportEl()?.addClass("is-dragging");
        beginDrag();
        return;
      }
      if (e.button !== 0) return;
      // The map's work mode may lock the active tool: say so once, put it down.
      const mode = this.host.drawingMode();
      if (mode && !this.host.modeAllows(TOOL_ACTIONS[mode])) {
        this.host.exitCurrentMode();
        hasDragged = true;
        return;
      }
      // The biome brush: each overworld hex crossed gets the biome (and its region).
      if (this.host.drawingMode() === "biome") {
        const key = this.host.overworldHexKeyAt(e.target, e.clientX, e.clientY);
        this.host.startBiomeStroke();
        if (key) this.host.biomeStroke()?.add(key);
        isTerrainPainting = true;
        lastPaintedKey = key;
        hasDragged = true;
        beginDrag();
        return;
      }
      // Overworld Biomes view: biomes only (MM1), the terrain tool is off there.
      if (this.host.drawingMode() === "terrain" && this.host.owView(this.host.getActiveMap()) === "biomes") {
        new Notice(this.host.wm()!.TERRAIN_IN_BIOMES_HINT);
        this.host.exitTerrainMode();
        hasDragged = true;
        return;
      }
      if (this.host.drawingMode() === "terrain" && this.host.overworldLayer()?.showsRegions(this.host.getActiveMap())) {
        if (!canAdd(this.host.getActiveMap())) {
          new Notice(this.host.wm()!.PAINT_LOCKED_HINT);
          hasDragged = true;
          return;
        }
        this.host.resetSubStrokeHint();
        isTerrainPainting = true;
        lastPaintedKey = null;
        this.host.undos().currentTerrainStroke = new Map();
        this.host.undos().currentSubStroke = new Map();
        lastPaintedKey = this.host.paintSubHexAt(e.clientX, e.clientY);
        hasDragged = true;
        beginDrag();
        return;
      }
      if (this.host.drawingMode() === "terrain" || this.host.drawingMode() === "icon" || this.host.drawingMode() === "factionLink" || this.host.drawingMode() === "regionLink") {
        isTerrainPainting = true;
        lastPaintedKey = null;
        if (this.host.drawingMode() === "terrain") {
          this.host.undos().currentTerrainStroke = new Map();
          this.host.undos().strokePins = [];
        }
        else if (this.host.drawingMode() === "icon")
          this.host.undos().currentIconStroke = new Map();
        else if (this.host.drawingMode() === "factionLink")
          this.host.undos().currentFactionStroke = new Map();
        else if (this.host.drawingMode() === "regionLink")
          this.host.undos().currentRegionStroke = new Map();
        // Paint the hex under the cursor immediately (or the nearest one
        // when the press landed in the gap between hexes).
        const hexEl = this.host.hexElAt(e.target, e.clientX, e.clientY);
        if (hexEl) {
          const x = Number(hexEl.dataset.x);
          const y = Number(hexEl.dataset.y);
          lastPaintedKey = hexKey(x, y);
          if (this.host.drawingMode() === "terrain") this.host.onHexPaintClick(x, y);
          else if (this.host.drawingMode() === "icon") this.host.onHexIconClick(x, y);
          else if (this.host.drawingMode() === "factionLink") void this.host.areas().onHexFactionPaintClick(x, y);
          else void this.host.areas().onHexRegionPaintClick(x, y);
          hasDragged = true; // suppress the subsequent click event
        }
        beginDrag();
        return; // skip pan setup
      }
      // The path tool takes a press on a point or line of its type (drag to reshape).
      if (this.host.drawingMode() === "path" && this.host.pathTool().pointerDown(e, this.host.isErasingMode())) return;
      // Any other active tool (road, river, tableLink, swap):
      // let the click event handle it — don't set up drag/pan so hasDragged
      // never swallows the click.
      if (this.host.drawingMode() !== null) return;
      isDragging = true;
      hasDragged = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = this.host.viewport().panX;
      panStartY = this.host.viewport().panY;
      this.host.viewportEl()?.addClass("is-dragging");
      beginDrag();
    });

    // Hover brush highlight (no button held) — element-level so it keeps
    // working after "Move to new window" re-parents the view into a popout
    // document (issue #32). Stroke-time highlight is owned by onDragMove.
    this.host.registerDomEvent(contentEl, "mousemove", (e: MouseEvent) => {
      if (isTerrainPainting) return;
      if (this.host.drawingMode() === "path" && e.buttons === 0) this.host.pathTool().pointerMove(e, this.host.isErasingMode());
      if (this.host.drawingMode() === "terrain" || this.host.drawingMode() === "icon") {
        const hexEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(
          ".duckmage-hex",
        );
        if (hexEl) {
          this.host.updateBrushHighlight(
            Number(hexEl.dataset.x),
            Number(hexEl.dataset.y),
          );
        } else {
          this.host.updateBrushHighlight(null, null);
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
      if (isTerrainPainting && this.host.drawingMode() === "biome") {
        const key = this.host.overworldHexKeyAt(dragDoc?.elementFromPoint(e.clientX, e.clientY) ?? null, e.clientX, e.clientY);
        if (key && key !== lastPaintedKey) {
          lastPaintedKey = key;
          this.host.biomeStroke()?.add(key);
        }
        return;
      }
      if (isTerrainPainting && this.host.undos().currentSubStroke) {
        const key = this.host.subHexKeyAt(e.clientX, e.clientY);
        if (key && key !== lastPaintedKey) lastPaintedKey = this.host.paintSubHexAt(e.clientX, e.clientY);
        return;
      }
      if (isTerrainPainting) {
        const el = dragDoc?.elementFromPoint(e.clientX, e.clientY) ?? null;
        const hexEl = this.host.hexElAt(el, e.clientX, e.clientY);
        if (hexEl) {
          const x = Number(hexEl.dataset.x);
          const y = Number(hexEl.dataset.y);
          const key = hexKey(x, y);
          if (key !== lastPaintedKey) {
            lastPaintedKey = key;
            if (this.host.drawingMode() === "terrain") this.host.onHexPaintClick(x, y);
            else if (this.host.drawingMode() === "icon") this.host.onHexIconClick(x, y);
            else if (this.host.drawingMode() === "factionLink") void this.host.areas().onHexFactionPaintClick(x, y);
            else void this.host.areas().onHexRegionPaintClick(x, y);
          }
          this.host.updateBrushHighlight(x, y);
        } else {
          this.host.updateBrushHighlight(null, null);
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
        this.host.viewport().panX = panStartX + dx;
        this.host.viewport().panY = panStartY + dy;
        this.host.viewport().applyTransform();
      }
    };
    const onDragUp = () => {
      if (isTerrainPainting) {
        if (this.host.drawingMode() === "biome") void this.host.finishBiomeStroke();
        else if (this.host.drawingMode() === "terrain") this.host.undos().commitTerrainStroke();
        else if (this.host.drawingMode() === "icon") this.host.undos().commitIconStroke();
        else if (this.host.drawingMode() === "factionLink") this.host.undos().commitFactionStroke();
        else if (this.host.drawingMode() === "regionLink") this.host.undos().commitRegionStroke();
      }
      isTerrainPainting = false;
      lastPaintedKey = null;
      isDragging = false;
      isRightDragging = false;
      this.host.viewportEl()?.removeClass("is-dragging");
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
    this.host.register(endDrag); // don't leak listeners if the view closes mid-drag

    // Swallow clicks that ended a drag so hex click-handlers don't fire
    this.host.registerDomEvent(
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
    this.host.registerDomEvent(
      contentEl,
      "contextmenu",
      (e: MouseEvent) => {
        if (rightDragMoved) {
          e.preventDefault();
          e.stopPropagation();
          rightDragMoved = false;
          return;
        }
        if (this.host.drawingMode() === null) return;
        e.preventDefault();
        e.stopPropagation();
        const hexEl = this.host.hexElAt(e.target, e.clientX, e.clientY);
        const hexX = hexEl ? Number(hexEl.dataset.x) : null;
        const hexY = hexEl ? Number(hexEl.dataset.y) : null;
        const paintIconName = this.host.paintIconName();
        if (
          this.host.drawingMode() === "icon" &&
          this.host.paintIconGmOnly() &&
          !this.host.isErasingMode() &&
          paintIconName &&
          hexEl && hexX !== null && hexY !== null
        ) {
          this.host.removeOneGmIconFromHex(hexEl, hexX, hexY, paintIconName);
          return;
        }
        // Path tool: right-click an anchor of a path of the tool's type
        // deletes it; on such a path (or Shift on an anchor), the menu adds
        // that path's actions; on another type's path, "Switch to <type>".
        let pathItems: PainterContextMenuOption[] = [];
        if (this.host.drawingMode() === "path" && !this.host.isErasingMode()) {
          const r = this.host.pathTool().contextMenu(e);
          if (r && "handled" in r) return;
          if (r) pathItems = [...r.items, ...this.host.toolbar().overworldPathItems(this.host.pathTool().labelState().selected)];
        }
        this.host.toolbar().showPainterContextMenu(e.clientX, e.clientY, hexX, hexY, pathItems);
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
      const hexEl = this.host.hexElAt(t, e.clientX, e.clientY);
      return hexEl ? { x: Number(hexEl.dataset.x), y: Number(hexEl.dataset.y) } : null;
    };
    this.host.registerDomEvent(clipEl, "click", (e: MouseEvent) => {
      const hex = onGap(e);
      if (hex) void this.host.onHexClick(hex.x, hex.y, e);
    });
    this.host.registerDomEvent(clipEl, "contextmenu", (e: MouseEvent) => {
      if (this.host.drawingMode() !== null) return; // the tool menu (capture) owns it
      const hex = onGap(e);
      if (hex) this.host.onHexContextMenu(e, hex.x, hex.y);
    });

  }
}

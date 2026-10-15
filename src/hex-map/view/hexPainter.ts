/**
 * The paint tools' hex handlers (L2b, split out of HexMapView): terrain
 * (brush, eyedropper, the brush hover), icons and GM icons, the region-hex
 * brush of an overworld's full view, the biome brush's strokes, the
 * one-hex menu edits, and the table / submap link tools' clicks; plus the
 * hex cell repaint and hover label they share.
 *
 * Paint handlers are synchronous: the DOM is patched now and the file write
 * goes through the coalescing queues (view/hexWrites.ts), recorded on the
 * stroke being painted (view/undoController.ts) for one undo per stroke.
 * Region-hex paint writes through mapStore.set(…, "paint-terrain"), the
 * hand edit that locks a new region (modeGate.noteHandEdit).
 */
import { Notice, TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getIconUrl, createIconEl } from "../../utils";
import { getTerrainFromFile, getIconOverrideFromFile, getHexNameFromFile } from "../../frontmatter";
import type { CellEdit } from "../../undoBook";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "../../sections";
import type { ModeAction } from "../../workMode";
import { lockedNotice } from "../godOffer";
import { hexHoverLabel, pathFirst } from "../hexHover";
import type { MapData } from "../../types";
import { hexNeighbors } from "../hexGeometry";
import { linkedNotesText, linksBySection } from "../linkBadges";
import { regionMapAt } from "../../maps/submaps";
// World maps through the view, typed only.
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { OverworldLayer } from "../../overworld/overworldLayer";
import type { BiomeStroke } from "../../overworld/biomePainter";
import type { DrawingMode } from "../toolMode";
import type { IconUndoEntry } from "../undoItems";
import { parseGmIconsDataset, type PathOverlay } from "./pathOverlay";
import { setHexColor } from "./gridRenderer";
import type { HexWrites } from "./hexWrites";
import type { MapToolbar } from "./mapToolbar";
import type { UndoController } from "./undoController";

export interface HexPainterHost {
  plugin: HexmakerPlugin;
  viewportEl(): HTMLElement | null;
  activeMapName(): string;
  getActiveMap(): MapData;
  owView(map: MapData): "regions" | "biomes" | null;
  getActiveStagger(): "odd" | "even";
  wm(): WorldMapsApi | undefined;
  overworldLayer(): OverworldLayer | undefined;
  /** The tool state the handlers read (and the eyedropper writes). */
  toolbar: Pick<
    MapToolbar,
    | "drawingMode"
    | "isErasingMode"
    | "paintTerrainName"
    | "terrainPickMode"
    | "paintBrushSize"
    | "paintIconName"
    | "paintIconGmOnly"
    | "paintTablePath"
    | "paintSubmapName"
    | "paintBiomeId"
    | "updateToolbarButtonStates"
  >;
  undos: Pick<UndoController, "currentTerrainStroke" | "currentIconStroke" | "currentSubStroke" | "pushUndo" | "updateUndoButton">;
  writes: Pick<HexWrites, "terrain" | "icon" | "gmIcons">;
  pathLayer: Pick<PathOverlay, "updateGmIcons" | "updatePathOverlay">;
  modeAllows(action: ModeAction): boolean;
  hexElAt(target: EventTarget | null, clientX: number, clientY: number): HTMLElement | null;
  renderGrid(terrainOverrides?: Map<string, string | null>, iconOverrides?: Map<string, string | null>): void;
}

export class HexPainter {
  private brushHoverHexes: Array<[number, number]> = [];
  /** The biome brush's stroke being painted (overworlds only). */
  biomeStroke: BiomeStroke<CellEdit> | null = null;
  /** The "no region here" hint was shown this stroke (once is enough). */
  subStrokeMissHinted = false;

  constructor(private host: HexPainterHost) {}

  // The view's state, read live (the bodies below read it as `this.…`).
  private get plugin(): HexmakerPlugin { return this.host.plugin; }
  private get app(): App { return this.host.plugin.app; }
  private get viewportEl(): HTMLElement | null { return this.host.viewportEl(); }
  private get activeMapName(): string { return this.host.activeMapName(); }
  private get wm(): WorldMapsApi | undefined { return this.host.wm(); }
  private get overworldLayer(): OverworldLayer | undefined { return this.host.overworldLayer(); }
  private get toolbar(): HexPainterHost["toolbar"] { return this.host.toolbar; }
  private get undos(): HexPainterHost["undos"] { return this.host.undos; }
  private get writes(): HexPainterHost["writes"] { return this.host.writes; }
  private get pathLayer(): HexPainterHost["pathLayer"] { return this.host.pathLayer; }
  private get drawingMode(): DrawingMode | null { return this.toolbar.drawingMode; }
  private get isErasingMode(): boolean { return this.toolbar.isErasingMode; }
  private get paintTerrainName(): string | null { return this.toolbar.paintTerrainName; }
  private set paintTerrainName(v: string | null) { this.toolbar.paintTerrainName = v; }
  private get terrainPickMode(): boolean { return this.toolbar.terrainPickMode; }
  private set terrainPickMode(v: boolean) { this.toolbar.terrainPickMode = v; }
  private get paintBrushSize(): 1 | 3 | 7 { return this.toolbar.paintBrushSize; }
  private get paintIconName(): string | null { return this.toolbar.paintIconName; }
  private get paintIconGmOnly(): boolean { return this.toolbar.paintIconGmOnly; }
  private get paintTablePath(): string | null { return this.toolbar.paintTablePath; }
  private get paintSubmapName(): string | null { return this.toolbar.paintSubmapName; }
  private get paintBiomeId(): string | null { return this.toolbar.paintBiomeId; }
  private getActiveMap(): MapData { return this.host.getActiveMap(); }
  private owView(map: MapData): "regions" | "biomes" | null { return this.host.owView(map); }
  private getActiveStagger(): "odd" | "even" { return this.host.getActiveStagger(); }
  private modeAllows(action: ModeAction): boolean { return this.host.modeAllows(action); }
  private hexElAt(target: EventTarget | null, clientX: number, clientY: number): HTMLElement | null { return this.host.hexElAt(target, clientX, clientY); }
  private renderGrid(terrainOverrides?: Map<string, string | null>, iconOverrides?: Map<string, string | null>): void { this.host.renderGrid(terrainOverrides, iconOverrides); }
  private setHexColor(hexEl: HTMLElement, color: string | undefined | null): void { setHexColor(hexEl, color); }

  /** The overworld hex under a point: the brick's parent hex in the Regions view, else the hex there. */
  overworldHexKeyAt(target: EventTarget | null, clientX: number, clientY: number): string | null {
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
  startBiomeStroke(): void {
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
  async finishBiomeStroke(): Promise<void> {
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

  updateBrushHighlight(x: number | null, y: number | null): void {
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

  onHexPaintClick(x: number, y: number): void {
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
  removeOneGmIconFromHex(
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

  onHexIconClick(x: number, y: number): void {
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

  async onHexTableLinkClick(x: number, y: number): Promise<void> {
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

  async onHexSubmapLinkClick(x: number, y: number): Promise<void> {
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

  async linkTableToHex(x: number, y: number, tableFile: TFile): Promise<void> {
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

  /**
   * A hex's tooltip / accessible name: name, terrain, coords, links.
   * `terrain` (when given) is the terrain just painted, ahead of its queued
   * write; otherwise a queued write wins over the saved map data. Called on
   * hover and right after a repaint (round 7 S18: the label said "void (map
   * base)" until the hex was hovered again).
   */
  labelHex(hexEl: HTMLElement, terrain?: string | null, path?: string): void {
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

  applyTerrainToHexEl(
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
  subHexKeyAt(clientX: number, clientY: number): string | null {
    const grid = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = grid ? this.overworldLayer?.cellAt(grid, clientX, clientY) ?? null : null;
    return cell ? `${cell.x}_${cell.y}` : null;
  }

  /**
   * Paint the region hex under a screen point (full view): written to that
   * region's map and locked, so regenerating the region keeps it. A brush
   * wider than one hex reaches across seams into the next region.
   */
  paintSubHexAt(clientX: number, clientY: number): string | null {
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

  /** Set (or clear) one hex's terrain from a menu: mode-gated and undoable. */
  paintOne(x: number, y: number, terrain: string | null): void {
    if (!this.modeAllows("paint-terrain")) return;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const old = getTerrainFromFile(this.app, path);
    if (old === terrain) return;
    this.undos.pushUndo({ kind: "terrain", entries: [{ x, y, path, oldTerrain: old, newTerrain: terrain }] });
    this.writes.terrain.schedule(path, { x, y, terrain });
    this.renderGrid();
  }

  /** "Remove icon override" from the hex menu: mode-gated and undoable. */
  removeIconOverride(x: number, y: number): void {
    if (!this.modeAllows("paint-icon")) return;
    const path = this.plugin.hexPath(x, y, this.activeMapName);
    const old = getIconOverrideFromFile(this.app, path);
    if (!old) return;
    this.undos.pushUndo({ kind: "icon", entries: [{ x, y, path, oldIcon: old, newIcon: null, isGm: false }] });
    this.writes.icon.schedule(path, { x, y, icon: null });
    this.renderGrid(undefined, new Map([[path, null]]));
  }
}

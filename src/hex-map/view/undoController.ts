/**
 * Undo / redo for the map view (L2d, split out of HexMapView): the strokes
 * being painted, committing them to this map's queue for its work mode
 * (plugin.undoBook, WM6), and preparing / applying every entry kind
 * (terrain, icon, faction, region, subhex, swap, path, calibrate, cells,
 * projection, token, group, map-field). An entry whose target changed since
 * is skipped part by part, so it never reverts the newer change.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getGmIconsFromFile, getHexRegionFromFile, getIconOverrideFromFile, getTerrainFromFile, readTokenPlace } from "../../frontmatter";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { PinRecord } from "../../paths/routePins";
import type { MapPath } from "../../types";
import { cellPatch, currentCellEdits, sameValue, stillCurrent, UNDO_DEPTH, type UndoDirection } from "../../undoBook";
import { getIconUrl } from "../../utils";
import { WORK_MODE_TEXT, workModeOf, type WorkMode } from "../../workMode";
import type { FactionUndoEntry, IconUndoEntry, RegionUndoEntry, SubHexUndoEntry, TerrainUndoEntry, TokenSnap, UndoItem } from "../undoItems";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { HexWrites } from "./hexWrites";
import { applyGroup, applyMapField, prepareGroup, prepareMapField } from "./undoGroup";

export interface UndoHost {
  plugin: HexmakerPlugin;
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  wm(): WorldMapsApi | undefined;
  writes: HexWrites;
  calibration: Pick<BackgroundCalibration, "captureCalibration" | "applyCalibrationSnapshot">;
  /** The undo / redo buttons (null before the view is open). */
  undoButtons(): { undo: HTMLButtonElement | null; redo: HTMLButtonElement | null };
  applyTerrainToHexEl(hexEl: HTMLElement, terrain: string | null): void;
  getFactionLinksFromCache(hexFilePath: string): string[];
  applyFactionStroke(entries: FactionUndoEntry[], which: "old" | "new"): Promise<void>;
  applyRegionStroke(entries: RegionUndoEntry[], which: "old" | "new"): Promise<void>;
  executeHexSwap(x1: number, y1: number, x2: number, y2: number, isUndoRedo: boolean): Promise<void>;
  applyPathSnapshot(mapName: string, paths: MapPath[]): Promise<void>;
  applyTokenSnap(path: string, snap: TokenSnap | null): Promise<void>;
  renderGrid(): void;
  updateModeBar(): void;
  updateGmIcons(): void;
  updatePathOverlay(): void;
}

export class UndoController {
  /** The strokes being painted (committed as one undo entry on mouse up). */
  currentTerrainStroke: Map<string, TerrainUndoEntry> | null = null;
  currentIconStroke: Map<string, IconUndoEntry> | null = null;
  currentFactionStroke: Map<string, FactionUndoEntry> | null = null;
  currentRegionStroke: Map<string, RegionUndoEntry> | null = null;
  currentSubStroke: Map<string, SubHexUndoEntry> | null = null;
  /** Pins made while a terrain stroke is painted or its writes land (see routePins.ts). */
  strokePins: PinRecord[] | null = null;
  private undoBusy = false;

  constructor(private host: UndoHost) {}

  commitSubStroke(): void {
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
      this.host.plugin.mapStore.set(e.map, e.key, { terrain, locked: locked || null });
    }
    void this.host.plugin.mapStore.flush();
  }

  commitTerrainStroke(): void {
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

  commitIconStroke(): void {
    if (!this.currentIconStroke || this.currentIconStroke.size === 0) {
      this.currentIconStroke = null;
      return;
    }
    const entries = [...this.currentIconStroke.values()];
    this.pushUndo({ kind: "icon", entries });
    this.currentIconStroke = null;
    this.updateUndoButton();
  }

  commitFactionStroke(): void {
    if (!this.currentFactionStroke || this.currentFactionStroke.size === 0) {
      this.currentFactionStroke = null;
      return;
    }
    const entries = [...this.currentFactionStroke.values()];
    this.pushUndo({ kind: "faction", entries });
    this.currentFactionStroke = null;
    this.updateUndoButton();
  }

  commitRegionStroke(): void {
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
  pushUndo(item: UndoItem, mapName = this.host.activeMapName()): void {
    this.host.plugin.pushUndo(mapName, item);
  }

  /** The open map's work mode: its undo queue is the one the buttons use. */
  currentWorkMode(): WorkMode {
    return workModeOf(this.host.plugin.getMap(this.host.activeMapName()));
  }

  /** Undo the last action done on this map in its current mode (WM6). */
  async undo(): Promise<void> {
    await this.undoStep("undo");
  }

  async redo(): Promise<void> {
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
      const item = await this.host.plugin.undoBook.step(this.host.activeMapName(), this.currentWorkMode(), dir, (it, d) => this.prepareUndo(it, d));
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
    const store = this.host.plugin.mapStore;
    const keep = <E>(parts: E[], current: (p: E) => unknown, before: (p: E) => unknown, after: (p: E) => unknown) =>
      stillCurrent(parts, dir, current, before, after);
    switch (item.kind) {
      case "terrain": {
        const entries = keep(item.entries, (e) => getTerrainFromFile(this.host.plugin.app, e.path), (e) => e.oldTerrain, (e) => e.newTerrain);
        return entries ? { ...item, entries } : null;
      }
      case "icon": {
        const list = (l: string[] | undefined, one: string | null) => l ?? (one !== null ? [one] : []);
        const entries = keep(
          item.entries,
          (e) => (e.isGm ? getGmIconsFromFile(this.host.plugin.app, e.path) : getIconOverrideFromFile(this.host.plugin.app, e.path)),
          (e) => (e.isGm ? list(e.oldGmList, e.oldIcon) : e.oldIcon),
          (e) => (e.isGm ? list(e.newGmList, e.newIcon) : e.newIcon),
        );
        return entries ? { ...item, entries } : null;
      }
      case "faction": {
        const entries = keep(item.entries, (e) => this.host.getFactionLinksFromCache(e.hexPath).includes(e.factionBasename), (e) => e.wasPresent, (e) => !e.wasPresent);
        return entries ? { ...item, entries } : null;
      }
      case "region": {
        const entries = keep(item.entries, (e) => getHexRegionFromFile(this.host.plugin.app, e.hexPath), (e) => e.oldRegion, (e) => e.newRegion);
        return entries ? { ...item, entries } : null;
      }
      case "subhex": {
        const entries = keep(item.entries, (e) => store.get(e.map, e.key)?.terrain ?? null, (e) => e.oldTerrain, (e) => e.newTerrain);
        return entries ? { ...item, entries } : null;
      }
      case "swap": {
        if (!item.after) return item;
        const now = [store.get(this.host.activeMapName(), `${item.x1}_${item.y1}`) ?? null, store.get(this.host.activeMapName(), `${item.x2}_${item.y2}`) ?? null];
        // A swap is its own inverse: before it, the two hexes held each other's data.
        const want = dir === "undo" ? item.after : [item.after[1], item.after[0]];
        return sameValue(now, want) ? item : null;
      }
      case "path": {
        const want = dir === "undo" ? item.after : item.before;
        return sameValue(store.paths(item.mapName), want) ? item : null;
      }
      case "calibrate": {
        const map = this.host.plugin.getMap(item.mapName);
        if (!map) return null;
        return sameValue(this.host.calibration.captureCalibration(map), dir === "undo" ? item.after : item.before) ? item : null;
      }
      case "cells": {
        const edits = currentCellEdits(item.edits, dir, (m, k) => store.get(m, k) as Record<string, unknown> | undefined);
        return edits ? { ...item, edits } : null;
      }
      case "projection":
        return this.host.wm()?.prepareProjectionUndo(this.host.plugin, item, dir) ?? null;
      case "token": {
        const now = await readTokenPlace(this.host.plugin.app, item.path);
        const want = dir === "undo" ? item.after : item.before;
        const place = (t: TokenSnap | null) => (t ? { hex: t.hex, map: t.map } : null);
        return sameValue(now, place(want)) ? item : null;
      }
      case "group": return prepareGroup(item, dir, (it, d) => this.prepareUndo(it, d));
      case "map-field": return prepareMapField(this.host.plugin, item, dir);
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
          this.host.plugin.pathPins.rerouteInstead(pins);
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
      await this.host.applyFactionStroke(item.entries, which);
    } else if (item.kind === "region") {
      await this.host.applyRegionStroke(item.entries, which);
    } else if (item.kind === "subhex") {
      this.applySubStroke(item.entries, which);
    } else if (item.kind === "swap") {
      await this.host.executeHexSwap(item.x1, item.y1, item.x2, item.y2, true);
    } else if (item.kind === "calibrate") {
      await this.host.calibration.applyCalibrationSnapshot(item.mapName, dir === "undo" ? item.before : item.after);
    } else if (item.kind === "path") {
      await this.host.applyPathSnapshot(item.mapName, dir === "undo" ? item.before : item.after);
    } else if (item.kind === "cells") {
      for (const e of item.edits) this.host.plugin.mapStore.set(e.map, e.key, cellPatch(e, dir));
      this.host.renderGrid();
    } else if (item.kind === "projection") {
      this.host.wm()?.applyProjectionUndo(this.host.plugin, item, dir);
      void this.host.plugin.saveSettings();
      this.host.renderGrid();
      this.host.updateModeBar();
    } else if (item.kind === "group") await applyGroup(item, dir, (it, d) => this.applyUndo(it, d));
    else if (item.kind === "map-field") applyMapField(this.host.plugin, item, dir);
    else {
      await this.host.applyTokenSnap(item.path, dir === "undo" ? item.before : item.after);
    }
  }

  /** Record a token change for undo (from a token's data before and after). */
  pushTokenUndo(path: string, mapName: string, before: TokenSnap | null, after: TokenSnap | null): void {
    if (sameValue(before, after)) return;
    this.pushUndo({ kind: "token", path, before, after }, mapName);
  }

  /** Wait (briefly) until every queued terrain write has landed in the map store. */
  async terrainWritesSettled(): Promise<void> {
    const busy = () => this.host.writes.terrain.busy();
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
        const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(
          `[data-x="${entry.x}"][data-y="${entry.y}"]`,
        );
        if (hexEl) this.host.applyTerrainToHexEl(hexEl, terrain);
      } catch (err) {
        console.warn(
          `[hexmaker] stroke visual update failed for ${entry.path}:`,
          err,
        );
      }
      try {
        this.host.writes.terrain.schedule(entry.path, { x: entry.x, y: entry.y, terrain });
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
      const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(
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
        this.host.writes.gmIcons.schedule(entry.path, { x: entry.x, y: entry.y, list: [...list] });
      } else {
        if (hexEl) {
          hexEl.querySelector(".duckmage-hex-icon")?.remove();
          if (icon) {
            const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
            img.src = getIconUrl(this.host.plugin, icon);
            img.alt = icon;
            hexEl.insertBefore(img, hexEl.querySelector(".duckmage-hex-dot"));
            hexEl.dataset.iconOverride = icon;
          } else {
            delete hexEl.dataset.iconOverride;
            // Restore the terrain icon that the override was hiding
            const terrain = getTerrainFromFile(this.host.plugin.app, entry.path);
            this.host.applyTerrainToHexEl(hexEl, terrain);
          }
        }
        this.host.writes.icon.schedule(entry.path, { x: entry.x, y: entry.y, icon });
      }
    }
    if (entries.some((e) => e.isGm)) this.host.updateGmIcons();
    this.host.updatePathOverlay();
  }

  updateUndoButton(): void {
    // The buttons act on this map's queue for its current mode, and say so.
    const mode = this.currentWorkMode();
    const label = WORK_MODE_TEXT[mode].label;
    const book = this.host.plugin.undoBook;
    const { undo: undoBtn, redo: redoBtn } = this.host.undoButtons();
    if (undoBtn) {
      undoBtn.disabled = !book.canUndo(this.host.activeMapName(), mode);
      undoBtn.setAttr("title", `Undo (${label} mode, up to ${UNDO_DEPTH})`);
    }
    if (redoBtn) {
      redoBtn.disabled = !book.canRedo(this.host.activeMapName(), mode);
      redoBtn.setAttr("title", `Redo (${label} mode)`);
    }
  }

  pushPathUndo(mapName: string, before: MapPath[], after: MapPath[]): void {
    // A confirmed overworld path that was just reshaped, retyped or renamed
    // is a draft again until it's confirmed into its regions once more.
    const wm = this.host.wm();
    const drafted = wm ? wm.draftsAfterEdit(before, after) : after;
    if (drafted !== after) {
      this.host.plugin.mapStore.setPaths(mapName, drafted);
      after = drafted;
    }
    this.pushUndo({ kind: "path", mapName, before, after }, mapName);
    this.updateUndoButton();
  }
}

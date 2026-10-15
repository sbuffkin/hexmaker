/**
 * The +/− buttons on the grid's four edges (L2, split out of HexMapView):
 * grow or shrink the map by a row or column, keeping the existing hexes
 * (and a calibrated background image) where they are on screen, and ask
 * before dropping an edge whose hexes have content.
 */
import { Notice, TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getTerrainFromFile } from "../../frontmatter";
import type { MapData } from "../../types";
import type { ModeAction } from "../../workMode";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { MapViewport } from "./mapViewport";

function nullOverrides(paths: string[]): Map<string, null> {
  return new Map(paths.map((p) => [p, null]));
}

export interface GridEdgeHost {
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  getActiveMap(): MapData;
  viewport(): Pick<MapViewport, "panX" | "panY" | "zoom" | "applyTransform">;
  calibration: Pick<BackgroundCalibration, "applyBgLayerVars">;
  /** May the open map do `action` in its mode? (says which mode would, when not) */
  modeAllows(action: ModeAction): boolean;
  renderGrid(terrainOverrides?: Map<string, string | null>, iconOverrides?: Map<string, string | null>): void;
}

export class GridEdgeButtons {
  constructor(private plugin: HexmakerPlugin, private host: GridEdgeHost) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get activeMapName(): string {
    return this.host.activeMapName();
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
      this.host.viewport().panY -= sign * stride * sy * this.host.viewport().zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetY += sign * stride * sy;
      }
    } else {
      const sx = this.gridDisplayScaleX(map);
      this.host.viewport().panX -= sign * stride * sx * this.host.viewport().zoom;
      if (map.backgroundImage) {
        map.backgroundImage.offsetX += sign * stride * sx;
      }
    }
    this.host.viewport().applyTransform();
    if (map.backgroundImage) {
      // Re-apply the bg layer's transform with the new offset so the visual
      // updates immediately, and persist the new offset.
      const layer = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
      if (layer) this.host.calibration.applyBgLayerVars(layer, map.backgroundImage);
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
        const col = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-col");
        const hexes = col?.querySelectorAll<HTMLElement>(".duckmage-hex");
        if (!hexes || hexes.length < 2) return 0;
        return hexes[1].offsetTop - hexes[0].offsetTop;
      }
      // Pointy-top: rows stack vertically inside the grid container. Measure
      // the offsetTop delta between the first two rows.
      const rows = this.host.viewportEl()?.querySelectorAll<HTMLElement>(".duckmage-hex-row");
      if (!rows || rows.length < 2) return 0;
      return rows[1].offsetTop - rows[0].offsetTop;
    }
    // axis === "col"
    if (isFlat) {
      // Flat-top: columns are siblings in the grid container; measure delta.
      const cols = this.host.viewportEl()?.querySelectorAll<HTMLElement>(".duckmage-hex-col");
      if (!cols || cols.length < 2) return 0;
      return cols[1].offsetLeft - cols[0].offsetLeft;
    }
    // Pointy-top: hexes within a row are side-by-side. Measure delta between
    // first two hexes in the first row.
    const row = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-row");
    const hexes = row?.querySelectorAll<HTMLElement>(".duckmage-hex");
    if (!hexes || hexes.length < 2) return 0;
    return hexes[1].offsetLeft - hexes[0].offsetLeft;
  }

  createExpandButtons(container: HTMLElement): void {
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
          this.host.getActiveMap().gridOffset.y--;
          this.host.getActiveMap().gridSize.rows++;
          await this.plugin.saveSettings();
          const r = this.host.getActiveMap();
          const xs = Array.from({ length: r.gridSize.cols }, (_, i) => r.gridOffset.x + i);
          const newPaths = xs.map((x) => this.plugin.hexPath(x, r.gridOffset.y, this.activeMapName));
          this.host.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          this.shiftForGridGrowth({ axis: "row", direction: "above" }, r);
          void this.plugin.generateHexNotes(this.activeMapName, xs, [r.gridOffset.y]);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.rows--;
          this.host.getActiveMap().gridOffset.y++;
          await this.plugin.saveSettings();
          this.host.renderGrid();
          this.shiftForGridGrowth({ axis: "row", direction: "above", shrink: true }, this.host.getActiveMap());
        },
        canShrink: () => this.host.getActiveMap().gridSize.rows > 1,
        edgePaths: () => {
          const r = this.host.getActiveMap();
          return Array.from({ length: r.gridSize.cols }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x + i, r.gridOffset.y, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-bottom",
        expandAction: async () => {
          this.host.getActiveMap().gridSize.rows++;
          await this.plugin.saveSettings();
          const r = this.host.getActiveMap();
          const newY = r.gridOffset.y + r.gridSize.rows - 1;
          const xs = Array.from({ length: r.gridSize.cols }, (_, i) => r.gridOffset.x + i);
          const newPaths = xs.map((x) => this.plugin.hexPath(x, newY, this.activeMapName));
          this.host.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          void this.plugin.generateHexNotes(this.activeMapName, xs, [newY]);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.rows--;
          await this.plugin.saveSettings();
          this.host.renderGrid();
        },
        canShrink: () => this.host.getActiveMap().gridSize.rows > 1,
        edgePaths: () => {
          const r = this.host.getActiveMap();
          const lastY = r.gridOffset.y + r.gridSize.rows - 1;
          return Array.from({ length: r.gridSize.cols }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x + i, lastY, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-left",
        expandAction: async () => {
          this.host.getActiveMap().gridOffset.x--;
          this.host.getActiveMap().gridSize.cols++;
          await this.plugin.saveSettings();
          const r = this.host.getActiveMap();
          const ys = Array.from({ length: r.gridSize.rows }, (_, i) => r.gridOffset.y + i);
          const newPaths = ys.map((y) => this.plugin.hexPath(r.gridOffset.x, y, this.activeMapName));
          this.host.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          this.shiftForGridGrowth({ axis: "col", direction: "above" }, r);
          void this.plugin.generateHexNotes(this.activeMapName, [r.gridOffset.x], ys);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.cols--;
          this.host.getActiveMap().gridOffset.x++;
          await this.plugin.saveSettings();
          this.host.renderGrid();
          this.shiftForGridGrowth({ axis: "col", direction: "above", shrink: true }, this.host.getActiveMap());
        },
        canShrink: () => this.host.getActiveMap().gridSize.cols > 1,
        edgePaths: () => {
          const r = this.host.getActiveMap();
          return Array.from({ length: r.gridSize.rows }, (_, i) =>
            this.plugin.hexPath(r.gridOffset.x, r.gridOffset.y + i, this.activeMapName),
          );
        },
      },
      {
        groupCls: "duckmage-expand-group-right",
        expandAction: async () => {
          this.host.getActiveMap().gridSize.cols++;
          await this.plugin.saveSettings();
          const r = this.host.getActiveMap();
          const newX = r.gridOffset.x + r.gridSize.cols - 1;
          const ys = Array.from({ length: r.gridSize.rows }, (_, i) => r.gridOffset.y + i);
          const newPaths = ys.map((y) => this.plugin.hexPath(newX, y, this.activeMapName));
          this.host.renderGrid(nullOverrides(newPaths), nullOverrides(newPaths));
          void this.plugin.generateHexNotes(this.activeMapName, [newX], ys);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.cols--;
          await this.plugin.saveSettings();
          this.host.renderGrid();
        },
        canShrink: () => this.host.getActiveMap().gridSize.cols > 1,
        edgePaths: () => {
          const r = this.host.getActiveMap();
          const lastX = r.gridOffset.x + r.gridSize.cols - 1;
          return Array.from({ length: r.gridSize.rows }, (_, i) =>
            this.plugin.hexPath(lastX, r.gridOffset.y + i, this.activeMapName),
          );
        },
      },
    ];

    // Neighbouring regions all share one size, so a map that has them can't grow or shrink.
    const sizeLocked = (): boolean => {
      if (!this.host.getActiveMap().world) return false;
      new Notice("This map has neighbouring regions, which all share one size. Detach it from them in the map list's properties tab to resize it.");
      return true;
    };
    for (const { groupCls, expandAction, shrinkAction, canShrink, edgePaths } of dirs) {
      const group = container.createDiv({
        cls: `duckmage-expand-group ${groupCls}`,
      });

      group.createEl("button", { cls: "duckmage-expand-btn", text: "+" })
        .addEventListener("click", () => {
          if (this.host.modeAllows("grow-map") && !sizeLocked()) void expandAction();
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
        if (!this.host.modeAllows("shrink-map") || !canShrink() || sizeLocked()) return;
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

}

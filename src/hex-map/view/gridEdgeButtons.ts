/**
 * The +/− buttons on the grid's four edges (L2, split out of HexMapView):
 * grow or shrink the map by a row or column, keeping the existing hexes
 * (and a calibrated background image) where they are on screen
 * (gridResize.ts), and ask
 * before dropping an edge whose hexes have content.
 */
import { Notice, TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getTerrainFromFile } from "../../frontmatter";
import type { MapData } from "../../types";
import type { ModeAction } from "../../workMode";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { MapViewport } from "./mapViewport";
import type { GridBox } from "../../maps/gridGrowth";
import { keepViewStill, shiftView } from "./gridResize";

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

  /** `rows` rows added at the top / `cols` columns at the left (negative: removed): keep the view still (gridResize.ts). */
  private shiftForGridGrowth(rows: number, cols: number, map: MapData): void {
    shiftView({ ...this.host, plugin: this.plugin }, map, rows, cols);
  }

  /** After the grid went from `before` to `after` (and was redrawn): keep the view still. */
  keepViewStill(before: GridBox, after: GridBox): void {
    keepViewStill({ ...this.host, plugin: this.plugin }, this.host.getActiveMap(), before, after);
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
          this.shiftForGridGrowth(1, 0, r);
          void this.plugin.generateHexNotes(this.activeMapName, xs, [r.gridOffset.y]);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.rows--;
          this.host.getActiveMap().gridOffset.y++;
          await this.plugin.saveSettings();
          this.host.renderGrid();
          this.shiftForGridGrowth(-1, 0, this.host.getActiveMap());
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
          this.shiftForGridGrowth(0, 1, r);
          void this.plugin.generateHexNotes(this.activeMapName, [r.gridOffset.x], ys);
        },
        shrinkAction: async () => {
          this.host.getActiveMap().gridSize.cols--;
          this.host.getActiveMap().gridOffset.x++;
          await this.plugin.saveSettings();
          this.host.renderGrid();
          this.shiftForGridGrowth(0, -1, this.host.getActiveMap());
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

/**
 * The swap tool (L2, split out of HexMapView): pick two hexes and swap
 * their notes and map data (God only), safely around the paint write
 * queues, with an undo entry. Undo / redo swap back through executeHexSwap.
 */
import { Notice, TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { guardWrite } from "../../modeGate";
import { normalizeFolder } from "../../utils";
import type { HexWrites } from "./hexWrites";
import type { MapToolbar } from "./mapToolbar";
import type { UndoController } from "./undoController";

export interface HexSwapHost {
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  writes: Pick<HexWrites, "discard" | "flushingAny">;
  undos: Pick<UndoController, "pushUndo" | "updateUndoButton">;
  /** The tool state (the swap's picked hex) and the toolbar's swap helpers. */
  toolbar: Pick<MapToolbar, "drawingMode" | "swapSource" | "swapDest" | "clearSwapHighlights" | "exitSwapMode">;
  renderGrid(): void;
}

export class HexSwap {
  constructor(private plugin: HexmakerPlugin, private host: HexSwapHost) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get activeMapName(): string {
    return this.host.activeMapName();
  }

  // Insert an overlay span INSIDE the hex element so it's shaped by clip-path
  private highlightSwapHex(
    x: number,
    y: number,
    cls: "duckmage-hex-swap-source" | "duckmage-hex-swap-dest",
  ): void {
    const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (!hexEl) return;
    // Remove any existing overlay on this hex first
    hexEl
      .querySelector(".duckmage-hex-swap-source, .duckmage-hex-swap-dest")
      ?.remove();
    hexEl.createSpan({ cls });
  }

  async onHexSwapClick(x: number, y: number): Promise<void> {
    if (this.host.toolbar.drawingMode !== "swap") return;

    // No source yet: select this hex as source
    if (!this.host.toolbar.swapSource) {
      this.host.toolbar.swapSource = { x, y };
      this.highlightSwapHex(x, y, "duckmage-hex-swap-source");
      return;
    }

    // Clicking the source again: cancel selection
    if (x === this.host.toolbar.swapSource.x && y === this.host.toolbar.swapSource.y) {
      this.host.toolbar.swapSource = null;
      this.host.toolbar.clearSwapHighlights();
      return;
    }

    // Any other hex: execute swap immediately then deselect tool
    const src = { ...this.host.toolbar.swapSource };
    this.host.toolbar.clearSwapHighlights();
    this.host.toolbar.swapSource = null;
    this.host.toolbar.swapDest = null;
    await this.executeHexSwap(src.x, src.y, x, y);
    this.host.toolbar.exitSwapMode();
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

  async executeHexSwap(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    isUndoRedo = false,
  ): Promise<void> {
    // Swapping moves notes and map data: God only (src/workMode.ts).
    if (!guardWrite(this.activeMapName, "swap-hexes")) return;
    const pathA = this.plugin.hexPath(x1, y1, this.activeMapName);
    const pathB = this.plugin.hexPath(x2, y2, this.activeMapName);

    // Discard any pending (not-yet-started) writes for the two paths.
    // Without this the flush loop would find no file after the rename and
    // call createHexNote(), recreating a ghost file at the old position.
    this.host.writes.discard([pathA, pathB]);

    // Wait for any already-in-flight flushes on these paths to finish before
    // renaming files — a flush that completes after the rename would write
    // terrain to the wrong file or recreate a file that was just moved.
    const deadline = Date.now() + 2000;
    while (
      this.host.writes.flushingAny([pathA, pathB]) &&
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
          this.host.renderGrid();
          return;
        }
        await new Promise<void>((r) => window.setTimeout(r, 300));
      }
    }

    // Immediate re-render so the map reflects the swap
    this.host.renderGrid();

    // Blip both positions in the freshly rendered grid
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(
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
      const at = (x: number, y: number) => this.plugin.mapStore.get(this.activeMapName, `${x}_${y}`) ?? null;
      this.host.undos.pushUndo({ kind: "swap", x1, y1, x2, y2, after: [at(x1, y1), at(x2, y2)] });
      this.host.undos.updateUndoButton();
    }
  }

}

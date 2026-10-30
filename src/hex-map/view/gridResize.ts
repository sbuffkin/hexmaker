/**
 * Keeping the view still when the grid changes size at the top or left
 * (split out of gridEdgeButtons for plan-hf4-map-grows): the "+"/"−" edge
 * buttons, a map that grows as the party nears its edge, and undoing that.
 *
 * Two compensations work together so growing at the top (or left) looks
 * like "the canvas extended that way" instead of "everything shifted":
 *
 * - **Pan**: the existing hexes' in-container offset grew by `n × stride`,
 *   which would shift them on screen by `n × stride × scale × zoom`; the
 *   viewport translate moves back by that much.
 * - **Background image**: the pan moves the background layer too (it is a
 *   viewport descendant) but its position doesn't follow the grid's layout,
 *   so its offset moves by `n × stride × scale` to keep it on the hexes.
 *
 * Removing rows or columns (n < 0) is the inverse.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GridBox } from "../../maps/gridGrowth";
import type { MapData } from "../../types";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { MapViewport } from "./mapViewport";

export interface GridResizeHost {
  plugin: Pick<HexmakerPlugin, "settings" | "saveSettings">;
  viewportEl(): HTMLElement | null;
  viewport(): Pick<MapViewport, "panX" | "panY" | "zoom" | "applyTransform">;
  calibration: Pick<BackgroundCalibration, "applyBgLayerVars">;
  /** The layout stride between rows / columns (default: measured from the DOM). */
  stride?(axis: "row" | "col"): number;
}

/** After the grid went from `before` to `after` (and was redrawn): keep what was on screen where it was. */
export function keepViewStill(host: GridResizeHost, map: MapData, before: GridBox, after: GridBox): void {
  shiftView(host, map, before.y - after.y, before.x - after.x);
}

/** `rows` rows were added at the top and `cols` columns at the left (negative: removed). */
export function shiftView(host: GridResizeHost, map: MapData, rows: number, cols: number): void {
  if (!rows && !cols) return;
  const stride = (axis: "row" | "col") => (host.stride ? host.stride(axis) : measureGridStride(host, axis));
  const view = host.viewport();
  const bg = map.backgroundImage;
  let moved = false;
  if (rows) {
    const s = stride("row") * (map.gridDisplayScaleY ?? map.gridDisplayScale ?? 1);
    if (s) {
      view.panY -= rows * s * view.zoom;
      if (bg) bg.offsetY += rows * s;
      moved = true;
    }
  }
  if (cols) {
    const s = stride("col") * (map.gridDisplayScaleX ?? map.gridDisplayScale ?? 1);
    if (s) {
      view.panX -= cols * s * view.zoom;
      if (bg) bg.offsetX += cols * s;
      moved = true;
    }
  }
  if (!moved) return;
  view.applyTransform();
  if (bg) {
    // Re-apply the background layer with its new offset, and save it.
    const layer = host.viewportEl()?.querySelector<HTMLElement>(".duckmage-bg-image-layer");
    if (layer) host.calibration.applyBgLayerVars(layer, bg);
    void host.plugin.saveSettings();
  }
}

/**
 * The stride between rows / columns from one hex's size and margin (the
 * gap), for a grid with fewer than two of them to measure. Matches the CSS:
 * pointy rows overlap by a quarter of a hex height (row margin -½ size);
 * flat columns by a quarter of a hex width.
 */
export function strideFromHex(axis: "row" | "col", orientation: "flat" | "pointy", w: number, h: number, gap: number): number {
  if (axis === "row") return orientation === "flat" ? h + 2 * gap : 0.75 * h + 2 * gap;
  return orientation === "flat" ? 0.75 * w + 2 * gap : w + 2 * gap;
}

/**
 * The layout stride between adjacent rows / columns, measured from two
 * consecutive elements after a render (it captures hex size, gap and row
 * overlap). With fewer than two, it is worked out from one hex
 * (strideFromHex); 0 with no hexes.
 */
export function measureGridStride(host: Pick<GridResizeHost, "plugin" | "viewportEl">, axis: "row" | "col"): number {
  const root = host.viewportEl();
  if (!root) return 0;
  const orientation = host.plugin.settings.hexOrientation === "flat" ? "flat" : "pointy";
  const pair = (els: ArrayLike<HTMLElement> | undefined, side: "offsetTop" | "offsetLeft") =>
    els && els.length >= 2 ? els[1][side] - els[0][side] : 0;
  let measured: number;
  if (axis === "row") {
    measured = orientation === "flat"
      // Flat-top: hexes stacked inside a column; pointy-top: rows stacked in the grid.
      ? pair(root.querySelector<HTMLElement>(".duckmage-hex-col")?.querySelectorAll<HTMLElement>(".duckmage-hex"), "offsetTop")
      : pair(root.querySelectorAll<HTMLElement>(".duckmage-hex-row"), "offsetTop");
  } else {
    measured = orientation === "flat"
      ? pair(root.querySelectorAll<HTMLElement>(".duckmage-hex-col"), "offsetLeft")
      : pair(root.querySelector<HTMLElement>(".duckmage-hex-row")?.querySelectorAll<HTMLElement>(".duckmage-hex"), "offsetLeft");
  }
  if (measured) return measured;
  const hex = root.querySelector<HTMLElement>(".duckmage-hex");
  if (!hex) return 0;
  const gap = parseFloat(activeWindow.getComputedStyle(hex).marginTop) || 0;
  return strideFromHex(axis, orientation, hex.offsetWidth, hex.offsetHeight, gap);
}

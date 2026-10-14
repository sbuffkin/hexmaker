/**
 * The path layer (L2f, split out of HexMapView): paths drawn in em from one
 * calibration per grid (lattice → em), module overlay lines, the path
 * tool's handles and active-end dot, and the icon layer over the paths
 * (elevated override icons and GM icons). Reads first, then writes
 * (CLAUDE.md); the stroke loop does no layout reads.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import { moduleOverlays } from "../../modules/runtime";
import {
  applyAffine,
  calibrateAffine,
  END_DOT_PX,
  HANDLE_PX,
  fmt,
  latticeCenter,
  pxToLattice,
  type LatticeAffine,
  type LatticeGrid,
} from "../../paths/pathGeometry";
import type { MapData, PathType } from "../../types";
import { getIconUrl } from "../../utils";
import type { SeamJoin } from "../ghostPaths";
import { smoothPath, sharpPath } from "../hexGeometry";
import type { PathTool } from "../pathTool";
import type { DrawingMode } from "../toolMode";

/**
 * GM icon sub-grid positions inside a hex. 7 slots arranged as a small
 * honeycomb (top-row of 2, middle-row of 3, bottom-row of 2), filled
 * in reading order — first icon lands top-left, second top-right, etc.
 * Values are unit offsets in [-1, +1]; multiply by the hex's
 * half-width/half-height (`spread`) to get pixel offsets.
 *
 * Layout:
 *      0   1
 *    2   3   4
 *      5   6
 *
 * Used by `renderPathOverlay`'s GM-icon section so multiple icons on
 * the same hex form a hex-shaped cluster (matches the user's request
 * in hexmaker#28 for "a sort of grid, a hex-subgrid").
 */
const GM_ICON_HEX_SUBGRID: [number, number][] = [
  [-0.34, -0.55], // NW
  [+0.34, -0.55], // NE
  [-0.62,  0.00], // W
  [ 0.00,  0.00], // C
  [+0.62,  0.00], // E
  [-0.34, +0.55], // SW
  [+0.34, +0.55], // SE
];

/**
 * Decode the JSON-encoded list stored on `data-gm-icons`. Returns []
 * for missing / malformed values so callers can safely iterate.
 */
export function parseGmIconsDataset(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The path layer's measurement of one grid (see calibratePathLayer). */
interface PathLayerCalibration {
  grid: HTMLElement;
  lattice: LatticeGrid;
  /** Lattice units → em in the grid's frame. */
  affine: LatticeAffine;
  /** A hex's drawn radius, em: path widths (lattice units) scale by it. */
  hexRadius: number;
  /** A hex element's size, em. */
  hexW: number;
  hexH: number;
}

export interface PathOverlayHost {
  plugin: HexmakerPlugin;
  viewportEl(): HTMLElement | null;
  getActiveMap(): MapData;
  getActiveStagger(): "odd" | "even";
  drawingMode(): DrawingMode | null;
  pathTool(): PathTool;
  /** Path types the active map can draw. */
  mapPathTypes(): PathType[];
  wm(): WorldMapsApi | undefined;
  /** Paths meeting a neighbour's across the seam (the neighbour strip is redrawn when they change). */
  seamJoins(gridContainer: HTMLElement, region: MapData): SeamJoin[];
  renderGrid(): void;
}

export class PathOverlay {
  /**
   * The path layer's calibration (lattice → em for this grid) and what it
   * was last drawn with. Measured once per grid (renderGrid rebuilds the
   * grid); in em, so zoom bakes need no rebuild.
   */
  private pathCalib: PathLayerCalibration | null = null;
  private pathLayerKey = "";

  constructor(private host: PathOverlayHost) {}

  /**
   * A pointer position in the path layer's lattice units (for hit-testing
   * paths): one read of the grid's box and font size per event, no writes,
   * inverted through the layer's calibration. Null before it's calibrated.
   */
  pointerLattice(e: { clientX: number; clientY: number }): { cx: number; cy: number } | null {
    const calib = this.pathCalib;
    const grid = calib?.grid;
    if (!calib || !grid || !grid.isConnected) return null;
    const style = getComputedStyle(grid);
    const em = parseFloat(style.fontSize) || 16;
    const g = grid.getBoundingClientRect();
    const layoutW = parseFloat(style.width) || grid.offsetWidth;
    const layoutH = parseFloat(style.height) || grid.offsetHeight;
    const sx = layoutW ? g.width / layoutW : 1;
    const sy = layoutH ? g.height / layoutH : 1;
    const ex = (e.clientX - g.left) / sx / em;
    const ey = (e.clientY - g.top) / sy / em;
    const a = calib.affine;
    return { cx: (ex - a.tx) / a.sx, cy: (ey - a.ty) / a.sy };
  }

  /**
   * Measure the grid once for the path layer: three hexes (the origin, the
   * far end of its row, the far end of its column), all reads, no writes.
   * Their centres fix the affine from lattice units to em in the grid's own
   * frame, which absorbs the CSS gap and any calibrated grid transform.
   */
  private calibratePathLayer(gridContainer: HTMLElement, region: MapData): PathLayerCalibration | null {
    if (this.pathCalib?.grid === gridContainer) return this.pathCalib;
    const { x: ox, y: oy } = region.gridOffset;
    const { cols, rows } = region.gridSize;
    const isFlat = this.host.plugin.settings.hexOrientation === "flat";
    const lattice: LatticeGrid = { orientation: this.host.plugin.settings.hexOrientation, stagger: this.host.getActiveStagger() };
    const hexAt = (x: number, y: number) => gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    const origin = hexAt(ox, oy);
    if (!origin) return null;
    const style = getComputedStyle(gridContainer);
    const em = parseFloat(style.fontSize) || 16;
    const g = gridContainer.getBoundingClientRect();
    // Client px → the grid's own px (the viewport zoom and grid transforms
    // scale both); the computed width is fractional, unlike offsetWidth.
    const layoutW = parseFloat(style.width) || gridContainer.offsetWidth;
    const layoutH = parseFloat(style.height) || gridContainer.offsetHeight;
    const sx = layoutW ? g.width / layoutW : 1;
    const sy = layoutH ? g.height / layoutH : 1;
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - g.left) / sx / em, y: (r.top + r.height / 2 - g.top) / sy / em, w: r.width / sx / em, h: r.height / sy / em };
    };
    const A = centre(origin);
    if (!A.w || !A.h) return null;
    const farX = cols > 1 ? hexAt(ox + cols - 1, oy) : null;
    const farY = rows > 1 ? hexAt(ox, oy + rows - 1) : null;
    const hexRadius = isFlat ? A.w / 2 : A.h / 2;
    const affine = calibrateAffine(
      { key: `${ox}_${oy}`, at: A },
      farX ? { key: `${ox + cols - 1}_${oy}`, at: centre(farX) } : null,
      farY ? { key: `${ox}_${oy + rows - 1}`, at: centre(farY) } : null,
      lattice,
      hexRadius,
    );
    this.pathCalib = { grid: gridContainer, lattice, affine, hexRadius, hexW: A.w, hexH: A.h };
    this.pathLayerKey = "";
    return this.pathCalib;
  }

  /**
   * Paths of the open map: resolved by the plugin's paths service (nothing
   * until the map's terrain and palette are loaded), turned into lattice
   * polylines (src/paths/pathGeometry.ts, the same ones the PNG export
   * draws), placed in em. One `<path data-path data-branch>` per branch.
   * Stroke widths scale with the hexes (lattice units × the hex radius), so
   * the map looks the same at every zoom. Rebuilt only when what it draws
   * changes; zoom bakes leave it alone.
   */
  renderPathOverlay(gridContainer: HTMLElement): void {
    const region = this.host.getActiveMap();
    // A path edit that starts or ends a seam join redraws the neighbour
    // strip, so its road reaches the shared edge too (round 6 U8).
    const joins = this.host.seamJoins(gridContainer, region);

    // ── Reads (one calibration per grid) ──
    const calib = this.calibratePathLayer(gridContainer, region);
    // The same strokes the PNG export draws (plugin.paths.strokes); only
    // the seam stubs are the view's own.
    const strokes = calib
      ? this.host.plugin.paths.strokes(region.name, {
          seamEnd: (typeName, hex) => joins.find((j) => j.typeName === typeName && j.own === hex)?.other,
        })
      : [];
    const em = (pts: { cx: number; cy: number }[]) =>
      applyAffine(pts, calib!.affine).map((p) => ({ cx: Number(fmt(p.cx)), cy: Number(fmt(p.cy)) }));
    const scale = calib?.hexRadius ?? 0;
    const lines = strokes.map((s) => {
      const pts = em(s.pts);
      return {
        s,
        d: s.smooth ? smoothPath(pts) : sharpPath(pts),
        width: fmt(s.width * scale),
        dash: s.dash.map((d) => fmt(d * scale)).join(" "),
      };
    });
    // Module overlays (Space: moons tied to their planet, S11): faint lines
    // by terrain type, under the paths. The same segments the PNG export
    // draws (overlay.segments, src/modules/runtime.ts moduleOverlays).
    const overlayLines: { cls: string; d: string; width: string; dash: string }[] = [];
    const overlays = calib ? moduleOverlays() : [];
    if (calib && overlays.length) {
      const terrain = new Map<string, string>();
      for (const [k, h] of this.host.plugin.mapStore.all(region.name)) if (h.terrain) terrain.set(k, h.terrain);
      const palette = this.host.plugin.getMapPalette(region.name);
      for (const overlay of overlays) {
        const width = fmt(overlay.style.width * scale);
        const dash = overlay.style.dash.map((d) => fmt(d * scale)).join(" ");
        for (const seg of overlay.segments(terrain, palette, calib.lattice)) {
          const [a, b] = em(seg);
          overlayLines.push({ cls: overlay.cls, d: `M${fmt(a.cx)} ${fmt(a.cy)}L${fmt(b.cx)} ${fmt(b.cy)}`, width, dash });
        }
      }
    }
    // The path tool: the selected path highlighted, its anchor handles
    // (ends bigger: continue from there) and the dot where clicks add.
    const tool = calib && this.host.drawingMode() === "path" ? this.host.pathTool().overlay() : null;
    let dot: { cx: string; cy: string; r: string; sw: string; color: string } | null = null;
    const handles: { cx: string; cy: string; r: string; sw: string; hover: boolean }[] = [];
    if (calib && tool) {
      const activeType = this.host.mapPathTypes().find((p) => p.name === this.host.pathTool().currentType());
      if (tool.active) {
        const [c] = em([latticeCenter(tool.active, calib.lattice)]);
        dot = {
          cx: fmt(c.cx),
          cy: fmt(c.cy),
          r: fmt(pxToLattice(END_DOT_PX.r) * scale),
          sw: fmt(pxToLattice(END_DOT_PX.stroke) * scale),
          color: activeType?.color ?? "#888888",
        };
      }
      for (const h of tool.handles) {
        const [c] = em([latticeCenter(h.hex, calib.lattice)]);
        handles.push({
          cx: fmt(c.cx),
          cy: fmt(c.cy),
          r: fmt(pxToLattice(h.end ? HANDLE_PX.end : HANDLE_PX.r) * scale),
          sw: fmt(pxToLattice(HANDLE_PX.stroke) * scale),
          hover: h.hover,
        });
      }
    }
    const selected = tool?.selected ?? null;
    // On an overworld, paths not yet confirmed into their regions are drafts (drawn faded).
    const drafts = this.host.wm()?.draftPathNames(this.host.plugin, region.name) ?? new Set<string>();
    const key = JSON.stringify([lines.map((l) => [l.s.path, l.s.branch, l.d, l.width, l.dash, l.s.color, drafts.has(l.s.path)]), dot, handles, selected, overlayLines]);
    const existing = gridContainer.querySelector("svg.duckmage-path-svg");
    const existingHandles = gridContainer.querySelector("svg.duckmage-path-handles-svg");
    const wantLines = lines.length > 0 || overlayLines.length > 0;
    const wantHandles = !!dot || handles.length > 0;

    // ── Writes ──
    if (key !== this.pathLayerKey || wantLines !== !!existing || wantHandles !== !!existingHandles) {
      existing?.remove();
      existingHandles?.remove();
      this.pathLayerKey = key;
      const svgNS = "http://www.w3.org/2000/svg";
      // One user unit = 1em of the grid (it overflows for seam stubs).
      const emSvg = (cls: string): SVGSVGElement => {
        const s = activeDocument.createElementNS(svgNS, "svg");
        s.classList.add(cls);
        s.setAttribute("width", "1em");
        s.setAttribute("height", "1em");
        s.setAttribute("viewBox", "0 0 1 1");
        return s;
      };
      if (wantLines) {
        const svg = emSvg("duckmage-path-svg");
        for (const m of overlayLines) {
          const tie = activeDocument.createElementNS(svgNS, "path");
          tie.setAttribute("class", `duckmage-svg-path-line ${m.cls}`);
          tie.setAttribute("d", m.d);
          tie.setAttribute("stroke-width", m.width);
          tie.setAttribute("stroke-dasharray", m.dash);
          tie.setAttribute("stroke-linecap", "round");
          tie.setAttribute("fill", "none");
          svg.appendChild(tie);
        }
        // The selected path's halo, under every line.
        for (const l of lines) {
          if (l.s.path !== selected) continue;
          const halo = activeDocument.createElementNS(svgNS, "path");
          halo.setAttribute("class", "duckmage-svg-path-line duckmage-svg-path-selected");
          halo.setAttribute("d", l.d);
          halo.setAttribute("stroke", l.s.color);
          halo.setAttribute("stroke-width", fmt(Number(l.width) * 2.6));
          halo.setAttribute("stroke-linecap", "round");
          halo.setAttribute("stroke-linejoin", "round");
          halo.setAttribute("fill", "none");
          halo.setAttribute("opacity", "0.3");
          svg.appendChild(halo);
        }
        for (const l of lines) {
          const path = activeDocument.createElementNS(svgNS, "path");
          path.setAttribute("class", drafts.has(l.s.path) ? "duckmage-svg-path-line duckmage-svg-path-draft" : "duckmage-svg-path-line");
          path.setAttribute("d", l.d);
          path.setAttribute("stroke", l.s.color);
          path.setAttribute("stroke-width", l.width);
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("fill", "none");
          if (l.dash) path.setAttribute("stroke-dasharray", l.dash);
          path.setAttribute("data-path", l.s.path);
          path.setAttribute("data-branch", String(l.s.branch));
          svg.appendChild(path);
        }
        // Under the icon layer (elevated and GM icons sit above paths).
        const icons = gridContainer.querySelector("svg.duckmage-path-icons-svg");
        if (icons) gridContainer.insertBefore(svg, icons);
        else gridContainer.appendChild(svg);
      }
      // The tool's handles and active-end dot get their own layer, over
      // the icon layer (terrain, elevated override and GM icons), so a
      // handle is never hidden under an icon (#48). Hit-testing is pure
      // math, so they stay grabbable whatever is drawn over the hex.
      if (wantHandles) {
        const svg = emSvg("duckmage-path-handles-svg");
        for (const h of handles) {
          const handle = activeDocument.createElementNS(svgNS, "circle");
          handle.setAttribute("class", "duckmage-svg-path-line duckmage-svg-path-handle");
          handle.setAttribute("cx", h.cx);
          handle.setAttribute("cy", h.cy);
          handle.setAttribute("r", h.r);
          handle.setAttribute("fill", h.hover ? "#ffd84d" : "white");
          handle.setAttribute("stroke", "#222222");
          handle.setAttribute("stroke-width", h.sw);
          svg.appendChild(handle);
        }
        if (dot) {
          const circle = activeDocument.createElementNS(svgNS, "circle");
          circle.setAttribute("class", "duckmage-svg-path-line");
          circle.setAttribute("cx", dot.cx);
          circle.setAttribute("cy", dot.cy);
          circle.setAttribute("r", dot.r);
          circle.setAttribute("fill", dot.color);
          circle.setAttribute("stroke", "white");
          circle.setAttribute("stroke-width", dot.sw);
          circle.setAttribute("opacity", "0.9");
          svg.appendChild(circle);
        }
        gridContainer.appendChild(svg);
      }
    }
    this.renderPathIconsLayer(gridContainer);
  }

  /** Redraw only the icon layer (after a zoom bake: its sizes are in px). */
  updatePathIcons(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (gridContainer) this.renderPathIconsLayer(gridContainer);
  }

  /**
   * Override icons elevated above the paths, and GM-layer icons: their own
   * SVG over the path layer, placed from the path layer's calibration (no
   * per-hex layout reads). Rebuilt on zoom bakes (icon and badge sizes are
   * px, as they always were).
   */
  private renderPathIconsLayer(gridContainer: HTMLElement): void {
    gridContainer.querySelector("svg.duckmage-path-icons-svg")?.remove();
    this.host.viewportEl()?.removeClass("duckmage-svg-labels-active");
    // Restore any icons that were hidden when the previous SVG elevated them
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex-icon[data-svg-elevated]")
      .forEach((img) => {
        img.show();
        img.removeAttribute("data-svg-elevated");
      });

    const region = this.host.getActiveMap();
    const gmLayerActive = region.showGmLayer ?? true;
    const overrides = Array.from(gridContainer.querySelectorAll<HTMLElement>("[data-icon-override]"));
    const gmHexes = gmLayerActive ? Array.from(gridContainer.querySelectorAll<HTMLElement>("[data-gm-icons]")) : [];
    if (!overrides.length && !gmHexes.length) return;
    const calib = this.calibratePathLayer(gridContainer, region);
    if (!calib) return;

    // ── Reads: the font size (em → px) and the layer's size, once ──
    const emPx = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    const svgW = gridContainer.offsetLeft + gridContainer.offsetWidth + 20;
    const svgH = gridContainer.offsetTop + gridContainer.offsetHeight + 20;
    const w = calib.hexW * emPx;
    const h = calib.hexH * emPx;
    const at = (hexEl: HTMLElement) => {
      const [p] = applyAffine([latticeCenter(`${hexEl.dataset.x!}_${hexEl.dataset.y!}`, calib.lattice)], calib.affine);
      return { cx: p.cx * emPx, cy: p.cy * emPx };
    };

    // ── Writes ──
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-path-icons-svg");
    svg.setAttribute("width", String(svgW));
    svg.setAttribute("height", String(svgH));

    // Elevate override icons above roads/rivers by rendering them inside the SVG.
    for (const hexEl of overrides) {
      const iconName = hexEl.dataset.iconOverride!;
      const pos = at(hexEl);
      const origImg = hexEl.querySelector<HTMLElement>(".duckmage-hex-icon");
      if (origImg) {
        origImg.hide();
        origImg.setAttribute("data-svg-elevated", "1");
      }
      const imgEl = activeDocument.createElementNS(svgNS, "image");
      const iconW = w * 0.78;
      const iconH = h * 0.78;
      imgEl.setAttribute("x", String(pos.cx - iconW / 2));
      imgEl.setAttribute("y", String(pos.cy - iconH / 2));
      imgEl.setAttribute("width", String(iconW));
      imgEl.setAttribute("height", String(iconH));
      imgEl.setAttribute("href", getIconUrl(this.host.plugin, iconName));
      imgEl.setAttribute("opacity", "0.75");
      imgEl.setAttribute("class", "duckmage-svg-icon-override");
      svg.appendChild(imgEl);
    }

    // NOTE: coord labels are NO LONGER rendered in the SVG. The SVG
    // copies were a stable source of "label drift on zoom" — the SVG's
    // pixel positions are computed against pre-bake hex sizes, so any
    // paint frame between the bake's font-size change and the SVG
    // rebuild shows labels visibly stranded relative to the now-bigger
    // hexes. The HTML labels in `.duckmage-coord-labels-layer` are placed
    // at a % of the grid, so they track the hex layout across font-size
    // changes, and we rely on those instead. Trade-off: a path
    // or GM icon drawn through a hex can visually obscure that hex's
    // coord label. Acceptable cost vs. the slip — see
    // dev/coord-slip-validator.html for the regression test.

    // GM layer icons — additive badges, terrain icon untouched.
    // hexmaker#28: a hex can carry MULTIPLE GM icons (with duplicates
    // representing a count of that icon). Each unique icon takes one
    // slot from the GM_ICON_HEX_SUBGRID, filled in reading order so the
    // FIRST added icon lands top-left and additions flow right then
    // down. Up to 7 unique icons display; further additions are kept
    // in frontmatter but don't render. A "×N" badge appears on a slot
    // when its icon was added 2+ times.
    for (const hexEl of gmHexes) {
      const list = parseGmIconsDataset(hexEl.dataset.gmIcons);
      if (list.length === 0) continue;
      const pos = at(hexEl);

      // Count occurrences per icon, preserving first-seen order.
      const counts = new Map<string, number>();
      for (const ic of list) counts.set(ic, (counts.get(ic) ?? 0) + 1);
      const slots = Array.from(counts.entries()).slice(0, GM_ICON_HEX_SUBGRID.length);
      const slotCount = slots.length;

      // Spread = half the hex's short dimension so the sub-grid fits
      // comfortably inside the parent hex's bounds.
      const spread = Math.min(w, h) * 0.42;
      // Icon size shrinks as the sub-grid fills so neighbouring icons
      // don't overlap. Single-icon hexes keep ~legacy size.
      const sizeFactor = slotCount === 1 ? 0.40
        : slotCount <= 2 ? 0.30
        : slotCount <= 4 ? 0.26
        : 0.22;
      const size = Math.round(w * sizeFactor);

      slots.forEach(([iconName, count], slotIdx) => {
        const [odx, ody] = GM_ICON_HEX_SUBGRID[slotIdx];
        // Icons are positioned by top-left corner; subtract half the
        // size so the icon CENTER lands on the sub-grid slot.
        const ix = pos.cx + odx * spread - size / 2;
        const iy = pos.cy + ody * spread - size / 2;
        const imgEl = activeDocument.createElementNS(svgNS, "image");
        imgEl.setAttribute("x", String(ix));
        imgEl.setAttribute("y", String(iy));
        imgEl.setAttribute("width", String(size));
        imgEl.setAttribute("height", String(size));
        imgEl.setAttribute("href", getIconUrl(this.host.plugin, iconName));
        imgEl.setAttribute("class", "duckmage-svg-gm-icon");
        svg.appendChild(imgEl);

        if (count > 1) {
          // Badge sits at the bottom-right corner of the icon glyph,
          // tucked inside the icon's bounding box so it tracks the
          // icon even at small sizes.
          const badgeEl = activeDocument.createElementNS(svgNS, "text");
          badgeEl.setAttribute("x", String(ix + size));
          badgeEl.setAttribute("y", String(iy + size));
          badgeEl.setAttribute("text-anchor", "end");
          badgeEl.setAttribute("dominant-baseline", "alphabetic");
          badgeEl.setAttribute("class", "duckmage-svg-gm-icon-count");
          badgeEl.textContent = `×${count}`;
          svg.appendChild(badgeEl);
        }
      });
    }

    this.host.viewportEl()?.addClass("duckmage-svg-labels-active");
    gridContainer.appendChild(svg);
  }

  updatePathOverlay(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) {
      this.host.renderGrid();
      return;
    }
    this.renderPathOverlay(gridContainer);
  }

  // GM icons live inside the path SVG. Re-render that SVG only if the grid
  // already exists — never fall back to renderGrid (would cause infinite loop
  // when called from syncToRegion inside an in-progress renderGrid).
  updateGmIcons(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderPathOverlay(gridContainer);
  }

}

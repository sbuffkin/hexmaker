/**
 * The overworld's region layer (OW1): every region's actual hexes drawn
 * low-res inside the overworld, stitched, on ONE canvas over the grid, the
 * way the overworld preview page draws its "full view". Thousands of hexes
 * stay cheap: each region is drawn once into its own bitmap (cached until
 * that region's map changes or the zoom moves a lot), and the layer is just
 * those bitmaps copied into place.
 *
 * Slots with no region yet are drawn as blank bricks (outline only): the
 * overworld's own hexes aren't shown in this view at all.
 *
 * In the "biomes" view the same canvas carries the preview's minimap marks
 * over the overworld's own hexes instead: biome labels, white outlines on
 * transition hexes, the river.
 *
 * Geometry is measured from hexes already laid out, all reads first, then
 * the writes (CLAUDE.md read-then-write rule).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { hexCenter } from "../../packages/hex-wfc/src/grid";
import { regionsOf } from "../maps/submaps";
import { biomeInfo, biomeParts } from "./biomes";
import { regionCells, type RegionLayout } from "./layout";
import {
  affineScale,
  applyAffine,
  cellsBox,
  childToParentPlane,
  composeAffine,
  drawRegionCells,
  drawRiver,
  fitAffine,
  hexPath,
  cellAtGridPoint,
  RegionBitmapCache,
  type Affine,
  type RegionCell,
} from "./overworldRender";
import { ecotoneHexes, overworldBiomes, parseBiomeRiver } from "./regionWorld";
import { overworldOf, overworldTerrain, placedBiomes } from "./regionsVault";
import { FrameThrottle } from "./overworldInput";
import { biomeViewLines, CrossRegionPaths, pathAtGridPoint, type OverworldPathLine, type RegionPathSource } from "./regionPaths";
import { UNKNOWN_PATH_TYPE } from "../constants";
import { SCREEN_HEX_RADIUS } from "../paths/pathGeometry";
import { sharpPath, smoothPath } from "../hex-map/hexGeometry";
import { hexKey, hexPair, hexXY } from "../hexKey";

/** Layers-menu row: paths between regions, on overworlds (unset = shown). */
export const REGION_PATHS_ROW = {
  id: "LayersMenu.regionPaths",
  label: "Paths between regions",
  shows: (plugin: HexmakerPlugin, map: MapData): boolean => !!overworldOf(plugin, map.name),
  value: (map: Pick<MapData, "showRegionPaths">): boolean => map.showRegionPaths !== false,
  set: (map: Pick<MapData, "showRegionPaths">, on: boolean): void => {
    if (on) delete map.showRegionPaths;
    else map.showRegionPaths = false;
  },
};




interface Geometry {
  map: string;
  layout: RegionLayout;
  /** Parent plane → grid px. */
  p2g: Affine;
  /** Child plane → grid px. */
  c2g: Affine;
  /** Device px per grid px for the bitmaps. */
  pxScale: number;
  /** Grid px per em (positions are written in em so zoom bakes keep them). */
  em: number;
}

interface RegionBitmap {
  canvas: HTMLCanvasElement | null;
  /** Grid-px box the bitmap covers. */
  box: { x: number; y: number; w: number; h: number };
}

/** Cache name of the one bitmap holding every empty slot ("blank bricks"). */
const BLANK = "*blank slots*";
/** Empty slots: a faint fill and a light outline, so they read on light and dark themes. */
const BLANK_FILL = "rgba(128, 128, 128, 0.10)";
const BLANK_EDGE = "rgba(128, 128, 128, 0.55)";

/** Largest composite canvas side and area (device px): beyond it the layer drops resolution. */
const MAX_SIDE = 8192;
const MAX_AREA = 24e6;

/** The overworld hexes (its whole grid) that have no region yet, in reading order. */
export function blankSlots(map: Pick<MapData, "gridOffset" | "gridSize">, taken: ReadonlySet<string>): [number, number][] {
  const out: [number, number][] = [];
  const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
  for (let y = oy; y < oy + rows; y++) {
    for (let x = ox; x < ox + cols; x++) if (!taken.has(hexKey(x, y))) out.push([x, y]);
  }
  return out;
}

export class OverworldLayer {
  readonly cache = new RegionBitmapCache<RegionBitmap>();
  private geom: Geometry | null = null;
  private canvas: HTMLCanvasElement | null = null;
  /** Region paths that cross seams, joined (cached per overworld; see regionPaths.ts). */
  readonly paths = new CrossRegionPaths();
  private pathsOf = "";
  private pathSvg: SVGSVGElement | null = null;
  /** What the path layer was last drawn from (skip rebuilding the same SVG). */
  private pathSvgFrom: { lines: OverworldPathLine[]; geom: Geometry } | null = null;
  /** The lines on screen now, for the hover hit test, and the plane their points are in (→ grid px). */
  private shownLines: OverworldPathLine[] = [];
  private shownPlane: Affine = [1, 0, 0, 1, 0, 0];
  /** The Biomes view's simplified lines, and the joined lines they were made from. */
  private biomeLines: { from: OverworldPathLine[]; layout: RegionLayout; lines: OverworldPathLine[] } | null = null;
  /** Redraws coalesce to one per animation frame, and keep coming during a brush stroke. */
  private redraws = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
  /** Timings of the last draw (ms) and how many region bitmaps it built; paths: ms and lines drawn. */
  lastStats = { ms: 0, builds: 0, regions: 0, cells: 0, pathMs: 0, pathLines: 0, pathJoins: 0 };

  constructor(private plugin: HexmakerPlugin) {}

  /** Which view an overworld shows: its regions stitched (default once it has any) or its biomes. */
  static viewOf(plugin: HexmakerPlugin, map: MapData): "regions" | "biomes" | null {
    if (!overworldOf(plugin, map.name)) return null;
    if (map.overworldView) return map.overworldView;
    return regionsOf(plugin.settings.maps, map.name).length ? "regions" : "biomes";
  }

  /** Is the full (regions) view showing on this map right now? */
  showsRegions(map: MapData): boolean {
    return OverworldLayer.viewOf(this.plugin, map) === "regions" && !!this.geom && this.geom.map === map.name;
  }

  /** Remove the layer (map switched, view off). */
  clear(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.geom = null;
    this.removePathSvg();
  }

  private removePathSvg(): void {
    this.pathSvg?.remove();
    this.pathSvg = null;
    this.pathSvgFrom = null;
    this.shownLines = [];
  }

  /** Draw the layer for `map` into `grid` (call after the hexes are laid out). */
  render(grid: HTMLElement, map: MapData): void {
    this.canvas?.remove();
    this.canvas = null;
    this.geom = null;
    this.removePathSvg();
    const view = OverworldLayer.viewOf(this.plugin, map);
    const ow = overworldOf(this.plugin, map.name);
    if (!view || !ow) return;

    // ── Reads ──
    const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
    const g = grid.getBoundingClientRect();
    const sx = grid.offsetWidth ? g.width / grid.offsetWidth : 1;
    const sy = grid.offsetHeight ? g.height / grid.offsetHeight : 1;
    const pairs: [[number, number], [number, number]][] = [];
    const samples: [number, number][] = [[ox, oy], [ox + 1, oy], [ox, oy + 1], [ox + 1, oy + 1], [ox + cols - 1, oy + rows - 1]];
    for (const [x, y] of samples) {
      if (x >= ox + cols || y >= oy + rows) continue;
      const el = grid.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      pairs.push([hexCenter(x, y, ow.layout.orientation, ow.layout.parentStagger), [(r.left + r.width / 2 - g.left) / sx, (r.top + r.height / 2 - g.top) / sy]]);
    }
    const em = parseFloat(getComputedStyle(grid).fontSize) || 16;
    if (pairs.length < 3) return; // a 1-hex map: nothing to stitch onto
    const p2g = fitAffine(pairs);
    const c2g = composeAffine(childToParentPlane(ow.layout), p2g);
    const dpr = activeWindow.devicePixelRatio || 1;
    this.geom = { map: map.name, layout: ow.layout, p2g, c2g, pxScale: Math.max(0.5, Math.min(4, sx * dpr)), em };

    // ── Writes ──
    this.canvas = grid.createEl("canvas", { cls: "duckmage-ow-layer" });
    this.draw();
  }

  /** A region's map changed: rebuild its bitmap (and its paths) on the next draw (callers redraw when it's on screen). */
  invalidate(regionName: string): void {
    this.cache.invalidate(regionName);
    this.paths.invalidate(regionName);
  }

  /**
   * Something on the layer changed (a region painted, the overworld's
   * biomes): redraw on the next animation frame. Only invalidated region
   * bitmaps are rebuilt; the rest are copied from the cache.
   */
  scheduleRedraw(): void {
    if (!this.canvas) return;
    this.redraws.request(() => {
      if (this.canvas?.isConnected) this.draw();
    });
  }

  /**
   * The child cell under a screen point, and the region holding it (if
   * any): `region` is that region map's name. Null outside the regions view.
   */
  cellAt(grid: HTMLElement, clientX: number, clientY: number): { x: number; y: number; region?: string; parentHex: string } | null {
    const geom = this.geom;
    if (!geom || !grid.isConnected) return null;
    const g = grid.getBoundingClientRect();
    const sx = grid.offsetWidth ? g.width / grid.offsetWidth : 1;
    const sy = grid.offsetHeight ? g.height / grid.offsetHeight : 1;
    // A zoom bake since render changed the grid's font size: scale back to the measured em.
    const emNow = parseFloat(getComputedStyle(grid).fontSize) || geom.em;
    const { x, y, parentHex } = cellAtGridPoint(geom.layout, geom.c2g, geom.em, emNow, (clientX - g.left) / sx, (clientY - g.top) / sy);
    const region = regionsOf(this.plugin.settings.maps, geom.map).find((r) => r.parent?.hex === parentHex);
    return { x, y, region: region?.name, parentHex };
  }

  /**
   * The path line under a screen point (either view): tested in the plane
   * the lines on screen are in, the pointer brought back to the em the
   * layer was measured at (a zoom bake since then grows grid px).
   */
  pathAt(grid: HTMLElement, clientX: number, clientY: number): OverworldPathLine | null {
    const geom = this.geom;
    if (!geom || !this.shownLines.length || !grid.isConnected) return null;
    const g = grid.getBoundingClientRect();
    const sx = grid.offsetWidth ? g.width / grid.offsetWidth : 1;
    const sy = grid.offsetHeight ? g.height / grid.offsetHeight : 1;
    const emNow = parseFloat(getComputedStyle(grid).fontSize) || geom.em;
    return pathAtGridPoint(this.shownLines, this.shownPlane, geom.p2g, geom.em, emNow, sx, (clientX - g.left) / sx, (clientY - g.top) / sy);
  }

  // ── drawing ────────────────────────────────────────────────────────────

  private draw(): void {
    const geom = this.geom, canvas = this.canvas;
    const map = geom ? this.plugin.getMap(geom.map) : undefined;
    if (!geom || !canvas || !map) return;
    const t0 = performance.now();
    const builds0 = this.cache.builds;
    const view = OverworldLayer.viewOf(this.plugin, map);
    if (view === "regions") this.drawRegions(canvas, geom, map);
    else this.drawBiomes(canvas, geom, map);
    this.lastStats.ms = Math.round((performance.now() - t0) * 10) / 10;
    this.lastStats.builds = this.cache.builds - builds0;
    const t1 = performance.now();
    // Region paths across seams, in both views: as they run in the Regions
    // view, simplified to straight edge-to-edge lines in the Biomes view
    // (O2). The overworld's own paths are drawn by the map as usual.
    if (view && REGION_PATHS_ROW.value(map)) this.drawPaths(canvas.parentElement, geom, map, view);
    else this.removePathSvg();
    this.lastStats.pathMs = Math.round((performance.now() - t1) * 10) / 10;
    this.lastStats.pathLines = this.shownLines.length;
    this.lastStats.pathJoins = this.paths.joins;
  }

  /** Where the region paths come from: the paths service and map store, per region. */
  private pathSource(map: MapData): RegionPathSource {
    const p = this.plugin;
    return {
      regions: () => regionsOf(p.settings.maps, map.name),
      ready: (r) => p.mapStore.isReady() && p.paletteStore.isReady() && p.paths.isReady(r),
      resolved: (r) => p.paths.resolved(r),
      stored: (r) => p.mapStore.paths(r),
      types: (r) => p.getMapPathTypes(r),
      overworldPaths: () => p.mapStore.paths(map.name).map((x) => x.name),
      unknownType: UNKNOWN_PATH_TYPE,
    };
  }

  /**
   * The joined region paths as one SVG over the region bitmaps (Biomes
   * view: over the overworld's hexes, simplified), placed in em (one user
   * unit = 1em of the grid) so zoom bakes keep it. Built from the cached
   * geometry only: no layout reads here.
   */
  private drawPaths(grid: HTMLElement | null, geom: Geometry, map: MapData, view: "regions" | "biomes"): void {
    if (!grid) return;
    if (this.pathsOf !== map.name) {
      this.paths.clear();
      this.pathsOf = map.name;
    }
    const joined = this.paths.lines(geom.layout, this.pathSource(map));
    let lines = joined;
    if (view === "biomes") {
      const memo = this.biomeLines;
      if (memo?.from !== joined || memo.layout !== geom.layout) this.biomeLines = { from: joined, layout: geom.layout, lines: biomeViewLines(geom.layout, joined) };
      lines = this.biomeLines!.lines;
    }
    if (this.pathSvg?.isConnected && this.pathSvgFrom?.lines === lines && this.pathSvgFrom.geom === geom) return;
    this.removePathSvg();
    this.shownLines = lines;
    const plane = view === "biomes" ? geom.p2g : geom.c2g;
    this.shownPlane = plane;
    if (!lines.length) return;
    // Overworld hex radius in em: widths are px at the default zoom of a SCREEN_HEX_RADIUS hex.
    const unit = affineScale(geom.p2g) / geom.em / SCREEN_HEX_RADIUS;
    const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4);
    const at = (x: number, y: number) => {
      const [gx, gy] = applyAffine(plane, x, y);
      return { cx: Number(fmt(gx / geom.em)), cy: Number(fmt(gy / geom.em)) };
    };
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNS, "svg");
    svg.classList.add("duckmage-ow-paths-svg");
    svg.setAttribute("width", "1em");
    svg.setAttribute("height", "1em");
    svg.setAttribute("viewBox", "0 0 1 1");
    for (const l of lines) {
      const pts = l.pts.map(([x, y]) => at(x, y));
      const d = pts.length === 1 ? `M ${pts[0].cx} ${pts[0].cy} l 0 0` : l.smooth ? smoothPath(pts) : sharpPath(pts);
      const el = activeDocument.createElementNS(svgNS, "path");
      el.setAttribute("class", "duckmage-ow-path-line");
      el.setAttribute("d", d);
      el.setAttribute("stroke", l.color);
      el.setAttribute("stroke-width", fmt(l.width * unit));
      if (l.dash.length) el.setAttribute("stroke-dasharray", l.dash.map((n) => fmt(n * unit)).join(" "));
      el.setAttribute("stroke-linecap", "round");
      el.setAttribute("stroke-linejoin", "round");
      el.setAttribute("fill", "none");
      el.setAttribute("data-path", l.names.join(", "));
      svg.appendChild(el);
    }
    // Over the region bitmaps, under the overworld's own paths (z-index in styles.css).
    if (this.canvas?.nextSibling) grid.insertBefore(svg, this.canvas.nextSibling);
    else grid.appendChild(svg);
    this.pathSvg = svg;
    this.pathSvgFrom = { lines, geom };
  }

  /** Size and place the composite canvas over a grid-px box; returns its 2D context. */
  private place(canvas: HTMLCanvasElement, geom: Geometry, box: { x: number; y: number; w: number; h: number }): { ctx: CanvasRenderingContext2D; k: number } | null {
    let k = geom.pxScale;
    k = Math.min(k, MAX_SIDE / Math.max(1, box.w), MAX_SIDE / Math.max(1, box.h), Math.sqrt(MAX_AREA / Math.max(1, box.w * box.h)));
    canvas.width = Math.max(1, Math.ceil(box.w * k));
    canvas.height = Math.max(1, Math.ceil(box.h * k));
    canvas.setCssProps({
      "--duckmage-ow-left": `${box.x / geom.em}em`,
      "--duckmage-ow-top": `${box.y / geom.em}em`,
      "--duckmage-ow-width": `${box.w / geom.em}em`,
      "--duckmage-ow-height": `${box.h / geom.em}em`,
    });
    const ctx = canvas.getContext("2d");
    return ctx ? { ctx, k } : null;
  }

  private drawRegions(canvas: HTMLCanvasElement, geom: Geometry, map: MapData): void {
    const regions = regionsOf(this.plugin.settings.maps, map.name);
    this.cache.retain(new Set([...regions.map((r) => r.name), BLANK]));
    const k0 = geom.pxScale;
    const bitmaps: RegionBitmap[] = [];
    let cells = 0;
    const geoKey = `${k0.toFixed(3)}|${geom.c2g.map((v) => v.toFixed(2)).join(",")}`;
    // Built before the map data and palettes were loaded (startup, plugin
    // reload), a region bitmap is empty: never let that one stick.
    const loaded = this.plugin.mapStore.isReady() && this.plugin.paletteStore.isReady() ? "ready" : "loading";
    // Slots with no region yet: blank bricks (just their outline), one
    // bitmap for all of them, rebuilt when a region is made or removed.
    const taken = new Set(regions.map((r) => r.parent!.hex));
    const empty = blankSlots(map, taken);
    if (empty.length) {
      const blankKey = `${geoKey}|${empty.map(([x, y]) => hexKey(x, y)).join(",")}`;
      const blank = this.cache.get(BLANK, blankKey, () => this.buildBlank(empty, geom, k0));
      if (blank.canvas) bitmaps.push(blank);
    }
    for (const r of regions) {
      const [px, py] = hexPair(r.parent!.hex);
      const palette = this.plugin.getMapPalette(r.name);
      const key = `${geoKey}|${loaded}|${r.baseTerrain ?? ""}|${palette.map((t) => t.color).join("")}`;
      const bmp = this.cache.get(r.name, key, () => this.buildRegion(r, px, py, geom, k0));
      cells += regionCells(geom.layout, px, py).length;
      if (bmp.canvas) bitmaps.push(bmp);
    }
    this.lastStats.regions = regions.length;
    this.lastStats.cells = cells;
    if (!bitmaps.length) { canvas.width = canvas.height = 1; return; }
    const minX = Math.min(...bitmaps.map((b) => b.box.x)), minY = Math.min(...bitmaps.map((b) => b.box.y));
    const maxX = Math.max(...bitmaps.map((b) => b.box.x + b.box.w)), maxY = Math.max(...bitmaps.map((b) => b.box.y + b.box.h));
    const placed = this.place(canvas, geom, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    if (!placed) return;
    const { ctx, k } = placed;
    for (const b of bitmaps) {
      ctx.drawImage(b.canvas!, (b.box.x - minX) * k, (b.box.y - minY) * k, b.box.w * k, b.box.h * k);
    }
  }

  /** One region drawn into its own bitmap (grid-px box × pxScale). */
  private buildRegion(r: MapData, px: number, py: number, geom: Geometry, k: number): RegionBitmap {
    const colour = new Map(this.plugin.getMapPalette(r.name).map((t) => [t.name, t.color]));
    const hexes = this.plugin.mapStore.all(r.name);
    const cells: RegionCell[] = [];
    for (const [x, y] of regionCells(geom.layout, px, py)) {
      const t = hexes.get(hexKey(x, y))?.terrain ?? r.baseTerrain;
      const c = t ? colour.get(t) : undefined;
      if (c) cells.push({ x, y, color: c });
    }
    const all = regionCells(geom.layout, px, py).map(([x, y]) => ({ x, y }));
    const box = cellsBox(geom.layout, all, geom.c2g);
    if (!cells.length) return { canvas: null, box };
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(box.w * k));
    canvas.height = Math.max(1, Math.ceil(box.h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { canvas: null, box };
    // Grid px → this bitmap: shift by the box corner, scale by k.
    const toBitmap = composeAffine(geom.c2g, [k, 0, 0, k, -box.x * k, -box.y * k]);
    drawRegionCells(ctx, geom.layout, cells, toBitmap);
    return { canvas, box };
  }

  /** Every empty slot's outline in one bitmap. */
  private buildBlank(slots: [number, number][], geom: Geometry, k: number): RegionBitmap {
    const all = slots.flatMap(([px, py]) => regionCells(geom.layout, px, py).map(([x, y]) => ({ x, y })));
    const box = cellsBox(geom.layout, all, geom.c2g);
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(box.w * k));
    canvas.height = Math.max(1, Math.ceil(box.h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { canvas: null, box };
    const toBitmap = composeAffine(geom.c2g, [k, 0, 0, k, -box.x * k, -box.y * k]);
    for (const [px, py] of slots) {
      const cells = regionCells(geom.layout, px, py).map(([x, y]) => ({ x, y, color: BLANK_FILL }));
      drawRegionCells(ctx, geom.layout, cells, toBitmap, { seamColour: BLANK_EDGE, seamWidth: 0.12 });
    }
    return { canvas, box };
  }

  /** The biomes view: the preview minimap's marks over the overworld's own hexes. */
  private drawBiomes(canvas: HTMLCanvasElement, geom: Geometry, map: MapData): void {
    const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
    const corners = [[ox, oy], [ox + cols - 1, oy], [ox, oy + rows - 1], [ox + cols - 1, oy + rows - 1]]
      .map(([x, y]) => applyAffine(geom.p2g, ...hexCenter(x, y, geom.layout.orientation, geom.layout.parentStagger)));
    const s = affineScale(geom.p2g);
    const minX = Math.min(...corners.map((c) => c[0])) - 2 * s, minY = Math.min(...corners.map((c) => c[1])) - 2 * s;
    const maxX = Math.max(...corners.map((c) => c[0])) + 2 * s, maxY = Math.max(...corners.map((c) => c[1])) + 2 * s;
    const placed = this.place(canvas, geom, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    if (!placed) return;
    const { ctx, k } = placed;
    const at = (x: number, y: number): [number, number] => {
      const [gx, gy] = applyAffine(geom.p2g, ...hexCenter(x, y, geom.layout.orientation, geom.layout.parentStagger));
      return [(gx - minX) * k, (gy - minY) * k];
    };
    const biomes = overworldBiomes(overworldTerrain(this.plugin, map), this.plugin.getMapPalette(map.name), geom.layout.orientation, geom.layout.parentStagger, placedBiomes(this.plugin, map.name));
    const ecotones = ecotoneHexes(biomes, geom.layout.orientation, geom.layout.parentStagger);
    for (const k2 of ecotones) {
      const { x, y } = hexXY(k2);
      const [X, Y] = at(x, y);
      hexPath(ctx, X, Y, s * k * 0.97, geom.layout.orientation);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, 2.5 * k * s / 20);
      ctx.stroke();
    }
    drawRiver(ctx, parseBiomeRiver(map.biomeRiver), at, Math.max(2, 3 * k * s / 20));
    // Biome names in the hex's upper half (its coordinates sit lower), sized
    // to fit the hex: the preview's labels, scaled to the map's hexes.
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(Math.max(8, 0.2 * k * s))}px system-ui`;
    ctx.lineWidth = Math.max(2, 0.05 * k * s);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillStyle = "#000";
    for (const [key, b] of biomes) {
      const { x, y } = hexXY(key);
      const [X, Y] = at(x, y);
      // A mix (Alpine + Taiga) is one part per line, "+" before the rest, so it fits the hex.
      const parts = biomeParts(b);
      const lines = parts.length > 1 ? parts.map((p, i) => `${i ? "+ " : ""}${biomeInfo(p.id)?.label ?? p.id}`) : [biomeInfo(b)?.label ?? ""];
      const lh = Math.max(8, 0.2 * k * s) * 1.1;
      lines.forEach((text, i) => {
        const ty = Y - 0.3 * k * s - (lines.length - 1 - i) * lh;
        ctx.strokeText(text, X, ty);
        ctx.fillText(text, X, ty);
      });
    }
  }
}

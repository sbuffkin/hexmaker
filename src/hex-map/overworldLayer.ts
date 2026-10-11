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
import { biomeInfo } from "../overworld/biomes";
import { parentOf, regionCells, type RegionLayout } from "../overworld/layout";
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
  invertAffine,
  nearestChildCell,
  RegionBitmapCache,
  type Affine,
  type RegionCell,
} from "../overworld/overworldRender";
import { ecotoneHexes, overworldBiomes, parseBiomeRiver } from "../overworld/regionWorld";
import { overworldOf, overworldTerrain } from "../overworld/regionsVault";
import { FrameThrottle } from "../overworld/overworldInput";

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
    for (let x = ox; x < ox + cols; x++) if (!taken.has(`${x}_${y}`)) out.push([x, y]);
  }
  return out;
}

export class OverworldLayer {
  readonly cache = new RegionBitmapCache<RegionBitmap>();
  private geom: Geometry | null = null;
  private canvas: HTMLCanvasElement | null = null;
  /** Redraws coalesce to one per animation frame, and keep coming during a brush stroke. */
  private redraws = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
  /** Timings of the last draw (ms) and how many region bitmaps it built. */
  lastStats = { ms: 0, builds: 0, regions: 0, cells: 0 };

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
  }

  /** Draw the layer for `map` into `grid` (call after the hexes are laid out). */
  render(grid: HTMLElement, map: MapData): void {
    this.canvas?.remove();
    this.canvas = null;
    this.geom = null;
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

  /** A region's map changed: rebuild its bitmap on the next draw (callers redraw when it's on screen). */
  invalidate(regionName: string): void {
    this.cache.invalidate(regionName);
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
    const [cx, cy] = applyAffine(invertAffine(geom.c2g), (clientX - g.left) / sx, (clientY - g.top) / sy);
    const [x, y] = nearestChildCell(geom.layout, cx, cy);
    const parentHex = parentOf(geom.layout, x, y).join("_");
    const region = regionsOf(this.plugin.settings.maps, geom.map).find((r) => r.parent?.hex === parentHex);
    return { x, y, region: region?.name, parentHex };
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
      const blankKey = `${geoKey}|${empty.map(([x, y]) => `${x}_${y}`).join(",")}`;
      const blank = this.cache.get(BLANK, blankKey, () => this.buildBlank(empty, geom, k0));
      if (blank.canvas) bitmaps.push(blank);
    }
    for (const r of regions) {
      const [px, py] = r.parent!.hex.split("_").map(Number);
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
      const t = hexes.get(`${x}_${y}`)?.terrain ?? r.baseTerrain;
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
    const biomes = overworldBiomes(overworldTerrain(this.plugin, map), this.plugin.getMapPalette(map.name), geom.layout.orientation, geom.layout.parentStagger);
    const ecotones = ecotoneHexes(biomes, geom.layout.orientation, geom.layout.parentStagger);
    for (const k2 of ecotones) {
      const [x, y] = k2.split("_").map(Number);
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
      const [x, y] = key.split("_").map(Number);
      const [X, Y] = at(x, y);
      const text = biomeInfo(b)?.label ?? "";
      ctx.strokeText(text, X, Y - 0.3 * k * s);
      ctx.fillText(text, X, Y - 0.3 * k * s);
    }
  }
}

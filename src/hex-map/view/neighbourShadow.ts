/**
 * The neighbour strip (L2g, split out of HexMapView): neighbouring
 * regions' terrain just past this map's edges, dimmed, with their paths
 * drawn across it, and the seam joins between their paths and this map's.
 * Reads first, then writes (CLAUDE.md); placed in em so zoom bakes keep it.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { MapData } from "../../types";
import { ghostPathRuns, ghostRunPoints, seamJoinKey, seamJoins, seamPoint, type SeamJoin, type ShadowRef } from "../ghostPaths";
import { drawGhostPaths } from "../ghostPathsSvg";
import { hexNeighbors } from "../hexGeometry";
import type { PathTool } from "../pathTool";
import { RegionNavigateModal } from "../RegionNavigateModal";
import type { DrawingMode } from "../toolMode";
import { neighbourShadow } from "../../worldgen/neighbours";

export interface NeighbourShadowHost {
  plugin: HexmakerPlugin;
  getActiveStagger(): "odd" | "even";
  drawingMode(): DrawingMode | null;
  isErasingMode(): boolean;
  pathTool(): PathTool;
  /** Go to a neighbouring region's hex. */
  goToRegionHex(mapName: string, x: number, y: number): void;
}

export class NeighbourShadow {
  /** The neighbour strip last drawn (map name + its hexes), so the path
   *  overlay can join paths across the seam (round 6 U8). */
  private lastShadow: { map: string; shadow: ReadonlyMap<string, ShadowRef> } | null = null;
  /** The seam joins the neighbour strip was drawn with: drawing or erasing
   *  a path that changes them redraws the strip. */
  private shadowJoinKey = "";

  constructor(private host: NeighbourShadowHost) {}

  /** The strip's hexes when it was drawn for `mapName` (empty otherwise). */
  strip(mapName: string): ReadonlyMap<string, ShadowRef> {
    return this.lastShadow?.map === mapName ? this.lastShadow.shadow : new Map();
  }

  /**
   * This map's seam joins for the path layer. A path edit that starts or
   * ends a seam join redraws the neighbour strip, so its road reaches the
   * shared edge too (round 6 U8).
   */
  seamJoins(gridContainer: HTMLElement, region: MapData): SeamJoin[] {
    const joins = this.currentSeamJoins(region);
    if (this.lastShadow?.map === region.name && seamJoinKey(joins) !== this.shadowJoinKey) {
      this.render(gridContainer, region);
    }
    return joins;
  }

  /** Paths of the open map that meet a neighbour's path across the seam. */
  private currentSeamJoins(region: MapData): SeamJoin[] {
    const s = this.lastShadow;
    if (!s || s.map !== region.name || !s.shadow.size) return [];
    const orientation = this.host.plugin.settings.hexOrientation;
    const stagger = this.host.getActiveStagger();
    const touches = (a: string, b: string) => {
      const [x, y] = a.split("_").map(Number);
      return hexNeighbors(x, y, orientation, stagger).some(([nx, ny]) => `${nx}_${ny}` === b);
    };
    return seamJoins(this.host.plugin.paths.resolvedPathChains(region.name), s.shadow, (m) => this.host.plugin.paths.resolvedPathChains(m), touches);
  }
  /**
   * Neighbouring regions' terrain just past this map's edges, dimmed (1–3
   * hexes deep by map size). Clicking one asks to go to that region.
   *
   * Drawn on its own layer so the grid itself (and anything calibrated to
   * it) doesn't move: hex spacing is read from hexes already laid out, all
   * reads first, then the writes (see the read-then-write rule in CLAUDE.md).
   */
  render(gridContainer: HTMLElement, region: MapData): void {
    this.lastShadow = null;
    this.shadowJoinKey = "";
    gridContainer.querySelectorAll(".duckmage-region-shadow-layer").forEach((el) => el.remove());
    if (!region.world) return;
    const shadow = neighbourShadow(this.host.plugin, region);
    this.lastShadow = { map: region.name, shadow };
    if (!shadow.size) return;
    const { x: ox, y: oy } = region.gridOffset;
    const { cols, rows } = region.gridSize;
    const isFlat = this.host.plugin.settings.hexOrientation === "flat";
    const stagger = this.host.getActiveStagger();
    const shifted = (n: number) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0) ? 1 : 0;

    // ── Reads ──
    const hexAt = (x: number, y: number) => gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    const origin = hexAt(ox, oy);
    if (!origin) return;
    const g = gridContainer.getBoundingClientRect();
    const sx = gridContainer.offsetWidth ? g.width / gridContainer.offsetWidth : 1;
    const sy = gridContainer.offsetHeight ? g.height / gridContainer.offsetHeight : 1;
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - g.left) / sx, y: (r.top + r.height / 2 - g.top) / sy, w: r.width / sx, h: r.height / sy };
    };
    const A = centre(origin);
    // Positions are written in em: zooming bakes a new font size into the
    // grid and the hexes (sized in em) resize with it; px would be left behind.
    const em = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    const right = cols > 1 ? hexAt(ox + 1, oy) : null, below = rows > 1 ? hexAt(ox, oy + 1) : null;
    const B = right ? centre(right) : null, C = below ? centre(below) : null;
    let place: (x: number, y: number) => { x: number; y: number };
    if (isFlat) {
      const colPitch = B ? B.x - A.x : A.w * 0.75;
      const rowPitch = C ? C.y - A.y : A.h;
      place = (x, y) => ({ x: A.x + (x - ox) * colPitch, y: A.y + (y - oy) * rowPitch + (shifted(x) - shifted(ox)) * (rowPitch / 2) });
    } else {
      const colPitch = B ? B.x - A.x : A.w;
      const rowPitch = C ? C.y - A.y : A.h * 0.75;
      place = (x, y) => ({ x: A.x + (x - ox) * colPitch + (shifted(y) - shifted(oy)) * (colPitch / 2), y: A.y + (y - oy) * rowPitch });
    }
    const palettes = new Map<string, Map<string, string>>();
    const colorOf = (map: string, terrain?: string) => {
      if (!terrain) return undefined;
      let p = palettes.get(map);
      if (!p) palettes.set(map, (p = new Map(this.host.plugin.getMapPalette(map).map((t) => [t.name, t.color]))));
      return p.get(terrain);
    };
    const items = [...shadow].map(([key, s]) => {
      const [x, y] = key.split("_").map(Number);
      return { s, at: place(x, y), color: colorOf(s.map, s.terrain) };
    });
    // The neighbours' roads and rivers across the strip (read-only), so a
    // path here can be drawn to meet them (round 4: testers lined roads up
    // by eye). In em, like the strip's hexes; a dot marks where one ends.
    // Each neighbour's paths in its own palette's styles.
    const typeOf = (map: string, name: string) => this.host.plugin.getMapPathTypes(map).find((t) => t.name === name);
    const centreEm = (key: string) => {
      const [x, y] = key.split("_").map(Number);
      const p = place(x, y);
      return { cx: p.x / em, cy: p.y / em };
    };
    // A neighbour path that ends where one of ours does draws on to the
    // shared edge (no end dot there): the two read as one road (round 6 U8).
    const joins = this.currentSeamJoins(region);
    this.shadowJoinKey = seamJoinKey(joins);
    const joinedAt = (run: { map: string; typeName: string }, key: string) =>
      joins.find((j) => j.map === run.map && j.typeName === run.typeName && j.other === key);
    const ghostPaths = ghostPathRuns(shadow, (m) => this.host.plugin.paths.resolvedPathChains(m)).flatMap((run) => {
      const pt = typeOf(run.map, run.typeName);
      if (!pt) return [];
      const pts = ghostRunPoints(run, centreEm);
      const startJoin = run.stubStart ? undefined : joinedAt(run, run.hexes[0]);
      const endJoin = run.stubEnd ? undefined : joinedAt(run, run.hexes[run.hexes.length - 1]);
      const ends = [run.stubStart || startJoin ? null : pts[0], run.stubEnd || endJoin ? null : pts[pts.length - 1]]
        .filter((p): p is { cx: number; cy: number } => p !== null);
      if (startJoin) pts.unshift(seamPoint(centreEm(startJoin.other), centreEm(startJoin.own)));
      if (endJoin) pts.push(seamPoint(centreEm(endJoin.other), centreEm(endJoin.own)));
      return [{ map: run.map, pt, pts, ends }];
    });
    const gridWEm = gridContainer.offsetWidth / em;
    const gridHEm = gridContainer.offsetHeight / em;

    // ── Writes ──
    const layer = gridContainer.createDiv({ cls: "duckmage-region-shadow-layer" });
    for (const { s, at, color } of items) {
      // Not a .duckmage-hex: painting, overlays and labels all look for those.
      const el = layer.createDiv({
        cls: "duckmage-region-shadow-hex",
        attr: { title: `${this.host.plugin.mapLabel(s.map)}: hex ${s.x}, ${s.y}`, "data-region": s.map },
      });
      el.setCssProps({
        "--duckmage-shadow-x": `${(at.x - A.w / 2) / em}em`,
        "--duckmage-shadow-y": `${(at.y - A.h / 2) / em}em`,
        "--duckmage-shadow-w": `${A.w / em}em`,
        "--duckmage-shadow-h": `${A.h / em}em`,
        ...(color ? { "--duckmage-shadow-color": color } : {}),
      });
      el.addEventListener("click", (e) => {
        // The path tool hooks onto a neighbour's path here, or carries one on across (O1).
        if (this.host.drawingMode() === "path" && !this.host.isErasingMode() && this.host.pathTool().clickStrip(e)) return;
        new RegionNavigateModal(this.host.plugin.app, this.host.plugin, { map: s.map, x: s.x, y: s.y }, () => this.host.goToRegionHex(s.map, s.x, s.y)).open();
      });
    }

    drawGhostPaths(layer, ghostPaths, gridWEm, gridHEm, em);
  }

}

/**
 * What the map writes over its hexes besides paths and areas (L2f, split
 * out of HexMapView): coordinate labels (only for on-screen hexes big
 * enough to read), link badges, hex names and the terrain legend. Hex
 * positions are measured once per grid, all reads before any write
 * (CLAUDE.md read-then-write rule; dev/coord-label-thrash-bench).
 */
import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { MapData } from "../../types";
import { getIconUrl } from "../../utils";
import { resolveNameFont } from "../hexNameFont";
import { renderHexNameLayer } from "../hexNameLayer";
import { BADGE_INFO, badgeNameLimit, badgeSize, hexKeyFromBasename, hiddenBadges, legendBadgeKinds, linkSectionsFromCache, renderLinkBadgeLayer, type BadgeSection } from "../linkBadges";
import { legendSize, MAP_LEGEND_NAME_MAX, renderTerrainLegend, usedTerrainEntries } from "../terrainLegend";
import { hexXY } from "../../hexKey";

export interface GridLabelsHost {
  plugin: HexmakerPlugin;
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  controlsEl(): HTMLElement | null;
  getActiveMap(): MapData;
  /** The viewport's current CSS scale. */
  zoom(): number;
  /** A renderGrid is waiting for the grid to get a layout size. */
  measuring(): boolean;
  /** The layers menu's legend toggle follows the legend's own hide button. */
  syncLegendToggle(): void;
}

export class GridLabels {
  // Coord labels are created only for on-screen hexes big enough to read
  // (see syncCoordLabels). Placements are measured once per renderGrid.
  coordPlacements: { key: string; ox: number; oy: number }[] = [];
  coordGridSize = { w: 1, h: 1 };
  private coordLabels = new Map<string, HTMLElement>();
  // Link badges + terrain legend refresh on note / map-store changes (debounced).
  private badgeTimer: number | null = null;
  /** Badge kinds some hex of the map shows (for the legend). */
  private badgeKindsOnMap: BadgeSection[] = [];
  /** Link sections per hex ("x_y") from the last badge render; names keep clear of them. */
  private badgeSectionsByHex = new Map<string, BadgeSection[]>();
  private legendTimer: number | null = null;
  private namesTimer: number | null = null;
  /** Names the hex-name layer was last drawn with ("x_y=name" lines), to skip no-op redraws. */
  private drawnHexNames = "";
  private settleTimer: number | null = null;

  constructor(private host: GridLabelsHost) {}

  /** A new grid: forget the last one's placements and labels. */
  resetCoords(): void {
    this.coordPlacements = [];
    this.coordLabels.clear();
  }

  /** The view closes: stop pending redraws. */
  dispose(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    if (this.badgeTimer !== null) window.clearTimeout(this.badgeTimer);
    if (this.legendTimer !== null) window.clearTimeout(this.legendTimer);
    if (this.namesTimer !== null) window.clearTimeout(this.namesTimer);
  }

  // Coord labels render in a sibling layer of the path/faction SVGs
  // (CSS z-index: 10 vs path z:5, faction z:4, region z:3) so they sit
  // above every overlay — paths, GM icons, faction tint, region tint.
  // Each label is positioned by percentage of gridContainer dimensions
  // so it auto-rescales through bake-zoom font-size mutations without
  // needing rebuild. Same pattern used for region labels.
  renderCoordLabelsLayer(gridContainer: HTMLElement): void {
    gridContainer
      .querySelector(".duckmage-coord-labels-layer")
      ?.remove();
    this.coordLabels.clear();
    const gw = gridContainer.offsetWidth || 1;
    const gh = gridContainer.offsetHeight || 1;
    this.coordGridSize = { w: gw, h: gh };

    // CRITICAL: read every hex's offset geometry FIRST, into a plain array,
    // before creating any label DOM. Interleaving offset reads with DOM writes
    // forces a full synchronous layout per hex — O(n²) layout thrash that
    // stalled opening large maps for ~20s at chult's 3843 hexes (see
    // dev/coord-label-thrash-bench).
    const placements: { key: string; ox: number; oy: number }[] = [];
    gridContainer
      .querySelectorAll<HTMLElement>(".duckmage-hex")
      .forEach((hexEl) => {
        // Hex center in gridContainer-local pixel coords (unaffected by
        // CSS transform; offsetParent walks stop at gridContainer).
        let ox = hexEl.offsetWidth / 2;
        let oy = hexEl.offsetHeight / 2;
        let cur: HTMLElement | null = hexEl;
        while (cur && cur !== gridContainer) {
          ox += cur.offsetLeft;
          oy += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        placements.push({ key: `${hexEl.dataset.x},${hexEl.dataset.y}`, ox, oy });
      });
    this.coordPlacements = placements;

    gridContainer.createDiv({ cls: "duckmage-coord-labels-layer" });
    this.syncCoordLabels();
  }

  /**
   * While the viewport moves it is a composited layer (`is-moving` →
   * will-change: transform), so pan/zoom frames only re-composite. Once it
   * settles the class comes off, which makes Chromium re-raster at the
   * current zoom: a promoted layer is otherwise only rastered at the scale
   * it was promoted at, so zooming in over a bg image (where zoom is never
   * baked into font-size) left hexes and labels soft and jagged.
   */
  onViewportMoved(): void {
    this.host.viewportEl()?.addClass("is-moving");
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.host.viewportEl()?.removeClass("is-moving");
      this.syncCoordLabels();
    }, 150);
  }

  /**
   * Create labels for hexes inside the visible area (plus a margin) and drop
   * the rest. Text is the most expensive thing on the map — a label for all
   * 3843 chult hexes cost ~170 ms of every renderGrid — and when zoomed out
   * far enough to see a big map the labels are a few pixels tall, so below
   * MIN_LABEL_PX none are drawn. Labels sit at a % of the grid, so they
   * track font-size zoom bakes without a rebuild.
   */
  syncCoordLabels(): void {
    const MIN_LABEL_PX = 5;
    const layer = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-coord-labels-layer");
    const grid = layer?.parentElement;
    const clip = this.host.viewportEl()?.parentElement;
    if (!layer || !grid || !clip) return;

    // Reads first (one layout flush), then writes. Measure the grid, not the
    // layer: the layer covers it exactly but is display:none while
    // coordinates are hidden, and labels must be ready when they're shown.
    const rect = grid.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    const { w: gw, h: gh } = this.coordGridSize;
    const sx = rect.width / gw;
    const sy = rect.height / gh;
    const labelPx =
      parseFloat(getComputedStyle(layer).fontSize) *
      (this.host.plugin.settings.coordFontSize ?? 0.8) *
      Math.min(sx, sy);

    const wanted = new Set<string>();
    if (sx > 0 && sy > 0 && labelPx >= MIN_LABEL_PX) {
      const mx = clipRect.width * 0.25;
      const my = clipRect.height * 0.25;
      const x0 = (clipRect.left - mx - rect.left) / sx;
      const x1 = (clipRect.right + mx - rect.left) / sx;
      const y0 = (clipRect.top - my - rect.top) / sy;
      const y1 = (clipRect.bottom + my - rect.top) / sy;
      for (const p of this.coordPlacements) {
        if (p.ox >= x0 && p.ox <= x1 && p.oy >= y0 && p.oy <= y1) wanted.add(p.key);
      }
    }

    for (const [key, el] of this.coordLabels) {
      if (!wanted.has(key)) {
        el.remove();
        this.coordLabels.delete(key);
      }
    }
    for (const p of this.coordPlacements) {
      if (!wanted.has(p.key) || this.coordLabels.has(p.key)) continue;
      const label = layer.createDiv({ cls: "duckmage-coord-label-html", text: p.key });
      label.setCssProps({
        "--duckmage-coord-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
        "--duckmage-coord-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
      });
      this.coordLabels.set(p.key, label);
    }
  }

  /**
   * Corner badges for the hex notes of this map that link towns, dungeons,
   * features, quests or factions. Reads only the metadata cache of the map's
   * existing notes and positions from `coordPlacements` (no layout reads);
   * the layers menu hides them by CSS class.
   */
  renderLinkBadges(gridContainer: HTMLElement): void {
    const sections = new Map<string, BadgeSection[]>();
    const folder = this.host.plugin.app.vault.getAbstractFileByPath(this.host.plugin.mapStore.mapFolder(this.host.activeMapName()));
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const key = hexKeyFromBasename(child.basename);
        if (!key) continue;
        const found = linkSectionsFromCache(this.host.plugin.app.metadataCache.getFileCache(child));
        if (found.length) sections.set(key, found);
      }
    }
    this.badgeSectionsByHex = sections;
    const map = this.host.getActiveMap();
    renderLinkBadgeLayer(gridContainer, this.coordPlacements, this.coordGridSize, sections, badgeSize(map.linkBadgeSize), this.host.plugin.sectionWordsFor(this.host.activeMapName()));
    // The legend lists the kinds on the map: redraw it when they change.
    const kinds = [...new Set([...sections.values()].flat())];
    if (kinds.sort().join() !== [...this.badgeKindsOnMap].sort().join()) {
      this.badgeKindsOnMap = kinds;
      this.refreshTerrainLegend();
    }
  }

  scheduleLinkBadges(): void {
    if (this.badgeTimer !== null) window.clearTimeout(this.badgeTimer);
    this.badgeTimer = window.setTimeout(() => {
      this.badgeTimer = null;
      const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) {
        this.renderLinkBadges(grid);
        // Badges came or went: names make room for them.
        if (!this.host.measuring()) this.drawHexNames(grid, true);
      }
    }, 300);
  }

  scheduleHexNames(): void {
    if (this.namesTimer !== null) window.clearTimeout(this.namesTimer);
    this.namesTimer = window.setTimeout(() => {
      this.namesTimer = null;
      // A grid still waiting for a size draws its names when it gets one.
      if (this.host.measuring()) return;
      const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
      if (grid) this.drawHexNames(grid, true);
    }, 300);
  }

  /** (Re)draw the hex-name layer; with `onlyIfChanged`, skip when no name changed. */
  drawHexNames(gridContainer: HTMLElement, onlyIfChanged = false): void {
    const names = this.hexNames();
    const fills = this.hexNameFills(names);
    // The fill is in the signature: repainting a named hex can flip its name's tone.
    // Badges in the signature too: names make room for them (R8).
    const limits = this.nameBadgeLimits(names);
    // The font and the grid's on-screen size too: a name's size has a
    // readable floor (NM3), so zooming can change its layout.
    const font = resolveNameFont(this.host.getActiveMap(), this.host.plugin.settings);
    const screenEm = names.size ? (parseFloat(getComputedStyle(gridContainer).fontSize) || 16) * this.host.zoom() : 0;
    const sig = [...names].map(([k, n]) => `${k}=${n}|${fills.get(k) ?? ""}|${limits.get(k) ?? ""}`).sort().join("\n")
      + `\nfont=${font.family}|${font.scale}|${font.bold}|${font.italic}|${screenEm.toFixed(1)}`;
    if (onlyIfChanged && sig === this.drawnHexNames) return;
    this.drawnHexNames = sig;
    renderHexNameLayer(gridContainer, names, fills, this.host.plugin.settings.coordPlacement ?? "bottom", limits, font, this.host.zoom());
  }

  /** How far right each named hex's name may reach: clear of its shown badges (R8). */
  private nameBadgeLimits(names: ReadonlyMap<string, string>): Map<string, number> {
    const out = new Map<string, number>();
    const map = this.host.getActiveMap();
    if (!(map.showLinkBadges ?? true)) return out;
    const hidden = new Set(hiddenBadges(map));
    const size = badgeSize(map.linkBadgeSize);
    const flat = this.host.plugin.settings.hexOrientation === "flat";
    for (const key of names.keys()) {
      const n = (this.badgeSectionsByHex.get(key) ?? []).filter((s) => !hidden.has(s)).length;
      if (n) out.set(key, badgeNameLimit(size, flat, n));
    }
    return out;
  }

  /** Terrain colour under each named hex (map data + palette; no DOM reads). */
  private hexNameFills(names: ReadonlyMap<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    if (!names.size) return out;
    const byName = new Map<string, string>();
    for (const t of this.host.plugin.getMapPalette(this.host.activeMapName())) if (!byName.has(t.name)) byName.set(t.name, t.color);
    const base = this.host.getActiveMap().baseTerrain;
    for (const key of names.keys()) {
      const terrain = this.host.plugin.mapStore.get(this.host.activeMapName(), key)?.terrain ?? base;
      const color = terrain ? byName.get(terrain) : undefined;
      if (color) out.set(key, color);
    }
    return out;
  }

  scheduleTerrainLegend(): void {
    if (this.legendTimer !== null) window.clearTimeout(this.legendTimer);
    this.legendTimer = window.setTimeout(() => {
      this.legendTimer = null;
      this.refreshTerrainLegend();
    }, 250);
  }

  /** The terrains used on this map (own terrain, or the base terrain where unset). */
  refreshTerrainLegend(): void {
    const parent = this.host.controlsEl();
    if (!parent) return;
    const settings = this.host.plugin.settings;
    if (!(settings.showTerrainLegend ?? true)) {
      parent.querySelector(":scope > .duckmage-terrain-legend")?.remove();
      return;
    }
    const map = this.host.getActiveMap();
    const { cols, rows } = map.gridSize;
    const { x: ox, y: oy } = map.gridOffset;
    const used: string[] = [];
    let painted = 0;
    for (const [key, h] of this.host.plugin.mapStore.all(this.host.activeMapName())) {
      if (!h.terrain) continue;
      const { x, y } = hexXY(key);
      if (x < ox || y < oy || x >= ox + cols || y >= oy + rows) continue;
      used.push(h.terrain);
      painted++;
    }
    if (map.baseTerrain && painted < cols * rows) used.push(map.baseTerrain);
    const entries = usedTerrainEntries(this.host.plugin.getMapPalette(this.host.activeMapName()), used);
    // The link badge kinds on the map, as on the PNG legend (round 7 R8),
    // named for the map type (G4b).
    const words = this.host.plugin.sectionWordsFor(this.host.activeMapName());
    const badges = legendBadgeKinds(this.badgeKindsOnMap, map.showLinkBadges ?? true, hiddenBadges(map))
      .map((s) => ({ label: words(s).label, icon: BADGE_INFO[s].icon, cls: BADGE_INFO[s].cls }));
    // Pinned to the view's bottom-left, small, names cut short; folds to
    // a "Legend" chip (MK2).
    renderTerrainLegend(parent, entries, {
      badges,
      size: legendSize(settings.terrainLegendSize, "s"),
      cls: "duckmage-terrain-legend-map",
      maxName: MAP_LEGEND_NAME_MAX,
      collapsed: settings.terrainLegendCollapsed ?? false,
      onCollapse: (collapsed) => {
        settings.terrainLegendCollapsed = collapsed;
        void this.host.plugin.saveSettings();
        this.refreshTerrainLegend();
      },
      iconUrl: (icon) => getIconUrl(this.host.plugin, icon),
      onSize: (size) => {
        settings.terrainLegendSize = size;
        void this.host.plugin.saveSettings();
        this.refreshTerrainLegend();
      },
      onHide: () => {
        settings.showTerrainLegend = false;
        void this.host.plugin.saveSettings();
        this.host.syncLegendToggle();
        this.refreshTerrainLegend();
      },
    });
  }

  /** "x_y" → name for the active map's named hexes (map note data). */
  hexNames(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, h] of this.host.plugin.mapStore.all(this.host.activeMapName())) if (h.name) out.set(key, h.name);
    return out;
  }

}

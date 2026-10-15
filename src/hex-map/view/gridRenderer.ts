/**
 * The hex grid's DOM (L2b, split out of HexMapView): the full re-render
 * (`renderGrid`), the layers placed from measured hex geometry once the grid
 * has a layout size, the missing-map empty state, the faction tooltip, and
 * the "terrain as drawn" snapshot a region map keeps so a stroke on its
 * overworld (in another view) repaints just the hexes it changed.
 *
 * Read-then-write: renderGrid only writes DOM (no layout reads per hex);
 * every measured layer runs after whenSized, and each of those builders reads
 * all geometry first (see CLAUDE.md, the coord-label thrash bench).
 */
import { TFile, TFolder, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { normalizeFolder, getIconUrl, createIconEl } from "../../utils";
import {
  getFrontMatter,
  terrainFromFm,
  pendingTerrainOf,
  iconOverrideFromFm,
  gmIconsFromFm,
  getFactionColorFromFile,
} from "../../frontmatter";
import { renderMissingActions } from "../MapModal";
import { canAdd } from "../../workMode";
import { coordHaloColor } from "../../coordStyle";
import { watchBiomesPathHover } from "../biomesPathHover";
import { parseVisited } from "../../play/partyTravel";
import { regionsViewTip } from "../hexHover";
import { whenSized } from "../whenSized";
import type { MapData } from "../../types";
import { moduleUnchartedKeys } from "../../modules/runtime";
import { renderUnchartedLayer, unchartedKeys } from "../unchartedLayer";
import { FrameThrottle } from "../../frameThrottle";
import { terrainDiff } from "../terrainDiff";
import type { OverlayPanel } from "../HexSidePanel";
// World maps through the view, typed only.
import type { OverworldLayer } from "../../overworld/overworldLayer";
import type { OverworldMinimap } from "../../overworld/overworldMinimap";
import type { DrawingMode } from "../toolMode";
import type { BackgroundCalibration } from "./backgroundCalibration";
import type { GridLabels } from "./gridLabels";
import type { NeighbourShadow } from "./neighbourShadow";
import type { PathOverlay } from "./pathOverlay";
import type { AreaOverlay } from "./areaOverlay";
import type { TokenLayer } from "./tokenLayer";
import type { MapToolbar } from "./mapToolbar";
import type { HexContextMenu } from "./hexContextMenu";
import { hexKey } from "../../hexKey";

export interface GridRendererHost {
  plugin: HexmakerPlugin;
  contentEl: HTMLElement;
  viewportEl(): HTMLElement | null;
  controlsEl(): HTMLElement | null;
  activeMapName(): string;
  getActiveMap(): MapData;
  owView(map: MapData): "regions" | "biomes" | null;
  getActiveStagger(): "odd" | "even";
  selectedHex(): { x: number; y: number } | null;
  drawingMode(): DrawingMode | null;
  overlayPanel(): Pick<OverlayPanel, "syncToRegion"> | null;
  overworldLayer(): OverworldLayer | undefined;
  minimap(): OverworldMinimap | undefined;
  calibration: Pick<
    BackgroundCalibration,
    | "active"
    | "renderBackgroundImage"
    | "applyGridLayerVars"
    | "attachGridCalibrationHandlers"
    | "renderCalibrationOutlines"
    | "applyCalibrationFocusStyles"
  >;
  labels: Pick<
    GridLabels,
    | "refreshTerrainLegend"
    | "resetCoords"
    | "renderCoordLabelsLayer"
    | "renderLinkBadges"
    | "coordPlacements"
    | "coordGridSize"
    | "drawHexNames"
  >;
  shadow: Pick<NeighbourShadow, "render">;
  pathLayer: Pick<PathOverlay, "renderPathOverlay">;
  areas: Pick<AreaOverlay, "getFactionLinksFromCache" | "renderRegionOverlay" | "renderFactionOverlay">;
  tokens: Pick<TokenLayer, "renderTokenLayer">;
  toolbar: Pick<MapToolbar, "updateModeBar">;
  hexMenu: Pick<HexContextMenu, "onHexContextMenu">;
  refreshWorkModeBtn(): void;
  /** Through the view: the smoke suite wraps view.onHexClick. */
  onHexClick(x: number, y: number, e?: MouseEvent): Promise<void>;
  navigateToMap(name: string): void;
  openLocationsList(x: number, y: number): void;
  labelHex(hexEl: HTMLElement, terrain?: string | null, path?: string): void;
  applyTerrainToHexEl(hexEl: HTMLElement, terrain: string | null): void;
  emptySlotOnMap(hex: string): boolean;
}

/**
 * Set (or clear) a hex cell's terrain background color, keeping the
 * `duckmage-hex-painted` marker class in sync. The bg-image stylesheet uses
 * that class — rather than a `:not([style*="background-color"])`
 * attribute-substring selector, which is measurably slower for the engine to
 * match across the thousands of hexes on a large map — to decide which empty
 * hexes fall transparent over the image.
 */
export function setHexColor(hexEl: HTMLElement, color: string | undefined | null): void {
  if (color) {
    hexEl.style.backgroundColor = color;
    hexEl.addClass("duckmage-hex-painted");
  } else {
    hexEl.style.removeProperty("background-color");
    hexEl.removeClass("duckmage-hex-painted");
  }
}

export class GridRenderer {
  /** Cancels a renderGrid waiting for the grid to get a layout size. */
  private cancelMeasuredLayers: (() => void) | null = null;
  /** The faction overlay's hover tooltip (made in onOpen). */
  factionTooltipEl: HTMLElement | null = null;
  private missingEl: HTMLElement | null = null;
  /**
   * A region map's terrain as this view last drew it, so a brush stroke on
   * its overworld (in another view) repaints just the hexes it changed, live.
   * Empty for other maps.
   */
  readonly shownTerrain = new Map<string, string | null>();
  private terrainSync = new FrameThrottle((cb) => window.requestAnimationFrame(cb));

  constructor(private host: GridRendererHost) {}

  // The view's state, read live (the bodies below read it as `this.…`).
  private get plugin(): HexmakerPlugin { return this.host.plugin; }
  private get app(): App { return this.host.plugin.app; }
  private get contentEl(): HTMLElement { return this.host.contentEl; }
  private get viewportEl(): HTMLElement | null { return this.host.viewportEl(); }
  private get controlsEl(): HTMLElement | null { return this.host.controlsEl(); }
  private get activeMapName(): string { return this.host.activeMapName(); }
  private get selectedHex(): { x: number; y: number } | null { return this.host.selectedHex(); }
  private get drawingMode(): DrawingMode | null { return this.host.drawingMode(); }
  private get overlayPanel(): Pick<OverlayPanel, "syncToRegion"> | null { return this.host.overlayPanel(); }
  private get overworldLayer(): OverworldLayer | undefined { return this.host.overworldLayer(); }
  private get minimap(): OverworldMinimap | undefined { return this.host.minimap(); }
  private get calibration(): GridRendererHost["calibration"] { return this.host.calibration; }
  private get labels(): GridRendererHost["labels"] { return this.host.labels; }
  private get shadow(): GridRendererHost["shadow"] { return this.host.shadow; }
  private get pathLayer(): GridRendererHost["pathLayer"] { return this.host.pathLayer; }
  private get areas(): GridRendererHost["areas"] { return this.host.areas; }
  private get tokens(): GridRendererHost["tokens"] { return this.host.tokens; }
  private get toolbar(): GridRendererHost["toolbar"] { return this.host.toolbar; }
  private get hexMenu(): GridRendererHost["hexMenu"] { return this.host.hexMenu; }
  private getActiveMap(): MapData { return this.host.getActiveMap(); }
  private owView(map: MapData): "regions" | "biomes" | null { return this.host.owView(map); }
  private getActiveStagger(): "odd" | "even" { return this.host.getActiveStagger(); }
  private onHexClick(x: number, y: number, e?: MouseEvent): Promise<void> { return this.host.onHexClick(x, y, e); }
  private navigateToMap(name: string): void { this.host.navigateToMap(name); }
  private openLocationsList(x: number, y: number): void { this.host.openLocationsList(x, y); }
  private labelHex(hexEl: HTMLElement, terrain?: string | null, path?: string): void { this.host.labelHex(hexEl, terrain, path); }
  private refreshWorkModeBtn(): void { this.host.refreshWorkModeBtn(); }
  private setHexColor(hexEl: HTMLElement, color: string | undefined | null): void { setHexColor(hexEl, color); }

  /** A renderGrid is waiting for the grid to get a layout size. */
  get measuring(): boolean {
    return !!this.cancelMeasuredLayers;
  }

  /** Stop a renderGrid waiting for a layout size (view close). */
  cancelMeasured(): void {
    this.cancelMeasuredLayers?.();
  }

  /** Repaint, next frame, the hexes whose terrain changed since they were drawn. */
  requestTerrainSync(): void {
    this.terrainSync.request(() => this.syncShownTerrain());
  }

  /** Show (true) or clear (false) the missing-map empty state for the open map. */
  private renderMissingState(): boolean {
    this.missingEl?.remove();
    this.missingEl = null;
    const name = this.activeMapName;
    if (!this.plugin.mapStore.isMissing(name) || !this.controlsEl) return false;
    const box = this.controlsEl.createDiv({ cls: "duckmage-map-missing-state" });
    this.missingEl = box;
    box.createEl("h3", { text: `${this.plugin.mapLabel(name)} is missing` });
    box.createEl("p", { text: `Its folder and map note (${this.plugin.mapStore.notePath(name)}) were deleted. Restore writes the note back from the last saved copy; Remove drops the map from the list. No file is deleted.` });
    renderMissingActions(box, this.plugin, name, () => this.renderGrid());
    return true;
  }

  private emptySlotOnMap(hex: string): boolean { return this.host.emptySlotOnMap(hex); }
  private applyTerrainToHexEl(hexEl: HTMLElement, terrain: string | null): void { this.host.applyTerrainToHexEl(hexEl, terrain); }

  // Double-click on the destination confirms the swap
  private onHexDblClick(_x: number, _y: number): void {
    // Path tool: a double-click is two clicks on one hex, and the second
    // one (on the active end) already finishes the branch.
  }

  renderGrid(
    terrainOverrides?: Map<string, string | null>,
    iconOverrides?: Map<string, string | null>,
    gmIconsOverrides?: Map<string, string[]>,
  ): void {
    if (!this.viewportEl) return;
    this.factionTooltipEl?.hide();
    this.viewportEl.empty();
    // A map whose note was deleted by hand (SM-DEL): a clear empty state
    // with Restore / Remove instead of an empty grid.
    if (this.renderMissingState()) return;

    const gap = this.plugin.settings.hexGap?.trim() || "0.15";
    this.viewportEl.style.setProperty(
      "--duckmage-hex-gap",
      /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap,
    );

    // Apply the coord-placement class so CSS can position HTML labels
    // top / middle / bottom inside the hex. The setting was previously
    // honoured only by the (now-removed) SVG coord-label copies; the
    // HTML labels need this class to know where to render.
    const placement = this.plugin.settings.coordPlacement ?? "bottom";
    this.viewportEl.removeClass(
      "duckmage-coord-top",
      "duckmage-coord-middle",
      "duckmage-coord-bottom",
    );
    this.viewportEl.addClass(`duckmage-coord-${placement}`);

    // Coord label size + font (settings → "Coordinate label"). Both flow
    // into CSS vars consumed by `.duckmage-coord-label-html`. Size is in em so it
    // scales with the hex; font family is one of Obsidian's CSS font vars.
    const coordFontSize = this.plugin.settings.coordFontSize ?? 0.8;
    const coordFontFamilyKey = this.plugin.settings.coordFontFamily ?? "interface";
    const coordFontFamily =
      coordFontFamilyKey === "monospace"
        ? "var(--font-monospace)"
        : coordFontFamilyKey === "serif"
          ? 'Georgia, Cambria, "Times New Roman", Times, serif'
          : "var(--font-interface)";
    const coordFontColor = this.plugin.settings.coordFontColor ?? "#ffffff";
    this.viewportEl.setCssProps({
      "--duckmage-coord-font-size": `${coordFontSize}em`,
      "--duckmage-coord-font-family": coordFontFamily,
      "--duckmage-coord-color": coordFontColor,
      // Halo opposite to the text colour: labels read on light terrain too.
      "--duckmage-coord-halo": coordHaloColor(coordFontColor),
    });

    const region = this.getActiveMap();

    // Background image layer (behind hex grid; shares the viewport's pan/zoom
    // transform via DOM nesting). Added first so it stacks under the grid.
    this.calibration.renderBackgroundImage(this.viewportEl, region);

    // Sync overlay checkboxes and CSS classes to the active region's saved state
    this.overlayPanel?.syncToRegion();

    const { cols, rows } = region.gridSize;
    const { x: ox, y: oy } = region.gridOffset;
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = hexBase
      ? `${hexBase}/${this.activeMapName}`
      : this.activeMapName;
    const palette = this.plugin.getMapPalette(this.activeMapName);
    // Index the palette by name once so `addHex` doesn't do a linear
    // `palette.find` per hex. Output identical; on a 30×20 map this is
    // ~600 fewer linear scans per renderGrid.
    const paletteByName = new Map(palette.map((p) => [p.name, p]));
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const owView = this.owView(region);
    const gridContainer = this.viewportEl.createDiv({
      cls: `duckmage-hex-map-grid${isFlat ? " duckmage-grid-flat" : ""}`,
    });
    // An overworld's Regions view shows only the regions (and blank bricks
    // where there's none yet): its own hexes stay as invisible click
    // targets, and their coordinates, names and badges are hidden (owner
    // playtest: "just show blank bricks rather than the hex one behind").
    const regionsView = owView === "regions";
    if (regionsView) {
      gridContainer.addClass("duckmage-ow-regions");
      // The region's name on hover, nothing drawn on the map. Once a frame,
      // read at the LAST pointer position (the first one of the frame left
      // a region's name up after the pointer had moved off it), and cleared
      // when the pointer leaves the grid.
      const hover = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
      const setTip = (tip: string) => { if (gridContainer.title !== tip) gridContainer.title = tip; };
      gridContainer.addEventListener("mousemove", (e) => {
        const { clientX, clientY } = e;
        hover.request(() => {
          const cell = this.overworldLayer?.cellAt(gridContainer, clientX, clientY) ?? null;
          const line = this.overworldLayer?.pathAt(gridContainer, clientX, clientY) ?? null;
          setTip(regionsViewTip(cell, {
            label: (r) => this.plugin.mapLabel(r),
            emptySlot: (h) => this.emptySlotOnMap(h),
            canAdd: canAdd(this.getActiveMap()),
            path: line?.names.join(", "),
          }));
        });
      });
      gridContainer.addEventListener("mouseleave", () => hover.request(() => setTip("")));
    } else if (owView === "biomes") {
      gridContainer.addClass("duckmage-ow-biomes");
      // A path between regions under the pointer: its name in the tooltip (O2).
      watchBiomesPathHover(gridContainer, (x, y) => this.overworldLayer?.pathAt(gridContainer, x, y)?.names.join(", "), (el, path) => this.labelHex(el, undefined, path));
    }

    // Apply optional independent grid transform (used for bg-image calibration).
    // Custom-property values default to identity in CSS when unset, so we
    // can safely write them unconditionally — no special-casing for the
    // un-calibrated default.
    this.calibration.applyGridLayerVars(gridContainer, region);

    if (this.calibration.active) this.calibration.attachGridCalibrationHandlers(gridContainer, region);

    // Pre-compute the set of existing hex notes for this map by walking the
    // hex folder's TFolder.children directly. Lets `addHex` check existence
    // via O(1) Set.has(path) instead of the per-hex
    // `vault.getAbstractFileByPath` round-trip. Output identical.
    const existingHexPaths = new Set<string>();
    const hexFolderObj = folder ? this.app.vault.getAbstractFileByPath(folder) : null;
    if (hexFolderObj instanceof TFolder) {
      for (const child of hexFolderObj.children) {
        if (child instanceof TFile && child.extension === "md") {
          existingHexPaths.add(child.path);
        }
      }
    }

    // Hexes the party has stood on (SF5): a mark the layers menu can hide.
    const visitedHexes = new Set(parseVisited(region.visited));
    const addHex = (parent: HTMLElement, x: number, y: number) => {
      const path = folder ? `${folder}/${hexKey(x, y)}.md` : `${hexKey(x, y)}.md`;
      const exists = existingHexPaths.has(path);
      // Fetch this hex's frontmatter ONCE; terrain/icon/gm-icons all derive
      // from it. Calling getTerrainFromFile + getIconOverrideFromFile +
      // getGmIconsFromFile separately would re-run getAbstractFileByPath +
      // getFileCache three times per hex (~11.5k redundant lookups on a
      // 3843-hex map).
      // Before the map store is ready (startup), fall back to frontmatter.
      const fromStore = this.plugin.mapStore.isReady();
      const fm = fromStore ? null : getFrontMatter(this.app, path);
      const stored = fromStore ? this.plugin.mapStore.get(this.activeMapName, hexKey(x, y)) : undefined;
      // A note this plugin just wrote may not be indexed yet; its terrain is
      // held in memory until it is.
      const terrainKey = terrainOverrides?.has(path)
        ? terrainOverrides.get(path)!
        : fromStore ? stored?.terrain ?? null
        : fm ? terrainFromFm(fm) : pendingTerrainOf(path);
      // Hexes with no terrain (often no note at all — notes are created on
      // use) show the map's base terrain, e.g. "void" on a system map.
      const ownTerrain = terrainKey != null ? paletteByName.get(terrainKey) : undefined;
      const baseEntry = !ownTerrain && region.baseTerrain ? paletteByName.get(region.baseTerrain) : undefined;
      const terrainEntry = ownTerrain ?? baseEntry;

      const hexEl = parent.createDiv({
        cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
        attr: { "data-x": String(x), "data-y": String(y) },
      });
      hexEl.tabIndex = -1;

      if (regionsView) {
        hexEl.addEventListener("click", (e) => {
          void this.onHexClick(x, y, e);
        });
        hexEl.addEventListener("contextmenu", (evt) => this.hexMenu.onHexContextMenu(evt, x, y));
        return;
      }

      this.setHexColor(hexEl, terrainEntry?.color);

      const iconOverride = iconOverrides?.has(path)
        ? iconOverrides.get(path)!
        : fromStore ? stored?.icon ?? null : iconOverrideFromFm(fm);
      if (iconOverride) {
        // Render terrain icon as hidden fallback — shown by CSS when overrides are off
        if (terrainEntry?.icon) {
          createIconEl(
            hexEl,
            getIconUrl(this.plugin, terrainEntry.icon),
            terrainEntry.name,
            terrainEntry.iconColor,
            "duckmage-hex-terrain-icon",
          );
        }
        // Render the override icon (primary, visible by default)
        createIconEl(
          hexEl,
          getIconUrl(this.plugin, iconOverride),
          terrainEntry?.name ?? "",
          undefined,
          "duckmage-hex-icon duckmage-hex-override-icon",
        );
        // Tag the hex so the SVG overlay can elevate this icon above roads/rivers
        hexEl.dataset.iconOverride = iconOverride;
      } else if (terrainEntry?.icon) {
        createIconEl(
          hexEl,
          getIconUrl(this.plugin, terrainEntry.icon),
          terrainEntry.name,
          terrainEntry.iconColor,
          "duckmage-hex-icon",
        );
      }

      // Tag hex for GM icon overlay (rendered in path SVG when GM layer is active)
      // GM icons stored as a JSON-encoded array on the dataset; allows
      // multiple icons per hex (with duplicates representing a count).
      // Empty list → no attribute at all so the overlay query still
      // matches only hexes that have GM content. The override path
      // bypasses the metadata-cache read so the editor's just-written
      // list lands on the dataset immediately, no race.
      const gmIcons = gmIconsOverrides?.has(path)
        ? gmIconsOverrides.get(path)!
        : fromStore ? [...(stored?.gmIcons ?? [])] : gmIconsFromFm(fm);
      if (gmIcons.length > 0) hexEl.dataset.gmIcons = JSON.stringify(gmIcons);

      if (this.selectedHex?.x === x && this.selectedHex?.y === y)
        hexEl.addClass("is-selected");
      if (visitedHexes.has(hexKey(x, y))) hexEl.addClass("duckmage-hex-visited");

      if (exists && !terrainEntry)
        hexEl.createSpan({ cls: "duckmage-hex-dot" });

      // Submap marker: shows which hexes drill down (a system in a sector,
      // a dungeon in a region). Clicking it enters the submap when no tool
      // is active; with a tool active the click falls through to the hex.
      // A Region map: a thin inner hex outline, except on an overworld
      // (either view), where every hex has a region and the outline says
      // nothing. Locations: the badge, with a count from two on; its
      // tooltip lists them.
      const legacySubmap: unknown = fromStore ? undefined : fm?.["duckmage-submap"];
      const regionMap = stored?.regionMap && this.plugin.getMap(stored.regionMap) ? stored.regionMap : undefined;
      const locations = (fromStore ? stored?.locations ?? [] : typeof legacySubmap === "string" && legacySubmap ? [legacySubmap] : [])
        .filter((m) => m !== regionMap && !!this.plugin.getMap(m));
      if (regionMap) {
        hexEl.addClass("duckmage-hex-has-region-map");
        if (!owView) hexEl.createSpan({
          cls: "duckmage-hex-region-outline",
          attr: { title: `Region: ${this.plugin.mapLabel(regionMap)} (Ctrl+click hex to enter)` },
        });
      }
      if (locations.length) {
        hexEl.addClass("duckmage-hex-has-submap");
        const names = locations.map((m) => this.plugin.mapLabel(m));
        const one = locations.length === 1;
        const title = one
          ? `Enter location: ${names[0]}${regionMap ? "" : " (Ctrl+click hex)"}`
          : `Locations: ${names.join(", ")} (click for the list)`;
        const badge = hexEl.createSpan({
          cls: "duckmage-hex-submap-badge" + (one ? "" : " has-count"),
          text: one ? "" : String(locations.length),
          attr: { title, "aria-label": title },
        });
        badge.addEventListener("click", (e) => {
          if (this.drawingMode) return;
          e.stopPropagation();
          if (one) this.navigateToMap(locations[0]);
          else this.openLocationsList(x, y);
        });
      }

      hexEl.addEventListener("click", (e) => {
        void this.onHexClick(x, y, e);
      });
      hexEl.addEventListener("dblclick", () => {
        void this.onHexDblClick(x, y);
      });
      hexEl.addEventListener("contextmenu", (evt) =>
        this.hexMenu.onHexContextMenu(evt, x, y),
      );
      if (region.showFactionOverlay && this.factionTooltipEl) {
        const tooltip = this.factionTooltipEl;
        hexEl.addEventListener("mouseenter", (e: MouseEvent) => {
          const factions = this.areas.getFactionLinksFromCache(path);
          if (factions.length === 0) { tooltip.hide(); return; }
          tooltip.empty();
          const factionsFolder = normalizeFolder(this.plugin.settings.factionsFolder);
          for (const name of factions) {
            const row = tooltip.createDiv({ cls: "duckmage-faction-tooltip-row" });
            const fPath = factionsFolder ? `${factionsFolder}/${name}.md` : `${name}.md`;
            const color = getFactionColorFromFile(this.app, fPath);
            const swatch = row.createSpan({ cls: "duckmage-faction-tooltip-swatch" });
            if (color) swatch.style.backgroundColor = color;
            row.createSpan({ text: name, cls: "duckmage-faction-tooltip-name" });
          }
          const containerRect = this.contentEl.getBoundingClientRect();
          tooltip.style.left = `${e.clientX - containerRect.left + 14}px`;
          tooltip.style.top = `${e.clientY - containerRect.top + 8}px`;
          tooltip.show();
        });
        hexEl.addEventListener("mouseleave", () => tooltip.hide());
      }
    };

    const stagger = this.getActiveStagger();
    const isStaggered = (n: number) =>
      stagger === "odd" ? n % 2 !== 0 : n % 2 === 0;

    if (isFlat) {
      // Flat-top: iterate columns; staggered columns shift down by half hex height
      for (let i = 0; i < cols; i++) {
        const x = ox + i;
        const colEl = gridContainer.createDiv({
          cls: `duckmage-hex-col${isStaggered(x) ? " duckmage-hex-col-offset" : ""}`,
        });
        for (let j = 0; j < rows; j++) {
          addHex(colEl, x, oy + j);
        }
      }
    } else {
      // Pointy-top: iterate rows; staggered rows shift right by half hex width
      for (let j = 0; j < rows; j++) {
        const y = oy + j;
        const rowEl = gridContainer.createDiv({
          cls: `duckmage-hex-row${isStaggered(y) ? " duckmage-hex-row-offset" : ""}`,
        });
        for (let i = 0; i < cols; i++) {
          addHex(rowEl, ox + i, y);
        }
      }
    }

    this.labels.refreshTerrainLegend();

    // Everything below measures hex positions. A grid that isn't laid out
    // yet (map tab in the background on plugin reload) measures 0 and would
    // put every label at 0,0, so wait until it has a size.
    this.cancelMeasuredLayers?.();
    this.labels.resetCoords();
    // whenSized may draw right away (the usual case): only keep the cancel
    // while it's still waiting, or later redraws (names, badges) think the
    // grid never got a size and skip (round 7: badge size didn't apply).
    let drawn = false;
    const cancel = whenSized(gridContainer, () => {
      drawn = true;
      this.cancelMeasuredLayers = null;
      if (gridContainer.isConnected) this.renderMeasuredLayers(gridContainer, region);
    });
    if (!drawn) this.cancelMeasuredLayers = cancel;
  }

  /** The layers placed from measured hex geometry (see renderGrid). */
  private renderMeasuredLayers(gridContainer: HTMLElement, region: MapData): void {
    this.snapshotShownTerrain(region);
    this.shadow.render(gridContainer, region);
    this.overworldLayer?.render(gridContainer, region);
    this.minimap?.render(this.contentEl, region);
    // The view switch or a hand-edited `mode:` may have changed what the bars say.
    this.toolbar.updateModeBar();
    this.refreshWorkModeBtn();
    this.pathLayer.renderPathOverlay(gridContainer);
    this.areas.renderRegionOverlay(gridContainer);
    this.areas.renderFactionOverlay(gridContainer);
    // Coord labels go LAST (and at z:10 in CSS) so they sit above the path
    // SVG, GM-icon overlay, faction overlay, and region overlay — paths
    // and icons can no longer cover up the hex coordinates.
    this.labels.renderCoordLabelsLayer(gridContainer);
    // Badges reuse the hex centres the coord labels just measured.
    this.labels.renderLinkBadges(gridContainer);
    // So does the uncharted marker (no layout reads of its own).
    renderUnchartedLayer(gridContainer, this.labels.coordPlacements, this.labels.coordGridSize, unchartedKeys(this.plugin.mapStore.all(this.activeMapName), moduleUnchartedKeys(this.plugin, this.activeMapName)));
    this.labels.drawHexNames(gridContainer);
    if (this.calibration.active) {
      this.calibration.renderCalibrationOutlines(gridContainer);
      this.calibration.applyCalibrationFocusStyles();
    }
    this.tokens.renderTokenLayer(gridContainer);
  }

  /** Remember a region map's terrain as drawn (see shownTerrain). */
  private snapshotShownTerrain(map: MapData): void {
    this.shownTerrain.clear();
    if (map.submapKind !== "region") return;
    const { x: ox, y: oy } = map.gridOffset, { cols, rows } = map.gridSize;
    for (let y = oy; y < oy + rows; y++) {
      for (let x = ox; x < ox + cols; x++) this.shownTerrain.set(hexKey(x, y), this.plugin.mapStore.get(map.name, hexKey(x, y))?.terrain ?? null);
    }
  }

  /** Repaint the hexes whose terrain changed since they were drawn (see shownTerrain). */
  private syncShownTerrain(): void {
    const map = this.activeMapName;
    const changes = terrainDiff(this.shownTerrain, (k) => this.plugin.mapStore.get(map, k)?.terrain);
    for (const [key, terrain] of changes) {
      this.shownTerrain.set(key, terrain);
      const [x, y] = key.split("_");
      const el = this.viewportEl?.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
      if (el) this.applyTerrainToHexEl(el, terrain);
    }
  }
}

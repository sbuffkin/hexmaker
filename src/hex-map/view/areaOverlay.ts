/**
 * The faction and region overlays (L2e, split out of HexMapView): painting
 * and erasing a hex's faction link / region, the edits not yet in the
 * metadata cache, drawing both overlays (shared shapes in areaShapes.ts),
 * the faction legend and region labels, and their undo strokes.
 */
import { TFile } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import {
  getFactionColorFromFile,
  getFactionStyleFromFile,
  getHexRegionFromFile,
  getRegionColorFromFile,
  getRegionStyleFromFile,
  setHexRegionInFile,
  type OverlayStyle,
} from "../../frontmatter";
import { addLinkToSection, removeLinkFromSection } from "../../sections";
import type { MapData } from "../../types";
import { normalizeFolder } from "../../utils";
import { renderHexPreview } from "../overlayPatternControls";
import type { DrawingMode } from "../toolMode";
import type { FactionUndoEntry, RegionUndoEntry } from "../undoItems";
import { areaLabelPlacement, buildAreaSvg } from "./areaShapes";
import type { UndoController } from "./undoController";
import { hexKey } from "../../hexKey";

export interface AreaOverlayHost {
  plugin: HexmakerPlugin;
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  getActiveMap(): MapData;
  drawingMode(): DrawingMode | null;
  isErasingMode(): boolean;
  /** The faction / region note the link tool paints. */
  paintFactionPath(): string | null;
  paintRegionPath(): string | null;
  /** The strokes being recorded for undo. */
  undos: Pick<UndoController, "currentFactionStroke" | "currentRegionStroke">;
}

export class AreaOverlay {
  // Faction links painted but not yet reflected in the metadata cache
  private pendingFactionLinks = new Map<string, Set<string>>();
  // Faction links erased but cache may still reflect them — excluded from overlay
  private erasedFactionLinks = new Map<string, Set<string>>();
  // Region painted/erased but not yet in metadata cache
  private pendingRegions = new Map<string, string>(); // hexPath → regionBasename
  private erasedRegions = new Set<string>();           // hexPaths with cleared region

  constructor(private host: AreaOverlayHost) {}

  /** The metadata cache has caught up with a note: drop its pending / erased entries. */
  cacheUpdated(path: string): void {
    this.pendingFactionLinks.delete(path);
    this.erasedFactionLinks.delete(path);
    this.pendingRegions.delete(path);
    this.erasedRegions.delete(path);
  }

  async onHexFactionPaintClick(x: number, y: number): Promise<void> {
    const paintPath = this.host.paintFactionPath();
    if (this.host.drawingMode() !== "factionLink" || !paintPath) return;
    if (this.host.isErasingMode()) { await this.onHexFactionEraseClick(x, y); return; }
    const hexPath = this.host.plugin.hexPath(x, y, this.host.activeMapName());
    const factionFile = this.host.plugin.app.vault.getAbstractFileByPath(paintPath);
    if (!(factionFile instanceof TFile)) return;

    const factionBasename = factionFile.basename;

    // Skip silently if already painted (pending or cache both use basenames now)
    if (this.getFactionLinksFromCache(hexPath).includes(factionBasename)) return;

    // Record for undo (first touch only — it was absent before this stroke)
    if (this.host.undos.currentFactionStroke && !this.host.undos.currentFactionStroke.has(hexPath + "\0" + factionBasename)) {
      this.host.undos.currentFactionStroke.set(hexPath + "\0" + factionBasename, {
        hexPath, factionBasename, factionFilePath: paintPath, wasPresent: false,
      });
    }

    // Update the overlay IMMEDIATELY (synchronous) — no awaits before this point
    // If this faction was previously erased (still in cache), un-erase it
    this.erasedFactionLinks.get(hexPath)?.delete(factionBasename);
    const pending = this.pendingFactionLinks.get(hexPath) ?? new Set<string>();
    pending.add(factionBasename);
    this.pendingFactionLinks.set(hexPath, pending);
    if (this.host.getActiveMap().showFactionOverlay) this.updateFactionOverlay();

    // Create hex note if it doesn't exist yet
    let hexFile = this.host.plugin.app.vault.getAbstractFileByPath(hexPath);
    if (!(hexFile instanceof TFile)) {
      hexFile = await this.host.plugin.createHexNote(x, y, this.host.activeMapName());
      if (!(hexFile instanceof TFile)) {
        // Note creation failed — revert pending entry
        this.pendingFactionLinks.get(hexPath)?.delete(factionBasename);
        return;
      }
    }

    const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(
      `[data-x="${x}"][data-y="${y}"]`,
    );
    if (hexEl) hexEl.addClass("duckmage-hex-exists");

    // Write the link in the background — addLinkToSection deduplicates internally
    const target = this.host.plugin.app.metadataCache.fileToLinktext(factionFile, hexPath);
    await addLinkToSection(this.host.plugin.app, hexPath, "Factions", `[[${target}]]`);
  }

  async onHexFactionEraseClick(x: number, y: number): Promise<void> {
    const paintPath = this.host.paintFactionPath();
    if (!paintPath) return;
    const factionFile = this.host.plugin.app.vault.getAbstractFileByPath(paintPath);
    if (!(factionFile instanceof TFile)) return;

    const factionBasename = factionFile.basename;
    const hexPath = this.host.plugin.hexPath(x, y, this.host.activeMapName());

    if (!this.getFactionLinksFromCache(hexPath).includes(factionBasename)) return;

    // Record for undo (first touch only — it was present before this stroke)
    if (this.host.undos.currentFactionStroke && !this.host.undos.currentFactionStroke.has(hexPath + "\0" + factionBasename)) {
      this.host.undos.currentFactionStroke.set(hexPath + "\0" + factionBasename, {
        hexPath, factionBasename, factionFilePath: paintPath, wasPresent: true,
      });
    }

    // Update overlay immediately (synchronous): remove from pending, add to erased
    this.pendingFactionLinks.get(hexPath)?.delete(factionBasename);
    const erased = this.erasedFactionLinks.get(hexPath) ?? new Set<string>();
    erased.add(factionBasename);
    this.erasedFactionLinks.set(hexPath, erased);
    if (this.host.getActiveMap().showFactionOverlay) this.updateFactionOverlay();

    // Remove from file in the background
    const target = this.host.plugin.app.metadataCache.fileToLinktext(factionFile, hexPath);
    await removeLinkFromSection(this.host.plugin.app, hexPath, "Factions", target);
  }

  getFactionLinksFromCache(hexFilePath: string): string[] {
    const file = this.host.plugin.app.vault.getAbstractFileByPath(hexFilePath);
    const fromCache: string[] = [];

    if (file instanceof TFile) {
      const cache = this.host.plugin.app.metadataCache.getFileCache(file);
      if (cache) {
        const headings = cache.headings ?? [];
        const factionHeading = headings.find(
          (h) => h.heading === "Factions" && h.level === 3,
        );
        if (factionHeading) {
          const factionStart = factionHeading.position.start.offset;
          const nextHeading = headings.find(
            (h) => h.position.start.offset > factionStart && h.level <= 3,
          );
          const factionEnd = nextHeading?.position.start.offset ?? Infinity;
          fromCache.push(
            ...(cache.links ?? [])
              .filter(
                (lk) =>
                  lk.position.start.offset > factionStart &&
                  lk.position.start.offset < factionEnd,
              )
              .map((lk) => {
                // Normalize to basename — fileToLinktext may return a path when names clash
                const raw = lk.link.split("|")[0].split("#")[0].trim();
                return raw.split("/").pop() ?? raw;
              }),
          );
        }
      }
    }

    const pending = this.pendingFactionLinks.get(hexFilePath);
    const erased = this.erasedFactionLinks.get(hexFilePath);

    const merged = new Set(fromCache);
    if (pending) for (const name of pending) merged.add(name);
    if (erased) for (const name of erased) merged.delete(name);
    return [...merged];
  }

  updateFactionOverlay(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderFactionOverlay(gridContainer);
  }

  clearFactionOverlay(): void {
    this.host.viewportEl()?.querySelector("svg.duckmage-faction-svg")?.remove();
    this.host.viewportEl()?.querySelector(".duckmage-faction-legend")?.remove();
  }

  renderFactionOverlay(gridContainer: HTMLElement): void {
    this.host.viewportEl()?.querySelector("svg.duckmage-faction-svg")?.remove();
    this.host.viewportEl()?.querySelector(".duckmage-faction-legend")?.remove();
    if (!this.host.getActiveMap().showFactionOverlay) return;

    const hexEls = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex"),
    );
    if (hexEls.length === 0) return;

    // ── Build faction color + style maps ──────────────────────────────────────
    const folder = normalizeFolder(this.host.plugin.settings.factionsFolder);
    const factionColorMap = new Map<string, string>();
    const factionStyleMap = new Map<string, OverlayStyle>();
    for (const f of this.host.plugin.app.vault.getMarkdownFiles()) {
      if (folder && !f.path.startsWith(folder + "/")) continue;
      const color = getFactionColorFromFile(this.host.plugin.app, f.path);
      if (color) {
        factionColorMap.set(f.basename, color);
        factionStyleMap.set(f.basename, getFactionStyleFromFile(this.host.plugin.app, f.path));
      }
    }

    // ── Group hexes by faction name ───────────────────────────────────────────
    const factionHexKeys = new Map<string, string[]>();
    for (const hexEl of hexEls) {
      const gx = Number(hexEl.dataset.x);
      const gy = Number(hexEl.dataset.y);
      const hexPath = this.host.plugin.hexPath(gx, gy, this.host.activeMapName());
      const links = this.getFactionLinksFromCache(hexPath);
      const key = hexKey(gx, gy);
      for (const link of links) {
        if (!factionHexKeys.has(link)) factionHexKeys.set(link, []);
        factionHexKeys.get(link)!.push(key);
      }
    }
    if (factionHexKeys.size === 0) return;

    const built = buildAreaSvg(
      gridContainer,
      hexEls,
      factionHexKeys,
      (name) => {
        const color = factionColorMap.get(name);
        return color ? { color, style: factionStyleMap.get(name) } : undefined;
      },
      { svgClass: "duckmage-faction-svg", pad: 20, patternPrefix: "dm-fac-pat", flat: this.host.plugin.settings.hexOrientation === "flat" },
    );
    if (!built) return;
    const { svg } = built;
    const activeFactions = built.drawn.map(({ name, color, style }) => ({ name, color, style }));

    // Insert before path SVG so roads/labels render on top. Anchored in
    // gridContainer so the overlay inherits the gridDisplay transform.
    const pathSvg = gridContainer.querySelector("svg.duckmage-path-svg");
    if (pathSvg) {
      gridContainer.insertBefore(svg, pathSvg);
    } else {
      gridContainer.appendChild(svg);
    }

    this.renderFactionLegend(activeFactions, gridContainer);
  }

  renderFactionLegend(
    factions: { name: string; color: string; style: OverlayStyle }[],
    gridContainer: HTMLElement,
  ): void {
    const viewportEl = this.host.viewportEl();
    if (!viewportEl) return;
    const legend = viewportEl.createDiv({ cls: "duckmage-faction-legend" });
    // Position the card to the right of the hex grid in the viewport canvas
    const gridRight = gridContainer.offsetLeft + gridContainer.offsetWidth;
    legend.style.left = `${gridRight + 24}px`;
    legend.style.top = `${gridContainer.offsetTop}px`;
    const orientation = this.host.plugin.settings.hexOrientation;
    const LEGEND_HEX_PX = 32;
    // Shrink the pattern so more repeats fit in the small swatch (the user's
    // scale slider is sized for on-map hexes, ~96 px wide).
    const LEGEND_PATTERN_MULT = LEGEND_HEX_PX / 96;
    for (const { name, color, style } of [...factions].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = legend.createDiv({ cls: "duckmage-faction-legend-row" });
      const swatch = row.createDiv({ cls: "duckmage-faction-legend-swatch" });
      renderHexPreview(swatch, {
        color,
        style,
        orientation,
        hexSizePx: LEGEND_HEX_PX,
        patternScaleMultiplier: LEGEND_PATTERN_MULT,
      });
      row.createSpan({ text: name, cls: "duckmage-faction-legend-name" });
    }
  }

  async onHexRegionPaintClick(x: number, y: number): Promise<void> {
    const paintPath = this.host.paintRegionPath();
    if (this.host.drawingMode() !== "regionLink" || !paintPath) return;
    if (this.host.isErasingMode()) { await this.onHexRegionEraseClick(x, y); return; }
    const regionFile = this.host.plugin.app.vault.getAbstractFileByPath(paintPath);
    if (!(regionFile instanceof TFile)) return;
    const regionBasename = regionFile.basename;
    const hexPath = this.host.plugin.hexPath(x, y, this.host.activeMapName());

    const oldRegion = this.getHexRegionFromCache(hexPath);
    if (oldRegion === regionBasename) return;

    // Record for undo (first touch only)
    if (this.host.undos.currentRegionStroke && !this.host.undos.currentRegionStroke.has(hexPath)) {
      this.host.undos.currentRegionStroke.set(hexPath, { hexPath, oldRegion, newRegion: regionBasename });
    } else {
      const existing = this.host.undos.currentRegionStroke?.get(hexPath);
      if (existing) existing.newRegion = regionBasename;
    }

    // Update pending state before await so overlay refreshes immediately
    this.erasedRegions.delete(hexPath);
    this.pendingRegions.set(hexPath, regionBasename);
    if (this.host.getActiveMap().showRegionOverlay) this.updateRegionOverlay();

    await setHexRegionInFile(this.host.plugin.app, hexPath, regionBasename);
    void this.host.plugin.syncHexRegionTableLink(hexPath, regionBasename);
  }

  async onHexRegionEraseClick(x: number, y: number): Promise<void> {
    const paintPath = this.host.paintRegionPath();
    if (!paintPath) return;
    const regionFile = this.host.plugin.app.vault.getAbstractFileByPath(paintPath);
    if (!(regionFile instanceof TFile)) return;
    const regionBasename = regionFile.basename;
    const hexPath = this.host.plugin.hexPath(x, y, this.host.activeMapName());

    const currentRegion = this.getHexRegionFromCache(hexPath);
    if (currentRegion !== regionBasename) return;

    // Record for undo (first touch only)
    if (this.host.undos.currentRegionStroke && !this.host.undos.currentRegionStroke.has(hexPath)) {
      this.host.undos.currentRegionStroke.set(hexPath, { hexPath, oldRegion: currentRegion, newRegion: null });
    } else {
      const existing = this.host.undos.currentRegionStroke?.get(hexPath);
      if (existing) existing.newRegion = null;
    }

    this.pendingRegions.delete(hexPath);
    this.erasedRegions.add(hexPath);
    if (this.host.getActiveMap().showRegionOverlay) this.updateRegionOverlay();

    await setHexRegionInFile(this.host.plugin.app, hexPath, null);
    void this.host.plugin.syncHexRegionTableLink(hexPath, null);
  }

  getHexRegionFromCache(hexFilePath: string): string | null {
    if (this.erasedRegions.has(hexFilePath)) return null;
    const pending = this.pendingRegions.get(hexFilePath);
    if (pending !== undefined) return pending;
    return getHexRegionFromFile(this.host.plugin.app, hexFilePath);
  }

  updateRegionOverlay(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (gridContainer) this.renderRegionOverlay(gridContainer);
  }

  clearRegionOverlay(): void {
    this.host.viewportEl()?.querySelector("svg.duckmage-region-svg")?.remove();
    this.host.viewportEl()?.querySelector(".duckmage-region-labels-layer")?.remove();
  }

  renderRegionOverlay(gridContainer: HTMLElement): void {
    this.host.viewportEl()?.querySelector("svg.duckmage-region-svg")?.remove();
    this.host.viewportEl()?.querySelector(".duckmage-region-labels-layer")?.remove();
    if (!this.host.getActiveMap().showRegionOverlay) return;

    const hexEls = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex"),
    );
    if (hexEls.length === 0) return;

    // ── Build region → hex keys map ─────────────────────────────────────────
    const regionHexKeys = new Map<string, string[]>();
    for (const hexEl of hexEls) {
      const gx = Number(hexEl.dataset.x);
      const gy = Number(hexEl.dataset.y);
      const hexFilePath = this.host.plugin.hexPath(gx, gy, this.host.activeMapName());
      const regionName = this.getHexRegionFromCache(hexFilePath);
      if (!regionName) continue;
      const key = hexKey(gx, gy);
      if (!regionHexKeys.has(regionName)) regionHexKeys.set(regionName, []);
      regionHexKeys.get(regionName)!.push(key);
    }
    if (regionHexKeys.size === 0) return;

    // ── Region color + style maps ───────────────────────────────────────────
    const folder = normalizeFolder(this.host.plugin.settings.regionsFolder);
    const regionColorMap = new Map<string, string>();
    const regionStyleMap = new Map<string, OverlayStyle>();
    for (const f of this.host.plugin.app.vault.getMarkdownFiles()) {
      if (f.basename.startsWith("_")) continue;
      if (folder && !f.path.startsWith(folder + "/")) continue;
      const color = getRegionColorFromFile(this.host.plugin.app, f.path);
      if (color) {
        regionColorMap.set(f.basename, color);
        regionStyleMap.set(f.basename, getRegionStyleFromFile(this.host.plugin.app, f.path));
      }
    }

    const built = buildAreaSvg(
      gridContainer,
      hexEls,
      regionHexKeys,
      (name) => {
        const color = regionColorMap.get(name);
        return color ? { color, style: regionStyleMap.get(name) } : undefined;
      },
      { svgClass: "duckmage-region-svg", pad: 40, patternPrefix: "dm-reg-pat", flat: this.host.plugin.settings.hexOrientation === "flat" },
    );
    if (!built) return;
    const { svg } = built;
    // Region labels are rendered as HTML (below), not SVG <text>: each
    // region's PCA-rotated name is a gridContainer-relative <div> placed in
    // % of the grid, so it tracks the em-based hex layout across font-size
    // changes (no slip-on-zoom, same reason coord labels left the SVG).
    const regionLabels = built.drawn.map((a) => ({ name: a.name, n: a.centers.length, ...areaLabelPlacement(a.centers) }));

    // Regions render below factions and paths. Anchored in gridContainer so
    // the overlay inherits the gridDisplay transform.
    const factionSvg = gridContainer.querySelector("svg.duckmage-faction-svg");
    const pathSvg = gridContainer.querySelector("svg.duckmage-path-svg");
    const insertBefore = factionSvg ?? pathSvg ?? null;
    if (insertBefore) {
      gridContainer.insertBefore(svg, insertBefore);
    } else {
      gridContainer.appendChild(svg);
    }

    // Region name labels — rendered as HTML inside gridContainer so they
    // ride the em-based grid layout instead of pixel-pinned SVG text.
    // The position is converted from gridContainer-local pixels (mx/my)
    // to percentages so the labels stay anchored when font-size mutates
    // during a bake-zoom transition. PCA rotation is preserved via the
    // CSS transform (rotation composed after the centering translate).
    if (regionLabels.length > 0) {
      const gw = gridContainer.offsetWidth || 1;
      const gh = gridContainer.offsetHeight || 1;
      const labelsLayer = gridContainer.createDiv({
        cls: "duckmage-region-labels-layer",
      });
      for (const lbl of regionLabels) {
        const fontSize = Math.round(Math.min(10 + 3 * Math.sqrt(lbl.n), 52));
        const el = labelsLayer.createDiv({
          cls: "duckmage-region-label",
          text: lbl.name,
        });
        const leftPct = (lbl.mx / gw) * 100;
        const topPct = (lbl.my / gh) * 100;
        el.setCssProps({
          "--duckmage-region-label-left": `${leftPct.toFixed(3)}%`,
          "--duckmage-region-label-top": `${topPct.toFixed(3)}%`,
          "--duckmage-region-label-angle": `${lbl.angle.toFixed(1)}deg`,
          "--duckmage-region-label-font-size": `${fontSize}px`,
        });
      }
    }
  }

  async applyFactionStroke(entries: FactionUndoEntry[], which: "old" | "new"): Promise<void> {
    for (const entry of entries) {
      const shouldBePresent = which === "old" ? entry.wasPresent : !entry.wasPresent;
      const factionFile = this.host.plugin.app.vault.getAbstractFileByPath(entry.factionFilePath);
      if (!(factionFile instanceof TFile)) continue;
      const target = this.host.plugin.app.metadataCache.fileToLinktext(factionFile, entry.hexPath);
      if (shouldBePresent) {
        this.erasedFactionLinks.get(entry.hexPath)?.delete(entry.factionBasename);
        const pending = this.pendingFactionLinks.get(entry.hexPath) ?? new Set<string>();
        pending.add(entry.factionBasename);
        this.pendingFactionLinks.set(entry.hexPath, pending);
        await addLinkToSection(this.host.plugin.app, entry.hexPath, "Factions", `[[${target}]]`);
      } else {
        this.pendingFactionLinks.get(entry.hexPath)?.delete(entry.factionBasename);
        const erased = this.erasedFactionLinks.get(entry.hexPath) ?? new Set<string>();
        erased.add(entry.factionBasename);
        this.erasedFactionLinks.set(entry.hexPath, erased);
        await removeLinkFromSection(this.host.plugin.app, entry.hexPath, "Factions", target);
      }
    }
    if (this.host.getActiveMap().showFactionOverlay) this.updateFactionOverlay();
  }

  async applyRegionStroke(entries: RegionUndoEntry[], which: "old" | "new"): Promise<void> {
    for (const entry of entries) {
      const region = which === "old" ? entry.oldRegion : entry.newRegion;
      if (region) {
        this.erasedRegions.delete(entry.hexPath);
        this.pendingRegions.set(entry.hexPath, region);
      } else {
        this.pendingRegions.delete(entry.hexPath);
        this.erasedRegions.add(entry.hexPath);
      }
      await setHexRegionInFile(this.host.plugin.app, entry.hexPath, region);
      void this.host.plugin.syncHexRegionTableLink(entry.hexPath, region);
    }
    if (this.host.getActiveMap().showRegionOverlay) this.updateRegionOverlay();
  }

}

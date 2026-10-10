import { App, Menu, Notice, TFolder } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { HexMapView } from "./HexMapView";
import { normalizeFolder, slugify, getIconUrl, createIconEl, importBinaryFileToVault } from "../utils";
import { renderMapExportForm } from "../export/MapExportModal";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import {
  listGenerators,
  saveGeneratorFromMap,
  generatorsForRegion,
  paletteColors,
  pathColors,
  type GeneratorFile,
  type GridSpec,
} from "../worldgen/generators";
import {
  BLANK_ID,
  describeKind,
  listGeneratorKinds,
  newMapGeneratorChoices,
  optionsWithDefaults,
  runGenerator,
  type GeneratedPath,
  type GenerateOutcome,
  type TerrainGeneratorKind,
} from "../worldgen/registry";
import { buildRegionContext } from "../worldgen/regionContext";
import { OVERLAND_ID, seaSideFromNeighbours } from "../worldgen/procedural/planetSurface";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "../worldgen/preview";
import { SIDES, hexRangeText, link, type Side } from "../worldgen/world";
import {
  detachRegion,
  gridRules,
  linkRegions,
  neighbourShadow,
  regionNeighbours,
  neighbourSpec,
  occupiedSides,
  placeNewRegion,
  regionNameAt,
  type NewRegion,
} from "../worldgen/neighbours";
import { randomSeed } from "../../packages/hex-wfc/src";
import { fillPaletteSelect } from "../palettes/paletteOptions";
import { hasFeature } from "../featureLevel";
import { renderAdvancedHint, renderAdvancedHints, withFeature } from "../advancedHints";
import { NewMapSetupModal } from "../worldgen/NewMapSetupModal";
import { buildMapTree, filterMapTree, nodeKey, treeContains, type MapTreeNode } from "../maps/mapTree";

/** A neighbour shadow as terrain by hex key (the faded seam in previews). */
function shadowTerrain(shadow: Map<string, { terrain?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, c] of shadow) if (c.terrain) out.set(k, c.terrain);
  return out;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"];

type ModalTab = "Maps" | "Properties" | "New map" | "Export";

export class MapModal extends HexmakerModal {
  private confirmingDelete: string | null = null;
  private stopKeepInViewport?: () => void;
  private stopFeatureChange?: () => void;
  private activeTab: ModalTab = "Maps";
  /** Set by "New region here" in Properties: prefills the New map tab's placement. */
  private newMapPlacement: { anchor: string; side: Side } | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private view: HexMapView,
    private onChanged: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Maps");
    this.makeDraggable();
    // Never taller than the window: the tab content scrolls and the modal
    // moves up as a tab grows (fresh-eyes r4: Export ran off the bottom).
    this.modalEl.addClass("duckmage-map-modal");
    this.stopKeepInViewport = this.keepInViewport();
    // A hint here can turn a feature on: show what it brings straight away.
    this.stopFeatureChange = this.plugin.onFeatureChange(() => this.render());
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-region-modal");

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: "duckmage-rt-mode-tabs duckmage-map-modal-tabs" });
    const tabNames: ModalTab[] = ["Maps", "Properties", "New map", "Export"];

    const contentDivs = new Map<ModalTab, HTMLElement>();
    for (const tab of tabNames) {
      const div = contentEl.createDiv({ cls: "duckmage-map-modal-tab-content" });
      contentDivs.set(tab, div);
      if (tab !== this.activeTab) div.hide();
    }

    const tabBtns = new Map<ModalTab, HTMLButtonElement>();
    for (const tab of tabNames) {
      const btn = tabBar.createEl("button", {
        text: tab,
        cls: "duckmage-rt-mode-tab" + (tab === this.activeTab ? " is-active" : ""),
      });
      tabBtns.set(tab, btn);
      btn.addEventListener("click", () => {
        this.activeTab = tab;
        for (const [t, div] of contentDivs) {
          if (t === tab) div.show(); else div.hide();
        }
        for (const [t, b] of tabBtns) {
          if (t === tab) b.addClass("is-active"); else b.removeClass("is-active");
        }
      });
    }

    this.renderMapsTab(contentDivs.get("Maps")!);
    this.renderPropertiesTab(contentDivs.get("Properties")!);
    this.renderNewMapTab(contentDivs.get("New map")!);
    this.renderExportTab(contentDivs.get("Export")!);
  }

  // ── Export tab ────────────────────────────────────────────────────────────

  private renderExportTab(el: HTMLElement): void {
    // The same form as the "Export current map…" command (MapExportModal).
    renderMapExportForm(el, this.plugin, this.view.activeMapName, { onExport: () => this.close() });
  }

  // ── Maps tab ──────────────────────────────────────────────────────────────

  /**
   * The map list as a tree (N4): submaps under their parent, neighbouring
   * regions grouped by world. Groups collapse; the open map is highlighted
   * and its branch kept open; a search box appears once the list is long.
   */
  private renderMapsTab(el: HTMLElement): void {
    const maps = this.plugin.settings.maps;
    const tree = buildMapTree(maps, (n) => this.plugin.parentOf(n)?.map);
    const long = maps.length > MapModal.SEARCH_FROM;
    let query = MapModal.lastQuery;
    if (long) {
      const search = el.createEl("input", {
        type: "search",
        cls: "duckmage-map-tree-search",
        attr: { placeholder: "Find a map…", "aria-label": "Find a map" },
      });
      search.value = query;
      search.addEventListener("input", () => {
        query = MapModal.lastQuery = search.value;
        draw();
      });
      window.setTimeout(() => search.focus(), 0);
    }
    const list = el.createEl("ul", { cls: "duckmage-region-list duckmage-map-tree" });
    const draw = () => {
      list.empty();
      const shown = filterMapTree(tree, long ? query : "");
      if (!shown.length) list.createEl("li", { cls: "duckmage-map-origin-desc", text: "No map matches." });
      for (const node of shown) this.renderTreeNode(list, node, !!query.trim() && long);
    };
    draw();
    // Deleting lives in Properties (with a confirm), away from the names
    // you click to switch maps (fresh-eyes r4: a ✕ beside every name).
    el.createEl("p", {
      cls: "duckmage-map-origin-desc duckmage-map-list-hint",
      text: "Click a name to open that map. Rename or delete the open map in its properties tab.",
    });
  }

  /** Show a search box above the map list once it has more maps than this. */
  private static readonly SEARCH_FROM = 10;
  /** Collapsed/expanded by the user this session, by node key. */
  private static expanded = new Map<string, boolean>();
  private static lastQuery = "";

  private renderTreeNode(parentEl: HTMLElement, node: MapTreeNode, filtering: boolean): void {
    const active = this.view.activeMapName;
    const li = parentEl.createEl("li", { cls: "duckmage-map-tree-node" });
    const key = nodeKey(node);
    const hasKids = node.children.length > 0;
    // Default: open on the open map's branch, and everywhere in a short list.
    const defaultOpen = treeContains(node, active) || this.plugin.settings.maps.length <= 12;
    const open = filtering || (MapModal.expanded.get(key) ?? defaultOpen);
    const toggleTo = (to: boolean) => {
      MapModal.expanded.set(key, to);
      this.rerenderMapsTab();
    };

    if (node.kind === "world") {
      const row = li.createDiv({ cls: "duckmage-region-item duckmage-map-tree-world" });
      this.renderTreeToggle(row, open, () => toggleTo(!open), true);
      row.createSpan({ cls: "duckmage-map-tree-world-label", text: `Neighbours: ${node.label}` });
      row.setAttr("title", "Neighbouring regions: one world, side by side");
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".duckmage-map-tree-toggle")) return;
        toggleTo(!open);
      });
    } else {
      this.renderMapRow(li, node, open, hasKids, () => toggleTo(!open));
    }
    if (hasKids && open) {
      const ul = li.createEl("ul", { cls: "duckmage-region-list duckmage-map-tree-children" });
      for (const c of node.children) this.renderTreeNode(ul, c, filtering);
    }
  }

  private renderTreeToggle(row: HTMLElement, open: boolean, onToggle: () => void, show: boolean): void {
    const t = row.createSpan({ cls: "duckmage-map-tree-toggle", text: show ? (open ? "▾" : "▸") : "" });
    if (!show) return;
    t.setAttr("role", "button");
    t.setAttr("aria-label", open ? "Collapse" : "Expand");
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle();
    });
  }

  private rerenderMapsTab(): void {
    const tabEl = this.contentEl.querySelector<HTMLElement>(".duckmage-map-tree")?.parentElement;
    if (!tabEl) return this.render();
    tabEl.empty();
    this.renderMapsTab(tabEl);
  }

  private renderMapRow(li: HTMLElement, node: Extract<MapTreeNode, { kind: "map" }>, open: boolean, hasKids: boolean, onToggle: () => void): void {
    const map = this.plugin.getMap(node.name);
    if (!map) return;
    {
      const isActive = map.name === this.view.activeMapName;

      const row = li.createDiv({
        cls: "duckmage-region-item duckmage-map-list-item" + (isActive ? " is-active" : ""),
      });
      if (isActive) row.setAttr("aria-current", "true");
      this.renderTreeToggle(row, open, onToggle, hasKids);
      row.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        const at = { x: e.clientX, y: e.clientY };
        // A region that already has a generator opens it; learning another
        // stays available below.
        void listGenerators(this.plugin).then((all) => {
          const existing = generatorsForRegion(all, map.name)[0];
          const menu = new Menu();
          if (existing) {
            menu.addItem((item) =>
              item
                .setTitle(`Open generator "${existing.model.name}"`)
                .setIcon("wand-sparkles")
                .onClick(() => void this.openGenerator(map.name, existing)),
            );
          }
          menu.addItem((item) =>
            item
              .setTitle(existing ? `Learn a new generator from ${map.name}` : `Create generator from ${map.name}`)
              .setIcon(existing ? "plus" : "wand-sparkles")
              .onClick(() => void this.createGeneratorFrom(map.name)),
          );
          menu.showAtPosition(at);
        });
      });

      const terrainEntry = map.terrainType
        ? this.plugin.getMapPalette(map.name).find((t) => t.name === map.terrainType)
        : undefined;
      const swatch = row.createSpan({ cls: "duckmage-map-terrain-swatch" });
      if (terrainEntry?.color) {
        swatch.style.backgroundColor = terrainEntry.color;
        swatch.addClass("duckmage-map-terrain-swatch--set");
      }

      const nameSpan = row.createSpan({ text: node.label, cls: "duckmage-map-list-name" });
      // The slug is the folder; worth seeing when it differs from the name.
      if (node.label !== map.name) nameSpan.setAttr("title", `Folder: ${map.name}`);
      nameSpan.addEventListener("click", () => {
        this.view.switchMapFromModal(map.name);
        this.close();
      });
      row.createSpan({ cls: "duckmage-region-palette-badge", text: map.paletteName });
    }
  }

  // ── Properties tab ────────────────────────────────────────────────────────

  private renderPropertiesTab(el: HTMLElement): void {
    const currentMap = this.plugin.getMap(this.view.activeMapName);

    // Name (display only: nothing moves) and folder name (the slug; moves
    // the folder and map note, and updates every reference).
    el.createEl("h4", { text: "Name" });
    const nameRow = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      value: this.plugin.mapLabel(this.view.activeMapName),
      attr: { "aria-label": "Map name" },
    });
    const nameBtn = nameRow.createEl("button", { text: "Save name", cls: "mod-cta" });
    const saveName = () => {
      const typed = nameInput.value.trim();
      if (!typed || typed === this.plugin.mapLabel(this.view.activeMapName)) return;
      void this.plugin.setMapDisplayName(this.view.activeMapName, typed).then(() => {
        new Notice(`Renamed to "${this.plugin.mapLabel(this.view.activeMapName)}".`);
        this.onChanged();
        this.render();
      });
    };
    nameBtn.addEventListener("click", saveName);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") saveName();
    });
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Shown everywhere. Its folder stays put." });

    el.createEl("h4", { text: "Folder name" });
    const renameRow = el.createDiv({ cls: "duckmage-region-row" });
    const renameInput = renameRow.createEl("input", {
      type: "text",
      value: this.view.activeMapName,
      attr: { "aria-label": "Folder name" },
    });
    const renameBtn = renameRow.createEl("button", { text: "Rename folder" });
    renameBtn.addEventListener("click", () =>
      void this.renameMap(renameInput.value.trim(), renameBtn, renameInput),
    );
    renameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter")
        void this.renameMap(renameInput.value.trim(), renameBtn, renameInput);
    });

    // Stagger offset
    el.createEl("h4", { text: "Stagger offset" });
    const staggerRow = el.createDiv({ cls: "duckmage-region-row" });
    let propStaggerVal: "odd" | "even" = currentMap?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    const propStaggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    propStaggerBtn.setText(propStaggerVal === "odd" ? "Odd" : "Even");
    propStaggerBtn.toggleClass("is-even", propStaggerVal === "even");
    // A map with neighbours can't flip its stagger: its seams would stop lining up.
    const hasNeighbours = !!currentMap && Object.keys(regionNeighbours(this.plugin, currentMap.name)).length > 0;
    if (hasNeighbours) {
      propStaggerBtn.disabled = true;
      staggerRow.createSpan({ text: "Fixed while this map has neighbouring regions (it has to line up with them).", cls: "duckmage-map-origin-desc" });
    }
    propStaggerBtn.addEventListener("click", () => {
      if (!currentMap || hasNeighbours) return;
      propStaggerVal = propStaggerVal === "odd" ? "even" : "odd";
      propStaggerBtn.setText(propStaggerVal === "odd" ? "Odd" : "Even");
      propStaggerBtn.toggleClass("is-even", propStaggerVal === "even");
      currentMap.staggerOffset = propStaggerVal;
      void this.plugin.saveSettings().then(() => this.onChanged());
    });

    if (currentMap) this.renderNeighbourBlock(el, currentMap);

    // Terrain theme
    el.createEl("h4", { text: "Terrain theme" });
    const terrainPalette = this.plugin.getMapPalette(this.view.activeMapName);
    const terrainGrid = el.createDiv({ cls: "duckmage-terrain-picker" });

    const clearTile = terrainGrid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-clear" +
        (!currentMap?.terrainType ? " is-selected" : ""),
    });
    clearTile.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
    clearTile.createSpan({ text: "None", cls: "duckmage-terrain-option-name" });
    clearTile.addEventListener("click", () => {
      const map = this.plugin.getMap(this.view.activeMapName);
      if (map) {
        map.terrainType = undefined;
        void this.plugin.saveSettings().then(() => this.render());
      }
    });

    for (const t of terrainPalette) {
      const tile = terrainGrid.createDiv({
        cls: "duckmage-terrain-option" +
          (currentMap?.terrainType === t.name ? " is-selected" : ""),
      });
      const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
      preview.setCssProps({ "--duckmage-bg": t.color });
      if (t.icon) {
        createIconEl(
          preview,
          getIconUrl(this.plugin, t.icon),
          t.name,
          t.iconColor,
          "duckmage-terrain-preview-icon",
        );
      }
      tile.createSpan({ text: t.name, cls: "duckmage-terrain-option-name" });
      tile.addEventListener("click", () => {
        const map = this.plugin.getMap(this.view.activeMapName);
        if (map) {
          map.terrainType = t.name;
          void this.plugin.saveSettings().then(() => this.render());
        }
      });
    }

    // ── Background image ───────────────────────────────────────────────────
    el.createEl("h4", { text: "Background image" });
    const bgRow = el.createDiv({ cls: "duckmage-region-row duckmage-bg-image-row" });
    bgRow.createSpan({
      text: currentMap?.backgroundImage?.path ?? "(none) — drop an image here",
      cls: "duckmage-bg-image-path",
    });
    const pickBtn = bgRow.createEl("button", { text: "Pick image…" });
    pickBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(
        this.app,
        this.plugin,
        (file) => this.setActiveMapBackground(file.path),
        "", // whole vault
        IMAGE_EXTENSIONS,
      ).open();
    });
    const clearBtn = bgRow.createEl("button", { text: "Clear" });
    clearBtn.disabled = !currentMap?.backgroundImage;
    clearBtn.addEventListener("click", () => {
      const map = this.plugin.getMap(this.view.activeMapName);
      if (!map) return;
      map.backgroundImage = undefined;
      void this.plugin.saveSettings().then(() => {
        this.onChanged();
        this.render();
      });
    });
    this.attachImageDropZone(bgRow, async (file) => {
      const mapName = this.view.activeMapName;
      const dest = this.bgImportFolder(mapName);
      const path = await importBinaryFileToVault(this.plugin, file, dest);
      this.setActiveMapBackground(path);
    });

    if (currentMap?.backgroundImage) {
      const bg = currentMap.backgroundImage;
      const opacityRow = el.createDiv({ cls: "duckmage-region-row" });
      opacityRow.createSpan({ text: "Opacity", cls: "duckmage-map-field-label" });
      const opacitySlider = opacityRow.createEl("input", { type: "range" });
      opacitySlider.min = "0.1";
      opacitySlider.max = "1";
      opacitySlider.step = "0.05";
      opacitySlider.value = String(bg.opacity ?? 1);
      opacitySlider.addEventListener("input", () => {
        const map = this.plugin.getMap(this.view.activeMapName);
        if (!map?.backgroundImage) return;
        map.backgroundImage.opacity = parseFloat(opacitySlider.value);
        void this.plugin.saveSettings().then(() => this.onChanged());
      });

      const calibrateBtn = el.createEl("button", {
        text: "Calibrate position & scale",
        cls: "mod-cta",
      });
      calibrateBtn.addEventListener("click", () => {
        this.close();
        this.view.enterBgCalibration();
      });
    }

    if (currentMap) this.renderDeleteBlock(el, currentMap.name);
  }

  /**
   * Delete the open map: at the bottom of Properties, behind a confirm, so
   * it can't be hit by accident from the map list.
   */
  private renderDeleteBlock(el: HTMLElement, name: string): void {
    el.createEl("h4", { text: "Delete map" });
    if (this.plugin.settings.maps.length <= 1) {
      el.createEl("p", { text: "This is the only map, so it can't be deleted.", cls: "duckmage-map-origin-desc" });
      return;
    }
    const box = el.createDiv({ cls: "duckmage-map-delete-block" });
    if (this.confirmingDelete !== name) {
      box.createEl("p", {
        text: `Moves "${this.plugin.mapLabel(name)}" (its folder, map note and hex notes) to the trash and removes it from the map list.`,
        cls: "duckmage-map-origin-desc",
      });
      box.createEl("button", { text: `Delete "${this.plugin.mapLabel(name)}"…` }).addEventListener("click", () => {
        this.confirmingDelete = name;
        this.render();
      });
      return;
    }
    box.addClass("duckmage-map-item-confirming");
    box.createSpan({
      cls: "duckmage-map-delete-warning",
      text: `Delete "${this.plugin.mapLabel(name)}"? This will trash all its hex notes.`,
    });
    box.createEl("button", { text: "Delete", cls: "mod-warning duckmage-map-confirm-btn" })
      .addEventListener("click", () => void this.deleteMap(name));
    box.createEl("button", { text: "Cancel", cls: "duckmage-map-cancel-btn" }).addEventListener("click", () => {
      this.confirmingDelete = null;
      this.render();
    });
  }

  /**
   * Neighbouring regions: which map is north, east, south and west of this
   * one on their shared grid. Only maps that fit (same size and palette,
   * lining up, slot free) are offered; an empty side can get a new region.
   */
  private renderNeighbourBlock(el: HTMLElement, map: MapData): void {
    // An Advanced feature; a map that's already linked keeps showing its links.
    if (!hasFeature(this.plugin.settings, "regions") && !map.world) {
      renderAdvancedHint(el, this.plugin, "regions", "map-properties",
        "Join this map edge to edge with others into one big world, and walk from one into the next: neighbouring regions.");
      return;
    }
    el.createEl("h4", { text: "Neighbouring regions" });
    el.createEl("p", {
      text: "Regions next to each other share one grid: walking off this map's edge (or the hex flower) leads into them. They must be the same size and use the same palette.",
      cls: "duckmage-map-origin-desc",
    });
    const current = regionNeighbours(this.plugin, map.name);
    const rules = gridRules(this.plugin);
    const grid = el.createDiv({ cls: "duckmage-neighbour-grid" });
    for (const side of SIDES) {
      const row = grid.createDiv({ cls: "duckmage-region-row duckmage-neighbour-row" });
      row.createSpan({ text: side[0].toUpperCase() + side.slice(1), cls: "duckmage-map-origin-label" });
      const select = row.createEl("select");
      select.createEl("option", { value: "", text: "None" });
      const now = current[side];
      if (now) select.createEl("option", { value: now.name, text: this.plugin.mapLabel(now.name) });
      for (const other of this.plugin.settings.maps) {
        if (other.name === map.name || other.name === now?.name) continue;
        if (link(this.plugin.settings.maps, map.name, side, other.name, rules, () => "check").ok)
          select.createEl("option", { value: other.name, text: this.plugin.mapLabel(other.name) });
      }
      select.value = now?.name ?? "";
      select.addEventListener("change", () => {
        void (async () => {
          if (now && select.value !== now.name) await detachRegion(this.plugin, now.name);
          if (select.value) {
            const r = await linkRegions(this.plugin, map.name, side, select.value);
            if (!r.ok) new Notice(r.reason);
          }
          this.onChanged();
          this.render();
        })();
      });
      if (!now) {
        const add = row.createEl("button", { text: "New region here…", attr: { title: `Make a new map ${side} of ${this.plugin.mapLabel(map.name)}` } });
        add.addEventListener("click", () => {
          this.newMapPlacement = { anchor: map.name, side };
          this.activeTab = "New map";
          this.render();
        });
      }
    }
    if (map.world) {
      const leave = el.createDiv({ cls: "duckmage-region-row" }).createEl("button", { text: "Detach from its neighbours" });
      leave.addEventListener("click", () => {
        void detachRegion(this.plugin, map.name).then(() => {
          this.onChanged();
          this.render();
        });
      });
    }
  }

  /** Compute the folder where dropped bg images should land for a given map. */
  private bgImportFolder(mapName: string): string {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const base = hexFolder ? `${hexFolder}/${mapName}` : mapName;
    return `${base}/_bg`;
  }

  /**
   * Set the active map's bg image and drop the user straight into calibration
   * mode. A freshly-added background almost always needs calibration anyway —
   * no point making the user click through another button. Caller still gets
   * the option to cancel calibration (Esc / ✓ button).
   */
  private setActiveMapBackground(path: string): void {
    const map = this.plugin.getMap(this.view.activeMapName);
    if (!map) return;
    map.backgroundImage = {
      path,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
    };
    void this.plugin.saveSettings().then(() => {
      this.onChanged();
      this.close();
      this.view.enterBgCalibration();
    });
  }

  /**
   * Make `el` a drop target for an image file. Calls `onFile` with the first
   * image dropped. Adds/removes the `is-drop-target` class for visual feedback.
   */
  private attachImageDropZone(
    el: HTMLElement,
    onFile: (file: File) => Promise<void>,
  ): void {
    el.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", () => {
      el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      el.removeClass("is-drop-target");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        new Notice("Dropped file isn't an image.");
        return;
      }
      void onFile(file).catch((err) => {
        new Notice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  // ── New map tab ───────────────────────────────────────────────────────────

  private renderNewMapTab(el: HTMLElement): void {
    // Guided setup: the same modal used for new submaps — palette, size,
    // any generator (incl. Star scatter / Orbits), base terrain, preview.
    const guided = el.createDiv({ cls: "duckmage-region-row duckmage-map-guided-row" });
    // Guided setup takes what's already filled in here (name, neighbour),
    // so switching to it never starts over.
    const openGuided = () => {
      const anchor = anchorSelect.value;
      new NewMapSetupModal(this.app, this.plugin, ({ name }) => {
        this.view.switchMapFromModal(name);
        this.onChanged();
      }, undefined, {
        name: nameInput.value.trim() || undefined,
        anchor: anchor || undefined,
        side: anchor ? (sideSelect.value as Side) : undefined,
      }).open();
      this.close();
    };
    guided.createEl("button", { text: "Guided setup…" }).addEventListener("click", openGuided);
    guided.createSpan({
      cls: "setting-item-description",
      text: "A bigger live preview and each generator's options (sea side, climate…), or fill in the form below. What you fill in here carries over.",
    });

    // Name
    el.createEl("label", { text: "Name", cls: "duckmage-map-field-label", attr: { for: "duckmage-new-map-name" } });
    const nameRow = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      placeholder: "Map name",
      cls: "duckmage-map-new-name-input",
      attr: { id: "duckmage-new-map-name" },
    });

    // Place next to an existing map: it becomes a neighbouring region on the
    // same grid, so size, palette, stagger and coordinates follow from it.
    // Neighbouring regions are an Advanced feature (hidden in Simple; the
    // "More options" hint under Palette offers it).
    const placeBox = el.createDiv();
    if (!hasFeature(this.plugin.settings, "regions")) placeBox.hide();
    placeBox.createEl("label", { text: "Place next to", cls: "duckmage-map-field-label", attr: { for: "duckmage-new-map-anchor" } });
    placeBox.createEl("p", {
      text: "Make this map a neighbouring region of another: it's the same size and palette, and lines up with it hex for hex.",
      cls: "duckmage-map-origin-desc",
    });
    const placeRow = placeBox.createDiv({ cls: "duckmage-region-row" });
    const anchorSelect = placeRow.createEl("select", { attr: { id: "duckmage-new-map-anchor", "aria-label": "Neighbouring map" } });
    anchorSelect.createEl("option", { value: "", text: "Nowhere (a separate map)" });
    for (const m of this.plugin.settings.maps) anchorSelect.createEl("option", { value: m.name, text: this.plugin.mapLabel(m.name) });
    const sideSelect = placeRow.createEl("select", { attr: { "aria-label": "Side of the neighbouring map" } });
    for (const s of SIDES) sideSelect.createEl("option", { value: s, text: `${s} of it` });
    const placeNote = placeBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    if (this.newMapPlacement) {
      anchorSelect.value = this.newMapPlacement.anchor;
      sideSelect.value = this.newMapPlacement.side;
      this.newMapPlacement = null;
    }

    // Size
    el.createEl("label", { text: "Size", cls: "duckmage-map-field-label", attr: { for: "duckmage-new-map-cols" } });
    const sizeRow = el.createDiv({ cls: "duckmage-region-row" });
    const colsInput = sizeRow.createEl("input", {
      type: "number",
      value: String(this.plugin.settings.defaultNewMapCols ?? 20),
      attr: { id: "duckmage-new-map-cols", "aria-label": "Columns" },
    });
    colsInput.setCssProps({ width: "65px" });
    sizeRow.createSpan({ text: "cols ×", cls: "duckmage-map-size-sep" });
    const rowsInput = sizeRow.createEl("input", {
      type: "number",
      value: String(this.plugin.settings.defaultNewMapRows ?? 16),
      attr: { "aria-label": "Rows" },
    });
    rowsInput.setCssProps({ width: "65px" });
    sizeRow.createSpan({ text: "rows", cls: "duckmage-map-size-sep" });

    // Presets
    el.createEl("label", { text: "Presets", cls: "duckmage-map-field-label" });
    const presetsRow = el.createDiv({ cls: "duckmage-region-row duckmage-map-presets-row" });
    const presets: [string, number, number][] = [
      ["Small", 5, 5],
      ["Medium", 15, 15],
      ["Large", 25, 20],
    ];
    for (const [label, cols, rows] of presets) {
      const btn = presetsRow.createEl("button", { text: `${label} (${cols}×${rows})` });
      btn.addEventListener("click", () => {
        colsInput.value = String(cols);
        rowsInput.value = String(rows);
      });
    }

    // Palette
    el.createEl("label", { text: "Palette", cls: "duckmage-map-field-label", attr: { for: "duckmage-new-map-palette" } });
    const paletteRow = el.createDiv({ cls: "duckmage-region-row" });
    const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-map-new-palette-select", attr: { id: "duckmage-new-map-palette" } });
    fillPaletteSelect(this.plugin, paletteSelect);
    // Everything New map hides in Simple, as one line rather than a stack.
    renderAdvancedHints(el, this.plugin, [
      { feature: "generators", text: "Fill a new map with generated terrain instead of painting it all by hand." },
      { feature: "palettes", text: "Design your own palette: its terrains, colours and icons, and the paths you can draw." },
      { feature: "regions", text: "Place a new map next to an existing one, so they join into one world." },
    ], "new-map-more");

    // Generator (optional): Blank, the built-in procedural ones (Overland,
    // Star scatter… as the map types on allow) and learned ones — whichever
    // fit the chosen palette (fresh-eyes r5: Overland used to hide behind a
    // button). Guided setup adds each generator's options and a big preview.
    el.createEl("label", { text: "Generator", cls: "duckmage-map-field-label", attr: { for: "duckmage-new-map-generator" } });
    el.createEl("p", {
      text: "Fill the new map with generated terrain, or leave it blank. Built-in generators use their default options here; Guided setup lets you set them (sea side, climate…). Next to a map, generators marked ↔ continue its edge.",
      cls: "duckmage-map-origin-desc",
    });
    const generatorRow = el.createDiv({ cls: "duckmage-region-row" });
    const generatorSelect = generatorRow.createEl("select", {
      cls: "duckmage-map-new-palette-select",
      attr: { id: "duckmage-new-map-generator" },
    });
    const generatorDesc = el.createEl("p", { cls: "duckmage-map-origin-desc duckmage-map-generator-desc" });
    let kinds: TerrainGeneratorKind[] = [];
    // Set by applyPlacement (declared further down; read lazily).
    let placement: NewRegion | null = null;
    const fillGenerators = () => {
      const current = generatorSelect.value;
      generatorSelect.empty();
      const terrains = this.plugin.getPaletteOrPresetTerrains(paletteSelect.value);
      const offered = newMapGeneratorChoices(kinds, this.plugin.settings, terrains, current, !!placement);
      generatorSelect.createEl("option", { value: "", text: "Blank" });
      for (const k of offered) {
        const seam = placement && k.continuesNeighbours ? " ↔" : "";
        generatorSelect.createEl("option", { value: k.id, text: `${k.label}${k.source === "learned" ? " (learned)" : ""}${seam}` });
      }
      generatorSelect.value = offered.some((k) => k.id === current) ? current : "";
      syncGeneratorDesc();
    };
    const syncGeneratorDesc = () => {
      const k = selectedGenerator();
      generatorDesc.setText(k ? describeKind(k, this.plugin.getPaletteOrPresetTerrains(paletteSelect.value)) : "");
      generatorDesc.toggle(!!k);
    };
    generatorSelect.createEl("option", { value: "", text: "Blank" });
    generatorDesc.hide();
    generatorSelect.addEventListener("change", syncGeneratorDesc);
    paletteSelect.addEventListener("change", fillGenerators);
    void listGeneratorKinds(this.plugin).then((list) => {
      kinds = list;
      fillGenerators();
    });

    // Preview of the generated terrain; Create uses exactly this seed.
    const previewBox = el.createDiv({ cls: "duckmage-wfc-section" });
    const previewCanvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const previewStatus = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const seedRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = seedRow.createEl("input", { type: "number", value: String(randomSeed()), cls: "duckmage-wfc-seed" });
    const rerollBtn = seedRow.createEl("button", { text: "Re-roll" });
    const previewBtn = seedRow.createEl("button", { text: "Preview" });
    previewBox.hide();

    // Stagger offset
    el.createEl("label", { text: "Stagger offset", cls: "duckmage-map-field-label" });
    const staggerRow = el.createDiv({ cls: "duckmage-region-row" });
    let staggerVal: "odd" | "even" = this.plugin.settings.staggerOffset ?? "odd";
    const staggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
    staggerBtn.toggleClass("is-even", staggerVal === "even");
    staggerBtn.addEventListener("click", () => {
      staggerVal = staggerVal === "odd" ? "even" : "odd";
      staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
      staggerBtn.toggleClass("is-even", staggerVal === "even");
    });

    // Starting coordinates
    el.createEl("label", { text: "Starting coordinates", cls: "duckmage-map-field-label" });
    el.createEl("p", {
      text: "Hex labels and filenames start from these values instead of 0,0.",
      cls: "duckmage-map-origin-desc",
    });
    const originRow = el.createDiv({ cls: "duckmage-region-row" });
    originRow.createSpan({ text: "X", cls: "duckmage-map-origin-label" });
    const originXInput = originRow.createEl("input", { type: "number", value: "0" });
    originXInput.setCssProps({ width: "70px" });
    originRow.createSpan({ text: "Y", cls: "duckmage-map-origin-label" });
    const originYInput = originRow.createEl("input", { type: "number", value: "0" });
    originYInput.setCssProps({ width: "70px" });

    // Background image (optional). User can either pick an existing vault file
    // (path captured locally) or drop a file from the OS (captured as a File;
    // imported into the new map's _bg folder after create).
    el.createEl("label", { text: "Background image (optional)", cls: "duckmage-map-field-label" });
    let pendingBgPath: string | null = null;
    let pendingBgFile: File | null = null;
    const bgRow = el.createDiv({ cls: "duckmage-region-row duckmage-bg-image-row" });
    const bgPathLabel = bgRow.createSpan({
      text: "(none) — drop an image here",
      cls: "duckmage-bg-image-path",
    });
    const bgPickBtn = bgRow.createEl("button", { text: "Pick image…" });
    bgPickBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(
        this.app,
        this.plugin,
        (file) => {
          pendingBgPath = file.path;
          pendingBgFile = null;
          bgPathLabel.setText(file.path);
          bgClearBtn.disabled = false;
        },
        "",
        IMAGE_EXTENSIONS,
      ).open();
    });
    const bgClearBtn = bgRow.createEl("button", { text: "Clear" });
    bgClearBtn.disabled = true;
    bgClearBtn.addEventListener("click", () => {
      pendingBgPath = null;
      pendingBgFile = null;
      bgPathLabel.setText("(None) — drop an image here");
      bgClearBtn.disabled = true;
    });
    this.attachImageDropZone(bgRow, async (file) => {
      pendingBgFile = file;
      pendingBgPath = null;
      bgPathLabel.setText(`${file.name} (will be imported on create)`);
      bgClearBtn.disabled = false;
    });

    // Placement: lock what has to match the map it goes next to.
    const presetBtns = Array.from(presetsRow.querySelectorAll("button"));
    const applyPlacement = () => {
      placement = null;
      const anchor = anchorSelect.value;
      const locked = !!anchor;
      if (anchor) {
        const spec = neighbourSpec(this.plugin, anchor, sideSelect.value as Side);
        if (!spec.ok) {
          placeNote.setText(`⚠ ${spec.reason}`);
        } else {
          placement = { slot: spec.slot, aSlot: spec.aSlot, anchor, side: sideSelect.value as Side, cols: spec.cols, rows: spec.rows, offset: spec.offset, stagger: spec.stagger, paletteName: spec.paletteName };
          colsInput.value = String(spec.cols);
          rowsInput.value = String(spec.rows);
          paletteSelect.value = spec.paletteName;
          originXInput.value = String(spec.offset.x);
          originYInput.value = String(spec.offset.y);
          staggerVal = spec.stagger;
          staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
          staggerBtn.toggleClass("is-even", staggerVal === "even");
          const borders = occupiedSides(this.plugin, placement).map((s) => `${s}: ${this.plugin.mapLabel(regionNameAt(this.plugin, placement!, s))}`);
          placeNote.setText(`${spec.cols}×${spec.rows}, palette ${spec.paletteName}. Borders ${borders.join("; ")}. ${hexRangeText(spec.offset, spec.cols, spec.rows)}, carrying on its neighbour's numbers.`);
        }
      } else placeNote.setText("");
      // Re-list: next to a map, the ones that continue its edge come first.
      fillGenerators();
      for (const input of [colsInput, rowsInput, paletteSelect, originXInput, originYInput]) input.disabled = locked;
      for (const b of presetBtns) b.disabled = locked;
      staggerBtn.disabled = locked;
      sideSelect.disabled = !anchor;
    };
    anchorSelect.addEventListener("change", () => {
      applyPlacement();
      schedulePreview();
    });
    sideSelect.addEventListener("change", () => {
      applyPlacement();
      schedulePreview();
    });

    const selectedGenerator = () =>
      (generatorSelect.value ? kinds.find((k) => k.id === generatorSelect.value && k.id !== BLANK_ID) : undefined) ?? null;
    const runPreview = () => {
      const k = selectedGenerator();
      if (!k) return;
      const grid = {
        cols: Math.max(1, Number(colsInput.value) || 20),
        rows: Math.max(1, Number(rowsInput.value) || 16),
        offset: { x: Number(originXInput.value) || 0, y: Number(originYInput.value) || 0 },
        stagger: staggerVal,
      };
      const r = this.runNewMapGenerator(k, paletteSelect.value, grid, Number(seedInput.value) >>> 0, placement);
      if (!r.ok) {
        previewStatus.setText(`This generator couldn't fill the map: ${r.message}`);
        return;
      }
      const shadow = placement ? shadowTerrain(neighbourShadow(this.plugin, placement)) : undefined;
      drawPreview(previewCanvas, r.cells, grid, this.plugin.settings.hexOrientation, paletteColors(this.plugin, paletteSelect.value), r.featureCells, r.paths, pathColors(this.plugin), 420, 14, undefined, { shadow });
      previewStatus.setText(r.warnings.length ? `⚠ ${r.warnings.length}` : "");
      previewStatus.setAttr("title", r.warnings.join("\n"));
    };
    let previewTimer: number | null = null;
    const schedulePreview = () => {
      previewBox.toggle(selectedGenerator() !== null);
      if (!selectedGenerator()) return;
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      if ((Number(colsInput.value) || 0) * (Number(rowsInput.value) || 0) > PREVIEW_AUTO_LIMIT) {
        previewStatus.setText("Large map: use the preview button to see it.");
        return;
      }
      previewTimer = window.setTimeout(() => {
        previewTimer = null;
        runPreview();
      }, 200);
    };
    rerollBtn.addEventListener("click", () => {
      seedInput.value = String(randomSeed());
      schedulePreview();
    });
    previewBtn.addEventListener("click", runPreview);
    for (const input of [generatorSelect, paletteSelect, colsInput, rowsInput, originXInput, originYInput, seedInput])
      input.addEventListener("change", schedulePreview);
    staggerBtn.addEventListener("click", schedulePreview);
    presetsRow.addEventListener("click", schedulePreview);

    // Create button
    const createRow = el.createDiv({ cls: "duckmage-region-row duckmage-map-create-row" });
    const createBtn = createRow.createEl("button", { text: "Create", cls: "mod-cta" });
    const allInputs: (HTMLInputElement | HTMLSelectElement)[] = [
      nameInput, colsInput, rowsInput, paletteSelect, generatorSelect, originXInput, originYInput,
    ];
    const doCreate = () =>
      void this.handleCreate(
        nameInput.value.trim(),
        Number(colsInput.value) || 20,
        Number(rowsInput.value) || 16,
        paletteSelect.value,
        Number(originXInput.value) || 0,
        Number(originYInput.value) || 0,
        staggerVal,
        createBtn,
        allInputs,
        pendingBgPath,
        pendingBgFile,
        selectedGenerator(),
        Number(seedInput.value) >>> 0,
        placement,
      );
    applyPlacement();
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") doCreate();
    });
  }

  /**
   * Run a New map tab generator at its default options. Next to a map: the
   * neighbour's edge and crossing roads as context (Overland's sea starts
   * where the neighbour's coast says), learned ones solve against its edge.
   */
  private runNewMapGenerator(
    kind: TerrainGeneratorKind,
    paletteName: string,
    grid: GridSpec,
    seed: number,
    placement: NewRegion | null,
  ): GenerateOutcome {
    const terrains = this.plugin.getPaletteOrPresetTerrains(paletteName);
    const context = placement ? buildRegionContext(this.plugin, placement) : undefined;
    const chosen: Record<string, string> = {};
    if (kind.id === OVERLAND_ID && placement) {
      const sea = seaSideFromNeighbours(grid, context?.edgeCells);
      if (sea) chosen.sea = sea.side;
    }
    return runGenerator(this.plugin.settings.hexOrientation, kind, {
      terrains,
      grid: placement ? { ...grid, offset: { ...placement.offset }, stagger: placement.stagger } : grid,
      seed,
      options: optionsWithDefaults(kind, chosen),
      context,
      region: placement ?? undefined,
    });
  }

  // ── Generator ─────────────────────────────────────────────────────────────

  /** Learn a generator from a region and open it in the terrain generator. */
  private async createGeneratorFrom(mapName: string): Promise<void> {
    // An Advanced feature: in Simple, offer to turn it on first.
    if (!hasFeature(this.plugin.settings, "generators")) {
      withFeature(this.plugin, "generators", () => void this.createGeneratorFrom(mapName));
      return;
    }
    const result = await saveGeneratorFromMap(this.plugin, mapName, mapName);
    if ("error" in result) {
      new Notice(result.error);
      return;
    }
    new Notice(`Created generator "${result.model.name}" from ${mapName}.`);
    this.close();
    await this.plugin.openTerrainGenerator({
      mapName,
      generatorPath: result.file.path,
      paletteName: result.model.meta.palette,
    });
  }

  /** Open a region's existing generator in the terrain generator. */
  private async openGenerator(mapName: string, g: GeneratorFile): Promise<void> {
    this.close();
    await this.plugin.openTerrainGenerator({
      mapName,
      generatorPath: g.file.path,
      paletteName: g.model.meta.palette,
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  private async deleteMap(name: string): Promise<void> {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      try {
        await this.app.fileManager.trashFile(folder);
      } catch (e) {
        new Notice(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
        this.confirmingDelete = null;
        this.render();
        return;
      }
    }

    this.plugin.settings.maps = this.plugin.settings.maps.filter((m) => m.name !== name);
    // Submaps of the deleted map lose their breadcrumb parent.
    for (const m of this.plugin.settings.maps) {
      if (m.parent?.map === name) delete m.parent;
    }

    if (this.plugin.settings.defaultMap === name) {
      this.plugin.settings.defaultMap = this.plugin.settings.maps[0]?.name ?? "";
    }

    if (this.view.activeMapName === name) {
      this.view.activeMapName = this.plugin.settings.maps[0]?.name ?? "";
    }

    // Hexes pointing at the deleted map lose their submap link.
    this.plugin.mapStore.forgetMap(name);
    for (const m of this.plugin.settings.maps) {
      for (const [key, h] of this.plugin.mapStore.all(m.name)) {
        if (h.submap === name) this.plugin.mapStore.set(m.name, key, { submap: null });
      }
    }

    this.confirmingDelete = null;
    await this.plugin.saveSettings();
    this.onChanged();
    this.render();
    new Notice(`Map "${name}" deleted.`);
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  private async renameMap(
    raw: string,
    btn: HTMLButtonElement,
    input: HTMLInputElement,
  ): Promise<void> {
    const newName = slugify(raw);
    if (!newName || newName === this.view.activeMapName) return;
    if (this.plugin.settings.maps.some((r) => r.name === newName)) {
      new Notice(`Map "${newName}" already exists.`);
      return;
    }
    btn.setText("Renaming…");
    btn.disabled = true;
    input.disabled = true;
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const oldPath = hexFolder
      ? `${hexFolder}/${this.view.activeMapName}`
      : this.view.activeMapName;
    const newPath = hexFolder ? `${hexFolder}/${newName}` : newName;
    const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFolder instanceof TFolder) {
      try {
        await this.app.fileManager.renameFile(oldFolder, newPath);
      } catch (e) {
        new Notice(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        btn.setText("Rename folder");
        btn.disabled = false;
        input.disabled = false;
        return;
      }
    }
    const oldName = this.view.activeMapName;
    const map = this.plugin.getMap(oldName);
    if (map) map.name = newName;
    // The map note moved with its folder; give it the new name too.
    await this.plugin.mapStore.renameMap(oldName, newName);
    if (this.plugin.settings.defaultMap === oldName) {
      this.plugin.settings.defaultMap = newName;
    }
    this.view.activeMapName = newName;
    await this.plugin.updateSubmapReferences(oldName, newName);
    await this.plugin.saveSettings();
    this.onChanged();
    this.render();
  }

  // ── Create ────────────────────────────────────────────────────────────────

  private async handleCreate(
    raw: string,
    cols: number,
    rows: number,
    paletteName: string,
    initialX: number,
    initialY: number,
    staggerOffset: "odd" | "even",
    btn: HTMLButtonElement,
    inputs: (HTMLInputElement | HTMLSelectElement)[],
    bgImagePath: string | null,
    bgImageFile: File | null,
    generator: TerrainGeneratorKind | null,
    seed: number,
    placement: NewRegion | null = null,
  ): Promise<void> {
    btn.setText("Generating…");
    btn.disabled = true;
    for (const input of inputs) input.disabled = true;
    const reset = () => {
      btn.setText("Create");
      btn.disabled = false;
      for (const input of inputs) input.disabled = false;
    };

    // Solve before creating anything, so a generator that can't fill the
    // map leaves no half-made map behind.
    // Its place next to another map may have been taken since it was chosen.
    if (placement?.anchor && placement.side) {
      const again = neighbourSpec(this.plugin, placement.anchor, placement.side);
      if (!again.ok) {
        new Notice(again.reason);
        reset();
        return;
      }
    }
    let terrainAt: Map<string, string> | undefined;
    let generatedPaths: GeneratedPath[] = [];
    if (generator) {
      const solved = this.runNewMapGenerator(
        generator, paletteName,
        { cols, rows, offset: { x: initialX, y: initialY }, stagger: staggerOffset }, seed, placement,
      );
      if (!solved.ok) {
        new Notice(`Generator "${generator.label}" couldn't fill this map: ${solved.message}`);
        reset();
        return;
      }
      terrainAt = solved.cells;
      generatedPaths = solved.paths;
    }

    const result = await this.plugin.createNewMap(
      raw, cols, rows, paletteName, initialX, initialY, staggerOffset,
      (done, total) => btn.setText(`Generating ${done} / ${total}…`),
      terrainAt,
    );

    if ("error" in result) {
      new Notice(result.error);
      reset();
      return;
    }
    if (placement) await placeNewRegion(this.plugin, result.name, placement);

    // Resolve the bg image path: a dropped File needs importing into the new
    // map's _bg folder first; a picked vault path is used directly.
    let resolvedBgPath: string | null = bgImagePath;
    if (bgImageFile) {
      try {
        btn.setText("Importing background…");
        resolvedBgPath = await importBinaryFileToVault(
          this.plugin,
          bgImageFile,
          this.bgImportFolder(result.name),
        );
      } catch (e) {
        new Notice(`Background import failed: ${e instanceof Error ? e.message : String(e)}`);
        resolvedBgPath = null;
      }
    }

    if (generatedPaths.length && generator) {
      const newMap = this.plugin.getMap(result.name);
      const { chains, missing } = generator.toChains(generatedPaths);
      if (newMap && chains.length) {
        newMap.pathChains = [...newMap.pathChains, ...chains];
        await this.plugin.saveSettings();
      }
      if (missing.length) new Notice(`No path type named ${missing.join(", ")}, so those paths were skipped.`);
    }

    if (resolvedBgPath) {
      const newMap = this.plugin.getMap(result.name);
      if (newMap) {
        newMap.backgroundImage = {
          path: resolvedBgPath,
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotation: 0,
          opacity: 1,
        };
        await this.plugin.saveSettings();
      }
    }

    this.view.switchMapFromModal(result.name);
    this.close();
    // If the new map was created with a background image, drop straight into
    // calibration mode — same UX as adding a bg to an existing map.
    if (resolvedBgPath) this.view.enterBgCalibration();
  }

  onClose(): void {
    this.stopKeepInViewport?.();
    this.stopFeatureChange?.();
    this.contentEl.empty();
  }
}

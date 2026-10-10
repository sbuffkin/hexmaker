import { App, Menu, Notice, TFolder } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { HexMapView } from "./HexMapView";
import { IMAGE_EXTENSIONS, attachImageDropZone, mapBgImportFolder, normalizeFolder, slugify, getIconUrl, createIconEl, importBinaryFileToVault } from "../utils";
import { renderMapExportForm } from "../export/MapExportModal";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import {
  listGenerators,
  saveGeneratorFromMap,
  generatorsForRegion,
  type GeneratorFile,
} from "../worldgen/generators";
import { SIDES, link, type Side } from "../worldgen/world";
import {
  detachRegion,
  gridRules,
  linkRegions,
  regionNeighbours,
} from "../worldgen/neighbours";
import { hasFeature } from "../featureLevel";
import { renderAdvancedHint, withFeature } from "../advancedHints";
import { NewMapSetupModal } from "../worldgen/NewMapSetupModal";
import { buildMapTree, filterMapTree, nodeKey, treeContains, type MapTreeNode } from "../maps/mapTree";
import { ROLLED_SECTION_TABLES, mapSectionTable, starterTablePath } from "../regionTables";

type ModalTab = "Maps" | "Properties" | "Export";

export class MapModal extends HexmakerModal {
  private confirmingDelete: string | null = null;
  private stopKeepInViewport?: () => void;
  private stopFeatureChange?: () => void;
  private activeTab: ModalTab = "Maps";

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
    const tabNames: ModalTab[] = ["Maps", "Properties", "Export"];

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
      // "New map…" sits between Properties and Export: it opens the
      // new-map form rather than a tab.
      if (tab === "Properties") {
        tabBar.createEl("button", { text: "New map…", cls: "duckmage-rt-mode-tab duckmage-map-new-btn" })
          .addEventListener("click", () => this.openNewMap());
      }
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
              .setTitle(existing ? `Learn a new generator from ${this.plugin.mapLabel(map.name)}` : `Create generator from ${this.plugin.mapLabel(map.name)}`)
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
      // "palette: Expanded" in muted text; a bare "Expanded" read like a fold state (round 6 U10).
      row.createSpan({ cls: "duckmage-region-palette-badge", text: `palette: ${map.paletteName}`, attr: { title: "Terrain palette" } });
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

    // ── Region tables (E2) ─────────────────────────────────────────────────
    if (currentMap) this.renderRegionTables(el, currentMap);

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
    attachImageDropZone(bgRow, async (file) => {
      const mapName = this.view.activeMapName;
      const dest = mapBgImportFolder(this.plugin.settings.hexFolder, mapName);
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
  /** The map's weather and rumours tables, rolled from the hex editor (E2). */
  private renderRegionTables(el: HTMLElement, map: MapData): void {
    el.createEl("h4", { text: "Weather and rumours" });
    el.createDiv({
      cls: "duckmage-map-origin-desc",
      text: "Tables the hex editor rolls for Weather and Hooks & Rumors on this map. A hex can use its own instead (⋯ in the editor).",
    });
    for (const section of ["weather", "hooks & rumors"] as const) {
      const spec = ROLLED_SECTION_TABLES[section];
      const row = el.createDiv({ cls: "duckmage-region-row duckmage-region-table-row" });
      row.createSpan({ text: section === "weather" ? "Weather" : "Rumours", cls: "duckmage-region-table-label" });
      const current = mapSectionTable(map, section);
      row.createSpan({
        text: current ?? `(none: uses ${starterTablePath(normalizeFolder(this.plugin.settings.tablesFolder ?? ""), section)} if it exists)`,
        cls: "duckmage-bg-image-path",
      });
      row.createEl("button", { text: "Pick table…" }).addEventListener("click", () => {
        new FileLinkSuggestModal(
          this.app,
          this.plugin,
          (file) => {
            map[spec.mapField] = file.path;
            void this.plugin.saveSettings().then(() => this.render());
          },
          "",
          ["md"],
        ).open();
      });
      const clear = row.createEl("button", { text: "Clear" });
      clear.disabled = !current;
      clear.addEventListener("click", () => {
        delete map[spec.mapField];
        void this.plugin.saveSettings().then(() => this.render());
      });
    }
  }

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
          this.openNewMap({ anchor: map.name, side });
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

  // ── New map ───────────────────────────────────────────────────────────────

  /**
   * New map is one form: the guided setup (generator cards with a live
   * preview and options, Next to, coordinates, background image). The old
   * quick form here defaulted to Blank with no preview, and testers only
   * found the preview behind a second, guided form (fresh-eyes round 7).
   */
  private openNewMap(prefill?: { anchor?: string; side?: Side }): void {
    new NewMapSetupModal(this.app, this.plugin, ({ name, backgroundImage }) => {
      this.view.switchMapFromModal(name);
      this.onChanged();
      // A background picked while creating: straight into calibration,
      // as when adding one to an existing map.
      if (backgroundImage) this.view.enterBgCalibration();
    }, undefined, prefill).open();
    this.close();
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
    new Notice(`Created generator "${result.model.name}" from ${this.plugin.mapLabel(mapName)}.`);
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
    const oldLabel = this.plugin.mapLabel(oldName);
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
    // A map shown by its folder name: its hex notes' "<map> x, y" aliases follow.
    await this.plugin.syncMapCoordAliases(newName, oldLabel);
    this.onChanged();
    this.render();
  }

  onClose(): void {
    this.stopKeepInViewport?.();
    this.stopFeatureChange?.();
    this.contentEl.empty();
  }
}

import { App, Menu, Notice, TFolder, setIcon } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { HexMapView } from "./HexMapView";
import { IMAGE_EXTENSIONS, attachImageDropZone, mapBgImportFolder, normalizeFolder, slugify, getIconUrl, createIconEl, importBinaryFileToVault } from "../utils";
import { renderMapExportForm } from "../export/MapExportModal";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { contentFolder } from "../notePickers";
import {
  listGenerators,
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
import { regionsOf, removeMapPatch } from "../maps/submaps";
import { RegionSettingsModal } from "./newChildMap";
import { lockedHint } from "../workMode";
import { canDo, guardWrite } from "../modeGate";
import { addGodOffer } from "./godOffer";
import { renderRegionSettingsForm } from "./regionSettingsForm";
import { NewMapSetupModal } from "../worldgen/NewMapSetupModal";
import { buildMapTree, filterMapTree, nodeKey, treeContains, type MapTreeNode } from "../maps/mapTree";
import { renderLabeledSlider, sliderFormat } from "../ui/sliders";
import { armButton } from "../ui/footer";
import { ROLLED_SECTION_TABLES, mapSectionTable, starterTablePath } from "../regionTables";
import { renderArrivalSetting, renderRoleTables } from "./mapTablesForm";
import { moduleMapProperties, worldMaps } from "../modules/runtime";
import { PlacedMenu } from "../ui/placedMenu";
import { Disclosure } from "../ui/disclosure";
import { isDebugMode } from "../ui/debugMode";
import { groupId } from "../ui/placeGroup";

type ModalTab = "Maps" | "Properties" | "Regions" | "Export";

/**
 * Restore / Remove for a missing map (SM-DEL), in the map list and on the
 * map view's empty state. Remove asks once more (a second click) before it
 * drops the map from the list; no file is touched either way.
 */
export function renderMissingActions(el: HTMLElement, plugin: HexmakerPlugin, name: string, done: () => void): void {
  const box = el.createSpan({ cls: "duckmage-map-missing-actions" });
  const restore = box.createEl("button", { text: "Restore", cls: "mod-cta", attr: { title: "Write its map note back from the last saved copy" } });
  restore.addEventListener("click", (e) => {
    e.stopPropagation();
    restore.disabled = true;
    void plugin.restoreMissingMap(name).then(done);
  });
  const remove = box.createEl("button", { text: "Remove", attr: { title: "Drop it from the map list (no files are deleted)" } });
  // The shared two-click guard (src/ui/footer.ts armButton).
  remove.addEventListener("click", (e) => e.stopPropagation());
  armButton(remove, {
    armedText: "Click again to remove",
    onConfirm: () => {
      remove.disabled = true;
      void plugin.removeMapEntry(name).then(() => {
        new Notice(`Removed "${plugin.mapLabel(name)}" from the map list.`);
        done();
      });
    },
  });
}

export class MapModal extends HexmakerModal {
  private stopKeepInViewport?: () => void;
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
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-region-modal");

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: "duckmage-rt-mode-tabs duckmage-map-modal-tabs" });
    const active = this.plugin.getMap(this.view.activeMapName);
    const showRegions = !!active;
    const tabNames: ModalTab[] = showRegions ? ["Maps", "Properties", "Regions", "Export"] : ["Maps", "Properties", "Export"];
    if (!tabNames.includes(this.activeTab)) this.activeTab = "Maps";

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
        // World maps' New overworld… (a build without World maps has none).
        worldMaps()?.addNewOverworldTab(tabBar, this.plugin, () => this.close());
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
    if (showRegions) this.renderRegionsTab(contentDivs.get("Regions")!);
    this.renderExportTab(contentDivs.get("Export")!);
  }

  // ── Regions tab ───────────────────────────────────────────────────────────

  /**
   * The map's region settings (K1): set once (on the first region, or here),
   * then fixed while any region exists; blend stays editable. Lists the
   * regions, in reading order.
   */
  private renderRegionsTab(el: HTMLElement): void {
    const map = this.plugin.getMap(this.view.activeMapName);
    if (!map) return;
    el.createEl("p", {
      cls: "duckmage-map-origin-desc",
      text: "A region is a map of one hex of this map, at one scale for every hex, lining up with the regions next to it. Make one from a hex's right-click menu.",
    });
    if (!map.regions) {
      const btn = el.createEl("button", { text: "Set up regions…" });
      btn.addEventListener("click", () => {
        new RegionSettingsModal(this.app, this.plugin, map.name, () => this.render()).open();
      });
      return;
    }
    const regions = regionsOf(this.plugin.settings.maps, map.name);
    const locked = regions.length > 0;
    if (locked) {
      const note = el.createDiv({ cls: "duckmage-regions-tab-locked" });
      setIcon(note.createSpan(), "lock");
      note.createSpan({ text: `Fixed: ${regions.length} region${regions.length === 1 ? " uses" : "s use"} these. Delete ${regions.length === 1 ? "it" : "them"} to change shape, size or palette.` });
    }
    renderRegionSettingsForm(el, this.plugin, map.regions, {
      locked,
      onChange: (s) => void this.plugin.setRegionSettings(map.name, s),
    });
    // World maps: make the missing regions, generate the overworld again.
    worldMaps()?.renderOverworldRegionRows(el, {
      app: this.app,
      plugin: this.plugin,
      render: () => this.render(),
      changed: () => this.onChanged(),
      close: () => this.close(),
    }, map);
    if (!regions.length) return;
    el.createEl("h4", { text: `Regions (${regions.length})` });
    const list = el.createEl("ul", { cls: "duckmage-region-list" });
    for (const r of regions) {
      const li = list.createEl("li", { cls: "duckmage-region-item duckmage-map-list-item" });
      const [hx, hy] = r.parent!.hex.split("_");
      const a = li.createEl("a", { text: this.plugin.mapLabel(r.name), cls: "duckmage-map-list-name" });
      li.createSpan({ cls: "duckmage-region-palette-badge", text: `hex ${hx}, ${hy}` });
      a.addEventListener("click", () => {
        this.view.switchMapFromModal(r.name, { offerModule: true });
        this.close();
      });
    }
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
    // A map's regions group starts collapsed unless the open map is in it.
    const defaultOpen = treeContains(node, active) || (node.kind !== "regions" && this.plugin.settings.maps.length <= 12);
    const open = filtering || (MapModal.expanded.get(key) ?? defaultOpen);
    const toggleTo = (to: boolean) => {
      MapModal.expanded.set(key, to);
      this.rerenderMapsTab();
    };

    if (node.kind === "regions") {
      const row = li.createDiv({ cls: "duckmage-region-item duckmage-map-tree-world" });
      this.renderTreeToggle(row, open, () => toggleTo(!open), true);
      row.createSpan({ cls: "duckmage-map-tree-world-label", text: node.label });
      row.setAttr("title", `Regions of ${this.plugin.mapLabel(node.parent)}: one per hex, in reading order`);
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".duckmage-map-tree-toggle")) return;
        toggleTo(!open);
      });
    } else if (node.kind === "world") {
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
        void Promise.all([listGenerators(this.plugin), worldMaps()?.blendMenuLabel(this.plugin, map.name)]).then(([all, blendLabel]) => {
          const existing = generatorsForRegion(all, map.name)[0];
          const menu = new Menu();
          // Generators are Advanced (placement map). Nothing else is in this
          // menu, so they're shown directly rather than under "Advanced ▸".
          const layers = new PlacedMenu(menu, isDebugMode(this.app));
          if (existing) {
            layers.add("MapModal.mapRowContextGenerator", {
              label: `Open generator "${existing.model.name}"`,
              icon: "wand-sparkles",
              onClick: () => void this.openGenerator(map.name, existing),
            });
          }
          // New, or over an existing one (the region's biome's and its parents' first), PR1 (World maps).
          const wmake = worldMaps();
          if (wmake) {
            layers.add("MapModal.mapRowContextMakeGenerator", {
              label: `Make generator from ${this.plugin.mapLabel(map.name)}…`,
              icon: existing ? "plus" : "wand-sparkles",
              onClick: () => {
                this.close();
                wmake.openMakeGenerator(this.app, this.plugin, map.name);
              },
            });
          }
          // Fold the map, as hand-edited, back into the biome it was made from (World maps).
          if (wmake && blendLabel) {
            layers.add("MapModal.mapRowContextBlendIntoBiome", {
              label: blendLabel,
              icon: "combine",
              onClick: () => {
                this.close();
                void wmake.openBlendIntoBiome(this.app, this.plugin, map.name);
              },
            });
          }
          layers.finish(() => at);
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

      const missing = this.plugin.mapStore.isMissing(map.name);
      if (missing) {
        row.addClass("is-missing");
        const warn = row.createSpan({ cls: "duckmage-map-missing-icon", attr: { "aria-label": "Missing: its folder and map note were deleted", title: "Missing: its folder and map note were deleted" } });
        setIcon(warn, "alert-triangle");
      }
      const nameSpan = row.createSpan({ text: node.label, cls: "duckmage-map-list-name" });
      // The slug is the folder; worth seeing when it differs from the name.
      if (node.label !== map.name) nameSpan.setAttr("title", `Folder: ${map.name}`);
      nameSpan.addEventListener("click", () => {
        this.view.switchMapFromModal(map.name, { offerModule: true });
        this.close();
      });
      if (missing) {
        renderMissingActions(row, this.plugin, map.name, () => {
          this.onChanged();
          this.render();
        });
        return;
      }
      // "palette: Expanded" in muted text; a bare "Expanded" read like a fold state (round 6 U10).
      row.createSpan({ cls: "duckmage-region-palette-badge", text: `palette: ${map.paletteName}`, attr: { title: "Terrain palette" } });
    }
  }

  // ── Properties tab ────────────────────────────────────────────────────────

  private renderPropertiesTab(el: HTMLElement): void {
    const currentMap = this.plugin.getMap(this.view.activeMapName);
    // Properties are map structure: locked in Play (one line, not a wall of
    // disabled fields).
    if (!canDo(this.view.activeMapName, "map-properties")) {
      el.createEl("p", { cls: "duckmage-editor-mode-locked", text: lockedHint("map-properties") });
      return;
    }

    // Name (display only: nothing moves) and folder name (the slug; moves
    // the folder and map note, and updates every reference).
    el.createEl("h4", { text: "Name" });
    const nameRow = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      value: this.plugin.mapLabel(this.view.activeMapName),
      attr: { "aria-label": "Map name" },
    });
    // Saves when you leave the box or press Enter (audit C3: no Save button).
    const saveName = () => {
      const typed = nameInput.value.trim();
      if (!typed || typed === this.plugin.mapLabel(this.view.activeMapName)) return;
      void this.plugin.setMapDisplayName(this.view.activeMapName, typed).then(() => {
        new Notice(`Renamed to "${this.plugin.mapLabel(this.view.activeMapName)}".`);
        this.onChanged();
        this.render();
      });
    };
    nameInput.addEventListener("change", saveName);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") nameInput.blur();
    });
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Shown everywhere. Its folder stays put." });

    // The page's Advanced dropdown (and Debug inside it), at the end of the tab.
    const disclosure = new Disclosure(this.app, "MapModal.Properties", () => el);
    // `isSet`: the control holds a value, counted in the header ("Advanced · 1 set").
    const at = (ids: readonly string[], isSet?: () => boolean) => disclosure.target(groupId(ids), el, isSet);

    // Folder name (the slug): Debug.
    const folderEl = at(["MapModal.propsFolderName", "MapModal.propsRenameFolder"]);
    if (folderEl) this.renderFolderName(folderEl);

    // Stagger offset
    el.createEl("h4", { text: "Stagger offset" });
    const staggerRow = el.createDiv({ cls: "duckmage-region-row" });
    let propStaggerVal: "odd" | "even" = currentMap?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    const propStaggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    propStaggerBtn.setText(propStaggerVal === "odd" ? "Odd" : "Even");
    propStaggerBtn.toggleClass("is-even", propStaggerVal === "even");
    // A map with neighbours can't flip its stagger: its seams would stop lining up.
    // Same for an overworld with regions (each region's slot depends on it) and a region itself.
    const ownsRegions = !!currentMap && (regionsOf(this.plugin.settings.maps, currentMap.name).length > 0 || currentMap.submapKind === "region");
    const hasNeighbours = ownsRegions || (!!currentMap && Object.keys(regionNeighbours(this.plugin, currentMap.name)).length > 0);
    if (hasNeighbours) {
      propStaggerBtn.disabled = true;
      staggerRow.createSpan({
        text: ownsRegions ? "Fixed while this map has regions or is one (they have to line up)." : "Fixed while this map has neighbouring regions (it has to line up with them).",
        cls: "duckmage-map-origin-desc",
      });
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

    if (currentMap) {
      renderArrivalSetting(el, this.plugin, currentMap, () => this.render());
      renderRoleTables(el, this.plugin, currentMap, () => this.render());
      // Modules' sections (Space: Convert world types to tables).
      for (const section of moduleMapProperties()) section.render(el, this.plugin, currentMap, () => this.render());
    }

    // The whole background-image row stays together on the main page:
    // customisation is not "advanced" (owner, 2026-10-11).
    this.renderBackgroundImage(el, currentMap);

    if (currentMap) this.renderDeleteBlock(el, currentMap.name);

    // ── Advanced: terrain theme, weather and rumours tables ───────────────
    const themeEl = at(["MapModal.propsTerrainTheme"], () => !!currentMap?.terrainType);
    if (themeEl) this.renderTerrainTheme(themeEl, currentMap);
    const tablesEl = at(["MapModal.propsWeatherTable", "MapModal.propsWeatherClear", "MapModal.propsRumoursTable", "MapModal.propsRumoursClear", "MapProps.sectionTablePicker"],
      () => !!currentMap && !!mapSectionTable(currentMap, "weather"));
    if (currentMap && tablesEl) {
      disclosure.track("MapModal.propsRumoursTable", () => !!mapSectionTable(currentMap, "hooks & rumors"));
      this.renderRegionTables(tablesEl, currentMap);
    }
    disclosure.toEnd();
  }

  /** Folder name (the slug): moves the folder and map note, and updates every reference. */
  private renderFolderName(el: HTMLElement): void {
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
  }

  /** The map's own terrain (shown in the map list swatch). */
  private renderTerrainTheme(el: HTMLElement, currentMap: MapData | undefined): void {
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

  }

  /** Background image, all in one place: pick or drop an image, clear, opacity, calibrate. */
  private renderBackgroundImage(el: HTMLElement, currentMap: MapData | undefined): void {
    el.createEl("h4", { text: "Background image" });
    const bgRow = el.createDiv({ cls: "duckmage-region-row duckmage-bg-image-row" });
    bgRow.createSpan({
      text: currentMap?.backgroundImage?.path ?? "(none) — drop an image here",
      cls: "duckmage-bg-image-path",
    });
    bgRow.createEl("button", { text: "Pick image…" }).addEventListener("click", () => {
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
      // Preview on input, save on change (audit S5).
      const setOpacity = (v: number) => {
        const map = this.plugin.getMap(this.view.activeMapName);
        if (!map?.backgroundImage) return false;
        map.backgroundImage.opacity = v;
        return true;
      };
      renderLabeledSlider(el, {
        label: "Opacity", min: 0.1, max: 1, step: 0.05, value: bg.opacity ?? 1,
        format: sliderFormat.fraction,
        reset: { value: 1 },
        onInput: (v) => { if (setOpacity(v)) this.onChanged(); },
        onChange: (v) => { if (setOpacity(v)) void this.plugin.saveSettings().then(() => this.onChanged()); },
      });

      const calibrateBtn = el.createEl("button", {
        text: "Calibrate position & scale",
      });
      calibrateBtn.addEventListener("click", () => {
        this.close();
        this.view.enterBgCalibration();
      });
    }
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
          contentFolder(this.plugin.settings, "tablesFolder"),
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
    if (!canDo(name, "delete-map")) {
      const p = el.createEl("p", { text: lockedHint("delete-map"), cls: "duckmage-map-origin-desc" });
      addGodOffer(p, this.plugin, name, lockedHint("delete-map"), () => this.render());
      return;
    }
    if (this.plugin.settings.maps.length <= 1) {
      el.createEl("p", { text: "This is the only map, so it can't be deleted.", cls: "duckmage-map-origin-desc" });
      return;
    }
    const box = el.createDiv({ cls: "duckmage-map-delete-block" });
    box.createEl("p", {
      text: `Moves "${this.plugin.mapLabel(name)}" (its folder, map note and hex notes) to the trash and removes it from the map list.`,
      cls: "duckmage-map-origin-desc",
    });
    // Two clicks, no dialog (owner Q6): the button asks once more for a few seconds.
    const del = box.createEl("button", { text: `Delete "${this.plugin.mapLabel(name)}"`, cls: "mod-warning duckmage-map-delete-map" });
    armButton(del, { armedText: "Click again to delete", onConfirm: () => void this.deleteMap(name) });
  }

  /**
   * Neighbouring regions: which map is north, east, south and west of this
   * one on their shared grid. Only maps that fit (same size and palette,
   * lining up, slot free) are offered; an empty side can get a new region.
   */
  private renderNeighbourBlock(el: HTMLElement, map: MapData): void {
    // A region of an overworld joins the regions next to it by itself.
    if (map.submapKind === "region" && map.world) {
      el.createEl("h4", { text: "Neighbouring regions" });
      el.createEl("p", {
        cls: "duckmage-map-origin-desc",
        text: "This is a region of an overworld: it joins the regions of the hexes around it by itself. Their names are in the bar above the map.",
      });
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
    if (!guardWrite(name, "delete-map")) return;
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      // Our own delete: the note going doesn't make the map "missing".
      this.plugin.mapStore.expectRemoval(name);
      try {
        await this.app.fileManager.trashFile(folder);
      } catch (e) {
        new Notice(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
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

    // Hexes pointing at the deleted map lose that link (region or location);
    // its own regions and locations become top-level maps.
    this.plugin.mapStore.forgetMap(name);
    this.plugin.undoBook.forgetMap(name);
    for (const m of this.plugin.settings.maps) {
      for (const [key, h] of [...this.plugin.mapStore.all(m.name)]) {
        const patch = removeMapPatch(h, name);
        if (Object.keys(patch).length) this.plugin.mapStore.set(m.name, key, patch);
      }
      if (m.parent?.map === name) {
        delete m.parent;
        delete m.submapKind;
      }
    }

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
    // Its undo queues follow it (WM6).
    this.plugin.undoBook.renameMap(oldName, newName);
    if (this.plugin.settings.defaultMap === oldName) {
      this.plugin.settings.defaultMap = newName;
    }
    this.view.activeMapName = newName;
    await this.plugin.updateSubmapReferences(oldName, newName);
    // Tokens placed on the map (token-map) follow it.
    await this.plugin.updateTokenMapReferences(oldName, newName);
    await this.plugin.saveSettings();
    // A map shown by its folder name: its hex notes' "<map> x, y" aliases follow.
    await this.plugin.syncMapCoordAliases(newName, oldLabel);
    this.onChanged();
    this.render();
  }

  onClose(): void {
    this.stopKeepInViewport?.();
    this.contentEl.empty();
  }
}

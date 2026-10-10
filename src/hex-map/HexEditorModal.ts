import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  getIconUrl,
  normalizeFolder,
  makeTableTemplate,
  createIconEl,
  iconLabel,
} from "../utils";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  setTerrainInFile,
  setIconOverrideInFile,
  setGmIconsInFile,
  getGmIconsFromFile,
  getSubmapFromFile,
} from "../frontmatter";
import {
  addLinkToSection,
  removeLinkFromSection,
  getAllSectionData,
  setSectionContent,
  addBacklinkToFile,
} from "../sections";
import { TEXT_SECTIONS } from "../types";
import type { LinkSection, HexEditorOptions, TerrainColor } from "../types";
import { RandomTableModal } from "../random-tables/RandomTableModal";
import { HexExportModal } from "./HexExportModal";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { resolveHex, type Side } from "../worldgen/world";
import { neighbourSpec } from "../worldgen/neighbours";
import { WalkRegionModal } from "../worldgen/WalkRegionModal";
import type { MapData } from "../types";
import { RegionNavigateModal } from "./RegionNavigateModal";

/** What each link field links, for its placeholder ("Search or create a town…"). */
const LINK_FIELD_NOUN: Record<LinkSection, string> = {
  "Encounters Table": "an encounter table",
  Towns: "a town",
  Dungeons: "a dungeon",
  Features: "a feature",
  Quests: "a quest",
  Factions: "a faction",
};

/** Which side of the map an off-map hex lies past (east/west first at corners). */
function offMapSide(map: MapData, x: number, y: number): Side {
  const { x: ox, y: oy } = map.gridOffset;
  if (x < ox) return "west";
  if (x >= ox + map.gridSize.cols) return "east";
  return y < oy ? "north" : "south";
}

export class HexEditorModal extends HexmakerModal {
  private hexExists = false;
  private allText = new Map<string, string>();
  private allLinks = new Map<string, string[]>();
  private directTerrain: string | null = null;
  private directIcon: string | null = null;
  private directGmIcon: string | null = null;
  /** Full GM-icon list (multi-icon model). Mirrors `directGmIcon` for old
   *  read sites; `directGmIcon` is the first entry of this list. */
  private directGmIcons: string[] = [];
  private dataPreloaded = false;
  /** Stops keepInViewport's observer (set on first open). */
  private stopKeepInViewport: (() => void) | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private x: number,
    private y: number,
    private mapName: string,
    private onChanged: (
      terrainOverrides?: Map<string, string | null>,
      iconOverrides?: Map<string, string | null>,
      gmIconsOverrides?: Map<string, string[]>,
    ) => void,
    private options: HexEditorOptions = {},
  ) {
    super(app);
  }

  async loadData(): Promise<void> {
    // Reset all fields so stale data from a previous hex never bleeds through
    this.hexExists = false;
    this.allText = new Map();
    this.allLinks = new Map();
    this.directTerrain = null;
    this.directIcon = null;
    this.directGmIcon = null;
    this.directGmIcons = [];

    const path = this.plugin.hexPath(this.x, this.y, this.mapName);
    // Terrain, icon and GM icons live in the map note (the map store), not in
    // the hex note — and a hex can have them before its note exists. Reading
    // only hex frontmatter left the current terrain never highlighted (E1).
    this.directTerrain = getTerrainFromFile(this.app, path);
    this.directIcon = getIconOverrideFromFile(this.app, path);
    this.directGmIcons = getGmIconsFromFile(this.app, path);
    this.directGmIcon = this.directGmIcons[0] ?? null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.hexExists = true;

    // Single read — reused for both frontmatter and section parsing
    const rawContent = await this.app.vault.read(file);

    // Fallback for notes the store doesn't serve yet (startup, or a note
    // written moments ago that isn't indexed): read the raw frontmatter.
    const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const tm = fmMatch[1].match(/^\s*terrain:\s*(.+)$/m);
      if (tm && this.directTerrain === null) this.directTerrain = tm[1].trim();
      const im = fmMatch[1].match(/^\s*icon:\s*(.+)$/m);
      if (im && this.directIcon === null) this.directIcon = im[1].trim();
      const gm = fmMatch[1].match(/^\s*gm-icon:\s*(.+)$/m);
      if (gm && this.directGmIcon === null) this.directGmIcon = gm[1].trim();
    }

    ({ text: this.allText, links: this.allLinks } = await getAllSectionData(
      this.app,
      path,
      rawContent,
    ));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");

    const path = this.plugin.hexPath(this.x, this.y, this.mapName);

    // ── Static header — rendered immediately, no data needed ─────────────
    const titleRow = contentEl.createDiv({ cls: "duckmage-editor-title-row" });
    const titleLeft = titleRow.createDiv({ cls: "duckmage-editor-title-left" });
    titleLeft.createEl("h2", { text: `Hex ${this.x}, ${this.y}` });
    const centerBtn = titleLeft.createEl("button", {
      text: "⌖",
      cls: "duckmage-editor-center-btn",
      title: "Center map on this hex",
    });
    centerBtn.addEventListener("click", () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
      interface WithCenterOnHex {
        centerOnHex?(x: number, y: number): void;
      }
      if (leaves.length > 0)
        (leaves[0].view as unknown as WithCenterOnHex).centerOnHex?.(
          this.x,
          this.y,
        );
    });

    // "Open note" can be determined synchronously from the vault index
    const fileNow = this.app.vault.getAbstractFileByPath(path);
    if (fileNow instanceof TFile) {
      const openLink = titleLeft.createEl("a", {
        text: "Open note",
        cls: "duckmage-editor-open-link",
      });
      openLink.addEventListener("click", () => {
        void this.app.workspace.getLeaf("tab").openFile(fileNow);
        this.close();
      });
      const exportLink = titleLeft.createEl("a", {
        text: "Export",
        cls: "duckmage-editor-open-link",
      });
      exportLink.title = "Export this hex as PDF or Markdown";
      exportLink.addEventListener("click", () => {
        new HexExportModal(this.app, this.plugin, fileNow).open();
      });
    }
    this.renderNeighborWidget(titleRow, this.x, this.y);

    this.makeDraggable();
    // The body renders after an async read, so the modal opens short and
    // then grows: keep its bottom on screen (it ran off the window, and a
    // click on the hidden half closed the editor — fresh-eyes round 3).
    this.stopKeepInViewport ??= this.keepInViewport();

    // ── Body — populated after the single async read ──────────────────────
    const bodyEl = contentEl.createDiv({ cls: "duckmage-editor-body" });

    if (this.dataPreloaded) {
      // Data was fetched before onOpen was called (navigation); render immediately
      // so there is no intermediate "Loading…" frame visible to the user.
      this.renderBody(bodyEl, path);
    } else {
      bodyEl.createSpan({ text: "Loading…", cls: "duckmage-editor-loading" });
      void this.loadData().then(() => {
        bodyEl.empty();
        this.renderBody(bodyEl, path);
      });
    }
  }

  private renderBody(bodyEl: HTMLElement, path: string): void {
    const { hexExists, allText, allLinks, directTerrain, directIcon } = this;
    const s = this.plugin.settings;

    const { body: terrainBody, header: terrainHeader } = this.makeCollapsible(
      bodyEl,
      "Terrain",
      "hexEditorTerrainCollapsed",
    );
    const headerPreview = terrainHeader.createSpan({
      cls: "duckmage-terrain-header-preview",
    });
    this.renderTerrainHeader(headerPreview, directTerrain, directIcon);
    const refreshHeader = () => this.renderTerrainHeader(headerPreview, this.directTerrain, this.directIcon);
    this.renderTerrainSection(terrainBody, path, directTerrain, refreshHeader);

    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });

    const { body: notesBody } = this.makeCollapsible(
      bodyEl,
      "Notes",
      "hexEditorNotesCollapsed",
    );
    for (const { key, label } of TEXT_SECTIONS) {
      if (!this.options.gmLayerActive && (key === "hidden" || key === "secret")) continue;
      this.renderTextSection(
        notesBody,
        path,
        key,
        label,
        allText.get(key) ?? "",
      );
    }

    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });

    // The group of link fields. Not called "Features": that's one of the
    // fields, and a group heading with a field's name read as that field's
    // label (E5). The settings flag keeps its old name.
    const { body: featuresBody } = this.makeCollapsible(
      bodyEl,
      "Linked notes",
      "hexEditorFeaturesCollapsed",
    );
    featuresBody.addClass("duckmage-editor-link-group");
    this.renderDropdownSection(
      featuresBody,
      path,
      "Encounters Table",
      hexExists,
      s.tablesFolder,
      allLinks.get("encounters table") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Towns",
      hexExists,
      s.townsFolder,
      allLinks.get("towns") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Dungeons",
      hexExists,
      s.dungeonsFolder,
      allLinks.get("dungeons") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Quests",
      hexExists,
      s.questsFolder,
      allLinks.get("quests") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Factions",
      hexExists,
      s.factionsFolder,
      allLinks.get("factions") ?? [],
    );
    this.renderDropdownSection(
      featuresBody,
      path,
      "Features",
      hexExists,
      s.featuresFolder,
      allLinks.get("features") ?? [],
    );

    // Icon pickers last: they are long grids, and above Notes they pushed
    // Description below the fold (fresh-eyes round 3).
    bodyEl.createEl("hr", { cls: "duckmage-editor-divider" });
    const { body: iconsBody } = this.makeCollapsible(
      bodyEl,
      "Icons",
      "hexEditorIconsCollapsed",
    );
    this.renderIconSections(iconsBody, path, directIcon, this.directGmIcons, refreshHeader);
  }

  onClose() {
    this.stopKeepInViewport?.();
    this.stopKeepInViewport = null;
    this.options.onModalClose?.();
    this.contentEl.empty();
  }

  private isOnMap(nx: number, ny: number): boolean {
    const region = this.plugin.getOrCreateMap(this.mapName);
    const { gridOffset, gridSize } = region;
    return (
      nx >= gridOffset.x &&
      nx < gridOffset.x + gridSize.cols &&
      ny >= gridOffset.y &&
      ny < gridOffset.y + gridSize.rows
    );
  }

  private renderNeighborWidget(
    container: HTMLElement,
    x: number,
    y: number,
  ): void {
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const stagger =
      this.plugin.getMap(this.mapName)?.staggerOffset
      ?? this.plugin.settings.staggerOffset
      ?? "odd";
    // notShifted = the hex sits on the non-staggered (un-shifted) row/col.
    const notShifted = (n: number) =>
      stagger === "odd" ? n % 2 === 0 : n % 2 !== 0;
    // First-wins on duplicate-named palette entries — matches HexMapView's
    // .find() behaviour so the neighbor preview agrees with the main grid.
    const paletteMap = new Map<string, TerrainColor>();
    for (const p of this.plugin.getMapPalette(this.mapName)) {
      if (!paletteMap.has(p.name)) paletteMap.set(p.name, p);
    }
    const widget = container.createDiv({ cls: "duckmage-neighbor-widget" });

    type NeighborDef = { l: number; t: number; nx: number; ny: number };
    const defs: NeighborDef[] = isFlat
      ? [
          { l: 22, t: 2, nx: x, ny: y - 1 }, // N
          { l: 42, t: 13, nx: x + 1, ny: notShifted(x) ? y - 1 : y }, // NE
          { l: 42, t: 32, nx: x + 1, ny: notShifted(x) ? y : y + 1 }, // SE
          { l: 22, t: 40, nx: x, ny: y + 1 }, // S
          { l: 2, t: 32, nx: x - 1, ny: notShifted(x) ? y : y + 1 }, // SW
          { l: 2, t: 13, nx: x - 1, ny: notShifted(x) ? y - 1 : y }, // NW
        ]
      : [
          { l: 10, t: 1, nx: notShifted(y) ? x - 1 : x, ny: y - 1 }, // NW
          { l: 34, t: 1, nx: notShifted(y) ? x : x + 1, ny: y - 1 }, // NE
          { l: 0, t: 18, nx: x - 1, ny: y }, // W
          { l: 44, t: 18, nx: x + 1, ny: y }, // E
          { l: 10, t: 35, nx: notShifted(y) ? x - 1 : x, ny: y + 1 }, // SW
          { l: 34, t: 35, nx: notShifted(y) ? x : x + 1, ny: y + 1 }, // SE
        ];

    for (const { l, t, nx, ny } of defs) {
      const onMap = this.isOnMap(nx, ny);
      const tile = widget.createDiv({
        cls: `duckmage-neighbor-tile${onMap ? "" : " duckmage-neighbor-tile-offmap"}`,
      });
      tile.setCssProps({ left: `${l}px`, top: `${t}px` });

      if (onMap) {
        tile.title = `Hex ${nx}, ${ny}`;
        const nPath = this.plugin.hexPath(nx, ny, this.mapName);
        const terrain = getTerrainFromFile(this.app, nPath);
        const entry = terrain ? paletteMap.get(terrain) : undefined;
        if (entry) tile.setCssProps({ "--duckmage-bg": entry.color });
        tile.addEventListener("click", () => {
          this.x = nx;
          this.y = ny;
          this.options.onNavigate?.(nx, ny);
          void this.loadData().then(() => {
            this.dataPreloaded = true;
            this.onOpen();
            this.dataPreloaded = false;
          });
        });
      } else {
        // Past the edge: a neighbouring region's hex, if one sits there.
        const here = this.plugin.getMap(this.mapName);
        const across = here ? resolveHex(this.plugin.settings.maps, here, nx, ny) : null;
        if (across && across.map.name !== this.mapName) {
          const target = { map: across.map.name, x: across.x, y: across.y };
          tile.addClass("duckmage-neighbor-tile-region");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `${target.map}: hex ${target.x}, ${target.y}`;
          const t = getTerrainFromFile(this.app, this.plugin.hexPath(target.x, target.y, target.map));
          const color = t ? this.plugin.getMapPalette(target.map).find((p) => p.name === t)?.color : undefined;
          if (color) tile.setCssProps({ "--duckmage-bg": color });
          tile.addEventListener("click", () => {
            new RegionNavigateModal(this.app, this.plugin, target, () => {
              this.close();
              this.options.onCrossToRegion?.(target.map, target.x, target.y);
            }).open();
          });
        } else if (here && neighbourSpec(this.plugin, this.mapName, offMapSide(here, nx, ny)).ok) {
          // Nothing there yet: walk into new land (pick or roll its biome).
          const side = offMapSide(here, nx, ny);
          tile.addClass("duckmage-neighbor-tile-new");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `New land to the ${side}…`;
          tile.addEventListener("click", () => {
            new WalkRegionModal(this.app, this.plugin, this.mapName, side, () => {
              const now = this.plugin.getMap(this.mapName);
              const arrived = now ? resolveHex(this.plugin.settings.maps, now, nx, ny) : null;
              if (!arrived || arrived.map.name === this.mapName) return;
              this.close();
              this.options.onCrossToRegion?.(arrived.map.name, arrived.x, arrived.y);
            }).open();
          });
        } else {
          tile.title = "Off map";
        }
      }
    }

    // Centre dot — only shown when a submap is linked
    const hexPath = this.plugin.hexPath(this.x, this.y, this.mapName);
    const submap = getSubmapFromFile(this.app, hexPath);
    if (submap) {
      const centre = widget.createDiv({ cls: "duckmage-neighbor-centre duckmage-neighbor-centre--linked" });
      // Flat-top flower center: (30,30); pointy-top: (30,26). Dot is 12×12.
      const cy = isFlat ? 24 : 20;
      centre.setCssProps({ left: "24px", top: `${cy}px` });
      centre.title = `Submap: ${submap}`;
      // Color the dot with the linked map's terrain type color (if configured)
      const submapData = this.plugin.getMap(submap);
      if (submapData?.terrainType) {
        const terrainEntry = this.plugin.getMapPalette(submap).find((t) => t.name === submapData.terrainType);
        if (terrainEntry?.color) centre.style.backgroundColor = terrainEntry.color;
      }
      centre.addEventListener("click", () => {
        this.close();
        this.options.onSwitchMap?.(submap);
      });
    }
  }

  /** Terrain header summary: swatch + current terrain name ("(base)" when
   *  the hex only shows the map's base terrain). Re-rendered on each pick. */
  private renderTerrainHeader(
    preview: HTMLElement,
    terrain: string | null,
    icon: string | null,
  ): void {
    preview.empty();
    const palette = this.plugin.getMapPalette(this.mapName);
    const base = this.plugin.getMap(this.mapName)?.baseTerrain;
    const name = terrain ?? base ?? null;
    const entry = name ? palette.find((p) => p.name === name) : undefined;
    const iconToShow = icon ?? entry?.icon;
    if (!entry && !iconToShow) {
      preview.createSpan({ text: "none", cls: "duckmage-terrain-header-name" });
      return;
    }
    const swatch = preview.createSpan({ cls: "duckmage-terrain-header-swatch" });
    if (entry) swatch.setCssProps({ "--duckmage-bg": entry.color });
    if (iconToShow) {
      const img = swatch.createEl("img");
      img.src = getIconUrl(this.plugin, iconToShow);
    }
    if (entry) {
      preview.createSpan({
        text: terrain === null ? `${entry.name} (base)` : entry.name,
        cls: "duckmage-terrain-header-name",
      });
    }
  }

  /**
   * Collapsible group whose open/closed state is remembered in the given
   * settings flag (so collapsing Terrain once keeps it collapsed on every
   * hex, E5). The same flags are exposed in the settings tab.
   */
  private makeCollapsible(
    container: HTMLElement,
    label: string,
    flag:
      | "hexEditorTerrainCollapsed"
      | "hexEditorNotesCollapsed"
      | "hexEditorFeaturesCollapsed"
      | "hexEditorIconsCollapsed",
  ): { body: HTMLElement; header: HTMLElement } {
    const startCollapsed = this.plugin.settings[flag] ?? false;
    const wrapper = container.createDiv({ cls: "duckmage-editor-collapsible" });
    const header = wrapper.createDiv({
      cls: "duckmage-editor-collapsible-header",
    });
    const arrow = header.createSpan({
      cls: "duckmage-editor-collapsible-arrow",
      text: startCollapsed ? "▶" : "▼",
    });
    header.createEl("h3", {
      text: label,
      cls: "duckmage-editor-collapsible-title",
    });
    const body = wrapper.createDiv({ cls: "duckmage-editor-collapsible-body" });
    if (startCollapsed) body.hide();
    header.addEventListener("click", () => {
      const collapsed = !body.isShown();
      if (collapsed) {
        body.show();
      } else {
        body.hide();
      }
      arrow.textContent = collapsed ? "▼" : "▶";
      this.plugin.settings[flag] = !collapsed;
      void this.plugin.saveSettings();
    });
    return { body, header };
  }

  private renderTerrainSection(
    container: HTMLElement,
    path: string,
    currentTerrain: string | null,
    onTerrainChange: () => void,
  ): void {
    const palette = this.plugin.getMapPalette(this.mapName);

    const section = container.createDiv({ cls: "duckmage-editor-section" });

    const grid = section.createDiv({ cls: "duckmage-terrain-picker" });
    this.chainWheelToModal(grid);

    // Picking a terrain keeps the editor open (E1): the map repaints via
    // onChanged, and the selection/header update in place here.
    let selectedTerrain = currentTerrain;
    const applyTerrain = async (terrain: string | null): Promise<void> => {
      if (terrain !== null) await this.ensureHexNote();
      await setTerrainInFile(this.app, path, terrain);
      void this.plugin.syncHexEncounterTableLink(path, terrain);
      selectedTerrain = terrain;
      this.directTerrain = terrain;
      grid.querySelectorAll<HTMLElement>(".duckmage-terrain-option[data-terrain]").forEach((el) =>
        el.toggleClass("is-selected", el.dataset["terrain"] === terrain),
      );
      clearBtn.toggle(terrain !== null);
      onTerrainChange();
      this.onChanged(new Map([[path, terrain]]));
    };

    // Clear terrain — always first in the grid (hidden while there's none)
    const clearBtn = grid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-clear",
      attr: { title: "Clear this hex's terrain" },
    });
    clearBtn.createDiv({
      cls: "duckmage-terrain-preview duckmage-terrain-preview-clear",
    });
    clearBtn.createSpan({
      text: "Clear",
      cls: "duckmage-terrain-option-name",
    });
    clearBtn.toggle(currentTerrain !== null);
    clearBtn.addEventListener("click", () => void applyTerrain(null));

    for (const entry of palette) {
      const btn = grid.createDiv({
        cls: `duckmage-terrain-option${entry.name === currentTerrain ? " is-selected" : ""}`,
        attr: { title: entry.name, "data-terrain": entry.name },
      });

      const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
      preview.setCssProps({ "--duckmage-bg": entry.color });

      if (entry.icon) {
        createIconEl(
          preview,
          getIconUrl(this.plugin, entry.icon),
          entry.name,
          entry.iconColor,
          "duckmage-terrain-preview-icon",
        );
      }

      btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });

      btn.addEventListener("click", () => {
        if (entry.name === selectedTerrain) return;
        void applyTerrain(entry.name);
      });
    }

    // The strip shows two rows; scroll the current terrain into view so the
    // highlight is visible on open, not hidden further down the palette.
    const current = grid.querySelector<HTMLElement>(".duckmage-terrain-option.is-selected");
    if (current) {
      window.requestAnimationFrame(() => {
        const offset = current.getBoundingClientRect().top - grid.getBoundingClientRect().top;
        grid.scrollTop += offset - 4;
      });
    }

  }

  /** Icon override + (GM layer) game master icon pickers. */
  private renderIconSections(
    container: HTMLElement,
    path: string,
    currentIcon: string | null,
    currentGmIcons: string[],
    onIconChange: () => void,
  ): void {
    const section = container.createDiv({ cls: "duckmage-editor-section" });
    // Keep terrain in the overrides map so renderGrid doesn't lose it during
    // the brief window when Obsidian clears the metadata cache on file modify.
    const terrainOverrides = (): Map<string, string | null> | undefined =>
      this.directTerrain ? new Map([[path, this.directTerrain]]) : undefined;

    // Icon override palette
    const hidden = new Set(this.plugin.settings.hiddenIcons ?? []);
    const visibleIcons = this.plugin.availableIcons.filter((i) => !hidden.has(i));

    section.createEl("p", { text: "Icon override", cls: "duckmage-icon-inline-label" });
    this.renderIconGrid(
      section,
      visibleIcons,
      currentIcon,
      "— terrain default —",
      async (picked) => {
        await this.ensureHexNote();
        await setIconOverrideInFile(this.app, path, picked);
        this.directIcon = picked;
        onIconChange(); // header shows the icon override
        this.onChanged(terrainOverrides(), new Map([[path, picked]]));
      },
    );

    // GM icon palette — only when GM layer is active. Multi-add model:
    // left-click an icon to add one, right-click to remove one. Tile shows
    // a "+N" badge when N>0. Special "— clear all —" tile wipes the list.
    if (this.options.gmLayerActive) {
      section.createEl("p", { text: "Game master icons", cls: "duckmage-icon-inline-label" });
      this.renderGmIconCountGrid(section, visibleIcons, currentGmIcons, path);
    }
  }

  /**
   * Multi-add GM icon picker. Local state is a copy of `initialCounts`
   * (the count of each icon name on this hex). Left-click increments,
   * right-click decrements (clamped at 0). Each change writes the full
   * list to frontmatter via `setGmIconsInFile`, which preserves order
   * — the user sees their additions in the order they made them on the
   * map render.
   */
  private renderGmIconCountGrid(
    container: HTMLElement,
    icons: string[],
    initialList: string[],
    path: string,
  ): void {
    // Working copy of the list (with duplicates) the user is editing.
    const list: string[] = [...initialList];
    const grid = container.createDiv({ cls: "duckmage-icon-picker duckmage-icon-picker-inline" });
    this.chainWheelToModal(grid);

    const countOf = (icon: string): number => list.filter((i) => i === icon).length;

    const persist = async (): Promise<void> => {
      await this.ensureHexNote();
      await setGmIconsInFile(this.app, path, list);
      // Pass the new list directly via the overrides arg so the view
      // can update the hex's data-gm-icons attribute immediately
      // without round-tripping through the metadata cache (which lags
      // file writes by a tick — that race meant rapid multi-add
      // clicks could silently lose icons in the on-map render).
      this.onChanged(undefined, undefined, new Map([[path, [...list]]]));
    };

    const makeTile = (icon: string | null): HTMLElement => {
      const label = icon
        ? iconLabel(icon)
        : "— clear all —";
      const tile = grid.createDiv({ cls: "duckmage-icon-option" });
      tile.dataset["icon"] = icon ?? "";
      const preview = tile.createDiv({
        cls: `duckmage-icon-preview${!icon ? " duckmage-icon-preview-clear" : ""}`,
      });
      if (icon) {
        const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = label;
      }
      tile.createSpan({ text: label, cls: "duckmage-icon-option-name" });

      // Count badge — created lazily on first non-zero count.
      const refreshBadge = (): void => {
        const c = icon ? countOf(icon) : 0;
        let badge = tile.querySelector<HTMLElement>(".duckmage-icon-count-badge");
        if (c > 0) {
          if (!badge) {
            badge = tile.createDiv({ cls: "duckmage-icon-count-badge" });
          }
          badge.setText(c > 1 ? `×${c}` : "✓");
          tile.addClass("is-selected");
        } else {
          badge?.remove();
          tile.removeClass("is-selected");
        }
      };
      refreshBadge();

      // Left-click: add (or clear-all for the special null tile).
      tile.addEventListener("click", () => {
        void (async () => {
          if (icon === null) {
            list.length = 0;
          } else {
            list.push(icon);
          }
          // Refresh ALL tiles' badges since clear-all resets every count.
          grid.querySelectorAll<HTMLElement>(".duckmage-icon-option").forEach((t) => {
            const ic = t.dataset["icon"] || null;
            const c = ic ? countOf(ic) : 0;
            let b = t.querySelector<HTMLElement>(".duckmage-icon-count-badge");
            if (c > 0) {
              if (!b) b = t.createDiv({ cls: "duckmage-icon-count-badge" });
              b.setText(c > 1 ? `×${c}` : "✓");
              t.addClass("is-selected");
            } else {
              b?.remove();
              t.removeClass("is-selected");
            }
          });
          await persist();
        })();
      });

      // Right-click: remove one. No-op on the clear-all tile.
      tile.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (icon === null) return;
        const idx = list.lastIndexOf(icon);
        if (idx === -1) return;
        list.splice(idx, 1);
        refreshBadge();
        void persist();
      });

      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.addIconFilter(grid, this.plugin.vaultIconsSet);
  }

  private renderIconGrid(
    container: HTMLElement,
    icons: string[],
    current: string | null,
    noneLabel: string,
    onPick: (icon: string | null) => Promise<void>,
  ): void {
    let selected = current;
    const grid = container.createDiv({ cls: "duckmage-icon-picker duckmage-icon-picker-inline" });
    this.chainWheelToModal(grid);

    const makeTile = (icon: string | null) => {
      const label = icon
        ? iconLabel(icon)
        : noneLabel;
      const tile = grid.createDiv({
        cls: `duckmage-icon-option${selected === icon ? " is-selected" : ""}`,
      });
      const preview = tile.createDiv({
        cls: `duckmage-icon-preview${!icon ? " duckmage-icon-preview-clear" : ""}`,
      });
      if (icon) {
        const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = label;
      }
      tile.createSpan({ text: label, cls: "duckmage-icon-option-name" });
      tile.addEventListener("click", () => {
        void (async () => {
          selected = icon;
          grid.querySelectorAll(".duckmage-icon-option").forEach((el) =>
            el.toggleClass("is-selected", (el as HTMLElement).dataset["icon"] === (icon ?? "")),
          );
          await onPick(icon);
        })();
      });
      tile.dataset["icon"] = icon ?? "";
      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.addIconFilter(grid, this.plugin.vaultIconsSet);
  }

  private getFilesForDropdown(
    folder: string,
    filterType?: "roll-filter" | "encounter-filter",
  ): TFile[] {
    const normalized = normalizeFolder(folder);
    const all = this.app.vault.getMarkdownFiles();
    const scoped = normalized
      ? all.filter((f) => f.path.startsWith(normalized + "/"))
      : all;
    let filtered = scoped.filter((f) => !f.basename.startsWith("_"));
    if (filterType) {
      const excluded =
        filterType === "encounter-filter"
          ? this.plugin.settings.encounterTableExcludedFolders
          : this.plugin.settings.rollTableExcludedFolders;
      filtered = this.plugin.filterTableFiles(filtered, filterType, excluded);
    }
    return filtered.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private renderDropdownSection(
    container: HTMLElement,
    path: string,
    section: LinkSection,
    hexExists: boolean,
    sourceFolder: string,
    initialLinks: string[],
  ): void {
    // Each link field is its own boxed card, and its input names what it
    // links, so a field can't be read as belonging to the label above or
    // below it (a tester linked a dungeon as a Quest, E5).
    const sectionEl = container.createDiv({
      cls: "duckmage-editor-link-section duckmage-editor-link-card",
    });
    sectionEl.createEl("h4", {
      text: section,
      cls: "duckmage-link-section-title",
    });

    // ── Combo box ──────────────────────────────────────────────────────────
    const comboWrap = sectionEl.createDiv({ cls: "duckmage-link-combo" });
    const input = comboWrap.createEl("input", {
      type: "text",
      cls: "duckmage-link-combo-input",
      attr: { "aria-label": `Link ${section.toLowerCase()}` },
    });
    input.placeholder = `Search or create ${LINK_FIELD_NOUN[section]}…`;

    const arrowBtn = comboWrap.createEl("button", {
      text: "▾",
      cls: "duckmage-link-combo-arrow",
      title: "Show all",
    });
    const dropdown = comboWrap.createDiv({
      cls: "duckmage-link-combo-dropdown",
    });
    dropdown.hide();

    // ── Link list ──────────────────────────────────────────────────────────
    const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

    let currentLinks = hexExists ? [...initialLinks] : [];
    const filterType =
      section === "Encounters Table"
        ? ("encounter-filter" as const)
        : undefined;

    const onItemClick =
      section === "Encounters Table"
        ? (_link: string, file: TFile) => {
            void (async () => {
              interface WithOpenTable {
                openTable?(path: string): void;
              }
              const leaves = this.app.workspace.getLeavesOfType(
                VIEW_TYPE_RANDOM_TABLES,
              );
              if (leaves.length > 0) {
                void this.app.workspace.revealLeaf(leaves[0]);
                (leaves[0].view as unknown as WithOpenTable).openTable?.(
                  file.path,
                );
              } else {
                const leaf = this.app.workspace.getLeaf("tab");
                await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
                (leaf.view as unknown as WithOpenTable).openTable?.(file.path);
              }
              this.close();
            })();
          }
        : undefined;

    const onRollClick =
      section === "Encounters Table"
        ? (file: TFile) =>
            new RandomTableModal(
              this.app,
              this.plugin,
              undefined,
              file.path,
            ).open()
        : undefined;

    const onRemove = (link: string) => {
      currentLinks = currentLinks.filter((l) => l !== link);
      refresh();
      void removeLinkFromSection(this.app, path, section, link).then(() =>
        this.onChanged(),
      );
    };

    const refresh = () => {
      linksEl.empty();
      this.renderLinkList(
        linksEl,
        currentLinks,
        path,
        onRemove,
        onItemClick,
        onRollClick,
      );
    };

    refresh();

    // ── Dropdown logic ─────────────────────────────────────────────────────
    let isOpen = false;

    const getFiltered = (query: string): TFile[] => {
      const files = this.getFilesForDropdown(sourceFolder, filterType);
      if (!query) return files;
      const q = query.toLowerCase();
      return files.filter((f) => f.basename.toLowerCase().includes(q));
    };

    const populateDropdown = (query: string) => {
      dropdown.empty();
      const trimmed = query.trim();
      const files = getFiltered(trimmed);

      if (files.length === 0 && !trimmed) {
        dropdown.createDiv({
          cls: "duckmage-link-combo-empty",
          text: "No files in folder",
        });
      }

      for (const file of files) {
        const item = dropdown.createDiv({ cls: "duckmage-link-combo-item" });
        item.textContent = file.basename;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void selectFile(file);
        });
      }

      const exactMatch = files.some(
        (f) => f.basename.toLowerCase() === trimmed.toLowerCase(),
      );
      if (trimmed && !exactMatch) {
        const createItem = dropdown.createDiv({
          cls: "duckmage-link-combo-item duckmage-link-combo-create",
        });
        createItem.textContent = `＋ Create "${trimmed}"`;
        createItem.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void createAndLink(trimmed);
        });
      }
    };

    let anchor: { reposition: () => void; detach: () => void } | null = null;

    const openDropdown = () => {
      isOpen = true;
      populateDropdown(input.value);
      dropdown.show();
      // Anchor AFTER show so offsetHeight is measurable for above/below flip.
      anchor?.detach();
      anchor = this.anchorDropdown(comboWrap, dropdown);
    };

    const closeDropdown = () => {
      isOpen = false;
      dropdown.hide();
      anchor?.detach();
      anchor = null;
    };

    const selectFile = async (file: TFile) => {
      closeDropdown();
      input.value = "";
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkPath = this.app.metadataCache.fileToLinktext(file, path);
      currentLinks = [...currentLinks, linkPath];
      refresh();
      void addLinkToSection(this.app, path, section, `[[${linkPath}]]`);
      void addBacklinkToFile(this.app, file.path, path);
      this.onChanged();
    };

    const createAndLink = async (name: string) => {
      closeDropdown();
      input.value = "";
      const folder = normalizeFolder(sourceFolder);
      const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      let file = this.app.vault.getAbstractFileByPath(newPath);
      if (!(file instanceof TFile)) {
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
          }
          file = await this.app.vault.create(
            newPath,
            section === "Encounters Table"
              ? makeTableTemplate(this.plugin.settings.defaultTableDice)
              : "",
          );
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
      }
      if (!(file instanceof TFile)) return;
      const hexFile = await this.ensureHexNote();
      if (!hexFile) {
        new Notice("Could not create hex note.");
        return;
      }
      const linkPath = this.app.metadataCache.fileToLinktext(file, path);
      currentLinks = [...currentLinks, linkPath];
      refresh();
      void addLinkToSection(this.app, path, section, `[[${linkPath}]]`);
      void addBacklinkToFile(this.app, file.path, path);
      this.onChanged();
    };

    input.addEventListener("focus", () => openDropdown());
    input.addEventListener("blur", () =>
      window.setTimeout(() => closeDropdown(), 150),
    );
    input.addEventListener("input", () => {
      if (!isOpen) openDropdown();
      else {
        populateDropdown(input.value);
        anchor?.reposition();
      }
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDropdown();
        input.blur();
        return;
      }
      if (e.key === "Enter") {
        const trimmed = input.value.trim();
        if (!trimmed) return;
        const files = getFiltered(trimmed);
        const exact = files.find(
          (f) => f.basename.toLowerCase() === trimmed.toLowerCase(),
        );
        if (exact) void selectFile(exact);
        else if (files.length === 1) void selectFile(files[0]);
        else void createAndLink(trimmed);
      }
    });

    arrowBtn.addEventListener("mousedown", (e) => e.preventDefault());
    arrowBtn.addEventListener("click", () => {
      if (isOpen) closeDropdown();
      else {
        input.focus();
        openDropdown();
      }
    });
  }

  private renderLinkList(
    container: HTMLElement,
    links: string[],
    sourcePath: string,
    onRemove?: (link: string) => void,
    onItemClick?: (link: string, file: TFile) => void,
    onRollClick?: (file: TFile) => void,
  ): void {
    if (links.length === 0) {
      container.createSpan({ text: "None", cls: "duckmage-link-empty" });
    } else {
      for (const link of links) {
        const item = container.createDiv({ cls: "duckmage-link-item" });
        const label = item.createSpan({
          text: `[[${link}]]`,
          cls: "duckmage-link-item-label",
        });
        const file = this.app.metadataCache.getFirstLinkpathDest(
          link,
          sourcePath,
        );
        if (file instanceof TFile) {
          label.addClass("duckmage-link-item-clickable");
          label.addEventListener("click", () => {
            if (onItemClick) {
              void onItemClick(link, file);
            } else {
              void this.app.workspace.getLeaf("tab").openFile(file);
              this.close();
            }
          });
          if (onRollClick) {
            const rollBtn = item.createEl("button", {
              text: "🎲",
              cls: "duckmage-link-roll-btn",
            });
            rollBtn.title = "Roll on this table";
            rollBtn.addEventListener("click", () => onRollClick(file));
          }
        }
        if (onRemove) {
          const removeBtn = item.createEl("button", {
            text: "×",
            cls: "duckmage-link-remove-btn",
          });
          removeBtn.addEventListener("click", () => onRemove(link));
        }
      }
    }
  }

  private renderTextSection(
    container: HTMLElement,
    path: string,
    section: string,
    label: string,
    initialContent: string,
  ): void {
    const sectionEl = container.createDiv({
      cls: `duckmage-editor-text-section duckmage-editor-text-section-${section}`,
    });
    const labelRow = sectionEl.createDiv({
      cls: "duckmage-text-section-label-row",
    });
    labelRow.createEl("label", {
      text: label,
      cls: "duckmage-text-section-label",
    });

    // 📖 button: terrain description table (description section) or section-specific table
    const tablesFolder = normalizeFolder(
      this.plugin.settings.tablesFolder ?? "",
    );
    let previewTablePath: string | null = null;
    let previewTitle = "";

    if (section === "description") {
      const terrain = getTerrainFromFile(this.app, path);
      if (terrain) {
        const p = tablesFolder
          ? `${tablesFolder}/terrain/description/${terrain}.md`
          : `terrain/description/${terrain}.md`;
        if (this.app.vault.getAbstractFileByPath(p)) {
          previewTablePath = p;
          previewTitle = `Roll on ${terrain} description table`;
        }
      }
    } else if (
      section === "landmark" ||
      section === "hidden" ||
      section === "secret"
    ) {
      const p = tablesFolder
        ? `${tablesFolder}/${section}.md`
        : `${section}.md`;
      if (this.app.vault.getAbstractFileByPath(p)) {
        previewTablePath = p;
        previewTitle = `Roll on ${section} table`;
      }
    }

    const textarea = sectionEl.createEl("textarea", {
      cls: "duckmage-text-section-textarea",
    });

    if (previewTablePath) {
      const btnGroup = labelRow.createDiv({
        cls: "duckmage-text-section-btn-group",
      });
      const previewBtn = btnGroup.createEl("button", {
        text: "📖",
        cls: "duckmage-section-desc-table-btn",
      });
      previewBtn.title = previewTitle;
      const capturedPath = previewTablePath;
      previewBtn.addEventListener("click", () => {
        new RandomTableModal(
          this.app,
          this.plugin,
          (result) => {
            if (textarea.value && !textarea.value.endsWith("\n"))
              textarea.value += "\n";
            textarea.value += result;
            void (async () => {
              const file = await this.ensureHexNote();
              if (!file) return;
              await setSectionContent(this.app, path, section, textarea.value);
            })();
            this.onChanged();
          },
          capturedPath,
        ).open();
      });
    }
    textarea.rows = 3;
    textarea.placeholder = `${label}…`;
    textarea.value = initialContent;

    textarea.addEventListener("blur", () => {
      void (async () => {
        const file = await this.ensureHexNote();
        if (!file) return;
        await setSectionContent(this.app, path, section, textarea.value);
      })();
    });
  }

  private async ensureHexNote(): Promise<TFile | null> {
    const path = this.plugin.hexPath(this.x, this.y, this.mapName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    return this.plugin.createHexNote(this.x, this.y, this.mapName);
  }
}

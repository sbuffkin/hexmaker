/**
 * The hex editor's Terrain section (header summary + palette grid) and its
 * Icons section (icon override + the GM layer's multi-icon picker). Both
 * write map data for the hex through the map store (frontmatter.ts).
 */

import {
  getIconUrl,
  createIconEl,
  iconLabel,
} from "../../utils";
import {
  setTerrainInFile,
  setIconOverrideInFile,
  setGmIconsInFile,
} from "../../frontmatter";
import { addPickerFilter, filterText } from "../../ui/pickers";
import { EditorWritePart, type EditorWriteHost } from "./host";

export interface TerrainIconHost extends EditorWriteHost {
  /** The hex's own terrain as last read or written here (null: none). */
  directTerrain: string | null;
  /** The hex's icon override as last read or written here. */
  directIcon: string | null;
  /** Re-read the Encounters section (its terrain table follows the terrain). */
  reloadEncounterLinks(path: string): Promise<void>;
  /** HexmakerModal.chainWheelToModal: the modal scrolls before a nested grid. */
  chainWheelToModal(inner: HTMLElement): void;
  /** HexmakerModal.addIconFilter: search + pack tabs above an icon grid. */
  addIconFilter(grid: HTMLElement, vaultIcons: Set<string>): () => void;
}

export class TerrainIconSections extends EditorWritePart<TerrainIconHost> {
  /** Terrain header summary: swatch + current terrain name ("(base)" when
   *  the hex only shows the map's base terrain). Re-rendered on each pick. */
  renderTerrainHeader(
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

  renderTerrainSection(
    container: HTMLElement,
    path: string,
    currentTerrain: string | null,
    onTerrainChange: () => void,
  ): void {
    const palette = this.plugin.getMapPalette(this.mapName);

    const section = container.createDiv({ cls: "duckmage-editor-section" });

    // Long palettes get the shared picker filter (added below the tiles);
    // the grid grows with the modal instead of scrolling in its own small
    // box (round 5: only the first two rows of a 50-terrain palette were
    // practically reachable).
    const grid = section.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-grow" });

    // Picking a terrain keeps the editor open (E1): the map repaints via
    // onChanged, and the selection/header update in place here.
    let selectedTerrain = currentTerrain;
    const applyTerrain = async (terrain: string | null): Promise<void> => {
      if (terrain !== null) await this.ensureHexNote();
      if (!(await this.plugin.undoableEdit(this.mapName, () => setTerrainInFile(this.app, path, terrain)))) return;
      // The terrain's encounters table follows the terrain: show the swap.
      void this.plugin
        .syncHexEncounterTableLink(path, terrain)
        .then(() => this.host.reloadEncounterLinks(path));
      selectedTerrain = terrain;
      this.host.directTerrain = terrain;
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
    clearBtn.addEventListener("click", () => void this.saves.track(applyTerrain(null)));

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
      filterText(btn, entry.name, entry.type, entry.category);

      btn.addEventListener("click", () => {
        if (entry.name === selectedTerrain) return;
        void this.saves.track(applyTerrain(entry.name));
      });
    }

    const filter = addPickerFilter(grid, {
      things: "terrains",
      count: palette.length,
      cls: "duckmage-terrain-filter",
      // "Clear" only alongside the full list (and only when there's a terrain).
      onFilter: () => clearBtn.toggle(!filter.input?.value.trim() && selectedTerrain !== null),
    });
  }

  /** Icon override + (GM layer) game master icon pickers. */
  renderIconSections(
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
      this.host.directTerrain ? new Map([[path, this.host.directTerrain]]) : undefined;

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
        if (!(await this.plugin.undoableEdit(this.mapName, () => setIconOverrideInFile(this.app, path, picked)))) return;
        this.host.directIcon = picked;
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
    this.host.chainWheelToModal(grid);

    const countOf = (icon: string): number => list.filter((i) => i === icon).length;

    const persist = async (): Promise<void> => {
      await this.ensureHexNote();
      if (!(await this.plugin.undoableEdit(this.mapName, () => setGmIconsInFile(this.app, path, list)))) return;
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
          await this.saves.track(persist());
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
        void this.saves.track(persist());
      });

      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.host.addIconFilter(grid, this.plugin.vaultIconsSet);
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
    this.host.chainWheelToModal(grid);

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
          await this.saves.track(onPick(icon));
        })();
      });
      tile.dataset["icon"] = icon ?? "";
      return tile;
    };

    makeTile(null);
    for (const icon of icons) makeTile(icon);
    this.host.addIconFilter(grid, this.plugin.vaultIconsSet);
  }
}

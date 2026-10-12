/**
 * The biome pickers' shared parts (owner 2026-10-12: biome lists grow long;
 * scale the UI, never trim it): tiles grouped under Surface / Mountains /
 * Water / Underground / Blank headings (biomeGroups.ts), with a filter box
 * once the list is long, and the same grouping for drop-downs.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { createIconEl, getIconUrl } from "../utils";
import { groupBiomes } from "./biomeGroups";
import type { PaintableBiome } from "./BiomeModals";

/** Show the filter box from this many biomes up. */
export const FILTER_FROM = 9;

export interface BiomeTilesOptions {
  /** Classes of the tile grid (it scrolls, or not, as these say). */
  cls: string;
  isSelected(id: string): boolean;
  onPick(b: PaintableBiome): void;
  /** Tooltip of a tile. */
  title(b: PaintableBiome): string;
}

/**
 * Biome tiles (swatch, icon, label) grouped under headings, with a filter
 * box above them when there are many. Returns the grid.
 */
export function renderBiomeTiles(parent: HTMLElement, plugin: HexmakerPlugin, palette: TerrainColor[], biomes: PaintableBiome[], o: BiomeTilesOptions): HTMLElement {
  const search = biomes.length >= FILTER_FROM ? parent.createEl("input", {
    type: "search",
    cls: "duckmage-biome-filter",
    attr: { placeholder: "Filter biomes…", "aria-label": "Filter biomes" },
  }) : null;
  const grid = parent.createDiv({ cls: o.cls });
  const groups = groupBiomes(biomes, (b) => b.group);
  // Headings only help when there's more than one group.
  const heads = groups.length > 1;
  for (const g of groups) {
    if (heads) grid.createDiv({ cls: "duckmage-biome-group-head", text: g.label, attr: { "data-group": g.id } });
    for (const b of g.items) {
      const tile = grid.createDiv({
        cls: `duckmage-terrain-option${o.isSelected(b.id) ? " is-selected" : ""}`,
        attr: { title: o.title(b), "data-biome": b.id, "data-group": g.id, "data-label": b.label.toLowerCase(), role: "button", tabindex: "0" },
      });
      const preview = tile.createDiv({ cls: "duckmage-terrain-preview" + (b.terrain ? "" : " duckmage-biome-blank-preview") });
      preview.setCssProps({ "--duckmage-bg": b.color });
      const entry = b.terrain ? palette.find((t) => t.name === b.terrain) : undefined;
      if (entry?.icon) createIconEl(preview, getIconUrl(plugin, entry.icon), b.label, entry.iconColor, "duckmage-terrain-preview-icon");
      tile.createSpan({ text: b.label, cls: "duckmage-terrain-option-name" });
      tile.addEventListener("click", () => o.onPick(b));
      tile.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick(b); }
      });
    }
  }
  if (search) {
    const empty = parent.createEl("p", { cls: "duckmage-biome-filter-empty setting-item-description", text: "No biomes match." });
    empty.toggle(false);
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      const shown = new Set<string>();
      for (const tile of Array.from(grid.querySelectorAll<HTMLElement>("[data-biome]"))) {
        const hit = !q || (tile.dataset["label"] ?? "").includes(q) || (tile.dataset["group"] ?? "").includes(q);
        tile.toggle(hit);
        if (hit) shown.add(tile.dataset["group"] ?? "");
      }
      for (const head of Array.from(grid.querySelectorAll<HTMLElement>(".duckmage-biome-group-head"))) head.toggle(shown.has(head.dataset["group"] ?? ""));
      empty.toggle(shown.size === 0);
    });
  }
  return grid;
}

/** Fill a biome drop-down, grouped (option groups) when there's more than one group. */
export function fillBiomeSelect(select: HTMLSelectElement, biomes: PaintableBiome[], text: (b: PaintableBiome) => string = (b) => b.label): void {
  const groups = groupBiomes(biomes, (b) => b.group);
  for (const g of groups) {
    const parent = groups.length > 1 ? select.createEl("optgroup", { attr: { label: g.label } }) : select;
    for (const b of g.items) parent.createEl("option", { text: text(b), value: b.id });
  }
}

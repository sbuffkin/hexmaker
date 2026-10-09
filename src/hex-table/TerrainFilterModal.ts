import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type { TerrainColor } from "../types";
import { groupPaletteByType } from "./terrainTypeFilter";

/** Mutable include/exclude sets for terrain names and type ids. */
export interface TerrainFilterSets {
  terrains: Set<string>;
  excludeTerrains: Set<string>;
  types: Set<string>;
  excludeTypes: Set<string>;
}

export class TerrainFilterModal extends HexmakerModal {
  constructor(
    app: App,
    private palette: TerrainColor[],
    private sets: TerrainFilterSets,
    private onChange: (sets: TerrainFilterSets) => void,
  ) {
    super(app);
  }

  private emit(): void {
    this.onChange({
      terrains: new Set(this.sets.terrains),
      excludeTerrains: new Set(this.sets.excludeTerrains),
      types: new Set(this.sets.types),
      excludeTypes: new Set(this.sets.excludeTypes),
    });
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Filter by terrain");
    const { contentEl } = this;
    contentEl.addClass("duckmage-terrain-filter-modal");

    const { groups: typeGroups, untyped } = groupPaletteByType(this.palette);

    contentEl.createEl("p", {
      text:
        "Left-click to include  ·  right-click to exclude  ·  " +
        (typeGroups.length > 0
          ? "a type row matches every terrain of that type"
          : "click a category heading to toggle all"),
      cls: "duckmage-terrain-filter-hint",
    });

    const list = contentEl.createDiv({ cls: "duckmage-terrain-filter-list" });

    // Every include/exclude row (terrains and types), so bulk actions can refresh them
    const refreshers: (() => void)[] = [];
    const terrainRefs = new Map<string, () => void>();

    /**
     * A checkbox row bound to an include/exclude pair. Left-click (checkbox)
     * toggles include; right-click toggles exclude.
     */
    const addToggleRow = (
      key: string,
      include: Set<string>,
      exclude: Set<string>,
      label: string,
      cls: string,
      color?: string,
    ): (() => void) => {
      const lbl = list.createEl("label", { cls });
      const cb = lbl.createEl("input");
      cb.type = "checkbox";
      if (color !== undefined) {
        const swatch = lbl.createSpan({ cls: "duckmage-hex-table-swatch" });
        if (color) swatch.setCssProps({ "--duckmage-swatch-color": color });
      }
      lbl.createSpan({ text: label });

      const refresh = () => {
        cb.checked = include.has(key);
        lbl.toggleClass("duckmage-terrain-filter-excluded", exclude.has(key));
      };
      refresh();
      refreshers.push(refresh);

      cb.addEventListener("change", () => {
        if (cb.checked) {
          include.add(key);
          exclude.delete(key);
        } else {
          include.delete(key);
        }
        refresh();
        this.emit();
      });
      lbl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (exclude.has(key)) {
          exclude.delete(key);
        } else {
          exclude.add(key);
          include.delete(key);
        }
        refresh();
        this.emit();
      });
      return refresh;
    };

    const addTerrainRow = (name: string, label: string, color?: string, indented = false) => {
      const refresh = addToggleRow(
        name,
        this.sets.terrains,
        this.sets.excludeTerrains,
        label,
        "duckmage-terrain-filter-row" + (indented ? " duckmage-terrain-filter-row-indented" : ""),
        color ?? "",
      );
      terrainRefs.set(name, refresh);
    };

    const addCategoryHeading = (label: string, names: string[]) => {
      const heading = list.createDiv({ cls: "duckmage-terrain-filter-category-heading" });
      heading.createSpan({ text: label });

      const refreshRows = () => {
        for (const name of names) terrainRefs.get(name)?.();
      };
      const { terrains: selected, excludeTerrains: excluded } = this.sets;

      // Left-click: include all (or deselect all if all already included)
      heading.addEventListener("click", () => {
        const allIncluded = names.every(n => selected.has(n));
        if (allIncluded) {
          names.forEach(n => selected.delete(n));
        } else {
          names.forEach(n => { selected.add(n); excluded.delete(n); });
        }
        refreshRows();
        this.emit();
      });

      // Right-click: exclude all (or un-exclude all if all already excluded)
      heading.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const allExcluded = names.every(n => excluded.has(n));
        if (allExcluded) {
          names.forEach(n => excluded.delete(n));
        } else {
          names.forEach(n => { excluded.add(n); selected.delete(n); });
        }
        refreshRows();
        this.emit();
      });
    };

    // "No terrain" is always first and never grouped
    addTerrainRow("", "No terrain");

    // Typed terrains: one type row (filters by type) + its terrains indented
    for (const group of typeGroups) {
      addToggleRow(
        group.typeId,
        this.sets.types,
        this.sets.excludeTypes,
        group.label,
        "duckmage-terrain-filter-row duckmage-terrain-filter-type-row",
      );
      for (const entry of group.entries) {
        addTerrainRow(entry.name, entry.name, entry.color, true);
      }
    }

    // Untyped terrains keep the category grouping
    const groups = new Map<string, TerrainColor[]>();
    const ungrouped: TerrainColor[] = [];
    for (const entry of untyped) {
      if (entry.category) {
        if (!groups.has(entry.category)) groups.set(entry.category, []);
        groups.get(entry.category)!.push(entry);
      } else {
        ungrouped.push(entry);
      }
    }

    if (typeGroups.length > 0 && untyped.length > 0) {
      list.createDiv({
        text: "No type",
        cls: "duckmage-terrain-filter-section-label",
      });
    }

    // Ungrouped terrains — no heading, not indented
    for (const entry of ungrouped) {
      addTerrainRow(entry.name, entry.name, entry.color);
    }

    // Categorised terrains — heading + indented rows
    for (const cat of [...groups.keys()].sort()) {
      const entries = groups.get(cat)!;
      addCategoryHeading(cat, entries.map(e => e.name));
      for (const entry of entries) {
        addTerrainRow(entry.name, entry.name, entry.color, true);
      }
    }

    const btnRow = contentEl.createDiv({ cls: "duckmage-terrain-filter-btns" });
    const clearBtn = btnRow.createEl("button", { text: "Clear all" });
    clearBtn.addEventListener("click", () => {
      this.sets.terrains.clear();
      this.sets.excludeTerrains.clear();
      this.sets.types.clear();
      this.sets.excludeTypes.clear();
      for (const refresh of refreshers) refresh();
      this.emit();
    });
    btnRow
      .createEl("button", { text: "Done", cls: "mod-cta" })
      .addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

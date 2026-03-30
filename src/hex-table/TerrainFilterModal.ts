import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type { TerrainColor } from "../types";

export class TerrainFilterModal extends HexmakerModal {
  constructor(
    app: App,
    private palette: TerrainColor[],
    private selected: Set<string>,
    private excluded: Set<string>,
    private onChange: (selected: Set<string>, excluded: Set<string>) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Filter by terrain");
    const { contentEl } = this;
    contentEl.addClass("duckmage-terrain-filter-modal");

    contentEl.createEl("p", {
      text: "Left-click to include  ·  Right-click to exclude  ·  Click a category heading to toggle all",
      cls: "duckmage-terrain-filter-hint",
    });

    const list = contentEl.createDiv({ cls: "duckmage-terrain-filter-list" });

    // Map terrain name → row elements, so category headings can bulk-update them
    const rowRefs = new Map<string, { lbl: HTMLElement; cb: HTMLInputElement }>();

    const applyRowState = (lbl: HTMLElement, cb: HTMLInputElement, name: string) => {
      cb.checked = this.selected.has(name);
      lbl.toggleClass("duckmage-terrain-filter-excluded", this.excluded.has(name));
    };

    const addRow = (name: string, label: string, color?: string, indented = false) => {
      const lbl = list.createEl("label", {
        cls: "duckmage-terrain-filter-row" + (indented ? " duckmage-terrain-filter-row-indented" : ""),
      });
      const cb = lbl.createEl("input");
      cb.type = "checkbox";
      applyRowState(lbl, cb, name);

      const swatch = lbl.createSpan({ cls: "duckmage-hex-table-swatch" });
      if (color) swatch.style.backgroundColor = color;
      lbl.createSpan({ text: label });

      rowRefs.set(name, { lbl, cb });

      cb.addEventListener("change", () => {
        if (cb.checked) {
          this.selected.add(name);
          this.excluded.delete(name);
        } else {
          this.selected.delete(name);
        }
        applyRowState(lbl, cb, name);
        this.onChange(new Set(this.selected), new Set(this.excluded));
      });

      lbl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (this.excluded.has(name)) {
          this.excluded.delete(name);
        } else {
          this.excluded.add(name);
          this.selected.delete(name);
        }
        applyRowState(lbl, cb, name);
        this.onChange(new Set(this.selected), new Set(this.excluded));
      });
    };

    const addCategoryHeading = (label: string, names: string[]) => {
      const heading = list.createDiv({ cls: "duckmage-terrain-filter-category-heading" });
      heading.createSpan({ text: label });

      const refreshRows = () => {
        for (const name of names) {
          const ref = rowRefs.get(name);
          if (ref) applyRowState(ref.lbl, ref.cb, name);
        }
      };

      // Left-click: include all (or deselect all if all already included)
      heading.addEventListener("click", () => {
        const allIncluded = names.every(n => this.selected.has(n));
        if (allIncluded) {
          names.forEach(n => this.selected.delete(n));
        } else {
          names.forEach(n => { this.selected.add(n); this.excluded.delete(n); });
        }
        refreshRows();
        this.onChange(new Set(this.selected), new Set(this.excluded));
      });

      // Right-click: exclude all (or un-exclude all if all already excluded)
      heading.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const allExcluded = names.every(n => this.excluded.has(n));
        if (allExcluded) {
          names.forEach(n => this.excluded.delete(n));
        } else {
          names.forEach(n => { this.excluded.add(n); this.selected.delete(n); });
        }
        refreshRows();
        this.onChange(new Set(this.selected), new Set(this.excluded));
      });
    };

    // "No terrain" is always first and never grouped
    addRow("", "No terrain");

    // Split palette into ungrouped and category groups
    const groups = new Map<string, TerrainColor[]>();
    const ungrouped: TerrainColor[] = [];
    for (const entry of this.palette) {
      if (entry.category) {
        if (!groups.has(entry.category)) groups.set(entry.category, []);
        groups.get(entry.category)!.push(entry);
      } else {
        ungrouped.push(entry);
      }
    }

    // Ungrouped terrains — no heading, not indented
    for (const entry of ungrouped) {
      addRow(entry.name, entry.name, entry.color);
    }

    // Categorised terrains — heading + indented rows
    for (const cat of [...groups.keys()].sort()) {
      const entries = groups.get(cat)!;
      addCategoryHeading(cat, entries.map(e => e.name));
      for (const entry of entries) {
        addRow(entry.name, entry.name, entry.color, true);
      }
    }

    const btnRow = contentEl.createDiv({ cls: "duckmage-terrain-filter-btns" });
    const clearBtn = btnRow.createEl("button", { text: "Clear all" });
    clearBtn.addEventListener("click", () => {
      this.selected.clear();
      this.excluded.clear();
      this.onChange(new Set(this.selected), new Set(this.excluded));
      for (const { lbl, cb } of rowRefs.values()) {
        cb.checked = false;
        lbl.removeClass("duckmage-terrain-filter-excluded");
      }
    });
    btnRow
      .createEl("button", { text: "Done", cls: "mod-cta" })
      .addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

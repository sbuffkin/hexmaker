/**
 * The hex table's field filters (plan-custom-hex-fields phase 1): one row
 * per field: a min / max for numbers, a value for yes/no and choices, a
 * "contains" box for text. The table follows each change live.
 */

import type { App } from "obsidian";
import { HexmakerModal } from "../../HexmakerModal";
import { isNumeric, type FieldDef } from "../../fields/fieldTypes";
import type { FieldFilter, FieldFilters } from "./fieldColumns";

export class FieldFilterModal extends HexmakerModal {
  constructor(app: App, private fields: readonly FieldDef[], private filters: FieldFilters, private onChange: (filters: FieldFilters) => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Filter by hex fields");
    this.contentEl.addClass("duckmage-field-filter-modal");
    this.draw();
  }

  private draw(): void {
    const { contentEl } = this;
    contentEl.empty();
    for (const f of this.fields) {
      const k = f.name.toLowerCase();
      const cur: FieldFilter = this.filters.get(k) ?? {};
      const row = contentEl.createDiv({ cls: "duckmage-field-filter-row" });
      row.createSpan({ text: f.name, cls: "duckmage-field-filter-name" });
      const set = (patch: FieldFilter) => {
        const next = { ...(this.filters.get(k) ?? {}), ...patch };
        this.filters.set(k, next);
        this.onChange(this.filters);
      };
      if (isNumeric(f)) {
        const num = (label: string, value: number | undefined, put: (n: number | undefined) => void) => {
          const box = row.createEl("input", { type: "number", cls: "duckmage-field-filter-input", attr: { placeholder: label, "aria-label": `${f.name} ${label}` } });
          if (value !== undefined) box.value = String(value);
          box.addEventListener("input", () => put(box.value.trim() === "" ? undefined : Number(box.value)));
        };
        num("min", cur.min, (n) => set({ min: n }));
        num("max", cur.max, (n) => set({ max: n }));
      } else if (f.type === "yes/no" || f.type === "choice") {
        const sel = row.createEl("select", { cls: "dropdown duckmage-field-filter-input", attr: { "aria-label": f.name } });
        sel.createEl("option", { text: "Any", value: "" });
        for (const o of f.type === "yes/no" ? ["yes", "no"] : (f.choices ?? [])) sel.createEl("option", { text: o, value: o });
        sel.value = cur.equals ?? "";
        sel.addEventListener("change", () => set({ equals: sel.value || undefined }));
      } else {
        const box = row.createEl("input", { type: "text", cls: "duckmage-field-filter-input", attr: { placeholder: "Contains", "aria-label": f.name } });
        box.value = cur.contains ?? "";
        box.addEventListener("input", () => set({ contains: box.value.trim() || undefined }));
      }
    }
    this.footer({
      secondary: [{ text: "Clear", onClick: () => { this.filters.clear(); this.onChange(this.filters); this.draw(); } }],
      cancel: { text: "Close", onClick: () => this.close() },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

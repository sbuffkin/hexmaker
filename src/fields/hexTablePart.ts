/**
 * The hex table's hex fields (its HexTablePart, src/modules/contributions.ts):
 * one column per field, sorting by a field and the field filters
 * (fieldColumns.ts holds the pure half).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexTablePart } from "../modules/contributions";
import { fieldsOf } from "./context";
import { FieldFilterModal } from "./FieldFilterModal";
import { compareFieldValues, filtersLabel, matchesFieldFilters, renderFieldCells, renderFieldHeaders, valuesOfRow, type FieldFilters } from "./fieldColumns";
import { shownValue } from "./hexFields";

export function fieldsTablePart(plugin: HexmakerPlugin): HexTablePart {
  const fields = () => fieldsOf(plugin)?.fields() ?? [];
  const filters: FieldFilters = new Map();
  let button: HTMLButtonElement | null = null;
  return {
    sortHint: ", then each hex field",
    toolbar(el, filtersChanged) {
      // Only while the world has fields.
      const btn = el.createEl("button", { text: filtersLabel(filters), cls: "duckmage-filter-btn duckmage-field-filter-btn" });
      button = btn;
      btn.toggle(fields().length > 0);
      btn.addEventListener("click", () => new FieldFilterModal(plugin.app, fields(), filters, () => {
        btn.setText(filtersLabel(filters));
        filtersChanged();
      }).open());
    },
    clearFilters() {
      filters.clear();
      button?.setText(filtersLabel(filters));
    },
    sortNames: () => fields().map((f) => f.name),
    onChange(columnsChanged) {
      return fieldsOf(plugin)?.store.onChange(() => {
        button?.toggle(fields().length > 0);
        columnsChanged();
      }) ?? (() => {});
    },
    headers: (row) => renderFieldHeaders(row, fields()),
    cells: (tr, h) => renderFieldCells(tr, h, fields()),
    passes: (tr) => matchesFieldFilters(valuesOfRow(tr), filters, fields()),
    comparer(sortName) {
      const field = fields().find((f) => f.name.toLowerCase() === sortName.toLowerCase());
      return field ? (a, b) => compareFieldValues(field, shownValue(a, field), shownValue(b, field)) : undefined;
    },
  };
}

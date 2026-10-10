import type HexmakerPlugin from "../HexmakerPlugin";
import { fillPaletteSelect } from "../palettes/paletteOptions";

export interface NewMapFieldRefs {
  nameInput: HTMLInputElement;
  colsInput: HTMLInputElement;
  rowsInput: HTMLInputElement;
  paletteSelect: HTMLSelectElement;
}

/**
 * Renders the standard "new map" input fields (name, cols, rows, palette) into
 * `container` and returns refs to each element. Both MapModal and SubmapPickerModal
 * use this so the fields always stay in sync.
 */
export function renderNewMapFields(
  container: HTMLElement,
  plugin: HexmakerPlugin,
  defaults: { cols?: number; rows?: number } = {},
): NewMapFieldRefs {
  const row = container.createDiv({ cls: "duckmage-region-row" });

  const nameInput = row.createEl("input", {
    type: "text",
    placeholder: "Map name",
  });

  const colsInput = row.createEl("input", {
    type: "number",
    value: String(defaults.cols ?? 20),
  });
  colsInput.setCssProps({ width: "55px" });

  const rowsInput = row.createEl("input", {
    type: "number",
    value: String(defaults.rows ?? 16),
  });
  rowsInput.setCssProps({ width: "55px" });

  const paletteSelect = row.createEl("select");
  fillPaletteSelect(plugin, paletteSelect);

  return { nameInput, colsInput, rowsInput, paletteSelect };
}

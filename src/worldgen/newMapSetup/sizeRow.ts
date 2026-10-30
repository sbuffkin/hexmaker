/**
 * New map's Size row: preset buttons (Small, Medium…) and columns × rows
 * fields. The preview follows the fields while typing (debounced); blur or
 * Enter commits the clamped value at once. A generator can set the size
 * itself (TerrainGeneratorKind.sizeFor: Explore as you go starts as big as
 * the party can see), which hides the controls behind a line saying so.
 */

import { makeScrubbable } from "../../ui/scrub";
import { LIVE_PREVIEW_DELAY_MS, sizeFromInput } from "../../sizeInput";
import type { SizePreset } from "../sizePresets";

export interface SizeRow {
  colsInput: HTMLInputElement;
  rowsInput: HTMLInputElement;
  presetBtns: HTMLButtonElement[];
  /** Show `cols` × `rows` in the fields and tick the matching preset. */
  show(cols: number, rows: number): void;
  /** Lock the fields and presets (placed next to a map, a region's fixed size). */
  lock(locked: boolean): void;
  /** Hide the controls behind `text` (the size a generator sets), or show them again (undefined). */
  setBy(text: string | undefined): void;
}

/**
 * Draw the row into `row` (its control cell). `pick` gets each new size
 * (`chosen`: the user changed it); `labelled` ties the row's label to the
 * columns field.
 */
export function renderSizeRow(
  row: HTMLElement,
  presets: readonly SizePreset[],
  start: { cols: number; rows: number },
  pick: (cols: number, rows: number, chosen: boolean) => void,
  labelled: (el: HTMLInputElement) => HTMLInputElement,
): SizeRow {
  let cols = start.cols;
  let rows = start.rows;
  const presetBox = row.createDiv({ cls: "duckmage-setup-size-presets" });
  const custom = row.createDiv({ cls: "duckmage-setup-size-custom" });
  const note = row.createDiv({ cls: "setting-item-description duckmage-setup-size-set" });
  note.hide();
  const colsInput = labelled(custom.createEl("input", { type: "number", value: String(cols), attr: { min: "1", max: "200", "aria-label": "Columns" } }));
  custom.createSpan({ text: "×" });
  const rowsInput = custom.createEl("input", { type: "number", value: String(rows), attr: { min: "1", max: "200", "aria-label": "Rows" } });
  // The number-field standard: drag or scroll to change (clamped on commit below).
  for (const input of [colsInput, rowsInput]) makeScrubbable(input, { min: 1, max: 200, pxPerStep: 4 });
  const presetBtns: HTMLButtonElement[] = [];
  const sync = () => presets.forEach((p, i) => presetBtns[i].toggleClass("is-active", p.cols === cols && p.rows === rows));
  const show = (c: number, r: number) => {
    cols = c; rows = r;
    colsInput.value = String(c); rowsInput.value = String(r);
    sync();
  };
  for (const p of presets) {
    const b = presetBox.createEl("button", { text: p.label, attr: { title: `${p.cols} × ${p.rows}` } });
    b.addEventListener("click", () => {
      show(p.cols, p.rows);
      pick(p.cols, p.rows, true);
    });
    presetBtns.push(b);
  }
  sync();
  let timer: number | undefined;
  const onSize = (committed: boolean) => {
    const c = sizeFromInput(colsInput.value, { min: 1, max: 200, fallback: 1, committed });
    const r = sizeFromInput(rowsInput.value, { min: 1, max: 200, fallback: 1, committed });
    if (c === undefined && r === undefined) return;
    const changed = (c ?? cols) !== cols || (r ?? rows) !== rows;
    cols = c ?? cols;
    rows = r ?? rows;
    sync();
    pick(cols, rows, changed);
  };
  for (const input of [colsInput, rowsInput]) {
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onSize(false), LIVE_PREVIEW_DELAY_MS);
    });
    input.addEventListener("change", () => {
      window.clearTimeout(timer);
      onSize(true);
    });
  }
  return {
    colsInput, rowsInput, presetBtns, show,
    lock: (locked) => { for (const el of [colsInput, rowsInput, ...presetBtns]) el.disabled = locked; },
    setBy: (text) => {
      presetBox.toggle(text === undefined);
      custom.toggle(text === undefined);
      note.toggle(text !== undefined);
      note.setText(text ?? "");
    },
  };
}

/**
 * The generator page's small controls: a labelled slider, select and
 * toggle (each one box, so the placement map can move it whole), and the
 * searchable terrain list.
 */

import { linkLabel } from "../../utils";
import { renderLabeledSlider, sliderFormat, type SliderFormat } from "../../ui/sliders";

/** A labelled slider with its hint (the shared slider, stacked). */
export function slider(
  el: HTMLElement,
  label: string,
  hint: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
  format: SliderFormat = sliderFormat.plain,
): HTMLElement {
  // The shared slider; one box per control, so the placement map can move it as a whole.
  return renderLabeledSlider(el, { label, help: hint, min, max, step, value, format, layout: "stacked", cls: "duckmage-wfc-control", onChange }).el;
}

/** A labelled select with its hint. */
export function select<T extends string>(
  el: HTMLElement,
  label: string,
  hint: string,
  options: [T, string][],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const box = el.createDiv({ cls: "duckmage-wfc-control" });
  const labelEl = box.createEl("label", { text: label, cls: "duckmage-map-field-label" });
  const sel = box.createDiv({ cls: "duckmage-region-row" }).createEl("select");
  linkLabel(labelEl, sel);
  for (const [v, text] of options) sel.createEl("option", { value: v, text });
  sel.value = value;
  box.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
  sel.addEventListener("change", () => onChange(sel.value as T));
  return box;
}

/** A checkbox with its label and hint. */
export function toggle(el: HTMLElement, label: string, hint: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const box = el.createDiv({ cls: "duckmage-wfc-control" });
  const row = box.createEl("label", { cls: "duckmage-region-row duckmage-wfc-toggle" });
  const cb = row.createEl("input", { type: "checkbox" });
  cb.checked = value;
  row.createSpan({ text: label });
  if (hint) box.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
  cb.addEventListener("change", () => onChange(cb.checked));
  return box;
}

/**
 * Searchable terrain list: type to filter, click a match to add it; added
 * terrains show as chips that can be removed.
 */
export function terrainFilter(
  el: HTMLElement,
  label: string,
  terrains: string[],
  colors: Map<string, string>,
  selected: string[],
  onChange: (list: string[]) => void,
): void {
  const labelEl = el.createEl("label", { text: label, cls: "duckmage-map-field-label" });
  const chosen = new Set(selected.filter((t) => terrains.includes(t)));
  const chips = el.createDiv({ cls: "duckmage-wfc-chips" });
  const search = el.createEl("input", { type: "search", cls: "duckmage-wfc-filter", attr: { placeholder: "Filter terrains to add…", "aria-label": "Filter terrains to add" } });
  linkLabel(labelEl, search);
  const matches = el.createDiv({ cls: "duckmage-wfc-chips duckmage-wfc-matches" });
  const swatch = (parent: HTMLElement, t: string) =>
    parent.createSpan({ cls: "duckmage-wfc-swatch" }).setCssProps({ "--duckmage-wfc-swatch": colors.get(t) ?? "var(--background-modifier-border)" });

  const render = () => {
    chips.empty();
    if (!chosen.size) chips.createSpan({ text: "None", cls: "duckmage-map-origin-desc" });
    for (const t of chosen) {
      const chip = chips.createSpan({ cls: "duckmage-wfc-chip is-selected" });
      swatch(chip, t);
      chip.createSpan({ text: t });
      const remove = chip.createEl("button", { text: "×", cls: "duckmage-wfc-chip-remove", attr: { "aria-label": `Remove ${t}` } });
      remove.addEventListener("click", () => {
        chosen.delete(t);
        onChange([...chosen]);
        render();
      });
    }
    matches.empty();
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const found = terrains.filter((t) => !chosen.has(t) && t.toLowerCase().includes(q)).slice(0, 12);
    if (!found.length) matches.createSpan({ text: "No matching terrain", cls: "duckmage-map-origin-desc" });
    for (const t of found) {
      const btn = matches.createEl("button", { cls: "duckmage-wfc-chip" });
      swatch(btn, t);
      btn.createSpan({ text: t });
      btn.addEventListener("click", () => {
        chosen.add(t);
        search.value = "";
        onChange([...chosen]);
        render();
        search.focus();
      });
    }
  };
  search.addEventListener("input", render);
  search.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const first = matches.querySelector("button");
    if (first) first.click();
  });
  render();
}

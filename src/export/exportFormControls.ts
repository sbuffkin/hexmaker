/**
 * The export form's checkboxes, shared by the core form (MapExportModal)
 * and the modules' parts of it (exportForm[]), so both look the same. Its
 * own file so a module's part needn't import the form (an import cycle).
 */

let nextCheckId = 0;

/** A checkbox whose label is a real <label for>: clicking the text toggles it and fires "change". */
export function checkbox(parent: HTMLElement, labelText: string, initial: boolean, hint?: string): HTMLInputElement {
  const row = parent.createDiv({ cls: "duckmage-export-tab-row" });
  const id = `duckmage-export-check-${nextCheckId++}`;
  const cb = row.createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox", attr: { id } });
  cb.checked = initial;
  row.createEl("label", { text: labelText, cls: "duckmage-export-tab-label", attr: { for: id } });
  if (hint) row.createDiv({ cls: "duckmage-export-tab-row-hint", text: hint });
  return cb;
}

/** A small checkbox for a row of options; the label wraps it, so its text toggles it. */
export function inlineCheck(parent: HTMLElement, labelText: string, initial: boolean, title?: string): HTMLInputElement {
  const label = parent.createEl("label", { attr: title ? { title } : {} });
  const cb = label.createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox" });
  cb.checked = initial;
  label.appendText(labelText);
  return cb;
}

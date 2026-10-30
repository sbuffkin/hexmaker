/**
 * The hex editor's Fields section (plan-custom-hex-fields phase 1): one
 * typed box per field the world declares (number, text, yes/no, choice),
 * formulas shown worked out. A blank box shows the default as its
 * placeholder. A field with a table has a 🎲 that rolls it again.
 *
 * Fields are map data (the map note's `## Hexes` columns): typing is
 * gated `edit-fields` (Build); in Play the values show read-only. Each
 * change is one undo step and recomputes the hex's formulas. No section at
 * all while the world has no fields.
 */

import { Fold } from "../ui/disclosure";
import { canDo } from "../modeGate";
import { lockedHint } from "../workMode";
import { hexKey } from "../hexKey";
import { isNumeric, isValidValue, normalizeValue, type FieldDef } from "./fieldTypes";
import { FIELD_ROLLS_COLUMN, getField, readRolls } from "./hexFields";
import { EditorWritePart, bumpFieldSeq } from "../hex-map/editor/host";
import { fieldsOf } from "./context";

export class FieldsSection extends EditorWritePart {
  /** Draw the section into `container` (nothing when the world has no fields). */
  render(container: HTMLElement): void {
    const fields = fieldsOf(this.plugin)?.fields() ?? [];
    if (!fields.length) return;
    container.createEl("hr", { cls: "duckmage-editor-divider" });
    const fold = new Fold(container, { title: "Fields", cls: "duckmage-editor-fields" });
    this.fill(fold.body, fields);
  }

  private fill(body: HTMLElement, fields: readonly FieldDef[]): void {
    body.empty();
    const key = hexKey(this.x, this.y);
    const h = this.plugin.mapStore.get(this.mapName, key);
    const rolls = readRolls(getField(h, FIELD_ROLLS_COLUMN));
    const editable = canDo(this.mapName, "edit-fields");
    for (const f of fields) {
      const row = body.createDiv({ cls: "duckmage-editor-field-row" });
      const id = `duckmage-hex-field-${bumpFieldSeq()}`;
      row.createEl("label", { text: f.name, cls: "duckmage-editor-field-label", attr: { for: id } });
      const value = getField(h, f.name) ?? "";
      const rolled = rolls.get(f.name.toLowerCase());
      const title = rolled && rolled.value !== value ? `Rolled ${rolled.value}; places made it ${value || "blank"}.` : "";
      if (f.formula || !editable) {
        row.createSpan({ text: value || f.default || "–", cls: "duckmage-editor-field-value", attr: { id, title: f.formula ? `= ${f.formula}` : title } });
        continue;
      }
      const save = (raw: string) => this.write(body, fields, () => fieldsOf(this.plugin)!.setValue(this.mapName, key, f.name, raw));
      this.input(row, f, id, value, title, save);
      if (f.table) {
        const roll = row.createEl("button", { text: "🎲", cls: "duckmage-editor-field-roll", attr: { title: `Roll ${f.name} again` } });
        roll.addEventListener("click", () => this.write(body, fields, () => fieldsOf(this.plugin)!.rollField(this.mapName, key, f.name)));
      }
    }
    if (!editable) body.createDiv({ cls: "duckmage-editor-mode-locked", text: lockedHint("edit-fields") });
  }

  /** The typed box for one field; `save` gets the new text when it's committed. */
  private input(row: HTMLElement, f: FieldDef, id: string, value: string, title: string, save: (raw: string) => void): void {
    if (f.type === "yes/no" || f.type === "choice") {
      const options = f.type === "yes/no" ? ["yes", "no"] : (f.choices ?? []);
      const sel = row.createEl("select", { cls: "dropdown duckmage-editor-field-input", attr: { id, title } });
      sel.createEl("option", { text: f.default ? `(${f.default})` : "–", value: "" });
      for (const o of options) sel.createEl("option", { text: o, value: o });
      sel.value = options.includes(value) ? value : "";
      sel.addEventListener("change", () => save(sel.value));
      return;
    }
    const box = row.createEl("input", {
      cls: "duckmage-editor-field-input",
      type: isNumeric(f) ? "number" : "text",
      attr: { id, title, placeholder: f.default, ...(isNumeric(f) ? { step: f.type === "whole number" ? "1" : "any" } : {}) },
    });
    box.value = value;
    const commit = () => {
      if (box.value === value) return;
      if (!isValidValue(f, box.value)) { box.addClass("is-invalid"); return; }
      box.removeClass("is-invalid");
      save(isNumeric(f) ? normalizeValue(f, box.value) : box.value);
    };
    box.addEventListener("change", commit);
    box.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") box.blur(); });
  }

  /** One field write: tracked by the save status, one undo step, then the section redrawn (formulas follow). */
  private write(body: HTMLElement, fields: readonly FieldDef[], edit: () => boolean): void {
    void this.saves.track(this.plugin.undoableEdit(this.mapName, edit).then(() => {
      if (body.isConnected) this.fill(body, fields);
      this.onChanged();
    }));
  }
}

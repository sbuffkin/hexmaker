/**
 * Settings → Hex fields (plan-custom-hex-fields phase 1; phase 2 moves
 * this to the New world page): edit the world's field declarations and
 * place influences. Every edit is written to the fields note
 * (`<world folder>/Hex fields.md`, FieldStore), which stays the only copy,
 * so the same rows can be edited there by hand.
 *
 * The tab draws the same definitions on both settings paths
 * (getSettingDefinitions and the display() fallback), so these rows show
 * in both. Placement ids: Settings.hexFields, Settings.placeInfluences,
 * Settings.hexFieldsNote.
 */
import type { Setting } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { ModuleSettingRow } from "./moduleSettings";
import { FIELD_TYPES, parseFieldType, type FieldDecls, type FieldDef, type InfluenceDef } from "../fields/fieldTypes";
import { parseChange } from "../fields/influence";
import { compileFormula } from "../fields/formula";
import { linkTarget } from "../fields/fieldsNote";

export const HEX_FIELDS_SECTION = "Hex fields";

const FIELDS_DESC =
  "Your own data on every hex (population, land value…). Each field is a column in every map note's Hexes table. A field rolls its table when a hex gets terrain (the table's When column can say near: town 2), or is worked out from a formula over the hex's other fields. Renaming a field doesn't rename the column in map notes that already have it.";
const INFLUENCES_DESC =
  "What each kind of place does to a field: on its own hex (Here) and on the hexes within Radius (Nearby, fading with distance). +400 adds, +40% or x1.4 multiplies, =yes sets. Towns and cities are hexes whose terrain is named like a place type, or a note linked under a hex's Towns (its place-type property, else town). Run Recalculate fields after adding places.";
const NOTE_DESC = "The fields and influences live in one note in the world folder. Edit it by hand if you like; these rows follow it.";

/** The settings rows of Hex fields, added as their own section. */
export function addHexFieldSettings<T>(
  sections: { heading?: string; items: { id: string; item: T }[] }[],
  row: (r: ModuleSettingRow) => T,
  plugin: HexmakerPlugin,
): void {
  sections.push({
    heading: HEX_FIELDS_SECTION,
    items: [
      { id: "Settings.hexFields", item: row({ name: "Fields", desc: FIELDS_DESC, aliases: ["hex fields", "custom fields", "population", "columns"], render: (s) => renderFields(s, plugin) }) },
      { id: "Settings.placeInfluences", item: row({ name: "Place influences", desc: INFLUENCES_DESC, aliases: ["towns", "cities", "settlements", "influence"], render: (s) => renderInfluences(s, plugin) }) },
      { id: "Settings.hexFieldsNote", item: row({ name: "Open the fields note", desc: NOTE_DESC, render: (s) => renderOpenNote(s, plugin) }) },
    ],
  });
}

/** The list area under a row's name, redrawn whenever the fields note changes. */
function listArea(setting: Setting, plugin: HexmakerPlugin, cls: string, draw: (el: HTMLElement) => void): void {
  setting.settingEl.addClass("duckmage-settings-fields-row");
  const el = setting.settingEl.createDiv({ cls: `duckmage-settings-fields ${cls}` });
  draw(el);
  const off = plugin.fields.store.onChange(() => {
    if (!el.isConnected) { off(); return; }
    draw(el);
  });
}

const save = (plugin: HexmakerPlugin, decls: FieldDecls) => void plugin.fields.store.save(decls);

function textBox(parent: HTMLElement, value: string, placeholder: string, label: string, commit: (v: string, box: HTMLInputElement) => void): HTMLInputElement {
  const box = parent.createEl("input", { type: "text", cls: "duckmage-settings-fields-input", attr: { placeholder, "aria-label": label } });
  box.value = value;
  box.addEventListener("change", () => commit(box.value.trim(), box));
  return box;
}

function renderFields(setting: Setting, plugin: HexmakerPlugin): void {
  listArea(setting, plugin, "duckmage-settings-fields-list", (el) => {
    el.empty();
    const decls = plugin.fields.store.get();
    const put = (i: number, patch: Partial<FieldDef>) => {
      const fields = decls.fields.map((f, j) => (j === i ? { ...f, ...patch } : f));
      save(plugin, { ...decls, fields });
    };
    decls.fields.forEach((f, i) => {
      const r = el.createDiv({ cls: "duckmage-settings-fields-item" });
      textBox(r, f.name, "Name", "Field name", (v, box) => {
        if (!v || decls.fields.some((o, j) => j !== i && o.name.toLowerCase() === v.toLowerCase())) { box.addClass("is-invalid"); return; }
        put(i, { name: v });
      });
      const type = r.createEl("select", { cls: "dropdown duckmage-settings-fields-input", attr: { "aria-label": `${f.name} type` } });
      for (const t of FIELD_TYPES) type.createEl("option", { text: t, value: t });
      type.value = f.type;
      type.addEventListener("change", () => put(i, { type: parseFieldType(type.value) ?? "text" }));
      textBox(r, f.default, "Default", `${f.name} default`, (v) => put(i, { default: v }));
      textBox(r, f.table ?? "", "Table (path)", `${f.name} table`, (v) => put(i, { table: linkTarget(v) || undefined }));
      textBox(r, f.formula ?? "", "Formula", `${f.name} formula`, (v, box) => {
        if (v && compileFormula(v, decls.fields.map((o) => o.name)).error) { box.addClass("is-invalid"); return; }
        put(i, { formula: v || undefined });
      });
      if (f.type === "choice") textBox(r, (f.choices ?? []).join(", "), "Choices, comma separated", `${f.name} choices`, (v) => put(i, { choices: v.split(/\s*,\s*/).filter(Boolean) }));
      r.createEl("button", { text: "Remove", cls: "duckmage-settings-fields-remove" }).addEventListener("click", () => {
        save(plugin, { ...decls, fields: decls.fields.filter((_, j) => j !== i) });
      });
    });
    for (const p of plugin.fields.store.problems()) el.createDiv({ cls: "duckmage-settings-fields-problem", text: `${p.where}: ${p.text} — ${p.reason}` });
    el.createEl("button", { text: "Add field", cls: "duckmage-settings-fields-add" }).addEventListener("click", () => {
      let n = decls.fields.length + 1;
      while (decls.fields.some((f) => f.name.toLowerCase() === `field ${n}`)) n++;
      save(plugin, { ...decls, fields: [...decls.fields, { name: `Field ${n}`, type: "whole number", default: "" }] });
    });
  });
}

function renderInfluences(setting: Setting, plugin: HexmakerPlugin): void {
  listArea(setting, plugin, "duckmage-settings-influences-list", (el) => {
    el.empty();
    const decls = plugin.fields.store.get();
    if (!decls.fields.length) {
      el.createDiv({ cls: "duckmage-settings-fields-empty", text: "Add a field first." });
      return;
    }
    const put = (i: number, patch: Partial<InfluenceDef>) => {
      const influences = decls.influences.map((inf, j) => (j === i ? { ...inf, ...patch } : inf));
      save(plugin, { ...decls, influences });
    };
    const change = (v: string, box: HTMLInputElement) => {
      if (parseChange(v) === undefined) { box.addClass("is-invalid"); return false; }
      return true;
    };
    decls.influences.forEach((inf, i) => {
      const r = el.createDiv({ cls: "duckmage-settings-fields-item" });
      textBox(r, inf.place, "Place type", "Place type", (v, box) => (v ? put(i, { place: v }) : box.addClass("is-invalid")));
      const field = r.createEl("select", { cls: "dropdown duckmage-settings-fields-input", attr: { "aria-label": `${inf.place} field` } });
      for (const f of decls.fields) field.createEl("option", { text: f.name, value: f.name });
      field.value = decls.fields.find((f) => f.name.toLowerCase() === inf.field.toLowerCase())?.name ?? inf.field;
      field.addEventListener("change", () => put(i, { field: field.value }));
      textBox(r, inf.here, "Here (+400)", `${inf.place} here`, (v, box) => change(v, box) && put(i, { here: v }));
      textBox(r, inf.nearby, "Nearby (+40%)", `${inf.place} nearby`, (v, box) => change(v, box) && put(i, { nearby: v }));
      const radius = r.createEl("input", { type: "number", cls: "duckmage-settings-fields-input duckmage-settings-fields-radius", attr: { min: "0", step: "1", "aria-label": `${inf.place} radius` } });
      radius.value = String(inf.radius);
      radius.addEventListener("change", () => put(i, { radius: Math.max(0, Math.round(Number(radius.value) || 0)) }));
      r.createEl("button", { text: "Remove", cls: "duckmage-settings-fields-remove" }).addEventListener("click", () => {
        save(plugin, { ...decls, influences: decls.influences.filter((_, j) => j !== i) });
      });
    });
    el.createEl("button", { text: "Add influence", cls: "duckmage-settings-fields-add" }).addEventListener("click", () => {
      save(plugin, { ...decls, influences: [...decls.influences, { place: "Town", field: decls.fields[0].name, here: "", nearby: "", radius: 1 }] });
    });
  });
}

function renderOpenNote(setting: Setting, plugin: HexmakerPlugin): void {
  setting.addButton((b) =>
    b.setButtonText("Open note").onClick(() => {
      const open = async () => {
        if (!plugin.fields.store.noteFile()) await plugin.fields.store.save(plugin.fields.store.get());
        const file = plugin.fields.store.noteFile();
        if (file) await plugin.app.workspace.getLeaf("tab").openFile(file);
      };
      void open();
    }),
  );
}

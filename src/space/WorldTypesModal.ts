/**
 * "World types": edit a world types table (worldTypes.ts) — which worlds
 * the space generators place, how often, and what each world's own map is
 * made with — with a small preview that rolls the table for a chosen map,
 * orbit zone, star and temperature and shows what comes up.
 *
 * Rows are edited as their note cells (the same reading as the note), so
 * anything typed here reads back the same from the note. Rows the note
 * has that can't be read are listed, never touched.
 *
 * Opened from the space generators' options (New map / submap setup) and
 * the "Edit world types…" command. Editing follows the map's work mode:
 * Build and God (canAdd), not Play.
 */

import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { canAdd } from "../workMode";
import {
  DEFAULT_WORLD_TYPES,
  ORBIT_ZONES,
  WORLD_TYPE_COLUMNS,
  readWorldTypeCells,
  rollWorldTypes,
  worldTypeCells,
  worldTypeOdds,
  type OrbitZone,
  type WorldTypeColumn,
  type WorldTypeContext,
  type WorldTypeMap,
  type WorldTypeRow,
} from "./worldTypes";

/** Why world types can't be edited from this map now, or undefined. */
export function worldTypesEditLock(plugin: HexmakerPlugin, mapName: string | undefined): string | undefined {
  const map = mapName ? plugin.getMap(mapName) : undefined;
  return canAdd(map) ? undefined : "Switch to Build to edit world types.";
}

/** A button that can't be used in this work mode (like the biome editor's). */
function lockButton(btn: HTMLButtonElement, hint: string): void {
  btn.disabled = true;
  btn.addClass("is-locked");
  btn.setAttr("title", hint);
  btn.setAttr("aria-label", `${btn.getText()} (${hint})`);
}

const PLACEHOLDERS: Partial<Record<WorldTypeColumn, string>> = {
  World: "ocean planet",
  Weight: "1",
  Orbit: "any",
  Stars: "any",
  Temperature: "any",
  Size: "20×14",
  Generator: "none",
  Options: "water=85, climate=lush",
  Palette: "same",
  Base: "none",
  Notes: "",
};

/** Columns shown on a row's first line (what is picked, and where); the rest are its map setup. */
const PICK_COLUMNS: WorldTypeColumn[] = ["World", "Weight", "Map", "Orbit", "Stars", "Temperature"];
const SETUP_COLUMNS: WorldTypeColumn[] = ["Size", "Generator", "Options", "Palette", "Base", "Notes"];

const col = (c: WorldTypeColumn) => WORLD_TYPE_COLUMNS.indexOf(c);

export class WorldTypesModal extends HexmakerModal {
  private tableName: string;
  /** The rows being edited, as note cells. */
  private cells: string[][] = [];
  private dirty = false;
  private off: (() => void) | undefined;
  private rowsEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private preview: { map: WorldTypeMap | ""; zone: OrbitZone | ""; star: string; temperature: string; n: number } = { map: "", zone: "", star: "", temperature: "", n: 200 };

  /** `mapName`: the map it was opened for (work mode, preview's map kind). */
  constructor(app: App, private plugin: HexmakerPlugin, private mapName?: string, table?: string, previewMap?: WorldTypeMap) {
    super(app);
    this.tableName = table ?? DEFAULT_WORLD_TYPES;
    if (previewMap) this.preview.map = previewMap;
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-world-types-modal");
    this.titleEl.setText("World types");
    void this.plugin.worldTypeStore.ensureDefault().then(() => {
      const store = this.plugin.worldTypeStore;
      if (!store.get(this.tableName)) this.tableName = store.list()[0]?.name ?? this.tableName;
      this.loadRows();
      this.render();
      // Hand edits to the note show up here (unless there are unsaved changes here).
      this.off = store.onChange(() => {
        if (this.dirty) return;
        this.loadRows();
        this.render();
      });
    });
  }

  onClose(): void {
    this.off?.();
    if (this.dirty && !this.lock() && !this.firstProblem()) void this.save();
    this.contentEl.empty();
  }

  private lock(): string | undefined {
    return worldTypesEditLock(this.plugin, this.mapName);
  }

  private loadRows(): void {
    const t = this.plugin.worldTypeStore.get(this.tableName);
    this.cells = (t?.rows ?? []).map((r) => worldTypeCells(r));
    this.dirty = false;
  }

  private rows(): WorldTypeRow[] {
    return this.cells.map((c) => readWorldTypeCells(c).row).filter((r): r is WorldTypeRow => !!r);
  }

  private firstProblem(): string | undefined {
    for (let i = 0; i < this.cells.length; i++) {
      const { problem } = readWorldTypeCells(this.cells[i]);
      if (problem) return `Row ${i + 1}: ${problem}.`;
    }
    return undefined;
  }

  private async save(): Promise<void> {
    const problem = this.firstProblem();
    if (problem) { new Notice(problem); return; }
    if (await this.plugin.worldTypeStore.update(this.tableName, this.rows())) this.dirty = false;
  }

  // ── rendering ──────────────────────────────────────────────────────────

  private render(): void {
    const { contentEl, plugin } = this;
    const store = plugin.worldTypeStore;
    contentEl.empty();
    const lock = this.lock();

    // Table picker and note actions.
    const head = contentEl.createDiv({ cls: "duckmage-world-types-head" });
    const sel = head.createEl("select", { attr: { "aria-label": "Table" } });
    for (const t of store.list()) sel.createEl("option", { value: t.name, text: t.name });
    sel.value = this.tableName;
    sel.addEventListener("change", () => {
      if (this.dirty) void this.save();
      this.tableName = sel.value;
      this.loadRows();
      this.render();
    });
    const newBtn = head.createEl("button", { text: "New table…" });
    if (lock) lockButton(newBtn, lock);
    newBtn.addEventListener("click", () => this.newTable(head));
    head.createEl("button", { text: "Open note" }).addEventListener("click", () => {
      const path = store.pathOf(this.tableName);
      const f = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
      if (f instanceof TFile) { this.close(); void plugin.app.workspace.getLeaf("tab").openFile(f); }
    });
    if (store.hasDefault(this.tableName)) {
      const restore = head.createEl("button", { text: "Restore default" });
      if (lock) lockButton(restore, lock);
      restore.addEventListener("click", () => {
        if (this.lock()) return;
        void store.restoreDefault(this.tableName).then((ok) => {
          if (!ok) return;
          this.loadRows();
          this.render();
          new Notice("World types restored (the old note was backed up).");
        });
      });
    }

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Which worlds the space generators place and how often, and what each world's own map is made with. Each table is a note in ${store.folder()}. Weight is the odds against the other rows that fit; blank limits mean any.`,
    });
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    const problems = store.problemsOf(this.tableName);
    if (problems.length) {
      contentEl.createEl("p", {
        cls: "duckmage-world-types-problems",
        text: `${problems.length} row${problems.length === 1 ? "" : "s"} in the note can't be read and ${problems.length === 1 ? "is" : "are"} kept as written: ${problems.map((p) => p.text).join("; ")}`,
      });
    }

    this.rowsEl = contentEl.createDiv({ cls: "duckmage-world-types-rows" });
    this.renderRows();

    const buttons = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    const add = buttons.createEl("button", { text: "Add row" });
    if (lock) lockButton(add, lock);
    add.addEventListener("click", () => {
      if (this.lock()) return;
      const blank = WORLD_TYPE_COLUMNS.map(() => "");
      if (this.preview.map) blank[col("Map")] = this.preview.map;
      this.cells.push(blank);
      this.changed();
      this.renderRows();
    });
    this.statusEl = buttons.createSpan({ cls: "duckmage-world-types-status" });
    this.saveBtn = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
    if (lock) lockButton(this.saveBtn, lock);
    this.saveBtn.addEventListener("click", () => void this.save().then(() => this.updateStatus()));

    contentEl.createEl("h4", { text: "Preview" });
    this.previewEl = contentEl.createDiv({ cls: "duckmage-world-types-preview" });
    this.renderPreview();
    this.updateStatus();
  }

  private newTable(head: HTMLElement): void {
    if (this.lock()) return;
    const box = head.createDiv({ cls: "duckmage-world-types-new" });
    const input = box.createEl("input", { type: "text", attr: { placeholder: "Table name", "aria-label": "New table name" } });
    const ok = box.createEl("button", { text: "Create", cls: "mod-cta" });
    input.focus();
    const go = () => {
      void this.plugin.worldTypeStore.create(input.value, this.rows()).then((res) => {
        if ("error" in res) { new Notice(res.error); return; }
        this.tableName = res.name;
        this.loadRows();
        this.render();
      });
    };
    ok.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  private changed(): void {
    this.dirty = true;
    this.updateStatus();
    this.renderPreview();
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const problem = this.firstProblem();
    this.statusEl.setText(problem ?? (this.dirty ? "Unsaved changes" : ""));
    this.statusEl.toggleClass("is-error", !!problem);
    if (!this.lock()) this.saveBtn.disabled = !!problem || !this.dirty;
  }

  /** Terrain names (all palettes) for the World / Stars / Base suggestions. */
  private suggestions(types: string[] | undefined): string[] {
    const out = new Set<string>();
    for (const p of this.plugin.settings.terrainPalettes) {
      for (const t of p.terrains) if (!types || types.includes(t.type ?? "")) out.add(t.name);
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  private datalist(id: string, values: string[]): string {
    const full = `duckmage-world-types-${id}`;
    activeDocument.getElementById(full)?.remove();
    const dl = this.contentEl.createEl("datalist", { attr: { id: full } });
    for (const v of values) dl.createEl("option", { value: v });
    return full;
  }

  private renderRows(): void {
    const el = this.rowsEl;
    el.empty();
    const lock = this.lock();
    const worldList = this.datalist("worlds", this.suggestions(["world", "gas-giant", "asteroids", "moon", "star-system", "station", "starport", "anomaly"]));
    const starList = this.datalist("stars", this.suggestions(["star"]));
    const baseList = this.datalist("base", this.suggestions(undefined));
    const paletteList = this.datalist("palettes", this.plugin.settings.terrainPalettes.map((p) => p.name));
    const lists: Partial<Record<WorldTypeColumn, string>> = { World: worldList, Stars: starList, Base: baseList, Palette: paletteList };
    if (!this.cells.length) el.createDiv({ cls: "setting-item-description", text: "No rows yet." });
    this.cells.forEach((cells, i) => {
      const row = el.createDiv({ cls: "duckmage-world-types-row" });
      const problem = readWorldTypeCells(cells).problem;
      row.toggleClass("is-invalid", !!problem);
      if (problem) row.setAttr("title", problem);
      const line = (cls: string, columns: WorldTypeColumn[]) => {
        const l = row.createDiv({ cls });
        for (const c of columns) this.cellInput(l, cells, c, lists[c], !!lock, row);
        return l;
      };
      const top = line("duckmage-world-types-line", PICK_COLUMNS);
      line("duckmage-world-types-line is-setup", SETUP_COLUMNS);
      const tools = top.createDiv({ cls: "duckmage-world-types-tools" });
      const btn = (text: string, label: string, fn: () => void, disabled: boolean) => {
        const b = tools.createEl("button", { text, attr: { "aria-label": label, title: label } });
        if (lock) lockButton(b, lock);
        else b.disabled = disabled;
        b.addEventListener("click", () => {
          if (this.lock()) return;
          fn();
          this.changed();
          this.renderRows();
        });
      };
      btn("↑", "Move up", () => { [this.cells[i - 1], this.cells[i]] = [this.cells[i], this.cells[i - 1]]; }, i === 0);
      btn("↓", "Move down", () => { [this.cells[i + 1], this.cells[i]] = [this.cells[i], this.cells[i + 1]]; }, i === this.cells.length - 1);
      btn("✕", "Remove row", () => { this.cells.splice(i, 1); }, false);
    });
  }

  private cellInput(parent: HTMLElement, cells: string[], c: WorldTypeColumn, list: string | undefined, locked: boolean, row: HTMLElement): void {
    const i = col(c);
    const wrap = parent.createEl("label", { cls: `duckmage-world-types-cell is-${c.toLowerCase()}` });
    wrap.createSpan({ cls: "duckmage-world-types-cell-label", text: c });
    if (c === "Map") {
      const sel = wrap.createEl("select");
      for (const [v, text] of [["", "Any"], ["sector", "Sector"], ["system", "System"]]) sel.createEl("option", { value: v, text });
      // A value the select doesn't list (typed in the note) stays as it was.
      if (cells[i] && !["sector", "system"].includes(cells[i])) sel.createEl("option", { value: cells[i], text: cells[i] });
      sel.value = cells[i] ?? "";
      sel.disabled = locked;
      sel.addEventListener("change", () => { cells[i] = sel.value; this.cellChanged(cells, row); });
      return;
    }
    const input = wrap.createEl("input", { type: "text", value: cells[i] ?? "", attr: { placeholder: PLACEHOLDERS[c] ?? "" } });
    if (list) input.setAttr("list", list);
    input.disabled = locked;
    input.addEventListener("input", () => { cells[i] = input.value; this.cellChanged(cells, row); });
  }

  private cellChanged(cells: string[], row: HTMLElement): void {
    const problem = readWorldTypeCells(cells).problem;
    row.toggleClass("is-invalid", !!problem);
    if (problem) row.setAttr("title", problem);
    else row.removeAttribute("title");
    this.changed();
  }

  private renderPreview(): void {
    const el = this.previewEl;
    if (!el) return;
    el.empty();
    const p = this.preview;
    const controls = el.createDiv({ cls: "duckmage-world-types-preview-controls" });
    const select = (label: string, options: [string, string][], value: string, set: (v: string) => void) => {
      const l = controls.createEl("label", { text: `${label} ` });
      const s = l.createEl("select");
      for (const [v, t] of options) s.createEl("option", { value: v, text: t });
      s.value = value;
      s.addEventListener("change", () => { set(s.value); this.renderPreview(); });
    };
    select("Map", [["", "Any"], ["sector", "Sector"], ["system", "System"]], p.map, (v) => { p.map = v as WorldTypeMap | ""; });
    select("Orbit", [["", "Any"], ...ORBIT_ZONES.map((z): [string, string] => [z, z[0].toUpperCase() + z.slice(1)])], p.zone, (v) => { p.zone = v as OrbitZone | ""; });
    select("Star", [["", "Any"], ...this.suggestions(["star"]).map((s): [string, string] => [s, s])], p.star, (v) => { p.star = v; });
    select("Temperature", [["", "Any"], ["0.1", "Cold"], ["0.3", "Cool"], ["0.5", "Mild"], ["0.7", "Warm"], ["0.9", "Hot"]], p.temperature, (v) => { p.temperature = v; });
    select("Rolls", [["100", "100"], ["200", "200"], ["1000", "1000"]], String(p.n), (v) => { p.n = Number(v); });

    const ctx: Omit<WorldTypeContext, "seed" | "rand"> = {};
    if (p.map) ctx.map = p.map;
    if (p.zone) ctx.zone = p.zone;
    if (p.star) ctx.starType = p.star;
    if (p.temperature) ctx.temperature = Number(p.temperature);
    const table = { name: this.tableName, rows: this.rows() };
    const odds = worldTypeOdds(table, ctx);
    if (!odds.length) {
      el.createDiv({ cls: "setting-item-description", text: "No row fits: nothing would be placed here." });
      return;
    }
    const rolled = new Map(rollWorldTypes(table, ctx, p.n).map((r) => [r.world.toLowerCase(), r.count]));
    const list = el.createDiv({ cls: "duckmage-world-types-dist" });
    for (const o of odds) {
      const n = rolled.get(o.world.toLowerCase()) ?? 0;
      const r = list.createDiv({ cls: "duckmage-world-types-dist-row" });
      r.createSpan({ cls: "duckmage-world-types-dist-name", text: o.world });
      const bar = r.createSpan({ cls: "duckmage-world-types-dist-bar" });
      bar.createSpan({ cls: "duckmage-world-types-dist-fill" }).setCssProps({ "--duckmage-dist": `${Math.round((n / p.n) * 100)}%` });
      r.createSpan({ cls: "duckmage-world-types-dist-num", text: `${n} of ${p.n}` });
      r.createSpan({ cls: "duckmage-world-types-dist-odds", text: `odds ${Math.round(o.odds * 1000) / 10}%` });
    }
  }
}

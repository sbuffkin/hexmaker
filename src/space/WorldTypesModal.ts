/**
 * "World types": edit a world types table (worldTypes.ts) — which worlds
 * the space generators place, how often, and what each world's own map is
 * made with — plus its Stars (Orbits' random star) and Sector features
 * (Star scatter's special hexes), one tab each. Each tab has a small
 * preview that rolls its table and shows what comes up.
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
  FEATURE_COLUMNS,
  ORBIT_ZONES,
  STAR_COLUMNS,
  WORLD_TYPE_COLUMNS,
  featureCells,
  formatChance,
  readFeatureCells,
  readStarCells,
  readWorldTypeCells,
  rollSectorFeatures,
  rollStars,
  rollWorldTypes,
  sectorFeatureOdds,
  starCells,
  starOdds,
  worldTypeCells,
  worldTypeOdds,
  type OrbitZone,
  type SectorFeatureRow,
  type StarTypeRow,
  type WorldTypeColumn,
  type WorldTypeContext,
  type WorldTypeExtras,
  type WorldTypeMap,
  type WorldTypeRow,
  type WorldTypeTable,
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

const PLACEHOLDERS: Record<string, string> = {
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
  Star: "red dwarf",
  Feature: "black hole",
  Chance: "1 in 50",
};

/** Columns shown on a row's first line (what is picked, and where); the rest are its map setup. */
const PICK_COLUMNS: WorldTypeColumn[] = ["World", "Weight", "Map", "Orbit", "Stars", "Temperature"];
const SETUP_COLUMNS: WorldTypeColumn[] = ["Size", "Generator", "Options", "Palette", "Base", "Notes"];

const col = (c: WorldTypeColumn) => WORLD_TYPE_COLUMNS.indexOf(c);

export type WorldTypesTab = "worlds" | "stars" | "features";

/** One tab's table: its columns and how its cells read. */
interface TabSpec {
  label: string;
  columns: readonly string[];
  read: (cells: readonly string[]) => { problem?: string };
}

const TABS: Record<WorldTypesTab, TabSpec> = {
  worlds: { label: "Worlds", columns: WORLD_TYPE_COLUMNS, read: readWorldTypeCells },
  stars: { label: "Stars", columns: STAR_COLUMNS, read: readStarCells },
  features: { label: "Sector features", columns: FEATURE_COLUMNS, read: readFeatureCells },
};
const TAB_ORDER: WorldTypesTab[] = ["worlds", "stars", "features"];

/** Terrain types offered as suggestions for each name column. */
const SUGGEST_TYPES: Record<string, string[]> = {
  World: ["world", "gas-giant", "asteroids", "moon", "star-system", "station", "starport", "anomaly"],
  Stars: ["star"],
  Star: ["star"],
  Feature: ["station", "starport", "jump-point", "anomaly", "star-system", "rift"],
};

export class WorldTypesModal extends HexmakerModal {
  private tableName: string;
  private tab: WorldTypesTab;
  /** The rows being edited, as note cells, per tab. */
  private cells: Record<WorldTypesTab, string[][]> = { worlds: [], stars: [], features: [] };
  /** Whether the note has a Stars / Sector features table (so an empty one isn't added on save). */
  private has = { stars: false, features: false };
  private dirty = false;
  private off: (() => void) | undefined;
  private rowsEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private tabButtons = new Map<WorldTypesTab, HTMLButtonElement>();
  private preview: { map: WorldTypeMap | ""; zone: OrbitZone | ""; star: string; temperature: string; n: number } = { map: "", zone: "", star: "", temperature: "", n: 200 };

  /** `mapName`: the map it was opened for (work mode, preview's map kind). `tab`: the tab to open on. */
  constructor(app: App, private plugin: HexmakerPlugin, private mapName?: string, table?: string, previewMap?: WorldTypeMap, tab: WorldTypesTab = "worlds") {
    super(app);
    this.tableName = table ?? DEFAULT_WORLD_TYPES;
    this.tab = tab;
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
    this.cells = {
      worlds: (t?.rows ?? []).map((r) => worldTypeCells(r)),
      stars: (t?.stars ?? []).map((r) => starCells(r)),
      features: (t?.features ?? []).map((r) => featureCells(r)),
    };
    this.has = { stars: !!t?.stars, features: !!t?.features };
    this.dirty = false;
  }

  private rows(): WorldTypeRow[] {
    return this.cells.worlds.map((c) => readWorldTypeCells(c).row).filter((r): r is WorldTypeRow => !!r);
  }

  private stars(): StarTypeRow[] {
    return this.cells.stars.map((c) => readStarCells(c).row).filter((r): r is StarTypeRow => !!r);
  }

  private features(): SectorFeatureRow[] {
    return this.cells.features.map((c) => readFeatureCells(c).row).filter((r): r is SectorFeatureRow => !!r);
  }

  /** The table as edited here (readable rows only). */
  private table(): WorldTypeTable {
    return { name: this.tableName, rows: this.rows(), stars: this.stars(), features: this.features() };
  }

  /** The Stars / Sector features rows to save: only when the note has that table or rows were added here. */
  private extras(): WorldTypeExtras {
    const out: WorldTypeExtras = {};
    if (this.has.stars || this.cells.stars.length) out.stars = this.stars();
    if (this.has.features || this.cells.features.length) out.features = this.features();
    return out;
  }

  private firstProblem(): string | undefined {
    for (const tab of TAB_ORDER) {
      const rows = this.cells[tab];
      for (let i = 0; i < rows.length; i++) {
        const { problem } = TABS[tab].read(rows[i]);
        if (problem) return `${TABS[tab].label} row ${i + 1}: ${problem}.`;
      }
    }
    return undefined;
  }

  private async save(): Promise<void> {
    const problem = this.firstProblem();
    if (problem) { new Notice(problem); return; }
    const extras = this.extras();
    if (await this.plugin.worldTypeStore.update(this.tableName, this.rows(), extras)) {
      this.dirty = false;
      if (extras.stars) this.has.stars = true;
      if (extras.features) this.has.features = true;
    }
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
      text: `What the space generators place and how often. Each table is a note in ${store.folder()}.`,
    });
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    const problems = store.problemsOf(this.tableName);
    if (problems.length) {
      contentEl.createEl("p", {
        cls: "duckmage-world-types-problems",
        text: `The note has ${problems.length} problem${problems.length === 1 ? "" : "s"} (rows that can't be read are kept as written): ${problems.map((p) => p.text).join("; ")}`,
      });
    }

    const tabs = contentEl.createDiv({ cls: "duckmage-world-types-tabs", attr: { role: "tablist" } });
    this.tabButtons.clear();
    for (const t of TAB_ORDER) {
      const b = tabs.createEl("button", {
        text: `${TABS[t].label} (${this.cells[t].length})`,
        cls: "duckmage-world-types-tab",
        attr: { role: "tab", "aria-selected": String(t === this.tab) },
      });
      b.toggleClass("is-active", t === this.tab);
      this.tabButtons.set(t, b);
      b.addEventListener("click", () => {
        if (t === this.tab) return;
        this.tab = t;
        this.render();
      });
    }
    contentEl.createEl("p", { cls: "setting-item-description", text: this.tabHint() });

    this.rowsEl = contentEl.createDiv({ cls: "duckmage-world-types-rows" });
    this.renderRows();

    const buttons = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    const add = buttons.createEl("button", { text: "Add row" });
    if (lock) lockButton(add, lock);
    add.addEventListener("click", () => {
      if (this.lock()) return;
      const blank = TABS[this.tab].columns.map(() => "");
      if (this.tab === "worlds" && this.preview.map) blank[col("Map")] = this.preview.map;
      this.cells[this.tab].push(blank);
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

  private tabHint(): string {
    switch (this.tab) {
      case "worlds": return "Which worlds Star scatter and Orbits place, and what each world's own map is made with. Weight is the odds against the other rows that fit; blank limits mean any.";
      case "stars": return "The star Orbits puts at a system's centre when its Star option is Random. Weight is the odds against the other stars; 0 never rolls it.";
      case "features": return "Star scatter's special hexes. Chance is how likely each star system hex is to be that feature instead, like 1 in 50, 2% or never.";
    }
  }

  private newTable(head: HTMLElement): void {
    if (this.lock()) return;
    const box = head.createDiv({ cls: "duckmage-world-types-new" });
    const input = box.createEl("input", { type: "text", attr: { placeholder: "Table name", "aria-label": "New table name" } });
    const ok = box.createEl("button", { text: "Create", cls: "mod-cta" });
    input.focus();
    const go = () => {
      void this.plugin.worldTypeStore.create(input.value, this.rows(), { stars: this.stars(), features: this.features() }).then((res) => {
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
    for (const [t, b] of this.tabButtons) b.setText(`${TABS[t].label} (${this.cells[t].length})`);
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

  /** Terrain names (all palettes) of these types (any type when undefined), for suggestions. */
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
    const lists: Record<string, string> = {};
    for (const [c, types] of Object.entries(SUGGEST_TYPES)) lists[c] = this.datalist(c.toLowerCase(), this.suggestions(types));
    lists.Base = this.datalist("base", this.suggestions(undefined));
    lists.Palette = this.datalist("palettes", this.plugin.settings.terrainPalettes.map((p) => p.name));
    const spec = TABS[this.tab];
    const rows = this.cells[this.tab];
    if (!rows.length) el.createDiv({ cls: "setting-item-description", text: "No rows yet." });
    rows.forEach((cells, i) => {
      const row = el.createDiv({ cls: "duckmage-world-types-row" });
      const problem = spec.read(cells).problem;
      row.toggleClass("is-invalid", !!problem);
      if (problem) row.setAttr("title", problem);
      const line = (cls: string, columns: readonly string[]) => {
        const l = row.createDiv({ cls });
        for (const c of columns) this.cellInput(l, cells, spec, c, lists[c], !!lock, row);
        return l;
      };
      const top = this.tab === "worlds"
        ? line("duckmage-world-types-line", PICK_COLUMNS)
        : line("duckmage-world-types-line", spec.columns);
      if (this.tab === "worlds") line("duckmage-world-types-line is-setup", SETUP_COLUMNS);
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
      btn("↑", "Move up", () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; }, i === 0);
      btn("↓", "Move down", () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; }, i === rows.length - 1);
      btn("✕", "Remove row", () => { rows.splice(i, 1); }, false);
    });
  }

  private cellInput(parent: HTMLElement, cells: string[], spec: TabSpec, c: string, list: string | undefined, locked: boolean, row: HTMLElement): void {
    const i = spec.columns.indexOf(c);
    const wrap = parent.createEl("label", { cls: `duckmage-world-types-cell is-${c.toLowerCase()}` });
    wrap.createSpan({ cls: "duckmage-world-types-cell-label", text: c });
    if (spec === TABS.worlds && c === "Map") {
      const sel = wrap.createEl("select", { attr: { "aria-label": c } });
      for (const [v, text] of [["", "Any"], ["sector", "Sector"], ["system", "System"]]) sel.createEl("option", { value: v, text });
      // A value the select doesn't list (typed in the note) stays as it was.
      if (cells[i] && !["sector", "system"].includes(cells[i])) sel.createEl("option", { value: cells[i], text: cells[i] });
      sel.value = cells[i] ?? "";
      sel.disabled = locked;
      sel.addEventListener("change", () => { cells[i] = sel.value; this.cellChanged(cells, spec, row); });
      return;
    }
    const input = wrap.createEl("input", { type: "text", value: cells[i] ?? "", attr: { placeholder: PLACEHOLDERS[c] ?? "", "aria-label": c } });
    if (list) input.setAttr("list", list);
    input.disabled = locked;
    input.addEventListener("input", () => { cells[i] = input.value; this.cellChanged(cells, spec, row); });
  }

  private cellChanged(cells: string[], spec: TabSpec, row: HTMLElement): void {
    const problem = spec.read(cells).problem;
    row.toggleClass("is-invalid", !!problem);
    if (problem) row.setAttr("title", problem);
    else row.removeAttribute("title");
    this.changed();
  }

  // ── preview ────────────────────────────────────────────────────────────

  private renderPreview(): void {
    const el = this.previewEl;
    if (!el) return;
    el.empty();
    const p = this.preview;
    const controls = el.createDiv({ cls: "duckmage-world-types-preview-controls" });
    const select = (label: string, options: [string, string][], value: string, set: (v: string) => void) => {
      const l = controls.createEl("label", { text: `${label} ` });
      const s = l.createEl("select", { attr: { "aria-label": `Preview ${label.toLowerCase()}` } });
      for (const [v, t] of options) s.createEl("option", { value: v, text: t });
      s.value = value;
      s.addEventListener("change", () => { set(s.value); this.renderPreview(); });
    };
    if (this.tab === "worlds") {
      select("Map", [["", "Any"], ["sector", "Sector"], ["system", "System"]], p.map, (v) => { p.map = v as WorldTypeMap | ""; });
      select("Orbit", [["", "Any"], ...ORBIT_ZONES.map((z): [string, string] => [z, z[0].toUpperCase() + z.slice(1)])], p.zone, (v) => { p.zone = v as OrbitZone | ""; });
      select("Star", [["", "Any"], ...this.suggestions(["star"]).map((s): [string, string] => [s, s])], p.star, (v) => { p.star = v; });
      select("Temperature", [["", "Any"], ["0.1", "Cold"], ["0.3", "Cool"], ["0.5", "Mild"], ["0.7", "Warm"], ["0.9", "Hot"]], p.temperature, (v) => { p.temperature = v; });
    }
    const rollChoices: [string, string][] = this.tab === "features"
      ? [["100", "100 systems"], ["1000", "1000 systems"], ["10000", "10000 systems"]]
      : [["100", "100"], ["200", "200"], ["1000", "1000"]];
    if (!rollChoices.some(([v]) => Number(v) === p.n)) p.n = Number(rollChoices[1][0]);
    select("Rolls", rollChoices, String(p.n), (v) => { p.n = Number(v); });

    const table = this.table();
    const list = () => el.createDiv({ cls: "duckmage-world-types-dist" });
    const bar = (parent: HTMLElement, name: string, n: number, odds: string) => {
      const r = parent.createDiv({ cls: "duckmage-world-types-dist-row" });
      r.createSpan({ cls: "duckmage-world-types-dist-name", text: name });
      const b = r.createSpan({ cls: "duckmage-world-types-dist-bar" });
      b.createSpan({ cls: "duckmage-world-types-dist-fill" }).setCssProps({ "--duckmage-dist": `${Math.round((n / p.n) * 100)}%` });
      r.createSpan({ cls: "duckmage-world-types-dist-num", text: `${n} of ${p.n}` });
      r.createSpan({ cls: "duckmage-world-types-dist-odds", text: odds });
    };
    const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

    if (this.tab === "stars") {
      const odds = starOdds(table);
      if (!odds.length) {
        el.createDiv({ cls: "setting-item-description", text: "No star rows: Orbits picks the star itself." });
        return;
      }
      const rolled = new Map(rollStars(table, {}, p.n).map((r) => [r.star.toLowerCase(), r.count]));
      const l = list();
      for (const o of odds) bar(l, o.star, rolled.get(o.star.toLowerCase()) ?? 0, `odds ${pct(o.odds)}`);
      return;
    }

    if (this.tab === "features") {
      const { features, total } = sectorFeatureOdds(table);
      if (!features.length) {
        el.createDiv({ cls: "setting-item-description", text: "No feature rows: every star system hex stays a system." });
        return;
      }
      const rolled = new Map(rollSectorFeatures(table, {}, p.n).map((r) => [r.feature.toLowerCase(), r.count]));
      const l = list();
      let special = 0;
      for (const f of features) {
        const n = rolled.get(f.feature.toLowerCase()) ?? 0;
        special += n;
        bar(l, f.feature, n, `${formatChance(f.chance)} (${pct(f.chance)})`);
      }
      bar(l, "an ordinary system", p.n - special, pct(1 - total));
      return;
    }

    const ctx: Omit<WorldTypeContext, "seed" | "rand"> = {};
    if (p.map) ctx.map = p.map;
    if (p.zone) ctx.zone = p.zone;
    if (p.star) ctx.starType = p.star;
    if (p.temperature) ctx.temperature = Number(p.temperature);
    const odds = worldTypeOdds(table, ctx);
    if (!odds.length) {
      el.createDiv({ cls: "setting-item-description", text: "No row fits: nothing would be placed here." });
      return;
    }
    const rolled = new Map(rollWorldTypes(table, ctx, p.n).map((r) => [r.world.toLowerCase(), r.count]));
    const l = list();
    for (const o of odds) bar(l, o.world, rolled.get(o.world.toLowerCase()) ?? 0, `odds ${pct(o.odds)}`);
  }
}

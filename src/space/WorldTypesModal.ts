/**
 * "World types": edit a world types table (worldTypes.ts) — which worlds
 * the space generators place, how often, and what each world's own map is
 * made with — plus its Stars (Orbits' random star) and Sector features
 * (Star scatter's special hexes), one tab each. Each tab has a small
 * preview that rolls its table and shows what comes up: for a palette,
 * through the same role tables and rolls as Star scatter and Orbits
 * (worldTypesSource.ts, tableRoles.ts), so its odds are the generators'
 * odds (F3). Rows the generators can't place (not terrains of the
 * palette) are listed under it, never dropped silently.
 *
 * Rows are edited as their note cells (the same reading as the note), so
 * anything typed here reads back the same from the note. Rows the note
 * has that can't be read are listed, never touched.
 *
 * Changes save automatically, like the hex editor (SP2): a moment after
 * typing stops, and when the dialog closes. Only rows that read are
 * written; a row that doesn't is marked incomplete and stays here until
 * it's fixed or removed (it's dropped on close). Hand edits to the note
 * while the dialog is open are taken in, never overwritten
 * (worldTypesDraft.ts has the rules).
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
  formatChance,
  type OrbitZone,
  type WorldTypeColumn,
  type WorldTypeMap,
} from "./worldTypes";
import { worldTypesSource } from "./worldTypesSource";
import { ZONE_ROLES, roleOdds, rollRole, type RoleId } from "../worldgen/tableRoles";
import { starScatterOffered, starScatterRoles } from "./starScatter";
import { orbitRoles, orbitsFits } from "./orbits";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import type { TerrainColor } from "../types";
import { TAB_ORDER, WorldTypesDraft, type WorldTypesTab } from "./worldTypesDraft";
import { AUTOSAVE_MS, DebouncedSave, SAVE_STATUS_TEXT, SaveTracker, type SaveState } from "../hex-map/saveStatus";
import { isDebugMode } from "../ui/debugMode";
import { isShown, layerOf } from "../ui/placement";

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
  Mainworld: "same",
  Star: "red dwarf",
  Feature: "black hole",
  Chance: "1 in 50",
};

/** Columns shown on a row's first line (what is picked, and where); the rest are its map setup. */
const PICK_COLUMNS: WorldTypeColumn[] = ["World", "Weight", "Map", "Orbit", "Stars", "Temperature"];
const SETUP_COLUMNS: WorldTypeColumn[] = ["Mainworld", "Size", "Generator", "Options", "Palette", "Base", "Notes"];
/** Per-row cells the placement map can move (a row can't have its own dropdown: Debug ones show inline only in debug mode). */
const PLACED_CELLS: Partial<Record<WorldTypeColumn, string>> = { Generator: "WorldTypes.worldGenerator", Options: "WorldTypes.worldOptions" };
/** The preview's controls, by label. */
const PREVIEW_IDS: Record<string, string> = {
  Map: "WorldTypes.previewMap",
  Orbit: "WorldTypes.previewOrbit",
  Star: "WorldTypes.previewStar",
  Temperature: "WorldTypes.previewTemperature",
  Rolls: "WorldTypes.previewRolls",
};

const col = (c: WorldTypeColumn) => WORLD_TYPE_COLUMNS.indexOf(c);

export type { WorldTypesTab };

/** One tab's table: its columns. */
interface TabSpec {
  label: string;
  columns: readonly string[];
}

const TABS: Record<WorldTypesTab, TabSpec> = {
  worlds: { label: "Worlds", columns: WORLD_TYPE_COLUMNS },
  stars: { label: "Stars", columns: STAR_COLUMNS },
  features: { label: "Sector features", columns: FEATURE_COLUMNS },
};

/** Tooltip on the save status. */
const SAVE_TITLE = "Saves a moment after you stop typing, and when you close the dialog. Rows marked incomplete aren't saved.";

/** "1 incomplete row" / "2 incomplete rows". */
const incompleteRows = (n: number) => `${n} incomplete row${n === 1 ? "" : "s"}`;

/** Terrain types offered as suggestions for each name column. */
const SUGGEST_TYPES: Record<string, string[]> = {
  World: ["world", "gas-giant", "asteroids", "moon", "star-system", "station", "starport", "anomaly"],
  Stars: ["star"],
  Star: ["star"],
  Feature: ["station", "starport", "jump-point", "anomaly", "star-system", "rift"],
};

export class WorldTypesModal extends HexmakerModal {
  protected surfaceId = "WorldTypes";
  private tableName: string;
  private tab: WorldTypesTab;
  /** The rows being edited and when they need saving (set once the store is ready). */
  private draft: WorldTypesDraft | undefined;
  private off: (() => void) | undefined;
  private rowsEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private problemsEl: HTMLElement | undefined;
  private statusEl: HTMLElement | undefined;
  private incompleteEl: HTMLElement | undefined;
  /** The table names the picker shows (re-drawn when they change). */
  private listed = "";
  private saves = new SaveTracker(
    (state) => this.renderSaveStatus(state),
    (fn, ms) => window.setTimeout(fn, ms),
    (id) => window.clearTimeout(id),
  );
  private debounce = new DebouncedSave(
    () => this.saveNow(),
    AUTOSAVE_MS,
    (fn, ms) => window.setTimeout(fn, ms),
    (id) => window.clearTimeout(id),
  );
  private tabButtons = new Map<WorldTypesTab, HTMLButtonElement>();
  private preview: { map: WorldTypeMap; zone: OrbitZone; star: string; palette: string; n: number } = { map: "sector", zone: "habitable", star: "", palette: "", n: 200 };

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
      this.draft = new WorldTypesDraft(store, this.tableName);
      this.render();
      // Hand edits to the note show up here (worldTypesDraft.ts: sync).
      this.off = store.onChange(() => this.storeChanged());
    });
  }

  onClose(): void {
    this.off?.();
    this.saveNow();
    this.noteDropped();
    this.saves.dispose();
    this.contentEl.empty();
  }

  private lock(): string | undefined {
    return worldTypesEditLock(this.plugin, this.mapName);
  }

  /** The rows being edited, as note cells, per tab. */
  private get cells(): Record<WorldTypesTab, string[][]> {
    return this.draft?.cells ?? { worlds: [], stars: [], features: [] };
  }

  /** Save now if anything that reads changed (incomplete rows never are). */
  private saveNow(): void {
    this.debounce.cancel();
    const draft = this.draft;
    if (!draft || this.lock() || !draft.hasChanges()) {
      this.saves.settle();
      return;
    }
    void this.saves.track(draft.save().then((ok) => {
      if (!ok) throw new Error(`world types table "${draft.name}" not found`);
    }));
  }

  /** Incomplete rows are about to be dropped (close, another table): say so. */
  private noteDropped(): void {
    const n = this.draft?.incompleteCount() ?? 0;
    if (n && !this.lock()) new Notice(`World types: ${incompleteRows(n)} weren't saved.`);
  }

  /** Show another table (saving this one's changes first). */
  private switchTable(name: string): void {
    this.saveNow();
    this.noteDropped();
    this.tableName = name;
    this.draft?.load(name);
    this.render();
  }

  /** The store changed: a hand edit, our own save coming back, or another table. */
  private storeChanged(): void {
    const draft = this.draft;
    if (!draft) return;
    const { changed, replaced } = draft.sync();
    if (replaced.length) {
      const tabs = replaced.map((t) => TABS[t].label).join(" and ");
      new Notice(`The world types note was edited, so ${tabs} now show${replaced.length === 1 ? "s" : ""} the note's rows.`, 8000);
    }
    if (changed || this.tableNames() !== this.listed) {
      this.render();
    } else {
      this.renderProblems();
      this.updateStatus();
    }
  }

  private tableNames(): string {
    return this.plugin.worldTypeStore.list().map((t) => t.name).join("\n");
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
    this.listed = this.tableNames();
    sel.addEventListener("change", () => this.switchTable(sel.value));
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
        this.debounce.cancel();
        void store.restoreDefault(this.tableName).then((ok) => {
          if (!ok) return;
          this.draft?.load(this.tableName);
          this.saves.settle();
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
    // Converted (phase 3): the generators roll on the tables the note links now.
    if (store.isConverted(this.tableName)) {
      contentEl.createEl("p", {
        cls: "duckmage-locked-hint",
        text: "This table was converted to random tables: the generators roll on the tables its note links; open the note to see them. Changes here only change the old copy.",
      });
    }
    this.problemsEl = contentEl.createDiv();
    this.renderProblems();

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
      // The new row is at the bottom of the list: show it and put the
      // cursor in its first field (F9: it appeared off-screen).
      this.renderRows({ row: this.cells[this.tab].length - 1, target: "first" });
    });
    // Rows that can't be read yet, and the autosave status (as in the hex editor).
    this.incompleteEl = buttons.createSpan({ cls: "duckmage-world-types-incomplete" });
    this.statusEl = undefined;
    if (!lock) {
      this.statusEl = buttons.createSpan({
        cls: "duckmage-editor-notes-status duckmage-world-types-status",
        attr: { "aria-live": "polite", title: SAVE_TITLE },
      });
      this.renderSaveStatus(this.saves.current);
    }

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

  /** What the note has that can't be read (kept as written, not shown as rows). */
  private renderProblems(): void {
    const el = this.problemsEl;
    if (!el) return;
    el.empty();
    const problems = this.plugin.worldTypeStore.problemsOf(this.tableName);
    if (!problems.length) return;
    el.createEl("p", {
      cls: "duckmage-world-types-problems",
      text: `The note has ${problems.length} problem${problems.length === 1 ? "" : "s"} (rows that can't be read are kept as written): ${problems.map((p) => p.text).join("; ")}`,
    });
  }

  private newTable(head: HTMLElement): void {
    if (this.lock()) return;
    const box = head.createDiv({ cls: "duckmage-world-types-new" });
    const input = box.createEl("input", { type: "text", attr: { placeholder: "Table name", "aria-label": "New table name" } });
    const ok = box.createEl("button", { text: "Create", cls: "mod-cta" });
    input.focus();
    const go = () => {
      const draft = this.draft;
      if (!draft) return;
      this.saveNow();
      void this.plugin.worldTypeStore.create(input.value, draft.readable("worlds"), { stars: draft.readable("stars"), features: draft.readable("features") }).then((res) => {
        if ("error" in res) { new Notice(res.error); return; }
        this.switchTable(res.name);
      });
    };
    ok.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  /** Rows were edited: save a moment later if anything that reads changed. */
  private changed(): void {
    for (const [t, b] of this.tabButtons) b.setText(`${TABS[t].label} (${this.cells[t].length})`);
    this.updateStatus();
    this.renderPreview();
    if (this.lock()) return;
    if (this.draft?.hasChanges()) {
      this.debounce.schedule();
      this.saves.markPending();
    } else {
      // Nothing to write (only incomplete rows, or the edit was undone).
      this.debounce.cancel();
      this.saves.settle();
    }
  }

  /** How many rows can't be saved yet. */
  private updateStatus(): void {
    const el = this.incompleteEl;
    if (!el) return;
    const n = this.draft?.incompleteCount() ?? 0;
    el.setText(n ? `${incompleteRows(n)} not saved until finished.` : "");
  }

  private renderSaveStatus(state: SaveState): void {
    const el = this.statusEl;
    if (!el) return;
    el.setText(SAVE_STATUS_TEXT[state]);
    el.dataset["state"] = state;
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

  /**
   * Draw the rows. Re-drawing keeps the list's scroll position; `focus`
   * says where the cursor goes after: a row's first field (a new row,
   * scrolled into view), its move button (moving again), or the list
   * itself (after a delete, so typing never lands in the row that slid into
   * the deleted one's place, F9). `keepHeight` keeps the list as tall as
   * before (a delete) until the pointer leaves it, so rows above the
   * deleted one don't shift under the pointer.
   */
  private renderRows(focus?: { row: number; target: "first" | "up" | "down" | "list" }, keepHeight?: number): void {
    const el = this.rowsEl;
    const scrollTop = el.scrollTop;
    el.empty();
    el.setAttr("tabindex", "-1");
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
      const line = (cls: string, columns: readonly string[]) => {
        const l = row.createDiv({ cls });
        for (const c of columns) this.cellInput(l, cells, spec, c, lists[c], !!lock, row);
        return l;
      };
      const top = this.tab === "worlds"
        ? line("duckmage-world-types-line", PICK_COLUMNS)
        : line("duckmage-world-types-line", spec.columns);
      if (this.tab === "worlds") {
        const debugOn = isDebugMode(this.app);
        line("duckmage-world-types-line is-setup", SETUP_COLUMNS.filter((c) => {
          const id = PLACED_CELLS[c];
          return !id || isShown(id, debugOn);
        }));
      }
      const tools = top.createDiv({ cls: "duckmage-world-types-tools" });
      const btn = (text: string, label: string, fn: () => void, disabled: boolean, after: () => { row: number; target: "up" | "down" | "list" }, keep = false) => {
        const b = tools.createEl("button", { text, attr: { "aria-label": label, title: label } });
        b.setAttr("data-tool", text === "↑" ? "up" : text === "↓" ? "down" : "remove");
        if (lock) lockButton(b, lock);
        else b.disabled = disabled;
        b.addEventListener("click", () => {
          if (this.lock()) return;
          const height = keep ? el.scrollHeight : undefined;
          fn();
          this.changed();
          this.renderRows(after(), height);
        });
      };
      btn("↑", "Move up", () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; }, i === 0, () => ({ row: i - 1, target: "up" }));
      btn("↓", "Move down", () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; }, i === rows.length - 1, () => ({ row: i + 1, target: "down" }));
      btn("✕", "Remove row", () => { rows.splice(i, 1); }, false, () => ({ row: i, target: "list" }), true);
      this.markRow(row, cells);
    });

    // A delete keeps the list's height until the pointer leaves it.
    const gap = keepHeight !== undefined ? keepHeight - el.scrollHeight : 0;
    if (gap > 0) {
      const spacer = el.createDiv({ cls: "duckmage-world-types-spacer" });
      spacer.setCssProps({ "--duckmage-wt-spacer": `${gap}px` });
      el.addEventListener("mouseleave", () => spacer.remove(), { once: true });
    }
    el.scrollTop = scrollTop;

    if (!focus) return;
    const rowEl = el.querySelectorAll<HTMLElement>(".duckmage-world-types-row")[focus.row];
    if (focus.target === "list" || !rowEl) { el.focus({ preventScroll: true }); return; }
    const target = focus.target === "first"
      ? rowEl.querySelector<HTMLElement>("input, select")
      : rowEl.querySelector<HTMLElement>(`button[data-tool="${focus.target}"]:not(:disabled)`);
    rowEl.scrollIntoView({ block: "nearest" });
    (target ?? el).focus({ preventScroll: true });
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
      sel.addEventListener("change", () => { cells[i] = sel.value; this.cellChanged(cells, row); });
      return;
    }
    const input = wrap.createEl("input", { type: "text", value: cells[i] ?? "", attr: { placeholder: PLACEHOLDERS[c] ?? "", "aria-label": c } });
    if (list) input.setAttr("list", list);
    input.disabled = locked;
    input.addEventListener("input", () => { cells[i] = input.value; this.cellChanged(cells, row); });
  }

  private cellChanged(cells: string[], row: HTMLElement): void {
    this.markRow(row, cells);
    this.changed();
  }

  /** Mark a row that can't be read as incomplete, saying what's missing. */
  private markRow(row: HTMLElement, cells: readonly string[]): void {
    const problem = this.draft?.problem(this.tab, cells);
    row.toggleClass("is-invalid", !!problem);
    let hint = row.querySelector<HTMLElement>(".duckmage-world-types-row-hint");
    if (!problem) { hint?.remove(); return; }
    hint ??= row.createDiv({ cls: "duckmage-world-types-row-hint" });
    hint.setText(`Incomplete, not saved: ${problem}.`);
  }

  // ── preview ────────────────────────────────────────────────────────────

  /**
   * The palette the preview rolls for: the one picked, else the map's own,
   * else the first palette the previewed generator fits (by terrain types).
   */
  private previewPalette(): { name: string; terrains: TerrainColor[] } | undefined {
    const palettes = this.plugin.settings.terrainPalettes;
    const fits = this.preview.map === "system" ? orbitsFits : starScatterOffered;
    const mapPalette = this.mapName ? this.plugin.getMap(this.mapName)?.paletteName : undefined;
    const p = palettes.find((x) => x.name === this.preview.palette)
      ?? palettes.find((x) => x.name === mapPalette && fits(x.terrains))
      ?? palettes.find((x) => fits(x.terrains))
      ?? palettes[0];
    return p ? { name: p.name, terrains: p.terrains } : undefined;
  }

  private renderPreview(): void {
    const el = this.previewEl;
    if (!el) return;
    el.empty();
    const p = this.preview;
    const controls = el.createDiv({ cls: "duckmage-world-types-preview-controls" });
    // Controls the placement map puts in Debug go in a preview box there.
    const debugBox = (): HTMLElement | null => {
      const dbg = this.section("debug");
      if (!dbg) return null;
      let box = dbg.querySelector<HTMLElement>(":scope > .duckmage-world-types-preview-controls");
      if (!box) {
        dbg.createDiv({ cls: "setting-item-description", text: "Preview" });
        box = dbg.createDiv({ cls: "duckmage-world-types-preview-controls" });
      }
      return box;
    };
    debugBox()?.empty();
    const select = (label: string, options: [string, string][], value: string, set: (v: string) => void) => {
      const id = PREVIEW_IDS[label];
      const layer = id ? layerOf(id) : "main";
      const at = layer === "main" || layer === "more" ? controls : layer === "hidden" ? null : layer === "advanced" ? this.section("advanced") : debugBox();
      if (!at) return;
      const l = at.createEl("label", { text: `${label} ` });
      const s = l.createEl("select", { attr: { "aria-label": `Preview ${label.toLowerCase()}` } });
      for (const [v, t] of options) s.createEl("option", { value: v, text: t });
      s.value = value;
      s.addEventListener("change", () => { set(s.value); this.renderPreview(); });
    };
    if (this.tab === "worlds") {
      select("Map", [["sector", "Sector (Star scatter)"], ["system", "System (Orbits)"]], p.map, (v) => { p.map = v as WorldTypeMap; p.palette = ""; });
      if (p.map === "system") {
        select("Orbit", ORBIT_ZONES.map((z): [string, string] => [z, z[0].toUpperCase() + z.slice(1)]), p.zone, (v) => { p.zone = v as OrbitZone; });
        select("Star", [["", "Any"], ...this.suggestions(["star"]).map((s): [string, string] => [s, s])], p.star, (v) => { p.star = v; });
      }
    } else {
      p.map = this.tab === "stars" ? "system" : "sector";
    }
    const palette = this.previewPalette();
    if (!palette) {
      el.createDiv({ cls: "setting-item-description", text: "No palettes yet." });
      return;
    }
    select("Palette", this.plugin.settings.terrainPalettes.map((x): [string, string] => [x.name, x.name]), palette.name, (v) => { p.palette = v; });
    const rollChoices: [string, string][] = this.tab === "features"
      ? [["100", "100 systems"], ["1000", "1000 systems"], ["10000", "10000 systems"]]
      : [["100", "100"], ["200", "200"], ["1000", "1000"]];
    if (!rollChoices.some(([v]) => Number(v) === p.n)) p.n = Number(rollChoices[1][0]);
    select("Rolls", rollChoices, String(p.n), (v) => { p.n = Number(v); });

    // The generators' own roles, fallback and rolls (worldgen/tableRoles.ts).
    const table = this.draft?.table() ?? { name: this.tableName, rows: [] };
    const source = worldTypesSource(table, palette.terrains);
    const role: RoleId = this.tab === "stars" ? "star" : p.map === "system" ? ZONE_ROLES[p.zone] : "sector-hexes";
    const fallback = role === "sector-hexes"
      ? starScatterRoles(palette.terrains)?.worlds ?? []
      : role === "star" ? orbitRoles(palette.terrains)?.stars ?? [] : orbitRoles(palette.terrains)?.bodies ?? [];
    const ctx = role === "star" || role === "sector-hexes" ? {} : { zone: p.zone, ...(p.star ? { star: p.star } : {}) };
    const { odds, notes } = roleOdds(source, role, ctx, fallback);
    const rolled = new Map<string, number>();
    for (let i = 0; i < p.n; i++) {
      const pick = rollRole(source, role, { ...ctx, rand: mulberry32(i + 1) }, fallback);
      const k = pick ? pick.terrain.toLowerCase() : "";
      rolled.set(k, (rolled.get(k) ?? 0) + 1);
    }

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
    const showNotes = () => {
      // Never silently: rows the generator can't place, and equal-odds fallbacks.
      if (notes.length) el.createEl("p", { cls: "duckmage-world-types-problems", text: notes.join(" ") });
    };

    if (!odds.length) {
      el.createDiv({ cls: "setting-item-description", text: `Nothing on ${palette.name} fits: nothing would be placed here.` });
      showNotes();
      return;
    }
    const l = list();
    if (this.tab === "features") {
      const featureNames = new Set((table.features ?? []).map((f) => f.feature.trim().toLowerCase()));
      let systems = 0;
      let systemOdds = 0;
      for (const o of odds) {
        const k = o.terrain.toLowerCase();
        if (featureNames.has(k)) bar(l, o.terrain, rolled.get(k) ?? 0, `${formatChance(o.odds)} (${pct(o.odds)})`);
        else { systems += rolled.get(k) ?? 0; systemOdds += o.odds; }
      }
      bar(l, "an ordinary system", systems, pct(systemOdds));
    } else {
      for (const o of odds) bar(l, o.terrain || "(nothing)", rolled.get(o.terrain.toLowerCase()) ?? 0, `odds ${pct(o.odds)}`);
    }
    showNotes();
  }
}

/**
 * The generator page's file list: a Generators tab (load one, or tick several
 * to open, re-learn, blend or delete them), a Maps tab (tick one or more maps
 * and learn a generator from them, combined when there are several) and a
 * Saves tab (load a save, or tick to rename, open or delete).
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { blendGenerators, blendSourcesOf, deleteGenerators, generatorsFolder, relearnGenerator, saveGeneratorFromMaps, sourceMapsOf, type GeneratorFile } from "../../worldgen/generators";
import type { HexWfcModel } from "../../../packages/hex-wfc/src";
import { combinedName, generatorRows, generatorTree, regionRows, saveRows, type GeneratorGroup, type GeneratorRow, type RegionRow } from "./libraryRows";
import { deleteSaves, listSaves, renameSave, type SaveEntry } from "./saves";
import { generatorPageState } from "./generatorPageState";
import { loadSaveOntoPage } from "./sections/loadSave";
import { uniqueMapsByName } from "../../maps/mapTree";
import type { GeneratorPageHost } from "../types";
import { moduleGeneratorTabs, moduleTab } from "./sections/moduleTabs";

export interface LibraryHost {
  /** The generator shown below the list. */
  selectedPath(): string;
  /** Show this generator below the list. */
  load(g: GeneratorFile): void;
  /** Show an unsaved generator (a new blend) below the list. */
  loadDraft(model: HexWfcModel): void;
  /** Files changed (learned, re-learned, deleted): reload the page. */
  changed(selectPath?: string): void;
  /** The page, for a module's tab (its own list and page). */
  page: GeneratorPageHost;
}

/** "generators", "regions" (Maps), "saves" or a module's tab id. */
type Tab = string;

export class GeneratorLibrary {
  /** Kept across re-renders of the page. */
  static tab: Tab = "generators";
  static query = "";
  static checkedGenerators = new Set<string>();
  static checkedRegions = new Set<string>();
  static checkedSaves = new Set<string>();
  /** Generator groups opened or closed this session (T4); unset = closed. */
  static expandedGroups = new Map<string, boolean>();
  private saves: SaveEntry[];

  constructor(
    private app: App,
    private plugin: HexmakerPlugin,
    private generators: GeneratorFile[],
    private host: LibraryHost,
  ) {
    // Forget ticks on files that are gone.
    const paths = new Set(generators.map((g) => g.file.path));
    for (const p of GeneratorLibrary.checkedGenerators) if (!paths.has(p)) GeneratorLibrary.checkedGenerators.delete(p);
    for (const r of GeneratorLibrary.checkedRegions) if (!plugin.getMap(r)) GeneratorLibrary.checkedRegions.delete(r);
    this.saves = listSaves(plugin);
    const savePaths = new Set(this.saves.map((sv) => sv.file.path));
    for (const p of GeneratorLibrary.checkedSaves) if (!savePaths.has(p)) GeneratorLibrary.checkedSaves.delete(p);
  }

  render(el: HTMLElement): void {
    const box = el.createDiv({ cls: "duckmage-wfc-library" });
    const top = box.createDiv({ cls: "duckmage-wfc-library-top" });
    const tabs = top.createDiv({ cls: "duckmage-wfc-library-tabs", attr: { role: "tablist" } });
    const filter = top.createEl("input", {
      type: "search",
      cls: "duckmage-wfc-library-filter",
      attr: { placeholder: "Filter generators…", "aria-label": "Filter generators" },
      value: GeneratorLibrary.query,
    });
    const list = box.createDiv({ cls: "duckmage-wfc-library-list" });
    const actions = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-library-actions" });

    const tabBtn = (tab: Tab, label: string, count: number) => {
      const btn = tabs.createEl("button", { cls: "duckmage-wfc-library-tab", attr: { role: "tab" } });
      btn.createSpan({ text: label });
      btn.createSpan({ text: String(count), cls: "duckmage-wfc-library-count" });
      btn.addEventListener("click", () => {
        const page = !!moduleTab(tab) || !!moduleTab(GeneratorLibrary.tab);
        GeneratorLibrary.tab = tab;
        draw();
        // A module's tab has its own page below the list.
        if (page) this.host.page.show();
      });
      return { tab, btn };
    };
    const tabBtns = [
      tabBtn("generators", "Generators", this.generators.length),
      tabBtn("regions", "Maps", uniqueMapsByName(this.plugin.settings.maps).length),
      tabBtn("saves", "Saves", this.saves.length),
      ...moduleGeneratorTabs().map((t) => tabBtn(t.id, t.label, t.count(this.plugin))),
    ];

    const draw = () => {
      for (const { tab, btn } of tabBtns) {
        const on = tab === GeneratorLibrary.tab;
        btn.toggleClass("is-active", on);
        btn.setAttr("aria-selected", String(on));
      }
      const mod = moduleTab(GeneratorLibrary.tab);
      const things = mod ? mod.label.toLowerCase() : GeneratorLibrary.tab === "generators" ? "generators" : GeneratorLibrary.tab === "saves" ? "saves" : "maps";
      filter.placeholder = `Filter ${things}…`;
      filter.setAttr("aria-label", `Filter ${things}`);
      list.empty();
      actions.empty();
      if (mod) mod.drawList(this.plugin, list, actions, { query: GeneratorLibrary.query, redraw: draw, host: this.host.page });
      else if (GeneratorLibrary.tab === "generators") this.drawGenerators(list, actions, draw);
      else if (GeneratorLibrary.tab === "saves") this.drawSaves(list, actions, draw);
      else this.drawRegions(list, actions, draw);
    };
    filter.addEventListener("input", () => {
      GeneratorLibrary.query = filter.value;
      draw();
    });
    draw();
  }

  // ── Generators tab ───────────────────────────────────────────────────────

  private drawGenerators(list: HTMLElement, actions: HTMLElement, redraw: () => void): void {
    const checked = GeneratorLibrary.checkedGenerators;
    const folder = generatorsFolder(this.plugin);
    const rows = generatorRows(
      this.generators.map((g) => ({
        path: g.file.path,
        name: g.model.name,
        sources: sourceMapsOf(g.model),
        palette: g.model.meta.palette,
        terrains: g.model.terrains.length,
        created: g.model.meta.created,
        folder: g.file.parent && g.file.parent.path.startsWith(folder + "/") ? g.file.parent.path.slice(folder.length + 1) : "",
      })),
      GeneratorLibrary.query,
    );
    // Yours at the top; preset families and subfolders as groups, closed
    // until opened (T4). Same row type and columns throughout.
    const tree = generatorTree(rows, { query: GeneratorLibrary.query, expanded: GeneratorLibrary.expandedGroups, current: this.host.selectedPath() });
    const table = list.createDiv({ cls: "duckmage-wfc-library-table is-generators" });
    this.header(table, ["Name", "From", "Palette", "Terrains", "Created"], tree.visible.map((r) => r.path), checked, redraw);
    const generatorRow = (r: GeneratorRow, inGroup: boolean) => {
      const row = this.row(table, r.path, checked, redraw);
      row.toggleClass("is-in-group", inGroup);
      if (r.path === this.host.selectedPath()) row.addClass("is-current");
      this.cells(row, [r.name, r.from || "–", r.palette || "–", String(r.terrains), r.created || "–"]);
      row.setAttr("title", "Click to load; tick to select");
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        const g = this.generators.find((x) => x.file.path === r.path);
        if (g) this.host.load(g);
        redraw();
      });
    };
    for (const r of tree.top) generatorRow(r, false);
    for (const group of tree.groups) {
      this.groupRow(table, group, checked, redraw);
      if (group.open) for (const r of group.rows) generatorRow(r, true);
    }
    if (!rows.length) list.createDiv({ text: this.generators.length ? "No generators match." : "No generators yet. Learn one on the Maps tab.", cls: "duckmage-empty-state" });

    const selected = this.generators.filter((g) => checked.has(g.file.path));
    actions.createSpan({ text: selected.length ? `${selected.length} selected` : "Tick generators to act on them", cls: "duckmage-map-origin-desc" });
    const open = actions.createEl("button", { text: "Open file" });
    const relearn = actions.createEl("button", { text: "Re-learn", attr: { title: "Learn again from the maps they came from, keeping their settings" } });
    const blend = actions.createEl("button", {
      text: selected.length > 1 ? `Blend (${selected.length})` : "Blend",
      attr: { title: "Try a blend of these, each leaning toward its own side of the map: the border country between them. It isn't saved until you choose to." },
    });
    const del = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
    for (const b of [open, relearn, del]) b.disabled = !selected.length;
    relearn.disabled ||= !selected.some((g) => sourceMapsOf(g.model).length || blendSourcesOf(g.model).length);
    blend.disabled = selected.length < 2;
    blend.addEventListener("click", () => {
      const r = blendGenerators(this.plugin, selected);
      if ("error" in r) {
        new Notice(r.error);
        return;
      }
      checked.clear();
      redraw();
      this.host.loadDraft(r.model);
    });
    open.addEventListener("click", () => {
      for (const g of selected) void this.app.workspace.getLeaf("tab").openFile(g.file);
    });
    relearn.addEventListener("click", () => {
      relearn.disabled = true;
      void (async () => {
        const failed: string[] = [];
        for (const g of selected) {
          const r = await relearnGenerator(this.plugin, g);
          if ("error" in r) failed.push(`${g.model.name}: ${r.error}`);
        }
        const done = selected.length - failed.length;
        if (done) new Notice(`Re-learned ${done} generator${done === 1 ? "" : "s"}.`);
        for (const f of failed) new Notice(`Couldn't re-learn ${f}`);
        this.host.changed();
      })();
    });
    // No confirm (owner Q6): it goes to the trash, and saves keep a copy.
    del.addEventListener("click", () => {
      const names = selected.map((g) => g.model.name);
      const what = names.length === 1 ? `"${names[0]}"` : `${names.length} generators`;
      void deleteGenerators(this.plugin, selected.map((g) => g.file)).then(() => {
        for (const g of selected) checked.delete(g.file.path);
        new Notice(`Moved ${what} to the trash. Saves made from ${names.length === 1 ? "it" : "them"} keep a copy.`);
        this.host.changed();
      });
    });
  }

  // ── Regions tab ──────────────────────────────────────────────────────────

  private drawRegions(list: HTMLElement, actions: HTMLElement, redraw: () => void): void {
    const checked = GeneratorLibrary.checkedRegions;
    const rows: RegionRow[] = regionRows(
      uniqueMapsByName(this.plugin.settings.maps).map((m) => ({ name: m.name, cols: m.gridSize.cols, rows: m.gridSize.rows, palette: m.paletteName })),
      this.generators.map((g) => ({ path: g.file.path, name: g.model.name, sources: sourceMapsOf(g.model), terrains: g.model.terrains.length })),
      GeneratorLibrary.query,
    );
    const table = list.createDiv({ cls: "duckmage-wfc-library-table is-regions" });
    this.header(table, ["Map", "Size", "Palette", "Generators"], rows.map((r) => r.name), checked, redraw);
    for (const r of rows) {
      const row = this.row(table, r.name, checked, redraw);
      this.cells(row, [this.plugin.mapLabel(r.name), r.size, r.palette, r.generators ? String(r.generators) : "–"]);
      // The whole row ticks the region.
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        if (!checked.delete(r.name)) checked.add(r.name);
        redraw();
      });
    }
    if (!rows.length) list.createDiv({ text: "No maps match.", cls: "duckmage-empty-state" });

    // Keep the order the regions were ticked in; it names the generator.
    const picked = [...checked];
    const nameInput = actions.createEl("input", {
      type: "text",
      attr: { placeholder: picked.length ? combinedName(picked) : "Generator name" },
    });
    const learn = actions.createEl("button", {
      text: picked.length > 1 ? `Learn combined generator (${picked.length} maps)` : "Learn generator",
      cls: "mod-cta",
    });
    learn.disabled = !picked.length;
    const palettes = new Set(picked.map((n) => this.plugin.getMap(n)?.paletteName));
    if (palettes.size > 1) {
      actions.createDiv({
        text: `⚠ These maps use different palettes; the generator uses ${this.plugin.getMap(picked[0])?.paletteName ?? "the first"}'s.`,
        cls: "duckmage-map-origin-desc duckmage-wfc-library-note",
      });
    } else if (!picked.length) {
      actions.createDiv({ text: "Tick one map, or several to combine them into one generator.", cls: "duckmage-map-origin-desc duckmage-wfc-library-note" });
    }
    learn.addEventListener("click", () => {
      learn.disabled = true;
      learn.setText("Learning…");
      void saveGeneratorFromMaps(this.plugin, picked, nameInput.value || combinedName(picked)).then((result) => {
        if ("error" in result) {
          new Notice(result.error);
          redraw();
          return;
        }
        const { model, file } = result;
        new Notice(`Learned generator "${model.name}" from ${picked.join(" + ")}: ${model.terrains.length} terrains, ${model.adjacency.length} neighbour pairs.`);
        checked.clear();
        GeneratorLibrary.tab = "generators";
        this.host.changed(file.path);
      });
    });
  }

  // ── Saves tab ────────────────────────────────────────────────────────────

  private drawSaves(list: HTMLElement, actions: HTMLElement, redraw: () => void): void {
    const checked = GeneratorLibrary.checkedSaves;
    const day = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const rows = saveRows(
      this.saves.map((sv) => ({ path: sv.file.path, name: sv.name, generator: sv.generator, seed: sv.seed, size: sv.size, saved: day(sv.file.stat.mtime), mtime: sv.file.stat.mtime })),
      GeneratorLibrary.query,
    );
    const table = list.createDiv({ cls: "duckmage-wfc-library-table is-saves" });
    this.header(table, ["Name", "Generator", "Seed", "Size", "Saved"], rows.map((r) => r.path), checked, redraw);
    for (const r of rows) {
      const row = this.row(table, r.path, checked, redraw);
      if (r.name === generatorPageState.loadedSave?.name) row.addClass("is-current");
      this.cells(row, [r.name, r.generator || "–", r.seed || "–", r.size || "–", r.saved]);
      row.setAttr("title", "Click to load; tick to select");
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        const sv = this.saves.find((x) => x.file.path === r.path);
        if (sv) void loadSaveOntoPage(this.plugin, sv.file, () => this.host.changed());
      });
    }
    if (!rows.length) list.createDiv({ text: this.saves.length ? "No saves match." : "No saves yet. Save a preview with Save, under the preview.", cls: "duckmage-empty-state" });

    const selected = this.saves.filter((sv) => checked.has(sv.file.path));
    actions.createSpan({ text: selected.length ? `${selected.length} selected` : "Tick saves to act on them", cls: "duckmage-map-origin-desc" });
    const nameInput = actions.createEl("input", {
      type: "text",
      cls: "duckmage-wfc-save-rename",
      attr: { placeholder: selected.length === 1 ? selected[0].name : "New name", "aria-label": "New name for the save" },
    });
    nameInput.disabled = selected.length !== 1;
    if (selected.length === 1) nameInput.value = selected[0].file.basename;
    const rename = actions.createEl("button", { text: "Rename", attr: { title: "Rename the ticked save (tick one)" } });
    const open = actions.createEl("button", { text: "Open file" });
    const del = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
    rename.disabled = selected.length !== 1;
    open.disabled = del.disabled = !selected.length;
    const doRename = () => {
      const sv = selected[0];
      // Enter can come again before the rename is done.
      if (selected.length !== 1 || !sv || rename.disabled) return;
      rename.disabled = true;
      const oldName = sv.name, oldPath = sv.file.path;
      renameSave(this.plugin, sv.file, nameInput.value)
        .then((r) => {
          if ("error" in r) {
            new Notice(r.error);
            rename.disabled = false;
            return;
          }
          checked.delete(oldPath);
          checked.add(r.file.path);
          const loaded = generatorPageState.loadedSave;
          if (loaded?.name === oldName) generatorPageState.loadedSave = { ...loaded, name: r.name };
          new Notice(`Renamed "${oldName}" to "${r.name}".`);
          // The new name may not be in the metadata cache yet.
          activeWindow.setTimeout(() => this.host.changed(), 300);
        })
        .catch((e: unknown) => {
          new Notice(`Couldn't rename "${oldName}": ${e instanceof Error ? e.message : String(e)}`);
          rename.disabled = false;
        });
    };
    rename.addEventListener("click", doRename);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doRename();
    });
    open.addEventListener("click", () => {
      for (const sv of selected) void this.app.workspace.getLeaf("tab").openFile(sv.file);
    });
    // No confirm, like generators (owner Q6): it goes to the trash.
    del.addEventListener("click", () => {
      const what = selected.length === 1 ? `"${selected[0].name}"` : `${selected.length} saves`;
      del.disabled = true;
      void deleteSaves(this.plugin, selected.map((sv) => sv.file)).then(() => {
        for (const sv of selected) checked.delete(sv.file.path);
        new Notice(`Moved ${what} to the trash.`);
        this.host.changed();
      });
    });
  }

  // ── Table parts ──────────────────────────────────────────────────────────

  private header(table: HTMLElement, titles: string[], keys: string[], checked: Set<string>, redraw: () => void): void {
    const head = table.createDiv({ cls: "duckmage-wfc-library-row is-head" });
    const all = head.createEl("input", { type: "checkbox", attr: { "aria-label": "Select all shown" } });
    const shownChecked = keys.filter((k) => checked.has(k)).length;
    all.checked = keys.length > 0 && shownChecked === keys.length;
    all.indeterminate = shownChecked > 0 && shownChecked < keys.length;
    all.addEventListener("change", () => {
      for (const k of keys) {
        if (all.checked) checked.add(k);
        else checked.delete(k);
      }
      redraw();
    });
    for (const t of titles) head.createSpan({ text: t });
  }

  /**
   * A group of generators (T4): the same row, its tick ticking every row in
   * it, its name with the tree's ▸/▾ toggle and a count. Click to open or close.
   */
  private groupRow(table: HTMLElement, group: GeneratorGroup, checked: Set<string>, redraw: () => void): void {
    const row = table.createDiv({ cls: "duckmage-wfc-library-row is-group" });
    const keys = group.rows.map((r) => r.path);
    const ticked = keys.filter((k) => checked.has(k)).length;
    const box = row.createEl("input", { type: "checkbox", attr: { "aria-label": `Select all ${group.label}` } });
    box.checked = ticked > 0 && ticked === keys.length;
    box.indeterminate = ticked > 0 && ticked < keys.length;
    row.toggleClass("is-checked", box.checked);
    box.addEventListener("change", () => {
      for (const k of keys) {
        if (box.checked) checked.add(k);
        else checked.delete(k);
      }
      redraw();
    });
    const name = row.createSpan({ cls: "duckmage-wfc-library-group-name", attr: { title: group.label } });
    const toggle = name.createSpan({ cls: "duckmage-map-tree-toggle", text: group.open ? "▾" : "▸", attr: { role: "button", "aria-label": group.open ? "Collapse" : "Expand" } });
    name.createSpan({ text: `${group.label} (${keys.length})` });
    for (let i = 0; i < 4; i++) row.createSpan();
    row.setAttr("title", group.open ? "Click to close" : "Click to open");
    const flip = () => {
      GeneratorLibrary.expandedGroups.set(group.key, !group.open);
      redraw();
    };
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      flip();
    });
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("input, .duckmage-map-tree-toggle")) return;
      flip();
    });
  }

  private row(table: HTMLElement, key: string, checked: Set<string>, redraw: () => void): HTMLElement {
    const row = table.createDiv({ cls: "duckmage-wfc-library-row" });
    row.toggleClass("is-checked", checked.has(key));
    const box = row.createEl("input", { type: "checkbox" });
    box.checked = checked.has(key);
    box.addEventListener("change", () => {
      if (box.checked) checked.add(key);
      else checked.delete(key);
      redraw();
    });
    return row;
  }

  private cells(row: HTMLElement, values: string[]): void {
    for (const v of values) row.createSpan({ text: v, attr: { title: v } });
  }
}

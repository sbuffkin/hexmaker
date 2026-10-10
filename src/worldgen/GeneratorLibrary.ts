/**
 * The generator page's file list: a Generators tab (load one, or tick several
 * to open, re-learn, blend or delete them) and a Regions tab (tick one or more maps
 * and learn a generator from them, combined when there are several).
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { blendGenerators, blendSourcesOf, deleteGenerators, relearnGenerator, saveGeneratorFromMaps, sourceMapsOf, type GeneratorFile } from "./generators";
import type { HexWfcModel } from "../../packages/hex-wfc/src";
import { combinedName, generatorRows, regionRows, type RegionRow } from "./libraryRows";
import { ConfirmModal } from "./ConfirmModal";

export interface LibraryHost {
  /** The generator shown below the list. */
  selectedPath(): string;
  /** Show this generator below the list. */
  load(g: GeneratorFile): void;
  /** Show an unsaved generator (a new blend) below the list. */
  loadDraft(model: HexWfcModel): void;
  /** Files changed (learned, re-learned, deleted): reload the page. */
  changed(selectPath?: string): void;
}

type Tab = "generators" | "regions";

export class GeneratorLibrary {
  /** Kept across re-renders of the page. */
  static tab: Tab = "generators";
  static query = "";
  static checkedGenerators = new Set<string>();
  static checkedRegions = new Set<string>();

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
  }

  render(el: HTMLElement): void {
    const box = el.createDiv({ cls: "duckmage-wfc-library" });
    const top = box.createDiv({ cls: "duckmage-wfc-library-top" });
    const tabs = top.createDiv({ cls: "duckmage-wfc-library-tabs", attr: { role: "tablist" } });
    const filter = top.createEl("input", {
      type: "search",
      cls: "duckmage-wfc-library-filter",
      attr: { placeholder: "Filter…" },
      value: GeneratorLibrary.query,
    });
    const list = box.createDiv({ cls: "duckmage-wfc-library-list" });
    const actions = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-library-actions" });

    const tabBtn = (tab: Tab, label: string, count: number) => {
      const btn = tabs.createEl("button", { cls: "duckmage-wfc-library-tab", attr: { role: "tab" } });
      btn.createSpan({ text: label });
      btn.createSpan({ text: String(count), cls: "duckmage-wfc-library-count" });
      btn.addEventListener("click", () => {
        GeneratorLibrary.tab = tab;
        draw();
      });
      return { tab, btn };
    };
    const tabBtns = [
      tabBtn("generators", "Generators", this.generators.length),
      tabBtn("regions", "Maps", this.plugin.settings.maps.length),
    ];

    const draw = () => {
      for (const { tab, btn } of tabBtns) {
        const on = tab === GeneratorLibrary.tab;
        btn.toggleClass("is-active", on);
        btn.setAttr("aria-selected", String(on));
      }
      list.empty();
      actions.empty();
      if (GeneratorLibrary.tab === "generators") this.drawGenerators(list, actions, draw);
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
    const rows = generatorRows(
      this.generators.map((g) => ({
        path: g.file.path,
        name: g.model.name,
        sources: sourceMapsOf(g.model),
        palette: g.model.meta.palette,
        terrains: g.model.terrains.length,
        created: g.model.meta.created,
      })),
      GeneratorLibrary.query,
    );
    const table = list.createDiv({ cls: "duckmage-wfc-library-table is-generators" });
    this.header(table, ["Name", "From", "Palette", "Terrains", "Created"], rows.map((r) => r.path), checked, redraw);
    for (const r of rows) {
      const row = this.row(table, r.path, checked, redraw);
      if (r.path === this.host.selectedPath()) row.addClass("is-current");
      this.cells(row, [r.name, r.from || "–", r.palette || "–", String(r.terrains), r.created || "–"]);
      row.setAttr("title", "Click to load; tick to select");
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        const g = this.generators.find((x) => x.file.path === r.path);
        if (g) this.host.load(g);
        redraw();
      });
    }
    if (!rows.length) list.createDiv({ text: this.generators.length ? "No generator matches." : "No generators yet. Learn one on the Maps tab.", cls: "duckmage-wfc-library-empty" });

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
    del.addEventListener("click", () => {
      const names = selected.map((g) => g.model.name);
      const what = names.length === 1 ? `"${names[0]}"` : `${names.length} generators`;
      new ConfirmModal(
        this.app,
        names.length === 1 ? "Delete generator" : "Delete generators",
        `Move ${what} to the trash?${names.length > 1 ? ` (${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""})` : ""} Saves made from ${names.length === 1 ? "it keep a copy of it, so they" : "them keep a copy, so they"} can still be loaded.`,
        "Delete",
        () => {
          void deleteGenerators(this.plugin, selected.map((g) => g.file)).then(() => {
            for (const g of selected) checked.delete(g.file.path);
            new Notice(`Deleted ${what}.`);
            this.host.changed();
          });
        },
      ).open();
    });
  }

  // ── Regions tab ──────────────────────────────────────────────────────────

  private drawRegions(list: HTMLElement, actions: HTMLElement, redraw: () => void): void {
    const checked = GeneratorLibrary.checkedRegions;
    const rows: RegionRow[] = regionRows(
      this.plugin.settings.maps.map((m) => ({ name: m.name, cols: m.gridSize.cols, rows: m.gridSize.rows, palette: m.paletteName })),
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
    if (!rows.length) list.createDiv({ text: "No map matches.", cls: "duckmage-wfc-library-empty" });

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

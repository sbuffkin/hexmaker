/**
 * The terrain generator page: pick a region (map) and palette, learn a
 * generator from the region, adjust a generator's settings (saved to its
 * file's frontmatter) with a live preview, and fill or regenerate the region.
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { VIEW_TYPE_HEX_MAP } from "../constants";
import type { HexMapView } from "../hex-map/HexMapView";
import {
  listGenerators,
  saveGeneratorFromMap,
  saveGeneratorSettings,
  generateTerrain,
  generatorFitsPalette,
  paletteColors,
  pathColors,
  fillMap,
  relearnGenerator,
  LOCK_KEY,
  type GeneratorFile,
} from "./generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import {
  resolveSettings,
  randomSeed,
  SYMMETRIES,
  type GeneratorSettings,
  type Symmetry,
  type CountRange,
} from "../../packages/hex-wfc/src";

export interface GeneratorPanelHost {
  /** Re-render the whole page (e.g. after learning a new generator). */
  rerender(): void;
}

const SYMMETRY_LABELS: Record<Symmetry, string> = {
  none: "None",
  "left-right": "Left–right",
  "top-bottom": "Top–bottom",
  both: "Both",
};

export class GeneratorPanel {
  /** Selections survive re-renders. */
  static selectedPath = "";
  static mapName = "";
  static paletteName = "";
  private seed = randomSeed();
  private previewCols = 30;
  private previewRows = 20;
  private previewTimer: number | null = null;

  constructor(
    private app: App,
    private plugin: HexmakerPlugin,
    private host: GeneratorPanelHost,
  ) {
    const maps = plugin.settings.maps;
    if (!maps.some((m) => m.name === GeneratorPanel.mapName)) {
      const active = (app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0]?.view as HexMapView | undefined)?.activeMapName;
      GeneratorPanel.mapName = active ?? plugin.settings.defaultMap ?? maps[0]?.name ?? "";
    }
    if (!plugin.settings.terrainPalettes.some((p) => p.name === GeneratorPanel.paletteName))
      GeneratorPanel.paletteName = plugin.getMap(GeneratorPanel.mapName)?.paletteName ?? plugin.settings.terrainPalettes[0]?.name ?? "";
    const map = plugin.getMap(GeneratorPanel.mapName);
    if (map && map.gridSize.cols * map.gridSize.rows <= PREVIEW_AUTO_LIMIT) {
      this.previewCols = map.gridSize.cols;
      this.previewRows = map.gridSize.rows;
    }
  }

  private get mapName(): string {
    return GeneratorPanel.mapName;
  }

  private paletteTerrains(): string[] {
    return this.plugin.getPaletteByName(GeneratorPanel.paletteName)?.terrains.map((t) => t.name) ?? [];
  }

  render(el: HTMLElement): void {
    el.empty();
    el.addClass("duckmage-wfc-tab");
    el.createEl("h3", { text: "Terrain generator" });
    this.renderRegion(el);
    this.renderLearn(el);

    el.createEl("h4", { text: "Generator" });
    const pickRow = el.createDiv({ cls: "duckmage-region-row" });
    pickRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
    const paletteSelect = pickRow.createEl("select");
    for (const p of this.plugin.settings.terrainPalettes) paletteSelect.createEl("option", { value: p.name, text: p.name });
    paletteSelect.value = GeneratorPanel.paletteName;
    const select = pickRow.createEl("select", { cls: "duckmage-map-new-palette-select" });
    const openBtn = pickRow.createEl("button", { text: "Open file" });
    openBtn.disabled = true;
    const relearnBtn = pickRow.createEl("button", { text: "Re-learn", attr: { title: "Learn again from the region it came from, keeping its settings" } });
    relearnBtn.disabled = true;
    const body = el.createDiv();
    let generators: GeneratorFile[] = [];
    const current = () => generators.find((g) => g.file.path === select.value);

    const show = () => {
      GeneratorPanel.selectedPath = select.value;
      body.empty();
      const g = current();
      openBtn.disabled = !g;
      relearnBtn.disabled = !g?.model.meta["source-map"];
      if (g) this.renderGenerator(body, g);
      else
        body.createEl("p", {
          text: generators.length ? "No generators for this palette yet." : "No generators yet. Pick a region above and learn from it.",
          cls: "duckmage-map-origin-desc",
        });
    };
    const fill = () => {
      const names = this.paletteTerrains();
      const fitting = generators.filter((g) => g.model.meta.palette === GeneratorPanel.paletteName || generatorFitsPalette(g.model, names));
      select.empty();
      if (!fitting.length) select.createEl("option", { value: "", text: "None" });
      for (const g of fitting) select.createEl("option", { value: g.file.path, text: g.model.name });
      select.value = fitting.some((g) => g.file.path === GeneratorPanel.selectedPath)
        ? GeneratorPanel.selectedPath
        : (fitting[0]?.file.path ?? "");
      show();
    };
    select.addEventListener("change", show);
    paletteSelect.addEventListener("change", () => {
      GeneratorPanel.paletteName = paletteSelect.value;
      fill();
    });
    openBtn.addEventListener("click", () => {
      const g = current();
      if (g) void this.app.workspace.getLeaf("tab").openFile(g.file);
    });
    relearnBtn.addEventListener("click", () => {
      const g = current();
      if (!g) return;
      relearnBtn.disabled = true;
      void relearnGenerator(this.plugin, g).then((r) => {
        if ("error" in r) {
          new Notice(r.error);
          relearnBtn.disabled = false;
          return;
        }
        new Notice(`Re-learned "${g.model.name}" from ${g.model.meta["source-map"]}.`);
        this.host.rerender();
      });
    });

    select.createEl("option", { value: "", text: "Loading…" });
    void listGenerators(this.plugin).then((list) => {
      generators = list;
      fill();
    });
  }

  // ── Region ───────────────────────────────────────────────────────────────

  /** Searchable list of maps; the chosen one is learned from and filled. */
  private renderRegion(el: HTMLElement): void {
    el.createEl("h4", { text: "Region" });
    const search = el.createEl("input", {
      type: "search",
      cls: "duckmage-wfc-filter",
      attr: { placeholder: "Search regions…" },
    });
    const list = el.createDiv({ cls: "duckmage-wfc-chips duckmage-wfc-regions" });
    const render = () => {
      list.empty();
      const q = search.value.trim().toLowerCase();
      const maps = this.plugin.settings.maps.filter((m) => !q || m.name.toLowerCase().includes(q));
      if (!maps.length) list.createSpan({ text: "No matching region", cls: "duckmage-map-origin-desc" });
      for (const m of maps.slice(0, 40)) {
        const btn = list.createEl("button", {
          cls: "duckmage-wfc-chip" + (m.name === this.mapName ? " is-selected" : ""),
          attr: { title: `${m.gridSize.cols}×${m.gridSize.rows}, palette ${m.paletteName}` },
        });
        btn.createSpan({ text: m.name });
        btn.addEventListener("click", () => {
          GeneratorPanel.mapName = m.name;
          GeneratorPanel.paletteName = m.paletteName;
          this.host.rerender();
        });
      }
    };
    search.addEventListener("input", render);
    render();
  }

  // ── Learn ────────────────────────────────────────────────────────────────

  private renderLearn(el: HTMLElement): void {
    el.createEl("h4", { text: `Learn from ${this.mapName || "a region"}` });
    el.createEl("p", {
      text: "Make a wave function collapse generator from the terrain and paths on this region. Terrains that never touch here never touch in generated maps, and each terrain keeps its shape and relative size.",
      cls: "duckmage-map-origin-desc",
    });
    const row = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = row.createEl("input", { type: "text", value: this.mapName, placeholder: "generator-name" });
    const btn = row.createEl("button", { text: "Generate solver from region", cls: "mod-cta" });
    btn.disabled = !this.mapName;
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void saveGeneratorFromMap(this.plugin, this.mapName, nameInput.value).then((result) => {
        btn.disabled = false;
        if ("error" in result) {
          new Notice(result.error);
          return;
        }
        const { model, file } = result;
        new Notice(`Saved generator "${model.name}": ${model.terrains.length} terrains, ${model.adjacency.length} neighbour pairs.`);
        GeneratorPanel.selectedPath = file.path;
        GeneratorPanel.paletteName = model.meta.palette ?? GeneratorPanel.paletteName;
        this.host.rerender();
      });
    });
  }

  // ── One generator ────────────────────────────────────────────────────────

  private renderGenerator(el: HTMLElement, g: GeneratorFile): void {
    const { model } = g;
    const colors = paletteColors(this.plugin, GeneratorPanel.paletteName);
    // One short line; the per-shape breakdown is on hover.
    const byShape = (shape: string) => model.terrains.filter((t) => (t.shape ?? "none") === shape).map((t) => t.name);
    const detail = (["blob", "line", "scatter", "none"] as const)
      .filter((shape) => byShape(shape).length)
      .map((shape) => `${shape}: ${byShape(shape).join(", ")}`);
    if (model.paths?.length) detail.push(`paths: ${[...new Set(model.paths.map((p) => p.type))].join(", ")}`);
    const summary = el.createEl("p", {
      text: `${model.terrains.length} terrains${model.meta["source-map"] ? ` · from ${model.meta["source-map"]}` : ""}${g.warnings.length ? ` · ⚠ ${g.warnings.length}` : ""}`,
      cls: "duckmage-map-origin-desc",
    });
    summary.setAttr("title", [...detail, ...g.warnings].join("\n"));

    // Current settings, kept in sync with the file.
    const s = () => resolveSettings(model);
    const save = (patch: Partial<Record<keyof GeneratorSettings, unknown>>) => {
      const next: Record<string, unknown> = { ...(model.settings ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      model.settings = next;
      saveGeneratorSettings(this.plugin, g.file, patch).catch((e: unknown) => {
        new Notice(`Couldn't save generator settings: ${e instanceof Error ? e.message : String(e)}`);
      });
      schedulePreview();
    };

    // Preview
    const previewBox = el.createDiv({ cls: "duckmage-wfc-section" });
    const canvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const status = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const previewRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    previewRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = previewRow.createEl("input", { type: "number", value: String(this.seed), cls: "duckmage-wfc-seed" });
    const rerollBtn = previewRow.createEl("button", { text: "Re-roll" });
    previewRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    const colsInput = previewRow.createEl("input", { type: "number", value: String(this.previewCols), cls: "duckmage-wfc-num" });
    previewRow.createSpan({ text: "×" });
    const rowsInput = previewRow.createEl("input", { type: "number", value: String(this.previewRows), cls: "duckmage-wfc-num" });
    const previewBtn = previewRow.createEl("button", { text: "Preview" });

    const runPreview = () => {
      this.previewCols = Math.max(2, Math.min(200, Number(colsInput.value) || 30));
      this.previewRows = Math.max(2, Math.min(200, Number(rowsInput.value) || 20));
      this.seed = Number(seedInput.value) >>> 0;
      const map = this.plugin.getMap(this.mapName);
      const grid = {
        cols: this.previewCols,
        rows: this.previewRows,
        offset: { x: 0, y: 0 },
        stagger: map?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd",
      };
      const palette = this.paletteTerrains().length ? this.paletteTerrains() : model.terrains.map((t) => t.name);
      const r = generateTerrain(this.plugin, model, palette, grid, this.seed);
      if (!r.ok) {
        status.setText(`Couldn't generate: ${r.message}`);
        return;
      }
      drawPreview(canvas, r.cells, grid, this.plugin.settings.hexOrientation, colors, r.featureCells, r.paths, pathColors(this.plugin));
      // Short: size and time, plus a hoverable count if anything didn't fit.
      status.setText(`${grid.cols}×${grid.rows} · ${r.stats.ms} ms${r.warnings.length ? ` · ⚠ ${r.warnings.length}` : ""}`);
      status.setAttr("title", r.warnings.join("\n"));
    };
    const schedulePreview = () => {
      if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
      if (Number(colsInput.value) * Number(rowsInput.value) > PREVIEW_AUTO_LIMIT) {
        status.setText("Large map: use the preview button to generate it.");
        return;
      }
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = null;
        runPreview();
      }, 200);
    };
    rerollBtn.addEventListener("click", () => {
      seedInput.value = String(randomSeed());
      runPreview();
    });
    previewBtn.addEventListener("click", runPreview);
    for (const input of [seedInput, colsInput, rowsInput]) input.addEventListener("change", schedulePreview);

    this.renderFill(el, g, () => Number(seedInput.value) >>> 0);

    // Shape
    this.heading(el, "Shape");
    this.slider(el, "Feature size", "Size of each terrain's patches relative to the map. 1 = like the example; lower = more, smaller patches; 0 = no growth.", 0, 3, 0.25, s().featureSize, (v) => save({ featureSize: v }));
    if (model.terrains.some((t) => t.shape === "line")) {
      const learnedWidth = Math.max(1, Math.round(Math.max(...model.terrains.filter((t) => t.shape === "line").map((t) => t.width ?? 1))));
      this.slider(el, "Line width", "Thickness of line-shaped terrain, in hexes.", 1, 3, 1, s().lineWidth > 0 ? s().lineWidth : learnedWidth, (v) => save({ lineWidth: v }));
    }
    this.slider(el, "Smoothing", "Clean up lone specks and ragged edges after generating.", 0, 1, 0.1, s().smoothing, (v) => save({ smoothing: v }));
    this.select(el, "Symmetry", "Mirror the map. Symmetric wherever the rules allow.",
      SYMMETRIES.map((v) => [v, SYMMETRY_LABELS[v]]), s().symmetry, (v) => save({ symmetry: v }));
    this.select(el, "Edge style", "What the map border prefers: a terrain of your choice, or the example's border.",
      [["", "As in the example"], ...model.terrains.map((t): [string, string] => [t.name, t.name])],
      s().edgeTerrain, (v) => save({ edgeTerrain: v || undefined }));
    this.slider(el, "Edge strength", "How strongly the border follows the edge style. 0 = off.", 0, 1, 0.05, s().edgeStrength, (v) => save({ edgeStrength: v }));

    // Placement
    this.heading(el, "Placement");
    this.slider(el, "Directional bias", "0 = terrain goes anywhere. 1 = it keeps to where it was in the example.", 0, 1, 0.05, s().directionalBias, (v) => save({ directionalBias: v }));
    if (model.terrains.some((t) => t.shape === "scatter")) {
      this.slider(el, "Spacing", "How far apart single-hex terrain stays, relative to the example. 0 = no spacing.", 0, 3, 0.25, s().spacing, (v) => save({ spacing: v }));
    }
    this.slider(el, "Randomness", "Share of hexes chosen by chance, ignoring neighbours, so rare terrain turns up here and there.", 0, 1, 0.05, s().randomness, (v) => save({ randomness: v }));

    // Guarantees
    this.heading(el, "Guarantees");
    if (model.features?.length || model.paths?.length) {
      this.toggle(el, "Guaranteed features", "Always place the example's anchored lines and paths.", s().features, (v) => save({ features: v }));
    }
    this.toggle(el, "Connected land", "Fill cut-off pockets so every passable hex connects.", s().connected, (v) => save({ connected: v }));
    this.terrainFilter(el, "Impassable terrain", model.terrains.map((t) => t.name), colors, s().impassable, (list) => save({ impassable: list }));

    // Advanced: per-terrain controls and tuning
    const adv = el.createEl("details", { cls: "duckmage-wfc-section" });
    adv.createEl("summary", { text: "Advanced" });
    adv.createEl("p", {
      text: "Mix scales how common each terrain is. Min and max limit how many separate patches it forms; leave blank for no limit.",
      cls: "duckmage-map-origin-desc",
    });
    const table = adv.createDiv({ cls: "duckmage-wfc-terrains" });
    const head = table.createDiv({ cls: "duckmage-wfc-terrain-row duckmage-wfc-terrain-head" });
    for (const h of ["Terrain", "Shape", "Mix", "Min", "Max"]) head.createSpan({ text: h });
    const mix = { ...s().mix };
    const counts: Record<string, CountRange> = Object.fromEntries(Object.entries(s().counts).map(([k, r]) => [k, { ...r }]));
    for (const t of model.terrains) {
      const row = table.createDiv({ cls: "duckmage-wfc-terrain-row" });
      const nameCell = row.createSpan({ cls: "duckmage-wfc-terrain-name" });
      const swatch = nameCell.createSpan({ cls: "duckmage-wfc-swatch" });
      swatch.setCssProps({ "--duckmage-wfc-swatch": colors.get(t.name) ?? "var(--background-modifier-border)" });
      nameCell.createSpan({ text: t.name });
      row.createSpan({ text: t.shape ?? "none", cls: "duckmage-map-origin-desc" });
      const mixCell = row.createSpan({ cls: "duckmage-wfc-mix" });
      const mixSlider = mixCell.createEl("input", { type: "range" });
      mixSlider.min = "0";
      mixSlider.max = "3";
      mixSlider.step = "0.25";
      mixSlider.value = String(mix[t.name] ?? 1);
      const mixLabel = mixCell.createSpan({ text: `×${mixSlider.value}` });
      mixSlider.addEventListener("input", () => mixLabel.setText(`×${mixSlider.value}`));
      mixSlider.addEventListener("change", () => {
        const v = Number(mixSlider.value);
        if (v === 1) delete mix[t.name];
        else mix[t.name] = v;
        save({ mix: Object.keys(mix).length ? { ...mix } : undefined });
      });
      for (const bound of ["min", "max"] as const) {
        const input = row.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", placeholder: "–" } });
        const v = counts[t.name]?.[bound];
        input.value = v === undefined ? "" : String(v);
        input.addEventListener("change", () => {
          const range: CountRange = { ...(counts[t.name] ?? {}) };
          if (input.value === "") delete range[bound];
          else range[bound] = Math.max(0, Math.floor(Number(input.value) || 0));
          if (range.min === undefined && range.max === undefined) delete counts[t.name];
          else counts[t.name] = range;
          save({ counts: Object.keys(counts).length ? { ...counts } : undefined });
        });
      }
    }
    this.slider(adv, "Clumping", "How strongly each hex follows its neighbours. 0 gives speckled noise.", 0, 6, 0.5, s().neighbourInfluence, (v) => save({ neighbourInfluence: v }));
    this.slider(adv, "Mix strength", "How closely the overall terrain mix follows the example.", 0, 4, 0.5, s().frequencyFeedback, (v) => save({ frequencyFeedback: v }));
    this.slider(adv, "Scatter", "Randomness in where patches start. Too low and one terrain can take over the map.", 0, 6, 0.5, s().scatter, (v) => save({ scatter: v }));

    const resetRow = el.createDiv({ cls: "duckmage-region-row" });
    const resetBtn = resetRow.createEl("button", { text: "Reset settings to defaults" });
    resetBtn.addEventListener("click", () => {
      const cleared: Partial<Record<keyof GeneratorSettings, unknown>> = {};
      for (const k of Object.keys(model.settings ?? {})) cleared[k as keyof GeneratorSettings] = undefined;
      save(cleared);
      this.host.rerender();
    });

    schedulePreview();
  }

  // ── Fill the active map ──────────────────────────────────────────────────

  private renderFill(el: HTMLElement, g: GeneratorFile, seed: () => number): void {
    this.heading(el, `Fill ${this.mapName || "region"}`);
    const mapName = this.mapName;
    const palette = this.plugin.getMapPalette(mapName).map((t) => t.name);
    el.createEl("p", {
      text: `Uses the preview's seed. "Fill unpainted hexes" keeps everything you've painted and your paths. "Regenerate" repaints the whole map, except hexes whose note has "${LOCK_KEY}: true" in its properties, and redraws the generator's path types.`,
      cls: "duckmage-map-origin-desc",
    });
    if (!generatorFitsPalette(g.model, palette))
      el.createEl("p", {
        text: "⚠ This map's palette is missing some of the generator's terrains; those are left out.",
        cls: "duckmage-map-origin-desc",
      });
    const row = el.createDiv({ cls: "duckmage-region-row" });
    const fillBtn = row.createEl("button", { text: "Fill unpainted hexes", cls: "mod-cta" });
    const regenBtn = row.createEl("button", { text: "Regenerate map", cls: "mod-warning" });
    let confirming = false;

    const run = async (mode: "unpainted" | "regenerate", btn: HTMLButtonElement) => {
      fillBtn.disabled = regenBtn.disabled = true;
      const label = btn.textContent ?? "";
      const result = await fillMap(this.plugin, mapName, g.model, mode, seed(), (done, total) =>
        btn.setText(`Writing ${done} / ${total}…`),
      );
      fillBtn.disabled = regenBtn.disabled = false;
      btn.setText(label);
      if ("error" in result) {
        new Notice(`Couldn't fill the map: ${result.error}`);
        return;
      }
      const notes = result.warnings.length ? ` (${result.warnings.join("; ")})` : "";
      new Notice(`Generator "${g.model.name}" set terrain on ${result.changed} hexes${notes}.`);
      // Let the metadata cache catch up before redrawing.
      window.setTimeout(() => this.plugin.refreshHexMap(), 300);
    };
    fillBtn.addEventListener("click", () => void run("unpainted", fillBtn));
    regenBtn.addEventListener("click", () => {
      if (!confirming) {
        confirming = true;
        regenBtn.setText("Click again to repaint the map");
        window.setTimeout(() => {
          confirming = false;
          regenBtn.setText("Regenerate map");
        }, 4000);
        return;
      }
      confirming = false;
      regenBtn.setText("Regenerate map");
      void run("regenerate", regenBtn);
    });
  }

  // ── Small controls ───────────────────────────────────────────────────────

  private heading(el: HTMLElement, text: string): void {
    el.createEl("h5", { text, cls: "duckmage-wfc-heading" });
  }

  private slider(
    el: HTMLElement,
    label: string,
    hint: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
  ): void {
    el.createEl("label", { text: label, cls: "duckmage-map-field-label" });
    const row = el.createDiv({ cls: "duckmage-region-row" });
    const input = row.createEl("input", { type: "range" });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const valueEl = row.createSpan({ text: String(value) });
    el.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
    input.addEventListener("input", () => valueEl.setText(input.value));
    input.addEventListener("change", () => onChange(Number(input.value)));
  }

  private select<T extends string>(
    el: HTMLElement,
    label: string,
    hint: string,
    options: [T, string][],
    value: T,
    onChange: (v: T) => void,
  ): void {
    el.createEl("label", { text: label, cls: "duckmage-map-field-label" });
    const sel = el.createDiv({ cls: "duckmage-region-row" }).createEl("select");
    for (const [v, text] of options) sel.createEl("option", { value: v, text });
    sel.value = value;
    el.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
    sel.addEventListener("change", () => onChange(sel.value as T));
  }

  private toggle(el: HTMLElement, label: string, hint: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = el.createEl("label", { cls: "duckmage-region-row duckmage-wfc-toggle" });
    const cb = row.createEl("input", { type: "checkbox" });
    cb.checked = value;
    row.createSpan({ text: label });
    if (hint) el.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
    cb.addEventListener("change", () => onChange(cb.checked));
  }
  /**
   * Searchable terrain list: type to filter, click a match to add it; added
   * terrains show as chips that can be removed.
   */
  private terrainFilter(
    el: HTMLElement,
    label: string,
    terrains: string[],
    colors: Map<string, string>,
    selected: string[],
    onChange: (list: string[]) => void,
  ): void {
    el.createEl("label", { text: label, cls: "duckmage-map-field-label" });
    const chosen = new Set(selected.filter((t) => terrains.includes(t)));
    const chips = el.createDiv({ cls: "duckmage-wfc-chips" });
    const search = el.createEl("input", { type: "search", cls: "duckmage-wfc-filter", attr: { placeholder: "Search terrain to add…" } });
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
}

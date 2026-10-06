/**
 * The "Generator" tab of the Maps modal: learn a generator from the active
 * map, adjust a generator's settings (saved to its file's frontmatter) with a
 * live preview, and fill or regenerate the active map with it.
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexMapView } from "../hex-map/HexMapView";
import {
  listGenerators,
  saveGeneratorFromMap,
  saveGeneratorSettings,
  generateTerrain,
  generatorFitsPalette,
  paletteColors,
  fillMap,
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

export interface GeneratorTabHost {
  close(): void;
  /** Re-render the whole modal (e.g. after learning a new generator). */
  rerender(): void;
}

const SYMMETRY_LABELS: Record<Symmetry, string> = {
  none: "None",
  "left-right": "Left–right",
  "top-bottom": "Top–bottom",
  both: "Both",
};

export class GeneratorTab {
  /** Survives re-renders of the modal. */
  static selectedPath = "";
  private seed = randomSeed();
  private previewCols = 30;
  private previewRows = 20;
  private previewTimer: number | null = null;

  constructor(
    private app: App,
    private plugin: HexmakerPlugin,
    private view: HexMapView,
    private host: GeneratorTabHost,
  ) {
    const map = plugin.getMap(view.activeMapName);
    if (map && map.gridSize.cols * map.gridSize.rows <= PREVIEW_AUTO_LIMIT) {
      this.previewCols = map.gridSize.cols;
      this.previewRows = map.gridSize.rows;
    }
  }

  render(el: HTMLElement): void {
    el.empty();
    el.addClass("duckmage-wfc-tab");
    this.renderLearn(el);

    el.createEl("h4", { text: "Generator settings" });
    el.createEl("p", {
      text: "Each generator keeps its settings in its own file. New maps made with it use them.",
      cls: "duckmage-map-origin-desc",
    });
    const pickRow = el.createDiv({ cls: "duckmage-region-row" });
    const select = pickRow.createEl("select", { cls: "duckmage-map-new-palette-select" });
    const openBtn = pickRow.createEl("button", { text: "Open file" });
    openBtn.disabled = true;
    const body = el.createDiv();
    let generators: GeneratorFile[] = [];
    const current = () => generators.find((g) => g.file.path === select.value);

    const show = () => {
      GeneratorTab.selectedPath = select.value;
      body.empty();
      const g = current();
      openBtn.disabled = !g;
      if (g) this.renderGenerator(body, g);
      else
        body.createEl("p", {
          text: generators.length ? "Pick a generator." : "No generators yet. Paint a map, then use the button above.",
          cls: "duckmage-map-origin-desc",
        });
    };
    select.addEventListener("change", show);
    openBtn.addEventListener("click", () => {
      const g = current();
      if (!g) return;
      this.host.close();
      void this.app.workspace.getLeaf("tab").openFile(g.file);
    });

    select.createEl("option", { value: "", text: "Loading…" });
    void listGenerators(this.plugin).then((list) => {
      generators = list;
      select.empty();
      if (!list.length) select.createEl("option", { value: "", text: "No generators" });
      for (const g of list) {
        const palette = g.model.meta.palette;
        select.createEl("option", { value: g.file.path, text: palette ? `${g.model.name} (${palette})` : g.model.name });
      }
      select.value = list.some((g) => g.file.path === GeneratorTab.selectedPath)
        ? GeneratorTab.selectedPath
        : (list[0]?.file.path ?? "");
      show();
    });
  }

  // ── Learn ────────────────────────────────────────────────────────────────

  private renderLearn(el: HTMLElement): void {
    el.createEl("h4", { text: "Learn from this map" });
    el.createEl("p", {
      text: "Make a wave function collapse generator from the terrain painted on this map. Terrains that never touch here never touch in generated maps; lakes, ridges, forests and towns keep their shape and relative size; rivers that run from an edge into a lake are always placed.",
      cls: "duckmage-map-origin-desc",
    });
    const row = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = row.createEl("input", { type: "text", value: this.view.activeMapName, placeholder: "generator-name" });
    const btn = row.createEl("button", { text: "Generate solver from map", cls: "mod-cta" });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void saveGeneratorFromMap(this.plugin, this.view.activeMapName, nameInput.value).then((result) => {
        btn.disabled = false;
        if ("error" in result) {
          new Notice(result.error);
          return;
        }
        const { model, file } = result;
        const extra = model.features?.length ? `, ${model.features.length} guaranteed feature(s)` : "";
        new Notice(`Saved generator "${model.name}": ${model.terrains.length} terrains, ${model.adjacency.length} neighbour pairs${extra}.`);
        GeneratorTab.selectedPath = file.path;
        this.host.rerender();
      });
    });
  }

  // ── One generator ────────────────────────────────────────────────────────

  private renderGenerator(el: HTMLElement, g: GeneratorFile): void {
    const { model } = g;
    const colors = paletteColors(this.plugin, model.meta.palette);
    const byShape = (shape: string) => model.terrains.filter((t) => (t.shape ?? "none") === shape).map((t) => t.name);
    const parts = [`${model.terrains.length} terrains`];
    for (const [shape, label] of [["blob", "blobs"], ["line", "lines"], ["scatter", "scattered"]] as const)
      if (byShape(shape).length) parts.push(`${label}: ${byShape(shape).join(", ")}`);
    if (model.meta["source-map"]) parts.push(`learned from ${model.meta["source-map"]}`);
    el.createEl("p", { text: parts.join(" · "), cls: "duckmage-map-origin-desc" });
    for (const w of g.warnings) el.createEl("p", { text: `⚠ ${w}`, cls: "duckmage-map-origin-desc" });

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
      const map = this.plugin.getMap(this.view.activeMapName);
      const grid = {
        cols: this.previewCols,
        rows: this.previewRows,
        offset: { x: 0, y: 0 },
        stagger: map?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd",
      };
      const palette = [...colors.keys()].length ? [...colors.keys()] : model.terrains.map((t) => t.name);
      const r = generateTerrain(this.plugin, model, palette, grid, this.seed);
      if (!r.ok) {
        status.setText(`Couldn't generate: ${r.message}`);
        return;
      }
      drawPreview(canvas, r.cells, grid, this.plugin.settings.hexOrientation, colors, r.featureCells);
      const notes = r.warnings.length ? ` · ${r.warnings.join("; ")}` : "";
      status.setText(`${grid.cols}×${grid.rows} in ${r.stats.ms} ms${notes}`);
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

    // Shape
    this.heading(el, "Shape");
    this.slider(el, "Feature size", "Size of lakes, ranges and forests relative to the map. 1 = like the example; lower = more, smaller features; 0 = no growth.", 0, 3, 0.25, s().featureSize, (v) => save({ featureSize: v }));
    this.slider(el, "Line width", "Thickness of ridges, ranges and rivers. 0 = as in the example.", 0, 3, 1, s().lineWidth, (v) => save({ lineWidth: v }));
    this.slider(el, "Smoothing", "Clean up lone specks and ragged edges after generating.", 0, 1, 0.1, s().smoothing, (v) => save({ smoothing: v }));
    this.select(el, "Symmetry", "Mirror the map. Symmetric wherever the rules allow.",
      SYMMETRIES.map((v) => [v, SYMMETRY_LABELS[v]]), s().symmetry, (v) => save({ symmetry: v }));
    this.select(el, "Edge style", "What the map border prefers. Pick a terrain such as water for islands, or follow the example map.",
      [["", "As in the example"], ...model.terrains.map((t): [string, string] => [t.name, t.name])],
      s().edgeTerrain, (v) => save({ edgeTerrain: v || undefined }));
    this.slider(el, "Edge strength", "How strongly the border follows the edge style. 0 = off.", 0, 1, 0.05, s().edgeStrength, (v) => save({ edgeStrength: v }));

    // Placement
    this.heading(el, "Placement");
    this.slider(el, "Directional bias", "0 = features can go anywhere. 1 = they keep to where they were in the example, so an ocean along the bottom stays along the bottom.", 0, 1, 0.05, s().directionalBias, (v) => save({ directionalBias: v }));
    this.slider(el, "Spacing", "How far apart scattered terrain like towns stays, relative to the example. 0 = no spacing.", 0, 3, 0.25, s().spacing, (v) => save({ spacing: v }));
    this.slider(el, "Randomness", "Share of hexes chosen by plain chance, ignoring neighbours. Lets rare terrain like towns pepper the map. Hard rules still apply.", 0, 1, 0.05, s().randomness, (v) => save({ randomness: v }));

    // Guarantees
    this.heading(el, "Guarantees");
    if (model.features?.length) {
      const list = model.features.map((f) => `${f.terrain}: ${f.from === "edge" ? "map edge" : f.from} → ${f.to === "edge" ? "map edge" : f.to}`).join(", ");
      this.toggle(el, "Guaranteed features", `Always lay these down first: ${list}.`, s().features, (v) => save({ features: v }));
    } else {
      el.createEl("p", {
        text: "No guaranteed features. Paint a river running from a map edge into a lake (or from edge to edge) in the example map to get one.",
        cls: "duckmage-map-origin-desc",
      });
    }
    this.toggle(el, "Connected land", "Make all land one connected area, filling cut-off pockets with impassable terrain.", s().connected, (v) => save({ connected: v }));
    el.createEl("label", { text: "Impassable terrain", cls: "duckmage-map-field-label" });
    const chips = el.createDiv({ cls: "duckmage-wfc-chips" });
    const impassable = new Set(s().impassable);
    for (const t of model.terrains) {
      const chip = chips.createEl("label", { cls: "duckmage-wfc-chip" });
      const cb = chip.createEl("input", { type: "checkbox" });
      cb.checked = impassable.has(t.name);
      chip.createSpan({ text: t.name });
      cb.addEventListener("change", () => {
        if (cb.checked) impassable.add(t.name);
        else impassable.delete(t.name);
        save({ impassable: [...impassable] });
      });
    }

    // Per terrain
    this.heading(el, "Terrains");
    el.createEl("p", {
      text: "Mix scales how common each terrain is. Min and max set how many separate patches to make (a town is a 1-hex patch); leave blank for no limit.",
      cls: "duckmage-map-origin-desc",
    });
    const table = el.createDiv({ cls: "duckmage-wfc-terrains" });
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

    // Advanced tuning
    const adv = el.createEl("details", { cls: "duckmage-wfc-section" });
    adv.createEl("summary", { text: "Advanced tuning" });
    this.slider(adv, "Clumping", "How strongly each hex follows its neighbours. 0 gives speckled noise.", 0, 6, 0.5, s().neighbourInfluence, (v) => save({ neighbourInfluence: v }));
    this.slider(adv, "Mix strength", "How closely the overall terrain mix follows the example.", 0, 4, 0.5, s().frequencyFeedback, (v) => save({ frequencyFeedback: v }));
    this.slider(adv, "Scatter", "Randomness in where features start. Too low and one terrain can take over the map.", 0, 6, 0.5, s().scatter, (v) => save({ scatter: v }));

    const resetRow = el.createDiv({ cls: "duckmage-region-row" });
    const resetBtn = resetRow.createEl("button", { text: "Reset settings to defaults" });
    resetBtn.addEventListener("click", () => {
      const cleared: Partial<Record<keyof GeneratorSettings, unknown>> = {};
      for (const k of Object.keys(model.settings ?? {})) cleared[k as keyof GeneratorSettings] = undefined;
      save(cleared);
      this.host.rerender();
    });

    this.renderFill(el, g, () => Number(seedInput.value) >>> 0);
    schedulePreview();
  }

  // ── Fill the active map ──────────────────────────────────────────────────

  private renderFill(el: HTMLElement, g: GeneratorFile, seed: () => number): void {
    this.heading(el, "Fill this map");
    const mapName = this.view.activeMapName;
    const palette = this.plugin.getMapPalette(mapName).map((t) => t.name);
    el.createEl("p", {
      text: `Uses the preview's seed. "Fill unpainted hexes" keeps everything you've painted. "Regenerate" repaints the whole map except hexes whose note has "${LOCK_KEY}: true" in its properties.`,
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
    el.createEl("p", { text: hint, cls: "duckmage-map-origin-desc" });
    cb.addEventListener("change", () => onChange(cb.checked));
  }
}

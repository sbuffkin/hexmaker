/**
 * The terrain generator page: pick a region (map) and palette, learn a
 * generator from the region, adjust a generator's settings (saved to its
 * file's frontmatter) with a live preview, and create a new map from it.
 */

import { App, Notice, setIcon } from "obsidian";
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
  relearnGenerator,
  toPathChains,
  type GeneratorFile,
} from "./generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import { makeScrubbable } from "./scrub";
import { exampleShares, formatShare, formatShareChange, hasTerrainTweaks, terrainShares, withoutTerrainTweaks } from "./shares";
import {
  resolveSettings,
  cleanupStrengths,
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
  static seedLocked = false;
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

  render(root: HTMLElement): void {
    root.empty();
    root.addClass("duckmage-wfc-tab");
    // Controls on the left; the preview sits in a column that stays in view
    // while the controls scroll (stacked above them on narrow panes).
    const layout = root.createDiv({ cls: "duckmage-wfc-layout" });
    const el = layout.createDiv({ cls: "duckmage-wfc-main" });
    const side = layout.createDiv({ cls: "duckmage-wfc-side" });
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
      side.empty();
      const g = current();
      openBtn.disabled = !g;
      relearnBtn.disabled = !g?.model.meta["source-map"];
      if (g) this.renderGenerator(body, side, g);
      else {
        const text = generators.length ? "No generators for this palette yet." : "No generators yet. Pick a region and learn from it.";
        body.createEl("p", { text, cls: "duckmage-map-origin-desc" });
        side.createEl("p", { text: "Pick a generator to preview it here.", cls: "duckmage-map-origin-desc" });
      }
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

  private renderGenerator(el: HTMLElement, side: HTMLElement, g: GeneratorFile): void {
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

    // Preview (in the sticky side column)
    const previewBox = side.createDiv({ cls: "duckmage-wfc-section" });
    previewBox.createEl("h4", { text: "Preview" });
    const canvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const status = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const previewRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    previewRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = previewRow.createEl("input", { type: "number", value: String(this.seed), cls: "duckmage-wfc-seed" });
    // Locked: the button regenerates with the same seed, so a settings change
    // can be compared on the same map (large maps don't preview on their own).
    const lockBtn = previewRow.createEl("button", { cls: "clickable-icon duckmage-wfc-lock" });
    const rerollBtn = previewRow.createEl("button");
    const showLock = () => {
      const locked = GeneratorPanel.seedLocked;
      setIcon(lockBtn, locked ? "lock" : "lock-open");
      lockBtn.toggleClass("is-active", locked);
      lockBtn.setAttr("aria-pressed", String(locked));
      lockBtn.setAttr("aria-label", locked ? "Seed locked: regenerate keeps it" : "Lock the seed");
      rerollBtn.setText(locked ? "Regenerate" : "Re-roll");
    };
    lockBtn.addEventListener("click", () => {
      GeneratorPanel.seedLocked = !GeneratorPanel.seedLocked;
      showLock();
      schedulePreview();
    });
    previewRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    const colsInput = previewRow.createEl("input", { type: "number", value: String(this.previewCols), cls: "duckmage-wfc-num" });
    previewRow.createSpan({ text: "×" });
    const rowsInput = previewRow.createEl("input", { type: "number", value: String(this.previewRows), cls: "duckmage-wfc-num" });
    const createRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    const newNameInput = createRow.createEl("input", { type: "text", attr: { placeholder: "Name for the new map" } });
    const createBtn = createRow.createEl("button", { text: "Create map", cls: "mod-cta" });

    const previewGrid = () => {
      const map = this.plugin.getMap(this.mapName);
      return {
        cols: Math.max(2, Math.min(200, Number(colsInput.value) || 30)),
        rows: Math.max(2, Math.min(200, Number(rowsInput.value) || 20)),
        offset: { x: 0, y: 0 },
        stagger: map?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd",
      };
    };
    // Share readouts in the Advanced table, filled in further down.
    const shareCells = new Map<string, { now: HTMLElement; change: HTMLElement }>();
    let baseline: { key: string; shares: Map<string, number> } | null = null;
    /**
     * Shares in the preview vs the same seed without per-terrain mix/counts,
     * so the table shows what those settings change. The untweaked run is
     * cached until something other than mix/counts changes.
     */
    const updateShares = (cells: Map<string, string>, grid: ReturnType<typeof previewGrid>, palette: string[]) => {
      const now = terrainShares(cells);
      let before = now;
      if (hasTerrainTweaks(model)) {
        const plain = withoutTerrainTweaks(model);
        const key = JSON.stringify([this.seed, grid, palette, plain.settings]);
        if (baseline?.key !== key) {
          const b = generateTerrain(this.plugin, plain, palette, grid, this.seed);
          baseline = { key, shares: b.ok ? terrainShares(b.cells) : now };
        }
        before = baseline.shares;
      }
      for (const [name, cell] of shareCells) {
        const n = now.get(name) ?? 0, b = before.get(name) ?? 0;
        cell.now.setText(formatShare(n));
        const change = formatShareChange(n, b);
        cell.change.setText(change);
        cell.change.toggleClass("is-up", change.startsWith("+"));
        cell.change.toggleClass("is-down", change.startsWith("−"));
        cell.change.setAttr("title", change ? `${formatShare(b)} without its mix and min/max settings` : "");
      }
    };
    const runPreview = () => {
      const grid = previewGrid();
      this.previewCols = grid.cols;
      this.previewRows = grid.rows;
      this.seed = Number(seedInput.value) >>> 0;
      const palette = this.paletteTerrains().length ? this.paletteTerrains() : model.terrains.map((t) => t.name);
      const r = generateTerrain(this.plugin, model, palette, grid, this.seed);
      if (!r.ok) {
        status.setText(`Couldn't generate: ${r.message}`);
        return;
      }
      // Draw at the side column's device-pixel width so it stays sharp when stretched.
      const dpr = activeWindow.devicePixelRatio || 1;
      drawPreview(canvas, r.cells, grid, this.plugin.settings.hexOrientation, colors, r.featureCells, r.paths, pathColors(this.plugin),
        Math.max(420, side.clientWidth) * dpr, 40 * dpr);
      updateShares(r.cells, grid, palette);
      // Short: size and time, plus a hoverable count if anything didn't fit.
      status.setText(`${grid.cols}×${grid.rows} · ${r.stats.ms} ms${r.warnings.length ? ` · ⚠ ${r.warnings.length}` : ""}`);
      status.setAttr("title", r.warnings.join("\n"));
    };
    const schedulePreview = () => {
      if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
      if (Number(colsInput.value) * Number(rowsInput.value) > PREVIEW_AUTO_LIMIT) {
        status.setText(GeneratorPanel.seedLocked
          ? "Large map: press Regenerate to see your changes on this seed."
          : "Large map: re-roll to preview it, or lock the seed to compare settings.");
        return;
      }
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = null;
        runPreview();
      }, 200);
    };
    rerollBtn.addEventListener("click", () => {
      if (!GeneratorPanel.seedLocked) seedInput.value = String(randomSeed());
      runPreview();
    });
    showLock();
    // Create a new map that is exactly the preview: same size, seed, palette and paths.
    createBtn.addEventListener("click", () => {
      const grid = previewGrid();
      const seed = Number(seedInput.value) >>> 0;
      const palette = this.paletteTerrains().length ? this.paletteTerrains() : model.terrains.map((t) => t.name);
      const r = generateTerrain(this.plugin, model, palette, grid, seed);
      if (!r.ok) {
        new Notice(`Couldn't generate: ${r.message}`);
        return;
      }
      createBtn.disabled = true;
      void this.plugin
        .createNewMap(
          newNameInput.value.trim() || `${model.name}-${seed}`,
          grid.cols, grid.rows, GeneratorPanel.paletteName, 0, 0, grid.stagger,
          (done, total) => createBtn.setText(`Creating ${done} / ${total}…`),
          r.cells,
        )
        .then(async (result) => {
          createBtn.disabled = false;
          createBtn.setText("Create map");
          if ("error" in result) {
            new Notice(result.error);
            return;
          }
          const { chains, missing } = toPathChains(this.plugin, r.paths);
          const created = this.plugin.getMap(result.name);
          if (created && chains.length) {
            created.pathChains = [...created.pathChains, ...chains];
            await this.plugin.saveSettings();
          }
          if (missing.length) new Notice(`No path type named ${missing.join(", ")}, so those paths were skipped.`);
          new Notice(`Created map "${result.name}".`);
          GeneratorPanel.mapName = result.name;
          await this.plugin.showMap(result.name);
          this.host.rerender();
        });
    });
    for (const input of [seedInput, colsInput, rowsInput]) input.addEventListener("change", schedulePreview);
    // Drag up/down on size and seed; the preview follows while dragging.
    makeScrubbable(colsInput, { min: 2, max: 200, pxPerStep: 4 });
    makeScrubbable(rowsInput, { min: 2, max: 200, pxPerStep: 4 });
    makeScrubbable(seedInput, { min: 0, max: 0xffffffff, pxPerStep: 8 });
    for (const input of [seedInput, colsInput, rowsInput]) {
      input.addEventListener("input", () => {
        if (input.hasClass("is-scrubbing")) schedulePreview();
      });
    }


    // Shape
    this.heading(el, "Shape");
    this.slider(el, "Feature size", "Size of each terrain's patches relative to the map. 1 = like the example; lower = more, smaller patches; 0 = no growth.", 0, 3, 0.25, s().featureSize, (v) => save({ featureSize: v }));
    this.slider(el, "Clumping", "How strongly each hex follows its neighbours. 0 gives speckled noise.", 0, 6, 0.5, s().neighbourInfluence, (v) => save({ neighbourInfluence: v }));
    if (model.terrains.some((t) => t.shape === "line")) {
      const learnedWidth = Math.max(1, Math.round(Math.max(...model.terrains.filter((t) => t.shape === "line").map((t) => t.width ?? 1))));
      this.slider(el, "Line width", "Thickness of line-shaped terrain, in hexes.", 1, 3, 1, s().lineWidth > 0 ? s().lineWidth : learnedWidth, (v) => save({ lineWidth: v }));
    }
    // Clean-up after generating. Older generators only have one "smoothing"
    // value; the sliders start from what it meant, and any change replaces it.
    const cleanup = cleanupStrengths(s());
    this.slider(el, "Edge smoothing", "Trim one-hex bumps and notches along the edges of patches. Lone hexes are left alone.", 0, 1, 0.1, cleanup.edges,
      (v) => save({ edgeSmoothing: v, speckSize: cleanupStrengths(s()).speckSize, smoothing: undefined }));
    this.slider(el, "Remove small patches", "Fill in patches of this many hexes or fewer with the terrain around them. 0 = keep all.", 0, 6, 1, cleanup.speckSize,
      (v) => save({ speckSize: v, edgeSmoothing: cleanupStrengths(s()).edges, smoothing: undefined }));
    this.slider(el, "Keep rare terrain", "Terrains under this share of the example (%) are never smoothed or removed, so the odd rare hex survives.", 0, 20, 1,
      Math.round(s().keepRare * 100), (v) => save({ keepRare: v / 100 }));
    this.select(el, "Symmetry", "Mirror the map. Symmetric wherever the rules allow.",
      SYMMETRIES.map((v) => [v, SYMMETRY_LABELS[v]]), s().symmetry, (v) => save({ symmetry: v }));
    this.select(el, "Edge style", "What the map border prefers: a terrain of your choice, or the example's border.",
      [["", "As in the example"], ...model.terrains.map((t): [string, string] => [t.name, t.name])],
      s().edgeTerrain, (v) => save({ edgeTerrain: v || undefined }));
    this.slider(el, "Edge strength", "How strongly the border follows the edge style. 0 = off.", 0, 1, 0.05, s().edgeStrength, (v) => save({ edgeStrength: v }));

    // Placement
    this.heading(el, "Placement");
    this.slider(el, "Directional bias", "0 = terrain goes anywhere. 1 = it keeps to where it was in the example.", 0, 1, 0.05, s().directionalBias, (v) => save({ directionalBias: v }));
    this.slider(el, "Scatter", "Randomness in where patches start. Too low and one terrain can take over the map.", 0, 6, 0.5, s().scatter, (v) => save({ scatter: v }));
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

    // Terrain mix: per-terrain controls and what they do to the preview
    this.heading(el, "Terrain mix");
    el.createEl("p", {
      text: "Mix scales how common each terrain is. Min and max limit how many separate patches it forms; leave blank for no limit. Example is each terrain's share of the region it was learned from; Map is its share of the preview, with the change your mix and min/max make to it.",
      cls: "duckmage-map-origin-desc",
    });
    const table = el.createDiv({ cls: "duckmage-wfc-terrains" });
    const head = table.createDiv({ cls: "duckmage-wfc-terrain-row duckmage-wfc-terrain-head" });
    const headings: [string, string][] = [
      ["Terrain", ""],
      ["Mix", ""],
      ["Min", "Fewest separate patches"],
      ["Max", "Most separate patches"],
      ["Example", "Share of the region this generator was learned from"],
      ["Map", "Share of the preview; the change is what mix and min/max add or remove (same seed)"],
    ];
    for (const [h, title] of headings) head.createSpan({ text: h, attr: title ? { title } : {} });
    const example = exampleShares(model);
    const mix = { ...s().mix };
    const counts: Record<string, CountRange> = Object.fromEntries(Object.entries(s().counts).map(([k, r]) => [k, { ...r }]));
    for (const t of model.terrains) {
      const row = table.createDiv({ cls: "duckmage-wfc-terrain-row" });
      // Guaranteed line features are laid down before the solver runs, so
      // mix barely changes how much of them there is.
      const isFeature = model.features?.some((f) => f.terrain === t.name) ?? false;
      const title = `${t.name} (${t.shape ?? "no"} shape)` + (isFeature ? ". Placed as a guaranteed feature, so mix has little effect." : "");
      const nameCell = row.createSpan({ cls: "duckmage-wfc-terrain-name", attr: { title } });
      const swatch = nameCell.createSpan({ cls: "duckmage-wfc-swatch" });
      swatch.setCssProps({ "--duckmage-wfc-swatch": colors.get(t.name) ?? "var(--background-modifier-border)" });
      nameCell.createSpan({ text: t.name });
      if (isFeature) nameCell.createSpan({ text: "feature", cls: "duckmage-wfc-tag" });
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
      row.createSpan({ text: formatShare(example.get(t.name) ?? 0), cls: "duckmage-wfc-share" });
      const mapCell = row.createSpan({ cls: "duckmage-wfc-share" });
      shareCells.set(t.name, {
        now: mapCell.createSpan({ text: "–" }),
        change: mapCell.createSpan({ cls: "duckmage-wfc-share-change" }),
      });
    }

    this.slider(el, "Mix strength", "How closely the overall terrain mix follows the example.", 0, 4, 0.5, s().frequencyFeedback, (v) => save({ frequencyFeedback: v }));

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

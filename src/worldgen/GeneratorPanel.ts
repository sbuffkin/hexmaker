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
  saveGeneratorSettings,
  generateTerrain,
  generatorSettings,
  drawnPathType,
  generatorFitsPalette,
  paletteColors,
  pathColors,
  sourceMapsOf,
  relearnGenerator,
  regionSizes,
  sourceInfluenceOf,
  setGeneratorPalette,
  toPathChains,
  type GeneratorFile,
} from "./generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import { makeScrubbable, wheelValue } from "./scrub";
import { rebalance, toPercents } from "./regionWeights";
import { GeneratorLibrary } from "./GeneratorLibrary";
import { sizePresets } from "./sizePresets";
import { listSaves, writeSave, readSave, applySave, renameGenerator } from "./saves";
import { ConfirmModal } from "./ConfirmModal";
import { SAVE_FORMAT, type GeneratorSave } from "./saveFormat";
import { compareVersions, pluginVersion, VERSION_KEY } from "../compat";
import { exampleShares, formatShare, formatShareChange, hasTerrainTweaks, terrainShares, withoutTerrainTweaks } from "./shares";
import {
  cleanupStrengths,
  pathsEnabled,
  pathRouteKey,
  type PathTweak,
  type RouteStat,
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
  /** Titles of the setting sections folded away. */
  static collapsed = new Set<string>();
  /**
   * The save last loaded. While the page still shows its generator, seed and
   * size (and no setting has changed), the preview and Create map use the
   * saved map, even if this version would generate a different one.
   */
  static loadedSave: GeneratorSave | null = null;
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
    const loaded = GeneratorPanel.loadedSave;
    if (loaded) {
      this.seed = loaded.seed;
      this.previewCols = loaded.cols;
      this.previewRows = loaded.rows;
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

    // The file list: generators to load, regions to learn from.
    const libraryEl = el.createDiv();
    libraryEl.createEl("p", { text: "Loading generators…", cls: "duckmage-map-origin-desc" });
    const body = el.createDiv();
    let generators: GeneratorFile[] = [];
    const current = () => generators.find((g) => g.file.path === GeneratorPanel.selectedPath);

    const show = () => {
      body.empty();
      side.empty();
      const g = current();
      if (g) this.renderGenerator(body, side, g);
      else {
        const text = generators.length ? "Click a generator above to load it." : "No generators yet. Learn one from a region above.";
        body.createEl("p", { text, cls: "duckmage-map-origin-desc" });
        side.createEl("p", { text: "Pick a generator to preview it here.", cls: "duckmage-map-origin-desc" });
      }
    };
    const choose = (g: GeneratorFile) => {
      GeneratorPanel.selectedPath = g.file.path;
      const source = sourceMapsOf(g.model)[0];
      if (source && this.plugin.getMap(source)) GeneratorPanel.mapName = source;
      const palette = g.model.meta.palette;
      if (palette && this.plugin.settings.terrainPalettes.some((p) => p.name === palette)) GeneratorPanel.paletteName = palette;
      show();
    };

    void listGenerators(this.plugin).then((found) => {
      generators = found;
      // Keep the chosen generator; otherwise one learned from the current
      // region, then the first one that fits the palette.
      if (!current()) {
        const names = this.paletteTerrains();
        const g = generators.find((x) => sourceMapsOf(x.model).includes(this.mapName))
          ?? generators.find((x) => x.model.meta.palette === GeneratorPanel.paletteName || generatorFitsPalette(x.model, names))
          ?? generators[0];
        if (g) GeneratorPanel.selectedPath = g.file.path;
      }
      libraryEl.empty();
      new GeneratorLibrary(this.app, this.plugin, generators, {
        selectedPath: () => GeneratorPanel.selectedPath,
        load: choose,
        changed: (selectPath) => {
          if (selectPath) GeneratorPanel.selectedPath = selectPath;
          this.host.rerender();
        },
      }).render(libraryEl);
      show();
    });
  }

  // ── One generator ────────────────────────────────────────────────────────

  private renderGenerator(main: HTMLElement, side: HTMLElement, g: GeneratorFile): void {
    const { model } = g;
    // Controls go into the current section; each section() call starts a new one.
    let el = main;
    const colors = paletteColors(this.plugin, GeneratorPanel.paletteName);
    // One short line; the per-shape breakdown is on hover.
    const byShape = (shape: string) => model.terrains.filter((t) => (t.shape ?? "none") === shape).map((t) => t.name);
    const detail = (["blob", "line", "scatter", "none"] as const)
      .filter((shape) => byShape(shape).length)
      .map((shape) => `${shape}: ${byShape(shape).join(", ")}`);
    if (model.paths?.length) detail.push(`paths: ${[...new Set(model.paths.map((p) => p.type))].join(", ")}`);
    const summary = el.createEl("p", {
      text: `${model.terrains.length} terrains${sourceMapsOf(model).length ? ` · from ${sourceMapsOf(model).join(" + ")}` : ""}${g.warnings.length ? ` · ⚠ ${g.warnings.length}` : ""}`,
      cls: "duckmage-map-origin-desc",
    });
    summary.setAttr("title", [...detail, ...g.warnings].join("\n"));

    // Current settings, kept in sync with the file.
    const s = () => generatorSettings(model);
    // A just-loaded save's settings win over a possibly stale read of the file.
    const isThisGenerator = (sv: GeneratorSave) => sv.generatorPath === g.file.path || sv.generatorName === model.name;
    if (GeneratorPanel.loadedSave && isThisGenerator(GeneratorPanel.loadedSave)) model.settings = { ...GeneratorPanel.loadedSave.settings };
    const save = (patch: Partial<Record<keyof GeneratorSettings, unknown>>) => {
      GeneratorPanel.loadedSave = null;
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

    // Generator settings: what's saved on the generator itself (its name,
    // palette and where it came from), as opposed to how it generates.
    el = this.section(main, "Generator settings");
    const nameRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    nameRow.createSpan({ text: "Name", cls: "duckmage-map-origin-label" });
    const nameInput = nameRow.createEl("input", { type: "text", value: model.name, attr: { placeholder: "Generator name" } });
    const renameBtn = nameRow.createEl("button", { text: "Rename" });
    renameBtn.disabled = true;
    nameInput.addEventListener("input", () => {
      renameBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === model.name;
    });
    const rename = () => {
      if (renameBtn.disabled) return;
      renameBtn.disabled = true;
      void renameGenerator(this.plugin, g, nameInput.value).then((r) => {
        if ("error" in r) {
          new Notice(r.error);
          renameBtn.disabled = false;
          return;
        }
        new Notice(`Renamed to "${r.name}"${r.savesUpdated ? `; ${r.savesUpdated} save${r.savesUpdated === 1 ? "" : "s"} updated` : ""}.`);
        GeneratorPanel.selectedPath = r.file.path;
        this.host.rerender();
      });
    };
    renameBtn.addEventListener("click", rename);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") rename();
      if (e.key === "Escape") {
        nameInput.value = model.name;
        renameBtn.disabled = true;
      }
    });

    const ownPaletteRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    ownPaletteRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
    const ownPalette = ownPaletteRow.createEl("select", { attr: { title: "The palette this generator is for. The palette under the preview only changes the preview." } });
    const palettes = this.plugin.settings.terrainPalettes.map((p) => p.name);
    const learnedPalette = model.meta.palette ?? "";
    if (learnedPalette && !palettes.includes(learnedPalette)) ownPalette.createEl("option", { value: learnedPalette, text: `${learnedPalette} (not installed)` });
    for (const p of palettes) ownPalette.createEl("option", { value: p, text: p });
    ownPalette.value = learnedPalette;
    ownPalette.addEventListener("change", () => {
      model.meta.palette = ownPalette.value;
      void setGeneratorPalette(this.plugin, g.file, ownPalette.value).then(() => {
        GeneratorPanel.paletteName = ownPalette.value;
        this.host.rerender();
      });
    });

    const sources = sourceMapsOf(model);
    const sourceRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    sourceRow.createSpan({ text: "From", cls: "duckmage-map-origin-label" });
    sourceRow.createSpan({ text: sources.length ? sources.join(" + ") : "No region recorded", cls: "duckmage-wfc-source" });
    const relearnBtn = sourceRow.createEl("button", { text: "Re-learn", attr: { title: "Learn again from these regions, keeping the settings below" } });
    relearnBtn.disabled = !sources.length;
    relearnBtn.addEventListener("click", () => {
      relearnBtn.disabled = true;
      void relearnGenerator(this.plugin, g).then((r) => {
        if ("error" in r) {
          new Notice(r.error);
          relearnBtn.disabled = false;
          return;
        }
        new Notice(`Re-learned "${model.name}" from ${sources.join(" + ")}.`);
        this.host.rerender();
      });
    });
    const openBtn = sourceRow.createEl("button", { text: "Open file" });
    openBtn.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(g.file));

    // A combined generator: how much each region counts. The sliders always
    // add up to 100%; letting go of one re-learns with the new mix.
    if (sources.length > 1) {
      const box = el.createDiv({ cls: "duckmage-wfc-influence" });
      box.createEl("label", { text: "Region influence", cls: "duckmage-map-field-label" });
      const stored = sourceInfluenceOf(model);
      let weights = toPercents(stored ?? regionSizes(this.plugin, sources));
      const rows = sources.map((name) => {
        const row = box.createDiv({ cls: "duckmage-wfc-influence-row" });
        row.createSpan({ text: name, cls: "duckmage-wfc-influence-name", attr: { title: name } });
        const slider = row.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "1", "aria-label": `${name} influence` } });
        const value = row.createSpan({ cls: "duckmage-wfc-influence-value" });
        return { slider, value };
      });
      const showWeights = () =>
        rows.forEach((r, i) => {
          r.slider.value = String(weights[i]);
          r.value.setText(`${weights[i]}%`);
        });
      showWeights();
      const note = box.createEl("p", {
        text: stored
          ? "Each region's share of what the generator learns."
          : "Set by each region's size (painted hexes). Move a slider to choose your own mix.",
        cls: "duckmage-map-origin-desc",
      });
      const relearnWith = (next: number[] | null) => {
        note.setText("Re-learning…");
        for (const r of rows) r.slider.disabled = true;
        void relearnGenerator(this.plugin, g, next).then((res) => {
          if ("error" in res) new Notice(res.error);
          this.host.rerender();
        });
      };
      let wheelTimer: number | null = null;
      rows.forEach((r, i) => {
        r.slider.addEventListener("input", () => {
          weights = rebalance(weights, i, Number(r.slider.value));
          showWeights();
        });
        r.slider.addEventListener("change", () => relearnWith(weights));
        // Scroll to nudge by 5%; re-learn once the wheel stops.
        r.slider.addEventListener("wheel", (e) => {
          e.preventDefault();
          weights = rebalance(weights, i, wheelValue(weights[i], e.deltaY, { min: 0, max: 100, step: 5 }));
          showWeights();
          if (wheelTimer !== null) window.clearTimeout(wheelTimer);
          wheelTimer = window.setTimeout(() => relearnWith(weights), 500);
        }, { passive: false });
      });
      if (stored) {
        const bySize = box.createEl("button", { text: "Back to region size", attr: { title: "Let each region count by how many hexes it has painted" } });
        bySize.addEventListener("click", () => relearnWith(null));
      }
    }

    const info = [
      `${model.terrains.length} terrains`,
      model.exampleHexes ? `learned from ${model.exampleHexes} hexes` : "",
      model.meta.created ? `created ${model.meta.created}` : "",
      model.meta[VERSION_KEY] ? `v${model.meta[VERSION_KEY]}` : "",
      g.file.path,
    ].filter(Boolean);
    el.createEl("p", { text: info.join(" · "), cls: "duckmage-map-origin-desc" });
    const resetRow = el.createDiv({ cls: "duckmage-region-row" });
    const resetBtn = resetRow.createEl("button", { text: "Reset settings to defaults", attr: { title: "Clear every setting below back to its default" } });
    resetBtn.addEventListener("click", () => {
      new ConfirmModal(this.app, "Reset settings", `Reset all of "${model.name}"'s settings to their defaults?`, "Reset", () => {
        const cleared: Partial<Record<keyof GeneratorSettings, unknown>> = {};
        for (const k of Object.keys(model.settings ?? {})) cleared[k as keyof GeneratorSettings] = undefined;
        save(cleared);
        this.host.rerender();
      }).open();
    });

    // Preview (in the sticky side column), with the map's seed, size and
    // palette right under it.
    const previewBox = side.createDiv({ cls: "duckmage-wfc-section" });
    previewBox.createEl("h4", { text: "Preview" });
    const canvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const status = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const previewRow = previewBox.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    previewRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = previewRow.createEl("input", { type: "number", value: String(this.seed), cls: "duckmage-wfc-seed" });
    // Locked: the button regenerates with the same seed, so a settings change
    // can be compared on the same map (large maps don't preview on their own).
    const lockBtn = previewRow.createEl("button", { cls: "clickable-icon duckmage-wfc-lock" });
    const rerollBtn = previewRow.createEl("button");
    previewRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    const colsInput = previewRow.createEl("input", { type: "number", value: String(this.previewCols), cls: "duckmage-wfc-num" });
    previewRow.createSpan({ text: "×" });
    const rowsInput = previewRow.createEl("input", { type: "number", value: String(this.previewRows), cls: "duckmage-wfc-num" });
    const paletteRow = previewBox.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    paletteRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
    const paletteSelect = paletteRow.createEl("select");
    for (const p of this.plugin.settings.terrainPalettes) paletteSelect.createEl("option", { value: p.name, text: p.name });
    paletteSelect.value = GeneratorPanel.paletteName;
    paletteSelect.addEventListener("change", () => {
      GeneratorPanel.paletteName = paletteSelect.value;
      this.host.rerender();
    });
    if (!generatorFitsPalette(model, this.paletteTerrains())) {
      paletteRow.createSpan({
        text: "⚠ Some of this generator's terrains aren't in this palette",
        cls: "duckmage-map-origin-desc",
        attr: { title: `Learned with palette ${model.meta.palette ?? "unknown"}` },
      });
    }

    // Map settings lead the controls: preset sizes for now. The exact size,
    // seed and palette sit under the preview.
    el = this.section(main, "Map settings");
    const presetRow = el.createDiv({ cls: "duckmage-wfc-chips duckmage-wfc-presets" });
    const sourceMap = this.plugin.getMap(sourceMapsOf(model)[0] ?? "");
    const presets = sizePresets(sourceMap ? { name: sourceMap.name, cols: sourceMap.gridSize.cols, rows: sourceMap.gridSize.rows } : undefined);
    const presetBtns = presets.map((p) => {
      const btn = presetRow.createEl("button", { cls: "duckmage-wfc-chip" });
      btn.createSpan({ text: p.label });
      btn.createSpan({ text: `${p.cols}×${p.rows}`, cls: "duckmage-wfc-preset-size" });
      btn.addEventListener("click", () => {
        colsInput.value = String(p.cols);
        rowsInput.value = String(p.rows);
        markPreset();
        schedulePreview();
      });
      return { p, btn };
    });
    const markPreset = () => {
      for (const { p, btn } of presetBtns)
        btn.toggleClass("is-selected", Number(colsInput.value) === p.cols && Number(rowsInput.value) === p.rows);
    };
    markPreset();
    for (const input of [colsInput, rowsInput]) {
      input.addEventListener("input", markPreset);
      input.addEventListener("change", markPreset);
    }

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
    const createRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    const newNameInput = createRow.createEl("input", { type: "text", attr: { placeholder: "Name for the new map" } });
    const createBtn = createRow.createEl("button", { text: "Create map", cls: "mod-cta" });

    // Saves: keep a generated map and its settings without creating a map.
    const savesBox = previewBox.createDiv({ cls: "duckmage-wfc-saves" });
    savesBox.createEl("h5", { text: "Saves", cls: "duckmage-wfc-heading" });
    const saveRow = savesBox.createDiv({ cls: "duckmage-region-row" });
    const saveNameInput = saveRow.createEl("input", { type: "text", attr: { placeholder: "Save name (optional)" } });
    const saveBtn = saveRow.createEl("button", { text: "Save", attr: { title: "Save these settings, seed and size with the generated map" } });
    const loadRow = savesBox.createDiv({ cls: "duckmage-region-row" });
    const loadSelect = loadRow.createEl("select", { cls: "duckmage-wfc-save-select" });
    const loadBtn = loadRow.createEl("button", { text: "Load" });
    const fillSaves = () => {
      const current = pluginVersion(this.plugin);
      const saves = listSaves(this.plugin);
      loadSelect.empty();
      if (!saves.length) loadSelect.createEl("option", { value: "", text: "No saves yet" });
      for (const sv of saves) {
        const other = compareVersions(sv.version, current) !== 0 ? ` · v${sv.version}` : "";
        loadSelect.createEl("option", { value: sv.file.path, text: `${sv.name} · ${sv.generator} · seed ${sv.seed} · ${sv.size}${other}` });
      }
      loadBtn.disabled = !saves.length;
    };
    fillSaves();

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
    // Path rows (filled in further down) and the last drawn preview, so
    // hovering a row can redraw it with that route highlighted.
    const pathRows = new Map<string, { placed: HTMLElement; count: HTMLInputElement; auto: number }>();
    let lastDraw: ((highlight?: string) => void) | null = null;
    let hoveredRoute: string | undefined;
    const updatePathRows = (stats: RouteStat[]) => {
      const byRoute = new Map(stats.map((st) => [st.route, st]));
      for (const [route, row] of pathRows) {
        const st = byRoute.get(route);
        row.auto = st?.auto ?? row.auto;
        row.count.placeholder = `Auto (${row.auto})`;
        if (!st || !pathsEnabled(model) || st.wanted === 0) {
          row.placed.setText("Off");
          row.placed.removeClass("is-short");
          continue;
        }
        row.placed.setText(`${st.placed} of ${st.wanted}`);
        row.placed.toggleClass("is-short", st.placed < st.wanted);
      }
    };
    /** The loaded save, while the page shows exactly its generator, seed and size. */
    const showingSave = (): GeneratorSave | null => {
      const sv = GeneratorPanel.loadedSave;
      if (!sv || !isThisGenerator(sv)) return null;
      if (sv.seed !== Number(seedInput.value) >>> 0 || sv.cols !== Number(colsInput.value) || sv.rows !== Number(rowsInput.value)) return null;
      return sv;
    };
    /** What the preview shows now, for Save. */
    let shown: { cells: Map<string, string>; paths: { type: string; route?: string; hexes: string[] }[] } | null = null;
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
      // A loaded save shows its own map if this version generates a different one.
      let cells = r.cells;
      let rawPaths: { type: string; route?: string; hexes: string[] }[] = r.paths;
      let saveNote = "";
      const sv = showingSave();
      if (sv) {
        if (sameCells(sv.cells, r.cells)) saveNote = ` · save "${sv.name}"`;
        else {
          cells = sv.cells;
          rawPaths = sv.paths;
          saveNote = ` · saved map "${sv.name}" (from v${sv.version}; this version generates it differently)`;
        }
      } else GeneratorPanel.loadedSave = null;
      shown = { cells, paths: rawPaths };
      // Paths are coloured as the map path type they'll become.
      const paths = rawPaths.map((p) => ({ ...p, type: drawnPathType(model, p) }));
      lastDraw = (highlight?: string) => {
        // Draw at the side column's device-pixel width so it stays sharp when stretched.
        const dpr = activeWindow.devicePixelRatio || 1;
        drawPreview(canvas, cells, grid, this.plugin.settings.hexOrientation, colors, r.featureCells, paths, pathColors(this.plugin),
          Math.max(420, side.clientWidth) * dpr, 40 * dpr, highlight);
      };
      lastDraw(hoveredRoute);
      updateShares(cells, grid, palette);
      updatePathRows(r.pathRoutes);
      // Short: size and time, plus a hoverable count if anything didn't fit.
      status.setText(`${grid.cols}×${grid.rows} · ${r.stats.ms} ms${r.warnings.length ? ` · ⚠ ${r.warnings.length}` : ""}${saveNote}`);
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
    saveBtn.addEventListener("click", () => {
      if (!shown) {
        new Notice("Generate a preview first (re-roll or regenerate).");
        return;
      }
      const grid = previewGrid();
      const snapshot = shown;
      saveBtn.disabled = true;
      void (async () => {
        try {
          const saved: GeneratorSave = {
            name: saveNameInput.value.trim() || `${model.name}-${this.seed}`,
            version: pluginVersion(this.plugin),
            format: SAVE_FORMAT,
            created: new Date().toISOString().slice(0, 10),
            generatorName: model.name,
            generatorPath: g.file.path,
            palette: GeneratorPanel.paletteName,
            seed: this.seed,
            cols: grid.cols,
            rows: grid.rows,
            stagger: grid.stagger,
            orientation: this.plugin.settings.hexOrientation,
            settings: { ...(model.settings ?? {}) },
            cells: snapshot.cells,
            paths: snapshot.paths,
            generatorMarkdown: await this.app.vault.read(g.file),
          };
          const file = await writeSave(this.plugin, saved);
          GeneratorPanel.loadedSave = { ...saved, name: file.basename };
          saveNameInput.value = "";
          new Notice(`Saved "${file.basename}".`);
          // The new file may not be in the metadata cache yet.
          window.setTimeout(fillSaves, 300);
        } catch (e) {
          new Notice(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          saveBtn.disabled = false;
        }
      })();
    });
    loadBtn.addEventListener("click", () => {
      const file = this.app.vault.getFileByPath(loadSelect.value);
      if (!file) return;
      loadBtn.disabled = true;
      void (async () => {
        const read = await readSave(this.plugin, file);
        if ("error" in read) {
          new Notice(`Couldn't load "${file.basename}": ${read.error}`);
          loadBtn.disabled = false;
          return;
        }
        const { save: sv, warnings } = read;
        const applied = await applySave(this.plugin, sv);
        if ("error" in applied) {
          new Notice(applied.error);
          loadBtn.disabled = false;
          return;
        }
        GeneratorPanel.loadedSave = { ...sv, generatorPath: applied.file.path };
        GeneratorPanel.selectedPath = applied.file.path;
        if (this.plugin.settings.terrainPalettes.some((p) => p.name === sv.palette)) GeneratorPanel.paletteName = sv.palette;
        GeneratorPanel.seedLocked = true;
        const notes = [
          applied.recreated ? `recreated generator "${applied.file.basename}" from the save` : "",
          compareVersions(sv.version, pluginVersion(this.plugin)) !== 0 ? `saved with v${sv.version}` : "",
          ...warnings,
        ].filter(Boolean);
        new Notice(`Loaded "${sv.name}"${notes.length ? ` (${notes.join("; ")})` : ""}.`);
        this.host.rerender();
      })();
    });
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
      const generated = generateTerrain(this.plugin, model, palette, grid, seed);
      if (!generated.ok) {
        new Notice(`Couldn't generate: ${generated.message}`);
        return;
      }
      // While a loaded save is shown, create exactly the saved map.
      const sv = showingSave();
      const r = sv ? { ...generated, cells: sv.cells, paths: sv.paths } : generated;
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
          const { chains, missing } = toPathChains(this.plugin, r.paths, model);
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
    el = this.section(main, "Shape");
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
    el = this.section(main, "Placement");
    this.slider(el, "Directional bias", "0 = terrain goes anywhere. 1 = it keeps to where it was in the example.", 0, 1, 0.05, s().directionalBias, (v) => save({ directionalBias: v }));
    this.slider(el, "Scatter", "Randomness in where patches start. Too low and one terrain can take over the map.", 0, 6, 0.5, s().scatter, (v) => save({ scatter: v }));
    if (model.terrains.some((t) => t.shape === "scatter")) {
      this.slider(el, "Spacing", "How far apart single-hex terrain stays, relative to the example. 0 = no spacing.", 0, 3, 0.25, s().spacing, (v) => save({ spacing: v }));
    }
    this.slider(el, "Randomness", "Share of hexes chosen by chance, ignoring neighbours, so rare terrain turns up here and there.", 0, 1, 0.05, s().randomness, (v) => save({ randomness: v }));

    // Guarantees
    el = this.section(main, "Guarantees");
    if (model.features?.length) {
      this.toggle(el, "Guaranteed features", "Always place the example's anchored terrain lines (such as a river painted as terrain). Drawn paths have their own section below.", s().features, (v) => save({ features: v }));
    }
    this.toggle(el, "Connected land", "Fill cut-off pockets so every passable hex connects.", s().connected, (v) => save({ connected: v }));
    this.terrainFilter(el, "Impassable terrain", model.terrains.map((t) => t.name), colors, s().impassable, (list) => save({ impassable: list }));

    // Terrain mix: per-terrain controls and what they do to the preview
    el = this.section(main, "Terrain mix");
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
        makeScrubbable(input, { min: 0, max: 99, pxPerStep: 8 });
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

    // Paths: one row per learned route (type + what its ends connect to)
    if (model.paths?.length) {
      el = this.section(main, "Paths");
      el.createEl("p", {
        text: "Roads and rivers drawn over the terrain. Count is how many of each route to draw; leave it blank for the learned amount for this map size (drag or scroll on it). Hover a row to highlight its paths on the preview.",
        cls: "duckmage-map-origin-desc",
      });
      const tweaks: Record<string, PathTweak> = Object.fromEntries(Object.entries(s().paths).map(([k, t]) => [k, { ...t }]));
      const saveTweak = (route: string, patch: Partial<PathTweak>) => {
        const t: PathTweak = { ...(tweaks[route] ?? {}), ...patch };
        for (const k of Object.keys(t) as (keyof PathTweak)[]) if (t[k] === undefined || t[k] === false) delete t[k];
        if (Object.keys(t).length) tweaks[route] = t;
        else delete tweaks[route];
        save({ paths: Object.keys(tweaks).length ? { ...tweaks } : undefined });
      };
      const table = el.createDiv({ cls: "duckmage-wfc-paths" });
      this.toggle(table, "Draw paths", "", pathsEnabled(model), (v) => {
        save({ drawPaths: v });
        table.toggleClass("is-off", !v);
      });
      table.toggleClass("is-off", !pathsEnabled(model));
      const mapTypes = (this.plugin.settings.pathTypes ?? []).map((t) => t.name);
      const typeColors = pathColors(this.plugin);
      for (const f of model.paths) {
        const route = pathRouteKey(f);
        const end = (e: string) => (e === "edge" ? "map edge" : e === "path" ? `a ${f.type}` : e === "none" ? "anywhere" : e);
        const tw = tweaks[route] ?? {};
        const row = table.createDiv({ cls: "duckmage-wfc-path-row" + (tw.off ? " is-off" : "") });
        row.addEventListener("mouseenter", () => {
          hoveredRoute = route;
          lastDraw?.(route);
        });
        row.addEventListener("mouseleave", () => {
          hoveredRoute = undefined;
          lastDraw?.();
        });

        // Line 1: on, name, route, count, becomes, placed
        const top = row.createDiv({ cls: "duckmage-wfc-path-top" });
        const on = top.createEl("input", { type: "checkbox", attr: { "aria-label": `Draw ${f.type} (${end(f.from)} to ${end(f.to)})` } });
        on.checked = !tw.off;
        on.addEventListener("change", () => {
          row.toggleClass("is-off", !on.checked);
          saveTweak(route, { off: !on.checked || undefined });
        });
        const name = top.createSpan({ cls: "duckmage-wfc-terrain-name" });
        name.createSpan({ cls: "duckmage-wfc-swatch" }).setCssProps({
          "--duckmage-wfc-swatch": typeColors.get(tw.as ?? f.type) ?? "var(--background-modifier-border)",
        });
        name.createSpan({ text: f.type });
        top.createSpan({ text: `${end(f.from)} → ${end(f.to)}`, cls: "duckmage-map-origin-desc duckmage-wfc-path-route" });

        const countWrap = top.createSpan({ cls: "duckmage-wfc-path-count" });
        countWrap.createSpan({ text: "Count", cls: "duckmage-map-origin-label" });
        const count = countWrap.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", placeholder: "Auto" } });
        count.value = tw.count === undefined ? "" : String(tw.count);
        const rowState = { placed: top.createSpan({ cls: "duckmage-wfc-path-placed", text: "–" }), count, auto: 1 };
        makeScrubbable(count, { min: 0, max: 99, pxPerStep: 8, initial: () => rowState.auto });
        count.addEventListener("input", () => {
          if (count.hasClass("is-scrubbing")) {
            tweaks[route] = { ...(tweaks[route] ?? {}), count: Number(count.value) };
            model.settings = { ...(model.settings ?? {}), paths: { ...tweaks } };
            schedulePreview();
          }
        });
        count.addEventListener("change", () => {
          saveTweak(route, { count: count.value === "" ? undefined : Math.max(0, Math.floor(Number(count.value) || 0)) });
        });

        const asWrap = top.createSpan({ cls: "duckmage-wfc-path-as" });
        asWrap.createSpan({ text: "As", cls: "duckmage-map-origin-label" });
        const asSel = asWrap.createEl("select", { attr: { title: "Path type it is drawn as on the map" } });
        const learnedKnown = mapTypes.includes(f.type);
        asSel.createEl("option", { value: "", text: learnedKnown ? f.type : `${f.type} (no such type: skipped)` });
        for (const t of mapTypes) if (t !== f.type) asSel.createEl("option", { value: t, text: t });
        asSel.value = tw.as && mapTypes.includes(tw.as) ? tw.as : "";
        asSel.addEventListener("change", () => saveTweak(route, { as: asSel.value || undefined }));
        top.appendChild(rowState.placed);
        pathRows.set(route, rowState);

        // Line 2: shape of the route
        const knobs = row.createDiv({ cls: "duckmage-wfc-path-knobs" });
        const knob = (label: string, title: string, key: "wiggle" | "length" | "follow", max: number) => {
          const cell = knobs.createSpan({ cls: "duckmage-wfc-mix", attr: { title } });
          cell.createSpan({ text: label, cls: "duckmage-map-origin-label" });
          const slider = cell.createEl("input", { type: "range" });
          slider.min = "0";
          slider.max = String(max);
          slider.step = "0.25";
          slider.value = String(tw[key] ?? 1);
          const valueLabel = cell.createSpan({ text: `×${slider.value}` });
          slider.addEventListener("input", () => valueLabel.setText(`×${slider.value}`));
          slider.addEventListener("change", () => {
            const v = Number(slider.value);
            saveTweak(route, { [key]: v === 1 ? undefined : v });
          });
        };
        knob("Wiggle", "How much it meanders. 0 = as straight as the terrain allows.", "wiggle", 3);
        if (f.to === "none" || f.to === "edge") knob("Length", "How long it runs, relative to the example.", "length", 3);
        knob("Follow terrain", "How strongly it keeps to the terrains it ran through in the example. 0 = ignores terrain.", "follow", 3);
      }
    }


    schedulePreview();
  }

  // ── Small controls ───────────────────────────────────────────────────────

  /**
   * A titled group of controls; click the title to fold it away. Folded
   * sections stay folded across re-renders. Returns the section's body.
   */
  private section(el: HTMLElement, text: string): HTMLElement {
    const box = el.createDiv({ cls: "duckmage-wfc-group" });
    const title = box.createEl("h5", { cls: "duckmage-wfc-heading is-collapsible", attr: { role: "button", tabindex: "0" } });
    setIcon(title.createSpan({ cls: "duckmage-wfc-fold" }), "chevron-down");
    title.createSpan({ text });
    const body = box.createDiv({ cls: "duckmage-wfc-group-body" });
    const show = () => {
      const folded = GeneratorPanel.collapsed.has(text);
      box.toggleClass("is-collapsed", folded);
      title.setAttr("aria-expanded", String(!folded));
    };
    const toggle = () => {
      if (!GeneratorPanel.collapsed.delete(text)) GeneratorPanel.collapsed.add(text);
      show();
    };
    title.addEventListener("click", toggle);
    title.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    });
    show();
    return body;
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

/** Same terrain on every hex. */
function sameCells(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, t] of a) if (b.get(k) !== t) return false;
  return true;
}

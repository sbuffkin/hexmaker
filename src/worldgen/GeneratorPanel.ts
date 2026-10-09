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
  generatorSettings,
  drawnPathType,
  generatorFitsPalette,
  paletteColors,
  pathColors,
  relearnGenerator,
  toPathChains,
  type GeneratorFile,
} from "./generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import { makeScrubbable } from "./scrub";
import { pickerItems, type PickerItem } from "./picker";
import { listSaves, writeSave, readSave, applySave } from "./saves";
import { SAVE_FORMAT, type GeneratorSave } from "./saveFormat";
import { compareVersions, pluginVersion } from "../compat";
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

    // One picker: choose a generator, or learn a new one from a region.
    const pickRow = el.createDiv({ cls: "duckmage-region-row" });
    const picker = pickRow.createDiv({ cls: "duckmage-wfc-picker" });
    const input = picker.createEl("input", {
      type: "text",
      cls: "duckmage-wfc-picker-input",
      attr: { placeholder: "Search generators and regions…", role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" },
    });
    const list = picker.createDiv({ cls: "duckmage-wfc-picker-list", attr: { role: "listbox" } });
    list.hide();
    const openBtn = pickRow.createEl("button", { text: "Open file" });
    openBtn.disabled = true;
    const relearnBtn = pickRow.createEl("button", { text: "Re-learn", attr: { title: "Learn again from the region it came from, keeping its settings" } });
    relearnBtn.disabled = true;
    const body = el.createDiv();
    let generators: GeneratorFile[] = [];
    const current = () => generators.find((g) => g.file.path === GeneratorPanel.selectedPath);

    const show = () => {
      body.empty();
      side.empty();
      const g = current();
      input.value = g?.model.name ?? "";
      openBtn.disabled = !g;
      relearnBtn.disabled = !g?.model.meta["source-map"];
      if (g) this.renderGenerator(body, side, g);
      else {
        const text = generators.length ? "Pick a generator above." : "No generators yet. Search above for a region to learn one from.";
        body.createEl("p", { text, cls: "duckmage-map-origin-desc" });
        side.createEl("p", { text: "Pick a generator to preview it here.", cls: "duckmage-map-origin-desc" });
      }
    };
    const choose = (g: GeneratorFile) => {
      GeneratorPanel.selectedPath = g.file.path;
      const source = g.model.meta["source-map"];
      if (source && this.plugin.getMap(source)) GeneratorPanel.mapName = source;
      const palette = g.model.meta.palette;
      if (palette && this.plugin.settings.terrainPalettes.some((p) => p.name === palette)) GeneratorPanel.paletteName = palette;
      show();
    };
    const learn = (region: string) => {
      input.disabled = true;
      input.value = `Learning from ${region}…`;
      void saveGeneratorFromMap(this.plugin, region, region).then((result) => {
        input.disabled = false;
        if ("error" in result) {
          new Notice(result.error);
          show();
          return;
        }
        const { model, file } = result;
        new Notice(`Learned generator "${model.name}" from ${region}: ${model.terrains.length} terrains, ${model.adjacency.length} neighbour pairs.`);
        GeneratorPanel.selectedPath = file.path;
        GeneratorPanel.mapName = region;
        GeneratorPanel.paletteName = model.meta.palette ?? GeneratorPanel.paletteName;
        this.host.rerender();
      });
    };

    // The dropdown list, filtered by what's typed.
    let items: { item: PickerItem; el: HTMLElement }[] = [];
    let active = -1;
    const setActive = (i: number) => {
      items[active]?.el.removeClass("is-active");
      active = i;
      const it = items[active];
      if (!it) return;
      it.el.addClass("is-active");
      it.el.scrollIntoView({ block: "nearest" });
    };
    const close = () => {
      list.hide();
      input.setAttr("aria-expanded", "false");
    };
    const pick = (item: PickerItem) => {
      close();
      input.blur();
      if (item.kind === "region") learn(item.value);
      else {
        const g = generators.find((x) => x.file.path === item.value);
        if (g) choose(g);
      }
    };
    const fillList = () => {
      list.empty();
      items = [];
      active = -1;
      // Showing the chosen generator's name means "no filter yet".
      const q = input.value === (current()?.model.name ?? "") ? "" : input.value;
      const found = pickerItems(
        generators.map((g) => ({ path: g.file.path, name: g.model.name, sourceMap: g.model.meta["source-map"], palette: g.model.meta.palette })),
        this.plugin.settings.maps.map((m) => ({ name: m.name, cols: m.gridSize.cols, rows: m.gridSize.rows, palette: m.paletteName })),
        q,
      );
      const group = (title: string, group: PickerItem[]) => {
        if (!group.length) return;
        list.createDiv({ text: title, cls: "duckmage-wfc-picker-group" });
        for (const item of group) {
          const row = list.createDiv({ cls: "duckmage-wfc-picker-item", attr: { role: "option" } });
          if (item.kind === "generator" && item.value === GeneratorPanel.selectedPath) row.addClass("is-selected");
          row.createSpan({ text: item.label, cls: "duckmage-wfc-picker-label" });
          row.createSpan({ text: item.detail, cls: "duckmage-wfc-picker-detail" });
          // mousedown, so the pick lands before the input's blur closes the list.
          row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            pick(item);
          });
          const index = items.length;
          row.addEventListener("mousemove", () => {
            if (active !== index) setActive(index);
          });
          items.push({ item, el: row });
        }
      };
      group("Generators", found.generators);
      group("Learn a new generator from a region", found.regions);
      if (!items.length) list.createDiv({ text: "Nothing matches", cls: "duckmage-wfc-picker-empty" });
    };
    const open = () => {
      fillList();
      list.show();
      input.setAttr("aria-expanded", "true");
    };
    input.addEventListener("focus", () => {
      input.select();
      open();
    });
    input.addEventListener("input", open);
    input.addEventListener("blur", () => {
      close();
      if (!input.disabled) input.value = current()?.model.name ?? "";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!list.isShown()) open();
        if (!items.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((active + step + items.length) % items.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[active] ?? (items.length === 1 ? items[0] : undefined);
        if (it) pick(it.item);
      } else if (e.key === "Escape") {
        input.blur();
      }
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

    input.value = "Loading…";
    input.disabled = true;
    void listGenerators(this.plugin).then((found) => {
      generators = found;
      input.disabled = false;
      // Keep the chosen generator; otherwise one learned from the current
      // region, then the first one that fits the palette.
      if (!current()) {
        const names = this.paletteTerrains();
        const g = generators.find((x) => x.model.meta["source-map"] === this.mapName)
          ?? generators.find((x) => x.model.meta.palette === GeneratorPanel.paletteName || generatorFitsPalette(x.model, names))
          ?? generators[0];
        if (g) GeneratorPanel.selectedPath = g.file.path;
      }
      show();
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

    // Map: the overall settings for the map, first among the controls.
    this.heading(el, "Map");
    const paletteRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
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
    const sizeRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    sizeRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    const colsInput = sizeRow.createEl("input", { type: "number", value: String(this.previewCols), cls: "duckmage-wfc-num" });
    sizeRow.createSpan({ text: "×" });
    const rowsInput = sizeRow.createEl("input", { type: "number", value: String(this.previewRows), cls: "duckmage-wfc-num" });
    const seedRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = seedRow.createEl("input", { type: "number", value: String(this.seed), cls: "duckmage-wfc-seed" });
    // Locked: the button regenerates with the same seed, so a settings change
    // can be compared on the same map (large maps don't preview on their own).
    const lockBtn = seedRow.createEl("button", { cls: "clickable-icon duckmage-wfc-lock" });

    // Preview (in the sticky side column)
    const previewBox = side.createDiv({ cls: "duckmage-wfc-section" });
    previewBox.createEl("h4", { text: "Preview" });
    const canvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const status = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const previewRow = previewBox.createDiv({ cls: "duckmage-region-row" });
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
    if (model.features?.length) {
      this.toggle(el, "Guaranteed features", "Always place the example's anchored terrain lines (such as a river painted as terrain). Drawn paths have their own section below.", s().features, (v) => save({ features: v }));
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
      this.heading(el, "Paths");
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

/** Same terrain on every hex. */
function sameCells(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, t] of a) if (b.get(k) !== t) return false;
  return true;
}

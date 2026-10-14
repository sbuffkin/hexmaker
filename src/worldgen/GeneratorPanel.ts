/**
 * The terrain generator page: pick a region (map) and palette, learn a
 * generator from the region, adjust a generator's settings (saved to its
 * file's frontmatter) with a live preview, and create a new map from it.
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { VIEW_TYPE_HEX_MAP } from "../constants";
import type { HexMapView } from "../hex-map/HexMapView";
import {
  listGenerators,
  saveGeneratorSettings,
  generatorSettings,
  generatorFitsPalette,
  paletteColors,
  sourceMapsOf,
  type GeneratorFile,
} from "./generators";
import { PREVIEW_AUTO_LIMIT } from "./preview";
import { GeneratorLibrary } from "./GeneratorLibrary";
import { worldMaps } from "../modules/runtime";
import { showModuleTab } from "./genPage/moduleTabs";
import { generatorPageState } from "./generatorPageState";
import { generatorMapKind, isGeneratorShown } from "../mapKinds";
import { Disclosure, Fold } from "../ui/disclosure";
import { ENGINE_TUNING_IDS, engineTuningIsSet } from "./engineTuningSet";
import type { GeneratorSave } from "./saveFormat";
import { randomSeed, type GeneratorSettings } from "../../packages/hex-wfc/src";
import type { GeneratorPageCtx, GeneratorPageHost, GeneratorPageLocal, ShownGenerator } from "./genPage/ctx";
import { renderDraftRow, renderGeneratorSettings } from "./genPage/generatorSettings";
import { renderPreviewActions, renderPreviewBox } from "./genPage/previewColumn";
import { renderMapSettings } from "./genPage/mapSettings";
import { renderShapeSections } from "./genPage/shapeSections";
import { renderTerrainMix } from "./genPage/terrainMix";
import { renderPathsSection } from "./genPage/pathsSection";

/** Labels of the biomes whose `generator:` link resolves to the generator note at `path`. */
export function biomesUsing(plugin: HexmakerPlugin, path: string): string[] {
  const out: string[] = [];
  for (const b of plugin.biomeStore?.list() ?? []) {
    if (!b.generator) continue;
    const hit = plugin.app.vault.getAbstractFileByPath(b.generator) ?? plugin.app.vault.getAbstractFileByPath(`${b.generator}.md`) ?? plugin.app.metadataCache.getFirstLinkpathDest(b.generator, "");
    if (hit?.path === path) out.push(b.label);
  }
  return out;
}

/** The page's host (re-render the whole page). */
export type GeneratorPanelHost = GeneratorPageHost;

/** selectedPath while the unsaved draft is shown. */
const DRAFT_PATH = "\u0000draft";

export class GeneratorPanel {
  /** The preview's seed and size (and its pending redraw), kept across this panel's redraws. */
  private local: GeneratorPageLocal = { seed: randomSeed(), previewCols: 30, previewRows: 20, previewTimer: null };
  /** Every generator file, once listed (neighbour regions blend with the one they were made from). */
  private generators: GeneratorFile[] = [];

  constructor(
    private app: App,
    private plugin: HexmakerPlugin,
    private host: GeneratorPanelHost,
  ) {
    const maps = plugin.settings.maps;
    if (!maps.some((m) => m.name === generatorPageState.mapName)) {
      const active = (app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0]?.view as HexMapView | undefined)?.activeMapName;
      generatorPageState.mapName = active ?? plugin.settings.defaultMap ?? maps[0]?.name ?? "";
    }
    if (!plugin.settings.terrainPalettes.some((p) => p.name === generatorPageState.paletteName))
      generatorPageState.paletteName = plugin.getMap(generatorPageState.mapName)?.paletteName ?? plugin.settings.terrainPalettes[0]?.name ?? "";
    const map = plugin.getMap(generatorPageState.mapName);
    if (map && map.gridSize.cols * map.gridSize.rows <= PREVIEW_AUTO_LIMIT) {
      this.local.previewCols = map.gridSize.cols;
      this.local.previewRows = map.gridSize.rows;
    }
    const loaded = generatorPageState.loadedSave;
    if (loaded) {
      this.local.seed = loaded.seed;
      this.local.previewCols = loaded.cols;
      this.local.previewRows = loaded.rows;
    }
  }

  private get mapName(): string {
    return generatorPageState.mapName;
  }

  private paletteTerrains(): string[] {
    return this.plugin.getPaletteByName(generatorPageState.paletteName)?.terrains.map((t) => t.name) ?? [];
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
    const current = (): ShownGenerator | undefined =>
      generatorPageState.selectedPath === DRAFT_PATH
        ? generatorPageState.draft ? { file: null, model: generatorPageState.draft, warnings: [] } : undefined
        : generators.find((g) => g.file.path === generatorPageState.selectedPath);

    const page = { rerender: () => this.host.rerender(), show: () => show(), paletteName: () => generatorPageState.paletteName, mapName: () => this.mapName }; // a module tab's host (genPage/moduleTabs.ts)
    const show = () => {
      body.empty();
      side.empty();
      if (showModuleTab(this.plugin, GeneratorLibrary.tab, body, side, page)) return;
      // World maps: a blend-field biome shown instead of a generator (BiomePanel).
      const wm = worldMaps();
      wm?.BiomePanel.dispose();
      const biome = generatorPageState.biome ? this.plugin.biomeStore?.get(generatorPageState.biome) : undefined;
      if (wm && biome && !biome.generator) {
        const panel = new wm.BiomePanel(this.plugin, {
          rerender: () => this.host.rerender(),
          section: (e, t) => this.section(e, t),
          back: () => { generatorPageState.biome = ""; wm.BiomePanel.dispose(); show(); },
        }, biome.id, () => generatorPageState.paletteName);
        panel.onPalette = (name) => { generatorPageState.paletteName = name; show(); };
        panel.render(body, side);
        return;
      }
      generatorPageState.biome = "";
      const g = current();
      if (g) this.renderGenerator(body, side, g);
      else {
        const text = generators.length ? "Click a generator above to load it." : "No generators yet. Learn one from a map above.";
        body.createEl("p", { text, cls: "duckmage-map-origin-desc" });
        side.createEl("p", { text: "Pick a generator to preview it here.", cls: "duckmage-map-origin-desc" });
      }
    };
    const choose = (g: GeneratorFile) => {
      generatorPageState.biome = "";
      generatorPageState.selectedPath = g.file.path;
      const source = sourceMapsOf(g.model)[0];
      if (source && this.plugin.getMap(source)) generatorPageState.mapName = source;
      const palette = g.model.meta.palette;
      if (palette && this.plugin.settings.terrainPalettes.some((p) => p.name === palette)) generatorPageState.paletteName = palette;
      show();
    };

    void listGenerators(this.plugin).then((found) => {
      // Planet generators (map-kind: planet) are hidden while the Space map
      // type is off, unless this palette/map is in space or one is loaded.
      const context = new Set([
        this.plugin.getPaletteOrPresetKind(generatorPageState.paletteName),
        ...(this.mapName ? this.plugin.contextKinds(this.mapName) : []),
      ]);
      generators = found.filter((g) => isGeneratorShown(this.plugin.settings, generatorMapKind(g.model.meta), {
        context,
        selected: g.file.path === generatorPageState.selectedPath,
      }));
      const hiddenBySpace = found.length - generators.length;
      this.generators = found;
      // Keep the chosen generator; otherwise one learned from the current
      // region, then the first one that fits the palette.
      if (!current()) {
        const names = this.paletteTerrains();
        const g = generators.find((x) => sourceMapsOf(x.model).includes(this.mapName))
          ?? generators.find((x) => x.model.meta.palette === generatorPageState.paletteName || generatorFitsPalette(x.model, names))
          ?? generators[0];
        if (g) generatorPageState.selectedPath = g.file.path;
      }
      libraryEl.empty();
      new GeneratorLibrary(this.app, this.plugin, generators, {
        selectedPath: () => generatorPageState.selectedPath,
        page,
        load: choose,
        loadDraft: (draft) => {
          generatorPageState.biome = "";
          generatorPageState.draft = draft;
          generatorPageState.selectedPath = DRAFT_PATH;
          show();
        },
        changed: (selectPath) => {
          if (selectPath) generatorPageState.selectedPath = selectPath;
          this.host.rerender();
        },
      }).render(libraryEl);
      const hidden = `${hiddenBySpace} space generator${hiddenBySpace === 1 ? "" : "s"} hidden — space maps are off (settings → map types).`;
      if (hiddenBySpace > 0) libraryEl.createEl("p", { text: hidden, cls: "duckmage-map-origin-desc" });
      show();
    });
  }

  // ── One generator ────────────────────────────────────────────────────────

  private renderGenerator(main: HTMLElement, side: HTMLElement, g: ShownGenerator): void {
    const { model } = g;
    /** The generator's file; null for an unsaved draft, which lives only in memory. */
    const file = g.file;
    const saved = file ? { ...g, file } : null;
    const el = main;
    // The page's Advanced dropdown (closed by default, open state kept per
    // device) holds the overkill controls in sub-sections: Engine tuning,
    // Paths (single routes) and Seed. The placement map (src/ui/placement.ts)
    // says which, by GenPage.<control> id; nothing here needs debug mode.
    const disclosure = new Disclosure(this.plugin.app, "GenPage", () => main);
    // Engine controls off their default count in the headers
    // ("Engine tuning · 2 set"); s() is defined below and read later.
    const place = (id: string, control: HTMLElement) =>
      disclosure.place(id, control, ENGINE_TUNING_IDS.includes(id) ? () => engineTuningIsSet(id, s()) : undefined);
    /** A section whose controls all moved to Advanced or Debug goes. */
    const dropIfEmpty = (body: HTMLElement) => {
      if (!body.childElementCount) body.parentElement?.remove();
    };
    const colors = paletteColors(this.plugin, generatorPageState.paletteName);
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
    // Biomes whose regions this generator makes (their note links it).
    const usedBy = file ? biomesUsing(this.plugin, file.path) : [];
    if (usedBy.length) {
      el.createEl("p", {
        cls: "duckmage-map-origin-desc duckmage-wfc-used-by",
        text: `Used by biome${usedBy.length === 1 ? "" : "s"} ${usedBy.join(", ")}: ${usedBy.length === 1 ? "its" : "their"} overworld regions are made by this generator.`,
      });
    }

    // Current settings, kept in sync with the file.
    const s = () => generatorSettings(model, this.plugin.getPaletteByName(generatorPageState.paletteName)?.terrains ?? []);
    // A just-loaded save's settings win over a possibly stale read of the file.
    const isThisGenerator = (sv: GeneratorSave) => (!!file && sv.generatorPath === file.path) || sv.generatorName === model.name;
    if (generatorPageState.loadedSave && isThisGenerator(generatorPageState.loadedSave)) model.settings = { ...generatorPageState.loadedSave.settings };
    /** The last settings write, for anything that must re-read the file after it. */
    let lastWrite: Promise<void> = Promise.resolve();
    /** The preview's scheduler, once the preview column is drawn (renderPreviewActions). */
    let schedulePreview = (): void => {};
    const save = (patch: Partial<Record<keyof GeneratorSettings, unknown>>) => {
      generatorPageState.loadedSave = null;
      const next: Record<string, unknown> = { ...(model.settings ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      model.settings = next;
      if (file)
        lastWrite = saveGeneratorSettings(this.plugin, file, patch).catch((e: unknown) => {
          new Notice(`Couldn't save generator settings: ${e instanceof Error ? e.message : String(e)}`);
        });
      schedulePreview();
    };

    const generators = () => this.generators;
    const ctx: GeneratorPageCtx = {
      app: this.app,
      plugin: this.plugin,
      host: this.host,
      g,
      model,
      file,
      saved,
      colors,
      get mapName() { return generatorPageState.mapName; },
      get generators() { return generators(); },
      local: this.local,
      paletteTerrains: () => this.paletteTerrains(),
      s,
      save,
      get lastWrite() { return lastWrite; },
      isThisGenerator,
      place,
      dropIfEmpty,
      section: (e, t) => this.section(e, t),
      schedulePreview: () => schedulePreview(),
      shareCells: new Map(),
      pathRows: new Map(),
      pathGroupPlaced: new Map(),
      preview: { lastDraw: null, hoveredRoute: undefined },
    };
    // Page order: the draft bar, Generator settings (moved to the end
    // below), the preview column's top, Map settings (it can lock the
    // preview's size), the preview's behaviour, then the engine sections.
    renderDraftRow(ctx, main);
    const generatorSettingsBox = renderGeneratorSettings(ctx, main);
    const preview = renderPreviewBox(ctx, side);
    const { connected, genModel } = renderMapSettings(ctx, main, preview);
    schedulePreview = renderPreviewActions(ctx, preview, connected, genModel);
    renderShapeSections(ctx, main);
    renderTerrainMix(ctx, main);
    renderPathsSection(ctx, main);

    // Set-once generator settings below the generating controls, then the
    // seed into Advanced → Seed (last of its sub-sections), then the
    // Advanced dropdown after every section.
    if (generatorSettingsBox) main.appendChild(generatorSettingsBox);
    place("GenPage.seed", preview.seedBox);
    disclosure.toEnd();
    schedulePreview();
  }

  /**
   * A titled group of controls; click the title to fold it away. Folded
   * sections stay folded across re-renders. Returns the section's body.
   */
  section(el: HTMLElement, text: string): HTMLElement {
    // The shared Fold (src/ui/disclosure.ts): open at first, remembered on this device.
    return new Fold(el, {
      title: text,
      store: this.plugin.app,
      surface: "GenPage",
      cls: "duckmage-wfc-group",
      summaryCls: "duckmage-wfc-heading",
      bodyCls: "duckmage-wfc-group-body",
    }).body;
  }
}

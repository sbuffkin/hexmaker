import { App, Menu, Notice, TFolder } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexMapView } from "./HexMapView";
import { normalizeFolder, slugify, getIconUrl, createIconEl, importBinaryFileToVault } from "../utils";
import { getSubmapFromFile, setSubmapInFile } from "../frontmatter";
import { exportMapAsPng } from "../export/mapPngRenderer";
import { exportMapAsPdf } from "../export/exporters/mapWithTable";
import { exportMapAsManual } from "../export/exporters/hexcrawlManual";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import {
  listGenerators,
  generatorFitsPalette,
  saveGeneratorFromMap,
  generatorsForRegion,
  generateTerrain,
  paletteColors,
  pathColors,
  toPathChains,
  type GeneratorFile,
} from "../worldgen/generators";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "../worldgen/preview";
import { randomSeed } from "../../packages/hex-wfc/src";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"];

type ModalTab = "Maps" | "Properties" | "New map" | "Export";

function makeCheckbox(
  parent: HTMLElement,
  labelText: string,
  initial: boolean,
): HTMLInputElement {
  const row = parent.createDiv({ cls: "duckmage-export-tab-row" });
  const cb = row.createEl("input", {
    type: "checkbox",
    cls: "duckmage-export-tab-checkbox",
  });
  cb.checked = initial;
  row.createEl("label", { text: labelText, cls: "duckmage-export-tab-label" });
  // Make the label clickable to toggle the box.
  row.addEventListener("click", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    cb.checked = !cb.checked;
  });
  return cb;
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export class MapModal extends HexmakerModal {
  private confirmingDelete: string | null = null;
  private activeTab: ModalTab = "Maps";

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private view: HexMapView,
    private onChanged: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Maps");
    this.makeDraggable();
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-region-modal");

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: "duckmage-rt-mode-tabs duckmage-map-modal-tabs" });
    const tabNames: ModalTab[] = ["Maps", "Properties", "New map", "Export"];

    const contentDivs = new Map<ModalTab, HTMLElement>();
    for (const tab of tabNames) {
      const div = contentEl.createDiv({ cls: "duckmage-map-modal-tab-content" });
      contentDivs.set(tab, div);
      if (tab !== this.activeTab) div.hide();
    }

    const tabBtns = new Map<ModalTab, HTMLButtonElement>();
    for (const tab of tabNames) {
      const btn = tabBar.createEl("button", {
        text: tab,
        cls: "duckmage-rt-mode-tab" + (tab === this.activeTab ? " is-active" : ""),
      });
      tabBtns.set(tab, btn);
      btn.addEventListener("click", () => {
        this.activeTab = tab;
        for (const [t, div] of contentDivs) {
          if (t === tab) div.show(); else div.hide();
        }
        for (const [t, b] of tabBtns) {
          if (t === tab) b.addClass("is-active"); else b.removeClass("is-active");
        }
      });
    }

    this.renderMapsTab(contentDivs.get("Maps")!);
    this.renderPropertiesTab(contentDivs.get("Properties")!);
    this.renderNewMapTab(contentDivs.get("New map")!);
    this.renderExportTab(contentDivs.get("Export")!);
  }

  // ── Export tab ────────────────────────────────────────────────────────────

  private renderExportTab(el: HTMLElement): void {
    el.empty();
    el.addClass("duckmage-export-tab");

    const mapName = this.view.activeMapName;

    el.createEl("p", {
      cls: "duckmage-export-tab-hint",
      text: `Export the active map "${mapName}" as a PNG. The file is written to the configured export folder and opened in a new tab.`,
    });

    const optsForm = el.createDiv({ cls: "duckmage-export-tab-options" });

    // File name override — defaults to the map name; suffixes are auto-appended
    // based on overlay checkboxes so the user can do successive variants without
    // hand-renaming each export.
    const nameRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    nameRow.createEl("label", {
      text: "File name",
      cls: "duckmage-export-tab-label",
    });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      cls: "duckmage-export-tab-text",
      attr: { placeholder: mapName },
    });
    nameInput.value = mapName;

    const showCoords = makeCheckbox(
      optsForm,
      "Show coordinate labels",
      true,
    );
    const showIcons = makeCheckbox(
      optsForm,
      "Show terrain / override icons",
      true,
    );
    const showPaths = makeCheckbox(
      optsForm,
      "Include paths (roads, rivers, etc.)",
      true,
    );
    const showFactionOverlay = makeCheckbox(
      optsForm,
      "Include faction overlay",
      false,
    );
    const showRegionOverlay = makeCheckbox(
      optsForm,
      "Include region overlay",
      false,
    );
    const playerEdition = makeCheckbox(
      optsForm,
      "Manual: player edition (leave out hidden and secret)",
      false,
    );

    // Output size: a dropdown of presets that map to a hex-radius value.
    // The actual PNG dimensions depend on grid size too, so we phrase the
    // presets by hex pixel size + approximate use-case.
    const sizeRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    sizeRow.createEl("label", {
      text: "Output size",
      cls: "duckmage-export-tab-label",
    });
    const sizeSelect = sizeRow.createEl("select", {
      cls: "duckmage-export-tab-select",
    });
    const sizePresets: { label: string; radius: number }[] = [
      { label: "Small (30px hexes — quick preview)", radius: 30 },
      { label: "Medium (50px hexes — standard)", radius: 50 },
      { label: "Large (80px hexes — print quality)", radius: 80 },
      { label: "Huge (120px hexes — max detail)", radius: 120 },
    ];
    for (const preset of sizePresets) {
      const opt = sizeSelect.createEl("option", {
        text: preset.label,
        value: String(preset.radius),
      });
      if (preset.radius === 50) opt.selected = true;
    }

    // Live filename preview combines the user's base name with any overlay
    // suffixes. Both suffixes attach in the order faction → region so multiple
    // exports of the same map produce a predictable filename family. The
    // preview shows the stem only — each export button adds its own extension.
    const preview = el.createDiv({ cls: "duckmage-export-tab-preview" });
    const buildStem = (): string => {
      const base = nameInput.value.trim() || mapName;
      let suffix = "";
      if (showFactionOverlay.checked) suffix += "-faction";
      if (showRegionOverlay.checked) suffix += "-region";
      return base + suffix;
    };
    const updatePreview = () => {
      preview.setText(`Output: ${buildStem()}.png  /  ${buildStem()}.pdf`);
    };
    nameInput.addEventListener("input", updatePreview);
    showFactionOverlay.addEventListener("change", updatePreview);
    showRegionOverlay.addEventListener("change", updatePreview);
    updatePreview();

    const collectOpts = () => ({
      outputName: buildStem(),
      hexRadius: clampInt(parseInt(sizeSelect.value, 10), 10, 200, 50),
      showCoords: showCoords.checked,
      showIcons: showIcons.checked,
      showPaths: showPaths.checked,
      showFactionOverlay: showFactionOverlay.checked,
      showRegionOverlay: showRegionOverlay.checked,
    });

    const actions = el.createDiv({ cls: "duckmage-export-tab-actions" });
    const exportPngBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Export PNG",
    });
    exportPngBtn.addEventListener("click", () => {
      void exportMapAsPng(this.plugin, mapName, collectOpts());
      this.close();
    });
    const exportPdfBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Export PDF with reference table",
    });
    exportPdfBtn.addEventListener("click", () => {
      void exportMapAsPdf(this.plugin, mapName, collectOpts());
      this.close();
    });
    // A printable gazetteer: legend, encounter tables, keyed hexes by
    // section, index. Uses its own print styling and hex numbering.
    const exportManualBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Export hexcrawl manual (PDF)",
    });
    exportManualBtn.addEventListener("click", () => {
      const o = collectOpts();
      void exportMapAsManual(this.plugin, mapName, {
        outputName: `${nameInput.value.trim() || mapName} ${playerEdition.checked ? "player" : "manual"}`,
        player: playerEdition.checked,
        showIcons: o.showIcons,
        showPaths: o.showPaths,
        showFactionOverlay: o.showFactionOverlay,
        showRegionOverlay: o.showRegionOverlay,
      });
      this.close();
    });
  }

  // ── Maps tab ──────────────────────────────────────────────────────────────

  private renderMapsTab(el: HTMLElement): void {
    const list = el.createEl("ul", { cls: "duckmage-region-list" });
    const canDelete = this.plugin.settings.maps.length > 1;

    for (const map of this.plugin.settings.maps) {
      const isActive = map.name === this.view.activeMapName;
      const isConfirming = this.confirmingDelete === map.name;

      const li = list.createEl("li", {
        cls: "duckmage-region-item duckmage-map-list-item" + (isActive ? " is-active" : ""),
      });
      li.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        const at = { x: e.clientX, y: e.clientY };
        // A region that already has a generator opens it; learning another
        // stays available below.
        void listGenerators(this.plugin).then((all) => {
          const existing = generatorsForRegion(all, map.name)[0];
          const menu = new Menu();
          if (existing) {
            menu.addItem((item) =>
              item
                .setTitle(`Open generator "${existing.model.name}"`)
                .setIcon("wand-sparkles")
                .onClick(() => void this.openGenerator(map.name, existing)),
            );
          }
          menu.addItem((item) =>
            item
              .setTitle(existing ? `Learn a new generator from ${map.name}` : `Create generator from ${map.name}`)
              .setIcon(existing ? "plus" : "wand-sparkles")
              .onClick(() => void this.createGeneratorFrom(map.name)),
          );
          menu.showAtPosition(at);
        });
      });

      if (isConfirming) {
        li.addClass("duckmage-map-item-confirming");
        li.createSpan({
          cls: "duckmage-map-delete-warning",
          text: `Delete "${map.name}"? This will trash all its hex notes.`,
        });
        const confirmBtn = li.createEl("button", {
          text: "Delete",
          cls: "mod-warning duckmage-map-confirm-btn",
        });
        confirmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.deleteMap(map.name);
        });
        const cancelBtn = li.createEl("button", {
          text: "Cancel",
          cls: "duckmage-map-cancel-btn",
        });
        cancelBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.confirmingDelete = null;
          this.render();
        });
      } else {
        const terrainEntry = map.terrainType
          ? this.plugin.getMapPalette(map.name).find((t) => t.name === map.terrainType)
          : undefined;
        const swatch = li.createSpan({ cls: "duckmage-map-terrain-swatch" });
        if (terrainEntry?.color) {
          swatch.style.backgroundColor = terrainEntry.color;
          swatch.addClass("duckmage-map-terrain-swatch--set");
        }

        const nameSpan = li.createSpan({ text: map.name, cls: "duckmage-map-list-name" });
        nameSpan.addEventListener("click", () => {
          this.view.switchMapFromModal(map.name);
          this.close();
        });
        li.createSpan({ cls: "duckmage-region-palette-badge", text: map.paletteName });
        if (canDelete) {
          const deleteBtn = li.createEl("button", {
            text: "✕",
            cls: "duckmage-map-delete-btn",
          });
          deleteBtn.setAttribute("aria-label", "Delete map");
          deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.confirmingDelete = map.name;
            this.render();
          });
        }
      }
    }
  }

  // ── Properties tab ────────────────────────────────────────────────────────

  private renderPropertiesTab(el: HTMLElement): void {
    const currentMap = this.plugin.getMap(this.view.activeMapName);

    // Rename
    el.createEl("h4", { text: "Rename" });
    const renameRow = el.createDiv({ cls: "duckmage-region-row" });
    const renameInput = renameRow.createEl("input", {
      type: "text",
      value: this.view.activeMapName,
    });
    const renameBtn = renameRow.createEl("button", { text: "Rename", cls: "mod-cta" });
    renameBtn.addEventListener("click", () =>
      void this.renameMap(renameInput.value.trim(), renameBtn, renameInput),
    );
    renameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter")
        void this.renameMap(renameInput.value.trim(), renameBtn, renameInput);
    });

    // Stagger offset
    el.createEl("h4", { text: "Stagger offset" });
    const staggerRow = el.createDiv({ cls: "duckmage-region-row" });
    let propStaggerVal: "odd" | "even" = currentMap?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    const propStaggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    propStaggerBtn.setText(propStaggerVal === "odd" ? "Odd" : "Even");
    propStaggerBtn.toggleClass("is-even", propStaggerVal === "even");
    propStaggerBtn.addEventListener("click", () => {
      if (!currentMap) return;
      propStaggerVal = propStaggerVal === "odd" ? "even" : "odd";
      propStaggerBtn.setText(propStaggerVal === "odd" ? "Odd" : "Even");
      propStaggerBtn.toggleClass("is-even", propStaggerVal === "even");
      currentMap.staggerOffset = propStaggerVal;
      void this.plugin.saveSettings().then(() => this.onChanged());
    });

    // Terrain theme
    el.createEl("h4", { text: "Terrain theme" });
    const terrainPalette = this.plugin.getMapPalette(this.view.activeMapName);
    const terrainGrid = el.createDiv({ cls: "duckmage-terrain-picker" });

    const clearTile = terrainGrid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-clear" +
        (!currentMap?.terrainType ? " is-selected" : ""),
    });
    clearTile.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
    clearTile.createSpan({ text: "None", cls: "duckmage-terrain-option-name" });
    clearTile.addEventListener("click", () => {
      const map = this.plugin.getMap(this.view.activeMapName);
      if (map) {
        map.terrainType = undefined;
        void this.plugin.saveSettings().then(() => this.render());
      }
    });

    for (const t of terrainPalette) {
      const tile = terrainGrid.createDiv({
        cls: "duckmage-terrain-option" +
          (currentMap?.terrainType === t.name ? " is-selected" : ""),
      });
      const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
      preview.setCssProps({ "--duckmage-bg": t.color });
      if (t.icon) {
        createIconEl(
          preview,
          getIconUrl(this.plugin, t.icon),
          t.name,
          t.iconColor,
          "duckmage-terrain-preview-icon",
        );
      }
      tile.createSpan({ text: t.name, cls: "duckmage-terrain-option-name" });
      tile.addEventListener("click", () => {
        const map = this.plugin.getMap(this.view.activeMapName);
        if (map) {
          map.terrainType = t.name;
          void this.plugin.saveSettings().then(() => this.render());
        }
      });
    }

    // ── Background image ───────────────────────────────────────────────────
    el.createEl("h4", { text: "Background image" });
    const bgRow = el.createDiv({ cls: "duckmage-region-row duckmage-bg-image-row" });
    bgRow.createSpan({
      text: currentMap?.backgroundImage?.path ?? "(none) — drop an image here",
      cls: "duckmage-bg-image-path",
    });
    const pickBtn = bgRow.createEl("button", { text: "Pick image…" });
    pickBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(
        this.app,
        this.plugin,
        (file) => this.setActiveMapBackground(file.path),
        "", // whole vault
        IMAGE_EXTENSIONS,
      ).open();
    });
    const clearBtn = bgRow.createEl("button", { text: "Clear" });
    clearBtn.disabled = !currentMap?.backgroundImage;
    clearBtn.addEventListener("click", () => {
      const map = this.plugin.getMap(this.view.activeMapName);
      if (!map) return;
      map.backgroundImage = undefined;
      void this.plugin.saveSettings().then(() => {
        this.onChanged();
        this.render();
      });
    });
    this.attachImageDropZone(bgRow, async (file) => {
      const mapName = this.view.activeMapName;
      const dest = this.bgImportFolder(mapName);
      const path = await importBinaryFileToVault(this.plugin, file, dest);
      this.setActiveMapBackground(path);
    });

    if (currentMap?.backgroundImage) {
      const bg = currentMap.backgroundImage;
      const opacityRow = el.createDiv({ cls: "duckmage-region-row" });
      opacityRow.createSpan({ text: "Opacity", cls: "duckmage-map-field-label" });
      const opacitySlider = opacityRow.createEl("input", { type: "range" });
      opacitySlider.min = "0.1";
      opacitySlider.max = "1";
      opacitySlider.step = "0.05";
      opacitySlider.value = String(bg.opacity ?? 1);
      opacitySlider.addEventListener("input", () => {
        const map = this.plugin.getMap(this.view.activeMapName);
        if (!map?.backgroundImage) return;
        map.backgroundImage.opacity = parseFloat(opacitySlider.value);
        void this.plugin.saveSettings().then(() => this.onChanged());
      });

      const calibrateBtn = el.createEl("button", {
        text: "Calibrate position & scale",
        cls: "mod-cta",
      });
      calibrateBtn.addEventListener("click", () => {
        this.close();
        this.view.enterBgCalibration();
      });
    }
  }

  /** Compute the folder where dropped bg images should land for a given map. */
  private bgImportFolder(mapName: string): string {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const base = hexFolder ? `${hexFolder}/${mapName}` : mapName;
    return `${base}/_bg`;
  }

  /**
   * Set the active map's bg image and drop the user straight into calibration
   * mode. A freshly-added background almost always needs calibration anyway —
   * no point making the user click through another button. Caller still gets
   * the option to cancel calibration (Esc / ✓ button).
   */
  private setActiveMapBackground(path: string): void {
    const map = this.plugin.getMap(this.view.activeMapName);
    if (!map) return;
    map.backgroundImage = {
      path,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
    };
    void this.plugin.saveSettings().then(() => {
      this.onChanged();
      this.close();
      this.view.enterBgCalibration();
    });
  }

  /**
   * Make `el` a drop target for an image file. Calls `onFile` with the first
   * image dropped. Adds/removes the `is-drop-target` class for visual feedback.
   */
  private attachImageDropZone(
    el: HTMLElement,
    onFile: (file: File) => Promise<void>,
  ): void {
    el.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", () => {
      el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      el.removeClass("is-drop-target");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        new Notice("Dropped file isn't an image.");
        return;
      }
      void onFile(file).catch((err) => {
        new Notice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  // ── New map tab ───────────────────────────────────────────────────────────

  private renderNewMapTab(el: HTMLElement): void {
    // Name
    el.createEl("label", { text: "Name", cls: "duckmage-map-field-label" });
    const nameRow = el.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      placeholder: "map-name",
      cls: "duckmage-map-new-name-input",
    });

    // Size
    el.createEl("label", { text: "Size", cls: "duckmage-map-field-label" });
    const sizeRow = el.createDiv({ cls: "duckmage-region-row" });
    const colsInput = sizeRow.createEl("input", {
      type: "number",
      value: String(this.plugin.settings.defaultNewMapCols ?? 20),
    });
    colsInput.setCssProps({ width: "65px" });
    sizeRow.createSpan({ text: "cols ×", cls: "duckmage-map-size-sep" });
    const rowsInput = sizeRow.createEl("input", {
      type: "number",
      value: String(this.plugin.settings.defaultNewMapRows ?? 16),
    });
    rowsInput.setCssProps({ width: "65px" });
    sizeRow.createSpan({ text: "rows", cls: "duckmage-map-size-sep" });

    // Presets
    el.createEl("label", { text: "Presets", cls: "duckmage-map-field-label" });
    const presetsRow = el.createDiv({ cls: "duckmage-region-row duckmage-map-presets-row" });
    const presets: [string, number, number][] = [
      ["Small", 5, 5],
      ["Medium", 15, 15],
      ["Large", 25, 20],
    ];
    for (const [label, cols, rows] of presets) {
      const btn = presetsRow.createEl("button", { text: `${label} (${cols}×${rows})` });
      btn.addEventListener("click", () => {
        colsInput.value = String(cols);
        rowsInput.value = String(rows);
      });
    }

    // Palette
    el.createEl("label", { text: "Palette", cls: "duckmage-map-field-label" });
    const paletteRow = el.createDiv({ cls: "duckmage-region-row" });
    const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-map-new-palette-select" });
    for (const pal of this.plugin.settings.terrainPalettes) {
      paletteSelect.createEl("option", { value: pal.name, text: pal.name });
    }

    // Generator (optional). Only generators whose terrains all exist in the
    // chosen palette are offered.
    el.createEl("label", { text: "Generator", cls: "duckmage-map-field-label" });
    el.createEl("p", {
      text: "Fill the new map with generated terrain, or leave it blank. Make generators and change their settings in the terrain generator.",
      cls: "duckmage-map-origin-desc",
    });
    const generatorRow = el.createDiv({ cls: "duckmage-region-row" });
    const generatorSelect = generatorRow.createEl("select", { cls: "duckmage-map-new-palette-select" });
    let generators: GeneratorFile[] = [];
    const fillGenerators = () => {
      const current = generatorSelect.value;
      generatorSelect.empty();
      generatorSelect.createEl("option", { value: "", text: "Blank" });
      const names = this.plugin.getPaletteByName(paletteSelect.value)?.terrains.map((t) => t.name) ?? [];
      for (const g of generators) {
        if (generatorFitsPalette(g.model, names))
          generatorSelect.createEl("option", { value: g.file.path, text: g.model.name });
      }
      generatorSelect.value = Array.from(generatorSelect.options).some((o) => o.value === current) ? current : "";
    };
    fillGenerators();
    paletteSelect.addEventListener("change", fillGenerators);
    void listGenerators(this.plugin).then((list) => {
      generators = list;
      fillGenerators();
    });

    // Preview of the generated terrain; Create uses exactly this seed.
    const previewBox = el.createDiv({ cls: "duckmage-wfc-section" });
    const previewCanvas = previewBox.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const previewStatus = previewBox.createEl("p", { cls: "duckmage-map-origin-desc" });
    const seedRow = previewBox.createDiv({ cls: "duckmage-region-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = seedRow.createEl("input", { type: "number", value: String(randomSeed()), cls: "duckmage-wfc-seed" });
    const rerollBtn = seedRow.createEl("button", { text: "Re-roll" });
    const previewBtn = seedRow.createEl("button", { text: "Preview" });
    previewBox.hide();

    // Stagger offset
    el.createEl("label", { text: "Stagger offset", cls: "duckmage-map-field-label" });
    const staggerRow = el.createDiv({ cls: "duckmage-region-row" });
    let staggerVal: "odd" | "even" = this.plugin.settings.staggerOffset ?? "odd";
    const staggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
    staggerBtn.toggleClass("is-even", staggerVal === "even");
    staggerBtn.addEventListener("click", () => {
      staggerVal = staggerVal === "odd" ? "even" : "odd";
      staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
      staggerBtn.toggleClass("is-even", staggerVal === "even");
    });

    // Starting coordinates
    el.createEl("label", { text: "Starting coordinates", cls: "duckmage-map-field-label" });
    el.createEl("p", {
      text: "Hex labels and filenames start from these values instead of 0,0.",
      cls: "duckmage-map-origin-desc",
    });
    const originRow = el.createDiv({ cls: "duckmage-region-row" });
    originRow.createSpan({ text: "X", cls: "duckmage-map-origin-label" });
    const originXInput = originRow.createEl("input", { type: "number", value: "0" });
    originXInput.setCssProps({ width: "70px" });
    originRow.createSpan({ text: "Y", cls: "duckmage-map-origin-label" });
    const originYInput = originRow.createEl("input", { type: "number", value: "0" });
    originYInput.setCssProps({ width: "70px" });

    // Background image (optional). User can either pick an existing vault file
    // (path captured locally) or drop a file from the OS (captured as a File;
    // imported into the new map's _bg folder after create).
    el.createEl("label", { text: "Background image (optional)", cls: "duckmage-map-field-label" });
    let pendingBgPath: string | null = null;
    let pendingBgFile: File | null = null;
    const bgRow = el.createDiv({ cls: "duckmage-region-row duckmage-bg-image-row" });
    const bgPathLabel = bgRow.createSpan({
      text: "(none) — drop an image here",
      cls: "duckmage-bg-image-path",
    });
    const bgPickBtn = bgRow.createEl("button", { text: "Pick image…" });
    bgPickBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(
        this.app,
        this.plugin,
        (file) => {
          pendingBgPath = file.path;
          pendingBgFile = null;
          bgPathLabel.setText(file.path);
          bgClearBtn.disabled = false;
        },
        "",
        IMAGE_EXTENSIONS,
      ).open();
    });
    const bgClearBtn = bgRow.createEl("button", { text: "Clear" });
    bgClearBtn.disabled = true;
    bgClearBtn.addEventListener("click", () => {
      pendingBgPath = null;
      pendingBgFile = null;
      bgPathLabel.setText("(None) — drop an image here");
      bgClearBtn.disabled = true;
    });
    this.attachImageDropZone(bgRow, async (file) => {
      pendingBgFile = file;
      pendingBgPath = null;
      bgPathLabel.setText(`${file.name} (will be imported on create)`);
      bgClearBtn.disabled = false;
    });

    const selectedGenerator = () => generators.find((g) => g.file.path === generatorSelect.value) ?? null;
    const runPreview = () => {
      const g = selectedGenerator();
      if (!g) return;
      const grid = {
        cols: Math.max(1, Number(colsInput.value) || 20),
        rows: Math.max(1, Number(rowsInput.value) || 16),
        offset: { x: Number(originXInput.value) || 0, y: Number(originYInput.value) || 0 },
        stagger: staggerVal,
      };
      const palette = this.plugin.getPaletteByName(paletteSelect.value)?.terrains.map((t) => t.name) ?? [];
      const r = generateTerrain(this.plugin, g.model, palette, grid, Number(seedInput.value) >>> 0);
      if (!r.ok) {
        previewStatus.setText(`This generator couldn't fill the map: ${r.message}`);
        return;
      }
      drawPreview(previewCanvas, r.cells, grid, this.plugin.settings.hexOrientation, paletteColors(this.plugin, paletteSelect.value), r.featureCells, r.paths, pathColors(this.plugin));
      previewStatus.setText(r.warnings.length ? `⚠ ${r.warnings.length}` : "");
      previewStatus.setAttr("title", r.warnings.join("\n"));
    };
    let previewTimer: number | null = null;
    const schedulePreview = () => {
      previewBox.toggle(selectedGenerator() !== null);
      if (!selectedGenerator()) return;
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      if ((Number(colsInput.value) || 0) * (Number(rowsInput.value) || 0) > PREVIEW_AUTO_LIMIT) {
        previewStatus.setText("Large map: use the preview button to see it.");
        return;
      }
      previewTimer = window.setTimeout(() => {
        previewTimer = null;
        runPreview();
      }, 200);
    };
    rerollBtn.addEventListener("click", () => {
      seedInput.value = String(randomSeed());
      schedulePreview();
    });
    previewBtn.addEventListener("click", runPreview);
    for (const input of [generatorSelect, paletteSelect, colsInput, rowsInput, originXInput, originYInput, seedInput])
      input.addEventListener("change", schedulePreview);
    staggerBtn.addEventListener("click", schedulePreview);
    presetsRow.addEventListener("click", schedulePreview);

    // Create button
    const createRow = el.createDiv({ cls: "duckmage-region-row duckmage-map-create-row" });
    const createBtn = createRow.createEl("button", { text: "Create", cls: "mod-cta" });
    const allInputs: (HTMLInputElement | HTMLSelectElement)[] = [
      nameInput, colsInput, rowsInput, paletteSelect, generatorSelect, originXInput, originYInput,
    ];
    const doCreate = () =>
      void this.handleCreate(
        nameInput.value.trim(),
        Number(colsInput.value) || 20,
        Number(rowsInput.value) || 16,
        paletteSelect.value,
        Number(originXInput.value) || 0,
        Number(originYInput.value) || 0,
        staggerVal,
        createBtn,
        allInputs,
        pendingBgPath,
        pendingBgFile,
        selectedGenerator(),
        Number(seedInput.value) >>> 0,
      );
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") doCreate();
    });
  }

  // ── Generator ─────────────────────────────────────────────────────────────

  /** Learn a generator from a region and open it in the terrain generator. */
  private async createGeneratorFrom(mapName: string): Promise<void> {
    const result = await saveGeneratorFromMap(this.plugin, mapName, mapName);
    if ("error" in result) {
      new Notice(result.error);
      return;
    }
    new Notice(`Created generator "${result.model.name}" from ${mapName}.`);
    this.close();
    await this.plugin.openTerrainGenerator({
      mapName,
      generatorPath: result.file.path,
      paletteName: result.model.meta.palette,
    });
  }

  /** Open a region's existing generator in the terrain generator. */
  private async openGenerator(mapName: string, g: GeneratorFile): Promise<void> {
    this.close();
    await this.plugin.openTerrainGenerator({
      mapName,
      generatorPath: g.file.path,
      paletteName: g.model.meta.palette,
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  private async deleteMap(name: string): Promise<void> {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      try {
        await this.app.fileManager.trashFile(folder);
      } catch (e) {
        new Notice(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
        this.confirmingDelete = null;
        this.render();
        return;
      }
    }

    this.plugin.settings.maps = this.plugin.settings.maps.filter((m) => m.name !== name);

    if (this.plugin.settings.defaultMap === name) {
      this.plugin.settings.defaultMap = this.plugin.settings.maps[0]?.name ?? "";
    }

    if (this.view.activeMapName === name) {
      this.view.activeMapName = this.plugin.settings.maps[0]?.name ?? "";
    }

    const submapRefs = this.app.vault.getMarkdownFiles().filter(
      (f) => getSubmapFromFile(this.app, f.path) === name,
    );
    await Promise.all(submapRefs.map((f) => setSubmapInFile(this.app, f.path, null)));

    this.confirmingDelete = null;
    await this.plugin.saveSettings();
    this.onChanged();
    this.render();
    new Notice(`Map "${name}" deleted.`);
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  private async renameMap(
    raw: string,
    btn: HTMLButtonElement,
    input: HTMLInputElement,
  ): Promise<void> {
    const newName = slugify(raw);
    if (!newName || newName === this.view.activeMapName) return;
    if (this.plugin.settings.maps.some((r) => r.name === newName)) {
      new Notice(`Map "${newName}" already exists.`);
      return;
    }
    btn.setText("Renaming…");
    btn.disabled = true;
    input.disabled = true;
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const oldPath = hexFolder
      ? `${hexFolder}/${this.view.activeMapName}`
      : this.view.activeMapName;
    const newPath = hexFolder ? `${hexFolder}/${newName}` : newName;
    const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFolder instanceof TFolder) {
      try {
        await this.app.fileManager.renameFile(oldFolder, newPath);
      } catch (e) {
        new Notice(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        btn.setText("Rename");
        btn.disabled = false;
        input.disabled = false;
        return;
      }
    }
    const oldName = this.view.activeMapName;
    const map = this.plugin.getMap(oldName);
    if (map) map.name = newName;
    if (this.plugin.settings.defaultMap === oldName) {
      this.plugin.settings.defaultMap = newName;
    }
    this.view.activeMapName = newName;
    await this.plugin.updateSubmapReferences(oldName, newName);
    await this.plugin.saveSettings();
    this.onChanged();
    this.render();
  }

  // ── Create ────────────────────────────────────────────────────────────────

  private async handleCreate(
    raw: string,
    cols: number,
    rows: number,
    paletteName: string,
    initialX: number,
    initialY: number,
    staggerOffset: "odd" | "even",
    btn: HTMLButtonElement,
    inputs: (HTMLInputElement | HTMLSelectElement)[],
    bgImagePath: string | null,
    bgImageFile: File | null,
    generator: GeneratorFile | null,
    seed: number,
  ): Promise<void> {
    btn.setText("Generating…");
    btn.disabled = true;
    for (const input of inputs) input.disabled = true;
    const reset = () => {
      btn.setText("Create");
      btn.disabled = false;
      for (const input of inputs) input.disabled = false;
    };

    // Solve before creating anything, so a generator that can't fill the
    // map leaves no half-made map behind.
    let terrainAt: Map<string, string> | undefined;
    let generatedPaths: { type: string; route?: string; hexes: string[] }[] = [];
    if (generator) {
      const palette = this.plugin.getPaletteByName(paletteName)?.terrains.map((t) => t.name) ?? [];
      const solved = generateTerrain(
        this.plugin, generator.model, palette,
        { cols, rows, offset: { x: initialX, y: initialY }, stagger: staggerOffset }, seed,
      );
      if (!solved.ok) {
        new Notice(`Generator "${generator.model.name}" couldn't fill this map: ${solved.message}`);
        reset();
        return;
      }
      terrainAt = solved.cells;
      generatedPaths = solved.paths;
    }

    const result = await this.plugin.createNewMap(
      raw, cols, rows, paletteName, initialX, initialY, staggerOffset,
      (done, total) => btn.setText(`Generating ${done} / ${total}…`),
      terrainAt,
    );

    if ("error" in result) {
      new Notice(result.error);
      reset();
      return;
    }

    // Resolve the bg image path: a dropped File needs importing into the new
    // map's _bg folder first; a picked vault path is used directly.
    let resolvedBgPath: string | null = bgImagePath;
    if (bgImageFile) {
      try {
        btn.setText("Importing background…");
        resolvedBgPath = await importBinaryFileToVault(
          this.plugin,
          bgImageFile,
          this.bgImportFolder(result.name),
        );
      } catch (e) {
        new Notice(`Background import failed: ${e instanceof Error ? e.message : String(e)}`);
        resolvedBgPath = null;
      }
    }

    if (generatedPaths.length) {
      const newMap = this.plugin.getMap(result.name);
      const { chains, missing } = toPathChains(this.plugin, generatedPaths, generator?.model);
      if (newMap && chains.length) {
        newMap.pathChains = [...newMap.pathChains, ...chains];
        await this.plugin.saveSettings();
      }
      if (missing.length) new Notice(`No path type named ${missing.join(", ")}, so those paths were skipped.`);
    }

    if (resolvedBgPath) {
      const newMap = this.plugin.getMap(result.name);
      if (newMap) {
        newMap.backgroundImage = {
          path: resolvedBgPath,
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotation: 0,
          opacity: 1,
        };
        await this.plugin.saveSettings();
      }
    }

    this.view.switchMapFromModal(result.name);
    this.close();
    // If the new map was created with a background image, drop straight into
    // calibration mode — same UX as adding a bg to an existing map.
    if (resolvedBgPath) this.view.enterBgCalibration();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

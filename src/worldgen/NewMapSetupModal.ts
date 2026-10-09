import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { fillPaletteSelect } from "../palettes/paletteOptions";
import { defaultSubmapName } from "../hex-map/submapNav";
import { randomSeed } from "../../packages/hex-wfc/src";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import { pathColors } from "./generators";
import { SIZE_PRESETS, type SizePreset } from "./sizePresets";
import {
  BLANK_ID,
  kindsForPalette,
  listGeneratorKinds,
  suggestBaseTerrain,
  type GenerateOutcome,
  type TerrainGeneratorKind,
} from "./registry";

/** Submaps are local (a system, a dungeon): smaller, odd sizes so there's a true centre hex. */
export const SUBMAP_SIZE_PRESETS: SizePreset[] = [
  { label: "Small", cols: 9, rows: 9 },
  { label: "Medium", cols: 13, rows: 13 },
  { label: "Large", cols: 19, rows: 19 },
];

export interface NewMapSetupResult {
  name: string;
}

/**
 * Set up a new map or submap before anything is written: name, palette,
 * size, generator (Blank, Star scatter, Orbits, learned WFC generators) and
 * its options, base terrain, with a live preview. Then either
 *  - "Generate & enter": create the map with the previewed terrain, or
 *  - "Open in generator": create it blank and open the Generator view on it
 *    for hands-on tuning.
 * `onCreated` runs after creation (callers link the parent hex / switch maps).
 */
export class NewMapSetupModal extends HexmakerModal {
  private kinds: TerrainGeneratorKind[] = [];
  private kindId = BLANK_ID;
  private options: Record<string, string> = {};
  private seed = randomSeed();
  private cols: number;
  private rows: number;
  private baseTerrain: string | undefined;
  private lastOutcome: GenerateOutcome | undefined;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onCreated: (result: NewMapSetupResult, opts: { openGenerator: boolean }) => void,
    /** Hex this map is a submap of. Drives naming, palette and size defaults. */
    private origin?: { map: string; x: number; y: number },
  ) {
    super(app);
    const preset = origin ? SUBMAP_SIZE_PRESETS[1] : SIZE_PRESETS[0];
    this.cols = preset.cols;
    this.rows = preset.rows;
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-setup-modal");
    this.titleEl.setText(
      this.origin
        ? `New submap — ${this.origin.map}, hex ${this.origin.x}, ${this.origin.y}`
        : "New map",
    );
    void listGeneratorKinds(this.plugin).then((kinds) => {
      this.kinds = kinds;
      this.render();
    });
    this.contentEl.createDiv({ cls: "duckmage-setup-loading", text: "Loading generators…" });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private terrains(paletteName: string): TerrainColor[] {
    return this.plugin.getPaletteOrPresetTerrains(paletteName);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const form = contentEl.createDiv({ cls: "duckmage-setup-form" });
    const side = contentEl.createDiv({ cls: "duckmage-setup-preview" });
    contentEl.addClass("duckmage-setup-layout");

    // ── Name ──
    const nameRow = this.row(form, "Name");
    const nameInput = nameRow.createEl("input", { type: "text", cls: "duckmage-setup-name" });
    nameInput.value = this.origin
      ? defaultSubmapName(this.origin.map, this.origin.x, this.origin.y, this.plugin.settings.maps.map((m) => m.name))
      : "";
    nameInput.placeholder = "Map name";

    // ── Palette ──
    const palRow = this.row(form, "Palette");
    const paletteSelect = palRow.createEl("select");
    fillPaletteSelect(
      this.plugin,
      paletteSelect,
      this.origin ? this.plugin.childPaletteFor(this.origin.map) : this.plugin.settings.terrainPalettes[0]?.name,
    );

    // ── Size ──
    const sizeRow = this.row(form, "Size");
    const presetBox = sizeRow.createDiv({ cls: "duckmage-setup-size-presets" });
    const custom = sizeRow.createDiv({ cls: "duckmage-setup-size-custom" });
    const colsInput = custom.createEl("input", { type: "number", value: String(this.cols), attr: { min: "1", max: "200", "aria-label": "Columns" } });
    custom.createSpan({ text: "×" });
    const rowsInput = custom.createEl("input", { type: "number", value: String(this.rows), attr: { min: "1", max: "200", "aria-label": "Rows" } });
    const presets = this.origin ? SUBMAP_SIZE_PRESETS : SIZE_PRESETS;
    const presetBtns: HTMLButtonElement[] = [];
    const syncPresetBtns = () => presets.forEach((p, i) =>
      presetBtns[i].toggleClass("is-active", p.cols === this.cols && p.rows === this.rows));
    for (const p of presets) {
      const b = presetBox.createEl("button", { text: p.label, attr: { title: `${p.cols} × ${p.rows}` } });
      b.addEventListener("click", () => {
        this.cols = p.cols; this.rows = p.rows;
        colsInput.value = String(p.cols); rowsInput.value = String(p.rows);
        syncPresetBtns();
        refresh();
      });
      presetBtns.push(b);
    }
    syncPresetBtns();
    const onSize = () => {
      this.cols = Math.max(1, Math.min(200, Number(colsInput.value) || 1));
      this.rows = Math.max(1, Math.min(200, Number(rowsInput.value) || 1));
      syncPresetBtns();
      refresh();
    };
    colsInput.addEventListener("change", onSize);
    rowsInput.addEventListener("change", onSize);

    // ── Generator ──
    const genRow = this.row(form, "Generator");
    const genList = genRow.createDiv({ cls: "duckmage-setup-generators" });
    const optsBox = form.createDiv({ cls: "duckmage-setup-options" });

    // ── Base terrain ──
    const baseRow = this.row(form, "Base terrain");
    const baseSelect = baseRow.createEl("select");
    baseRow.createDiv({
      cls: "setting-item-description",
      text: "Shown on unpainted hexes. With a base terrain, hex notes are created as you use hexes instead of all up front.",
    });

    // ── Preview ──
    const canvas = side.createEl("canvas", { cls: "duckmage-setup-canvas" });
    const seedRow = side.createDiv({ cls: "duckmage-setup-seed-row" });
    const rerollBtn = seedRow.createEl("button", { text: "🎲 Re-roll", attr: { title: "New random seed" } });
    const seedLabel = seedRow.createSpan({ cls: "duckmage-setup-seed" });
    const status = side.createDiv({ cls: "duckmage-setup-status" });
    rerollBtn.addEventListener("click", () => { this.seed = randomSeed(); refresh(); });

    // ── Actions ──
    const actions = contentEl.createDiv({ cls: "duckmage-setup-actions" });
    const goBtn = actions.createEl("button", { cls: "mod-cta" });
    const genBtn = actions.createEl("button", { text: "Open in generator", attr: { title: "Create the map blank and open the generator view on it to tune generation by hand" } });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const renderGenerators = () => {
      const terrains = this.terrains(paletteSelect.value);
      const fitting = kindsForPalette(this.kinds, terrains);
      if (!fitting.some((k) => k.id === this.kindId)) {
        // Default to the first built-in generator that fits, else Blank.
        this.kindId = fitting.find((k) => k.source === "built-in")?.id ?? BLANK_ID;
        this.options = {};
      }
      genList.empty();
      for (const k of fitting) {
        const card = genList.createEl("button", { cls: `duckmage-setup-gen${k.id === this.kindId ? " is-active" : ""}` });
        card.createDiv({ cls: "duckmage-setup-gen-title", text: k.label + (k.source === "learned" ? " (learned)" : "") });
        card.createDiv({ cls: "duckmage-setup-gen-desc", text: k.description });
        card.addEventListener("click", () => {
          this.kindId = k.id;
          this.options = {};
          renderGenerators();
          refresh();
        });
      }
      const hidden = this.kinds.length - fitting.length;
      if (hidden > 0) {
        genList.createDiv({
          cls: "setting-item-description",
          text: `${hidden} other generator${hidden === 1 ? "" : "s"} don't fit this palette.`,
        });
      }
      // Options for the chosen generator.
      optsBox.empty();
      const kind = this.kind();
      for (const opt of kind?.options ?? []) {
        const r = this.row(optsBox, opt.label);
        const sel = r.createEl("select");
        for (const c of opt.choices) sel.createEl("option", { value: c.value, text: c.label });
        sel.value = this.options[opt.key] ?? opt.default;
        sel.addEventListener("change", () => { this.options[opt.key] = sel.value; refresh(); });
      }
      goBtn.setText(this.kindId === BLANK_ID ? (this.origin ? "Create & enter" : "Create") : (this.origin ? "Generate & enter" : "Generate"));
    };

    const renderBase = () => {
      const terrains = this.terrains(paletteSelect.value);
      baseSelect.empty();
      baseSelect.createEl("option", { value: "", text: "None (create every hex note)" });
      for (const t of terrains) baseSelect.createEl("option", { value: t.name, text: t.name });
      this.baseTerrain = suggestBaseTerrain(terrains);
      baseSelect.value = this.baseTerrain ?? "";
    };
    baseSelect.addEventListener("change", () => { this.baseTerrain = baseSelect.value || undefined; refresh(); });

    const refresh = () => {
      seedLabel.setText(`seed ${this.seed}`);
      const terrains = this.terrains(paletteSelect.value);
      const kind = this.kind();
      const grid = this.grid();
      status.empty();
      this.lastOutcome = undefined;
      let cells = new Map<string, string>();
      let paths: { type: string; route?: string; hexes: string[] }[] = [];
      let featureCells: Set<string> | undefined;
      if (kind && kind.id !== BLANK_ID) {
        if (this.cols * this.rows > PREVIEW_AUTO_LIMIT) {
          status.setText("Large map — the preview is skipped; terrain is generated on create.");
        } else {
          const outcome = kind.generate({ terrains, grid, seed: this.seed, options: this.resolvedOptions(kind) });
          this.lastOutcome = outcome;
          if (!outcome.ok) {
            status.setText(outcome.message);
            status.addClass("mod-warning");
          } else {
            status.removeClass("mod-warning");
            cells = outcome.cells;
            paths = outcome.paths;
            featureCells = outcome.featureCells;
            if (outcome.warnings.length) status.setText(outcome.warnings.join(" "));
          }
        }
      }
      // Unpainted hexes preview as the base terrain, like the map will show them.
      if (this.baseTerrain) {
        for (let i = 0; i < this.cols; i++)
          for (let j = 0; j < this.rows; j++) {
            const k = `${i}_${j}`;
            if (!cells.has(k)) cells.set(k, this.baseTerrain);
          }
      }
      rerollBtn.toggle(!!kind && kind.id !== BLANK_ID);
      drawPreview(
        canvas,
        cells,
        grid,
        this.plugin.settings.hexOrientation,
        new Map(terrains.map((t) => [t.name, t.color])),
        featureCells,
        paths,
        pathColors(this.plugin),
        320,
        18,
      );
    };

    paletteSelect.addEventListener("change", () => { renderGenerators(); renderBase(); refresh(); });

    goBtn.addEventListener("click", () => void this.create(nameInput.value, paletteSelect.value, false, goBtn, genBtn));
    genBtn.addEventListener("click", () => void this.create(nameInput.value, paletteSelect.value, true, goBtn, genBtn));
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") goBtn.click();
    });

    renderGenerators();
    renderBase();
    refresh();
    nameInput.focus();
    nameInput.select();
  }

  private row(parent: HTMLElement, label: string): HTMLElement {
    const r = parent.createDiv({ cls: "duckmage-setup-row" });
    r.createDiv({ cls: "duckmage-setup-label", text: label });
    return r.createDiv({ cls: "duckmage-setup-control" });
  }

  private kind(): TerrainGeneratorKind | undefined {
    return this.kinds.find((k) => k.id === this.kindId);
  }

  private resolvedOptions(kind: TerrainGeneratorKind): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of kind.options) out[o.key] = this.options[o.key] ?? o.default;
    return out;
  }

  private grid() {
    const parent = this.origin ? this.plugin.getMap(this.origin.map) : undefined;
    return {
      cols: this.cols,
      rows: this.rows,
      offset: { x: 0, y: 0 },
      stagger: parent?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd",
    };
  }

  private async create(
    rawName: string,
    paletteName: string,
    openGenerator: boolean,
    ...buttons: HTMLButtonElement[]
  ): Promise<void> {
    const kind = this.kind();
    const terrains = this.terrains(paletteName);
    let outcome: GenerateOutcome | undefined;
    if (!openGenerator && kind && kind.id !== BLANK_ID) {
      outcome = this.lastOutcome
        ?? kind.generate({ terrains, grid: this.grid(), seed: this.seed, options: this.resolvedOptions(kind) });
      if (!outcome.ok) {
        new Notice(outcome.message);
        return;
      }
    }

    for (const b of buttons) b.disabled = true;
    const goBtn = buttons[0];
    const label = goBtn.getText();
    goBtn.setText("Creating…");
    const result = await this.plugin.createNewMap(
      rawName.trim(),
      this.cols,
      this.rows,
      paletteName,
      0,
      0,
      this.grid().stagger,
      (done, total) => goBtn.setText(`Creating ${done} / ${total}…`),
      outcome?.ok ? outcome.cells : undefined,
      {
        baseTerrain: this.baseTerrain,
        parent: this.origin ? { map: this.origin.map, hex: `${this.origin.x}_${this.origin.y}` } : undefined,
        quiet: true,
      },
    );
    if ("error" in result) {
      new Notice(result.error);
      for (const b of buttons) b.disabled = false;
      goBtn.setText(label);
      return;
    }

    // Generated paths (jump routes, rivers…) become map path chains.
    if (outcome?.ok && outcome.paths.length && kind) {
      const { chains, missing } = kind.toChains(outcome.paths);
      const map = this.plugin.getMap(result.name);
      if (map && chains.length) {
        map.pathChains.push(...chains);
        await this.plugin.saveSettings();
      }
      if (missing.length) new Notice(`Skipped paths with no matching path type: ${missing.join(", ")}`);
    }

    this.close();
    this.onCreated(result, { openGenerator });
    if (openGenerator) {
      await this.plugin.openTerrainGenerator({
        mapName: result.name,
        paletteName,
        generatorPath: kind?.generatorPath,
      });
    }
  }
}

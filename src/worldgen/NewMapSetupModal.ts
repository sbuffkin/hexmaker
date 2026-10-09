import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { SubmapDefault, TerrainColor } from "../types";
import { getTerrainFromFile } from "../frontmatter";
import { buildSubmapContext } from "./submapContext";
import { buildRegionContext } from "./regionContext";
import { neighbourSpec, occupiedSides, placeNewRegion, regionNameAt, type NewRegion } from "./neighbours";
import type { Side as WorldSide } from "./world";
import { routeContextPaths } from "./procedural/contextPaths";
import type { GenerationContext, Side } from "./procedural/common";
import { fillPaletteSelect } from "../palettes/paletteOptions";
import { isSpacePalette } from "../mapKinds";
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
  visibleKinds,
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
  /** Terrain of the hex this submap is made from (e.g. "ocean world"). */
  private originTerrain: string | undefined;
  /** Saved setup for submaps of that terrain, applied as the starting values. */
  private saved: SubmapDefault | undefined;
  /** The parent hex and its neighbours, so generation fits the bigger map. */
  private context: GenerationContext | undefined;
  /** "Next to" placement in a world of neighbouring regions (top-level maps). */
  private placement: NewRegion | undefined;
  /** "Default for <terrain>" checkboxes, one per option row. */
  private remember = { palette: false, size: false, generator: false, base: false };

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
    if (origin) {
      const parent = plugin.getMap(origin.map);
      this.originTerrain =
        getTerrainFromFile(app, plugin.hexPath(origin.x, origin.y, origin.map)) ?? parent?.baseTerrain ?? undefined;
      this.saved = plugin.submapDefaultFor(origin.map, this.originTerrain);
      this.context = buildSubmapContext(plugin, origin.map, origin.x, origin.y);
      const d = this.saved;
      if (d?.cols && d.rows) { this.cols = d.cols; this.rows = d.rows; }
      if (d?.generator) this.kindId = d.generator;
      if (d?.options) this.options = { ...d.options };
      this.remember = {
        palette: !!d?.palette,
        size: !!(d?.cols && d.rows),
        generator: !!d?.generator,
        base: d?.baseTerrain !== undefined,
      };
    }
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-setup-modal");
    this.titleEl.setText(
      this.origin
        ? `New submap — ${this.originTerrain ? `${this.originTerrain}, ` : ""}${this.origin.map} hex ${this.origin.x}, ${this.origin.y}`
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
      this.saved?.palette
        ?? (this.origin ? this.plugin.childPaletteFor(this.origin.map) : this.plugin.settings.terrainPalettes[0]?.name),
    );
    this.rememberBox(palRow, "palette");

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
    this.rememberBox(sizeRow, "size");

    // ── Next to (new top-level maps): join a world of neighbouring regions.
    // Size, palette, offset and stagger then follow the neighbour; terrain
    // and roads continue across the borders.
    if (!this.origin && this.plugin.settings.maps.length > 0) {
      const nextRow = this.row(form, "Next to");
      const anchorSel = nextRow.createEl("select", { attr: { "aria-label": "Neighbouring map" } });
      anchorSel.createEl("option", { value: "", text: "— none (stand-alone) —" });
      for (const m of this.plugin.settings.maps) anchorSel.createEl("option", { value: m.name, text: m.name });
      const sideSel = nextRow.createEl("select", { attr: { "aria-label": "Side" } });
      for (const s of ["east", "west", "north", "south"] as const) sideSel.createEl("option", { value: s, text: `${s} of it` });
      const note = nextRow.createDiv({ cls: "setting-item-description" });
      const onPlace = () => {
        this.placement = undefined;
        this.context = undefined;
        note.setText("");
        const anchor = anchorSel.value;
        sideSel.disabled = !anchor;
        if (anchor) {
          const spec = neighbourSpec(this.plugin, anchor, sideSel.value as WorldSide);
          if (!spec.ok) {
            note.setText(`⚠ ${spec.reason}`);
          } else {
            this.placement = {
              slot: spec.slot, aSlot: spec.aSlot, anchor, side: sideSel.value as WorldSide,
              cols: spec.cols, rows: spec.rows, offset: spec.offset, stagger: spec.stagger, paletteName: spec.paletteName,
            };
            this.cols = spec.cols;
            this.rows = spec.rows;
            colsInput.value = String(spec.cols);
            rowsInput.value = String(spec.rows);
            paletteSelect.value = spec.paletteName;
            this.context = buildRegionContext(this.plugin, this.placement);
            const roads = this.context.paths?.length ?? 0;
            const borders = occupiedSides(this.plugin, this.placement).map((s) => `${s}: ${regionNameAt(this.plugin, this.placement!, s)}`);
            note.setText(`${spec.cols}×${spec.rows}, palette ${spec.paletteName}. Borders ${borders.join("; ")}.` +
              (roads ? ` ${roads} path${roads === 1 ? "" : "s"} continue across.` : ""));
          }
        }
        const locked = !!this.placement;
        colsInput.disabled = locked;
        rowsInput.disabled = locked;
        paletteSelect.disabled = locked;
        presetBtns.forEach((b) => { b.disabled = locked; });
        syncPresetBtns();
        renderGenerators();
        renderBase();
        refresh();
      };
      anchorSel.addEventListener("change", onPlace);
      sideSel.addEventListener("change", onPlace);
      sideSel.disabled = true;
    }

    // ── Generator ──
    const genRow = this.row(form, "Generator");
    this.rememberBox(genRow, "generator", "Generator and its options");
    const genList = genRow.createDiv({ cls: "duckmage-setup-generators" });
    const optsBox = form.createDiv({ cls: "duckmage-setup-options" });

    // ── Base terrain ──
    const baseRow = this.row(form, "Base terrain");
    const baseSelect = baseRow.createEl("select");
    this.rememberBox(baseRow, "base");
    baseRow.createDiv({
      cls: "setting-item-description",
      text: "Shown on unpainted hexes. With a base terrain, hex notes are created as you use hexes instead of all up front.",
    });

    // ── Preview ──
    // For submaps: the preview sits inside a frame of the parent's
    // neighbours (N, NE, E…), so it's clear why each edge looks as it does.
    const frame = side.createDiv({ cls: "duckmage-setup-context" });
    const chip = (slot: Side | "C") => {
      const cell = frame.createDiv({ cls: `duckmage-setup-ctx duckmage-setup-ctx-${slot}` });
      if (slot === "C") return cell;
      const t = this.context?.sides?.[slot];
      if (!t?.terrain) return cell;
      const color = this.origin ? this.plugin.getMapPalette(this.origin.map).find((p) => p.name === t.terrain)?.color : undefined;
      cell.createSpan({ cls: "duckmage-setup-ctx-swatch" }).setCssProps({ "--duckmage-bg": color ?? "transparent" });
      cell.createSpan({ cls: "duckmage-setup-ctx-name", text: t.terrain });
      cell.setAttr("title", `${slot}: ${t.terrain}`);
      return cell;
    };
    const showFrame = !!this.context && Object.keys(this.context.sides ?? {}).length > 0;
    frame.toggleClass("is-empty", !showFrame);
    (["NW", "N", "NE", "W"] as const).forEach((s) => chip(s));
    const canvas = chip("C").createEl("canvas", { cls: "duckmage-setup-canvas" });
    (["E", "SW", "S", "SE"] as const).forEach((s) => chip(s));
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
      // Space generators only for space users or maps in space (a space
      // palette here, or a planet submap of a star system); a saved
      // submap default stays visible either way.
      const spaceContext = isSpacePalette(terrains) || (!!this.origin && this.plugin.isSpaceMap(this.origin.map));
      const shown = visibleKinds(this.kinds, this.plugin.settings, spaceContext, this.saved?.generator);
      const fitting = kindsForPalette(shown, terrains, !!this.context);
      if (!fitting.some((k) => k.id === this.kindId)) {
        // Default to the first built-in generator that fits, else Blank.
        // Submaps zoom in: prefer the context-aware generator when it fits.
        this.kindId = (this.context ? fitting.find((k) => k.needsContext)?.id : undefined)
          ?? fitting.find((k) => k.source === "built-in")?.id
          ?? BLANK_ID;
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
      const hidden = shown.length - fitting.length;
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
      const savedBase = this.saved?.baseTerrain;
      this.baseTerrain = savedBase !== undefined && (savedBase === "" || terrains.some((t) => t.name === savedBase))
        ? savedBase || undefined
        : suggestBaseTerrain(terrains);
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
      const carriesPaths = !!this.context?.paths?.length;
      if (kind && (kind.id !== BLANK_ID || carriesPaths)) {
        if (this.cols * this.rows > PREVIEW_AUTO_LIMIT) {
          status.setText("Large map — the preview is skipped; terrain is generated on create.");
        } else {
          const outcome = this.generate(kind, terrains);
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
            const k = `${grid.offset.x + i}_${grid.offset.y + j}`;
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

  /**
   * "Default for <terrain>" checkbox at the end of an option row. Only shown
   * when the submap comes from a hex with a terrain.
   */
  private rememberBox(row: HTMLElement, key: keyof NewMapSetupModal["remember"], what?: string): void {
    if (!this.originTerrain) return;
    const label = row.createEl("label", {
      cls: "duckmage-setup-default",
      attr: { title: `Use this ${(what ?? key).toLowerCase()} for every new submap of a ${this.originTerrain} hex` },
    });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = this.remember[key];
    label.createSpan({ text: `Default for ${this.originTerrain}` });
    cb.addEventListener("change", () => { this.remember[key] = cb.checked; });
  }

  /** Store (or forget) the ticked choices as this terrain's submap defaults. */
  private async saveDefaults(paletteName: string): Promise<void> {
    if (!this.origin || !this.originTerrain) return;
    const set: SubmapDefault = {};
    const clear: (keyof SubmapDefault)[] = [];
    if (this.remember.palette) set.palette = paletteName; else clear.push("palette");
    if (this.remember.size) { set.cols = this.cols; set.rows = this.rows; } else clear.push("cols", "rows");
    const kind = this.kind();
    if (this.remember.generator && kind) {
      set.generator = kind.id;
      const opts = this.resolvedOptions(kind);
      if (Object.keys(opts).length) set.options = opts; else clear.push("options");
    } else {
      clear.push("generator", "options");
    }
    if (this.remember.base) set.baseTerrain = this.baseTerrain ?? ""; else clear.push("baseTerrain");
    const before = JSON.stringify(this.saved ?? {});
    const after = JSON.stringify({ ...(this.saved ?? {}), ...set });
    const nothingSaved = !this.saved && Object.keys(set).length === 0;
    if (nothingSaved || (before === after && clear.every((k) => this.saved?.[k] === undefined))) return;
    await this.plugin.saveSubmapDefault(this.origin.map, this.originTerrain, set, clear);
  }

  /**
   * Run a generator with this map's context, then continue the parent
   * hex's paths (roads, rivers…) across the result. Maps on a space
   * palette skip the path carry-over (a jump route through a sector hex
   * isn't a lane in the system).
   */
  private generate(kind: TerrainGeneratorKind, terrains: TerrainColor[]): GenerateOutcome {
    const grid = this.grid();
    const outcome = kind.generate({ terrains, grid, seed: this.seed, options: this.resolvedOptions(kind), context: this.context, region: this.placement });
    const carry = this.context?.paths ?? [];
    if (!outcome.ok || carry.length === 0 || isSpacePalette(terrains)) return outcome;
    const routed = routeContextPaths(
      outcome.cells,
      terrains,
      { ...grid, orientation: this.plugin.settings.hexOrientation },
      carry,
      this.seed,
    );
    return { ...outcome, paths: [...outcome.paths, ...routed] };
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
    if (this.placement) {
      return { cols: this.cols, rows: this.rows, offset: { ...this.placement.offset }, stagger: this.placement.stagger };
    }
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
    // "Open in generator" makes the map blank — but still carries the
    // parent's roads / rivers across it.
    const blank = this.kinds.find((k) => k.id === BLANK_ID);
    const effective = openGenerator ? blank : kind;
    if (effective && (effective.id !== BLANK_ID || this.context?.paths?.length)) {
      outcome = (!openGenerator ? this.lastOutcome : undefined) ?? this.generate(effective, terrains);
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
      this.grid().offset.x,
      this.grid().offset.y,
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

    // Join the world grid next to the chosen neighbour.
    if (this.placement) await placeNewRegion(this.plugin, result.name, this.placement);
    await this.saveDefaults(paletteName);
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

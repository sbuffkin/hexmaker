import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { SubmapDefault, TerrainColor } from "../types";
import { getTerrainFromFile } from "../frontmatter";
import { buildSubmapContext } from "./submapContext";
import { buildRegionContext } from "./regionContext";
import { neighbourShadow, neighbourSpec, occupiedSides, placeNewRegion, regionNameAt, type NewRegion } from "./neighbours";
import { hasFeature } from "../featureLevel";
import { renderAdvancedHints } from "../advancedHints";
import type { Side as WorldSide } from "./world";
import { OVERLAND_ID, REGION_DETAIL_ID, seaSideFromNeighbours, type NeighbourSea } from "./procedural/planetSurface";
import type { GenerationContext, Side } from "./procedural/common";
import { attachPaletteHint, defaultPaletteFor, fillPaletteSelect, refreshPaletteHint } from "../palettes/paletteOptions";
import { isSpacePalette } from "../mapKinds";
import { defaultSubmapName } from "../hex-map/submapNav";
import { randomSeed } from "../../packages/hex-wfc/src";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./preview";
import { pathColors } from "./generators";
import { SIZE_PRESETS, type SizePreset } from "./sizePresets";
import { LIVE_PREVIEW_DELAY_MS, sizeFromInput } from "../sizeInput";
import {
  BLANK_ID,
  defaultGeneratorFor,
  describeKind,
  kindsForPalette,
  listGeneratorKinds,
  neighbourFirst,
  optionsWithDefaults,
  regionDetailDescription,
  runGenerator,
  submapStartKind,
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

/**
 * Base terrain wording. With map notes a hex note is only ever created
 * when a hex first gets content, whatever the base terrain; the base only
 * decides what an unpainted hex shows (fresh-eyes r4: the old "None
 * (create every hex note)" was outdated and alarming).
 */
export const BASE_TERRAIN_NONE_LABEL = "None (unpainted hexes stay blank)";
export const BASE_TERRAIN_HELP =
  "What hexes you haven't painted show: this terrain, or nothing with None. Painting a hex overrides it. Either way a hex only gets its own note when you first add something to it.";

/** Why Overland's Sea starts where it does next to a neighbouring map. */
export function neighbourSeaText(hint: NeighbourSea, anchor: string): string {
  switch (hint.why) {
    case "edge": return `Picked from ${anchor}: its sea reaches the shared edge, so the sea is on the ${hint.side}.`;
    case "end": return `Picked from ${anchor}: its coast meets the shared edge at the ${hint.side} end, so the sea runs along the ${hint.side}.`;
    case "middle": return `Picked from ${anchor}: its shared edge has water only in the middle, so lakes and inlets.`;
    case "dry": return `Picked from ${anchor}: its shared edge has no water, so no sea by default.`;
  }
}

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
  /** "Use for new submaps of <terrain> hexes" checkboxes, one per option row. */
  private remember = { palette: false, size: false, generator: false, base: false };
  private stopKeepInViewport?: () => void;
  private stopFeatureChange?: () => void;
  /** The neighbours' terrain just past the new map's edges (faded in the preview). */
  private shadow: Map<string, string> | undefined;
  /** Set once the user clicks a generator card: placement then stops re-picking one. */
  private pickedKind = false;
  /** Overland's Sea was set from the neighbour's coast (not by the user):
   *  re-derived when the placement changes, dropped when the user picks one. */
  private seaFromNeighbour = false;
  /** Ids for <label for> on this modal's controls. */
  private static nextId = 0;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onCreated: (result: NewMapSetupResult, opts: { openGenerator: boolean }) => void,
    /** Hex this map is a submap of. Drives naming, palette and size defaults. */
    private origin?: { map: string; x: number; y: number },
    /** Starting values carried over from Maps → New map (top-level maps only). */
    private prefill?: { name?: string; anchor?: string; side?: WorldSide },
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
    this.stopKeepInViewport = this.keepInViewport();
    this.titleEl.setText(
      this.origin
        ? `New submap — ${this.originTerrain ? `${this.originTerrain}, ` : ""}${this.origin.map} hex ${this.origin.x}, ${this.origin.y}`
        : "New map",
    );
    void listGeneratorKinds(this.plugin).then((kinds) => {
      this.kinds = kinds;
      this.render();
      // A hint here can turn a feature on: show what it brings straight away.
      this.stopFeatureChange = this.plugin.onFeatureChange(() => this.render());
    });
    this.contentEl.createDiv({ cls: "duckmage-setup-loading", text: "Loading generators…" });
  }

  onClose(): void {
    this.stopKeepInViewport?.();
    this.stopFeatureChange?.();
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

    // Submaps started from saved settings: say what the ticked boxes mean.
    if (this.originTerrain && this.saved && Object.keys(this.saved).length) {
      form.createDiv({
        cls: "setting-item-description duckmage-setup-defaults-note",
        text: `Started from the saved settings for new submaps of ${this.originTerrain} hexes (the ticked boxes). Untick a box to stop using that setting next time.`,
      });
    }

    // ── Name ──
    const nameRow = this.row(form, "Name");
    const nameInput = this.labelled(nameRow, nameRow.createEl("input", { type: "text", cls: "duckmage-setup-name" }));
    nameInput.value = this.origin
      ? defaultSubmapName(this.origin.map, this.origin.x, this.origin.y, this.plugin.settings.maps.map((m) => m.name))
      : (this.prefill?.name ?? "");
    nameInput.placeholder = "Map name";

    // ── Palette ──
    const palRow = this.row(form, "Palette");
    const paletteSelect = this.labelled(palRow, palRow.createEl("select"));
    fillPaletteSelect(
      this.plugin,
      paletteSelect,
      this.saved?.palette
        ?? (this.origin ? this.plugin.childPaletteFor(this.origin.map) : defaultPaletteFor(this.plugin.settings)),
    );
    this.rememberBox(palRow, "palette");
    attachPaletteHint(palRow, paletteSelect);

    // ── Size ──
    const sizeRow = this.row(form, "Size");
    const presetBox = sizeRow.createDiv({ cls: "duckmage-setup-size-presets" });
    const custom = sizeRow.createDiv({ cls: "duckmage-setup-size-custom" });
    const colsInput = this.labelled(sizeRow, custom.createEl("input", { type: "number", value: String(this.cols), attr: { min: "1", max: "200", "aria-label": "Columns" } }));
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
    // The preview follows the size while typing (debounced); blur / Enter
    // commits the clamped value at once.
    let sizeTimer: number | undefined;
    const onSize = (committed: boolean) => {
      const cols = sizeFromInput(colsInput.value, { min: 1, max: 200, fallback: 1, committed });
      const rows = sizeFromInput(rowsInput.value, { min: 1, max: 200, fallback: 1, committed });
      if (cols === undefined && rows === undefined) return;
      this.cols = cols ?? this.cols;
      this.rows = rows ?? this.rows;
      syncPresetBtns();
      refresh();
    };
    for (const input of [colsInput, rowsInput]) {
      input.addEventListener("input", () => {
        window.clearTimeout(sizeTimer);
        sizeTimer = window.setTimeout(() => onSize(false), LIVE_PREVIEW_DELAY_MS);
      });
      input.addEventListener("change", () => {
        window.clearTimeout(sizeTimer);
        onSize(true);
      });
    }
    this.rememberBox(sizeRow, "size");

    // ── Next to (new top-level maps): join a world of neighbouring regions.
    // Size, palette, offset and stagger then follow the neighbour; terrain
    // and roads continue across the borders.
    // An Advanced feature (the More options hint under Generator offers it in Simple).
    let applyPrefill: (() => void) | undefined;
    if (!this.origin && this.plugin.settings.maps.length > 0 && hasFeature(this.plugin.settings, "regions")) {
      const nextRow = this.row(form, "Next to");
      const anchorSel = this.labelled(nextRow, nextRow.createEl("select", { attr: { "aria-label": "Neighbouring map" } }));
      anchorSel.createEl("option", { value: "", text: "— none (stand-alone) —" });
      for (const m of this.plugin.settings.maps) anchorSel.createEl("option", { value: m.name, text: m.name });
      const sideSel = nextRow.createEl("select", { attr: { "aria-label": "Side of the neighbouring map" } });
      for (const s of ["east", "west", "north", "south"] as const) sideSel.createEl("option", { value: s, text: `${s} of it` });
      const note = nextRow.createDiv({ cls: "setting-item-description" });
      const onPlace = () => {
        // A sea side read from the old neighbour no longer applies.
        if (this.seaFromNeighbour) {
          delete this.options.sea;
          this.seaFromNeighbour = false;
        }
        this.placement = undefined;
        this.context = undefined;
        this.shadow = undefined;
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
            refreshPaletteHint(paletteSelect);
            this.context = buildRegionContext(this.plugin, this.placement);
            // The neighbours' edge, drawn faded around the preview (the seam).
            this.shadow = new Map();
            for (const [k, c] of neighbourShadow(this.plugin, this.placement, 2)) if (c.terrain) this.shadow.set(k, c.terrain);
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
      // Carried over from Maps → New map: start next to that map.
      const pre = this.prefill;
      if (pre?.anchor && this.plugin.getMap(pre.anchor)) {
        applyPrefill = () => {
          anchorSel.value = pre.anchor!;
          if (pre.side) sideSel.value = pre.side;
          onPlace();
        };
      }
    }

    // ── Generator ──
    const genRow = this.row(form, "Generator");
    // aria-labelledby (the row label), not aria-label: Obsidian shows aria-label as a tooltip.
    const genLabelId = `duckmage-setup-field-${NewMapSetupModal.nextId++}`;
    genRow.parentElement?.querySelector(":scope > .duckmage-setup-label")?.setAttr("id", genLabelId);
    const genList = genRow.createDiv({ cls: "duckmage-setup-generators", attr: { role: "radiogroup", "aria-labelledby": genLabelId } });
    this.rememberBox(genRow, "generator", "generator and its options");
    // Simple shows Blank, the starter generators and Space ones; one hint
    // offers the rest, and placing the map next to another.
    renderAdvancedHints(form, this.plugin, [
      { feature: "generators", text: "Generate terrain for you: learned from maps you've painted, or from biome presets." },
      ...(!this.origin && this.plugin.settings.maps.length > 0
        ? [{ feature: "regions" as const, text: "Place this map next to an existing one so they join into one world." }]
        : []),
    ], "new-map-setup-more");
    const optsBox = form.createDiv({ cls: "duckmage-setup-options" });

    // ── Base terrain ──
    const baseRow = this.row(form, "Base terrain");
    const baseSelect = this.labelled(baseRow, baseRow.createEl("select"));
    this.rememberBox(baseRow, "base", "base terrain");
    baseRow.createDiv({
      cls: "setting-item-description",
      text: BASE_TERRAIN_HELP,
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
    const seamNote = side.createDiv({ cls: "setting-item-description duckmage-setup-seam-note" });
    const status = side.createDiv({ cls: "duckmage-setup-status" });
    rerollBtn.addEventListener("click", () => { this.seed = randomSeed(); refresh(); });

    // ── Actions ──
    const actions = contentEl.createDiv({ cls: "duckmage-setup-actions" });
    const goBtn = actions.createEl("button", { cls: "mod-cta" });
    const genBtn = actions.createEl("button", { text: "Open in generator", attr: { title: "Create the map blank and open the generator view on it to tune generation by hand" } });
    if (!hasFeature(this.plugin.settings, "generators")) genBtn.hide();
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const renderGenerators = () => {
      const terrains = this.terrains(paletteSelect.value);
      // Space generators only for space users or maps in space (a space
      // palette here, or a planet submap of a star system); a saved
      // submap default stays visible either way.
      const spaceContext = isSpacePalette(terrains) || (!!this.origin && this.plugin.isSpaceMap(this.origin.map));
      const shown = visibleKinds(this.kinds, this.plugin.settings, spaceContext, this.saved?.generator);
      // "Zoom into the parent hex" generators only for submaps (a neighbour
      // has context but no parent hex); next to a neighbour, the ones that
      // carry on from its edge come first.
      const where = { parentHex: !!this.origin, neighbour: !!this.placement };
      let fitting = kindsForPalette(shown, terrains, where.parentHex);
      if (where.neighbour) fitting = neighbourFirst(fitting);
      // A submap of a painted hex starts on Region detail, not Blank
      // (unless a saved default or the user's click says otherwise).
      if (where.parentHex) {
        this.kindId = submapStartKind(fitting, this.kindId, {
          parentTerrain: this.originTerrain,
          savedGenerator: this.saved?.generator,
          picked: this.pickedKind,
        });
      }
      const stillFits = fitting.some((k) => k.id === this.kindId);
      // Placed next to a map and no generator picked yet: start on one
      // that continues the neighbour's edge.
      if (!stillFits || (where.neighbour && !this.pickedKind && this.kindId === BLANK_ID)) {
        const next = defaultGeneratorFor(fitting, where);
        if (!stillFits || next !== BLANK_ID) {
          this.kindId = next;
          this.options = {};
        }
      }
      genList.empty();
      const anchor = this.placement?.anchor;
      for (const k of fitting) {
        const on = k.id === this.kindId;
        const card = genList.createEl("button", {
          cls: `duckmage-setup-gen${on ? " is-active" : ""}`,
          attr: { role: "radio", "aria-checked": on ? "true" : "false" },
        });
        card.createDiv({ cls: "duckmage-setup-gen-title", text: k.label + (k.source === "learned" ? " (learned)" : "") });
        // Region detail says what this hex's neighbours will do, not a generic example.
        const desc = k.id === REGION_DETAIL_ID && this.origin ? regionDetailDescription(this.context) : describeKind(k, terrains);
        card.createDiv({ cls: "duckmage-setup-gen-desc", text: desc });
        if (where.neighbour && k.id !== BLANK_ID) {
          card.createDiv({
            cls: `duckmage-setup-gen-seam${k.continuesNeighbours ? " is-continues" : ""}`,
            text: k.continuesNeighbours
              ? `Continues ${anchor ?? "the neighbour"}'s edge`
              : `Ignores ${anchor ?? "the neighbour"}'s edge`,
          });
        }
        card.addEventListener("click", () => {
          this.kindId = k.id;
          this.pickedKind = true;
          this.options = {};
          renderGenerators();
          refresh();
        });
      }
      const hidden = shown.length - fitting.length;
      if (hidden > 0) {
        genList.createDiv({
          cls: "setting-item-description",
          text: `${hidden} other generator${hidden === 1 ? " doesn't" : "s don't"} fit this palette.`,
        });
      }
      // Options for the chosen generator.
      optsBox.empty();
      const kind = this.kind();
      // Overland next to a map: the sea starts where the neighbour's coast
      // says (not a random side that contradicts it), until the user picks.
      const seaHint = kind?.id === OVERLAND_ID && this.placement
        ? seaSideFromNeighbours(this.grid(), this.context?.edgeCells)
        : undefined;
      if (seaHint && this.options.sea === undefined) {
        this.options.sea = seaHint.side;
        this.seaFromNeighbour = true;
      }
      for (const opt of kind?.options ?? []) {
        const r = this.row(optsBox, opt.label);
        const sel = this.labelled(r, r.createEl("select"));
        for (const c of opt.choices) sel.createEl("option", { value: c.value, text: c.label });
        sel.value = this.options[opt.key] ?? opt.default;
        const hint = opt.key === "sea" && seaHint && this.seaFromNeighbour
          ? r.createDiv({ cls: "setting-item-description duckmage-setup-sea-hint", text: neighbourSeaText(seaHint, anchor ?? "the neighbouring map") })
          : undefined;
        sel.addEventListener("change", () => {
          this.options[opt.key] = sel.value;
          if (opt.key === "sea") {
            this.seaFromNeighbour = false;
            hint?.remove();
          }
          refresh();
        });
      }
      goBtn.setText(this.kindId === BLANK_ID ? (this.origin ? "Create & enter" : "Create") : (this.origin ? "Generate & enter" : "Generate"));
    };

    const renderBase = () => {
      const terrains = this.terrains(paletteSelect.value);
      baseSelect.empty();
      baseSelect.createEl("option", { value: "", text: BASE_TERRAIN_NONE_LABEL });
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
      const shadow = this.shadow?.size ? this.shadow : undefined;
      const anchor = this.placement?.anchor ?? "the neighbouring map";
      seamNote.setText(!shadow ? "" : !kind || kind.id === BLANK_ID
        ? `Faded hexes: ${anchor}'s edge, where this map joins it.`
        : kind.continuesNeighbours
          ? `Faded hexes: ${anchor}'s edge. ${kind.label} carries its terrain on across the seam.`
          : `Faded hexes: ${anchor}'s edge. ${kind.label} doesn't follow it; pick one marked "Continues" to match the seam.`);
      seamNote.toggle(!!shadow);
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
        undefined,
        { shadow },
      );
    };

    paletteSelect.addEventListener("change", () => { renderGenerators(); renderBase(); refresh(); });

    goBtn.addEventListener("click", () => void this.create(nameInput.value, paletteSelect.value, false, goBtn, genBtn));
    genBtn.addEventListener("click", () => void this.create(nameInput.value, paletteSelect.value, true, goBtn, genBtn));
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") goBtn.click();
    });

    if (applyPrefill) applyPrefill();
    else {
      renderGenerators();
      renderBase();
      refresh();
    }
    nameInput.focus();
    nameInput.select();
  }

  /**
   * "Use this <setting> for new submaps of <terrain> hexes" checkbox at the
   * end of an option row: ticked, the choice is saved when the submap is
   * created and pre-filled next time. Only shown when the submap comes
   * from a hex with a terrain.
   */
  private rememberBox(row: HTMLElement, key: keyof NewMapSetupModal["remember"], what: string = key): void {
    if (!this.originTerrain) return;
    const label = row.createEl("label", {
      cls: "duckmage-setup-default",
      attr: { title: `Saved when you create this submap, and used to start every new submap of a ${this.originTerrain} hex` },
    });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = this.remember[key];
    label.createSpan({ text: `Use this ${what} for new submaps of ${this.originTerrain} hexes` });
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
    return runGenerator(this.plugin.settings.hexOrientation, kind, {
      terrains, grid: this.grid(), seed: this.seed, options: this.resolvedOptions(kind), context: this.context, region: this.placement,
    });
  }

  /** A labelled form row; returns its control cell (see labelled). */
  private row(parent: HTMLElement, label: string): HTMLElement {
    const r = parent.createDiv({ cls: "duckmage-setup-row" });
    r.createEl("label", { cls: "duckmage-setup-label", text: label });
    return r.createDiv({ cls: "duckmage-setup-control" });
  }

  /** Tie a row's label to its main control (<label for>), so the label names it. */
  private labelled<T extends HTMLElement>(control: HTMLElement, el: T): T {
    const label = control.parentElement?.querySelector<HTMLLabelElement>(":scope > .duckmage-setup-label");
    if (!label) return el;
    const id = el.id || `duckmage-setup-field-${NewMapSetupModal.nextId++}`;
    el.id = id;
    label.htmlFor = id;
    return el;
  }

  private kind(): TerrainGeneratorKind | undefined {
    return this.kinds.find((k) => k.id === this.kindId);
  }

  private resolvedOptions(kind: TerrainGeneratorKind): Record<string, string> {
    return optionsWithDefaults(kind, this.options);
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

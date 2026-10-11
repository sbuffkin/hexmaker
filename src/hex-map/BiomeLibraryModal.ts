/**
 * The Biomes list and the Add / Edit biome form (#50).
 *
 * - BiomeLibraryModal: every biome note (swatch, name, what makes its
 *   regions) with Edit… and Edit generator…, and Add biome…. Opened from
 *   the overworld's Biomes view and the biome picker.
 * - BiomeFormModal: label, colour, generator (or "Blend (built-in mixing)"),
 *   terrain-type mix, blend width, land share / min islands, transitions,
 *   with a live preview of one region made by the blend field. Save writes
 *   the biome's note (BiomeStore). Built-in biomes get Restore default.
 *
 * Adding and editing biomes follows the overworld's work mode: Build and
 * God (canAdd), not Play.
 */

import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { canAdd } from "../workMode";
import { BIOME_BLENDS, type BiomeBlend, type BiomeNoteFields } from "../overworld/biomeNote";
import { fieldsFromForm, formFromFields, formProblem, formTypes, generatorName, routeNote, type BiomeFormState, type ClimateFormState } from "../overworld/biomeForm";
import type { RegionPlan } from "../overworld/regionWorld";
import { BiomeRegionError } from "../worldgen/biomeRegion";
import { overworldOf, planBiomePreview, regionPalette } from "../overworld/regionsVault";
import { cellsBox, composeAffine, drawRegionCells, type RegionCell } from "../overworld/overworldRender";
import { regionCells } from "../overworld/layout";
import { listGenerators } from "../worldgen/generators";
import { lockButton } from "./BiomeModals";

/** Why biomes can't be added or edited from this overworld now, or undefined. */
export function biomeEditLock(plugin: HexmakerPlugin, overworldName: string): string | undefined {
  return canAdd(plugin.getMap(overworldName)) ? undefined : "Switch to Build to add or edit biomes.";
}

/** Whether the generator page can open a biome (`openTerrainGenerator({ biome })`). */
const GENERATOR_PAGE_TAKES_BIOMES = true;

/**
 * "Edit generator…" for a biome, in one place: a biome with a generator
 * link opens that generator; otherwise the generator page opens the biome
 * when it can, else the biome's note opens.
 */
export async function openBiomeGenerator(plugin: HexmakerPlugin, biome: string): Promise<void> {
  const b = plugin.biomeStore.get(biome);
  if (!b) { new Notice(`No biome called ${biome}.`); return; }
  if (b.generator) {
    const file = plugin.app.metadataCache.getFirstLinkpathDest(b.generator, "");
    if (file) { await plugin.openTerrainGenerator({ generatorPath: file.path }); return; }
    new Notice(`Generator ${generatorName(b.generator)} wasn't found; opening the biome's note.`);
  } else if (GENERATOR_PAGE_TAKES_BIOMES) {
    await plugin.openTerrainGenerator({ biome: b.id });
    return;
  }
  const path = plugin.biomeStore.pathOf(b.id);
  const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
  if (file instanceof TFile) await plugin.app.workspace.getLeaf("tab").openFile(file);
}

export class BiomeLibraryModal extends HexmakerModal {
  private off: (() => void) | undefined;

  constructor(app: App, private plugin: HexmakerPlugin, private overworldName: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-biome-library-modal");
    this.titleEl.setText("Biomes");
    this.off = this.plugin.biomeStore.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const { contentEl, plugin } = this;
    contentEl.empty();
    const lock = biomeEditLock(plugin, this.overworldName);
    contentEl.createEl("p", { cls: "setting-item-description", text: `Each biome is a note in ${plugin.biomeStore.folder()}. Edit it here or as text.` });
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    const list = contentEl.createDiv({ cls: "duckmage-biome-list" });
    for (const b of plugin.biomeStore.list()) {
      const row = list.createDiv({ cls: "duckmage-biome-row" });
      row.createSpan({ cls: "duckmage-biome-swatch" }).setCssProps({ "--duckmage-biome-color": b.color ?? "" });
      const text = row.createDiv({ cls: "duckmage-biome-row-text" });
      text.createSpan({ cls: "duckmage-biome-row-name", text: b.label });
      text.createSpan({ cls: "duckmage-biome-row-note", text: routeNote(b) ?? "Blend (built-in mixing)" });
      const edit = row.createEl("button", { text: "Edit…" });
      if (lock) lockButton(edit, lock);
      edit.addEventListener("click", () => {
        if (biomeEditLock(plugin, this.overworldName)) return;
        new BiomeFormModal(this.app, plugin, this.overworldName, b.id).open();
      });
      row.createEl("button", { text: "Edit generator…" }).addEventListener("click", () => {
        this.close();
        void openBiomeGenerator(plugin, b.id);
      });
    }
    const buttons = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    const add = buttons.createEl("button", { text: "Add biome…", cls: "mod-cta" });
    if (lock) lockButton(add, lock);
    add.addEventListener("click", () => {
      if (biomeEditLock(plugin, this.overworldName)) return;
      new BiomeFormModal(this.app, plugin, this.overworldName).open();
    });
  }

  onClose(): void {
    this.off?.();
    this.contentEl.empty();
  }
}

const BLEND_GENERATOR = "";

export class BiomeFormModal extends HexmakerModal {
  private state!: BiomeFormState;
  private canvas!: HTMLCanvasElement;
  private problemEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private seed = Math.floor(Math.random() * 1e9);
  private redrawTimer: number | undefined;
  private drawToken = 0;
  private previewNote: HTMLElement | undefined;

  /** `biome`: the biome to edit (id, label or note name); none = a new one. */
  constructor(app: App, private plugin: HexmakerPlugin, private overworldName: string, private biome?: string) {
    super(app);
  }

  private get existing(): BiomeNoteFields | undefined {
    return this.biome ? this.plugin.biomeStore.get(this.biome) : undefined;
  }

  private palette() {
    const ow = this.plugin.getMap(this.overworldName);
    return ow ? regionPalette(this.plugin, ow) : this.plugin.getMapPalette(this.overworldName);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-biome-form-modal");
    const existing = this.existing;
    this.titleEl.setText(existing ? `Edit biome: ${existing.label}` : "Add biome");
    const palette = this.palette();
    this.state = formFromFields(existing, formTypes(palette, existing));
    void this.build();
  }

  private async build(): Promise<void> {
    const { contentEl, plugin, state } = this;
    contentEl.empty();
    const existing = this.existing;
    const form = contentEl.createDiv({ cls: "duckmage-region-gen-form" });
    const field = (label: string, parent: HTMLElement = form) => {
      const row = parent.createDiv({ cls: "duckmage-region-gen-row" });
      row.createSpan({ cls: "duckmage-region-gen-label", text: label });
      return row;
    };

    // Generator.
    const genRow = field("Made by");
    const gen = genRow.createEl("select", { attr: { "aria-label": "Made by" } });
    gen.createEl("option", { text: "Blend (built-in mixing)", value: BLEND_GENERATOR });
    const gens = await listGenerators(plugin).catch(() => []);
    for (const g of gens) gen.createEl("option", { text: g.model.name || g.file.basename, value: g.file.path.replace(/\.md$/, "") });
    if (state.generator && ![...gen.options].some((o) => o.value === state.generator)) gen.createEl("option", { text: generatorName(state.generator), value: state.generator });
    gen.value = state.generator;
    const genNote = form.createEl("p", { cls: "setting-item-description" });
    const showGenNote = () => genNote.setText(routeNote({ generator: state.generator || undefined }) ?? "Blend mixes the terrain types below, and blends into the biomes next to it.");
    showGenNote();
    gen.addEventListener("change", () => { state.generator = gen.value; showGenNote(); this.schedule(); });

    // Name and colour.
    const name = field("Name").createEl("input", { type: "text", attr: { "aria-label": "Name", placeholder: "Glass wastes" } });
    name.value = state.label;
    name.addEventListener("input", () => { state.label = name.value; this.check(); });
    const colour = field("Colour").createEl("input", { type: "color", attr: { "aria-label": "Colour" } });
    colour.value = /^#[0-9a-f]{6}$/i.test(state.color) ? state.color : "#7a9a5a";
    colour.addEventListener("input", () => { state.color = colour.value; });

    // Mix.
    const mixBox = form.createEl("details", { cls: "duckmage-biome-mix" });
    mixBox.open = true;
    mixBox.createEl("summary", { text: "Terrain types (weights)" });
    const mixGrid = mixBox.createDiv({ cls: "duckmage-biome-mix-grid" });
    const typesPresent = new Set(this.palette().map((t) => t.type));
    for (const [type, w] of state.mix) {
      const row = field(type, mixGrid);
      if (!typesPresent.has(type)) row.addClass("is-missing");
      const slider = row.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "1", "aria-label": `${type} weight` } });
      const num = row.createEl("input", { type: "number", cls: "duckmage-biome-weight", attr: { min: "0", step: "1", "aria-label": `${type} weight value` } });
      slider.value = String(Math.min(100, w));
      num.value = String(w);
      const set = (v: number) => { state.mix.set(type, Math.max(0, Number.isFinite(v) ? v : 0)); this.check(); this.schedule(); };
      slider.addEventListener("input", () => { num.value = slider.value; set(Number(slider.value)); });
      num.addEventListener("change", () => { slider.value = String(Math.min(100, Number(num.value) || 0)); set(Number(num.value)); });
      if (!typesPresent.has(type)) row.createSpan({ cls: "setting-item-description", text: "not in this palette" });
    }

    // Blend, land, islands.
    const blend = field("Blend with neighbours").createEl("select", { attr: { "aria-label": "Blend" } });
    blend.createEl("option", { text: "Overworld setting", value: "" });
    for (const b of BIOME_BLENDS) blend.createEl("option", { text: b, value: b });
    blend.value = state.blend;
    blend.addEventListener("change", () => { state.blend = blend.value as BiomeBlend | ""; this.schedule(); });

    const isles = form.createEl("details", { cls: "duckmage-biome-islands" });
    isles.open = state.landPercent !== undefined || state.minIslands !== undefined;
    isles.createEl("summary", { text: "Islands (watery biomes)" });
    const landRow = field("Land share", isles);
    const landOn = landRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Set a land share" } });
    const land = landRow.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "5", "aria-label": "Land share" } });
    const landVal = landRow.createSpan();
    const showLand = () => {
      landOn.checked = state.landPercent !== undefined;
      land.disabled = state.landPercent === undefined;
      land.value = String(state.landPercent ?? 50);
      landVal.setText(state.landPercent !== undefined ? `${state.landPercent}%` : "Not set");
    };
    showLand();
    landOn.addEventListener("change", () => { state.landPercent = landOn.checked ? Number(land.value) : undefined; showLand(); this.schedule(); });
    land.addEventListener("input", () => { state.landPercent = Number(land.value); showLand(); this.schedule(); });
    const isl = field("Fewest islands", isles).createEl("input", { type: "number", attr: { min: "0", step: "1", placeholder: "Not set", "aria-label": "Fewest islands" } });
    isl.value = state.minIslands !== undefined ? String(state.minIslands) : "";
    isl.addEventListener("change", () => { state.minIslands = isl.value.trim() === "" ? undefined : Math.max(0, Math.round(Number(isl.value) || 0)); this.schedule(); });
    isles.createEl("p", { cls: "setting-item-description", text: "For archipelagos: how much of a region is land, and the fewest islands it gets." });

    // Climate (optional): where World biomes may place it.
    const cl = state.climate;
    const clBox = form.createEl("details", { cls: "duckmage-biome-climate" });
    clBox.open = !!(cl.temperature || cl.moisture || cl.elevation || cl.coastal);
    clBox.createEl("summary", { text: "Climate (optional, for generated overworlds)" });
    const clGrid = clBox.createDiv({ cls: "duckmage-biome-mix-grid" });
    const text = (label: string, value: string, placeholder: string, set: (v: string) => void) => {
      const input = field(label, clGrid).createEl("input", { type: "text", attr: { "aria-label": label, placeholder } });
      input.value = value;
      input.addEventListener("input", () => { set(input.value); this.check(); });
    };
    text("Temperature", cl.temperature, "Any (e.g. cold–mild)", (v) => { cl.temperature = v; });
    text("Moisture", cl.moisture, "Any (e.g. wet, 0.2–0.5)", (v) => { cl.moisture = v; });
    const elev = field("Height", clGrid).createEl("select", { attr: { "aria-label": "Height" } });
    for (const [v, t] of [["", "Not set (low)"], ["low", "Low"], ["mid", "Mid (hills)"], ["high", "High (peaks)"], ["sea", "Sea"], ["mouth", "River mouth"]] as const) elev.createEl("option", { value: v, text: t });
    elev.value = cl.elevation;
    elev.addEventListener("change", () => { cl.elevation = elev.value as ClimateFormState["elevation"]; this.check(); });
    const chance = field("Chance %", clGrid).createEl("input", { type: "number", attr: { min: "0", max: "100", step: "5", placeholder: "100", "aria-label": "Chance" } });
    chance.value = cl.chancePercent !== undefined ? String(cl.chancePercent) : "";
    chance.addEventListener("change", () => { cl.chancePercent = chance.value.trim() === "" ? undefined : Math.min(100, Math.max(0, Number(chance.value) || 0)); this.check(); });
    const tick = (label: string, on: boolean, set: (v: boolean) => void) => {
      const row = clGrid.createEl("label", { cls: "duckmage-region-gen-row" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = on;
      row.createSpan({ text: label });
      box.addEventListener("change", () => { set(box.checked); this.check(); });
    };
    tick("Coast only", cl.coastal, (v) => { cl.coastal = v; });
    tick("Rare", cl.rare, (v) => { cl.rare = v; });
    clBox.createEl("p", { cls: "setting-item-description", text: "When set, the overworld generator can place this biome where the climate fits, like a built-in one. Left blank, it's only placed by hand. Temperature: cold, cool, mild, warm, hot; moisture: dry, moderate, wet; or numbers from 0 to 1." });

    // Transitions.
    const trBox = form.createEl("details", { cls: "duckmage-biome-transitions" });
    trBox.open = state.transitions.length > 0;
    trBox.createEl("summary", { text: `Transitions (${state.transitions.length})` });
    trBox.createEl("p", { cls: "setting-item-description", text: "Biomes this one shouldn't touch on the overworld, and the biome put between them." });
    const others = plugin.biomeStore.list().filter((b) => b.id !== existing?.id);
    const trList = trBox.createDiv();
    const renderTr = () => {
      trList.empty();
      state.transitions.forEach((t, i) => {
        const row = trList.createDiv({ cls: "duckmage-region-gen-row" });
        const pick = (value: string, label: string) => {
          const sel = row.createEl("select", { attr: { "aria-label": label } });
          sel.createEl("option", { text: "—", value: "" });
          for (const b of plugin.biomeStore.list()) sel.createEl("option", { text: b.label, value: b.label });
          if (value && ![...sel.options].some((o) => o.value.toLowerCase() === value.toLowerCase())) sel.createEl("option", { text: `${value} (unknown)`, value });
          sel.value = [...sel.options].find((o) => o.value.toLowerCase() === value.toLowerCase())?.value ?? "";
          return sel;
        };
        row.createSpan({ text: "Next to" });
        const next = pick(t.next, "Next to");
        row.createSpan({ text: "put" });
        const between = pick(t.between, "Put between");
        next.addEventListener("change", () => { t.next = next.value; });
        between.addEventListener("change", () => { t.between = between.value; });
        row.createEl("button", { text: "Remove", attr: { "aria-label": "Remove transition" } }).addEventListener("click", () => {
          state.transitions.splice(i, 1);
          renderTr();
        });
      });
      const add = trList.createEl("button", { text: "Add transition" });
      add.disabled = !others.length;
      add.addEventListener("click", () => { state.transitions.push({ next: "", between: "" }); renderTr(); });
    };
    renderTr();

    // Preview.
    this.canvas = contentEl.createEl("canvas", { cls: "duckmage-region-gen-preview" });
    this.canvas.width = 320;
    this.canvas.height = 220;
    const prevRow = contentEl.createDiv({ cls: "duckmage-region-gen-row" });
    this.previewNote = prevRow.createSpan({ cls: "setting-item-description", text: "Preview: one region of this biome, blended." });
    prevRow.createEl("button", { text: "Reroll" }).addEventListener("click", () => { this.seed = Math.floor(Math.random() * 1e9); this.redraw(); });

    this.problemEl = contentEl.createEl("p", { cls: "duckmage-locked-hint" });
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    if (existing && plugin.biomeStore.hasDefault(existing.id)) {
      row.createEl("button", { text: "Restore default" }).addEventListener("click", () => {
        void plugin.biomeStore.restoreDefault(existing.id).then((ok) => {
          if (!ok) return;
          new Notice(`${existing.label} is back to its default (the old note is in the plugin's backups folder).`);
          this.state = formFromFields(plugin.biomeStore.get(existing.id), formTypes(this.palette(), plugin.biomeStore.get(existing.id)));
          void this.build();
        });
      });
    }
    if (existing) {
      row.createEl("button", { text: "Edit generator…" }).addEventListener("click", () => {
        this.close();
        void openBiomeGenerator(plugin, existing.id);
      });
    }
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.saveBtn = row.createEl("button", { text: "Save", cls: "mod-cta" });
    const lock = biomeEditLock(plugin, this.overworldName);
    if (lock) lockButton(this.saveBtn, lock);
    this.saveBtn.addEventListener("click", () => void this.save());
    this.check();
    this.redraw();
  }

  private check(): void {
    const existing = this.existing;
    const others = this.plugin.biomeStore.list().filter((b) => b.id !== existing?.id).map((b) => ({ id: b.id, label: b.label }));
    const problem = formProblem(this.state, others);
    this.problemEl?.setText(problem ?? "");
    if (this.saveBtn && !this.saveBtn.hasClass("is-locked")) this.saveBtn.disabled = !!problem;
  }

  private schedule(): void {
    if (this.redrawTimer !== undefined) window.clearTimeout(this.redrawTimer);
    this.redrawTimer = window.setTimeout(() => { this.redrawTimer = undefined; this.redraw(); }, 120);
  }

  /**
   * The preview, made the way this biome's regions will be (planBiomePreview:
   * its generator when it has one, else the blend field). Async: a newer
   * redraw wins over one still running.
   */
  private redraw(): void {
    const token = ++this.drawToken;
    const ow = overworldOf(this.plugin, this.overworldName);
    if (!this.canvas || !ow) return;
    const fields = fieldsFromForm(this.state, this.existing?.id ?? "preview");
    this.previewNote?.setText(fields.generator ? `Preview: one region made by ${generatorName(fields.generator)}.` : "Preview: one region of this biome, blended.");
    void planBiomePreview(this.plugin, this.overworldName, fields, this.seed)
      .then((plan) => { if (token === this.drawToken) this.paint(plan); })
      .catch((e: unknown) => {
        if (token !== this.drawToken) return;
        this.paint(undefined);
        this.previewNote?.setText(e instanceof BiomeRegionError ? `No preview: ${e.message}` : "No preview.");
        if (!(e instanceof BiomeRegionError)) console.error("Hexmaker: biome preview", e);
      });
  }

  private paint(plan: RegionPlan | undefined): void {
    const ctx = this.canvas?.getContext("2d");
    const ow = overworldOf(this.plugin, this.overworldName);
    if (!ctx || !this.canvas) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!ow || !plan) return;
    const palette = this.palette();
    const colour = new Map(palette.map((t) => [t.name, t.color]));
    const cells: RegionCell[] = [...plan.cells].map(([k, t]) => {
      const [x, y] = k.split("_").map(Number);
      return { x, y, color: colour.get(t) ?? "#333" };
    });
    const box = cellsBox(ow.layout, regionCells(ow.layout, 0, 0).map(([x, y]) => ({ x, y })), [1, 0, 0, 1, 0, 0]);
    const pad = Math.max(box.w, box.h) * 0.05;
    const k = Math.min(this.canvas.width / (box.w + 2 * pad), this.canvas.height / (box.h + 2 * pad));
    const to = composeAffine([1, 0, 0, 1, 0, 0], [k, 0, 0, k, (-box.x + pad) * k + (this.canvas.width - (box.w + 2 * pad) * k) / 2, (-box.y + pad) * k + (this.canvas.height - (box.h + 2 * pad) * k) / 2]);
    drawRegionCells(ctx, ow.layout, cells, to);
  }

  private async save(): Promise<void> {
    const { plugin } = this;
    if (biomeEditLock(plugin, this.overworldName)) return;
    const existing = this.existing;
    const others = plugin.biomeStore.list().filter((b) => b.id !== existing?.id).map((b) => ({ id: b.id, label: b.label }));
    if (formProblem(this.state, others)) return;
    const fields = fieldsFromForm(this.state, existing?.id);
    if (existing) {
      // Unset optional fields are written as removed.
      const full: Partial<BiomeNoteFields> = { color: undefined, generator: undefined, blend: undefined, landShare: undefined, minIslands: undefined, shore: undefined, climate: undefined, ...fields };
      delete full.id;
      if (!(await plugin.biomeStore.update(existing.id, full))) return;
    } else {
      const res = await plugin.biomeStore.create(fields);
      if ("error" in res) { new Notice(res.error); return; }
    }
    this.close();
    plugin.refreshHexMap();
  }

  onClose(): void {
    if (this.redrawTimer !== undefined) window.clearTimeout(this.redrawTimer);
    this.contentEl.empty();
  }
}

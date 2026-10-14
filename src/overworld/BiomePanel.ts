/**
 * The biome page (#50): "Biome (blend field)", THE biome editor (owner Q14,
 * 2026-10-13: one editor; Biomes… › New biome… only asks for the basics and
 * opens this page). Opened with `plugin.openTerrainGenerator({ biome })`
 * (Biomes… › Edit…, Edit region's "Edit generator…"). Edits everything the
 * biome's note says, with a live preview of a sample region made by the
 * blend field (regionWorld.planRegion):
 *
 * - name, colour, what makes its regions (Made by) and Regions start blank;
 * - the type mix (ShareSliders: shares adding up to 100%) and min patches;
 * - terrain weights within a type (ShareSliders);
 * - blend width, land share (inherited from the mix until set), min islands, shore;
 * - climate; transitions; Debug tuning.
 *
 * Autosaves: every change is written through `biomeStore.update` (the
 * note's prose is kept), with the shared save-status line; no Save button.
 * "Restore default" calls `restoreDefault` for shipped biomes. A hand edit
 * to the note while the page is open re-renders it.
 */

import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import {
  BIOME_BLENDS,
  TUNING_SECTIONS,
  clampTuning,
  cleanTuning,
  engineOverrides,
  isDefaultValue,
  paramsIn,
  shownDefault,
  tuningControlId,
  type BiomeBlend,
  type BiomeNoteFields,
  type TuningParam,
} from "./biomeNote";
import { biomeNameProblem, climateFormFrom, climateFromForm, formTypes, generatorName, routeNote, type ClimateFormState } from "./biomeForm";
import { landOf } from "./biomeCombo";
import { withinTypeWeights } from "./biomes";
import { listGenerators } from "../worldgen/generators";
import { renderShareSliders } from "../ui/shareSliders";
import { mixRemoveButton, renderMixAdd, splitMix } from "../ui/mixList";
import { percentsToWeights } from "../ui/shares";
import { renderLabeledSlider, sliderFormat } from "../ui/sliders";
import { numberField } from "../ui/scrub";
import { renderSaveStatusLine, type SaveStatusLine } from "../ui/saveStatusLine";
import { OPEN_SEA, profileFromFields, type BiomeId } from "./biomes";
import { biomeGroupOf, groupBiomes } from "./biomeGroups";
import { profilesForPalette } from "./regionsVault";
import { paletteTypeOf, planRegion } from "./regionWorld";
import { neighbourRegions, regionBox, type RegionLayout } from "./layout";
import { drawPreview } from "../worldgen/preview";
import { renderPreviewLegend } from "../hex-map/terrainLegend";
import { getIconUrl } from "../utils";
import { Disclosure } from "../ui/disclosure";
import { randomSeed } from "../../packages/hex-wfc/src/index";
import { generateBiomeRegion } from "../worldgen/biomeRegion";

export interface BiomePanelHost {
  rerender(): void;
  /** A titled, foldable group of controls (GeneratorPanel.section). */
  section(el: HTMLElement, title: string): HTMLElement;
  /** Leave the biome page for the generator list. */
  back(): void;
}

/** What the preview puts around the sample region. */
export type PreviewSurround = "same" | "land-west";

/** The note fields the page edits (everything but the id). */
export function biomePagePatch(f: BiomeNoteFields): Partial<Omit<BiomeNoteFields, "id">> {
  return {
    label: f.label,
    color: f.color,
    generator: f.generator,
    blank: f.blank ? true : undefined,
    climate: f.climate,
    terrainWeights: f.terrainWeights?.length ? f.terrainWeights.map((w) => ({ ...w })) : undefined,
    mix: f.mix.map((r) => ({ ...r })),
    transitions: f.transitions.map((t) => ({ ...t })),
    blend: f.blend,
    landShare: f.landShare,
    minIslands: f.minIslands,
    shore: f.shore ? true : undefined,
    tuning: cleanTuning(f.tuning),
  };
}

/** Set (or, at its default, clear) one tuning value on the page's fields. Pure. */
export function setTuningValue(f: BiomeNoteFields, p: TuningParam, value: number | null): void {
  const next = { ...f.tuning };
  if (value === null || !Number.isFinite(value)) delete next[p.key];
  else {
    const v = clampTuning(p, value);
    if (isDefaultValue(p, v)) delete next[p.key];
    else next[p.key] = v;
  }
  if (Object.keys(next).length) f.tuning = next;
  else delete f.tuning;
}

/** Set a type's weight (0 drops it from the mix) or min patches (undefined clears it). Pure. */
export function setMixRow(f: BiomeNoteFields, type: string, change: { weight?: number; minPatches?: number | null }): void {
  let row = f.mix.find((r) => r.type === type);
  if (change.weight !== undefined) {
    const w = Math.max(0, Number.isFinite(change.weight) ? change.weight : 0);
    if (w === 0) { f.mix = f.mix.filter((r) => r.type !== type); return; }
    if (row) row.weight = w;
    else { row = { type, weight: w }; f.mix.push(row); }
  }
  if (change.minPatches !== undefined && row) {
    if (change.minPatches === null || !(change.minPatches > 0)) delete row.minPatches;
    else row.minPatches = Math.round(change.minPatches);
  }
}

/**
 * The weight a type added to the mix starts with (O6's "+ Add type"): the
 * mean of the weights already in, so it gets an equal share; 1 for an
 * empty mix. Pure.
 */
export function addedMixWeight(mix: readonly { weight: number }[]): number {
  const ws = mix.map((r) => r.weight).filter((w) => Number.isFinite(w) && w > 0);
  if (!ws.length) return 1;
  return Math.max(1, Math.round(ws.reduce((a, b) => a + b, 0) / ws.length));
}

/**
 * The type mix from the share sliders: whole percentages (adding up to
 * 100) as each type's weight; 0% drops the type. A type's min patches
 * survive it dipping to 0% mid-drag (`kept`). Pure.
 */
export function setMixShares(f: BiomeNoteFields, types: readonly string[], percents: readonly number[], kept: ReadonlyMap<string, number> = new Map()): void {
  types.forEach((type, i) => {
    setMixRow(f, type, { weight: percents[i] ?? 0 });
    const row = f.mix.find((r) => r.type === type);
    if (row && row.minPatches === undefined && kept.has(type)) row.minPatches = kept.get(type);
  });
}

/**
 * One type's terrain weights from its share sliders (`names`: the
 * palette's terrains of that type): stored as small whole weights that read
 * back as the same percentages, a terrain at 1 left out (1 is the default);
 * an even split stores nothing. Other types' weights are kept. Pure.
 */
export function setTypeTerrainWeights(f: BiomeNoteFields, names: readonly string[], percents: readonly number[]): void {
  const mine = new Set(names.map((n) => n.trim().toLowerCase()));
  const rest = (f.terrainWeights ?? []).filter((w) => !mine.has(w.terrain.trim().toLowerCase()));
  const weights = percentsToWeights(percents);
  const even = weights.every((w) => w === weights[0]);
  const own = even ? [] : names.map((terrain, i) => ({ terrain, weight: weights[i] })).filter((w) => w.weight !== 1);
  const all = [...rest, ...own];
  if (all.length) f.terrainWeights = all;
  else delete f.terrainWeights;
}

/** Each terrain's share of its type (fractions, for the sliders). */
export function typeTerrainShares(f: Pick<BiomeNoteFields, "terrainWeights">, names: readonly string[]): number[] {
  const within = withinTypeWeights(names, f.terrainWeights);
  return names.map((n) => within.get(n) ?? 0);
}

/**
 * A sample region of a biome on a palette: the region of hex (0, 0) with
 * its neighbours the same biome, or (`land-west`) land biomes on its
 * west, open sea on its east and the biome itself north and south (to see
 * a shore biome turn its land toward the land).
 */
export function biomeSamplePlan(
  layout: RegionLayout,
  palette: TerrainColor[],
  fields: BiomeNoteFields,
  seed: number,
  surround: PreviewSurround,
  landBiome: BiomeId,
  others = profilesForPalette(palette),
) {
  const biomes = new Map<string, BiomeId>([["0_0", fields.id]]);
  for (const [x, y] of neighbourRegions(layout, 0, 0)) {
    // West of it land, east of it sea, north and south more of the biome.
    biomes.set(`${x}_${y}`, surround === "same" || x === 0 ? fields.id : x < 0 ? landBiome : OPEN_SEA);
  }
  const profiles = new Map(others);
  profiles.set(fields.id, profileFromFields(fields, palette));
  return planRegion({
    layout,
    parent: [0, 0],
    biomes,
    profiles,
    typeOf: paletteTypeOf(palette),
    worldSeed: seed,
    seed,
    // A tuned falloff is a finer Blend width.
    blend: fields.tuning?.["blend-k"] ?? fields.blend,
  });
}

export class BiomePanel {
  /** The store listener of the page on show (one at a time). */
  private static off: (() => void) | undefined;
  static seed = randomSeed();
  static surround: PreviewSurround = "same";
  static size = 10;

  private fields: BiomeNoteFields;
  private writing = 0;
  private writeTimer: number | null = null;
  private drawTimer: number | null = null;
  /** The shared autosave line (set by render). */
  private status: SaveStatusLine | null = null;
  /** Where the Terrain weights sliders go (set by render). */
  private weightsBox: HTMLElement | null = null;
  /** Where the Type mix goes (set by render). */
  private mixBox: HTMLElement | null = null;
  /**
   * The types the Type mix shows (O6): those in the mix when the page
   * opened, plus any added here. A type slid down to 0% keeps its row while
   * the page is open (so a drag doesn't make rows vanish); × takes it out.
   */
  private mixShown: Set<string> | null = null;

  constructor(
    private plugin: HexmakerPlugin,
    private host: BiomePanelHost,
    private id: string,
    private paletteName: () => string,
  ) {
    const b = plugin.biomeStore.get(id)!;
    this.fields = { ...b, mix: b.mix.map((r) => ({ ...r })), transitions: b.transitions.map((t) => ({ ...t })), ...(b.tuning ? { tuning: { ...b.tuning } } : {}) };
  }

  /** Drop the page's store listener (the page closed or shows something else). */
  static dispose(): void {
    BiomePanel.off?.();
    BiomePanel.off = undefined;
  }

  private palette(): TerrainColor[] {
    return this.plugin.getPaletteOrPresetTerrains(this.paletteName());
  }

  render(main: HTMLElement, side: HTMLElement): void {
    const { plugin } = this;
    const f = this.fields;
    BiomePanel.dispose();
    BiomePanel.off = plugin.biomeStore.onChange(() => {
      if (this.writing) return;
      const now = plugin.biomeStore.get(this.id);
      if (!now) { this.host.back(); return; }
      if (JSON.stringify(biomePagePatch(now)) !== JSON.stringify(biomePagePatch(this.fields))) this.host.rerender();
    });
    // The page's Advanced dropdown (src/ui/placement.ts); made up front so controls can be placed into it.
    const disclosure = new Disclosure(plugin.app, "BiomePage", () => main);

    // Header: which biome, its note, restore, back, and the autosave line.
    let el = this.host.section(main, "Biome (blend field)");
    const head = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    head.createSpan({ text: "Biome", cls: "duckmage-map-origin-label" });
    const pick = head.createEl("select", { attr: { "aria-label": "Biome" } });
    // Grouped (Surface, Mountains, …) as option groups.
    const groups = groupBiomes(plugin.biomeStore.list().filter((b) => !b.blank || b.id === this.id), biomeGroupOf);
    for (const g of groups) {
      const parent = groups.length > 1 ? pick.createEl("optgroup", { attr: { label: g.label } }) : pick;
      // Generator biomes too: their mix still blends into neighbours, and Debug › Engine tunes their generator.
      for (const b of g.items) parent.createEl("option", { text: b.generator ? `${b.label} (generator)` : b.label, value: b.id });
    }
    pick.value = this.id;
    pick.addEventListener("change", () => {
      void plugin.openTerrainGenerator({ biome: pick.value });
    });
    const path = plugin.biomeStore.pathOf(this.id);
    head.createEl("button", { text: "Open note" }).addEventListener("click", () => {
      const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
      if (file instanceof TFile) void plugin.app.workspace.getLeaf("tab").openFile(file);
    });
    if (plugin.biomeStore.hasDefault(this.id)) {
      head.createEl("button", { text: "Restore default", attr: { title: "Rewrite this biome's note from the shipped preset (the old note is backed up)" } }).addEventListener("click", () => {
        void plugin.biomeStore.restoreDefault(this.id).then((ok) => {
          if (!ok) return;
          new Notice(`${f.label} is back to its default (the old note is in the plugin's backups folder).`);
          this.host.rerender();
        });
      });
    }
    head.createEl("button", { text: "Back to generators" }).addEventListener("click", () => this.host.back());
    el.createEl("p", {
      cls: "duckmage-map-origin-desc",
      text: `${f.label}'s regions mix these terrain types and blend into the biomes next to them. Changes are saved to its note${path ? ` (${path})` : ""}.`,
    });
    // The shared autosave line (no Save button: the page saves as you go).
    this.status = renderSaveStatusLine(el);

    const field = (parent: HTMLElement, label: string) => {
      const row = parent.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
      row.createSpan({ text: label, cls: "duckmage-map-origin-label" });
      return row;
    };

    // Name, colour, what makes its regions (the one biome editor, owner Q14).
    const nameRow = field(el, "Name");
    const name = nameRow.createEl("input", { type: "text", attr: { "aria-label": "Name", placeholder: "Glass wastes" } });
    name.value = f.label;
    const nameProblem = el.createEl("p", { cls: "duckmage-locked-hint" });
    name.addEventListener("change", () => {
      const others = plugin.biomeStore.list().filter((b) => b.id !== this.id);
      const problem = biomeNameProblem(name.value, others);
      nameProblem.setText(problem ?? "");
      if (problem) return;
      f.label = name.value.trim();
      this.save();
    });
    const colour = field(el, "Color").createEl("input", { type: "color", attr: { "aria-label": "Color" } });
    colour.value = /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color! : "#7a9a5a";
    colour.addEventListener("change", () => {
      f.color = colour.value.toLowerCase();
      this.save();
    });
    const gen = field(el, "Made by").createEl("select", { attr: { "aria-label": "Made by" } });
    gen.createEl("option", { text: "Built-in mixing", value: "" });
    if (f.generator) gen.createEl("option", { text: generatorName(f.generator), value: f.generator });
    gen.value = f.generator ?? "";
    void listGenerators(plugin).catch(() => []).then((gens) => {
      for (const g of gens) {
        const value = g.file.path.replace(/\.md$/, "");
        if (value !== f.generator) gen.createEl("option", { text: g.model.name || g.file.basename, value });
      }
    });
    const genNote = el.createEl("p", { cls: "duckmage-map-origin-desc", text: routeNote(f) ?? "Blend mixes the terrain types below, and blends into the biomes next to it." });
    gen.addEventListener("change", () => {
      if (gen.value) f.generator = gen.value;
      else delete f.generator;
      genNote.setText(routeNote(f) ?? "");
      this.save();
      // Debug › Engine shows only for a biome with a generator.
      this.host.rerender();
    });
    const blankRow = el.createEl("label", { cls: "duckmage-region-row duckmage-wfc-toggle" });
    const blankBox = blankRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Regions start blank" } });
    blankBox.checked = !!f.blank;
    blankRow.createSpan({ text: "Regions start blank (painted by hand; never placed by the generator)" });
    blankBox.addEventListener("change", () => {
      if (blankBox.checked) f.blank = true;
      else delete f.blank;
      this.save();
    });

    // Type mix (O6): only the types in it, each a shared zero-sum slider
    // (src/ui/shareSliders.ts) with its min patches and a ×, then
    // "+ Add type" (src/ui/mixList.ts, shared with the generator page).
    el = this.host.section(main, "Type mix");
    this.mixBox = el.createDiv({ cls: "duckmage-biome-mix" });
    this.renderTypeMix();
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Each type's share of the mix (they always add up to 100%). × takes a type out; the add button under the list puts one in. Min patches: the fewest separate patches of that type a region gets, so a sprinkle (peaks, a volcano) isn't smoothed away." });

    // Terrain weights: within a type, how its palette terrains share it (also zero-sum).
    el = this.host.section(main, "Terrain weights");
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "For a type with more than one terrain in the palette: how its share splits between them. Even unless you move them." });
    this.weightsBox = el.createDiv({ cls: "duckmage-biome-terrain-weights" });
    this.renderTerrainWeights();

    // Blend, land and shore.
    el = this.host.section(main, "Blend and land");
    const blend = field(el, "Blend width").createEl("select", { attr: { "aria-label": "Blend width" } });
    blend.createEl("option", { text: "Overworld setting", value: "" });
    for (const b of BIOME_BLENDS) blend.createEl("option", { text: b, value: b });
    blend.value = f.blend ?? "";
    blend.addEventListener("change", () => {
      if (blend.value) f.blend = blend.value as BiomeBlend;
      else delete f.blend;
      this.schedulePreview();
      this.save();
    });
    // Land share: unset shows the land share its type mix gives, dimmed, with a reset (audit S7).
    const land = renderLabeledSlider(el, {
      label: "Land share",
      min: 0, max: 100, step: 1, wheelStep: 5,
      value: Math.round((f.landShare ?? landOf(f.mix)) * 100),
      format: sliderFormat.percent,
      isSet: () => f.landShare !== undefined,
      reset: {
        value: Math.round(landOf(f.mix) * 100),
        text: "from the type mix",
        onReset: () => {
          delete f.landShare;
          land.set(Math.round(landOf(f.mix) * 100));
          this.schedulePreview();
          this.save();
        },
      },
      onInput: (v) => { f.landShare = v / 100; this.schedulePreview(); },
      onChange: (v) => { f.landShare = v / 100; this.save(); },
    });
    numberField(field(el, "Min islands"), {
      min: 0, max: 99, whole: true, blank: true, placeholder: "—", ariaLabel: "Min islands",
      value: f.minIslands,
      onChange: (v) => {
        if (v === undefined) delete f.minIslands;
        else f.minIslands = v;
        this.schedulePreview();
        this.save();
      },
    });
    const shoreRow = field(el, "Shore");
    const shore = shoreRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Shore" } });
    shore.checked = !!f.shore;
    shoreRow.createSpan({ cls: "duckmage-map-origin-desc", text: "Land faces the land-heavy neighbours, water the rest, with a coast between." });
    shore.addEventListener("change", () => {
      if (shore.checked) f.shore = true;
      else delete f.shore;
      this.schedulePreview();
      this.save();
    });
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Land share and min islands are for watery biomes (islands), or with shore on, how much of a region is land." });

    // Climate (optional): where World biomes may place it.
    el = this.host.section(main, "Climate");
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "When set, the overworld generator can place this biome where the climate fits, like a built-in one. Left blank, it's only placed by hand. Temperature: cold, cool, mild, warm, hot; moisture: dry, moderate, wet; or numbers from 0 to 1." });
    const cl = climateFormFrom(f.climate);
    const climateProblem = el.createEl("p", { cls: "duckmage-locked-hint" });
    const climateChanged = () => {
      const r = climateFromForm(cl);
      climateProblem.setText(r.problems.length ? `Climate: ${r.problems[0]}.` : "");
      if (r.problems.length) return;
      if (r.climate) f.climate = r.climate;
      else delete f.climate;
      this.save();
    };
    const text = (label: string, value: string, placeholder: string, set: (v: string) => void) => {
      const input = field(el, label).createEl("input", { type: "text", attr: { "aria-label": label, placeholder } });
      input.value = value;
      input.addEventListener("change", () => { set(input.value); climateChanged(); });
    };
    text("Temperature", cl.temperature, "Any (e.g. cold–mild)", (v) => { cl.temperature = v; });
    text("Moisture", cl.moisture, "Any (e.g. wet, 0.2–0.5)", (v) => { cl.moisture = v; });
    const elev = field(el, "Height").createEl("select", { attr: { "aria-label": "Height" } });
    for (const [v, t] of [["", "Not set (low)"], ["low", "Low"], ["mid", "Mid (hills)"], ["high", "High (peaks)"], ["sea", "Sea"], ["mouth", "River mouth"]] as const) elev.createEl("option", { value: v, text: t });
    elev.value = cl.elevation;
    elev.addEventListener("change", () => { cl.elevation = elev.value as ClimateFormState["elevation"]; climateChanged(); });
    const tick = (label: string, on: boolean, set: (v: boolean) => void) => {
      const row = el.createEl("label", { cls: "duckmage-region-row duckmage-wfc-toggle" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = on;
      row.createSpan({ text: label });
      box.addEventListener("change", () => { set(box.checked); climateChanged(); });
    };
    tick("Coast only", cl.coastal, (v) => { cl.coastal = v; });
    tick("Rare", cl.rare, (v) => { cl.rare = v; });
    // Chance %: a Debug control (the id it had on the old biome form).
    const chance = renderLabeledSlider(el, {
      label: "Chance",
      min: 0, max: 100, step: 5,
      value: cl.chancePercent ?? 100,
      format: sliderFormat.percent,
      isSet: () => cl.chancePercent !== undefined,
      reset: { value: 100, text: "every fitting hex", onReset: () => { cl.chancePercent = undefined; climateChanged(); } },
      onChange: (v) => { cl.chancePercent = v; climateChanged(); },
    });
    disclosure.place("BiomeForm.chance", chance.el, () => cl.chancePercent !== undefined);

    // Transitions.
    el = this.host.section(main, "Transitions");
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Biomes this one shouldn't touch on an overworld, and the biome put between them." });
    const trList = el.createDiv();
    const renderTr = () => {
      trList.empty();
      f.transitions.forEach((t, i) => {
        const row = trList.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
        const sel = (value: string, label: string) => {
          const s = row.createEl("select", { attr: { "aria-label": label } });
          s.createEl("option", { text: "—", value: "" });
          for (const b of plugin.biomeStore.list()) s.createEl("option", { text: b.label, value: b.label });
          const hit = [...s.options].find((o) => o.value.toLowerCase() === value.toLowerCase());
          if (!hit && value) s.createEl("option", { text: `${value} (unknown)`, value });
          s.value = hit?.value ?? value;
          return s;
        };
        row.createSpan({ text: "Next to" });
        const next = sel(t.next, "Next to");
        row.createSpan({ text: "put" });
        const between = sel(t.between, "Put between");
        const changed = () => {
          t.next = next.value;
          t.between = between.value;
          if (t.next && t.between) this.save();
        };
        next.addEventListener("change", changed);
        between.addEventListener("change", changed);
        row.createEl("button", { text: "Remove", attr: { "aria-label": "Remove transition" } }).addEventListener("click", () => {
          f.transitions.splice(i, 1);
          renderTr();
          this.save();
        });
      });
      trList.createEl("button", { text: "Add transition" }).addEventListener("click", () => {
        f.transitions.push({ next: "", between: "" });
        renderTr();
      });
    };
    renderTr();

    // Debug (debug mode only): every generator constant, per biome (biomeTuning.ts).
    this.renderTuning(disclosure, main);

    // Preview (sticky side column).
    const box = side.createDiv({ cls: "duckmage-wfc-section" });
    box.createEl("h4", { text: "Preview" });
    const canvas = box.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const legend = box.createDiv();
    const status = box.createEl("p", { cls: "duckmage-map-origin-desc" });
    const seedRow = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    // The seed itself is in Advanced → Seed (placed at the end); Reroll stays here.
    const seedBox = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    seedBox.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seed = seedBox.createEl("input", { type: "number", cls: "duckmage-wfc-seed", value: String(BiomePanel.seed), attr: { "aria-label": "Seed" } });
    seed.addEventListener("change", () => { BiomePanel.seed = Number(seed.value) >>> 0; this.drawPreview(canvas, legend, status, side); });
    seedRow.createEl("button", { text: "Reroll", attr: { title: "Preview with a new seed" } }).addEventListener("click", () => {
      BiomePanel.seed = randomSeed();
      seed.value = String(BiomePanel.seed);
      this.drawPreview(canvas, legend, status, side);
    });
    seedRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    numberField(seedRow, {
      min: 2, max: 32, whole: true, fallback: 10, value: BiomePanel.size, ariaLabel: "Region size",
      onChange: (v) => {
        BiomePanel.size = v ?? 10;
        this.drawPreview(canvas, legend, status, side);
      },
    });
    const aroundRow = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    aroundRow.createSpan({ text: "Around it", cls: "duckmage-map-origin-label" });
    const around = aroundRow.createEl("select", { attr: { "aria-label": "Around it" } });
    around.createEl("option", { text: "The same biome", value: "same" });
    around.createEl("option", { text: "Land to the west, sea to the east", value: "land-west" });
    around.value = BiomePanel.surround;
    around.addEventListener("change", () => { BiomePanel.surround = around.value as PreviewSurround; this.drawPreview(canvas, legend, status, side); });
    const palRow = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    palRow.createSpan({ text: "Palette", cls: "duckmage-map-origin-label" });
    const palSel = palRow.createEl("select", { attr: { "aria-label": "Preview palette" } });
    for (const p of plugin.settings.terrainPalettes) palSel.createEl("option", { text: p.name, value: p.name });
    palSel.value = this.paletteName();
    palSel.addEventListener("change", () => { this.onPalette(palSel.value); });
    this.redrawPreview = () => this.drawPreview(canvas, legend, status, side);
    this.drawPreview(canvas, legend, status, side);
    // The page's Advanced dropdown (src/ui/placement.ts): the seed, by id.
    disclosure.place("BiomePage.seed", seedBox);
    // Keep the dropdown below everything else on the page.
    disclosure.toEnd();
  }

  /**
   * The tuning controls, one per param, in Debug sub-sections (placement
   * `BiomePage.tune.<key>`). Each shows its value (the default when
   * unset), resets to the default, redraws the preview and counts toward
   * "· N set". Engine only for a biome that links a generator.
   */
  private renderTuning(disclosure: Disclosure, main: HTMLElement): void {
    const f = this.fields;
    for (const section of TUNING_SECTIONS) {
      if (section === "Engine" && !f.generator) continue;
      for (const p of paramsIn(section)) {
        const id = tuningControlId(p.key);
        const parent = disclosure.target(id, main, () => f.tuning?.[p.key] !== undefined);
        if (!parent) continue;
        // The shared slider: value shown, dimmed at the default, the one
        // reset, and (debug mode) a number box.
        const def = shownDefault(p, f.blend);
        const slider = renderLabeledSlider(parent, {
          label: p.label,
          title: p.help,
          min: p.min,
          max: p.max,
          step: p.step,
          value: f.tuning?.[p.key] ?? def,
          cls: "duckmage-biome-tune-row",
          isSet: () => f.tuning?.[p.key] !== undefined,
          reset: {
            value: def,
            text: p.inherits && p.engine ? "the generator's own setting" : undefined,
            onReset: () => {
              setTuningValue(f, p, null);
              slider.set(def);
              this.schedulePreview();
              this.save();
              disclosure.refreshSet();
            },
          },
          onInput: (v) => {
            setTuningValue(f, p, v);
            this.schedulePreview();
          },
          onChange: (v) => {
            setTuningValue(f, p, v);
            slider.refresh();
            this.save();
            disclosure.refreshSet();
          },
        });
      }
    }
  }

  /** Called with a new preview palette (the page keeps it). */
  onPalette: (name: string) => void = () => {};

  private redrawPreview: () => void = () => {};

  private schedulePreview(): void {
    if (this.drawTimer !== null) window.clearTimeout(this.drawTimer);
    this.drawTimer = window.setTimeout(() => { this.drawTimer = null; this.redrawPreview(); }, 120);
  }

  private drawPreview(canvas: HTMLCanvasElement, legend: HTMLElement, status: HTMLElement, side: HTMLElement): void {
    const { plugin } = this;
    const palette = this.palette();
    const stagger = plugin.settings.staggerOffset ?? "odd";
    const layout: RegionLayout = { footprint: "rect", size: BiomePanel.size, orientation: plugin.settings.hexOrientation, parentStagger: stagger, childStagger: stagger };
    if (!this.fields.mix.length) {
      status.setText("Give at least one terrain type a weight.");
      return;
    }
    // The land beside it: the biome most made of lowland (forest, grassland) types.
    const lowland = (b: BiomeNoteFields) => {
      const total = b.mix.reduce((s, r) => s + r.weight, 0) || 1;
      return b.mix.filter((r) => r.type === "forest" || r.type === "grassland").reduce((s, r) => s + r.weight, 0) / total;
    };
    const candidates = plugin.biomeStore.list().filter((b) => b.id !== this.fields.id && !b.generator && !b.shore);
    const landBiome = candidates.sort((a, b) => lowland(b) - lowland(a))[0]?.id ?? this.fields.id;
    const t0 = activeWindow.performance.now();
    const b = regionBox(layout, 0, 0);
    if (this.fields.generator) {
      // A generator biome: its region comes from the generator, with the Engine tuning on top.
      void this.drawGeneratorPreview(canvas, legend, status, side, layout);
      return;
    }
    const plan = biomeSamplePlan(layout, palette, this.fields, BiomePanel.seed, BiomePanel.surround, landBiome);
    const colors = new Map(palette.map((t) => [t.name, t.color]));
    const dpr = activeWindow.devicePixelRatio || 1;
    drawPreview(canvas, plan.cells, { cols: b.cols, rows: b.rows, offset: { x: b.x, y: b.y }, stagger }, plugin.settings.hexOrientation, colors, undefined, [], new Map(), Math.max(420, side.clientWidth) * dpr, 40 * dpr);
    renderPreviewLegend(legend, plugin, palette, plan.cells.values(), (i) => getIconUrl(plugin, i));
    status.setText(`One ${layout.size}×${layout.size} region · ${Math.round(activeWindow.performance.now() - t0)} ms`);
  }

  private previewTicket = 0;

  /** The preview of a generator biome: one region from its generator (Engine tuning applied). */
  private async drawGeneratorPreview(canvas: HTMLCanvasElement, legend: HTMLElement, status: HTMLElement, side: HTMLElement, layout: RegionLayout): Promise<void> {
    const { plugin } = this;
    const ticket = ++this.previewTicket;
    const palette = this.palette();
    const stagger = layout.childStagger;
    const b = regionBox(layout, 0, 0);
    const t0 = activeWindow.performance.now();
    status.setText("Making a sample region…");
    try {
      const made = await generateBiomeRegion(plugin, {
        generator: { path: this.fields.generator! },
        palette: { name: this.paletteName(), terrains: palette },
        bounds: { cols: b.cols, rows: b.rows, offset: { x: b.x, y: b.y }, stagger },
        pinned: new Map(),
        seed: BiomePanel.seed,
        settings: engineOverrides(this.fields.tuning),
      });
      if (ticket !== this.previewTicket) return;
      const colors = new Map(palette.map((t) => [t.name, t.color]));
      const dpr = activeWindow.devicePixelRatio || 1;
      drawPreview(canvas, made.cells, { cols: b.cols, rows: b.rows, offset: { x: b.x, y: b.y }, stagger }, plugin.settings.hexOrientation, colors, undefined, [], new Map(), Math.max(420, side.clientWidth) * dpr, 40 * dpr);
      renderPreviewLegend(legend, plugin, palette, made.cells.values(), (i) => getIconUrl(plugin, i));
      status.setText(`One ${layout.size}×${layout.size} region from its generator · ${Math.round(activeWindow.performance.now() - t0)} ms`);
    } catch (e) {
      if (ticket === this.previewTicket) status.setText(e instanceof Error ? e.message : String(e));
    }
  }

  /** The Type mix (O6): only the types in it, with × and "+ Add type" (src/ui/mixList.ts). */
  private renderTypeMix(): void {
    const box = this.mixBox;
    if (!box) return;
    box.empty();
    const f = this.fields;
    const palette = this.palette();
    const present = new Set(palette.map((t) => t.type));
    this.mixShown ??= new Set(f.mix.map((r) => r.type));
    const shownSet = this.mixShown;
    const colorOf = (type: string) => palette.find((t) => t.type === type)?.color;
    const all = formTypes(palette, f).map((type) => ({
      id: type,
      label: type,
      color: colorOf(type),
      title: present.has(type) ? type : `${type}: not in this palette`,
    }));
    const { shown, addable } = splitMix(all, (type) => shownSet.has(type) || f.mix.some((r) => r.type === type));
    const types = shown.map((i) => i.id);
    const cur = (type: string) => f.mix.find((r) => r.type === type);
    // Min patches survive a type dipping to 0% mid-drag (setMixRow drops the row).
    const keptPatches = new Map(f.mix.filter((r) => r.minPatches !== undefined).map((r) => [r.type, r.minPatches!]));
    const patchBoxes: HTMLInputElement[] = [];
    const showPatches = () => types.forEach((type, i) => {
      const r = cur(type);
      patchBoxes[i].value = r?.minPatches !== undefined ? String(r.minPatches) : "";
      patchBoxes[i].disabled = !r;
    });
    const setShares = (percents: number[]) => {
      setMixShares(f, types, percents, keptPatches);
      showPatches();
    };
    const changed = () => {
      this.schedulePreview();
      this.save();
      this.renderTerrainWeights();
    };
    if (types.length) {
      renderShareSliders(box, {
        empty: "hold",
        cls: "duckmage-biome-page-mix",
        head: ["Type", "", "Share", "Min patches", ""],
        items: shown.map((i) => ({ label: i.label, title: i.title, cls: present.has(i.id) ? undefined : "is-missing" })),
        weights: types.map((type) => cur(type)?.weight ?? 0),
        extra: (row, i) => {
          const type = types[i];
          patchBoxes[i] = numberField(row, {
            min: 0, max: 99, whole: true, blank: true, placeholder: "—", ariaLabel: `${type} min patches`,
            value: cur(type)?.minPatches,
            onChange: (v) => {
              setMixRow(f, type, { minPatches: v ?? null });
              if (v !== undefined && v > 0) keptPatches.set(type, v);
              else keptPatches.delete(type);
              showPatches();
              this.schedulePreview();
              this.save();
            },
          });
          mixRemoveButton(row, type, () => {
            setMixRow(f, type, { weight: 0 });
            shownSet.delete(type);
            this.renderTypeMix();
            changed();
          });
        },
        onInput: (_shares, percents) => {
          setShares(percents);
          this.schedulePreview();
        },
        onChange: (_shares, percents) => {
          setShares(percents);
          changed();
        },
      });
      showPatches();
    } else {
      box.createEl("p", { cls: "duckmage-empty-state", text: "No types in the mix yet. Add one below." });
    }
    renderMixAdd(this.plugin.app, box, {
      thing: "type",
      things: "types",
      addable,
      onAdd: (type) => {
        // An equal share with the types already in (the shares stay a whole).
        setMixRow(f, type, { weight: addedMixWeight(f.mix) });
        shownSet.add(type);
        this.renderTypeMix();
        changed();
      },
    });
  }

  /** The Terrain weights sliders: one set per type in the mix with more than one palette terrain. */
  private renderTerrainWeights(): void {
    const box = this.weightsBox;
    if (!box) return;
    box.empty();
    const f = this.fields;
    const palette = this.palette();
    let shown = 0;
    for (const r of f.mix) {
      const terrains = palette.filter((t) => t.type === r.type);
      if (terrains.length < 2) continue;
      shown++;
      const names = terrains.map((t) => t.name);
      box.createDiv({ cls: "duckmage-biome-terrain-weights-type", text: r.type });
      renderShareSliders(box, {
        empty: "hold",
        items: terrains.map((t) => ({ label: t.name, color: t.color })),
        weights: typeTerrainShares(f, names),
        ariaLabel: (item) => `${item.label} share of ${r.type}`,
        onInput: (_s, percents) => {
          setTypeTerrainWeights(f, names, percents);
          this.schedulePreview();
        },
        onChange: (_s, percents) => {
          setTypeTerrainWeights(f, names, percents);
          this.schedulePreview();
          this.save();
        },
      });
    }
    if (!shown) box.createEl("p", { cls: "duckmage-map-origin-desc", text: "No type in the mix has more than one terrain in this palette." });
  }

  /** Write the page's fields to the biome's note (debounced), shown on the save-status line. */
  private save(): void {
    if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
    this.status?.pending();
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.writing++;
      const work = this.plugin.biomeStore.update(this.id, biomePagePatch(this.fields))
        .then((ok) => {
          if (ok) this.plugin.refreshHexMap();
          else throw new Error("not saved");
        })
        .finally(() => { this.writing--; });
      if (this.status) void this.status.track(work);
      else void work.catch(() => {});
    }, 300);
  }
}

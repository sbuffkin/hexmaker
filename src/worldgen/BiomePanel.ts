/**
 * The generator page for a blend-field biome (#50): "Biome (blend field)".
 * Opened with `plugin.openTerrainGenerator({ biome })` (the biome form's
 * and Edit region's "Edit generator…"). Tunes what the biome's note says,
 * with a live preview of a sample region made by the blend field
 * (regionWorld.planRegion):
 *
 * - the type mix (weights) and min patches per type;
 * - blend width, land share, min islands and shore;
 * - transitions.
 *
 * Every change is written through `biomeStore.update` (the note's prose is
 * kept); "Restore default" calls `restoreDefault` for shipped biomes. A
 * hand edit to the note while the page is open re-renders it.
 */

import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { BIOME_BLENDS, type BiomeBlend, type BiomeNoteFields } from "../overworld/biomeNote";
import { formTypes } from "../overworld/biomeForm";
import { OPEN_SEA, profileFromFields, type BiomeId } from "../overworld/biomes";
import { profilesForPalette } from "../overworld/regionsVault";
import { paletteTypeOf, planRegion } from "../overworld/regionWorld";
import { neighbourRegions, regionBox, type RegionLayout } from "../overworld/layout";
import { drawPreview } from "./preview";
import { renderPreviewLegend } from "../hex-map/terrainLegend";
import { getIconUrl } from "../utils";
import { randomSeed } from "../../packages/hex-wfc/src";

export interface BiomePanelHost {
  rerender(): void;
  /** A titled, foldable group of controls (GeneratorPanel.section). */
  section(el: HTMLElement, title: string): HTMLElement;
  /** Leave the biome page for the generator list. */
  back(): void;
}

/** What the preview puts around the sample region. */
export type PreviewSurround = "same" | "land-west";

/** The note fields the page edits (everything but id, label, colour and generator). */
export function biomePagePatch(f: BiomeNoteFields): Partial<Omit<BiomeNoteFields, "id">> {
  return {
    mix: f.mix.map((r) => ({ ...r })),
    transitions: f.transitions.map((t) => ({ ...t })),
    blend: f.blend,
    landShare: f.landShare,
    minIslands: f.minIslands,
    shore: f.shore ? true : undefined,
  };
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
    blend: fields.blend,
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

  constructor(
    private plugin: HexmakerPlugin,
    private host: BiomePanelHost,
    private id: string,
    private paletteName: () => string,
  ) {
    const b = plugin.biomeStore.get(id)!;
    this.fields = { ...b, mix: b.mix.map((r) => ({ ...r })), transitions: b.transitions.map((t) => ({ ...t })) };
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

    // Header: which biome, its note, restore, back.
    let el = this.host.section(main, "Biome (blend field)");
    const head = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    head.createSpan({ text: "Biome", cls: "duckmage-map-origin-label" });
    const pick = head.createEl("select", { attr: { "aria-label": "Biome" } });
    for (const b of plugin.biomeStore.list()) {
      if (b.generator) continue;
      pick.createEl("option", { text: b.label, value: b.id });
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

    // Type mix.
    el = this.host.section(main, "Type mix");
    const palette = this.palette();
    const present = new Set(palette.map((t) => t.type));
    const grid = el.createDiv({ cls: "duckmage-biome-page-mix" });
    const headRow = grid.createDiv({ cls: "duckmage-biome-page-row is-head" });
    for (const h of ["Type", "Weight", "", "Min patches"]) headRow.createSpan({ text: h });
    for (const type of formTypes(palette, f)) {
      const row = grid.createDiv({ cls: "duckmage-biome-page-row" });
      if (!present.has(type)) row.addClass("is-missing");
      row.createSpan({ text: type, attr: { title: present.has(type) ? type : `${type}: not in this palette` } });
      const cur = () => f.mix.find((r) => r.type === type);
      const slider = row.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "1", "aria-label": `${type} weight` } });
      const num = row.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", step: "1", "aria-label": `${type} weight value` } });
      const patches = row.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", step: "1", placeholder: "—", "aria-label": `${type} min patches` } });
      const show = () => {
        const r = cur();
        slider.value = String(Math.min(100, r?.weight ?? 0));
        num.value = String(r?.weight ?? 0);
        patches.value = r?.minPatches !== undefined ? String(r.minPatches) : "";
        patches.disabled = !r;
      };
      show();
      slider.addEventListener("input", () => {
        setMixRow(f, type, { weight: Number(slider.value) });
        num.value = slider.value;
        patches.disabled = !cur();
        this.schedulePreview();
      });
      slider.addEventListener("change", () => this.save());
      num.addEventListener("change", () => {
        setMixRow(f, type, { weight: Number(num.value) });
        show();
        this.schedulePreview();
        this.save();
      });
      patches.addEventListener("change", () => {
        setMixRow(f, type, { minPatches: patches.value.trim() === "" ? null : Number(patches.value) });
        show();
        this.schedulePreview();
        this.save();
      });
    }
    el.createEl("p", { cls: "duckmage-map-origin-desc", text: "Weights are relative (any scale). Min patches: the fewest separate patches of that type a region gets, so a sprinkle (peaks, a volcano) isn't smoothed away." });

    // Blend, land and shore.
    el = this.host.section(main, "Blend and land");
    const field = (label: string) => {
      const row = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
      row.createSpan({ text: label, cls: "duckmage-map-origin-label" });
      return row;
    };
    const blend = field("Blend width").createEl("select", { attr: { "aria-label": "Blend width" } });
    blend.createEl("option", { text: "Overworld setting", value: "" });
    for (const b of BIOME_BLENDS) blend.createEl("option", { text: b, value: b });
    blend.value = f.blend ?? "";
    blend.addEventListener("change", () => {
      if (blend.value) f.blend = blend.value as BiomeBlend;
      else delete f.blend;
      this.schedulePreview();
      this.save();
    });
    const landRow = field("Land share");
    const landOn = landRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Set a land share" } });
    const land = landRow.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "5", "aria-label": "Land share" } });
    const landVal = landRow.createSpan();
    const showLand = () => {
      landOn.checked = f.landShare !== undefined;
      land.disabled = f.landShare === undefined;
      land.value = String(Math.round((f.landShare ?? 0.5) * 100));
      landVal.setText(f.landShare !== undefined ? `${Math.round(f.landShare * 100)}%` : "Not set");
    };
    showLand();
    landOn.addEventListener("change", () => {
      if (landOn.checked) f.landShare = Number(land.value) / 100;
      else delete f.landShare;
      showLand();
      this.schedulePreview();
      this.save();
    });
    land.addEventListener("input", () => { f.landShare = Number(land.value) / 100; showLand(); this.schedulePreview(); });
    land.addEventListener("change", () => this.save());
    const isl = field("Min islands").createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", step: "1", placeholder: "—", "aria-label": "Min islands" } });
    isl.value = f.minIslands !== undefined ? String(f.minIslands) : "";
    isl.addEventListener("change", () => {
      if (isl.value.trim() === "") delete f.minIslands;
      else f.minIslands = Math.max(0, Math.round(Number(isl.value) || 0));
      this.schedulePreview();
      this.save();
    });
    const shoreRow = field("Shore");
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

    // Preview (sticky side column).
    const box = side.createDiv({ cls: "duckmage-wfc-section" });
    box.createEl("h4", { text: "Preview" });
    const canvas = box.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const legend = box.createDiv();
    const status = box.createEl("p", { cls: "duckmage-map-origin-desc" });
    const seedRow = box.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seed = seedRow.createEl("input", { type: "number", cls: "duckmage-wfc-seed", value: String(BiomePanel.seed) });
    seed.addEventListener("change", () => { BiomePanel.seed = Number(seed.value) >>> 0; this.drawPreview(canvas, legend, status, side); });
    seedRow.createEl("button", { text: "Re-roll" }).addEventListener("click", () => {
      BiomePanel.seed = randomSeed();
      seed.value = String(BiomePanel.seed);
      this.drawPreview(canvas, legend, status, side);
    });
    seedRow.createSpan({ text: "Size", cls: "duckmage-map-origin-label" });
    const size = seedRow.createEl("input", { type: "number", cls: "duckmage-wfc-num", value: String(BiomePanel.size), attr: { min: "2", max: "32", "aria-label": "Region size" } });
    size.addEventListener("change", () => {
      BiomePanel.size = Math.max(2, Math.min(32, Math.round(Number(size.value) || 10)));
      size.value = String(BiomePanel.size);
      this.drawPreview(canvas, legend, status, side);
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
    const landBiome = plugin.biomeStore.list().find((b) => b.id !== this.fields.id && !b.generator && !b.shore && (b.landShare === undefined || b.landShare > 0.5) && b.mix.some((r) => r.type === "forest" || r.type === "grassland"))?.id ?? "grassland";
    const t0 = activeWindow.performance.now();
    const plan = biomeSamplePlan(layout, palette, this.fields, BiomePanel.seed, BiomePanel.surround, landBiome);
    const b = regionBox(layout, 0, 0);
    const colors = new Map(palette.map((t) => [t.name, t.color]));
    const dpr = activeWindow.devicePixelRatio || 1;
    drawPreview(canvas, plan.cells, { cols: b.cols, rows: b.rows, offset: { x: b.x, y: b.y }, stagger }, plugin.settings.hexOrientation, colors, undefined, [], new Map(), Math.max(420, side.clientWidth) * dpr, 40 * dpr);
    renderPreviewLegend(legend, plugin, palette, plan.cells.values(), (i) => getIconUrl(plugin, i));
    status.setText(`One ${layout.size}×${layout.size} region · ${Math.round(activeWindow.performance.now() - t0)} ms`);
  }

  /** Write the page's fields to the biome's note (debounced). */
  private save(): void {
    if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.writing++;
      void this.plugin.biomeStore.update(this.id, biomePagePatch(this.fields))
        .then((ok) => {
          if (ok) this.plugin.refreshHexMap();
        })
        .finally(() => { this.writing--; });
    }, 300);
  }
}

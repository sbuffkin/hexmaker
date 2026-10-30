/**
 * Overworld biome tools (owner, 2026-10-10): on an overworld you set a
 * hex's BIOME, one hex at a time, and its region is made or remade from it.
 *
 * - An empty hex (an empty brick, Set biome…) opens Edit region in new-region
 *   mode (EditRegionModal, newRegion.ts): preview, mix, reroll, then Create.
 *   Changing a placed region is Edit region's too (God once it's locked).
 * - RegionGenModal: a small generator editor for one region (biome, blend,
 *   variation, seed) with a live preview drawn like the overworld preview
 *   page; Apply makes or remakes the region.
 */

import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { renderLabeledSlider, sliderFormat } from "../ui/sliders";
import type HexmakerPlugin from "../HexmakerPlugin";
import { regionMapAt } from "../maps/submaps";
import { allBiomeIds, biomeInfo, biomeNoteOf, isBlankBiome, isComboId, representableBiomes, representativeTerrain, type BiomeId } from "./biomes";
import { BIOME_PRESETS } from "./biomePresets";
import { biomeGroupOf, type BiomeGroup } from "./biomeGroups";
import { fillBiomeSelect } from "./biomeChooser";
import { REGION_WARP, type BlendWidth } from "./blendField";
import { regionCells } from "./layout";
import { composeAffine, drawRegionCells, cellsBox, type RegionCell } from "./overworldRender";
import { hexNeighbors } from "../../packages/hex-wfc/src/grid";
import { openBiomeGenerator } from "./BiomeLibraryModal";
import { lockButton } from "../ui/lockButton";
import {
  createRegion,
  hexBiomeAt,
  regionBiomeStatus,
  overworldOf,
  planRegionAt,
  planRegionWithGenerator,
  regenerateRegion,
  reshapeLock,
  setBiomeAt,
  type RegionGenOptions,
} from "./regionsVault";
import { hexKey, hexXY } from "../hexKey";

export interface BiomeHost {
  app: App;
  plugin: HexmakerPlugin;
  /** Enter the region (optionally centred on a cell). */
  enter(name: string): void;
  /** Redraw after a change. */
  changed(): void;
  /** A new region was made (e.g. from the hex menu: enter it). */
  made?(name: string): void;
}

/** Why hex (px, py)'s biome can't be set or its region remade now, or undefined when it can. */
export function biomeLock(host: BiomeHost, parentName: string, px: number, py: number): string | undefined {
  return reshapeLock(host.plugin, parentName, px, py);
}

/** Whether hex (px, py)'s biome may be set now (first placement in Build/God, a change in God). */
export function mayReshape(host: BiomeHost, parentName: string, px: number, py: number): boolean {
  return biomeLock(host, parentName, px, py) === undefined;
}

/**
 * Run a biome change on hex (px, py) of an overworld. Changing a placed
 * region (swap, reroll, regenerate) is recorded for undo in the overworld
 * queue of its mode (WM6), as the map data it changes; making a region
 * for the first time is not (it makes a map).
 */
export async function reshapeUndoable<T>(plugin: HexmakerPlugin, parentName: string, px: number, py: number, fn: () => Promise<T>): Promise<T> {
  if (!regionMapAt(plugin.settings.maps, parentName, hexKey(px, py))) return fn();
  return plugin.undoableEdit(parentName, fn);
}

/**
 * Reroll the region of hex (px, py) with a new seed (Edit region…'s and the
 * overworld menu's Reroll): its made neighbours stay fixed context, its
 * locked hexes stay. Refused (false) where the mode can't change it. Undoable.
 */
export async function rerollRegionAt(host: BiomeHost, parentName: string, px: number, py: number): Promise<boolean> {
  const region = regionMapAt(host.plugin.settings.maps, parentName, hexKey(px, py));
  if (!region || !mayReshape(host, parentName, px, py)) return false;
  await reshapeUndoable(host.plugin, parentName, px, py, () => regenerateRegion(host.plugin, region.name, { seed: newSeed() }));
  host.changed();
  // Say so: the change may be off screen, or under the dialog that asked for it.
  new Notice(rerolledNotice(host.plugin.mapLabel(region.name)));
  return true;
}

/** The notice after a reroll (Edit region…, the overworld menu, the biome picker). */
export function rerolledNotice(label: string): string {
  return `Rerolled ${label}.`;
}

// Kept exported here for existing importers; it lives in ui/lockButton so
// BiomeLibraryModal can use it without importing this file (import cycle).
export { lockButton };

/** A biome offered on an overworld: the terrain it paints there (none for a blank biome) and its swatch colour. */
export interface PaintableBiome {
  id: BiomeId;
  label: string;
  /** Overworld terrain it paints; undefined for a blank biome (its hex stays blank). */
  terrain?: string;
  color: string;
  /** Its heading in the pickers (biomeGroups.ts). */
  group: BiomeGroup;
}

/** The biomes this overworld's palette can paint (with the terrain each paints), and every blank biome. */
export function paintableBiomes(plugin: HexmakerPlugin, parentName: string): PaintableBiome[] {
  const palette = plugin.getMapPalette(parentName);
  const shown = representableBiomes(palette);
  const out: PaintableBiome[] = [];
  for (const id of allBiomeIds()) {
    const label = biomeInfo(id)?.label ?? id;
    const group = groupOfBiome(id);
    if (isBlankBiome(id)) { out.push({ id, label, color: biomeNoteOf(id)?.color ?? "#a8a29e", group }); continue; }
    if (!shown.has(id)) continue;
    const terrain = representativeTerrain(id, palette)!;
    out.push({ id, label, terrain, color: palette.find((t) => t.name === terrain)?.color ?? "#888", group });
  }
  return out;
}

/** A biome's picker group: from its note, else its shipped preset (before the notes load). */
export function groupOfBiome(id: BiomeId): BiomeGroup {
  const f = biomeNoteOf(id) ?? BIOME_PRESETS.find((p) => p.id === id);
  return f ? biomeGroupOf(f) : "surface";
}

/** A biome tile's tooltip: what it paints. */
export function biomeTileTitle(b: PaintableBiome): string {
  return b.terrain ? `${b.label}: paints ${b.terrain}` : `${b.label}: a blank region, to paint by hand`;
}

const newSeed = () => Math.floor(Math.random() * 1e9);

/** A small generator editor for one region, with a live preview. */
export class RegionGenModal extends HexmakerModal {
  protected surfaceId = "RegionGen";
  private opts: RegionGenOptions & { biome?: BiomeId } = {};
  private canvas!: HTMLCanvasElement;

  constructor(private host: BiomeHost, private parentName: string, private px: number, private py: number) {
    super(host.app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-region-gen-modal");
    const { plugin } = this.host;
    const ow = overworldOf(plugin, this.parentName);
    if (!ow) { this.close(); return; }
    const hex = hexKey(this.px, this.py);
    const region = regionMapAt(plugin.settings.maps, this.parentName, hex);
    const biome = hexBiomeAt(plugin, this.parentName, hex);
    this.opts = {
      biome,
      blend: ow.settings.blend ?? "normal",
      // Starts at the biome's tuned border wiggle (its Tuning table), else the default.
      warp: (biome ? biomeNoteOf(biome)?.tuning?.wiggle : undefined) ?? REGION_WARP,
      seed: region?.regionSeed ?? newSeed(),
    };
    this.titleEl.setText(region ? `Region settings: ${plugin.mapLabel(region.name)}` : `New region: hex ${this.px}, ${this.py}`);
    const { contentEl } = this;
    const form = contentEl.createDiv({ cls: "duckmage-region-gen-form" });

    const field = (label: string) => {
      const row = form.createDiv({ cls: "duckmage-region-gen-row" });
      row.createSpan({ cls: "duckmage-region-gen-label", text: label });
      return row;
    };
    const biomeSel = field("Biome").createEl("select", { attr: { "aria-label": "Biome" } });
    fillBiomeSelect(biomeSel, paintableBiomes(plugin, this.parentName));
    // A combined biome (set in Edit region…) is kept as it is unless another is picked.
    if (this.opts.biome && isComboId(this.opts.biome)) biomeSel.createEl("option", { text: biomeInfo(this.opts.biome)?.label ?? this.opts.biome, value: this.opts.biome });
    if (this.opts.biome) biomeSel.value = this.opts.biome;
    biomeSel.addEventListener("change", () => { this.opts.biome = biomeSel.value; this.redraw(); });
    const status = region ? regionBiomeStatus(plugin, region.name) : undefined;
    if (status && "unknown" in status) form.createEl("p", { cls: "duckmage-locked-hint", text: `Unknown biome: ${status.unknown} (its note is gone). The region keeps its terrain; pick a biome to remake it.` });
    const genRow = field("Biome generator");
    genRow.createEl("button", { text: "Edit generator…" }).addEventListener("click", () => {
      if (!this.opts.biome) return;
      this.close();
      void openBiomeGenerator(plugin, this.opts.biome);
    });

    const blendSel = field("Blend width").createEl("select", { attr: { "aria-label": "Blend width" } });
    for (const w of ["narrow", "normal", "wide"] as BlendWidth[]) blendSel.createEl("option", { text: w[0].toUpperCase() + w.slice(1), value: w });
    blendSel.value = this.opts.blend as string;
    blendSel.addEventListener("change", () => { this.opts.blend = blendSel.value as BlendWidth; this.redraw(); });

    // Wiggly borders and the seed are Debug; Reroll stays in reach.
    const warpRow = field("Wiggly borders");
    renderLabeledSlider(warpRow, {
      label: "", ariaLabel: "Wiggly borders", min: 0, max: 0.5, step: 0.05, value: this.opts.warp ?? REGION_WARP, format: sliderFormat.fraction,
      onChange: (v) => { this.opts.warp = v; this.redraw(); },
    });

    const seedRow = field("Seed");
    const seed = seedRow.createEl("input", { type: "number", attr: { "aria-label": "Seed" } });
    seed.value = String(this.opts.seed);
    seed.addEventListener("change", () => { this.opts.seed = Number(seed.value) >>> 0; this.redraw(); });
    form.createDiv({ cls: "duckmage-region-gen-row" }).createEl("button", { text: "Reroll" }).addEventListener("click", () => {
      this.opts.seed = newSeed();
      seed.value = String(this.opts.seed);
      this.redraw();
    });

    this.canvas = contentEl.createEl("canvas", { cls: "duckmage-region-gen-preview" });
    this.canvas.width = 360;
    this.canvas.height = 300;
    contentEl.createEl("p", { cls: "setting-item-description", text: "Preview: this region bright, its painted neighbours dimmed." });

    const foot = this.footer({
      primary: { text: region ? "Apply" : "Make region", onClick: () => {
        if (!mayReshape(this.host, this.parentName, this.px, this.py)) return;
        this.close();
        void this.apply();
      } },
      cancel: () => this.close(),
    });
    const lock = biomeLock(this.host, this.parentName, this.px, this.py);
    if (lock) {
      lockButton(foot.primary!, lock);
      foot.el.createSpan({ cls: "duckmage-locked-hint", text: lock });
    }
    this.place("RegionGen.wigglyBorders", warpRow);
    this.place("RegionGen.seed", seedRow);
    this.redraw();
  }

  /** The overworld terrain to paint for the chosen biome (undefined: keep the hex's). */
  private biomeTerrain(): string | undefined {
    const { plugin } = this.host;
    return this.opts.biome ? representativeTerrain(this.opts.biome, plugin.getMapPalette(this.parentName)) : undefined;
  }

  private redrawToken = 0;

  private redraw(): void {
    // Preview with the chosen biome on the hex (nothing is written), made
    // the way the region will be (a generator-backed biome by its generator).
    const token = ++this.redrawToken;
    const opts = { ...this.opts, hexTerrain: this.biomeTerrain() };
    void planRegionWithGenerator(this.host.plugin, this.parentName, this.px, this.py, opts)
      .catch(() => planRegionAt(this.host.plugin, this.parentName, this.px, this.py, opts))
      .then((plan) => {
        if (token === this.redrawToken) drawRegionPlan(this.canvas, this.host.plugin, this.parentName, this.px, this.py, plan);
      });
  }

  private async apply(): Promise<void> {
    const { plugin } = this.host;
    const hex = hexKey(this.px, this.py);
    const region = regionMapAt(plugin.settings.maps, this.parentName, hex);
    const notice = new Notice(region ? "Remaking the region…" : "Making the region…", 0);
    let res: { name: string } | { error: string };
    if (this.opts.biome) { const biome = this.opts.biome; res = await reshapeUndoable(plugin, this.parentName, this.px, this.py, () => setBiomeAt(plugin, this.parentName, this.px, this.py, biome, this.opts)); }
    else if (region) { await reshapeUndoable(plugin, this.parentName, this.px, this.py, () => regenerateRegion(plugin, region.name, this.opts)); res = { name: region.name }; }
    else res = await createRegion(plugin, this.parentName, this.px, this.py, { ...this.opts, fill: "match" });
    notice.hide();
    if ("error" in res) new Notice(res.error);
    else if (!region) this.host.made?.(res.name);
    this.host.changed();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Draw the region of hex (px, py) as it is now (its painted cells), with
 * the regions around it dimmed: Edit region…'s preview, so a Reroll
 * shows its result while the dialog covers the map.
 */
export function drawRegionNow(canvas: HTMLCanvasElement, plugin: HexmakerPlugin, parentName: string, px: number, py: number): void {
  const region = regionMapAt(plugin.settings.maps, parentName, hexKey(px, py));
  const cells = new Map<string, string>();
  if (region) for (const [k, h] of plugin.mapStore.all(region.name)) if (h.terrain) cells.set(k, h.terrain);
  drawRegionPlan(canvas, plugin, parentName, px, py, { cells, mix: new Map() });
}

/**
 * Draw a region plan (planRegionAt) for hex (px, py): the region bright
 * (with its hand-painted, locked cells), the regions around it dimmed.
 * Shared by the region settings modal and the walk-into-new-land flow.
 */
export function drawRegionPlan(
  canvas: HTMLCanvasElement,
  plugin: HexmakerPlugin,
  parentName: string,
  px: number,
  py: number,
  plan: ReturnType<typeof planRegionAt>,
): void {
  const ow = overworldOf(plugin, parentName);
  const ctx = canvas.getContext("2d");
  if (!ow || !ctx) return;
  const hex = hexKey(px, py);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!plan) return;
  const layout = ow.layout;
  const colour = new Map(plugin.getPaletteOrPresetTerrains(ow.settings.palette ?? ow.map.paletteName).map((t) => [t.name, t.color]));
  const own: RegionCell[] = [...plan.cells].map(([k, t]) => {
    const { x, y } = hexXY(k);
    return { x, y, color: colour.get(t) ?? "#333" };
  });
  const locked = regionMapAt(plugin.settings.maps, parentName, hex);
  if (locked) for (const [k, h] of plugin.mapStore.all(locked.name)) {
    if (!h.locked || !h.terrain) continue;
    const { x, y } = hexXY(k);
    own.push({ x, y, color: colour.get(h.terrain) ?? "#333" });
  }
  const around: RegionCell[] = [];
  for (const [qx, qy] of hexNeighbors(px, py, layout.orientation, layout.parentStagger)) {
    const r = regionMapAt(plugin.settings.maps, parentName, hexKey(qx, qy));
    if (!r) continue;
    const hexes = plugin.mapStore.all(r.name);
    for (const [x, y] of regionCells(layout, qx, qy)) {
      const t = hexes.get(hexKey(x, y))?.terrain;
      if (t) around.push({ x, y, color: colour.get(t) ?? "#333" });
    }
  }
  if (!own.length && !around.length) return;
  const box = cellsBox(layout, regionCells(layout, px, py).map(([x, y]) => ({ x, y })), [1, 0, 0, 1, 0, 0]);
  // Fit this region plus a margin of its neighbours into the canvas.
  const pad = Math.max(box.w, box.h) * 0.45;
  const k = Math.min(canvas.width / (box.w + 2 * pad), canvas.height / (box.h + 2 * pad));
  const to = composeAffine([1, 0, 0, 1, 0, 0], [k, 0, 0, k, (-box.x + pad) * k + (canvas.width - (box.w + 2 * pad) * k) / 2, (-box.y + pad) * k + (canvas.height - (box.h + 2 * pad) * k) / 2]);
  ctx.globalAlpha = 0.45;
  drawRegionCells(ctx, layout, around, to, { seams: false });
  ctx.globalAlpha = 1;
  drawRegionCells(ctx, layout, own, to);
}

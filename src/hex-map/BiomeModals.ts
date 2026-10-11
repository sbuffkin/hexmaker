/**
 * Overworld biome tools (owner, 2026-10-10): on an overworld you set a
 * hex's BIOME, one hex at a time, and its region is made or remade from it.
 *
 * - BiomePickerModal: click an overworld hex (biomes view) → pick a biome.
 *   On a hex with no region yet that makes the region (Build and God; in
 *   Play the picker is greyed). On a hex whose region exists it remakes
 *   it: God mode only (reshapeLock, src/workMode.ts), with no confirm.
 *   Locked buttons are disabled and say how to unlock them. Reroll and Settings… live here too.
 * - RegionGenModal: a small generator editor for one region (biome, blend,
 *   variation, seed) with a live preview drawn like the overworld preview
 *   page; Apply makes or remakes the region.
 */

import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { regionMapAt } from "../maps/submaps";
import { allBiomeIds, biomeInfo, representableBiomes, representativeTerrain, type BiomeId } from "../overworld/biomes";
import { REGION_WARP, type BlendWidth } from "../overworld/blendField";
import { regionCells } from "../overworld/layout";
import { composeAffine, drawRegionCells, cellsBox, type RegionCell } from "../overworld/overworldRender";
import { hexNeighbors } from "../../packages/hex-wfc/src/grid";
import { BiomeLibraryModal, openBiomeGenerator } from "./BiomeLibraryModal";
import {
  createRegion,
  hexBiomeAt,
  regionBiomeStatus,
  overworldOf,
  planRegionAt,
  regenerateRegion,
  reshapeLock,
  setBiomeAt,
  type RegionGenOptions,
} from "../overworld/regionsVault";

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

/** Mark a button as locked by the work mode: disabled, with the hint as its tooltip. */
export function lockButton(btn: HTMLButtonElement, hint: string): void {
  btn.disabled = true;
  btn.addClass("is-locked");
  btn.setAttr("title", hint);
  btn.setAttr("aria-label", `${btn.getText()} (${hint})`);
}

/** The biomes this overworld's palette can paint, with the terrain each paints. */
export function paintableBiomes(plugin: HexmakerPlugin, parentName: string): { id: BiomeId; label: string; terrain: string; color: string }[] {
  const palette = plugin.getMapPalette(parentName);
  const shown = representableBiomes(palette);
  const out: { id: BiomeId; label: string; terrain: string; color: string }[] = [];
  for (const id of allBiomeIds()) {
    if (!shown.has(id)) continue;
    const terrain = representativeTerrain(id, palette)!;
    out.push({ id, label: biomeInfo(id)?.label ?? id, terrain, color: palette.find((t) => t.name === terrain)?.color ?? "#888" });
  }
  return out;
}

export class BiomePickerModal extends HexmakerModal {
  constructor(private host: BiomeHost, private parentName: string, private px: number, private py: number) {
    super(host.app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-biome-modal");
    const { plugin } = this.host;
    const hex = `${this.px}_${this.py}`;
    const current = hexBiomeAt(plugin, this.parentName, hex);
    const region = regionMapAt(plugin.settings.maps, this.parentName, hex);
    this.titleEl.setText(`Hex ${this.px}, ${this.py}`);
    const { contentEl } = this;
    const lock = biomeLock(this.host, this.parentName, this.px, this.py);
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: !region ? (lock ? "No region yet." : "No region yet. Pick a biome and its region is made, blending with its neighbours.")
        : lock ? `Region: ${plugin.mapLabel(region.name)}.`
        : `Region: ${plugin.mapLabel(region.name)}. Picking another biome remakes it (hand-painted hexes stay).`,
    });
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    const grid = contentEl.createDiv({ cls: "duckmage-biome-grid" });
    for (const b of paintableBiomes(plugin, this.parentName)) {
      const btn = grid.createEl("button", { cls: "duckmage-biome-option" + (b.id === current ? " is-active" : ""), attr: { title: `Paints ${b.terrain}` } });
      btn.createSpan({ cls: "duckmage-biome-swatch" }).setCssProps({ "--duckmage-biome-color": b.color });
      btn.createSpan({ text: b.label });
      // With a region, its current biome stays clickable (a no-op); with
      // none yet, every biome would make one, so all are locked.
      if (lock && (b.id !== current || !region)) lockButton(btn, lock);
      btn.addEventListener("click", () => {
        if (b.id === current && region) return;
        if (!mayReshape(this.host, this.parentName, this.px, this.py)) return;
        this.close();
        void this.apply(b.id);
      });
    }
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    if (region) {
      row.createEl("button", { text: "Enter region" }).addEventListener("click", () => { this.close(); this.host.enter(region.name); });
      const reroll = row.createEl("button", { text: "Reroll" });
      if (lock) lockButton(reroll, lock);
      reroll.addEventListener("click", () => {
        if (!mayReshape(this.host, this.parentName, this.px, this.py)) return;
        this.close();
        void regenerateRegion(plugin, region.name, { seed: newSeed() }).then(() => this.host.changed());
      });
    }
    row.createEl("button", { text: "Settings…" }).addEventListener("click", () => {
      this.close();
      new RegionGenModal(this.host, this.parentName, this.px, this.py).open();
    });
    row.createEl("button", { text: "Biomes…", attr: { title: "Add your own biomes, or edit these" } }).addEventListener("click", () => {
      this.close();
      new BiomeLibraryModal(this.app, plugin, this.parentName).open();
    });
  }

  private async apply(biome: BiomeId): Promise<void> {
    const notice = new Notice("Making the region…", 0);
    const res = await setBiomeAt(this.host.plugin, this.parentName, this.px, this.py, biome);
    notice.hide();
    if ("error" in res) new Notice(res.error);
    this.host.changed();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const newSeed = () => Math.floor(Math.random() * 1e9);

/** A small generator editor for one region, with a live preview. */
export class RegionGenModal extends HexmakerModal {
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
    const hex = `${this.px}_${this.py}`;
    const region = regionMapAt(plugin.settings.maps, this.parentName, hex);
    this.opts = {
      biome: hexBiomeAt(plugin, this.parentName, hex),
      blend: ow.settings.blend ?? "normal",
      warp: REGION_WARP,
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
    for (const b of paintableBiomes(plugin, this.parentName)) biomeSel.createEl("option", { text: b.label, value: b.id });
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

    const blendSel = field("Blend with neighbours").createEl("select", { attr: { "aria-label": "Blend" } });
    for (const w of ["narrow", "normal", "wide"] as BlendWidth[]) blendSel.createEl("option", { text: w, value: w });
    blendSel.value = this.opts.blend as string;
    blendSel.addEventListener("change", () => { this.opts.blend = blendSel.value as BlendWidth; this.redraw(); });

    const warpRow = field("Wiggly borders");
    const warp = warpRow.createEl("input", { type: "range", attr: { min: "0", max: "0.5", step: "0.05", "aria-label": "Wiggly borders" } });
    warp.value = String(this.opts.warp);
    const warpVal = warpRow.createSpan({ text: String(this.opts.warp) });
    warp.addEventListener("input", () => { warpVal.setText(warp.value); });
    warp.addEventListener("change", () => { this.opts.warp = Number(warp.value); this.redraw(); });

    const seedRow = field("Seed");
    const seed = seedRow.createEl("input", { type: "number", attr: { "aria-label": "Seed" } });
    seed.value = String(this.opts.seed);
    seed.addEventListener("change", () => { this.opts.seed = Number(seed.value) >>> 0; this.redraw(); });
    seedRow.createEl("button", { text: "Reroll" }).addEventListener("click", () => {
      this.opts.seed = newSeed();
      seed.value = String(this.opts.seed);
      this.redraw();
    });

    this.canvas = contentEl.createEl("canvas", { cls: "duckmage-region-gen-preview" });
    this.canvas.width = 360;
    this.canvas.height = 300;
    contentEl.createEl("p", { cls: "setting-item-description", text: "Preview: this region bright, its painted neighbours dimmed." });

    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const apply = row.createEl("button", { text: region ? "Apply" : "Make region", cls: "mod-cta" });
    const lock = biomeLock(this.host, this.parentName, this.px, this.py);
    if (lock) {
      lockButton(apply, lock);
      row.createSpan({ cls: "duckmage-locked-hint", text: lock });
    }
    apply.addEventListener("click", () => {
      if (!mayReshape(this.host, this.parentName, this.px, this.py)) return;
      this.close();
      void this.apply();
    });
    this.redraw();
  }

  /** The overworld terrain to paint for the chosen biome (undefined: keep the hex's). */
  private biomeTerrain(): string | undefined {
    const { plugin } = this.host;
    return this.opts.biome ? representativeTerrain(this.opts.biome, plugin.getMapPalette(this.parentName)) : undefined;
  }

  private redraw(): void {
    // Preview with the chosen biome on the hex (nothing is written).
    const plan = planRegionAt(this.host.plugin, this.parentName, this.px, this.py, { ...this.opts, hexTerrain: this.biomeTerrain() });
    drawRegionPlan(this.canvas, this.host.plugin, this.parentName, this.px, this.py, plan);
  }

  private async apply(): Promise<void> {
    const { plugin } = this.host;
    const hex = `${this.px}_${this.py}`;
    const region = regionMapAt(plugin.settings.maps, this.parentName, hex);
    const notice = new Notice(region ? "Remaking the region…" : "Making the region…", 0);
    let res: { name: string } | { error: string };
    if (this.opts.biome) res = await setBiomeAt(plugin, this.parentName, this.px, this.py, this.opts.biome, this.opts);
    else if (region) { await regenerateRegion(plugin, region.name, this.opts); res = { name: region.name }; }
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
  const hex = `${px}_${py}`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!plan) return;
  const layout = ow.layout;
  const colour = new Map(plugin.getPaletteOrPresetTerrains(ow.settings.palette ?? ow.map.paletteName).map((t) => [t.name, t.color]));
  const own: RegionCell[] = [...plan.cells].map(([k, t]) => {
    const [x, y] = k.split("_").map(Number);
    return { x, y, color: colour.get(t) ?? "#333" };
  });
  const locked = regionMapAt(plugin.settings.maps, parentName, hex);
  if (locked) for (const [k, h] of plugin.mapStore.all(locked.name)) {
    if (!h.locked || !h.terrain) continue;
    const [x, y] = k.split("_").map(Number);
    own.push({ x, y, color: colour.get(h.terrain) ?? "#333" });
  }
  const around: RegionCell[] = [];
  for (const [qx, qy] of hexNeighbors(px, py, layout.orientation, layout.parentStagger)) {
    const r = regionMapAt(plugin.settings.maps, parentName, `${qx}_${qy}`);
    if (!r) continue;
    const hexes = plugin.mapStore.all(r.name);
    for (const [x, y] of regionCells(layout, qx, qy)) {
      const t = hexes.get(`${x}_${y}`)?.terrain;
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

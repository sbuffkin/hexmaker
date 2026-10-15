/**
 * "Blend into <biome>…" (owner request 2026-10-12): fold a hand-edited map
 * back into the biome it was made from. With a generator linked, the map
 * is learned and merged into that generator; without one, the map's mix,
 * terrain split, land share and smoothing are blended into the biome's own
 * settings (src/worldgen/regionGenerator.ts planBlend / applyBlend). A
 * weight (the shared zero-sum sliders: this map vs what's there) says how much the map counts, with a live preview of a
 * fresh region. Opened from Edit region and the Maps window's right-click
 * menu, next to "Make generator…" (both Advanced). Needs Build or God.
 */

import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { applyBlend, blendLock, blendTarget, planBlend, previewBlend, type BlendPlan, type BlendTarget } from "./regionGenerator";
import { mapStagger } from "../worldgen/generators";
import { drawPreview } from "../worldgen/preview";
import { openMakeGenerator } from "./MakeGeneratorModal";
import { renderShareSliders } from "../ui/shareSliders";
import { hexXY } from "../hexKey";

/** The default share of the map in a blend. */
export const DEFAULT_BLEND_WEIGHT = 0.25;

/** The menu label for a map's blend action, or undefined when the map wasn't made from a biome. */
export async function blendMenuLabel(plugin: HexmakerPlugin, mapName: string): Promise<string | undefined> {
  const t = await blendTarget(plugin, mapName);
  return t ? `Blend into ${t.biome.label}…` : undefined;
}

/** Open "Blend into <biome>" for a map (a notice when it has no biome). */
export async function openBlendIntoBiome(app: App, plugin: HexmakerPlugin, mapName: string): Promise<void> {
  const target = await blendTarget(plugin, mapName);
  if (!target) {
    new Notice(`${plugin.mapLabel(mapName)} wasn't made from a biome, so there's nothing to blend into.`);
    return;
  }
  new BlendIntoBiomeModal(app, plugin, mapName, target).open();
}

export class BlendIntoBiomeModal extends HexmakerModal {
  private weight = DEFAULT_BLEND_WEIGHT;
  private seed = Math.floor(Math.random() * 1e9);
  private plan: BlendPlan | { error: string } | null = null;
  private timer: number | null = null;
  private drawn = 0;

  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string, private target: BlendTarget) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-blend-into-modal");
    this.titleEl.setText(`Blend ${this.plugin.mapLabel(this.mapName)} into ${this.target.biome.label}`);
    this.render();
  }

  private into(): string {
    return this.target.generator ? this.target.generator.model.name : this.target.biome.label;
  }

  private render(): void {
    const { contentEl, plugin, target } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: target.generator
        ? `Learns from this map as painted and blends it into ${target.biome.label}'s generator, ${target.generator.model.name}. Only its tables and settings change; the old note is backed up first.`
        : `${target.biome.label} has no generator, so this map's terrain mix, terrain split, land share and smoothing are blended into the biome's own settings. Only those tables and keys change; the old note is backed up first.`,
    });
    if (target.missing) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: `${target.biome.label}'s generator (${target.missing}) wasn't found.` });
    const lock = blendLock(plugin, this.mapName);
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });

    // How much this map counts against what's there: the shared zero-sum sliders (always 100%).
    const weightBox = contentEl.createDiv({ cls: "duckmage-wfc-influence" });
    weightBox.createEl("label", { text: "Weight", cls: "duckmage-map-field-label" });
    renderShareSliders(weightBox, {
      items: [{ label: "This map", title: plugin.mapLabel(this.mapName) }, { label: this.into() }],
      weights: [this.weight, 1 - this.weight],
      ariaLabel: (item) => `Weight of ${item.label === "This map" ? "this map" : item.label}`,
      onInput: (shares) => {
        this.weight = shares[0] / 100;
        this.schedule(canvas, status);
      },
      onChange: (_shares, percents) => {
        this.weight = percents[0] / 100;
        this.schedule(canvas, status);
      },
    });

    const box = contentEl.createDiv({ cls: "duckmage-wfc-section" });
    const canvas = box.createEl("canvas", { cls: "duckmage-wfc-preview" });
    const status = box.createEl("p", { cls: "duckmage-map-origin-desc" });
    box.createEl("button", { text: "Reroll", attr: { title: "Preview with a new seed" } }).addEventListener("click", () => {
      this.seed = Math.floor(Math.random() * 1e9);
      void this.redraw(canvas, status);
    });

    const go: HTMLButtonElement = this.footer({
      primary: { text: `Blend into ${target.biome.label}`, disabled: !!lock || !!target.missing, onClick: () => void this.apply(go) },
      secondary: [!target.generator && { text: "Make a generator instead…", title: "Learn a generator from this map instead", onClick: () => {
        this.close();
        openMakeGenerator(this.app, plugin, this.mapName);
      } }],
      cancel: () => this.close(),
    }).primary!;
    void this.redraw(canvas, status);
  }

  private schedule(canvas: HTMLCanvasElement, status: HTMLElement): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.redraw(canvas, status); }, 150);
  }

  private async redraw(canvas: HTMLCanvasElement, status: HTMLElement): Promise<void> {
    const { plugin } = this;
    const ticket = ++this.drawn;
    this.plan = planBlend(plugin, this.mapName, this.target, this.weight);
    if ("error" in this.plan) { status.setText(this.plan.error); return; }
    status.setText("Making a sample region…");
    const cells = await previewBlend(plugin, this.target, this.plan, this.seed);
    if (ticket !== this.drawn) return; // a newer preview is on its way
    if ("error" in cells) { status.setText(cells.error); return; }
    if (!cells.size) { status.setText("Nothing to preview."); return; }
    const xs = [...cells.keys()].map((k) => hexXY(k).x), ys = [...cells.keys()].map((k) => hexXY(k).y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const grid = { cols: Math.max(...xs) - x0 + 1, rows: Math.max(...ys) - y0 + 1, offset: { x: x0, y: y0 }, stagger: mapStagger(plugin, this.mapName) };
    const colors = new Map(plugin.getMapPalette(this.mapName).map((t) => [t.name, t.color]));
    const dpr = activeWindow.devicePixelRatio || 1;
    drawPreview(canvas, cells, grid, plugin.settings.hexOrientation, colors, undefined, [], new Map(), 420 * dpr, 30 * dpr);
    status.setText(`A fresh region of ${this.target.biome.label} after the blend.`);
  }

  private async apply(btn: HTMLButtonElement): Promise<void> {
    if (!this.plan || "error" in this.plan) {
      new Notice(this.plan && "error" in this.plan ? this.plan.error : "Nothing to blend yet.");
      return;
    }
    btn.disabled = true;
    const res = await applyBlend(this.plugin, this.mapName, this.target, this.plan);
    if ("error" in res) {
      new Notice(res.error);
      btn.disabled = false;
      return;
    }
    new Notice(`Blended ${this.plugin.mapLabel(this.mapName)} into ${this.into()} (${Math.round(this.plan.weight * 100)}%).${res.backup ? ` The old generator is in ${res.backup}.` : " The old note is in the plugin's backups folder."}`, 8000);
    this.plugin.refreshHexMap();
    this.close();
  }

  onClose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.contentEl.empty();
  }
}

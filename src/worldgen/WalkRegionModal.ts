import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { randomSeed } from "../../packages/hex-wfc/src";
import { generatorFitsPalette, listGenerators, paletteColors, pathColors, type GeneratorFile } from "./generators";
import { createWalkRegion, planWalk, previewWalk, regionBiome, type WalkPlan } from "./neighbours";
import { drawPreview } from "./preview";
import type { Side } from "./world";

/**
 * "New land to the east": stepping off a map's edge where no region is yet.
 * Pick (or roll) the biome that lies beyond; the new region is blended with
 * its neighbours, so a different biome arrives through a transition region.
 * Creates the region and hands back its name.
 */
export class WalkRegionModal extends HexmakerModal {
  private seed = randomSeed();

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private fromMap: string,
    private side: Side,
    private onCreated: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(`New land to the ${this.side}`);
    const { contentEl } = this;
    contentEl.addClass("duckmage-region-nav");
    contentEl.createEl("p", { text: "Loading generators…", cls: "duckmage-map-origin-desc" });
    void listGenerators(this.plugin).then((generators) => this.render(generators));
  }

  private render(generators: GeneratorFile[]): void {
    const { contentEl } = this;
    contentEl.empty();
    const from = this.plugin.getMap(this.fromMap);
    if (!from) return;
    const palette = this.plugin.getPaletteByName(from.paletteName)?.terrains.map((t) => t.name) ?? [];
    const here = regionBiome(this.plugin, this.fromMap, generators);
    // Biomes that fit this map's palette; planet generators only on a planet.
    const onPlanet = generators.find((g) => g.model.name === here?.name)?.model.meta["map-kind"] === "planet";
    const biomes = generators.filter(
      (g) => generatorFitsPalette(g.model, palette) && (onPlanet || g.model.meta["map-kind"] !== "planet"),
    );
    if (!biomes.length) {
      contentEl.createEl("p", { text: "No generator fits this map's palette, so there's nothing to make the new land from. Learn or add one on the terrain generator page.", cls: "duckmage-map-origin-desc" });
      return;
    }
    contentEl.createEl("p", {
      text: `Nothing lies ${this.side} of ${this.fromMap} yet. Pick what's out there, or roll for it. If it's a different biome, this region is the border country in between.`,
      cls: "duckmage-map-origin-desc",
    });

    // Biome: pick or roll.
    const row = contentEl.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    row.createSpan({ text: "Biome", cls: "duckmage-map-origin-label" });
    const select = row.createEl("select");
    for (const g of biomes) select.createEl("option", { value: g.model.name, text: g.model.name === here?.name ? `${g.model.name} (same as here)` : g.model.name });
    select.value = biomes.some((g) => g.model.name === here?.name) ? here!.name : biomes[0].model.name;
    const roll = row.createEl("button", { text: "Roll", attr: { title: "Pick a biome at random (a different one from here, if there is one)" } });

    const note = contentEl.createEl("p", { cls: "duckmage-map-origin-desc" });
    const canvas = contentEl.createEl("canvas", { cls: "duckmage-region-nav-preview" });
    const seedRow = contentEl.createDiv({ cls: "duckmage-region-row" });
    const reroll = seedRow.createEl("button", { text: "Re-roll terrain" });

    const nameRow = contentEl.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    nameRow.createSpan({ text: "Name", cls: "duckmage-map-origin-label" });
    const nameInput = nameRow.createEl("input", { type: "text", attr: { placeholder: "Region name" } });

    const buttons = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const create = buttons.createEl("button", { text: "Create and go", cls: "mod-cta" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    let plan: WalkPlan | null = null;
    let nameTouched = false;
    nameInput.addEventListener("input", () => (nameTouched = true));
    const suggestName = (biome: string) => {
      const base = biome.replace(/^(biome|preset|planet|blend)-/, "");
      let n = 1;
      while (this.plugin.getMap(`${base}-${n}`)) n++;
      return `${base}-${n}`;
    };

    const refresh = () => {
      const chosen = biomes.find((g) => g.model.name === select.value)!;
      const r = planWalk(this.plugin, this.fromMap, this.side, chosen, generators);
      if (!r.ok) {
        note.setText(`⚠ ${r.reason}`);
        create.disabled = true;
        return;
      }
      plan = r.plan;
      note.setText(
        plan.from.length
          ? `Transition: ${plan.from.join(" + ")} turning into ${chosen.model.name} toward the ${this.side}.`
          : `${chosen.model.name} carries on from here.`,
      );
      if (!nameTouched) nameInput.value = suggestName(chosen.model.name);
      const preview = previewWalk(this.plugin, plan, this.seed);
      create.disabled = !preview.ok;
      if (!preview.ok) {
        note.setText(`Couldn't generate: ${preview.message}`);
        return;
      }
      const { region } = plan;
      drawPreview(
        canvas, preview.cells,
        { cols: region.cols, rows: region.rows, offset: region.offset, stagger: region.stagger },
        this.plugin.settings.hexOrientation,
        paletteColors(this.plugin, region.paletteName),
        undefined, preview.paths, pathColors(this.plugin), 360, 12,
      );
    };
    select.addEventListener("change", refresh);
    roll.addEventListener("click", () => {
      const others = biomes.filter((g) => g.model.name !== here?.name);
      const pool = others.length ? others : biomes;
      select.value = pool[Math.floor(Math.random() * pool.length)].model.name;
      refresh();
    });
    reroll.addEventListener("click", () => {
      this.seed = randomSeed();
      refresh();
    });
    create.addEventListener("click", () => {
      if (!plan) return;
      create.disabled = true;
      void createWalkRegion(this.plugin, plan, nameInput.value.trim() || suggestName(select.value), this.seed, (done, total) =>
        create.setText(`Creating ${done} / ${total}…`),
      ).then((r) => {
        if ("error" in r) {
          new Notice(r.error);
          create.disabled = false;
          create.setText("Create and go");
          return;
        }
        this.close();
        this.onCreated(r.name);
      });
    });
    refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

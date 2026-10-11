import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { randomSeed } from "../../packages/hex-wfc/src";
import { generatorFitsPalette, listGenerators, paletteColors, pathColors, type GeneratorFile } from "./generators";
import { createWalkRegion, planWalk, previewWalk, regionBiome, type WalkPlan } from "./neighbours";
import { drawPreview } from "./preview";
import type { Side } from "./world";
import { biomeForTerrain, biomeInfo, representativeTerrain } from "../overworld/biomes";
import { regionHome, inOverworldGrid, planRegionAt, planRegionWithGenerator, walkIntoHex, walkLock } from "../overworld/regionsVault";
import { defaultRegionName, rollBiome } from "../overworld/regionWorld";
import { drawRegionPlan, lockButton, paintableBiomes } from "../hex-map/BiomeModals";
import { ADD_REGION_LOCKED_HINT, canAdd } from "../workMode";
import { slugify } from "../utils";
import { isContextOnlyTag } from "../mapKinds";

/** Walking from a region of an overworld into the empty overworld hex (px, py), which lies `bearing` of it. */
export interface OverworldWalk {
  overworld: string;
  px: number;
  py: number;
  /** Compass word ("north-east"). */
  bearing: string;
}

/**
 * "New land to the east": stepping off a map's edge where no region is yet.
 * Pick (or roll) the biome that lies beyond; the new region is blended with
 * its neighbours, so a different biome arrives through a transition region.
 * Creates the region and hands back its name.
 *
 * One flow for both entry points (the hex editor's neighbour flower and the
 * map toolbar's region flower / d-pad), in two flavours:
 * - a region of an overworld (`to` is an OverworldWalk): the biome is one
 *   the overworld's palette can paint; the region is made in that hex's
 *   slot by the blend field, pinned to every region around it, and the
 *   overworld grows to take the hex in when it lies past its grid
 *   (walkIntoHex). Build and God only (src/workMode.ts).
 * - a map on an older side-by-side world (`to` is a side): the biome is a
 *   terrain generator, blended with the neighbours (planWalk).
 */
export class WalkRegionModal extends HexmakerModal {
  protected surfaceId = "WalkOW";
  private seed = randomSeed();
  private side: Side = "east";
  private walk: OverworldWalk | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private fromMap: string,
    to: Side | OverworldWalk,
    private onCreated: (name: string) => void,
  ) {
    super(app);
    if (typeof to === "string") this.side = to;
    else this.walk = to;
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(`New land to the ${this.walk?.bearing ?? this.side}`);
    const { contentEl } = this;
    contentEl.addClass("duckmage-region-nav");
    if (this.walk) {
      this.renderOverworld(this.walk);
      return;
    }
    contentEl.createEl("p", { text: "Loading generators…", cls: "duckmage-map-origin-desc" });
    void listGenerators(this.plugin).then((generators) => this.render(generators));
  }

  /** The overworld flavour: pick or roll a biome, preview the blended region, create it. */
  private renderOverworld(walk: OverworldWalk): void {
    const { contentEl, plugin } = this;
    contentEl.empty();
    const ow = plugin.getMap(walk.overworld);
    if (!ow) return;
    const { px, py } = walk;
    const hex = `${px}_${py}`;
    const owPalette = plugin.getMapPalette(walk.overworld);
    const biomes = paintableBiomes(plugin, walk.overworld);
    if (!biomes.length) {
      contentEl.createEl("p", { text: "This overworld's palette has no terrain that stands for a biome, so there's nothing to make the new land from.", cls: "duckmage-map-origin-desc" });
      return;
    }
    const home = regionHome(plugin, this.fromMap);
    const hereTerrain = home ? plugin.mapStore.get(walk.overworld, `${home.px}_${home.py}`)?.terrain : undefined;
    const here = hereTerrain ? biomeForTerrain(hereTerrain, owPalette) : undefined;
    const grows = !inOverworldGrid(ow, px, py);
    contentEl.createEl("p", {
      text: `Nothing lies ${walk.bearing} of ${plugin.mapLabel(this.fromMap)} yet. Pick what's out there, or roll for it. If it's a different biome, the new region is the border country in between.`
        + (grows ? " The overworld grows by a hex to fit it." : ""),
      cls: "duckmage-map-origin-desc",
    });

    const row = contentEl.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    row.createSpan({ text: "Biome", cls: "duckmage-map-origin-label" });
    const select = row.createEl("select", { attr: { "aria-label": "Biome" } });
    for (const b of biomes) select.createEl("option", { value: b.id, text: b.id === here ? `${b.label} (same as here)` : b.label });
    let biome = biomes.some((b) => b.id === here) ? here! : biomes[0].id;
    select.value = biome;
    const roll = row.createEl("button", { text: "Roll", attr: { title: "Roll a biome from a new seed (a different one from here, if there is one)" } });

    const reroll = row.createEl("button", { text: "Re-roll terrain", attr: { title: "Same biome, new seed" } });
    // The seed itself is a Debug control (placed after the buttons, below).
    const seedRow = createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    const seedInput = seedRow.createEl("input", { type: "number", cls: "duckmage-walk-seed", attr: { "aria-label": "Seed" } });
    seedInput.value = String(this.seed);

    const note = contentEl.createEl("p", { cls: "duckmage-map-origin-desc" });
    const canvas = contentEl.createEl("canvas", { cls: "duckmage-region-gen-preview" });
    canvas.width = 360;
    canvas.height = 300;

    const nameRow = contentEl.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    nameRow.createSpan({ text: "Name", cls: "duckmage-map-origin-label" });
    const taken = (n: string) => plugin.settings.maps.some((m) => m.name === slugify(n));
    const nameInput = nameRow.createEl("input", {
      type: "text",
      attr: { placeholder: defaultRegionName(plugin.mapLabel(walk.overworld), px, py, plugin.mapStore.get(walk.overworld, hex)?.name, taken) },
    });

    const buttons = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const create = buttons.createEl("button", { text: "Create and go", cls: "mod-cta" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    contentEl.appendChild(seedRow);
    this.place("WalkOW.seed", seedRow);
    const lock = walkLock(plugin, this.fromMap, walk.overworld);
    const locked = !!lock;
    if (lock) {
      lockButton(create, lock);
      contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    }

    const labelOf = (id: string) => biomeInfo(id)?.label ?? id;
    let rolled = "";
    let token = 0;
    const refresh = () => {
      const mine = ++token;
      const opts = { seed: this.seed, hexTerrain: representativeTerrain(biome, owPalette), biome };
      void planRegionWithGenerator(plugin, walk.overworld, px, py, opts)
        .catch(() => planRegionAt(plugin, walk.overworld, px, py, opts))
        .then((plan) => { if (mine === token) show(plan); });
    };
    const show = (plan: ReturnType<typeof planRegionAt>) => {
      drawRegionPlan(canvas, plugin, walk.overworld, px, py, plan);
      // The biomes it blends from: the field's, plus the one walked from.
      const fromIds = new Set((plan?.biome?.from ?? []).filter((b) => b !== biome));
      if (here && here !== biome) fromIds.add(here);
      const from = [...fromIds].map(labelOf);
      note.setText(
        (rolled ? `${rolled} ` : "")
        + (from.length ? `Border country: ${from.join(" + ")} turning into ${labelOf(biome)}.` : `${labelOf(biome)} carries on from here.`),
      );
    };
    select.addEventListener("change", () => {
      biome = select.value;
      rolled = "";
      refresh();
    });
    roll.addEventListener("click", () => {
      this.seed = randomSeed();
      seedInput.value = String(this.seed);
      // A roll never lands on a blank biome (pick it by hand).
      biome = rollBiome(biomes.filter((b) => b.terrain).map((b) => b.id), this.seed, here) ?? biome;
      select.value = biome;
      rolled = `Rolled ${labelOf(biome)} (seed ${this.seed}).`;
      refresh();
    });
    reroll.addEventListener("click", () => {
      this.seed = randomSeed();
      seedInput.value = String(this.seed);
      rolled = "";
      refresh();
    });
    seedInput.addEventListener("change", () => {
      const n = Number(seedInput.value);
      if (!Number.isFinite(n)) return;
      this.seed = Math.trunc(n) >>> 0;
      rolled = "";
      refresh();
    });
    create.addEventListener("click", () => {
      if (locked) return;
      create.disabled = true;
      create.setText("Creating…");
      void walkIntoHex(plugin, walk.overworld, px, py, biome, { seed: this.seed, name: nameInput.value.trim() || undefined, from: this.fromMap }).then((r) => {
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

  private render(generators: GeneratorFile[]): void {
    const { contentEl } = this;
    contentEl.empty();
    const from = this.plugin.getMap(this.fromMap);
    if (!from) return;
    const palette = this.plugin.getPaletteByName(from.paletteName)?.terrains.map((t) => t.name) ?? [];
    const here = regionBiome(this.plugin, this.fromMap, generators);
    // Biomes that fit this map's palette; generators tagged for one place
    // only (Space: map-kind planet) only from a map made by one of them.
    const hereTag = generators.find((g) => g.model.name === here?.name)?.model.meta["map-kind"];
    const biomes = generators.filter((g) => {
      const tag = g.model.meta["map-kind"];
      return generatorFitsPalette(g.model, palette) && (!isContextOnlyTag(tag) || tag === hereTag);
    });
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
    const locked = !canAdd(from);
    if (locked) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: ADD_REGION_LOCKED_HINT });

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
      create.disabled = !preview.ok || locked;
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
        undefined, preview.paths, pathColors(this.plugin, region.paletteName), 360, 12,
      );
    };
    select.addEventListener("change", refresh);
    roll.addEventListener("click", () => {
      // A new seed rolls the biome (repeatably) and the terrain.
      this.seed = randomSeed();
      select.value = rollBiome(biomes.map((g) => g.model.name), this.seed, here?.name) ?? select.value;
      refresh();
    });
    reroll.addEventListener("click", () => {
      this.seed = randomSeed();
      refresh();
    });
    create.addEventListener("click", () => {
      if (!plan || locked) return;
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

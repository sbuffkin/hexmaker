/**
 * Making an overworld (plan-overworld-regions §4.4, §5.4; phase 3):
 *
 * - NewOverworldModal: a new map laid out by World biomes (a hex's terrain
 *   is its biome), rectangular or hex-shaped, with its region settings,
 *   previewed the way the overworld preview page draws its minimap, and
 *   optionally every region made straight away.
 * - GenerateRegionsModal: "Make the missing regions": one per painted hex
 *   that has none, centre-out, with progress and a Stop button.
 */

import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { hexDistance } from "../../packages/hex-wfc/src/grid";
import { biomeInfo } from "../overworld/biomes";
import { drawMiniOverworld, miniLayout, type MiniHex } from "../overworld/overworldRender";
import { formatBiomeRiver, withMeshFields } from "../overworld/regionWorld";
import { generateMissingRegions } from "../overworld/regionsVault";
import { worldBiomes, type Climate, type LandShape, type NorthIs, type WorldBiomesResult } from "../overworld/worldBiomes";
import { RECT_SIDES } from "../maps/submaps";
import { newWorldId } from "../worldgen/world";
import { isSpacePalette } from "../mapKinds";
import { ecotoneHexes } from "../overworld/regionWorld";

export class GenerateRegionsModal extends HexmakerModal {
  private stop = false;
  private running = false;

  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string, private onDone: () => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Make the missing regions");
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "One region per painted hex of this map that has none, starting in the middle. Each blends with the overworld around it and lines up with the regions already made.",
    });
    const status = contentEl.createEl("p", { cls: "duckmage-ow-progress", text: "Ready." });
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    const cancel = row.createEl("button", { text: "Cancel" });
    const go = row.createEl("button", { text: "Make them", cls: "mod-cta" });
    cancel.addEventListener("click", () => {
      if (this.running) { this.stop = true; cancel.setText("Stopping…"); } else this.close();
    });
    go.addEventListener("click", () => {
      go.disabled = true;
      cancel.setText("Stop");
      this.running = true;
      const t0 = performance.now();
      void generateMissingRegions(this.plugin, this.mapName, {
        cancelled: () => this.stop,
        onProgress: (done, total, name) => status.setText(`Made ${done} of ${total}${name ? `: ${this.plugin.mapLabel(name)}` : ""}`),
      }).then(({ made, errors }) => {
        this.running = false;
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        status.setText(`Made ${made.length} region${made.length === 1 ? "" : "s"} in ${secs} s.${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 3).join("; ")}` : ""}${this.stop ? " Stopped." : ""}`);
        cancel.setText("Close");
        this.onDone();
      });
    });
  }

  onClose(): void {
    this.stop = true;
    this.contentEl.empty();
  }
}

/** The hexes of an overworld shape: a rectangle, or a hex of radius r in its (2r+1)² box. */
export function overworldShapeCells(shape: "rect" | "hex", cols: number, rows: number, radius: number, plugin: HexmakerPlugin): { cols: number; rows: number; cells: [number, number][] } {
  if (shape === "rect") {
    const cells: [number, number][] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push([x, y]);
    return { cols, rows, cells };
  }
  const n = 2 * radius + 1;
  const o = plugin.settings.hexOrientation, s = plugin.settings.staggerOffset ?? "odd";
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (hexDistance([x, y], [radius, radius], o, s) <= radius) cells.push([x, y]);
  return { cols: n, rows: n, cells };
}

export class NewOverworldModal extends HexmakerModal {
  private name = "Overworld";
  private shape: "rect" | "hex" = "hex";
  private cols = 7;
  private rows = 6;
  private radius = 2;
  private palette = "";
  private climate: Climate = "varied";
  private water = 25;
  private land: LandShape = "one";
  private north: NorthIs = "colder";
  private seed = Math.floor(Math.random() * 1e6);
  private regionSize = 8;
  private blend: "narrow" | "normal" | "wide" = "normal";
  private makeAll = true;
  private result: WorldBiomesResult | null = null;
  private canvas!: HTMLCanvasElement;

  constructor(app: App, private plugin: HexmakerPlugin, private onCreated: (name: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("New overworld");
    this.modalEl.addClass("duckmage-new-overworld-modal");
    const world = this.plugin.settings.terrainPalettes.filter((p) => !isSpacePalette(p.terrains));
    this.palette = world[0]?.name ?? this.plugin.settings.terrainPalettes[0]?.name ?? "";
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "A map of biomes: each hex is one biome, and each opens into a region map that blends with its neighbours.",
    });
    const form = contentEl.createDiv({ cls: "duckmage-region-gen-form" });
    const field = (label: string) => {
      const row = form.createDiv({ cls: "duckmage-region-gen-row" });
      row.createSpan({ cls: "duckmage-region-gen-label", text: label });
      return row;
    };
    const nameIn = field("Name").createEl("input", { type: "text", value: this.name, attr: { "aria-label": "Name" } });
    nameIn.addEventListener("input", () => { this.name = nameIn.value; });

    const shapeRow = field("Shape");
    const shapeSel = shapeRow.createEl("select", { attr: { "aria-label": "Shape" } });
    shapeSel.createEl("option", { value: "hex", text: "Hex-shaped" });
    shapeSel.createEl("option", { value: "rect", text: "Rectangle" });
    shapeSel.value = this.shape;
    const sizeBox = shapeRow.createSpan({ cls: "duckmage-ow-shape-size" });
    const drawSize = () => {
      sizeBox.empty();
      if (this.shape === "hex") {
        const r = sizeBox.createEl("select", { attr: { "aria-label": "Hexes" } });
        for (const n of [1, 2, 3, 4, 5, 6, 8, 10]) r.createEl("option", { value: String(n), text: `${3 * n * n + 3 * n + 1} hexes` });
        r.value = String(this.radius);
        r.addEventListener("change", () => { this.radius = Number(r.value); this.regen(); });
      } else {
        const c = sizeBox.createEl("input", { type: "number", value: String(this.cols), attr: { min: "2", max: "60", "aria-label": "Columns" } });
        sizeBox.createSpan({ text: " × " });
        const rr = sizeBox.createEl("input", { type: "number", value: String(this.rows), attr: { min: "2", max: "60", "aria-label": "Rows" } });
        const upd = () => {
          this.cols = Math.max(2, Math.min(60, Math.round(Number(c.value) || 2)));
          this.rows = Math.max(2, Math.min(60, Math.round(Number(rr.value) || 2)));
          this.regen();
        };
        c.addEventListener("change", upd);
        rr.addEventListener("change", upd);
      }
    };
    shapeSel.addEventListener("change", () => { this.shape = shapeSel.value as "rect" | "hex"; drawSize(); this.regen(); });
    drawSize();

    const pal = field("Palette").createEl("select", { attr: { "aria-label": "Palette" } });
    for (const p of world) pal.createEl("option", { value: p.name, text: p.name });
    pal.value = this.palette;
    pal.addEventListener("change", () => { this.palette = pal.value; this.regen(); });

    const sel = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const s = field(label).createEl("select", { attr: { "aria-label": label } });
      for (const [v, t] of opts) s.createEl("option", { value: v, text: t });
      s.value = get();
      s.addEventListener("change", () => { set(s.value as T); this.regen(); });
    };
    sel<Climate>("Climate", [["varied", "Varied"], ["cold", "Cold"], ["temperate", "Temperate"], ["warm", "Warm"]], () => this.climate, (v) => { this.climate = v; });
    sel<LandShape>("Land", [["one", "One continent"], ["two", "Two"], ["islands", "Islands"]], () => this.land, (v) => { this.land = v; });
    sel<NorthIs>("North is", [["colder", "Colder"], ["warmer", "Warmer"], ["none", "No gradient"]], () => this.north, (v) => { this.north = v; });
    const waterRow = field("Water");
    const water = waterRow.createEl("input", { type: "range", attr: { min: "0", max: "60", step: "5", "aria-label": "Water" } });
    water.value = String(this.water);
    const wv = waterRow.createSpan({ text: `${this.water}%` });
    water.addEventListener("input", () => wv.setText(`${water.value}%`));
    water.addEventListener("change", () => { this.water = Number(water.value); this.regen(); });
    const seedRow = field("Seed");
    const seed = seedRow.createEl("input", { type: "number", value: String(this.seed), attr: { "aria-label": "Seed" } });
    seed.addEventListener("change", () => { this.seed = Number(seed.value) >>> 0; this.regen(); });
    seedRow.createEl("button", { text: "Reroll" }).addEventListener("click", () => {
      this.seed = Math.floor(Math.random() * 1e6);
      seed.value = String(this.seed);
      this.regen();
    });

    this.canvas = contentEl.createEl("canvas", { cls: "duckmage-ow-new-preview" });
    this.canvas.width = 420;
    this.canvas.height = 300;

    form.createEl("h4", { text: "Regions" });
    const regRow = field("Each hex opens into");
    const size = regRow.createEl("select", { attr: { "aria-label": "Region size" } });
    for (const n of RECT_SIDES) size.createEl("option", { value: String(n), text: `${n} × ${n} hexes` });
    size.value = String(this.regionSize);
    size.addEventListener("change", () => { this.regionSize = Number(size.value); });
    const blend = field("Blend").createEl("select", { attr: { "aria-label": "Blend" } });
    for (const b of ["narrow", "normal", "wide"]) blend.createEl("option", { value: b, text: b });
    blend.value = this.blend;
    blend.addEventListener("change", () => { this.blend = blend.value as typeof this.blend; });
    const allRow = form.createEl("label", { cls: "duckmage-region-gen-row" });
    const all = allRow.createEl("input", { type: "checkbox" });
    all.checked = this.makeAll;
    allRow.createSpan({ text: "Make every region now" });
    all.addEventListener("change", () => { this.makeAll = all.checked; });

    const status = contentEl.createEl("p", { cls: "duckmage-ow-progress" });
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const create = row.createEl("button", { text: "Create", cls: "mod-cta" });
    create.addEventListener("click", () => {
      create.disabled = true;
      void this.create(status).finally(() => { create.disabled = false; });
    });
    this.regen();
  }

  private terrains() {
    return this.plugin.getPaletteOrPresetTerrains(this.palette);
  }

  private regen(): void {
    const { cells } = overworldShapeCells(this.shape, this.cols, this.rows, this.radius, this.plugin);
    const o = this.plugin.settings.hexOrientation, s = this.plugin.settings.staggerOffset ?? "odd";
    // River: kept as biome data (a delta at its mouth), never a path (paths come later).
    this.result = worldBiomes(cells, o, s, this.terrains(), { seed: this.seed, climate: this.climate, water: this.water / 100, land: this.land, north: this.north });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const colour = new Map(this.terrains().map((t) => [t.name, t.color]));
    const eco = ecotoneHexes(this.result.biomes, o, s);
    const hexes: MiniHex[] = cells.map(([x, y]) => {
      const k = `${x}_${y}`;
      const b = this.result!.biomes.get(k);
      return { x, y, color: colour.get(this.result!.terrain.get(k) ?? "") ?? "#333", label: b ? biomeInfo(b)?.label : undefined, ecotone: eco.has(k) };
    });
    drawMiniOverworld(ctx, miniLayout(hexes, o, s, this.canvas.width, this.canvas.height), hexes, this.result.river);
  }

  private async create(status: HTMLElement): Promise<void> {
    if (!this.result) return;
    const { cols, rows } = overworldShapeCells(this.shape, this.cols, this.rows, this.radius, this.plugin);
    const stagger = this.plugin.settings.staggerOffset ?? "odd";
    status.setText("Creating the overworld…");
    const res = await this.plugin.createNewMap(this.name.trim() || "Overworld", cols, rows, this.palette, 0, 0, stagger, undefined, this.result.terrain, { quiet: true });
    if ("error" in res) { status.setText(res.error); return; }
    const map = this.plugin.getMap(res.name)!;
    map.regions = withMeshFields({ footprint: "rect", size: this.regionSize, blend: this.blend, palette: this.palette }, stagger, newWorldId);
    if (this.result.river.length > 1) map.biomeRiver = formatBiomeRiver(this.result.river);
    await this.plugin.saveSettings();
    if (this.makeAll) {
      const t0 = performance.now();
      const { made, errors } = await generateMissingRegions(this.plugin, res.name, {
        onProgress: (done, total) => status.setText(`Making regions: ${done} of ${total}…`),
      });
      new Notice(`Made ${made.length} regions in ${((performance.now() - t0) / 1000).toFixed(1)} s.${errors.length ? ` ${errors.length} failed.` : ""}`);
    }
    this.close();
    this.onCreated(res.name);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

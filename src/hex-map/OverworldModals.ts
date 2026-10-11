/**
 * Making an overworld (plan-overworld-regions §4.4, §5.4; phase 3):
 *
 * - NewOverworldModal: "Generate overworld", the first pass (#50): a biome
 *   pool laid out by World biomes (a hex's terrain is its biome, plus the
 *   Biome column for a user's biome), rectangular or hex-shaped, previewed
 *   the way the overworld preview page draws its minimap, then every
 *   region made. Also regenerates an existing overworld (God only).
 * - GenerateRegionsModal: "Make the missing regions": one per painted hex
 *   that has none, centre-out, with progress and a Stop button.
 */

import { App, Notice, setIcon } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { hexDistance } from "../../packages/hex-wfc/src/grid";
import { biomeInfo, biomeNoteOf } from "../overworld/biomes";
import { drawMiniOverworld, miniLayout, type MiniHex } from "../overworld/overworldRender";
import { formatBiomeRiver, withMeshFields } from "../overworld/regionWorld";
import { generateMissingRegions } from "../overworld/regionsVault";
import { parseUnclimated, UNCLIMATED_CHOICES, unclimatedText, type Climate, type LandShape, type NorthIs, type Unclimated, type WorldBiomesResult } from "../overworld/worldBiomes";
import { pickBlankHexes } from "../overworld/overworldPass";
import { RECT_SIDES } from "../maps/submaps";
import { newWorldId } from "../worldgen/world";
import { isSpacePalette } from "../mapKinds";
import { ecotoneHexes } from "../overworld/regionWorld";
import { ADD_REGION_LOCKED_HINT, canAdd, canReshape } from "../workMode";
import { ALL_BIOMES_POOL, type BiomePoolRow } from "../overworld/biomePool";
import {
  REGENERATE_LOCKED_HINT,
  layOutBiomes,
  listBiomePools,
  overworldCells,
  poolRowFor,
  regenerateOverworld,
  regionPass,
  resolvePool,
  saveBiomePool,
  writeOverworldBiomes,
  type PoolNote,
} from "../overworld/overworldGen";

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
    if (!canAdd(this.plugin.getMap(this.mapName))) {
      go.disabled = true;
      go.addClass("is-locked");
      go.setAttr("title", ADD_REGION_LOCKED_HINT);
      status.setText(ADD_REGION_LOCKED_HINT);
      status.addClass("duckmage-locked-hint");
    }
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

/**
 * "Generate overworld" (#50), the first pass: a biome pool laid out by
 * World biomes, previewed live, then every region made with its biome.
 * New (the "New overworld…" command): name, shape, size, palette and
 * region settings too. Regenerate (the map menu, `regenerate` = the map):
 * God only; locked hexes and their regions stay, the other regions are
 * remade in place.
 */
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
  /** BC2: what the pool's biomes without a climate do. */
  private unclimated: Unclimated = "fill";
  /** "Blank hexes": how many hexes become a blank biome, and which one. */
  private blankCount = 0;
  private blankBiome = "";
  private result: WorldBiomesResult | null = null;
  private canvas!: HTMLCanvasElement;
  /** The pool: its note (undefined = a new, unsaved one) and its rows as edited. */
  private pools: PoolNote[] = [];
  private poolPath: string | undefined;
  private poolRows: BiomePoolRow[] = [];
  private poolDirty = false;
  private poolBox!: HTMLDetailsElement;
  private poolNote!: HTMLElement;

  constructor(app: App, private plugin: HexmakerPlugin, private onCreated: (name: string) => void, private regenerate?: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const regen = this.regenerate ? this.plugin.getMap(this.regenerate) : undefined;
    this.titleEl.setText(regen ? `Generate overworld: ${this.plugin.mapLabel(regen.name)}` : "New overworld");
    this.modalEl.addClass("duckmage-new-overworld-modal");
    const world = this.plugin.settings.terrainPalettes.filter((p) => !isSpacePalette(p.terrains));
    this.palette = regen?.paletteName ?? world[0]?.name ?? this.plugin.settings.terrainPalettes[0]?.name ?? "";
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: regen
        ? "A first pass over the whole map: biomes from the pool, laid out by climate, then every region remade. Locked hexes and their regions stay as they are; region notes are never touched."
        : "A first pass: each hex is one biome from the pool, laid out by climate, and each opens into a region map that blends with its neighbours. Edit, reroll or swap any region afterwards.",
    });
    const form = contentEl.createDiv({ cls: "duckmage-region-gen-form" });
    const field = (label: string, parent: HTMLElement = form) => {
      const row = parent.createDiv({ cls: "duckmage-region-gen-row" });
      row.createSpan({ cls: "duckmage-region-gen-label", text: label });
      return row;
    };
    // The top: name, pool and what the pool's biomes without a climate do (BC2: hard to miss).
    const top = form.createDiv({ cls: "duckmage-ow-top" });
    const shapeBox = form.createDiv();
    if (regen) this.unclimated = parseUnclimated(regen.biomeGaps);
    if (!regen) {
      const nameIn = field("Name", top).createEl("input", { type: "text", value: this.name, attr: { "aria-label": "Name" } });
      nameIn.addEventListener("input", () => { this.name = nameIn.value; });

      const shapeRow = field("Shape", shapeBox);
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

      const pal = field("Palette", shapeBox).createEl("select", { attr: { "aria-label": "Palette" } });
      for (const p of world) pal.createEl("option", { value: p.name, text: p.name });
      pal.value = this.palette;
      pal.addEventListener("change", () => { this.palette = pal.value; this.regen(); });
    }

    // The pool.
    const poolRow = field("Biome pool", top);
    const poolSel = poolRow.createEl("select", { attr: { "aria-label": "Biome pool" } });
    const saveBtn = poolRow.createEl("button", { text: "Save", attr: { title: "Save the pool's biomes to its note" } });
    const saveAs = poolRow.createEl("button", { text: "Save as…", attr: { title: "Save as a new pool note" } });
    // BC2: biomes without a climate.
    const gapsRow = field("Biomes without a climate", top);
    gapsRow.addClass("duckmage-ow-gaps");
    const gaps = gapsRow.createEl("select", { attr: { "aria-label": "Biomes without a climate" } });
    for (const c of UNCLIMATED_CHOICES) gaps.createEl("option", { value: c.value, text: c.label });
    gaps.value = this.unclimated;
    const gapsNote = top.createEl("p", { cls: "setting-item-description" });
    const showGaps = () => gapsNote.setText(this.unclimated === "fill"
      ? "Pool biomes with no climate fill only the hexes no other pool biome fits."
      : "Pool biomes with no climate are never placed here: set them by hand with the Biome tool.");
    showGaps();
    gaps.addEventListener("change", () => { this.unclimated = gaps.value as Unclimated; showGaps(); this.drawPool(); this.regen(); });
    this.poolBox = top.createEl("details", { cls: "duckmage-ow-pool" });
    this.poolNote = top.createEl("p", { cls: "setting-item-description" });
    const fillPools = () => {
      poolSel.empty();
      for (const p of this.pools) poolSel.createEl("option", { value: p.path, text: p.name });
      if (this.poolPath === undefined) poolSel.createEl("option", { value: "", text: "Unsaved pool" });
      poolSel.value = this.poolPath ?? "";
      saveBtn.disabled = !this.poolDirty || this.poolPath === undefined;
    };
    const pickPool = (path: string | undefined) => {
      const p = this.pools.find((x) => x.path === path);
      this.poolPath = p?.path;
      this.poolRows = p ? p.rows.map((r) => ({ ...r })) : this.plugin.biomeStore.list().filter((b) => b.climate).map((b) => poolRowFor(this.plugin, b));
      this.poolDirty = false;
      fillPools();
      this.drawPool();
      this.regen();
    };
    poolSel.addEventListener("change", () => pickPool(poolSel.value || undefined));
    saveBtn.addEventListener("click", () => {
      if (!this.poolPath) return;
      void saveBiomePool(this.plugin, { path: this.poolPath }, this.poolRows).then((res) => {
        if ("error" in res) { new Notice(res.error); return; }
        this.poolDirty = false;
        fillPools();
        new Notice("Pool saved.");
      });
    });
    saveAs.addEventListener("click", () => {
      new PoolNameModal(this.app, (name) => {
        void saveBiomePool(this.plugin, { name }, this.poolRows).then(async (res) => {
          if ("error" in res) { new Notice(res.error); return; }
          this.pools = await listBiomePools(this.plugin);
          this.poolPath = res.path;
          this.poolDirty = false;
          fillPools();
        });
      }).open();
    });
    this.onPoolChanged = () => { this.poolDirty = true; fillPools(); };
    void listBiomePools(this.plugin).then((pools) => {
      this.pools = pools;
      const want = regen?.biomePool && pools.some((p) => p.path === regen.biomePool) ? regen.biomePool : pools.find((p) => p.name === ALL_BIOMES_POOL)?.path ?? pools[0]?.path;
      pickPool(want);
    });

    // World biomes knobs.
    const knobs = form.createDiv({ cls: "duckmage-biome-mix-grid" });
    const sel = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const s = field(label, knobs).createEl("select", { attr: { "aria-label": label } });
      for (const [v, t] of opts) s.createEl("option", { value: v, text: t });
      s.value = get();
      s.addEventListener("change", () => { set(s.value as T); this.regen(); });
    };
    sel<Climate>("Climate", [["varied", "Varied"], ["cold", "Cold"], ["temperate", "Temperate"], ["warm", "Warm"]], () => this.climate, (v) => { this.climate = v; });
    sel<LandShape>("Land", [["one", "One continent"], ["two", "Two"], ["islands", "Islands"]], () => this.land, (v) => { this.land = v; });
    sel<NorthIs>("North is", [["colder", "Colder"], ["warmer", "Warmer"], ["none", "No gradient"]], () => this.north, (v) => { this.north = v; });
    const waterRow = field("Water", knobs);
    const water = waterRow.createEl("input", { type: "range", attr: { min: "0", max: "60", step: "5", "aria-label": "Water" } });
    water.value = String(this.water);
    const wv = waterRow.createSpan({ text: `${this.water}%` });
    water.addEventListener("input", () => wv.setText(`${water.value}%`));
    water.addEventListener("change", () => { this.water = Number(water.value); this.regen(); });
    // Blank hexes (new overworlds): blank-biome hexes, regions painted by hand.
    if (!regen) {
      const blanks = this.plugin.biomeStore.list().filter((b) => b.blank);
      const blankRow = field("Blank hexes");
      const count = blankRow.createEl("input", { type: "number", value: String(this.blankCount), attr: { min: "0", step: "1", "aria-label": "Blank hexes", title: "Hexes left blank (a blank biome): their regions start empty, to paint by hand" } });
      this.blankBiome = blanks[0]?.id ?? "";
      if (blanks.length > 1) {
        const which = blankRow.createEl("select", { attr: { "aria-label": "Blank biome" } });
        for (const b of blanks) which.createEl("option", { value: b.id, text: b.label });
        which.addEventListener("change", () => { this.blankBiome = which.value; this.regen(); });
      }
      if (!blanks.length) {
        count.disabled = true;
        blankRow.createSpan({ cls: "setting-item-description", text: "No blank biome: tick 'Regions start blank' on one in Biomes…" });
      }
      count.addEventListener("change", () => {
        this.blankCount = Math.max(0, Math.round(Number(count.value) || 0));
        count.value = String(this.blankCount);
        this.regen();
      });
    }
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

    if (!regen) {
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
    }
    const allRow = form.createEl("label", { cls: "duckmage-region-gen-row" });
    const all = allRow.createEl("input", { type: "checkbox" });
    all.checked = this.makeAll;
    allRow.createSpan({ text: regen ? "Remake the regions too" : "Make every region now" });
    all.addEventListener("change", () => { this.makeAll = all.checked; });

    const status = contentEl.createEl("p", { cls: "duckmage-ow-progress" });
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const create = row.createEl("button", { text: regen ? "Regenerate" : "Create", cls: "mod-cta" });
    if (regen && !canReshape(regen)) {
      create.disabled = true;
      create.addClass("is-locked");
      create.setAttr("title", REGENERATE_LOCKED_HINT);
      status.setText(REGENERATE_LOCKED_HINT);
      status.addClass("duckmage-locked-hint");
    }
    create.addEventListener("click", () => {
      create.disabled = true;
      void (regen ? this.regenerateMap(status) : this.create(status)).finally(() => { create.disabled = false; });
    });
    this.regen();
  }

  private onPoolChanged = (): void => {};

  /** The pool's biomes: each row with its weight and remove button, then "Add". */
  private drawPool(): void {
    const box = this.poolBox;
    const wasOpen = box.open;
    box.empty();
    const { biomes, unknown } = resolvePool(this.plugin, this.poolRows);
    box.createEl("summary", { text: `Biomes in the pool (${biomes.length})` });
    const list = box.createDiv({ cls: "duckmage-ow-pool-list" });
    this.poolRows.forEach((r, i) => {
      const b = this.plugin.biomeStore.get(r.biome) ?? this.plugin.biomeStore.get(r.biome.slice(r.biome.lastIndexOf("/") + 1));
      const item = list.createDiv({ cls: "duckmage-ow-pool-item" });
      if (b?.color) item.createSpan({ cls: "duckmage-ow-pool-swatch" }).setCssProps({ "--duckmage-swatch": b.color });
      item.createSpan({ cls: "duckmage-ow-pool-name", text: b?.label ?? `${r.biome} (no such biome)` });
      const tags: string[] = [];
      if (b && !b.climate) tags.push(this.unclimated === "fill" ? "fills gaps" : "by hand only");
      if (b?.generator) tags.push("generator");
      if (tags.length) item.createSpan({ cls: "duckmage-ow-pool-tag", text: tags.join(", "), attr: { title: b && !b.climate ? (this.unclimated === "fill" ? "No climate: only placed where no other biome in the pool fits." : "No climate: never placed by the generator (see Biomes without a climate).") : "Its regions are made by its generator, joined to their neighbours." } });
      const w = item.createEl("input", { type: "number", cls: "duckmage-biome-weight", attr: { min: "0", step: "0.5", placeholder: "1", "aria-label": `${b?.label ?? r.biome} weight`, title: "Weight: how often it's chosen where it fits (1 = as its note says)" } });
      w.value = r.weight !== undefined ? String(r.weight) : "";
      w.addEventListener("change", () => {
        const v = Number(w.value);
        if (w.value.trim() === "" || !Number.isFinite(v) || v < 0) delete r.weight; else r.weight = v;
        this.onPoolChanged();
        this.regen();
      });
      const rm = item.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Remove ${b?.label ?? r.biome}` } });
      setIcon(rm, "x");
      rm.addEventListener("click", () => {
        this.poolRows.splice(i, 1);
        this.onPoolChanged();
        this.drawPool();
        this.regen();
      });
    });
    const addRow = box.createDiv({ cls: "duckmage-region-gen-row" });
    const inPool = new Set(biomes.map((b) => b.id));
    const add = addRow.createEl("select", { attr: { "aria-label": "Add a biome" } });
    add.createEl("option", { value: "", text: "Add a biome…" });
    for (const b of this.plugin.biomeStore.list()) {
      if (inPool.has(b.id) || b.blank) continue;
      add.createEl("option", { value: b.id, text: `${b.label}${b.generator ? " (generator)" : ""}${b.climate ? "" : " (no climate)"}` });
    }
    add.addEventListener("change", () => {
      const b = this.plugin.biomeStore.get(add.value);
      if (!b) return;
      this.poolRows.push(poolRowFor(this.plugin, b));
      this.onPoolChanged();
      this.drawPool();
      this.regen();
    });
    box.open = wasOpen;
    const placeable = biomes.filter((b) => b.climate).length;
    this.poolNote.setText([
      unknown.length ? `Not found: ${unknown.join(", ")}.` : "",
      placeable ? "" : "No biome in this pool has a climate: add one, or give one a climate in its biome note.",
    ].filter(Boolean).join(" "));
  }

  private terrains() {
    if (this.regenerate) return this.plugin.getMapPalette(this.regenerate);
    return this.plugin.getPaletteOrPresetTerrains(this.palette);
  }

  private cells(): [number, number][] {
    if (this.regenerate) return overworldCells(this.plugin, this.regenerate);
    return overworldShapeCells(this.shape, this.cols, this.rows, this.radius, this.plugin).cells;
  }

  private poolBiomes() {
    return resolvePool(this.plugin, this.poolRows).biomes;
  }

  private regen(): void {
    if (!this.canvas) return;
    const cells = this.cells();
    const o = this.plugin.settings.hexOrientation;
    const s = (this.regenerate ? this.plugin.getMap(this.regenerate)?.staggerOffset : undefined) ?? this.plugin.settings.staggerOffset ?? "odd";
    // River: kept as biome data (a delta at its mouth), never a path (paths come later).
    this.result = layOutBiomes(this.plugin, cells, this.terrains(), { seed: this.seed, climate: this.climate, water: this.water / 100, land: this.land, north: this.north, unclimated: this.unclimated }, this.poolBiomes(), s);
    // Blank hexes: a blank biome, no terrain (painted by hand later).
    if (!this.regenerate && this.blankCount > 0 && this.blankBiome && this.result.biomes.size) {
      for (const k of pickBlankHexes([...this.result.biomes.keys()], this.result.sea, this.blankCount, this.seed, o, s)) {
        this.result.biomes.set(k, this.blankBiome);
        this.result.terrain.delete(k);
      }
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const colour = new Map(this.terrains().map((t) => [t.name, t.color]));
    const eco = ecotoneHexes(this.result.biomes, o, s);
    const locked = (k: string) => (this.regenerate ? this.plugin.mapStore.get(this.regenerate, k)?.locked : false);
    const hexes: MiniHex[] = cells.map(([x, y]) => {
      const k = `${x}_${y}`;
      if (locked(k)) {
        const t = this.plugin.mapStore.get(this.regenerate!, k)?.terrain;
        return { x, y, color: colour.get(t ?? "") ?? "#333", label: "locked" };
      }
      const b = this.result!.biomes.get(k);
      const t = this.result!.terrain.get(k);
      return { x, y, color: (t ? colour.get(t) : b ? biomeNoteOf(b)?.color : undefined) ?? "#333", label: b ? biomeInfo(b)?.label : undefined, ecotone: eco.has(k) };
    });
    drawMiniOverworld(ctx, miniLayout(hexes, o, s, this.canvas.width, this.canvas.height), hexes, this.result.river);
  }

  private async create(status: HTMLElement): Promise<void> {
    if (!this.result) return;
    if (!this.result.biomes.size) { status.setText("No biome in this pool can be placed: give some a climate."); return; }
    const { cols, rows } = overworldShapeCells(this.shape, this.cols, this.rows, this.radius, this.plugin);
    const stagger = this.plugin.settings.staggerOffset ?? "odd";
    status.setText("Creating the overworld…");
    const res = await this.plugin.createNewMap(this.name.trim() || "Overworld", cols, rows, this.palette, 0, 0, stagger, undefined, this.result.terrain, { quiet: true });
    if ("error" in res) { status.setText(res.error); return; }
    const map = this.plugin.getMap(res.name)!;
    map.regions = withMeshFields({ footprint: "rect", size: this.regionSize, blend: this.blend, palette: this.palette }, stagger, newWorldId);
    if (this.result.river.length > 1) map.biomeRiver = formatBiomeRiver(this.result.river);
    if (this.poolPath) map.biomePool = this.poolPath;
    map.biomeGaps = unclimatedText(this.unclimated);
    await this.plugin.saveSettings();
    // Every hex's biome goes in the Biome column (BC1); blank hexes get no terrain.
    await writeOverworldBiomes(this.plugin, res.name, this.result);
    if (this.makeAll) {
      const t0 = performance.now();
      const r = await regionPass(this.plugin, res.name, this.cells(), {
        remake: false,
        onProgress: (done, total) => status.setText(`Making regions: ${done} of ${total}…`),
      });
      new Notice(`Made ${r.made.length} regions in ${((performance.now() - t0) / 1000).toFixed(1)} s.${r.errors.length ? ` ${r.errors.length} failed.` : ""}`);
    }
    this.close();
    this.onCreated(res.name);
  }

  private async regenerateMap(status: HTMLElement): Promise<void> {
    const name = this.regenerate!;
    status.setText("Regenerating…");
    const t0 = performance.now();
    const res = await regenerateOverworld(this.plugin, name, {
      seed: this.seed, climate: this.climate, water: this.water / 100, land: this.land, north: this.north,
      pool: this.poolBiomes(), poolPath: this.poolPath, regions: this.makeAll, unclimated: this.unclimated,
    }, { onProgress: (done, total) => status.setText(`Regions: ${done} of ${total}…`) });
    if ("error" in res) { status.setText(res.error); return; }
    new Notice(`Overworld regenerated in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${res.written} hexes, ${res.kept} locked kept, ${res.made} regions made, ${res.remade} remade.${res.errors.length ? ` ${res.errors.length} failed.` : ""}`);
    this.close();
    this.onCreated(name);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Name for a new biome pool. */
class PoolNameModal extends HexmakerModal {
  constructor(app: App, private onName: (name: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Save pool as");
    const input = this.contentEl.createEl("input", { type: "text", attr: { "aria-label": "Pool name", placeholder: "Cold north" } });
    const row = this.contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const ok = row.createEl("button", { text: "Save", cls: "mod-cta" });
    const go = () => {
      if (!input.value.trim()) return;
      this.onName(input.value.trim());
      this.close();
    };
    ok.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

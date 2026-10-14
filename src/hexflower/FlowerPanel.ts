/**
 * The generator page's "Hex flowers" tab (plan-hex-flower, phase 5): the
 * list of hex flower notes, and the editor for the one picked.
 *
 * Above the fold: name, palette, the clickable flower (paint a cell with
 * the picked terrain; right-click for Start here, Other result…, nothing,
 * blocked; each cell shows how often a long walk stands on it), Fill from
 * palette, Use on this map, and Test walk (a blank preview filled step by
 * step with the same code as the map). Below: the Moves table, edges, the
 * cell shares (the shared share sliders). Advanced: dice, walk length,
 * seed. Debug: what the note has that can't be read, and the odds matrix.
 *
 * Every change saves to the note at once (patching only its tables and keys).
 */

import { Menu, Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { GeneratorPageHost } from "../modules/types";
import { Disclosure, Fold } from "../ui/disclosure";
import { renderShareSliders } from "../ui/shareSliders";
import { renderLabeledSlider } from "../ui/sliders";
import { emptyState } from "../ui/pickers";
import { drawPreview } from "../worldgen/preview";
import { mulberry32, randomSeed } from "../../packages/hex-wfc/src/rng";
import { hexNeighbors } from "../hex-map/hexGeometry";
import {
  BLOCKED,
  CELL_COUNT,
  DEFAULT_DICE,
  DIRS,
  NOTHING,
  emptyFlower,
  isBlocked,
  longRunOdds,
  parseDice,
  transitionMatrix,
  type Flower,
  type Move,
} from "./flower";
import { fillFromPalette, fillFromShares, sharesOf } from "./fromPalette";
import { rangeText, parseRange } from "./flowerNote";
import { flowerStoreOf, terrainColors } from "./context";
import { drawFlower } from "./flowerView";
import { formatRule, planStep, readRules } from "./explore";
import type { FlowerEntry } from "./FlowerStore";
import type { ExploreMap } from "./exploreFields";

/** Page state kept across re-renders. */
const state = {
  selected: "",
  paint: "",
  seed: randomSeed(),
  walkLength: 20,
};

const pct = (p: number) => (p >= 0.995 ? "100%" : p < 0.005 && p > 0 ? "<1%" : `${Math.round(p * 100)}%`);

// ── the list ─────────────────────────────────────────────────────────────

export function drawFlowerList(plugin: HexmakerPlugin, list: HTMLElement, actions: HTMLElement, ctx: { query: string; redraw(): void; host: GeneratorPageHost }): void {
  const store = flowerStoreOf(plugin);
  const q = ctx.query.trim().toLowerCase();
  const rows = (store?.list() ?? []).filter((e) => !q || e.flower.name.toLowerCase().includes(q) || (e.flower.palette ?? "").toLowerCase().includes(q));
  const table = list.createDiv({ cls: "duckmage-wfc-library-table is-flowers" });
  const head = table.createDiv({ cls: "duckmage-wfc-library-row is-head" });
  for (const t of ["Name", "Palette", "Results"]) head.createSpan({ text: t });
  for (const e of rows) {
    const row = table.createDiv({ cls: "duckmage-wfc-library-row" });
    if (e.path === state.selected) row.addClass("is-current");
    const results = sharesOf(e.flower.cells).map((s) => s.terrain);
    for (const v of [e.flower.name, e.flower.palette ?? "–", results.join(", ") || "–"]) row.createSpan({ text: v, attr: { title: v } });
    row.setAttr("title", "Click to edit");
    row.addEventListener("click", () => { state.selected = e.path; ctx.redraw(); ctx.host.show(); });
  }
  if (!rows.length) emptyState(list, store?.list().length ? "No hex flowers match." : "No hex flowers yet. Make one from your palette.");
  const make = actions.createEl("button", { text: "New hex flower", cls: "mod-cta", attr: { title: "A new hex flower from this page's palette" } });
  make.addEventListener("click", () => void newFlower(plugin, ctx.host.paletteName()).then((path) => {
    if (path) { state.selected = path; ctx.redraw(); ctx.host.show(); }
  }));
  const open = actions.createEl("button", { text: "Open note" });
  open.disabled = !store?.get(state.selected);
  open.addEventListener("click", () => {
    const f = plugin.app.vault.getAbstractFileByPath(state.selected);
    if (f instanceof TFile) void plugin.app.workspace.getLeaf("tab").openFile(f);
  });
}

/** A new flower from `palette`'s terrains (Fill from palette); returns its note's path. */
export async function newFlower(plugin: HexmakerPlugin, palette: string, name = "Hex flower"): Promise<string | undefined> {
  const store = flowerStoreOf(plugin);
  if (!store) return undefined;
  const f = emptyFlower(name, palette);
  const terrains = plugin.getPaletteOrPresetTerrains(palette).map((t) => t.name);
  f.cells = fillFromPalette(terrains, randomSeed());
  return store.create(f);
}

// ── the editor ───────────────────────────────────────────────────────────

export function renderFlowerPanel(plugin: HexmakerPlugin, main: HTMLElement, side: HTMLElement, host: GeneratorPageHost): void {
  const store = flowerStoreOf(plugin);
  const entry = store?.get(state.selected) ?? store?.list()[0];
  main.addClass("duckmage-flower-panel");
  main.createEl("h4", { text: "Hex flowers" });
  main.createEl("p", {
    cls: "duckmage-map-origin-desc",
    text: "A hex flower fills a map as the party explores: each blank hex they walk into rolls the dice, moves on the flower and takes the cell it lands on. Make one from your palette, then add it to a map.",
  });
  if (!store || !entry) {
    emptyState(main, "No hex flower picked. Make one with New hex flower above.");
    return;
  }
  state.selected = entry.path;
  new FlowerEditor(plugin, entry, host).render(main, side);
}

class FlowerEditor {
  private flower: Flower;
  private saveTimer: number | null = null;
  private walk: { cells: Map<string, string>; party: string; log: string[]; at: Map<string, number>; step: number } | null = null;

  constructor(private plugin: HexmakerPlugin, private entry: FlowerEntry, private host: GeneratorPageHost) {
    this.flower = structuredClone(entry.flower);
  }

  private get terrains(): { name: string; color: string }[] {
    return this.plugin.getPaletteOrPresetTerrains(this.flower.palette ?? this.host.paletteName());
  }

  private save(redraw = true): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void flowerStoreOf(this.plugin)?.save(this.entry.path, this.flower);
    }, 250);
    if (redraw) this.redraw?.();
  }

  private redraw?: () => void;

  render(main: HTMLElement, side: HTMLElement): void {
    const disclosure = new Disclosure(this.plugin.app, "FlowerPage", () => main);
    const top = main.createDiv();
    const below = main.createDiv();
    const draw = () => {
      top.empty();
      side.empty();
      this.renderTop(top, side);
    };
    this.redraw = draw;
    draw();
    this.renderBelow(below, disclosure);
  }

  // ── above the fold ─────────────────────────────────────────────────────

  private renderTop(el: HTMLElement, side: HTMLElement): void {
    const f = this.flower;
    // Name (the note's name) and palette.
    const row = el.createDiv({ cls: "duckmage-region-row" });
    row.createSpan({ text: "Name" });
    const name = row.createEl("input", { type: "text", value: f.name, attr: { "aria-label": "Hex flower name" } });
    name.addEventListener("change", () => void this.rename(name.value));
    row.createSpan({ text: "Palette" });
    const pal = row.createEl("select", { attr: { "aria-label": "Palette" } });
    for (const p of this.plugin.settings.terrainPalettes) pal.createEl("option", { text: p.name, value: p.name });
    pal.value = f.palette ?? this.host.paletteName();
    pal.addEventListener("change", () => { f.palette = pal.value; this.save(); });

    // Paint swatches: the palette's terrains, plus nothing and blocked.
    const colors = terrainColors(this.plugin, f.palette ?? this.host.paletteName());
    const sw = el.createDiv({ cls: "duckmage-flower-swatches", attr: { role: "radiogroup", "aria-label": "Paint cells with" } });
    if (!state.paint) state.paint = this.terrains[0]?.name ?? NOTHING;
    for (const t of [...this.terrains.map((x) => x.name), NOTHING, BLOCKED]) {
      const b = sw.createEl("button", { cls: `duckmage-flower-swatch${state.paint === t ? " is-active" : ""}`, attr: { role: "radio", "aria-checked": String(state.paint === t) } });
      const dot = b.createSpan({ cls: "duckmage-flower-swatch-dot" });
      const c = colors.get(t.toLowerCase());
      if (c) dot.setCssProps({ "--duckmage-flower-color": c });
      b.createSpan({ text: t.replace(/^\(|\)$/g, "") });
      b.addEventListener("click", () => { state.paint = t; this.redraw?.(); });
    }

    // The flower: click paints, right-click for the rest; long-run share under each cell.
    const odds = longRunOdds(f, 600);
    drawFlower(el, f, {
      colors,
      current: this.walk ? this.walk.at.get(f.name.toLowerCase()) : undefined,
      under: (n) => (isBlocked(f.cells[n - 1].result) ? undefined : pct(odds[n - 1])),
      onClick: (n) => { f.cells[n - 1] = { result: state.paint, ...(f.cells[n - 1].notes ? { notes: f.cells[n - 1].notes } : {}) }; this.save(); },
      onContext: (n, e) => this.cellMenu(el, n, e),
    });
    el.createDiv({ cls: "duckmage-map-origin-desc", text: "Under each cell: how often a long walk stands there. Underlined: where a walk starts." });

    const actions = el.createDiv({ cls: "duckmage-flower-actions" });
    const fill = actions.createEl("button", { text: "Fill from palette", attr: { title: "New cells from this palette's terrains, as patches (blocked cells stay)" } });
    fill.addEventListener("click", () => {
      state.seed = randomSeed();
      f.cells = fillFromPalette(this.terrains.map((t) => t.name), state.seed, f.cells, f.start);
      this.save();
    });
    const use = actions.createEl("button", { text: "Use on this map", cls: "mod-cta", attr: { title: "The page's map fills its blank hexes from this flower as the party explores" } });
    use.addEventListener("click", () => this.useOnMap());

    this.renderWalk(side, colors);
  }

  private cellMenu(el: HTMLElement, n: number, e: MouseEvent): void {
    const f = this.flower;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Start here").setIcon("flag").onClick(() => { f.start = n; this.save(); }));
    menu.addItem((i) => i.setTitle("Other result…").setIcon("pencil").onClick(() => this.otherResult(el, n)));
    menu.addItem((i) => i.setTitle("Nothing").setIcon("circle-off").onClick(() => { f.cells[n - 1] = { result: NOTHING }; this.save(); }));
    menu.addItem((i) => i.setTitle("Blocked").setIcon("ban").onClick(() => { f.cells[n - 1] = { result: BLOCKED }; this.save(); }));
    menu.showAtMouseEvent(e);
  }

  /** "Other result…": any text, [[note]] or [[table]], typed under the flower. */
  private otherResult(el: HTMLElement, n: number): void {
    el.querySelector(".duckmage-flower-other")?.remove();
    const row = el.createDiv({ cls: "duckmage-region-row duckmage-flower-other" });
    row.createSpan({ text: `Cell ${n}` });
    const input = row.createEl("input", { type: "text", value: this.flower.cells[n - 1].result, attr: { placeholder: "Text, [[note]] or [[table]]", "aria-label": `Cell ${n} result` } });
    const ok = row.createEl("button", { text: "Set" });
    const set = () => { this.flower.cells[n - 1] = { ...this.flower.cells[n - 1], result: input.value.trim() || NOTHING }; this.save(); };
    ok.addEventListener("click", set);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") set(); });
    input.focus();
  }

  private async rename(raw: string): Promise<void> {
    const name = raw.trim();
    const file = this.plugin.app.vault.getAbstractFileByPath(this.entry.path);
    if (!name || !(file instanceof TFile) || name === file.basename) return;
    const store = flowerStoreOf(this.plugin);
    if (store?.get(name)) { new Notice(`There's a hex flower called ${name} already.`); return; }
    const path = `${file.parent?.path ? `${file.parent.path}/` : ""}${name}.md`;
    await this.plugin.app.fileManager.renameFile(file, path);
    state.selected = path;
    this.host.rerender();
  }

  /** Add `[[flower]] -> terrain` to the page's map's explore-with (first rule wins: it goes first). */
  private useOnMap(): void {
    const mapName = this.host.mapName();
    const map: ExploreMap | undefined = this.plugin.getMap(mapName);
    if (!map) { new Notice("Pick a map on this page first."); return; }
    const link = this.entry.path.replace(/\.md$/i, "");
    const rules = map.exploreWith ?? [];
    if (readRules(rules).some((r) => r.source.toLowerCase() === link.toLowerCase() || r.source.toLowerCase() === this.flower.name.toLowerCase())) {
      new Notice(`${this.plugin.mapLabel(mapName)} explores with ${this.flower.name} already.`);
      return;
    }
    map.exploreWith = [formatRule({ source: link, target: { kind: "terrain" }, every: false }), ...rules];
    void this.plugin.saveSettings();
    new Notice(`${this.plugin.mapLabel(mapName)} now fills its blank hexes from ${this.flower.name} as the party explores.`);
  }

  // ── test walk ──────────────────────────────────────────────────────────

  private renderWalk(side: HTMLElement, colors: Map<string, string>): void {
    side.createEl("h4", { text: "Test walk" });
    side.createEl("p", { cls: "duckmage-map-origin-desc", text: "A blank map the party crosses at random; each new hex is filled the way a map fills." });
    const canvas = side.createEl("canvas");
    const btns = side.createDiv({ cls: "duckmage-flower-actions" });
    const log = side.createDiv({ cls: "duckmage-flower-walk-log" });
    const COLS = 11, ROWS = 9;
    const grid = { cols: COLS, rows: ROWS, offset: { x: 0, y: 0 }, stagger: "odd" as const };
    const show = () => {
      const w = this.walk;
      const byName = new Map<string, string>([...colors].map(([k, v]) => [this.terrains.find((t) => t.name.toLowerCase() === k)?.name ?? k, v]));
      drawPreview(canvas, w?.cells ?? new Map<string, string>(), grid, this.plugin.settings.hexOrientation, byName, w ? new Set([w.party]) : undefined, [], new Map<string, string>(), 300, 16);
      log.setText(w ? w.log.slice(-20).join("\n") : "Step to start.");
    };
    const step = (n: number) => {
      if (!this.walk) this.resetWalk(COLS, ROWS);
      for (let i = 0; i < n; i++) this.stepWalk(COLS, ROWS);
      this.redraw?.();
    };
    btns.createEl("button", { text: "Step" }).addEventListener("click", () => step(1));
    btns.createEl("button", { text: `Walk ${state.walkLength}` }).addEventListener("click", () => step(state.walkLength));
    btns.createEl("button", { text: "Start over" }).addEventListener("click", () => { this.walk = null; this.redraw?.(); });
    show();
  }

  private resetWalk(cols: number, rows: number): void {
    const start = `${Math.floor(cols / 2)}_${Math.floor(rows / 2)}`;
    this.walk = { cells: new Map(), party: start, log: [], at: new Map(), step: 0 };
    this.fillHex(start, undefined);
  }

  /** One step of the party in a random direction (seeded), filling the hex it enters if blank. */
  private stepWalk(cols: number, rows: number): void {
    const w = this.walk!;
    const rand = mulberry32((state.seed ^ (w.step * 7919)) >>> 0);
    const [x, y] = w.party.split("_").map(Number);
    const near = hexNeighbors(x, y, this.plugin.settings.hexOrientation, "odd").filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cols && ny < rows);
    const [nx, ny] = near[Math.floor(rand() * near.length)];
    const to = `${nx}_${ny}`;
    w.step++;
    if (!w.cells.has(to)) this.fillHex(to, w.party);
    w.party = to;
  }

  private fillHex(hex: string, from: string | undefined): void {
    const w = this.walk!;
    const f = this.flower;
    const plan = planStep({
      rules: readRules([formatRule({ source: f.name, target: { kind: "terrain" }, every: false })]),
      hex,
      from,
      fromTerrain: from ? w.cells.get(from) : undefined,
      now: {},
      seed: state.seed,
      at: w.at,
      terrains: this.terrains.map((t) => t.name),
      source: (l) => (l.toLowerCase() === f.name.toLowerCase() ? { kind: "flower", flower: f } : undefined),
      isTable: () => false,
    });
    w.at = plan.at;
    const t = plan.writes.find((x) => x.target.kind === "terrain")?.value;
    if (t) w.cells.set(hex, t);
    const m = plan.moves[0];
    w.log.push(`${hex.replace("_", ", ")}: ${t ?? "nothing"}${m ? ` (${m.total ?? "–"} → ${m.move}, cell ${m.to})` : ""}`);
  }

  // ── below the fold, Advanced, Debug ────────────────────────────────────

  private renderBelow(el: HTMLElement, disclosure: Disclosure): void {
    const f = this.flower;
    const fold = (title: string) => new Fold(el, { title, store: this.plugin.app, surface: "FlowerPage", cls: "duckmage-wfc-group", summaryCls: "duckmage-wfc-heading", bodyCls: "duckmage-wfc-group-body" }).body;

    // Moves: a range of dice totals and where it goes.
    const moves = fold("Moves");
    const table = moves.createEl("table", { cls: "duckmage-flower-moves" });
    const head = table.createEl("tr");
    head.createEl("th", { text: f.dice });
    head.createEl("th", { text: "Move" });
    f.moves.forEach((m, i) => {
      const tr = table.createEl("tr");
      const range = tr.createEl("td").createEl("input", { type: "text", value: rangeText(m), attr: { "aria-label": `Move ${i + 1} roll`, size: "5" } });
      range.addEventListener("change", () => {
        const r = parseRange(range.value);
        if (r) { [m.from, m.to] = r; this.save(); }
        else range.value = rangeText(m);
      });
      const sel = tr.createEl("td").createEl("select", { attr: { "aria-label": `Move ${i + 1}` } });
      for (const d of [...DIRS, "stay"] as Move[]) sel.createEl("option", { text: d, value: d });
      sel.value = m.move;
      sel.addEventListener("change", () => { m.move = sel.value as Move; this.save(); });
    });
    const edges = moves.createDiv({ cls: "duckmage-region-row" });
    edges.createSpan({ text: "At the edge" });
    const edgeSel = edges.createEl("select", { attr: { "aria-label": "At the edge" } });
    edgeSel.createEl("option", { text: "Come back in on the far side", value: "wrap" });
    edgeSel.createEl("option", { text: "Stay put", value: "stay" });
    edgeSel.value = f.edges;
    edgeSel.addEventListener("change", () => { f.edges = edgeSel.value === "stay" ? "stay" : "wrap"; this.save(); });

    // Cell shares: how many cells each result gets (the shared share sliders); letting go refills as patches.
    const sharesBox = fold("Cell shares");
    const shares = sharesOf(f.cells);
    if (shares.length < 2) sharesBox.createDiv({ cls: "duckmage-map-origin-desc", text: "Paint two or more results to share the cells between them." });
    else {
      renderShareSliders(sharesBox, {
        items: shares.map((s) => ({ label: s.terrain, ...(terrainColors(this.plugin, f.palette).get(s.terrain.toLowerCase()) ? { color: terrainColors(this.plugin, f.palette).get(s.terrain.toLowerCase()) } : {}) })),
        weights: shares.map((s) => s.weight),
        onChange: (sh) => {
          f.cells = fillFromShares(shares.map((s, i) => ({ terrain: s.terrain, weight: sh[i] })), state.seed, f.cells, f.start);
          this.save();
        },
      });
    }

    // Advanced: dice, walk length, seed.
    const diceRow = el.createDiv({ cls: "duckmage-region-row" });
    diceRow.createSpan({ text: "Dice" });
    const dice = diceRow.createEl("input", { type: "text", value: f.dice, attr: { "aria-label": "Dice", size: "5" } });
    dice.addEventListener("change", () => {
      if (parseDice(dice.value)) { f.dice = dice.value.replace(/\s+/g, "").toLowerCase(); this.save(); }
      else dice.value = f.dice;
    });
    disclosure.place("FlowerPage.dice", diceRow, () => f.dice !== DEFAULT_DICE);
    const walkLen = renderLabeledSlider(el, { label: "Walk length", min: 5, max: 100, step: 5, value: state.walkLength, reset: { value: 20 }, onChange: (v) => { state.walkLength = v; this.redraw?.(); } });
    disclosure.place("FlowerPage.walkLength", walkLen.el);
    const seedRow = el.createDiv({ cls: "duckmage-region-row" });
    seedRow.createSpan({ text: "Seed" });
    const seed = seedRow.createEl("input", { type: "number", value: String(state.seed), attr: { "aria-label": "Seed" } });
    seed.addEventListener("change", () => { const n = Number(seed.value); if (Number.isFinite(n)) { state.seed = n >>> 0; this.walk = null; this.redraw?.(); } });
    disclosure.place("FlowerPage.seed", seedRow);

    // Debug: what the note has that can't be read; the odds matrix.
    const report = el.createDiv({ cls: "duckmage-flower-report", text: this.entry.problems.length ? this.entry.problems.join("\n") : "The note reads cleanly." });
    disclosure.place("FlowerPage.report", report);
    const matrixBox = el.createDiv();
    this.renderMatrix(matrixBox);
    disclosure.place("FlowerPage.matrix", matrixBox);
  }

  /** Each cell's chance of each next cell, with the long-run share. */
  private renderMatrix(el: HTMLElement): void {
    const m = transitionMatrix(this.flower);
    const odds = longRunOdds(this.flower, 600);
    el.createDiv({ cls: "duckmage-map-origin-desc", text: "From each cell (row), the chance of each next cell (column); last column: long-run share." });
    const table = el.createEl("table", { cls: "duckmage-flower-matrix" });
    const head = table.createEl("tr");
    head.createEl("th", { text: "" });
    for (let j = 1; j <= CELL_COUNT; j++) head.createEl("th", { text: String(j) });
    head.createEl("th", { text: "Long run" });
    for (let i = 0; i < CELL_COUNT; i++) {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: String(i + 1) });
      for (let j = 0; j < CELL_COUNT; j++) tr.createEl("td", { text: m[i][j] ? pct(m[i][j]) : "" });
      tr.createEl("td", { text: pct(odds[i]) });
    }
  }
}

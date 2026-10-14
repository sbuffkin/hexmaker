/**
 * Exploring a map (plan-hex-flower, phase 4): the party steps into a hex,
 * and the map's `explore-with` rules fill it (explore.ts plans, this
 * writes). Also "Roll this hex" and "Reroll" from the hex menu, the "?"
 * frontier, and filling a whole map at once.
 *
 * Writes:
 * - terrain, name, icon and on arrival go to the map note (MapStore), as a
 *   `discover` action: allowed in every mode, never a hand edit, so a
 *   filled hex isn't locked;
 * - sections go to the hex's note (made when needed), the play log to the
 *   day's log note.
 * - `hex-flower-at` (where each flower's walk stands) to the map note.
 *
 * Undo: the map cells and `hex-flower-at` changes are returned as undo
 * entries, which the map view groups with the token's move (one Ctrl+Z).
 * Notes and the play log are a journal: they stay (the notice says so).
 */

import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { UndoItem } from "../hex-map/undoItems";
import type { PartyStep } from "../modules/types";
import { cellEdits, cellPatch, sameValue } from "../undoBook";
import { hashSeed } from "../arrival/arrival";
import { hexNeighbors } from "../hex-map/hexGeometry";
import { parseVisited } from "../play/partyTravel";
import { addToPlayLog } from "../play/playLogWriter";
import { addLinkToSection, appendSectionText, sectionText } from "../sections";
import { setTokenHex } from "../frontmatter";
import { resolveRoll, type ResolveContext, type TableLookup } from "../random-tables/resolve";
import { flowerStoreOf } from "./context";
import { logError } from "../log";
import { exploreOrder } from "./exploreOrder";
import { isExploreMap, type ExploreMap } from "./exploreFields";
import {
  describeMove,
  describeWrites,
  formatFlowerAt,
  parseFlowerAt,
  parseReveal,
  planStep,
  readRules,
  type ExploreRule,
  type ExploreSource,
  type HexNow,
  type Plan,
  type Rolled,
} from "./explore";

/** The last fill on a map, for Reroll. */
interface LastFill {
  hex: string;
  from?: string;
  reroll: number;
  /** The cell edits it made (to take back on Reroll). */
  undo: UndoItem[];
}

const key = (x: number, y: number) => `${x}_${y}`;
const xy = (k: string): [number, number] => k.split("_").map(Number) as [number, number];

export class ExploreService {
  private last = new Map<string, LastFill>();

  /** @param show  tells what a step filled, with its actions (Reroll, Undo): a notice. */
  constructor(
    private plugin: HexmakerPlugin,
    private show: (text: string, actions: { label: string; run: () => void }[]) => void = showNotice,
  ) {}

  /** The map, when the party explores it. */
  exploreMap(name: string): ExploreMap | undefined {
    const map = this.plugin.getMap(name);
    return isExploreMap(map) ? map : undefined;
  }

  // ── what the map knows ─────────────────────────────────────────────────

  private terrains(map: ExploreMap): string[] {
    return this.plugin.getPaletteOrPresetTerrains(map.paletteName).map((t) => t.name);
  }

  private seedOf(map: ExploreMap): number {
    return typeof map.seed === "number" ? map.seed : hashSeed(map.name);
  }

  private inGrid(map: ExploreMap, k: string): boolean {
    const [x, y] = xy(k);
    const o = map.gridOffset ?? { x: 0, y: 0 };
    return x >= o.x && y >= o.y && x < o.x + map.gridSize.cols && y < o.y + map.gridSize.rows;
  }

  neighbours(map: ExploreMap, k: string): string[] {
    const [x, y] = xy(k);
    const stagger = map.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    return hexNeighbors(x, y, this.plugin.settings.hexOrientation, stagger).map(([nx, ny]) => key(nx, ny)).filter((n) => this.inGrid(map, n));
  }

  private terrainAt(map: string, k: string): string | undefined {
    return this.plugin.mapStore.get(map, k)?.terrain;
  }

  /** Is hex `k` blank (no terrain yet)? */
  isBlank(map: string, k: string): boolean {
    return !this.terrainAt(map, k);
  }

  /** The vault's random tables (none before the plugin has started its table notes). */
  private tables(): TableLookup {
    return this.plugin.tableNotes?.lookup() ?? { table: () => undefined };
  }

  /** The table / flower a rule's link names. */
  private source(map: ExploreMap): (link: string) => ExploreSource | undefined {
    const store = flowerStoreOf(this.plugin);
    const lookup = this.tables();
    const terrains = this.terrains(map);
    return (link) => {
      const f = store?.get(link);
      if (f) return { kind: "flower", flower: f.flower };
      if (!lookup.table(link)) return undefined;
      return {
        kind: "table",
        roll: (seed, known): Rolled | undefined => {
          const ctx = { seed, terrains, ...(known.terrain ? { terrain: known.terrain } : {}), ...(known.from ? { from: known.from } : {}) } as ResolveContext;
          const r = resolveRoll(link, lookup, ctx);
          if (r.kind === "terrain" || r.kind === "note" || r.kind === "text") return { kind: r.kind, value: r.value };
          if (r.kind === "generator") return { kind: "text", value: r.value };
          return undefined;
        },
      };
    };
  }

  private async hexNow(map: ExploreMap, k: string, rules: readonly ExploreRule[]): Promise<HexNow> {
    const h = this.plugin.mapStore.get(map.name, k) ?? {};
    const [x, y] = xy(k);
    const file = this.plugin.app.vault.getAbstractFileByPath(this.plugin.hexPath(x, y, map.name));
    const filled: string[] = [];
    if (file instanceof TFile) {
      const text = await this.plugin.app.vault.cachedRead(file);
      for (const r of rules) if (r.target?.kind === "section" && sectionText(text, r.target.section)) filled.push(r.target.section);
    }
    return { terrain: h.terrain, name: h.name, icon: h.icon, locked: h.locked, onArrival: h.onArrival, filledSections: filled };
  }

  // ── planning and writing ───────────────────────────────────────────────

  /** Plan one hex: blank → every rule; else only the "every step" ones. */
  private async plan(map: ExploreMap, k: string, from: string | undefined, at: ReadonlyMap<string, number>, reroll: number, everyOnly: boolean): Promise<Plan> {
    const sections = ["Features", "Description"];
    const rules = readRules(map.exploreWith, sections);
    const lookup = this.tables();
    return planStep({
      rules,
      hex: k,
      from,
      fromTerrain: from ? this.terrainAt(map.name, from) : undefined,
      now: await this.hexNow(map, k, rules),
      seed: this.seedOf(map),
      reroll,
      stepNo: parseVisited(map.visited).length,
      everyOnly,
      at,
      terrains: this.terrains(map),
      source: this.source(map),
      isTable: (l) => !!lookup.table(l),
    });
  }

  /** Write a plan's map cells (recorded for undo) and its notes and log lines. */
  private async write(map: ExploreMap, k: string, plan: Plan): Promise<UndoItem[]> {
    const store = this.plugin.mapStore;
    const cellsPatch: Record<string, string> = {};
    for (const w of plan.writes) {
      if (w.target.kind === "terrain") cellsPatch.terrain = w.value;
      else if (w.target.kind === "name") cellsPatch.name = w.value;
      else if (w.target.kind === "icon") cellsPatch.icon = w.value;
      else if (w.target.kind === "arrival") cellsPatch.onArrival = w.value;
    }
    const undo: UndoItem[] = [];
    if (Object.keys(cellsPatch).length) {
      const { cells } = await store.record(() => store.set(map.name, k, cellsPatch, "discover"));
      const edits = cellEdits(cells);
      if (edits.length) undo.push({ kind: "cells", edits });
    }
    const [x, y] = xy(k);
    for (const w of plan.writes) {
      if (w.target.kind === "section") {
        const section = w.target.section;
        const path = this.plugin.hexPath(x, y, map.name);
        let file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) file = await this.plugin.createHexNote(x, y, map.name);
        if (!(file instanceof TFile)) continue;
        if (w.kind === "note") await addLinkToSection(this.plugin.app, file.path, section, `[[${w.value}]]`);
        else await this.plugin.app.vault.process(file, (c) => appendSectionText(c, section, w.value));
      } else if (w.target.kind === "log") {
        await addToPlayLog(this.plugin, map.name, x, y, w.kind === "note" ? `[[${w.value}]]` : w.value);
      }
    }
    return undo;
  }

  /** Store where the flowers' walks stand; the undo entry for it (none when unchanged). */
  private setFlowerAt(map: ExploreMap, at: ReadonlyMap<string, number>): UndoItem[] {
    const before = map.hexFlowerAt;
    const names = new Map((flowerStoreOf(this.plugin)?.list() ?? []).map((e) => [e.flower.name.toLowerCase(), e.flower.name]));
    const after = formatFlowerAt(at, names);
    if (sameValue(before ?? [], after)) return [];
    map.hexFlowerAt = after;
    void this.plugin.saveSettings();
    return [{ kind: "map-field", mapName: map.name, field: "hexFlowerAt", before, after }];
  }

  /**
   * Fill hex `k` (and, with reveal neighbours, the blank hexes around it)
   * coming from `from`. Returns the undo entries and what to tell the user.
   */
  async fill(mapName: string, k: string, from: string | undefined, reroll = 0): Promise<{ undo: UndoItem[]; lines: string[]; filled: boolean } | undefined> {
    const map = this.exploreMap(mapName);
    if (!map || !this.inGrid(map, k)) return undefined;
    let at: ReadonlyMap<string, number> = parseFlowerAt(map.hexFlowerAt);
    const undo: UndoItem[] = [];
    const lines: string[] = [];
    let filled = false;
    const blank = this.isBlank(mapName, k);
    const plan = await this.plan(map, k, from, at, reroll, !blank);
    at = plan.at;
    const cellUndo = await this.write(map, k, plan);
    undo.push(...cellUndo);
    if (blank && plan.writes.some((w) => w.target.kind !== "log")) filled = true;
    lines.push(this.line(map, k, from, plan));
    // Reveal neighbours: the blank hexes around, each seen from here.
    if (parseReveal(map.exploreReveal) === "neighbours") {
      for (const n of this.neighbours(map, k)) {
        if (!this.isBlank(mapName, n)) continue;
        const p = await this.plan(map, n, k, at, reroll, false);
        // Only what a hex shows from afar: no play log lines for neighbours.
        p.writes = p.writes.filter((w) => w.target.kind !== "log");
        at = p.at;
        undo.push(...await this.write(map, n, p));
        if (p.writes.length) lines.push(this.line(map, n, k, p));
      }
    }
    undo.push(...this.setFlowerAt(map, at));
    if (filled) this.last.set(mapName, { hex: k, from, reroll, undo: cellUndo });
    return { undo, lines: lines.filter(Boolean), filled };
  }

  /** "4, 5: hills (8 → down-left from grassland). Features: [[Old shrine]]" */
  private line(map: ExploreMap, k: string, from: string | undefined, plan: Plan): string {
    if (!plan.writes.length && !plan.problems.length) return "";
    const [x, y] = xy(k);
    const m = plan.moves[0];
    const fromTerrain = from ? this.terrainAt(map.name, from) : undefined;
    const how = m ? ` (${describeMove(m)}${fromTerrain ? ` from ${fromTerrain}` : ""})` : "";
    const what = describeWrites(plan.writes) || "nothing";
    const problems = plan.problems.length ? ` ⚠ ${plan.problems.join(" ")}` : "";
    return `${x}, ${y}: ${what}${how}${problems}`;
  }

  // ── the hooks ──────────────────────────────────────────────────────────

  /** The party entered a hex (ModuleRuntime.play.onEnter). */
  async onEnter(step: PartyStep): Promise<UndoItem[]> {
    if (!this.exploreMap(step.map)) return [];
    const r = await this.fill(step.map, step.to, step.from);
    if (!r) return [];
    // What came up is told, but a notice that fails never costs the step its undo.
    try { this.notify(step.map, r, step); } catch (e) { logError("hex flower notice", e); }
    return r.undo;
  }

  /** "Roll this hex": fill a blank hex by hand, from a filled neighbour. Pushes its own undo entry. */
  async rollHex(mapName: string, k: string): Promise<void> {
    const map = this.exploreMap(mapName);
    if (!map) return;
    const from = this.neighbours(map, k).find((n) => !this.isBlank(mapName, n));
    const r = await this.fill(mapName, k, from);
    if (!r) return;
    if (r.undo.length) this.plugin.pushUndo(mapName, { kind: "group", items: r.undo });
    this.notify(mapName, r);
    this.plugin.refreshHexMap();
  }

  /** Is `k` the map's latest fill (Reroll offered)? */
  canReroll(mapName: string, k: string): boolean {
    return this.last.get(mapName)?.hex === k;
  }

  /** Take back the latest fill's cells (where still as it left them) and roll it again. */
  async reroll(mapName: string): Promise<void> {
    const last = this.last.get(mapName);
    const map = this.exploreMap(mapName);
    if (!last || !map) return;
    const back = this.takeBack(last.undo);
    const r = await this.fill(mapName, last.hex, last.from, last.reroll + 1);
    if (!r) return;
    this.plugin.pushUndo(mapName, { kind: "group", items: [...back, ...r.undo] });
    this.notify(mapName, r);
    this.plugin.refreshHexMap();
  }

  /**
   * Undo cell edits now (Reroll, and the notice's Undo), for the parts still
   * as they were left. Returns the entries that redo them (for undo).
   */
  private takeBack(items: readonly UndoItem[]): UndoItem[] {
    const out: UndoItem[] = [];
    const store = this.plugin.mapStore;
    for (const it of items) {
      if (it.kind !== "cells") continue;
      const done = it.edits.filter((e) => Object.entries(e.fields).every(([f, [, a]]) => sameValue((store.get(e.map, e.key) as Record<string, unknown> | undefined)?.[f], a)));
      for (const e of done) store.set(e.map, e.key, cellPatch(e, "undo"));
      // Reverse each edit: the take-back's own undo puts them back.
      if (done.length) out.push({ kind: "cells", edits: done.map((e) => ({ ...e, fields: Object.fromEntries(Object.entries(e.fields).map(([f, [b, a]]) => [f, [a, b]])) })) });
    }
    return out;
  }

  /** The notice's Undo: the step's cells and positions back (and the party, when it moved). */
  private async undoStep(mapName: string, undo: readonly UndoItem[], step?: PartyStep): Promise<void> {
    this.takeBack(undo);
    const map = this.exploreMap(mapName);
    for (const it of undo) if (it.kind === "map-field" && map && sameValue(map.hexFlowerAt, it.after)) map.hexFlowerAt = it.before as string[] | undefined;
    void this.plugin.saveSettings();
    if (step?.token) await setTokenHex(this.plugin.app, step.token, step.from, step.map);
    if (this.last.get(mapName)?.undo === undo) this.last.delete(mapName);
    this.plugin.refreshHexMap();
  }

  private notify(mapName: string, r: { undo: UndoItem[]; lines: string[]; filled: boolean }, step?: PartyStep): void {
    if (!r.lines.length) return;
    const actions: { label: string; run: () => void }[] = [];
    if (r.filled) actions.push({ label: "Reroll", run: () => void this.reroll(mapName) });
    if (r.undo.length) actions.push({ label: "Undo", run: () => void this.undoStep(mapName, r.undo, step) });
    this.show(r.lines.join("\n"), actions);
  }

  // ── the "?" frontier, whole maps ───────────────────────────────────────

  /** Blank hexes next to filled ones (the "?" layer). */
  frontier(mapName: string): string[] {
    const map = this.exploreMap(mapName);
    if (!map) return [];
    const out = new Set<string>();
    for (const [k, h] of this.plugin.mapStore.all(mapName)) {
      if (!h.terrain) continue;
      for (const n of this.neighbours(map, k)) if (this.isBlank(mapName, n)) out.add(n);
    }
    return [...out];
  }

  /**
   * Fill every blank hex now ("Fill the whole map now"): outward from
   * `start`, each hex seen from the one it was reached from. Every-step
   * rules (the play log) are left out. Returns how many hexes were filled.
   */
  async fillAll(mapName: string, start: string, onProgress?: (done: number, total: number) => void): Promise<number> {
    const map = this.exploreMap(mapName);
    if (!map) return 0;
    const order = exploreOrder(start, (k) => this.neighbours(map, k));
    let at: ReadonlyMap<string, number> = parseFlowerAt(map.hexFlowerAt);
    let n = 0;
    for (const [i, { hex, from }] of order.entries()) {
      if (!this.isBlank(mapName, hex)) continue;
      const p = await this.plan(map, hex, from, at, 0, false);
      p.writes = p.writes.filter((w) => w.target.kind !== "log");
      at = p.at;
      await this.write(map, hex, p);
      if (p.writes.length) n++;
      if (i % 25 === 0) onProgress?.(i, order.length);
    }
    this.setFlowerAt(map, at);
    return n;
  }
}

/** The step's notice: what was filled, then Reroll · Undo links (notes and the play log stay). */
function showNotice(text: string, actions: { label: string; run: () => void }[]): void {
  const frag = createFragment();
  frag.appendText(text);
  actions.forEach((a, i) => {
    frag.appendText(i ? " · " : " ");
    const link = frag.createEl("a", { text: a.label, href: "#" });
    link.addEventListener("click", (e) => { e.preventDefault(); notice.hide(); a.run(); });
  });
  if (actions.some((a) => a.label === "Undo")) frag.appendText(" (notes and the play log stay)");
  const notice = new Notice(frag, 10000);
}

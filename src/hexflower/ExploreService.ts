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
 * Undo: the map cells, the text written into hex notes (owner HF7: one
 * undo = the whole step) and `hex-flower-at` changes are returned as undo
 * entries, which the map view groups with the token's move (one Ctrl+Z);
 * the party's Reveal button (reveal) is one undo the same way. The notice's
 * Undo is that same Ctrl+Z (the map view's queue), never a second path.
 * The map grows as the party nears its edge (exploreGrow.ts), as a "grid"
 * entry first in the same group.
 * The play log is a journal: its lines stay (the notice says so).
 */

import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { UndoItem } from "../hex-map/undoItems";
import type { PartyStep } from "../modules/types";
import { cellEdits, cellPatch, sameValue } from "../undoBook";
import { hashSeed } from "../arrival/arrival";
import { parseVisited } from "../modules/play/partyTravel";
import { addToPlayLog } from "../modules/play/playLogWriter";
import { addLinkToSection, appendSectionText, sectionText } from "../sections";
import { resolveRoll, type ResolveContext, type TableLookup } from "../random-tables/resolve";
import { flowerStoreOf } from "./context";
import { logError } from "../log";
import { exploreOrder, ringOrder } from "../fog/exploreOrder";
import { markRevealed } from "../hex-map/revealBounce";
import { isExploreMap, type ExploreMap } from "../fog/exploreFields";
import { makeRoom } from "./exploreGrow";
import { VIEW_TYPE_HEX_MAP } from "../constants";
import { applyNoteSection, prepareNoteSection } from "../hex-map/noteUndo";
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
import { hexKey, hexPair, neighbourKeys } from "../hexKey";
import { listGeneratorKinds, type TerrainGeneratorKind } from "../worldgen/registry";
import { REALMS_SOURCE, parseBorders, parseRealms, realmAt, type Borders, type Geometry, type Realm, type RealmSource } from "./realms";
import { kindForSource, RealmFlowers } from "./realmFlowers";
import { nudge, RealmWorlds, type WorldContext } from "./world";
import type { Flower } from "./flower";
import type { TerrainColor } from "../types";

/** A map's realms and the flower of each (by realm name, lower case). */
export interface RealmState {
  realms: Realm[];
  borders: Borders;
  flowers: Map<string, Flower>;
  /** The generators the realms were resolved against (for their hidden tiles, world.ts). */
  kinds: readonly TerrainGeneratorKind[];
  /** Realms whose generators couldn't be found or run. */
  problems: string[];
}

/** The last fill on a map, for Reroll. */
interface LastFill {
  hex: string;
  from?: string;
  reroll: number;
  /** The rings it filled around the hex (Roll this hex: none). */
  rings?: number;
  /** The cell edits it made (to take back on Reroll). */
  undo: UndoItem[];
}


export class ExploreService {
  private last = new Map<string, LastFill>();
  /** Flowers made from generators (a map's realms), made once each. */
  readonly realmFlowers = new RealmFlowers();
  /** The hidden world each realm's generators make (world.ts), made once each. */
  readonly worlds = new RealmWorlds();
  /** The generators realms are resolved against (listGeneratorKinds, read when one isn't found). */
  private kindList: TerrainGeneratorKind[] | undefined;

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
    const [x, y] = hexPair(k);
    const o = map.gridOffset ?? { x: 0, y: 0 };
    return x >= o.x && y >= o.y && x < o.x + map.gridSize.cols && y < o.y + map.gridSize.rows;
  }

  neighbours(map: ExploreMap, k: string): string[] {
    const stagger = map.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    return neighbourKeys(k, this.plugin.settings.hexOrientation, stagger).filter((n) => this.inGrid(map, n));
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

  // ── realms (HF6 / HF8): terrain from generators ──────────────────────

  /** The map's hex layout. */
  geometry(map: ExploreMap): Geometry {
    return { orientation: this.plugin.settings.hexOrientation, stagger: map.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd" };
  }

  /** Generators the caller already has (New map's list), so a preview's realms resolve at once. */
  useKinds(kinds: readonly TerrainGeneratorKind[]): void {
    const byId = new Map((this.kindList ?? []).map((k) => [k.id, k]));
    for (const k of kinds) byId.set(k.id, k);
    this.kindList = [...byId.values()];
  }

  /** The generators known now (no read). */
  knownKinds(): readonly TerrainGeneratorKind[] {
    return this.kindList ?? [];
  }

  /** The generators, read again when one of `sources` isn't known yet. */
  async kindsFor(sources: readonly Pick<RealmSource, "ref" | "link">[]): Promise<readonly TerrainGeneratorKind[]> {
    const known = this.kindList;
    if (known && sources.every((s) => kindForSource(s, known))) return known;
    this.kindList = await listGeneratorKinds(this.plugin);
    return this.kindList;
  }

  /**
   * Realm `realm`'s flower on a palette with `terrains` (`palette` names it,
   * for the cache): its own flower note, else one made from its generators
   * (no read: the generators known now unless `kinds` are given).
   */
  realmFlower(realm: Realm, terrains: TerrainColor[], palette: string, mapSeed: number, kinds: readonly TerrainGeneratorKind[] = this.knownKinds()): { flower: Flower; problems: string[] } | undefined {
    if (realm.flower) {
      const own = flowerStoreOf(this.plugin)?.get(realm.flower)?.flower;
      if (own) return { flower: { ...own, name: realm.name }, problems: [] };
    }
    return this.realmFlowers.flowerOf(realm, { kinds, palette, terrains, mapSeed, orientation: this.plugin.settings.hexOrientation });
  }

  /** What the hidden world of `map` is made from. */
  worldContext(map: ExploreMap, realms: Pick<RealmState, "kinds" | "borders">): WorldContext {
    return {
      kinds: realms.kinds,
      palette: map.paletteName,
      terrains: this.plugin.getPaletteOrPresetTerrains(map.paletteName),
      mapSeed: this.seedOf(map),
      geometry: this.geometry(map),
      borders: realms.borders,
    };
  }

  /** Each map's realms as the peek last read them (peekFor is asked while drawing: no awaits). */
  private peekRealms = new Map<string, { key: string; realms: RealmState | undefined }>();

  /** Is the GM's peek on for `mapName`? */
  peeking(mapName: string): boolean {
    return this.exploreMap(mapName)?.explorePeek === "on";
  }

  /** Turn the GM's peek on or off, and draw the map again. */
  setPeek(mapName: string, on: boolean): void {
    const map = this.exploreMap(mapName);
    if (!map) return;
    if (on) map.explorePeek = "on";
    else delete map.explorePeek;
    void this.plugin.saveSettings();
    this.plugin.refreshHexMap();
  }

  /**
   * The hidden terrain per hex while the GM peeks at `map` (asked once per
   * render, then per hex). The first ask reads the map's realms and draws
   * the map again when they're in.
   */
  peekFor(map: ExploreMap): ((hex: string) => string | undefined) | undefined {
    if (map.explorePeek !== "on" || !map.exploreRealms?.length) return undefined;
    const key = [...map.exploreRealms, map.exploreBlend ?? "", map.paletteName, this.seedOf(map)].join("\u0000");
    const got = this.peekRealms.get(map.name);
    if (got?.key !== key) {
      this.peekRealms.set(map.name, { key, realms: undefined });
      void this.realmsOf(map).then((realms) => {
        if (this.peekRealms.get(map.name)?.key !== key) return;
        this.peekRealms.set(map.name, { key, realms });
        if (realms) this.plugin.refreshHexMap();
      });
      return undefined;
    }
    const realms = got.realms;
    if (!realms) return undefined;
    const ctx = this.worldContext(map, realms);
    return (hex) => this.worlds.baseAt(hex, realms.realms, ctx)?.terrain;
  }

  /**
   * The GM's peek (owner 2026-10-25): the hidden terrain of each blank hex
   * of `mapName` (no nudge; what a reveal starts from). Empty when the map
   * isn't powered by generators.
   */
  async hiddenTerrain(mapName: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const map = this.exploreMap(mapName);
    if (!map) return out;
    const realms = await this.realmsOf(map);
    if (!realms) return out;
    const ctx = this.worldContext(map, realms);
    const { cols, rows } = map.gridSize;
    const { x: ox, y: oy } = map.gridOffset ?? { x: 0, y: 0 };
    for (let x = ox; x < ox + cols; x++) {
      for (let y = oy; y < oy + rows; y++) {
        const k = hexKey(x, y);
        if (!this.isBlank(mapName, k)) continue;
        const base = this.worlds.baseAt(k, realms.realms, ctx);
        if (base) out.set(k, base.terrain);
      }
    }
    return out;
  }

  /** The map's realms and their flowers (undefined: it has none). */
  async realmsOf(map: ExploreMap): Promise<RealmState | undefined> {
    const { realms, unread } = parseRealms(map.exploreRealms);
    if (!realms.length) return undefined;
    const kinds = await this.kindsFor(realms.filter((r) => !r.flower).flatMap((r) => r.from));
    const flowers = new Map<string, Flower>();
    const problems = unread.map((u) => `Can't read the area "${u}".`);
    for (const r of realms) {
      const made = this.realmFlower(r, this.plugin.getPaletteOrPresetTerrains(map.paletteName), map.paletteName, this.seedOf(map), kinds);
      if (made) flowers.set(r.name.toLowerCase(), made.flower);
      problems.push(...(made?.problems ?? [`${r.name}: no terrain of this palette to roll on.`]));
    }
    return { realms, borders: parseBorders(map.exploreBlend), flowers, kinds, problems };
  }

  /** The table / flower a rule's link names (the realm's flower for `(realms)`, at hex `hex`). */
  private source(map: ExploreMap, hex?: string, realms?: RealmState): (link: string) => ExploreSource | undefined {
    const store = flowerStoreOf(this.plugin);
    const lookup = this.tables();
    const terrains = this.terrains(map);
    return (link) => {
      if (link.toLowerCase() === REALMS_SOURCE) {
        // The hidden world's terrain here, with a little local variety (world.ts).
        const base = hex && realms ? this.worlds.baseAt(hex, realms.realms, this.worldContext(map, realms)) : undefined;
        if (base) {
          const flower = realms?.flowers.get(base.realm.name.toLowerCase());
          const colours = this.plugin.getPaletteOrPresetTerrains(map.paletteName);
          return { kind: "table", roll: (seed) => ({ kind: "terrain", value: nudge(base.terrain, flower, colours, seed) }) };
        }
        // A realm with its own flower note (or whose generators can't run): its flower.
        const r = hex && realms ? realmAt(hex, realms.realms, this.geometry(map), { seed: this.seedOf(map), borders: realms.borders }) : undefined;
        const flower = r ? realms?.flowers.get(r.name.toLowerCase()) : undefined;
        return flower ? { kind: "flower", flower } : undefined;
      }
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
    const [x, y] = hexPair(k);
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
    const realms = rules.some((r) => r.source.toLowerCase() === REALMS_SOURCE) ? await this.realmsOf(map) : undefined;
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
      source: this.source(map, k, realms),
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
    const [x, y] = hexPair(k);
    for (const w of plan.writes) {
      if (w.target.kind === "section") {
        const section = w.target.section;
        const path = this.plugin.hexPath(x, y, map.name);
        let file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) file = await this.plugin.createHexNote(x, y, map.name);
        if (!(file instanceof TFile)) continue;
        // The section's text before and after: part of the step's undo (HF7).
        const before = sectionText(await this.plugin.app.vault.read(file), section);
        if (w.kind === "note") await addLinkToSection(this.plugin.app, file.path, section, `[[${w.value}]]`);
        else await this.plugin.app.vault.process(file, (c) => appendSectionText(c, section, w.value));
        const after = sectionText(await this.plugin.app.vault.read(file), section);
        if (after !== before) undo.push({ kind: "note-section", path: file.path, section, before, after });
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
    for (const r of parseRealms(map.exploreRealms).realms) names.set(r.name.toLowerCase(), r.name);
    const after = formatFlowerAt(at, names);
    if (sameValue(before ?? [], after)) return [];
    map.hexFlowerAt = after;
    void this.plugin.saveSettings();
    return [{ kind: "map-field", mapName: map.name, field: "hexFlowerAt", before, after }];
  }

  /**
   * Fill hex `k` (and, with the map's Reveal set to rings, the blank hexes
   * that far around it; `rings` overrides it, 0 for just the hex) coming
   * from `from`. Returns the undo entries and what to tell the user. The
   * hexes it fills bounce in (revealBounce).
   */
  async fill(mapName: string, k: string, from: string | undefined, reroll = 0, rings?: number): Promise<{ undo: UndoItem[]; lines: string[]; filled: boolean } | undefined> {
    const map = this.exploreMap(mapName);
    if (!map || !this.inGrid(map, k)) return undefined;
    let at: ReadonlyMap<string, number> = parseFlowerAt(map.hexFlowerAt);
    const undo: UndoItem[] = [];
    const lines: string[] = [];
    const shown = new Map<string, number>();
    let filled = false;
    const blank = this.isBlank(mapName, k);
    const plan = await this.plan(map, k, from, at, reroll, !blank);
    at = plan.at;
    const cellUndo = await this.write(map, k, plan);
    undo.push(...cellUndo);
    if (blank && plan.writes.some((w) => w.target.kind !== "log")) { filled = true; shown.set(k, 0); }
    lines.push(this.line(map, k, from, plan));
    // Reveal rings: the blank hexes around, each seen from the hex it was reached from.
    at = await this.fillRings(map, k, rings ?? parseReveal(map.exploreReveal), at, reroll, undo, lines, shown);
    undo.push(...this.setFlowerAt(map, at));
    if (filled) this.last.set(mapName, { hex: k, from, reroll, rings, undo: cellUndo });
    markRevealed(mapName, shown);
    return { undo, lines: lines.filter(Boolean), filled };
  }

  /**
   * Fill the blank hexes up to `rings` around `center`, ring by ring, each
   * seen from the hex it was reached from. Only what a hex shows from afar:
   * no play log lines. Adds to `undo`, `lines` and `shown` (hex → ring);
   * returns where the walks stand after.
   */
  private async fillRings(
    map: ExploreMap, center: string, rings: number, at: ReadonlyMap<string, number>, reroll: number,
    undo: UndoItem[], lines: string[], shown: Map<string, number>,
  ): Promise<ReadonlyMap<string, number>> {
    for (const { hex, from, ring } of ringOrder(center, rings, (n) => this.neighbours(map, n))) {
      if (!this.isBlank(map.name, hex)) continue;
      const p = await this.plan(map, hex, from, at, reroll, false);
      p.writes = p.writes.filter((w) => w.target.kind !== "log");
      at = p.at;
      undo.push(...await this.write(map, hex, p));
      if (p.writes.length) { lines.push(this.line(map, hex, from, p)); shown.set(hex, ring); }
    }
    return at;
  }

  /**
   * The party's Reveal button (owner HF3): fill the blank hexes up to
   * `rings` (1–3) around `center`, any time after a step. Returns the undo
   * entries (the caller records them as one undo) and tells the user what
   * came up; the hexes bounce in.
   */
  async reveal(mapName: string, center: string, rings: number): Promise<UndoItem[]> {
    const map = this.exploreMap(mapName);
    if (!map || !this.inGrid(map, center)) return [];
    const undo: UndoItem[] = [];
    const lines: string[] = [];
    const shown = new Map<string, number>();
    const r = Math.max(1, parseReveal(rings));
    // Room for what the party sees from here (HF4), before the rings fill into it.
    const grew = makeRoom(this.plugin, map, center, r, (t) => this.show(t, []));
    if (grew) undo.push(grew.undo);
    let at: ReadonlyMap<string, number> = parseFlowerAt(map.hexFlowerAt);
    at = await this.fillRings(map, center, r, at, 0, undo, lines, shown);
    if (grew) lines.push(grew.line);
    undo.push(...this.setFlowerAt(map, at));
    markRevealed(mapName, shown);
    const [x, y] = hexPair(center);
    const around = `${r} ring${r === 1 ? "" : "s"} around ${x}, ${y}`;
    const head = shown.size ? `Revealed ${shown.size} hex${shown.size === 1 ? "" : "es"} (${around}).` : `Nothing new to reveal ${around}.`;
    try {
      this.show([head, ...lines.filter(Boolean)].join("\n"), undo.length ? [{ label: "Undo", run: () => void this.undoStep(mapName, undo) }] : []);
    } catch (e) { logError("hex flower notice", e); }
    return undo;
  }

  /** "4, 5: hills (8 → down-left from grassland). Features: [[Old shrine]]" */
  private line(map: ExploreMap, k: string, from: string | undefined, plan: Plan): string {
    if (!plan.writes.length && !plan.problems.length) return "";
    const [x, y] = hexPair(k);
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
    const map = this.exploreMap(step.map);
    if (!map) return [];
    // Near the edge, the map grows first (HF4), so the step's reveal fills into the new hexes.
    const grew = makeRoom(this.plugin, map, step.to, parseReveal(map.exploreReveal), (t) => this.show(t, []));
    const r = await this.fill(step.map, step.to, step.from);
    if (!r) return grew ? [grew.undo] : [];
    if (grew) { r.undo.unshift(grew.undo); r.lines.push(grew.line); }
    // What came up is told, but a notice that fails never costs the step its undo.
    try { this.notify(step.map, r, step); } catch (e) { logError("hex flower notice", e); }
    return r.undo;
  }

  /**
   * The party looks around where it stands (a step in place, owner HF11):
   * the blank hexes it sees now are filled, one undo, one notice. With
   * Party sees 0 that's only its own hex.
   */
  async look(mapName: string, center: string): Promise<UndoItem[]> {
    const map = this.exploreMap(mapName);
    if (!map) return [];
    const r: number = parseReveal(map.exploreReveal);
    if (r > 0) return this.reveal(mapName, center, r);
    const [x, y] = hexPair(center);
    if (!this.isBlank(mapName, center)) { this.show(`Nothing new to see at ${x}, ${y}.`, []); return []; }
    const done = await this.fill(mapName, center, undefined, 0, 0);
    if (done) this.notify(mapName, done);
    return done?.undo ?? [];
  }

  /**
   * "Roll this hex", one hex or a brush stroke (Reveal hexes): fill
   * exactly these blank hexes, nothing around them (owner HF11: the GM
   * shows the players one place), each from a filled neighbour. Returns
   * the undo entries; at most one notice.
   */
  async fillHexes(mapName: string, keys: readonly string[]): Promise<UndoItem[]> {
    const map = this.exploreMap(mapName);
    if (!map) return [];
    const undo: UndoItem[] = [];
    const lines: string[] = [];
    let filled = false;
    for (const k of keys) {
      if (!this.inGrid(map, k) || !this.isBlank(mapName, k)) continue;
      const from = this.neighbours(map, k).find((n) => !this.isBlank(mapName, n));
      const r = await this.fill(mapName, k, from, 0, 0);
      if (!r) continue;
      undo.push(...r.undo);
      lines.push(...r.lines);
      filled ||= r.filled;
    }
    if (keys.length === 1) this.notify(mapName, { undo, lines, filled });
    else if (lines.length) this.show(`Filled ${lines.length} hex${lines.length === 1 ? "" : "es"}.`, []);
    return undo;
  }

  /** "Roll this hex": fill a blank hex by hand (only that hex), from a filled neighbour. Pushes its own undo entry. */
  async rollHex(mapName: string, k: string): Promise<void> {
    const map = this.exploreMap(mapName);
    if (!map) return;
    const from = this.neighbours(map, k).find((n) => !this.isBlank(mapName, n));
    const r = await this.fill(mapName, k, from, 0, 0);
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
    const back = await this.takeBack(last.undo);
    const r = await this.fill(mapName, last.hex, last.from, last.reroll + 1, last.rings);
    if (!r) return;
    this.plugin.pushUndo(mapName, { kind: "group", items: [...back, ...r.undo] });
    this.notify(mapName, r);
    this.plugin.refreshHexMap();
  }

  /**
   * Undo a fill's cell edits and note text now (Reroll), for the parts still
   * as they were left. Returns the entries that redo them (for undo).
   */
  private async takeBack(items: readonly UndoItem[]): Promise<UndoItem[]> {
    const out: UndoItem[] = [];
    const store = this.plugin.mapStore;
    for (const it of [...items].reverse()) {
      if (it.kind === "note-section") {
        if (!await prepareNoteSection(this.plugin.app, it, "undo", (t) => this.show(t, []))) continue;
        await applyNoteSection(this.plugin.app, it, "undo");
        out.push({ ...it, before: it.after, after: it.before });
      }
      if (it.kind !== "cells") continue;
      const done = it.edits.filter((e) => Object.entries(e.fields).every(([f, [, a]]) => sameValue((store.get(e.map, e.key) as Record<string, unknown> | undefined)?.[f], a)));
      for (const e of done) store.set(e.map, e.key, cellPatch(e, "undo"));
      // Reverse each edit: the take-back's own undo puts them back.
      if (done.length) out.push({ kind: "cells", edits: done.map((e) => ({ ...e, fields: Object.fromEntries(Object.entries(e.fields).map(([f, [b, a]]) => [f, [a, b]])) })) });
    }
    return out.reverse();
  }

  /**
   * The notice's Undo: the map view's own undo of this step (Ctrl+Z), so
   * the step, its visited marks, fills, note text and rows go together and
   * the entry leaves the queue. Only while the step is the latest action
   * on the map; otherwise the user is told to use the map's Undo.
   */
  private async undoStep(mapName: string, undo: readonly UndoItem[]): Promise<void> {
    const marker = undo[0];
    const views = this.plugin.app.workspace?.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => l.view as unknown as Partial<StepUndoView>) ?? [];
    const view = views.find((v) => v.activeMapName === mapName && typeof v.undo === "function");
    const done = view?.undo ? await view.undo((top) => holds(top, marker)) : false;
    if (!done) { this.show("This step isn't the latest change on the map any more: use the map's Undo.", []); return; }
    const last = this.last.get(mapName);
    if (last && last.undo.every((u) => undo.includes(u))) this.last.delete(mapName);
  }

  private notify(mapName: string, r: { undo: UndoItem[]; lines: string[]; filled: boolean }, step?: PartyStep): void {
    if (!r.lines.length) return;
    const actions: { label: string; run: () => void }[] = [];
    if (r.filled) actions.push({ label: "Reroll", run: () => void this.reroll(mapName) });
    if (r.undo.length) actions.push({ label: "Undo", run: () => void this.undoStep(mapName, r.undo) });
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

/** The map view's undo, as the notice's Undo uses it (HexMapView.undo). */
interface StepUndoView {
  activeMapName: string;
  undo(match: (item: UndoItem) => boolean): Promise<boolean>;
}

/** Is `marker` the entry `item`, or part of it (a step's group)? */
function holds(item: UndoItem, marker: UndoItem | undefined): boolean {
  if (!marker) return false;
  return item === marker || (item.kind === "group" && item.items.some((i) => holds(i, marker)));
}

/** The step's notice: what was filled, then Reroll · Undo links (the play log keeps its lines). */
function showNotice(text: string, actions: { label: string; run: () => void }[]): void {
  const frag = createFragment();
  frag.appendText(text);
  actions.forEach((a, i) => {
    frag.appendText(i ? " · " : " ");
    const link = frag.createEl("a", { text: a.label, href: "#" });
    link.addEventListener("click", (e) => { e.preventDefault(); notice.hide(); a.run(); });
  });
  if (actions.some((a) => a.label === "Undo")) frag.appendText(" (the play log keeps its lines)");
  const notice = new Notice(frag, 10000);
}

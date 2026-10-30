/**
 * Exploring a finished map by revealing it (HF11, plan-explore-reveal-
 * existing): the map's own content is the hidden world. "Start exploring"
 * puts the party down, fogs everything else and reveals what the party
 * sees; each step (and a look around where it stands) reveals the hexes in
 * sight; the GM can reveal or hide single hexes (a town, a quest's goal)
 * with nothing around them. "Stop exploring" lifts the fog and keeps what
 * was seen, so starting again can carry on.
 *
 * Writes only play state, never map data: `explore-fog`, `explore-seen`
 * and `explore-reveal` (Party sees) in the map note, each change returned
 * as a map-field undo entry (the map view groups a step's with the token's
 * move: one undo). Every write asks the work-mode gate for
 * `explore-play`, which every mode allows.
 */

import { Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { UndoItem } from "../hex-map/undoItems";
import type { FogView, PartyAt, PartyStep } from "../modules/types";
import type { MapData } from "../types";
import { sameValue } from "../undoBook";
import { guardWrite } from "../modeGate";
import { applyTokenFrontmatter, getTokenDataFromCache } from "../frontmatter";
import { normalizeFolder } from "../utils";
import { ensureFolder } from "../vault/ensureFolder";
import { hexKey, hexPair, neighbourKeys } from "../hexKey";
import { markRevealed } from "../hex-map/revealBounce";
import { parseVisited } from "../modules/play/partyTravel";
import { isFogMap, type ExploreMap } from "./exploreFields";
import { formatReveal, parseReveal } from "./explore";
import { fogEdge, formatSeen, parseSeen, sightKeys, withSeen } from "./fog";

/** The action every fog write is (src/workMode.ts; the module classifies it for every mode). */
export const FOG_ACTION = "explore-play" as const;

/** How the party starts exploring a map (the Start exploring dialog). */
export interface FogStart {
  /** The party's hex ("x_y"). */
  start: string;
  /** Party sees: rings around the party (0–3). */
  sees: number;
  /** The party token's note, or undefined: a new "Party" token. */
  token?: string;
  /** Forget what was seen before (else the party carries on with it). */
  reset?: boolean;
}

const PARTY_TOKEN_NAME = "Party";

export class FogService {
  /** Each map's revealed hexes, read once per `explore-seen` value. */
  private seenCache = new WeakMap<object, Set<string>>();

  /** @param show  tells what a reveal did: a short notice. */
  constructor(
    private plugin: HexmakerPlugin,
    private show: (text: string) => void = (text) => new Notice(text, 4000),
  ) {}

  /** The map, while it's explored by revealing it. */
  fogMap(name: string): ExploreMap | undefined {
    const map = this.plugin.getMap(name);
    return isFogMap(map) ? map : undefined;
  }

  // ── what's revealed ────────────────────────────────────────────────────

  /** The hexes revealed on `map` (read once per value). */
  seenOf(map: ExploreMap): ReadonlySet<string> {
    const raw = map.exploreSeen;
    if (!Array.isArray(raw)) return new Set();
    let got = this.seenCache.get(raw);
    if (!got) { got = parseSeen(raw); this.seenCache.set(raw, got); }
    return got;
  }

  /** The fog over `map` (PlayHooks.fog), or undefined: it isn't fogged. */
  fogView(map: MapData): FogView | undefined {
    const m = isFogMap(map) ? map : undefined;
    if (!m) return undefined;
    const seen = this.seenOf(m);
    return { hidden: (hex) => !seen.has(hex), peek: m.explorePeek === "on" };
  }

  private inGrid(map: ExploreMap, k: string): boolean {
    const [x, y] = hexPair(k);
    const o = map.gridOffset ?? { x: 0, y: 0 };
    return x >= o.x && y >= o.y && x < o.x + map.gridSize.cols && y < o.y + map.gridSize.rows;
  }

  neighbours(map: MapData, k: string): string[] {
    const m = map as ExploreMap;
    const stagger = map.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    return neighbourKeys(k, this.plugin.settings.hexOrientation, stagger).filter((n) => this.inGrid(m, n));
  }

  /** The hexes the party sees from `center` with its sight (or `rings`), on the map. */
  sightFrom(map: ExploreMap, center: string, rings: number = parseReveal(map.exploreReveal)): string[] {
    return sightKeys(center, rings, (k) => this.neighbours(map, k)).filter((k) => this.inGrid(map, k));
  }

  /** Store `next` as the map's revealed hexes; the undo entry (none when unchanged). */
  private setSeen(map: ExploreMap, next: ReadonlySet<string>): UndoItem[] {
    const before = map.exploreSeen;
    const after = formatSeen(next);
    if (sameValue(before ?? [], after)) return [];
    map.exploreSeen = after;
    this.seenCache.set(after, new Set(next));
    void this.plugin.saveSettings();
    return [{ kind: "map-field", mapName: map.name, field: "exploreSeen", before, after }];
  }

  /** A map-note key set (or cleared, undefined), as an undo entry. */
  private setField(map: ExploreMap, field: "exploreFog" | "exploreReveal" | "explorePeek", value: string | undefined): UndoItem[] {
    const before = map[field];
    if (before === value) return [];
    if (value === undefined) delete map[field];
    else map[field] = value;
    return [{ kind: "map-field", mapName: map.name, field, before, after: value }];
  }

  /** Reveal `keys` (or hide them, `on` false); bounces the new ones in. Returns the undo entries and how many changed. */
  private mark(map: ExploreMap, keys: readonly string[], on: boolean, rings?: ReadonlyMap<string, number>): { undo: UndoItem[]; changed: string[] } {
    const seen = this.seenOf(map);
    const changed = [...new Set(keys)].filter((k) => this.inGrid(map, k) && seen.has(k) !== on);
    if (!changed.length) return { undo: [], changed };
    const undo = this.setSeen(map, withSeen(seen, changed, on));
    if (on) markRevealed(map.name, new Map(changed.map((k) => [k, rings?.get(k) ?? 0])));
    return { undo, changed };
  }

  /** The rings around `center` (hex → ring), for the bounce. */
  private ringsAround(map: ExploreMap, center: string, rings: number): Map<string, number> {
    const out = new Map<string, number>([[center, 0]]);
    let edge = [center];
    for (let r = 1; r <= rings; r++) {
      const next: string[] = [];
      for (const k of edge) for (const n of this.neighbours(map, k)) if (!out.has(n)) { out.set(n, r); next.push(n); }
      edge = next;
    }
    return out;
  }

  /** Reveal what the party sees from `center` (its sight, or `rings`). */
  revealAround(mapName: string, center: string, rings?: number): { undo: UndoItem[]; added: number } {
    const map = this.fogMap(mapName);
    if (!map || !this.inGrid(map, center) || !guardWrite(mapName, FOG_ACTION)) return { undo: [], added: 0 };
    const r: number = rings ?? parseReveal(map.exploreReveal);
    const keys = this.sightFrom(map, center, r);
    const { undo, changed } = this.mark(map, keys, true, this.ringsAround(map, center, r));
    return { undo, added: changed.length };
  }

  // ── the party ──────────────────────────────────────────────────────────

  /** The party tokens on map `mapName` (shown ones) and their hexes. */
  partyHexes(mapName: string): { path: string; hex: string }[] {
    const app = this.plugin.app;
    return app.vault.getMarkdownFiles().flatMap((f) => {
      const t = getTokenDataFromCache(app, f);
      return t && t.party && t.map === mapName && t.visible !== false ? [{ path: t.filePath, hex: t.hex }] : [];
    });
  }

  /** What every party on the map sees now: the GM can't hide these. */
  inSight(map: ExploreMap): Set<string> {
    return new Set(this.partyHexes(map.name).flatMap((p) => this.sightFrom(map, p.hex)));
  }

  /** The party stepped into a hex (PlayHooks.onEnter): reveal what it sees from there. */
  onEnter(step: PartyStep): UndoItem[] {
    return this.revealAround(step.map, step.to).undo;
  }

  /** The party looks around where it stands (a step in place, owner HF11): what it sees now, one undo, one notice. */
  look(party: PartyAt): UndoItem[] {
    const map = this.fogMap(party.map);
    if (!map) return [];
    const r: number = parseReveal(map.exploreReveal);
    const { undo, added } = this.revealAround(party.map, party.hex, r);
    const [x, y] = hexPair(party.hex);
    const around = r ? `${r} ring${r === 1 ? "" : "s"} around ${x}, ${y}` : `at ${x}, ${y}`;
    this.show(added ? `Revealed ${added} hex${added === 1 ? "" : "es"} (${around}).` : `Nothing new to see ${around}.`);
    return undo;
  }

  /**
   * The GM reveals (or hides) exactly these hexes, nothing around them
   * (owner HF11: show the players a town or a quest's goal). Hexes the
   * party sees now are never hidden. At most one short notice.
   */
  pick(mapName: string, hexes: readonly string[], on: boolean, notify = true): UndoItem[] {
    const map = this.fogMap(mapName);
    if (!map || !guardWrite(mapName, FOG_ACTION)) return [];
    const keep = on ? new Set<string>() : this.inSight(map);
    const { undo, changed } = this.mark(map, hexes.filter((k) => !keep.has(k)), on);
    if (notify && changed.length > 1) this.show(`${on ? "Revealed" : "Hid"} ${changed.length} hexes.`);
    else if (notify && !on && !changed.length && hexes.some((k) => keep.has(k))) this.show("The party can see that hex: it stays revealed.");
    return undo;
  }

  /**
   * A stroke of the Reveal hexes brush: each hex crossed is revealed; a
   * right-click (erase) hides; a single tap on a revealed hex hides it.
   */
  brushStroke(mapName: string, hexes: readonly string[], erase: boolean): UndoItem[] {
    const map = this.fogMap(mapName);
    if (!map) return [];
    const seen = this.seenOf(map);
    const hide = erase || (hexes.length === 1 && seen.has(hexes[0]));
    return this.pick(mapName, hexes, !hide);
  }

  /** Can the GM hide hex `k` again (revealed, and not in the party's sight)? */
  canHide(mapName: string, k: string): boolean {
    const map = this.fogMap(mapName);
    return !!map && this.seenOf(map).has(k) && !this.inSight(map).has(k);
  }

  // ── start and stop ─────────────────────────────────────────────────────

  /** Revealed hexes kept from an earlier game on `mapName` (Start again can carry on). */
  seenBefore(mapName: string): number {
    const map: ExploreMap | undefined = this.plugin.getMap(mapName);
    return map ? parseSeen(map.exploreSeen).size : 0;
  }

  /**
   * Start exploring `mapName` (Play's "Start exploring"): the party token
   * on the start hex (an existing one moved, or a new one), the fog on,
   * and what the party sees revealed. Returns the undo entries (one undo).
   */
  async start(mapName: string, how: FogStart): Promise<UndoItem[]> {
    const map = this.plugin.getMap(mapName);
    if (!map || !this.inGrid(map, how.start) || !guardWrite(mapName, FOG_ACTION)) return [];
    const undo: UndoItem[] = [];
    undo.push(...await this.placeParty(mapName, how.start, how.token));
    undo.push(...this.setField(map, "exploreReveal", formatReveal(how.sees)));
    undo.push(...this.setField(map, "exploreFog", "on"));
    // The party must be seen: a map with its tokens layer off shows it again (a view toggle, undone with the start).
    if (map.showTokens === false) {
      undo.push({ kind: "map-field", mapName, field: "showTokens", before: false, after: undefined });
      delete map.showTokens;
    }
    if (how.reset) undo.push(...this.setSeen(map, new Set()));
    const fog = this.fogMap(mapName);
    if (fog) undo.push(...this.revealAround(mapName, how.start).undo);
    void this.plugin.saveSettings();
    return undo;
  }

  /** Put the party on `hex`: token `path` moved there (marked the party), or a new Party token. */
  private async placeParty(mapName: string, hex: string, path: string | undefined): Promise<UndoItem[]> {
    const app = this.plugin.app;
    if (path) {
      const file = app.vault.getAbstractFileByPath(path);
      const t = file instanceof TFile ? getTokenDataFromCache(app, file) : null;
      const before = t && t.map ? { hex: t.hex, map: t.map, visible: t.visible } : null;
      await applyTokenFrontmatter(app, path, { hex, map: mapName, visible: true, party: true });
      return [{ kind: "token", path, before, after: { hex, map: mapName, visible: true } }];
    }
    const folder = `${normalizeFolder(this.plugin.settings.worldFolder) || "world"}/tokens`;
    await ensureFolder(app.vault, folder);
    let name = PARTY_TOKEN_NAME;
    for (let i = 2; app.vault.getAbstractFileByPath(`${folder}/${name}.md`); i++) name = `${PARTY_TOKEN_NAME} ${i}`;
    const file = await app.vault.create(`${folder}/${name}.md`, "");
    await applyTokenFrontmatter(app, file.path, { hex, map: mapName, visible: true, party: true });
    return [{ kind: "token", path: file.path, before: null, after: { hex, map: mapName, visible: true, look: { party: true } } }];
  }

  /** Stop exploring: the fog is lifted; what was seen is kept (Start again can carry on). One undo. */
  stop(mapName: string): UndoItem[] {
    const map = this.fogMap(mapName);
    if (!map || !guardWrite(mapName, FOG_ACTION)) return [];
    const undo = [...this.setField(map, "exploreFog", undefined), ...this.setField(map, "explorePeek", undefined)];
    void this.plugin.saveSettings();
    return undo;
  }

  // ── controls ───────────────────────────────────────────────────────────

  /** Is the GM peeking under the fog of `mapName`? */
  peeking(mapName: string): boolean {
    return this.fogMap(mapName)?.explorePeek === "on";
  }

  /** Turn the GM's peek on or off, and draw the map again. */
  setPeek(mapName: string, on: boolean): void {
    const map = this.fogMap(mapName);
    if (!map || !guardWrite(mapName, FOG_ACTION)) return;
    this.setField(map, "explorePeek", on ? "on" : undefined);
    void this.plugin.saveSettings();
    this.plugin.refreshHexMap();
  }

  /** The fog's edge (the "?" layer): hidden hexes next to revealed ones. */
  frontier(mapName: string): string[] {
    const map = this.fogMap(mapName);
    if (!map) return [];
    return fogEdge(this.seenOf(map), (k) => this.neighbours(map, k));
  }

  /** Hexes the party has stood on (Solo play's visited list), for the Start dialog's default. */
  lastStood(mapName: string): string | undefined {
    const v = parseVisited(this.plugin.getMap(mapName)?.visited);
    return v[v.length - 1];
  }

  /** The middle hex of `map` (the Start dialog's default when nothing else fits). */
  middle(map: MapData): string {
    const o = map.gridOffset ?? { x: 0, y: 0 };
    return hexKey(o.x + Math.floor(map.gridSize.cols / 2), o.y + Math.floor(map.gridSize.rows / 2));
  }
}

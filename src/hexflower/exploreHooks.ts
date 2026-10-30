/**
 * What exploring adds to the map (ModuleRuntime hooks), for both kinds:
 * a map filled as the party goes (ExploreService) and a finished map under
 * fog (FogService, HF11). The party's step and its look around where it
 * stands (its own hex clicked); the party controls, all at the top level
 * so the GM changes them mid-game (owner HF11): Sees 0 · 1 · 2 · 3 (and
 * Look), Peek, Area (a map powered by generators), Reveal hexes (a brush:
 * exactly the hexes picked) and, under fog, Stop. The hex menu's Roll this
 * hex / Reroll this hex, Reveal this hex / Hide again, Start exploring and
 * Stop exploring; the fog itself and the "?" frontier.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { FogView, HexBrush, HexMenuContribution, PartyAt, PartyClick, PartyControl, PartyStep } from "../modules/types";
import type { UndoItem } from "../hex-map/undoItems";
import type { MapData } from "../types";
import { guardWrite } from "../modeGate";
import { workModeOf } from "../workMode";
import { exploreOf, fogOf } from "./context";
import { areaAt, openChangeArea } from "./ChangeAreaModal";
import { formatReveal, MAX_REVEAL, parseReveal } from "./explore";
import { isExploreMap, isFogMap, type ExploreMap } from "./exploreFields";
import { FOG_ACTION } from "./FogService";
import { StartExploringModal } from "./StartExploringModal";

/** The hex menu items (src/workMode.ts: rolling is `discover`, the rest `explore-play`; any mode). */
export const EXPLORE_MENU = {
  roll: { menuId: "hex.explore-roll", label: "Roll this hex", icon: "dices" },
  reroll: { menuId: "hex.explore-reroll", label: "Reroll this hex", icon: "refresh-cw" },
  start: { menuId: "hex.explore-start", label: "Start exploring from here…", icon: "footprints" },
  reveal: { menuId: "hex.explore-reveal-hex", label: "Reveal this hex", icon: "eye" },
  hide: { menuId: "hex.explore-hide-hex", label: "Hide again", icon: "eye-off" },
  stop: { menuId: "hex.explore-stop", label: "Stop exploring", icon: "sun" },
} as const;

/** The party's sight (owner HF11): how many rings every step reveals; Look reveals them where it stands. */
export const SEES_CONTROL_ID = "explore.sees";
/** The party's Area control (HF6): the area it's in; a click opens Change area. */
export const AREA_CONTROL_ID = "explore.area";
/** The GM's peek at the hidden land (owner 2026-10-25), or under the fog (HF11). */
export const PEEK_CONTROL_ID = "explore.peek";
/** The GM's Reveal hexes brush (owner HF11): exactly the hexes picked, nothing around them. */
export const PICK_CONTROL_ID = "explore.pick";
/** Under fog: Stop exploring. */
export const FOG_CONTROL_ID = "explore.fog";

/** The map, when the party explores it either way. */
function exploredMap(plugin: HexmakerPlugin, name: string): ExploreMap | undefined {
  const map = plugin.getMap(name);
  return isExploreMap(map) || isFogMap(map) ? map : undefined;
}

export function exploreStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  const fog = fogOf(plugin);
  if (fog?.fogMap(step.map)) return Promise.resolve(fog.onEnter(step));
  return exploreOf(plugin)?.onEnter(step) ?? Promise.resolve([]);
}

/** The party's own hex clicked on an explored map: a look around (a step in place). */
export function explorePartyClick(plugin: HexmakerPlugin, click: PartyClick): "look" | "none" {
  return click.from === click.to && exploredMap(plugin, click.map) ? "look" : "none";
}

/** The party looks around where it stands: what it sees now is revealed (fog) or filled (blank hexes). */
export async function exploreLook(plugin: HexmakerPlugin, party: PartyAt): Promise<UndoItem[]> {
  const fog = fogOf(plugin);
  if (fog?.fogMap(party.map)) return fog.look(party);
  return (await exploreOf(plugin)?.look(party.map, party.hex)) ?? [];
}

/** Set the party's sight on `mapName` (Party sees, `explore-reveal`): play state, no undo of its own. */
export function setSight(plugin: HexmakerPlugin, mapName: string, rings: number): void {
  const map = exploredMap(plugin, mapName);
  if (!map || !guardWrite(mapName, FOG_ACTION)) return;
  const value = formatReveal(rings);
  if (value === undefined) delete map.exploreReveal;
  else map.exploreReveal = value;
  void plugin.saveSettings();
}

/** The Reveal hexes brush on `mapName`: fog maps reveal or hide, maps filled as they go fill blank hexes. */
export function revealBrush(plugin: HexmakerPlugin, mapName: string): HexBrush {
  const fogged = !!fogOf(plugin)?.fogMap(mapName);
  return {
    id: PICK_CONTROL_ID,
    label: fogged
      ? "Revealing hexes: click or drag over hexes · click a revealed hex or right-click to hide it again"
      : "Filling hexes: click or drag over blank hexes (only those, nothing around them)",
    stroke: async (hexes, erase) => {
      const fog = fogOf(plugin);
      if (fog?.fogMap(mapName)) return fog.brushStroke(mapName, hexes, erase);
      if (erase) return [];
      return (await exploreOf(plugin)?.fillHexes(mapName, hexes)) ?? [];
    },
  };
}

export function explorePartyControls(plugin: HexmakerPlugin, party: PartyAt): PartyControl[] {
  const ex = exploreOf(plugin);
  const fog = fogOf(plugin);
  const map = exploredMap(plugin, party.map);
  if (!map) return [];
  const fogged = !!fog?.fogMap(party.map);
  const sees = parseReveal(map.exploreReveal);
  const out: PartyControl[] = [{
    id: SEES_CONTROL_ID,
    label: "Sees",
    title: "How far the party sees: each step reveals that many rings around the hex it enters (0: only that hex)",
    buttons: [
      ...Array.from({ length: MAX_REVEAL + 1 }, (_, r) => ({
        label: String(r),
        title: r ? `The party sees ${r} ring${r === 1 ? "" : "s"} around it` : "The party sees only the hex it's on",
        selected: r === sees,
        run: () => { setSight(plugin, party.map, r); return Promise.resolve([]); },
      })),
      {
        label: "Look",
        title: "Look around from here with this sight (or click the party's own hex): a step in place",
        run: () => exploreLook(plugin, party),
      },
    ],
  }];
  const area = !fogged && ex ? areaAt(plugin, map, party.hex) : undefined;
  if (area) out.push({
    id: AREA_CONTROL_ID,
    label: "Area",
    title: "The generator the land around the party comes from",
    buttons: [{ label: area, title: "Change area: the land ahead comes from another generator", run: () => openChangeArea(plugin, map, party.hex) }],
  });
  const canPeek = fogged || !!map.exploreRealms?.length;
  const peeking = fogged ? !!fog?.peeking(party.map) : !!ex?.peeking(party.map);
  if (canPeek) out.push({
    id: PEEK_CONTROL_ID,
    label: "Peek",
    title: fogged ? "For the GM: show the map under the fog, faintly" : "For the GM: show the land the party hasn't found yet, faintly, on the blank hexes",
    buttons: [{
      label: peeking ? "Hide" : "Show",
      title: peeking ? "Hide what the party hasn't found yet" : "Show what the party hasn't found yet, faintly",
      selected: peeking,
      run: () => {
        if (fogged) fog?.setPeek(party.map, !peeking);
        else ex?.setPeek(party.map, !peeking);
        return Promise.resolve([]);
      },
    }],
  });
  out.push({
    id: PICK_CONTROL_ID,
    label: "Reveal hexes",
    title: fogged ? "For the GM: reveal exactly the hexes you pick (a town, a quest's goal), nothing around them" : "For the GM: fill exactly the blank hexes you pick, nothing around them",
    buttons: [{ label: "Pick", title: "Click or drag over hexes; Esc stops", brush: revealBrush(plugin, party.map) }],
  });
  if (fogged && fog) out.push({
    id: FOG_CONTROL_ID,
    label: "Exploring",
    title: "The map is under fog: the party reveals it as it goes",
    buttons: [{ label: "Stop", title: "Stop exploring: lift the fog (what was seen is kept for next time)", run: () => Promise.resolve(fog.stop(party.map)) }],
  });
  return out;
}

/** Record `undo` as one undo on `map` and draw it again. */
function done(plugin: HexmakerPlugin, map: string, undo: UndoItem[]): void {
  if (undo.length) plugin.pushUndo(map, undo.length === 1 ? undo[0] : { kind: "group", items: undo });
  plugin.refreshHexMap();
}

/** Open Start exploring for `mapName` at `hex`. */
export function openStartExploring(plugin: HexmakerPlugin, mapName: string, hex?: string): void {
  const fog = fogOf(plugin);
  const map: ExploreMap | undefined = plugin.getMap(mapName);
  if (!fog || !map) return;
  new StartExploringModal(plugin.app, plugin, fog, map, hex, (how) => {
    void fog.start(mapName, how).then((undo) => {
      done(plugin, mapName, undo);
      new Notice("Exploring: select the party token, then click a neighbouring hex to step (its own hex to look around).", 6000);
    });
  }).open();
}

/**
 * The hex menu: Roll this hex (a blank hex of a map filled as it goes;
 * only that hex), Reroll this hex (the latest fill); under fog, Reveal this
 * hex / Hide again and Stop exploring; on any other map in Play, Start
 * exploring from here.
 */
export function exploreHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  const ex = exploreOf(plugin);
  const fog = fogOf(plugin);
  const out: HexMenuContribution[] = [];
  const item = (m: { menuId: string; label: string; icon: string }, run: () => void): HexMenuContribution => ({ id: m.menuId, label: m.label, icon: m.icon, run });
  if (ex?.exploreMap(map)) {
    if (ex.isBlank(map, hex)) out.push(item(EXPLORE_MENU.roll, () => void ex.rollHex(map, hex)));
    if (ex.canReroll(map, hex)) out.push(item(EXPLORE_MENU.reroll, () => void ex.reroll(map)));
    return out;
  }
  const fogMap = fog?.fogMap(map);
  if (fog && fogMap) {
    if (!fog.seenOf(fogMap).has(hex)) out.push(item(EXPLORE_MENU.reveal, () => done(plugin, map, fog.pick(map, [hex], true))));
    else if (fog.canHide(map, hex)) out.push(item(EXPLORE_MENU.hide, () => done(plugin, map, fog.pick(map, [hex], false))));
    out.push(item(EXPLORE_MENU.stop, () => done(plugin, map, fog.stop(map))));
    return out;
  }
  // Not on an overworld: its regions are drawn by their own layer, which the fog doesn't cover.
  if (fog && workModeOf(plugin.getMap(map)) === "play" && !plugin.arrival?.isOverworld(map)) out.push(item(EXPLORE_MENU.start, () => openStartExploring(plugin, map, hex)));
  return out;
}

export function exploreHiddenTerrain(plugin: HexmakerPlugin, map: MapData): ((hex: string) => string | undefined) | undefined {
  const ex = exploreOf(plugin);
  const m = ex?.exploreMap(map.name);
  return m ? ex!.peekFor(m) : undefined;
}

/** The fog over `map` (PlayHooks.fog). */
export function exploreFog(plugin: HexmakerPlugin, map: MapData): FogView | undefined {
  return fogOf(plugin)?.fogView(map);
}

export function exploreFrontier(plugin: HexmakerPlugin, map: string): string[] {
  const fog = fogOf(plugin);
  if (fog?.fogMap(map)) return fog.frontier(map);
  return exploreOf(plugin)?.frontier(map) ?? [];
}

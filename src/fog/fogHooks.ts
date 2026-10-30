/**
 * What fog of war adds to the map (ModuleRuntime hooks, HF11): the party's
 * step and its look around under fog; the party controls Sees 0 · 1 · 2 · 3
 * (and Look) on any explored map, and under fog Peek, Reveal hexes (a brush:
 * exactly the hexes picked) and Stop, all at the top level so the GM changes
 * them mid-game; the hex menu's Reveal this hex / Hide again, Stop exploring
 * and Start exploring; the fog itself and its "?" frontier. A map filled as
 * the party goes adds its own (src/hexflower/exploreHooks.ts).
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { FogView, HexBrush, HexMenuContribution, PartyAt, PartyClick, PartyControl, PartyStep } from "../modules/types";
import type { UndoItem } from "../hex-map/undoItems";
import type { MapData } from "../types";
import { guardWrite } from "../modeGate";
import { runPartyLooked } from "../modules/active";
import { workModeOf } from "../workMode";
import { fogOf } from "./context";
import { isExploreMap, isFogMap, type ExploreMap } from "./exploreFields";
import { FOG_ACTION } from "./FogService";
import { formatReveal, MAX_REVEAL, parseReveal } from "./sight";
import { StartExploringModal } from "./StartExploringModal";

/** The hex menu items (src/workMode.ts: `explore-play`; any mode). */
export const FOG_MENU = {
  start: { menuId: "hex.explore-start", label: "Start exploring from here…", icon: "footprints" },
  reveal: { menuId: "hex.explore-reveal-hex", label: "Reveal this hex", icon: "eye" },
  hide: { menuId: "hex.explore-hide-hex", label: "Hide again", icon: "eye-off" },
  stop: { menuId: "hex.explore-stop", label: "Stop exploring", icon: "sun" },
} as const;

/** The party's sight (owner HF11): how many rings every step reveals; Look reveals them where it stands. */
export const SEES_CONTROL_ID = "explore.sees";
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

export function fogStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  const fog = fogOf(plugin);
  return Promise.resolve(fog?.fogMap(step.map) ? fog.onEnter(step) : []);
}

/** The party's own hex clicked under fog: a look around (a step in place). */
export function fogPartyClick(plugin: HexmakerPlugin, click: PartyClick): "look" | "none" {
  return click.from === click.to && fogOf(plugin)?.fogMap(click.map) ? "look" : "none";
}

/** The party looks around where it stands: what it sees now is revealed. */
export function fogLook(plugin: HexmakerPlugin, party: PartyAt): Promise<UndoItem[]> {
  const fog = fogOf(plugin);
  return Promise.resolve(fog?.fogMap(party.map) ? fog.look(party) : []);
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

/** The Reveal hexes brush under fog: reveal or hide exactly the hexes picked. */
export function revealBrush(plugin: HexmakerPlugin, mapName: string): HexBrush {
  return {
    id: PICK_CONTROL_ID,
    label: "Revealing hexes: click or drag over hexes · click a revealed hex or right-click to hide it again",
    stroke: (hexes, erase) => Promise.resolve(fogOf(plugin)?.brushStroke(mapName, hexes, erase) ?? []),
  };
}

export function fogPartyControls(plugin: HexmakerPlugin, party: PartyAt): PartyControl[] {
  const map = exploredMap(plugin, party.map);
  if (!map) return [];
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
        run: () => runPartyLooked(plugin, party),
      },
    ],
  }];
  const fog = fogOf(plugin);
  if (!fog?.fogMap(party.map)) return out;
  const peeking = fog.peeking(party.map);
  out.push({
    id: PEEK_CONTROL_ID,
    label: "Peek",
    title: "For the GM: show the map under the fog, faintly",
    buttons: [{
      label: peeking ? "Hide" : "Show",
      title: peeking ? "Hide what the party hasn't found yet" : "Show what the party hasn't found yet, faintly",
      selected: peeking,
      run: () => {
        fog.setPeek(party.map, !peeking);
        return Promise.resolve([]);
      },
    }],
  }, {
    id: PICK_CONTROL_ID,
    label: "Reveal hexes",
    title: "For the GM: reveal exactly the hexes you pick (a town, a quest's goal), nothing around them",
    buttons: [{ label: "Pick", title: "Click or drag over hexes; Esc stops", brush: revealBrush(plugin, party.map) }],
  }, {
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
 * The hex menu: under fog, Reveal this hex / Hide again and Stop exploring;
 * on any other map in Play, Start exploring from here. Nothing on a map
 * filled as the party goes.
 */
export function fogHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  const fog = fogOf(plugin);
  if (!fog || isExploreMap(plugin.getMap(map))) return [];
  const out: HexMenuContribution[] = [];
  const item = (m: { menuId: string; label: string; icon: string }, run: () => void): HexMenuContribution => ({ id: m.menuId, label: m.label, icon: m.icon, run });
  const fogMap = fog.fogMap(map);
  if (fogMap) {
    if (!fog.seenOf(fogMap).has(hex)) out.push(item(FOG_MENU.reveal, () => done(plugin, map, fog.pick(map, [hex], true))));
    else if (fog.canHide(map, hex)) out.push(item(FOG_MENU.hide, () => done(plugin, map, fog.pick(map, [hex], false))));
    out.push(item(FOG_MENU.stop, () => done(plugin, map, fog.stop(map))));
    return out;
  }
  // Not on an overworld: its regions are drawn by their own layer, which the fog doesn't cover.
  if (workModeOf(plugin.getMap(map)) === "play" && !plugin.arrival?.isOverworld(map)) out.push(item(FOG_MENU.start, () => openStartExploring(plugin, map, hex)));
  return out;
}

/** The fog over `map` (PlayHooks.fog). */
export function fogViewOf(plugin: HexmakerPlugin, map: MapData): FogView | undefined {
  return fogOf(plugin)?.fogView(map);
}

export function fogFrontier(plugin: HexmakerPlugin, map: string): string[] {
  const fog = fogOf(plugin);
  return fog?.fogMap(map) ? fog.frontier(map) : [];
}

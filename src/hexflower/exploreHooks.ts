/**
 * What a map filled as the party goes adds (ModuleRuntime hooks; a finished
 * map under fog is src/fog/fogHooks.ts, the module before this one): the
 * party's step and its look around where it stands; the party controls after
 * Sees: Area (a map powered by generators), Peek and Reveal hexes (a brush
 * that fills exactly the blank hexes picked). The hex menu's Roll this hex /
 * Reroll this hex; the hidden land under Peek and the "?" frontier.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexBrush, HexMenuContribution, PartyAt, PartyClick, PartyControl, PartyStep } from "../modules/types";
import type { UndoItem } from "../hex-map/undoItems";
import type { MapData } from "../types";
import { exploreOf } from "./context";
import { areaAt, openChangeArea } from "./ChangeAreaModal";
import { isExploreMap } from "../fog/exploreFields";
import { PEEK_CONTROL_ID, PICK_CONTROL_ID } from "../fog/fogHooks";

/** The hex menu items (src/workMode.ts: rolling is `discover`; any mode). */
export const EXPLORE_MENU = {
  roll: { menuId: "hex.explore-roll", label: "Roll this hex", icon: "dices" },
  reroll: { menuId: "hex.explore-reroll", label: "Reroll this hex", icon: "refresh-cw" },
} as const;

/** The party's Area control (HF6): the area it's in; a click opens Change area. */
export const AREA_CONTROL_ID = "explore.area";

export function exploreStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  return exploreOf(plugin)?.onEnter(step) ?? Promise.resolve([]);
}

/** The party's own hex clicked on a map filled as it goes: a look around (a step in place). */
export function explorePartyClick(plugin: HexmakerPlugin, click: PartyClick): "look" | "none" {
  return click.from === click.to && isExploreMap(plugin.getMap(click.map)) ? "look" : "none";
}

/** The party looks around where it stands: the blank hexes it sees now are filled. */
export async function exploreLook(plugin: HexmakerPlugin, party: PartyAt): Promise<UndoItem[]> {
  return (await exploreOf(plugin)?.look(party.map, party.hex)) ?? [];
}

/** The Reveal hexes brush on a map filled as it goes: fills blank hexes. */
export function fillBrush(plugin: HexmakerPlugin, mapName: string): HexBrush {
  return {
    id: PICK_CONTROL_ID,
    label: "Filling hexes: click or drag over blank hexes (only those, nothing around them)",
    stroke: async (hexes, erase) => {
      if (erase) return [];
      return (await exploreOf(plugin)?.fillHexes(mapName, hexes)) ?? [];
    },
  };
}

/** The controls after Sees (src/fog/fogHooks.ts) on a map filled as it goes. */
export function explorePartyControls(plugin: HexmakerPlugin, party: PartyAt): PartyControl[] {
  const ex = exploreOf(plugin);
  const map = plugin.getMap(party.map);
  if (!isExploreMap(map)) return [];
  const out: PartyControl[] = [];
  const area = ex ? areaAt(plugin, map, party.hex) : undefined;
  if (area) out.push({
    id: AREA_CONTROL_ID,
    label: "Area",
    title: "The generator the land around the party comes from",
    buttons: [{ label: area, title: "Change area: the land ahead comes from another generator", run: () => openChangeArea(plugin, map, party.hex) }],
  });
  const peeking = !!ex?.peeking(party.map);
  if (map.exploreRealms?.length) out.push({
    id: PEEK_CONTROL_ID,
    label: "Peek",
    title: "For the GM: show the land the party hasn't found yet, faintly, on the blank hexes",
    buttons: [{
      label: peeking ? "Hide" : "Show",
      title: peeking ? "Hide what the party hasn't found yet" : "Show what the party hasn't found yet, faintly",
      selected: peeking,
      run: () => {
        ex?.setPeek(party.map, !peeking);
        return Promise.resolve([]);
      },
    }],
  });
  out.push({
    id: PICK_CONTROL_ID,
    label: "Reveal hexes",
    title: "For the GM: fill exactly the blank hexes you pick, nothing around them",
    buttons: [{ label: "Pick", title: "Click or drag over hexes; Esc stops", brush: fillBrush(plugin, party.map) }],
  });
  return out;
}

/** The hex menu: Roll this hex (a blank hex; only that hex), Reroll this hex (the latest fill). */
export function exploreHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  const ex = exploreOf(plugin);
  if (!ex?.exploreMap(map)) return [];
  const out: HexMenuContribution[] = [];
  const item = (m: { menuId: string; label: string; icon: string }, run: () => void): HexMenuContribution => ({ id: m.menuId, label: m.label, icon: m.icon, run });
  if (ex.isBlank(map, hex)) out.push(item(EXPLORE_MENU.roll, () => void ex.rollHex(map, hex)));
  if (ex.canReroll(map, hex)) out.push(item(EXPLORE_MENU.reroll, () => void ex.reroll(map)));
  return out;
}

export function exploreHiddenTerrain(plugin: HexmakerPlugin, map: MapData): ((hex: string) => string | undefined) | undefined {
  const ex = exploreOf(plugin);
  const m = ex?.exploreMap(map.name);
  return m ? ex!.peekFor(m) : undefined;
}

export function exploreFrontier(plugin: HexmakerPlugin, map: string): string[] {
  return exploreOf(plugin)?.frontier(map) ?? [];
}

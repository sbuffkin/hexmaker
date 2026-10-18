/**
 * What exploring adds to the map (ModuleRuntime hooks): the party's step,
 * the party controls' Reveal 1 · 2 · 3 and (on a map powered by
 * generators) Area: <the area it's in>, which opens Change area; the hex
 * menu's Roll this hex / Reroll this hex, and the "?" frontier.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexMenuContribution, PartyAt, PartyControl, PartyStep } from "../modules/types";
import type { UndoItem } from "../hex-map/undoItems";
import { exploreOf } from "./context";
import { areaAt, openChangeArea } from "./ChangeAreaModal";

/** The hex menu items (src/workMode.ts classifies each as `discover`: any mode). */
export const EXPLORE_MENU = {
  roll: { menuId: "hex.explore-roll", label: "Roll this hex", icon: "dices" },
  reroll: { menuId: "hex.explore-reroll", label: "Reroll this hex", icon: "refresh-cw" },
} as const;

export function exploreStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  return exploreOf(plugin)?.onEnter(step) ?? Promise.resolve([]);
}

/** The party's Reveal control (owner HF3): fill 1, 2 or 3 rings of blank hexes around it, any time. */
export const REVEAL_CONTROL_ID = "explore.reveal";
/** The party's Area control (HF6): the area it's in; a click opens Change area. */
export const AREA_CONTROL_ID = "explore.area";

export function explorePartyControls(plugin: HexmakerPlugin, party: PartyAt): PartyControl[] {
  const ex = exploreOf(plugin);
  const map = ex?.exploreMap(party.map);
  if (!ex || !map) return [];
  const area = areaAt(plugin, map, party.hex);
  const areaControl: PartyControl[] = area ? [{
    id: AREA_CONTROL_ID,
    label: "Area",
    title: "The generator the land around the party comes from",
    buttons: [{ label: area, title: "Change area: the land ahead comes from another generator", run: () => openChangeArea(plugin, map, party.hex) }],
  }] : [];
  return [...areaControl, {
    id: REVEAL_CONTROL_ID,
    label: "Reveal",
    title: "Fill in the blank hexes around the party, as far as it can see from here",
    buttons: [1, 2, 3].map((r) => ({
      label: String(r),
      title: `Reveal ${r} ring${r === 1 ? "" : "s"} of hexes around the party`,
      run: () => ex.reveal(party.map, party.hex, r),
    })),
  }];
}

/** Roll this hex (a blank hex of an explored map); Reroll this hex (the latest fill). */
export function exploreHexMenu(plugin: HexmakerPlugin, map: string, hex: string): HexMenuContribution[] {
  const ex = exploreOf(plugin);
  if (!ex?.exploreMap(map)) return [];
  const out: HexMenuContribution[] = [];
  if (ex.isBlank(map, hex)) out.push({ id: EXPLORE_MENU.roll.menuId, label: EXPLORE_MENU.roll.label, icon: EXPLORE_MENU.roll.icon, run: () => void ex.rollHex(map, hex) });
  if (ex.canReroll(map, hex)) out.push({ id: EXPLORE_MENU.reroll.menuId, label: EXPLORE_MENU.reroll.label, icon: EXPLORE_MENU.reroll.icon, run: () => void ex.reroll(map) });
  return out;
}

export function exploreFrontier(plugin: HexmakerPlugin, map: string): string[] {
  return exploreOf(plugin)?.frontier(map) ?? [];
}

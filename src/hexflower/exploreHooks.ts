/**
 * What exploring adds to the map (ModuleRuntime hooks): the party's step,
 * the hex menu's Roll this hex / Reroll this hex, and the "?" frontier.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexMenuContribution, PartyStep } from "../modules/types";
import type { UndoItem } from "../hex-map/undoItems";
import { exploreOf } from "./context";

/** The hex menu items (src/workMode.ts classifies each as `discover`: any mode). */
export const EXPLORE_MENU = {
  roll: { menuId: "hex.explore-roll", label: "Roll this hex", icon: "dices" },
  reroll: { menuId: "hex.explore-reroll", label: "Reroll this hex", icon: "refresh-cw" },
} as const;

export function exploreStep(plugin: HexmakerPlugin, step: PartyStep): Promise<UndoItem[]> {
  return exploreOf(plugin)?.onEnter(step) ?? Promise.resolve([]);
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

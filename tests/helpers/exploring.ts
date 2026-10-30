/**
 * The party and hex-menu hooks of Fog and Hex flower as the map sees them:
 * both modules' answers, Fog's first (module order). The behaviour the
 * exploring tests pin down spans the two slices.
 */
import "../../src/modules/runtime"; // the runtimes the Look button walks
import type HexmakerPlugin from "../../src/HexmakerPlugin";
import type { PartyAt, PartyClick, PartyStep } from "../../src/modules/types";
import { fogOf } from "../../src/fog/context";
import { FOG_CONTROL_ID, FOG_MENU, PEEK_CONTROL_ID, PICK_CONTROL_ID, SEES_CONTROL_ID, fogFrontier, fogHexMenu, fogLook, fogPartyClick, fogPartyControls, fogStep, fogViewOf, revealBrush as fogBrush, setSight } from "../../src/fog/fogHooks";
import * as flower from "../../src/hexflower/exploreHooks";

export const { AREA_CONTROL_ID, exploreHiddenTerrain } = flower;
export { FOG_CONTROL_ID, PEEK_CONTROL_ID, PICK_CONTROL_ID, SEES_CONTROL_ID, setSight };
export const EXPLORE_MENU = { ...FOG_MENU, ...flower.EXPLORE_MENU };
export const exploreFog = fogViewOf;

export async function exploreStep(plugin: HexmakerPlugin, step: PartyStep) {
  return [...await fogStep(plugin, step), ...await flower.exploreStep(plugin, step)];
}
export function explorePartyClick(plugin: HexmakerPlugin, click: PartyClick) {
  return [fogPartyClick(plugin, click), flower.explorePartyClick(plugin, click)].includes("look") ? "look" : "none";
}
export async function exploreLook(plugin: HexmakerPlugin, party: PartyAt) {
  return [...await fogLook(plugin, party), ...await flower.exploreLook(plugin, party)];
}
export function explorePartyControls(plugin: HexmakerPlugin, party: PartyAt) {
  return [...fogPartyControls(plugin, party), ...flower.explorePartyControls(plugin, party)];
}
export function exploreHexMenu(plugin: HexmakerPlugin, map: string, hex: string) {
  return [...flower.exploreHexMenu(plugin, map, hex), ...fogHexMenu(plugin, map, hex)];
}
export function exploreFrontier(plugin: HexmakerPlugin, map: string) {
  return [...fogFrontier(plugin, map), ...flower.exploreFrontier(plugin, map)];
}
export function revealBrush(plugin: HexmakerPlugin, map: string) {
  return fogOf(plugin)?.fogMap(map) ? fogBrush(plugin, map) : flower.fillBrush(plugin, map);
}

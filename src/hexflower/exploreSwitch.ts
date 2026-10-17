/**
 * Hex flower as a map setting (owner HF8, 2026-10-16: "make sure it's
 * accessible"): turn exploring on or off for a map that already exists,
 * from Map properties. The same result as the New map card's: the map's
 * `explore-with` rule on a flower (a new one from the map's palette, or one
 * of the vault's), a seed, a "Party" token unless the map has one, and the
 * party's hex filled when it's blank. Turning it off drops the map's
 * exploring keys; the flower note, the token and the filled hexes stay.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import { hashSeed } from "../arrival/arrival";
import { tokensOnMap } from "../modules/play/playLogWriter";
import { markVisited } from "../modules/play/partyTravel";
import { flowerStoreOf, exploreOf } from "./context";
import { formatRule } from "./explore";
import type { ExploreMap } from "./exploreFields";
import { addPartyToken, middleHex, NEW_FLOWER, runFlower } from "./flowerGenerator";

export interface EnableExploring {
  /** NEW_FLOWER ("new": from the map's palette) or a vault flower's name. */
  flower: string;
  /** Put a "Party" token on the middle hex when the map has no party yet. */
  party: boolean;
}

/** Turn exploring on for map `mapName`. Returns the flower note's path (undefined: nothing done). */
export async function enableExploring(plugin: HexmakerPlugin, mapName: string, opts: EnableExploring): Promise<string | undefined> {
  const map: ExploreMap | undefined = plugin.getMap(mapName);
  const store = flowerStoreOf(plugin);
  if (!map || !store) return undefined;
  const terrains = plugin.getPaletteOrPresetTerrains(map.paletteName).map((t) => t.name);
  if (typeof map.seed !== "number") map.seed = hashSeed(mapName);
  const own = opts.flower !== NEW_FLOWER ? store.get(opts.flower) : undefined;
  let path = own?.path;
  if (!path) {
    const flower = runFlower(plugin, NEW_FLOWER, terrains, map.seed, map.paletteName);
    path = await store.create({ ...flower, name: plugin.mapLabel(mapName) });
  }
  map.exploreWith = [formatRule({ source: path.replace(/\.md$/i, ""), target: { kind: "terrain" }, every: false })];
  delete map.hexFlowerAt;

  // Where the party stands: its token, else a new one on the middle hex.
  const party = tokensOnMap(plugin.app, mapName).find((t) => t.party && t.visible !== false);
  let at = party?.hex;
  if (!at && opts.party) {
    at = middleHex({ cols: map.gridSize.cols, rows: map.gridSize.rows, offset: map.gridOffset ?? { x: 0, y: 0 } });
    await addPartyToken(plugin, mapName, at);
  }
  if (at) map.visited = markVisited(map.visited, at);
  await plugin.saveSettings();
  // The party's hex filled from the flower when it's blank (as a new map's middle hex is).
  const ex = exploreOf(plugin);
  if (at && ex?.isBlank(mapName, at)) await ex.fill(mapName, at, undefined);
  return path;
}

/** Turn exploring off for map `mapName`: its exploring keys go; notes, tokens and hexes stay. */
export async function disableExploring(plugin: HexmakerPlugin, mapName: string): Promise<void> {
  const map: ExploreMap | undefined = plugin.getMap(mapName);
  if (!map) return;
  delete map.exploreWith;
  delete map.hexFlowerAt;
  delete map.exploreReveal;
  delete map.exploreGrow;
  await plugin.saveSettings();
}

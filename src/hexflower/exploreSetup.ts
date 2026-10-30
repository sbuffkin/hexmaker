/**
 * New map's "Explore as you go" setup as generator options (HF8 steps 3–4):
 * the generator that powers the home area, more areas each with a
 * direction and a distance, and the party's start hex. They travel in the
 * Hex flower generator's options like any other option (so a saved submap
 * default keeps them):
 *
 *   home:     procedural:overland
 *   areas:    "north-east far builtin:biome-coastal-fjord; south near wfc:world/generators/fen.md"
 *   startHex: 1_1          (unset: the middle of the map)
 *
 * setupRealms turns them into the map's realms, the same way for the
 * preview and for the map made. Pure: no Obsidian imports.
 */

import { hashSeed } from "../arrival/arrival";
import { hexKey, hexXY } from "../hexKey";
import { REACHES, directionOf, placeCentre, uniqueRealmName, type Geometry, type Reach, type Realm, type RealmSource } from "./realms";

export const EXPLORE_OPTION = { home: "home", areas: "areas", startHex: "startHex" } as const;

/** One more area of the setup: a generator, which way and how far. */
export interface SetupArea {
  id: string;
  dir: string;
  reach: Exclude<Reach, "home" | "here">;
}

const AREA_REACHES = REACHES.filter((r): r is SetupArea["reach"] => r !== "home" && r !== "here");

/** The `areas` option → areas (junk entries are skipped). */
export function parseAreas(raw: string | undefined): SetupArea[] {
  const out: SetupArea[] = [];
  for (const part of String(raw ?? "").split(";")) {
    const m = /^\s*([a-z-]+)\s+(near|far|really far)\s+(\S+)\s*$/i.exec(part);
    if (m) out.push({ dir: m[1].toLowerCase(), reach: m[2].toLowerCase() as SetupArea["reach"], id: m[3] });
  }
  return out.filter((a) => AREA_REACHES.includes(a.reach));
}

export function formatAreas(areas: readonly SetupArea[]): string {
  return areas.map((a) => `${a.dir} ${a.reach} ${a.id}`).join("; ");
}

/** The grid a new map is set up on (GridSpec's shape). */
export interface SetupGrid {
  cols: number;
  rows: number;
  offset: { x: number; y: number };
}

/** The middle hex of a grid ("x_y"). */
export function middleOf(grid: SetupGrid): string {
  return hexKey(grid.offset.x + Math.floor(grid.cols / 2), grid.offset.y + Math.floor(grid.rows / 2));
}

/** The party's start: the chosen hex while it's on the grid, else the middle. */
export function startHexOf(grid: SetupGrid, chosen: string | undefined): string {
  if (chosen && /^-?\d+_-?\d+$/.test(chosen.trim())) {
    const { x, y } = hexXY(chosen.trim());
    if (x >= grid.offset.x && y >= grid.offset.y && x < grid.offset.x + grid.cols && y < grid.offset.y + grid.rows) return hexKey(x, y);
  }
  return middleOf(grid);
}

/**
 * The realms an Explore as you go map starts with: home (its generator,
 * centred on the start hex), then each area in its direction and band
 * (placeCentre, seeded by the map's seed and the area's place in the list).
 * `labelOf` names a generator (realm names are made unique). Areas whose
 * direction isn't a side of these hexes are left out.
 */
export function setupRealms(
  options: Readonly<Record<string, string>>,
  start: string,
  seed: number,
  g: Geometry,
  labelOf: (id: string) => string | undefined,
  sourceOf: (id: string) => RealmSource = (id) => ({ ref: id, link: false, weight: 1 }),
): Realm[] {
  const home = options[EXPLORE_OPTION.home]?.trim();
  if (!home) return [];
  const realms: Realm[] = [{ name: uniqueRealmName(labelOf(home) ?? "Home", []), from: [sourceOf(home)], centre: start, reach: "home" }];
  parseAreas(options[EXPLORE_OPTION.areas]).forEach((a, i) => {
    const dir = directionOf(a.dir, g.orientation);
    if (!dir) return;
    realms.push({
      name: uniqueRealmName(labelOf(a.id) ?? "Area", realms.map((r) => r.name)),
      from: [sourceOf(a.id)],
      centre: placeCentre(start, dir, a.reach, hashSeed(seed >>> 0, "setup-area", i), g),
      reach: a.reach,
    });
  });
  return realms;
}

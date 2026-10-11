/**
 * UI inventory ids for the New map form's generator options, so each one
 * is placed by the placement map (src/ui/placement.ts) like any control.
 * Ids are `NewMap.<generator><Option>` from the owner's worksheet; an option
 * without one here is `main`.
 */

import { ORBITS_ID } from "./procedural/orbits";
import { OVERLAND_ID, PLANET_SURFACE_ID, REGION_DETAIL_ID } from "./procedural/planetSurface";
import { STAR_SCATTER_ID } from "./procedural/starScatter";
import { WORLD_BIOMES_ID } from "../overworld/worldBiomes";
import { ORBIT_TYPE_KEY, ROUTE_TYPE_KEY } from "./generatorPathTypes";

export const NEW_MAP_OPTION_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [OVERLAND_ID]: { water: "NewMap.overlandWater", climate: "NewMap.overlandClimate", relief: "NewMap.overlandRelief", sea: "NewMap.overlandSea" },
  [PLANET_SURFACE_ID]: { water: "NewMap.planetWater", climate: "NewMap.planetClimate", relief: "NewMap.planetRelief" },
  [REGION_DETAIL_ID]: { edges: "NewMap.regionDetailInfluence", variety: "NewMap.regionDetailVariety" },
  [WORLD_BIOMES_ID]: { climate: "NewMap.worldBiomesClimate", water: "NewMap.worldBiomesWater", land: "NewMap.worldBiomesLand", north: "NewMap.worldBiomesNorth" },
  [STAR_SCATTER_ID]: { density: "NewMap.starDensity", clouds: "NewMap.starNebulae", routes: "NewMap.starJumpRoutes", [ROUTE_TYPE_KEY]: "NewMap.starRouteType" },
  [ORBITS_ID]: { star: "NewMap.orbitsStar", bodies: "NewMap.orbitsPlanets", [ORBIT_TYPE_KEY]: "NewMap.orbitsPathType" },
};

/** The inventory id of generator `kindId`'s option `key` (undefined: not in the inventory, so main). */
export function newMapOptionId(kindId: string, key: string): string | undefined {
  return NEW_MAP_OPTION_IDS[kindId]?.[key];
}

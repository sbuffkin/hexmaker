/**
 * The Space module's terrain types. The generators place by type (Orbits
 * puts moons beside planets and a jump point past the last orbit), so each
 * of those roles has its own type instead of being told apart by name.
 * Pure data.
 */

import type { TerrainGroupDef, TerrainTypeDef } from "../types";

export const SPACE_TERRAIN_GROUPS: TerrainGroupDef[] = [{ id: "space", label: "Space" }];

const t = (id: string, label: string, keywords: string[]): TerrainTypeDef => ({ id, label, kind: "space", group: "space", keywords });

export const SPACE_TERRAIN_TYPES: TerrainTypeDef[] = [
  t("void", "Void / empty space", ["void", "empty space", "deep space"]),
  t("jump-limit", "Jump limit (ring)", ["jump limit"]),
  t("nebula", "Nebula / cloud", ["nebula", "dust", "cloud"]),
  t("rift", "Rift", ["rift"]),
  t("star", "Star", ["star", "sun", "dwarf", "giant star"]),
  t("star-system", "Star system (sector marker)", ["star system"]),
  t("world", "World / planet", ["world", "planet"]),
  t("moon", "Moon", ["moon", "satellite"]),
  t("gas-giant", "Gas giant", ["gas giant", "ice giant"]),
  t("asteroids", "Asteroid belt", ["asteroid", "belt", "meteor"]),
  t("comet", "Comet", ["comet"]),
  t("debris", "Debris field", ["debris", "wreck"]),
  t("station", "Station", ["station", "outpost"]),
  t("starport", "Starport", ["starport", "spaceport", "port"]),
  t("jump-point", "Jump point / gate", ["jump point", "gate"]),
  t("anomaly", "Anomaly / hazard", ["anomaly", "black hole", "radiation", "hazard"]),
];

/**
 * One-time upgrade for palettes typed before the space roles got their own
 * types (moon, comet, debris, starport, jump point, jump limit, star
 * system). Back then Orbits and Star scatter told those apart by name
 * inside a coarser type; this turns the same name rule into the terrain's
 * Type once, so from then on the Type column alone decides (and can be
 * changed). Returns the refined type, or undefined to leave it as is.
 */
export function refinedSpaceType(t: { name: string; type?: string }): string | undefined {
  const n = t.name;
  switch (t.type) {
    case "world": return /\bmoons?\b|satellite/i.test(n) ? "moon" : undefined;
    case "asteroids":
      if (/comet/i.test(n)) return "comet";
      return /debris|wreck/i.test(n) ? "debris" : undefined;
    case "station":
      if (/jump|gate/i.test(n)) return "jump-point";
      return /port/i.test(n) ? "starport" : undefined;
    case "void": return /limit/i.test(n) ? "jump-limit" : undefined;
    case "star": return /system/i.test(n) ? "star-system" : undefined;
    default: return undefined;
  }
}

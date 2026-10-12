/**
 * The table roles of the Space module's engines: Star scatter rolls each
 * sector hex, Orbits rolls the star and the body on each orbit by zone
 * (plan-tables-everywhere §2.4), and, optionally, each planet's moons and
 * the system's extras (T12: the shipped tables, today's odds, unless a map
 * or setup names its own). Pure data.
 */

import type { EngineRoleDef } from "../types";
import { MOONS_TABLE, SYSTEM_EXTRAS_TABLE } from "./shippedTables";

export const SPACE_TABLE_ROLES: EngineRoleDef[] = [
  {
    id: "sector-hexes",
    engine: "procedural:star-scatter",
    name: "Sector hexes",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids", "station", "starport", "jump-point", "anomaly"],
    help: "What each star system hex of a sector is: its mainworld, or a special hex like a station. A row's Mainworld says which body is that system's mainworld.",
    fallback: "world terrains (no special hexes)",
  },
  {
    id: "star",
    engine: "procedural:orbits",
    name: "Star",
    rows: "terrain",
    terrainTypes: ["star"],
    help: "The star at the centre of a system, when the Star option is Random.",
    fallback: "star terrains",
  },
  {
    id: "inner-orbits",
    engine: "procedural:orbits",
    name: "Inner orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the inner zone (the first 30% of the rings).",
    fallback: "planet terrains",
  },
  {
    id: "habitable-orbits",
    engine: "procedural:orbits",
    name: "Habitable orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the habitable zone (30–60% of the rings).",
    fallback: "planet terrains",
  },
  {
    id: "outer-orbits",
    engine: "procedural:orbits",
    name: "Outer orbits",
    rows: "terrain",
    terrainTypes: ["world", "gas-giant", "asteroids"],
    help: "The body on each orbit in the outer zone (the rest of the rings).",
    fallback: "planet terrains",
  },
  {
    id: "moons",
    engine: "procedural:orbits",
    name: "Moons",
    rows: "text",
    terrainTypes: ["moon"],
    help: "How many moons each planet gets: a number (none, 1, 2…). A When column can tell gas giants from rocky worlds (type: gas-giant).",
    fallback: "the shipped Moons table",
    defaultTable: MOONS_TABLE,
    unsetLabel: "Moons (shipped)",
  },
  {
    id: "system-extras",
    engine: "procedural:orbits",
    name: "System extras",
    rows: "terrain",
    terrainTypes: ["starport", "station", "jump-point", "comet"],
    help: "What else a system has, each row on its own Chance (pick: each): a terrain or terrain type, and Where (beside mainworld, or outside the last orbit).",
    fallback: "the shipped System extras table",
    defaultTable: SYSTEM_EXTRAS_TABLE,
    unsetLabel: "System extras (shipped)",
  },
];

/**
 * The Space module (S slice): sector charts, star systems and planets.
 * Its data: the Space map type, its terrain types, the space icon pack and
 * the Space - Sector / System / Planet presets. What needs the plugin
 * (generators, the World types store, commands) is in ./runtime.ts.
 * Pure data.
 */

import type { HexmakerModule } from "../types";
import { SPACE_TERRAIN_GROUPS, SPACE_TERRAIN_TYPES } from "./terrainTypes";
import { SPACE_PRESETS } from "./presets";
import { BUNDLED_SPACE_ICONS } from "./spaceIcons";
import { SPACE_TABLE_ROLES } from "./tableRoles";

export const spaceModule: HexmakerModule = {
  id: "space",
  slice: "S",
  kind: {
    id: "space",
    label: "Space",
    description: "Sector charts, star systems and planets: Space - Sector, Space - System and Space - Planet palettes, Star scatter, Orbits and Planet surface generators, planet generators, the space icon pack. Pick Space alone and nothing fantasy is installed.",
    sectionWords: {
      Towns: { label: "Settlements", one: "Settlement", noun: "a settlement" },
      Dungeons: { label: "Sites", one: "Site", noun: "a site" },
      Features: { label: "Points of Interest", one: "Point of interest", noun: "a point of interest" },
      Quests: { label: "Missions", one: "Mission", noun: "a mission" },
    },
    // The Region / Location cards on a space map say which to pick for a
    // star system or planet (F10).
    childKindText: {
      region: { title: "Region", desc: "This stretch of space up close, at the same scale as the regions next to it. Not for a single star system or planet." },
      location: { title: "Location", desc: "A star system, planet or station in this hex, with its own map and size. Pick this for a system or a planet." },
    },
    // Generator notes learned from a planet map say `map-kind: planet`.
    aliases: ["planet"],
    offerInContext: true,
    contextOnlyTags: ["planet"],
    carryContextPaths: false,
    iconPackFirst: true,
  },
  terrainTypes: SPACE_TERRAIN_TYPES,
  terrainGroups: SPACE_TERRAIN_GROUPS,
  iconPack: { id: "space", label: "Space", prefix: "space-", icons: BUNDLED_SPACE_ICONS },
  palettes: SPACE_PRESETS,
  tableRoles: SPACE_TABLE_ROLES,
  owns: {
    settingsKeys: ["worldTypesFolder", "worldTypesSeeded"],
    mapNoteKeys: [],
    commands: ["edit-world-types", "convert-world-types"],
  },
};

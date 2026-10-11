/**
 * The World module (released): the fantasy overland map type, the Places
 * icon pack and the Expanded and Limited presets. The land and water
 * terrain types and the noise engines are the core's (CM5: Space - Planet
 * uses them too). Pure data.
 */

import type { HexmakerModule } from "../types";
import { WORLD_PRESETS } from "./presets";
import { BUNDLED_PLACE_ICONS, PLACE_KINDS } from "./placeIcons";

export const worldModule: HexmakerModule = {
  id: "world",
  slice: "F",
  kind: {
    id: "world",
    label: "World / fantasy overland",
    description: "Continents, regions and local areas: forests, mountains, coasts. Includes the Limited and Expanded palettes, the Region detail generator and the Places icon pack (towns, castles, ruins…).",
    // A palette with no other type's terrains, declaring none, is a world palette.
    fallback: true,
  },
  iconPack: {
    id: "places",
    label: "Places",
    prefix: "place-",
    icons: BUNDLED_PLACE_ICONS.map(([file, url]) => [file, url] as const),
    keepOrder: true,
    subgroups: PLACE_KINDS,
    subgroupOf: new Map(BUNDLED_PLACE_ICONS.map(([file, , kind]) => [file, kind])),
  },
  palettes: WORLD_PRESETS,
  owns: { settingsKeys: [], mapNoteKeys: [], commands: [] },
};

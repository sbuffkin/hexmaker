/**
 * The generator page module (slice "genpage"): the full-page terrain
 * generator, where generators are learned from maps, tuned with a live
 * preview, saved and loaded (generator saves), and the library of
 * generators, maps and saves. Making maps from generator notes and the
 * built-in generators is the core's (New map, the setup wizard): a build
 * without this module still lists and runs them, it only has no page to
 * edit them on. Pure data; what needs the plugin is in ./runtime.ts.
 */

import type { HexmakerModule } from "../types";

export const genPageModule: HexmakerModule = {
  id: "gen-page",
  slice: "genpage",
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT).
  placement: {
    // Owner: the generator's overkill controls go in the page's own Advanced
    // dropdown (closed by default) in tidy sub-sections, not behind debug
    // mode, so anyone can open them for one generator. Nothing on this page
    // is Debug.
    "GenPage.clumping": "advanced/Engine tuning",
    "GenPage.edgeSmoothing": "advanced/Engine tuning",
    "GenPage.removeSmallPatches": "advanced/Engine tuning",
    "GenPage.keepRare": "advanced/Engine tuning",
    "GenPage.edgeStrength": "advanced/Engine tuning",
    "GenPage.directionalBias": "advanced/Engine tuning",
    "GenPage.scatter": "advanced/Engine tuning",
    "GenPage.spacing": "advanced/Engine tuning",
    "GenPage.randomness": "advanced/Engine tuning",
    "GenPage.near": "advanced/Engine tuning",
    "GenPage.mixStrength": "advanced/Engine tuning",
    // Single routes: each path type's route list (its fold) carries the
    // route controls with it.
    "GenPage.pathTypeFold": "advanced/Paths",
    "GenPage.pathTypeAvoid": "advanced/Paths",
    "GenPage.routeOn": "advanced/Paths",
    "GenPage.routeCount": "advanced/Paths",
    "GenPage.routeAs": "advanced/Paths",
    "GenPage.routeWiggle": "advanced/Paths",
    "GenPage.routeLength": "advanced/Paths",
    "GenPage.routeFollow": "advanced/Paths",
    // The seed is saved with every save and shown in the saves list; Reroll
    // stays by the preview.
    "GenPage.seed": "advanced/Seed",
    "GenPage.seedLock": "advanced/Seed",
  },
  // How the work modes treat its command (merged into src/workMode.ts).
  modeActions: { commands: { "open-terrain-generator": "view" } },
  owns: {
    settingsKeys: [],
    mapNoteKeys: [],
    commands: ["open-terrain-generator"],
    strings: [
      // The page: its view type, tab title and command name.
      "duckmage-terrain-generator",
      "Terrain generator",
      "Open terrain generator",
      // The library's Saves and Maps tabs.
      "No saves yet. Save a preview with Save, under the preview.",
      "Rename the ticked save (tick one)",
      "Tick one map, or several to combine them into one generator.",
    ],
  },
};

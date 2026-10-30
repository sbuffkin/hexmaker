/**
 * The World maps module (W slice, owner call CM2): overworlds, biomes,
 * neighbouring regions. Not a map type: it works with any. Its code still
 * lives in src/overworld/ and is reached from the core directly (the
 * boundary ratchet counts those edges); plan-code-modules P7 moves it
 * behind this module. Pure data.
 */

import type { HexmakerModule } from "../types";
import { WORLD_MAPS_TABLE_CONDITIONS } from "./tableConditions";

export const worldMapsModule: HexmakerModule = {
  id: "world-maps",
  slice: "worldmaps",
  tableConditions: WORLD_MAPS_TABLE_CONDITIONS,
  // River carves its overworld path's cells into water (overworld paths).
  addedPresetPathFields: [{ pathType: "River", field: "carves" }],
  mapScales: [{
    id: "biomes",
    label: "Biomes",
    description: "A world map of biomes, one per hex, laid out by climate.",
    kind: "world",
    size: { cols: 16, rows: 12 },
    palette: "Expanded",
    generators: ["procedural:world-biomes"],
  }],
  // Where its controls sit (merged into src/ui/placement.ts PLACEMENT).
  placement: {
    "Settings.biomesFolder": "debug",
    "Settings.biomePoolsFolder": "debug",
    // World maps' Biomes scale makes an overworld; "Make every region now"
    // is off and out of the way (a 16 × 12 overworld is 192 regions).
    "Wizard.makeAllRegions": "advanced",
    "BiomePage.seed": "advanced",
    // Biome tuning (owner 2026-10-12): every generator constant of a biome, in
    // Debug sub-sections (src/overworld/biomeTuning.ts TUNING_PARAMS; one id per
    // param, `BiomePage.tune.<camelCase key>`). Engine only shows for a biome
    // that links a generator.
    "BiomePage.tune.reach": "debug/Layout",
    "BiomePage.tune.wiggleScale": "debug/Layout",
    "BiomePage.tune.halo": "debug/Layout",
    "BiomePage.tune.blendK": "debug/Borders & transitions",
    "BiomePage.tune.wiggle": "debug/Borders & transitions",
    "BiomePage.tune.nameSharpness": "debug/Borders & transitions",
    "BiomePage.tune.neighbourInfluence": "debug/Borders & transitions",
    "BiomePage.tune.contextDepth": "debug/Borders & transitions",
    "BiomePage.tune.neighbourFade": "debug/Borders & transitions",
    "BiomePage.tune.bandKeep": "debug/Borders & transitions",
    "BiomePage.tune.keepMix": "debug/Borders & transitions",
    "BiomePage.tune.islandMax": "debug/Water & islands",
    "BiomePage.tune.islandEdge": "debug/Water & islands",
    "BiomePage.tune.beach": "debug/Water & islands",
    "BiomePage.tune.coastWidth": "debug/Water & islands",
    "BiomePage.tune.shoreLean": "debug/Water & islands",
    "BiomePage.tune.shoreRagged": "debug/Water & islands",
    "BiomePage.tune.smoothing": "debug/Patches & detail",
    "BiomePage.tune.fieldHold": "debug/Patches & detail",
    "BiomePage.tune.patchSize": "debug/Patches & detail",
    "BiomePage.tune.patchMax": "debug/Patches & detail",
    "BiomePage.tune.patchEdge": "debug/Patches & detail",
    "BiomePage.tune.clumping": "debug/Engine",
    "BiomePage.tune.mixStrength": "debug/Engine",
    "BiomePage.tune.featureSize": "debug/Engine",
    "BiomePage.tune.scatter": "debug/Engine",
    "BiomePage.tune.randomness": "debug/Engine",
    "BiomePage.tune.edgeSmoothing": "debug/Engine",
    "BiomePage.tune.speckSize": "debug/Engine",
    "BiomePage.tune.keepRare": "debug/Engine",
    "BiomePage.tune.edgeStrength": "debug/Engine",
    "BiomePage.tune.directionalBias": "debug/Engine",
    // World maps' Biomes scale: "Make every region now" (default off, so
    // the first-map step stays simple; the overworld form keeps it in view).
    "NewMap.makeAllRegions": "advanced",
    // New maps & map links › New land beside a map
    "WalkOW.seed": "debug",
    // Regions, overworlds & biomes › New overworld
    "NewOverworld.seed": "debug",
    // Regions, overworlds & biomes › Biome library & biome form
    "BiomeForm.chance": "debug",
    // Regions, overworlds & biomes › Biome picker & paint
    "BiomePicker.enterRegion": "main",
    // Regions, overworlds & biomes › Region settings
    "RegionGen.wigglyBorders": "debug",
    "RegionGen.seed": "debug",
    // Regions, overworlds & biomes › Edit region
    "EditRegion.name": "main",
    "EditRegion.enterRegion": "main",
    "EditRegion.openMapNote": "main",
    "EditRegion.locationsList": "main",
    "EditRegion.notes": "main",
    "EditRegion.blendIntoBiome": "advanced",
  },
  // How the work modes treat its entry points (merged into src/workMode.ts).
  modeActions: {
    commands: { "new-overworld": "new-top-map" },
    // The overworld hex menu's items from overworldMenu() (the core adds Go there, Copy link and Create token itself).
    menus: {
      "ow.enter-region": "navigate",
      "ow.edit-region": "open-editor",
      // Only on a new (open) region: changing it is placing it (regionChangeAction), Build.
      "ow.reroll": "place-biome",
      "ow.lock": "lock-place",
      "ow.set-biome": "place-biome",
      "ow.center": "navigate",
      "ow.locations": "navigate",
    },
  },
  owns: {
    settingsKeys: ["biomesFolder", "biomePoolsFolder", "biomesSeeded", "biomeClimatesSeeded", "biomeColumnsFilled"],
    mapNoteKeys: [],
    commands: ["new-overworld"],
    strings: [
      "New overworld…",
      "World biomes",
      "procedural:world-biomes",
      "Biomes folder",
      "Biome pools folder",
      "Edit region…",
      "Generate overworld…",
      "Make the missing regions",
      "hexmaker-biome",
      // Biome tuning and Blend into <biome> (owner 2026-10-12).
      "Coastline raggedness",
      "Make a generator instead…",
      // Paths between regions on an overworld (owner 2026-10-13).
      "Paths between regions",
    ],
  },
};

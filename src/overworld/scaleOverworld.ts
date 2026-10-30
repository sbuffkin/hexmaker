/**
 * The Biomes map scale (setup wizard's "What are you mapping?", and New
 * map's): the map it makes is an overworld, as Maps → New overworld…
 * makes one. The generator's terrain is already on the map; this adds New
 * overworld…'s region settings (NEW_OVERWORLD_DEFAULTS), the Biome column
 * and, when "Make every region now" is ticked, every region.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { ScaleChoice, ScaleMapMade } from "../modules/types";
import { gridKeys } from "../worldgen/procedural/common";
import { NEW_OVERWORLD_DEFAULTS, finishNewOverworld } from "./overworldGen";
import { WORLD_BIOMES_ID, worldBiomesFromOptions } from "./worldBiomes";

/** The Biomes scale's id (src/modules/world-maps/index.ts). */
export const BIOMES_SCALE_ID = "biomes";

/**
 * "Make every region now": off by default here, so the first-map step stays
 * simple (a 16 × 12 overworld is 192 regions); it sits in the step's Advanced.
 * Regions not made now are made when you first go to their hex.
 */
export const MAKE_ALL_REGIONS_CHOICE: ScaleChoice = {
  key: "makeAll",
  label: "Make every region now",
  desc: "One region map per hex, each blending with its neighbours. Left off, a region is made when you first go to its hex.",
  default: false,
  ids: { Wizard: "Wizard.makeAllRegions", NewMap: "NewMap.makeAllRegions" },
  forGenerators: [WORLD_BIOMES_ID],
};

/** Make the map just created on the Biomes scale an overworld. */
export async function makeScaleOverworld(plugin: HexmakerPlugin, made: ScaleMapMade): Promise<void> {
  // Regions blend from the biome notes: the shipped ones go in first (DJ-Q4).
  await plugin.ensureOverworldBiomes();
  const orientation = plugin.settings.hexOrientation;
  const cells = gridKeys({ ...made.grid, orientation });
  // The same run the generator made (same cells, palette, seed and options),
  // for the biomes behind the terrain. A Blank map gets the region settings only.
  const result = made.generatorId === WORLD_BIOMES_ID
    ? worldBiomesFromOptions(cells, orientation, made.grid.stagger, plugin.getPaletteOrPresetTerrains(made.paletteName), made.seed, made.options)
    : undefined;
  made.onProgress("Setting up the overworld…");
  const t0 = performance.now();
  const r = await finishNewOverworld(plugin, made.mapName, result, {
    ...NEW_OVERWORLD_DEFAULTS,
    makeAll: made.choices[MAKE_ALL_REGIONS_CHOICE.key] ?? MAKE_ALL_REGIONS_CHOICE.default,
    palette: made.paletteName,
    stagger: made.grid.stagger,
    seed: made.seed,
    cells,
    onProgress: (done, total) => made.onProgress(`Making regions: ${done} of ${total}…`),
  });
  made.onProgress("");
  if (r) new Notice(`Made ${r.made.length} regions in ${((performance.now() - t0) / 1000).toFixed(1)} s.${r.errors.length ? ` ${r.errors.length} failed.` : ""}`);
}

/**
 * The World module's runtime: its built-in generators. Both run the core's
 * noise engine (CM5): Region detail zooms into a parent hex, Overland makes
 * a region from noise.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "../types";
import {
  OVERLAND_ID,
  OVERLAND_OPTIONS,
  OVERLAND_TAIL,
  REGION_DETAIL_ID,
  REGION_DETAIL_OPTIONS,
  overlandDescription,
  OVERLAND_TUNING,
  planetSurface,
  planetSurfaceFits,
} from "../../worldgen/procedural/planetSurface";
import { REGION_DETAIL_DESCRIPTION } from "../../worldgen/registry";
import { drawPathRows, pathRowOptions } from "../../worldgen/procedural/pathRows";

function generators(_plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution[] {
  return [
    {
      order: 30,
      id: REGION_DETAIL_ID,
      label: "Region detail",
      mapKind: "world",
      needsContext: true,
      description: REGION_DETAIL_DESCRIPTION,
      source: "built-in",
      options: REGION_DETAIL_OPTIONS,
      fits: planetSurfaceFits,
      generate: (req) => {
        const r = planetSurface(req.terrains, procGrid(req.grid), req.seed, req.options, req.context ?? {});
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toPaths,
    },
    {
      order: 40,
      id: OVERLAND_ID,
      label: "Overland",
      // Planet surface's noise generator under a world name, so world-only
      // users get a procedural map without seeing space options.
      mapKind: "world",
      description: `A region from noise: sea, land and high ground from whatever terrains your palette has. ${OVERLAND_TAIL}`,
      describe: overlandDescription,
      source: "built-in",
      continuesNeighbours: true,
      options: OVERLAND_OPTIONS,
      // One row per path type of the palette: how many to draw (SF8).
      optionsFor: (_terrains, pathTypes) => [...OVERLAND_OPTIONS, ...pathRowOptions(pathTypes)],
      tuning: OVERLAND_TUNING,
      fits: planetSurfaceFits,
      generate: (req) => {
        // Only a neighbouring region's border (edgeCells) is used, not a parent hex.
        const edge = req.context?.edgeCells?.size ? { edgeCells: req.context.edgeCells, neighbourWeight: req.neighbourWeight } : undefined;
        const grid = procGrid(req.grid);
        const r = planetSurface(req.terrains, grid, req.seed, req.options, edge, "overland");
        if (!r.cells.size) return { ok: false, message: r.warnings[0] ?? "Nothing generated." };
        const drawn = drawPathRows(r.cells, req.terrains, grid, req.pathTypes, req.options, req.seed);
        return { ok: true, ...r, paths: [...r.paths, ...drawn] };
      },
      toPaths,
    },
  ];
}

export const worldRuntime: ModuleRuntime = {
  id: "world",
  generators,
  newMapOptionIds: {
    [OVERLAND_ID]: { water: "NewMap.overlandWater", climate: "NewMap.overlandClimate", relief: "NewMap.overlandRelief", sea: "NewMap.overlandSea" },
    [REGION_DETAIL_ID]: { edges: "NewMap.regionDetailInfluence", variety: "NewMap.regionDetailVariety" },
  },
};

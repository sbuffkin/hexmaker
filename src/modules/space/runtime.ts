/**
 * The Space module's runtime: its built-in generators (Star scatter and
 * Orbits roll on the World types tables; Planet surface runs the core's
 * noise engine, CM5).
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "../types";
import type { ProcOption } from "../../worldgen/procedural/common";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS, starScatter, starScatterOffered } from "../../worldgen/procedural/starScatter";
import { ORBITS_ID, ORBITS_OPTIONS, orbits, orbitsFits, orbitsOptions } from "../../worldgen/procedural/orbits";
import { PLANET_SURFACE_ID, PLANET_SURFACE_OPTIONS, planetSurface, planetSurfaceFits } from "../../worldgen/procedural/planetSurface";
import {
  NO_PATHS,
  ORBIT_TYPE_KEY,
  ROUTE_TYPE_KEY,
  chosenPathType,
  pathTypeOption,
  staticPathTypeOption,
} from "../../worldgen/generatorPathTypes";
import { WORLD_TYPES_KEY, worldTypesOption } from "../../space/worldTypesSource";
import { OnceTracker, type FiredEvent } from "../../arrival/eventsLedger";
import { withOnce } from "../../worldgen/tableRoles";

/** The World types option with the vault's tables (Star scatter and Orbits roll on the chosen one, SP1). */
function worldTypesChoice(plugin: HexmakerPlugin): ProcOption {
  const store = plugin.worldTypeStore;
  return worldTypesOption(store.list().map((t) => t.name), store.defaultName());
}

/** The Once rows a run fired, for the outcome (nothing when none). */
const firedEvents = (once: OnceTracker): { events?: FiredEvent[] } => (once.fired.length ? { events: once.fired } : {});

const missingWorldTypes = (name: string) => `No World types table called "${name}", so equal odds.`;

function generators(plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution[] {
  return [
    {
      order: 10,
      id: STAR_SCATTER_ID,
      label: "Star scatter",
      mapKind: "space",
      description: "Sector chart: each hex rolls for a star system, typed by its main world; nebulae and jump routes.",
      source: "built-in",
      options: [...STAR_SCATTER_OPTIONS, worldTypesOption([]), staticPathTypeOption(ROUTE_TYPE_KEY, "routes")],
      optionsFor: (_terrains, pathTypes) => [...STAR_SCATTER_OPTIONS, worldTypesChoice(plugin), pathTypeOption(ROUTE_TYPE_KEY, "routes", pathTypes)],
      fits: starScatterOffered,
      generate: (req) => {
        const routeType = chosenPathType(req.options[ROUTE_TYPE_KEY], "routes", req.pathTypes);
        // None picked on purpose: no routes, and nothing to warn about.
        const options = !routeType && req.options[ROUTE_TYPE_KEY] === NO_PATHS ? { ...req.options, routes: "none" } : req.options;
        const wt = plugin.worldTypeStore.sourceFor(req.options[WORLD_TYPES_KEY], req.terrains, req.tablesFrom);
        const once = new OnceTracker(req.ledgers);
        const r = starScatter(req.terrains, procGrid(req.grid), req.seed, options, routeType, withOnce(wt.source, once));
        if (wt.missing) r.warnings.unshift(missingWorldTypes(wt.missing));
        return r.cells.size ? { ok: true, ...r, ...firedEvents(once) } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toPaths,
    },
    {
      order: 20,
      id: ORBITS_ID,
      label: "Orbits",
      mapKind: "space",
      description: "Star system: a star at the centre, planets on rings by zone, belts, moons, starport and jump point.",
      source: "built-in",
      options: [...ORBITS_OPTIONS, worldTypesOption([]), staticPathTypeOption(ORBIT_TYPE_KEY, "orbits")],
      optionsFor: (terrains, pathTypes) => [...orbitsOptions(terrains), worldTypesChoice(plugin), pathTypeOption(ORBIT_TYPE_KEY, "orbits", pathTypes)],
      fits: orbitsFits,
      generate: (req) => {
        const orbitType = chosenPathType(req.options[ORBIT_TYPE_KEY], "orbits", req.pathTypes);
        const wt = plugin.worldTypeStore.sourceFor(req.options[WORLD_TYPES_KEY], req.terrains, req.tablesFrom);
        const once = new OnceTracker(req.ledgers);
        const r = orbits(req.terrains, procGrid(req.grid), req.seed, req.options, orbitType, req.context, withOnce(wt.source, once));
        if (wt.missing) r.warnings.unshift(missingWorldTypes(wt.missing));
        // No type and not None on purpose: say why there are no rings.
        if (!orbitType && req.options[ORBIT_TYPE_KEY] !== NO_PATHS && r.cells.size)
          r.warnings.push("No path type for orbits, so the rings weren't drawn. Pick one under Path type for orbits (or add a path type to the palette).");
        return r.cells.size ? { ok: true, ...r, ...firedEvents(once) } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toPaths,
    },
    {
      order: 60,
      id: PLANET_SURFACE_ID,
      label: "Planet surface",
      // Space: made for the planets of a star system (System palette submap
      // defaults). Offered there — and to space users — but not on a plain
      // fantasy map, where Region detail / learned generators fit better.
      mapKind: "space",
      description: "Region map from noise: seas, coasts, plains, forests, hills, mountains, deserts, ice. Set water % and climate.",
      source: "built-in",
      options: PLANET_SURFACE_OPTIONS,
      fits: planetSurfaceFits,
      generate: (req) => {
        const r = planetSurface(req.terrains, procGrid(req.grid), req.seed, req.options);
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toPaths,
    },
  ];
}

export const spaceRuntime: ModuleRuntime = {
  id: "space",
  generators,
};

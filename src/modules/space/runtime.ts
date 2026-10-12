/**
 * The Space module's runtime: its built-in generators (Star scatter and
 * Orbits roll on the World types tables; Planet surface runs the core's
 * noise engine, CM5), the World types store, its folder setting, its two
 * commands, the "ref-links" upgrade of World types notes, and the shipped
 * World types table when Space is turned on.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "../types";
import type { ProcOption } from "../../worldgen/procedural/common";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS, starScatter, starScatterOffered } from "../../space/starScatter";
import { ORBITS_ID, ORBITS_OPTIONS, orbits, orbitsFits, orbitsOptions } from "../../space/orbits";
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
import { Notice } from "obsidian";
import { WorldTypesModal } from "../../space/WorldTypesModal";
import { WorldTypeStore } from "../../space/WorldTypeStore";
import { linkWorldTypePalettes, WORLD_TYPES_MARKER } from "../../space/worldTypes";
import { contentFolder } from "../../notePickers";
import { MOON_TETHER_OVERLAY } from "../../space/moonLinks";
import { ROLE_TABLES_SECTION } from "../../space/roleTablesSection";
import { normalizeFolder } from "../../utils";

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

/** "Convert world types to tables": every World types note not yet converted (backed up first). */
export async function convertWorldTypes(plugin: HexmakerPlugin): Promise<void> {
  const r = await plugin.worldTypeStore.convertAll();
  if (!r.converted.length) { new Notice("All world types tables are converted already."); return; }
  const kept = r.kept.length ? ` Kept ${r.kept.length} table${r.kept.length === 1 ? "" : "s"} that already existed.` : "";
  new Notice(`Converted ${r.converted.join(", ")} to tables in ${contentFolder(plugin.settings, "tablesFolder")}/space (${r.written.length} notes).${kept} The old notes were backed up and kept.`, 10000);
}

const WORLD_TYPES_FOLDER_DESC =
  "Vault-relative folder for world types notes (which worlds the space generators place, and how each world's map is made). Defaults to a world-types folder inside the world folder.";

/** World types notes start with this frontmatter key. */
const WORLD_TYPES_NOTE = new RegExp(`^${WORLD_TYPES_MARKER}\\s*:`, "m");

export const spaceRuntime: ModuleRuntime = {
  id: "space",
  generators,
  stores: (plugin) => [new WorldTypeStore(plugin)],
  folderSettings: [{
    id: "Settings.worldTypesFolder",
    key: "worldTypesFolder",
    name: "World types folder",
    placeholder: "World/world-types",
    desc: WORLD_TYPES_FOLDER_DESC,
    changed: (plugin) => void plugin.worldTypeStore.reload(),
  }],
  commands: [
    {
      id: "edit-world-types",
      name: "Edit world types…",
      placementId: "Plugin.cmd.editWorldTypes",
      onlyWhenOn: true,
      run: (plugin) => {
        new WorldTypesModal(plugin.app, plugin, plugin.activeMapName()).open();
      },
    },
    {
      id: "convert-world-types",
      name: "Convert world types to tables",
      available: (plugin) => plugin.worldTypeStore.list().some((t) => !plugin.worldTypeStore.isConverted(t.name)),
      run: (plugin) => convertWorldTypes(plugin),
    },
  ],
  // World types tables' Palette column becomes links (NF3 "ref-links").
  refLinkers: (plugin) => [{
    folder: () => normalizeFolder(plugin.worldTypeStore.folder()),
    rewrite: (text, links) => (WORLD_TYPES_NOTE.test(text) ? linkWorldTypePalettes(text, links) : undefined),
  }],
  // Space turned on (setup or Settings): the shipped "Default space" table, once.
  onEnabled: (plugin) => plugin.worldTypeStore.ensureDefault(),
  // Moons tied to their planet (S11).
  overlays: [MOON_TETHER_OVERLAY],
  // Map properties → Generator tables (T11).
  mapProperties: [ROLE_TABLES_SECTION],
  // The worlds Star scatter and Orbits place come from a World types table
  // (the World types option picks it; this edits it).
  newMapSetup: [{
    forGenerators: [STAR_SCATTER_ID, ORBITS_ID],
    optionKey: WORLD_TYPES_KEY,
    label: "World types",
    render: (row, { plugin, generatorId, originMap }) => {
      const btn = row.createEl("button", { text: "Edit world types…" });
      btn.addEventListener("click", () => {
        new WorldTypesModal(plugin.app, plugin, originMap, undefined, generatorId === ORBITS_ID ? "system" : "sector").open();
      });
    },
  }],
  newMapOptionIds: {
    [PLANET_SURFACE_ID]: { water: "NewMap.planetWater", climate: "NewMap.planetClimate", relief: "NewMap.planetRelief" },
    [STAR_SCATTER_ID]: { density: "NewMap.starDensity", clouds: "NewMap.starNebulae", routes: "NewMap.starJumpRoutes", [ROUTE_TYPE_KEY]: "NewMap.starRouteType" },
    [ORBITS_ID]: { star: "NewMap.orbitsStar", bodies: "NewMap.orbitsPlanets", [ORBIT_TYPE_KEY]: "NewMap.orbitsPathType" },
  },
  // A place made on arrival rolls on the World types tables (and the map's own Tables).
  arrival: {
    tableSourceFor: (plugin, terrains, mapName) => plugin.worldTypeStore.sourceFor(undefined, terrains, mapName).source,
  },
};

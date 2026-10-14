/**
 * The World maps module's runtime: the World biomes generator (an
 * overworld, one biome per hex), the biome notes store, the Biomes and
 * Biome pools folder settings, the New overworld… command, the Biome
 * columns upgrade (BC1), the sandbox demo builders, the shipped biome notes
 * when map types are turned on, and its hooks into the map surfaces
 * (./api.ts).
 */

import { logError } from "../../log";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ModuleRuntime } from "../types";
import { biomeByRef, representableBiomes } from "../../overworld/biomes";
import { WORLD_BIOMES_ID, WORLD_BIOMES_OPTIONS, WORLD_BIOMES_TUNING, worldBiomesFromOptions } from "../../overworld/worldBiomes";
import { gridKeys } from "../../worldgen/procedural/common";
import { BiomeStore } from "../../overworld/BiomeStore";
import { biomePoolsFolder, fillBiomeColumns } from "../../overworld/overworldGen";
import { openNewOverworld } from "../../overworld/mapModalParts";
import { buildBenchWorld, buildDemoWorld } from "../../overworld/demoWorld";
import { VIEW_TYPE_HEX_MAP } from "../../constants";
import { worldMapsApi } from "./api";
import { BIOMES_SCALE_ID, MAKE_ALL_REGIONS_CHOICE, makeScaleOverworld } from "../../overworld/scaleOverworld";

function generators(_plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution[] {
  return [
    {
      order: 50,
      id: WORLD_BIOMES_ID,
      label: "World biomes",
      mapKind: "world",
      description: "An overworld: each hex is one biome (tundra, forest, savanna…), laid out by climate, with transition biomes between ones that shouldn't touch. Its hexes then open into regions that blend with their neighbours.",
      source: "built-in",
      options: WORLD_BIOMES_OPTIONS,
      tuning: WORLD_BIOMES_TUNING,
      fits: (terrains) => representableBiomes(terrains).size >= 3,
      generate: (req) => {
        const g = procGrid(req.grid);
        const r = worldBiomesFromOptions(gridKeys(g), g.orientation, g.stagger, req.terrains, req.seed, req.options);
        // The river is biome data on an overworld, not a path (paths come later).
        return r.terrain.size ? { ok: true, cells: r.terrain, paths: [], warnings: [] } : { ok: false, message: "This palette has no terrains for biomes." };
      },
      toPaths,
    },
  ];
}

const BIOMES_FOLDER_DESC =
  "Vault-relative folder for overworld biome notes (one note per biome: its mix of terrain types, color and transitions). Defaults to a biomes folder inside the world folder.";

const BIOME_POOLS_FOLDER_DESC =
  "Vault-relative folder for biome pool notes (each lists the biomes a generated overworld may use). Defaults to a biome-pools folder inside the world folder.";

export const worldMapsRuntime: ModuleRuntime = {
  id: "world-maps",
  generators,
  newMapOptionIds: {
    [WORLD_BIOMES_ID]: { climate: "NewMap.worldBiomesClimate", water: "NewMap.worldBiomesWater", land: "NewMap.worldBiomesLand", north: "NewMap.worldBiomesNorth" },
  },
  // Overworld biome notes (#50).
  stores: (plugin) => [new BiomeStore(plugin)],
  folderSettings: [
    {
      id: "Settings.biomesFolder",
      key: "biomesFolder",
      name: "Biomes folder",
      placeholder: "World/biomes",
      desc: BIOMES_FOLDER_DESC,
      changed: (plugin) => void plugin.biomeStore.reload(),
    },
    {
      id: "Settings.biomePoolsFolder",
      key: "biomePoolsFolder",
      name: "Biome pools folder",
      placeholder: "World/biome-pools",
      desc: BIOME_POOLS_FOLDER_DESC,
    },
  ],
  folders: (plugin) => [biomePoolsFolder(plugin)],
  commands: [
    {
      id: "new-overworld",
      name: "New overworld…",
      placementId: "Plugin.cmd.newOverworld",
      run: (plugin) => openNewOverworld(plugin),
    },
  ],
  // BC1, once per vault: every overworld hex's biome in its Biome column.
  afterStoresReady: (plugin) => fillBiomeColumns(plugin).catch((e) => logError("filling Biome columns", e)),
  // Biomes picked in the setup wizard: World biomes needs the shipped biome
  // notes, written now as opening New overworld… does (DJ-Q4).
  onScalePicked: async (plugin, scaleId) => {
    if (scaleId === BIOMES_SCALE_ID) await plugin.ensureOverworldBiomes();
  },
  // A Biomes map (setup wizard or New map) is an overworld, as New overworld… makes one.
  scaleSetup: [{ scaleId: BIOMES_SCALE_ID, choices: [MAKE_ALL_REGIONS_CHOICE], afterCreate: makeScaleOverworld }],
  // A map type turned on (setup or Settings): its shipped biome notes.
  onKindsEnabled: (plugin) => plugin.biomeStore.seedShipped(true),
  devTools: (plugin) => ({
    buildDemoWorld: (o?: { seed?: number }) => buildDemoWorld(plugin, o),
    buildBenchWorld: (o?: { seed?: number; side?: number }) => buildBenchWorld(plugin, o),
    // The open map views' overworld layer timings (HexMapView.overworldStats; not imported, so tests load this without Obsidian's views).
    overworldStats: () => plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => (l.view as { overworldStats?: () => unknown }).overworldStats?.() ?? null),
    // Visual checks: set an overworld hex's biome by name ("Caverns", "Alpine 2 + Taiga"), as the Biome painter does.
    paintBiome: async (map: string, x: number, y: number, ref: string) => {
      const id = biomeByRef(ref);
      return id ? worldMapsApi().paintBiomeHex(plugin, map, x, y, id) : { error: `No biome "${ref}"` };
    },
    // ...and open Edit region… on a hex, as the overworld's menu does.
    editRegion: (map: string, x: number, y: number) => {
      const host = {
        app: plugin.app,
        plugin,
        enter: (name: string) => void plugin.showMap(name),
        changed: () => plugin.refreshHexMap(),
        openLocations: () => undefined,
      };
      new (worldMapsApi().EditRegionModal)(host, map, x, y).open();
    },
  }),
  worldMaps: worldMapsApi,
};

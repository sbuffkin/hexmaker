/**
 * The sandbox demo world (plan-overworld-regions §6.2, OW7) and the
 * overworld bench. Only reachable through `plugin.devTools`, which exists
 * only in a vault whose root holds the `.hexmaker-sandbox` marker file
 * (made by dev/demo-world.mjs through the fresh-eyes sandbox). No command,
 * no UI: normal vaults never see it.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import { EXPANDED_PALETTE_NAME } from "../constants";
import { regionsOf } from "../maps/submaps";
import { hexDistance } from "../../packages/hex-wfc/src/grid";
import { formatBiomeRiver, paletteTypeOf, withMeshFields } from "./regionWorld";
import { generateMissingRegions, overworldOf, regionPalette } from "./regionsVault";
import { worldBiomes } from "./worldBiomes";
import { seamStats, interiorAgreement } from "./regionGen";
import { newWorldId } from "../worldgen/world";

export const SANDBOX_MARKER = ".hexmaker-sandbox";

export interface DemoWorldReport {
  overworld: string;
  regions: number;
  regionHexes: number;
  overworldHexes: number;
  locations: string[];
  ms: { overworld: number; regions: number; total: number };
  seams: { typeAgreement: number; interior: number; pairs: number };
  notes: string[];
}

/** The hexes of a hex-shaped overworld of radius r, in its (2r+1)² box. */
export function hexShapeCells(r: number, orientation: "flat" | "pointy", stagger: "odd" | "even"): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y <= 2 * r; y++) for (let x = 0; x <= 2 * r; x++) if (hexDistance([x, y], [r, r], orientation, stagger) <= r) out.push([x, y]);
  return out;
}

/** Make an overworld from World biomes with rectangle regions, and every region. */
export async function buildOverworld(
  plugin: HexmakerPlugin,
  opts: { name: string; cells: [number, number][]; cols: number; rows: number; seed: number; regionSize: number; water?: number },
): Promise<{ name: string; msOverworld: number; msRegions: number; made: number; errors: string[] }> {
  const t0 = performance.now();
  const o = plugin.settings.hexOrientation, s = plugin.settings.staggerOffset ?? "odd";
  const palette = plugin.getPaletteOrPresetTerrains(EXPANDED_PALETTE_NAME);
  const world = worldBiomes(opts.cells, o, s, palette, { seed: opts.seed, climate: "varied", water: opts.water ?? 0.3 });
  const res = await plugin.createNewMap(opts.name, opts.cols, opts.rows, EXPANDED_PALETTE_NAME, 0, 0, s, undefined, world.terrain, { quiet: true });
  if ("error" in res) throw new Error(res.error);
  const map = plugin.getMap(res.name)!;
  map.regions = withMeshFields({ footprint: "rect", size: opts.regionSize, blend: "normal", palette: EXPANDED_PALETTE_NAME }, s, newWorldId);
  if (world.river.length > 1) map.biomeRiver = formatBiomeRiver(world.river);
  map.overworldView = "regions";
  await plugin.saveSettings();
  const t1 = performance.now();
  const { made, errors } = await generateMissingRegions(plugin, res.name);
  return { name: res.name, msOverworld: Math.round(t1 - t0), msRegions: Math.round(performance.now() - t1), made: made.length, errors };
}

/** Seam agreement over every region of an overworld. */
export function overworldSeams(plugin: HexmakerPlugin, overworld: string): DemoWorldReport["seams"] {
  const ow = overworldOf(plugin, overworld);
  if (!ow) return { typeAgreement: 0, interior: 0, pairs: 0 };
  const cells = new Map<string, string>();
  for (const r of regionsOf(plugin.settings.maps, overworld)) for (const [k, h] of plugin.mapStore.all(r.name)) if (h.terrain) cells.set(k, h.terrain);
  const typeOf = paletteTypeOf(regionPalette(plugin, ow.map));
  const seams = seamStats(ow.layout, cells, typeOf);
  const pairs = seams.reduce((n, x) => n + x.pairs, 0);
  return {
    typeAgreement: Math.round((seams.reduce((n, x) => n + x.typeAgreement * x.pairs, 0) / Math.max(1, pairs)) * 1000) / 1000,
    interior: Math.round(interiorAgreement(ow.layout, cells, typeOf) * 1000) / 1000,
    pairs,
  };
}

/**
 * The owner's playtest world: Advanced on, a 19-hex hex-shaped overworld
 * (World biomes) with 8×8 brick regions, all generated, plus a few
 * location stubs (three on one hex to exercise the Locations list).
 */
export async function buildDemoWorld(plugin: HexmakerPlugin, opts: { seed?: number } = {}): Promise<DemoWorldReport> {
  const t0 = performance.now();
  await plugin.enableAdvancedFeature("regions");
  await plugin.enableAdvancedFeature("generators");
  plugin.settings.setupComplete = true;
  await plugin.ensurePaletteInstalled(EXPANDED_PALETTE_NAME);
  const seed = opts.seed ?? 7;
  const o = plugin.settings.hexOrientation, s = plugin.settings.staggerOffset ?? "odd";
  const ow = await buildOverworld(plugin, { name: "Demo Bricks", cells: hexShapeCells(2, o, s), cols: 5, rows: 5, seed, regionSize: 8 });

  // Locations: three on the centre hex, one more elsewhere (blank stubs: no town/dungeon generators yet).
  const locations: string[] = [];
  const stub = async (name: string, hx: number, hy: number) => {
    const r = await plugin.createNewMap(name, 6, 6, EXPANDED_PALETTE_NAME, 0, 0, s, undefined, new Map([["2_2", "urban"]]), { quiet: true });
    if ("error" in r) return;
    await plugin.linkSubmap(ow.name, hx, hy, r.name);
    locations.push(r.name);
  };
  await stub("Saltmere", 2, 2);
  await stub("Fenwick", 2, 2);
  await stub("The Sunken Vault", 2, 2);
  await stub("Old Tower", 1, 1);
  plugin.settings.defaultMap = ow.name;
  await plugin.saveSettings();

  const regions = regionsOf(plugin.settings.maps, ow.name);
  return {
    overworld: ow.name,
    regions: regions.length,
    regionHexes: regions.reduce((n, r) => n + r.gridSize.cols * r.gridSize.rows, 0),
    overworldHexes: 19,
    locations,
    ms: { overworld: ow.msOverworld, regions: ow.msRegions, total: Math.round(performance.now() - t0) },
    seams: overworldSeams(plugin, ow.name),
    notes: [
      ...ow.errors,
      "Hex-flower regions (61 hexes) are not built yet: they need the map-shape mask (plan phase 2b). Only the 8×8 brick overworld is in this demo.",
    ],
  };
}

/** The bench world: a 10×10 overworld with 8×8 regions (100 regions, 6,400 hexes). */
export async function buildBenchWorld(plugin: HexmakerPlugin, opts: { seed?: number; side?: number } = {}): Promise<{ name: string; regions: number; hexes: number; msOverworld: number; msRegions: number }> {
  await plugin.enableAdvancedFeature("regions");
  const side = opts.side ?? 10;
  const cells: [number, number][] = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) cells.push([x, y]);
  const ow = await buildOverworld(plugin, { name: "Bench World", cells, cols: side, rows: side, seed: opts.seed ?? 3, regionSize: 8, water: 0.2 });
  return { name: ow.name, regions: ow.made, hexes: ow.made * 64, msOverworld: ow.msOverworld, msRegions: ow.msRegions };
}

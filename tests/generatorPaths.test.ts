/**
 * Phase 6 (plan-path-anchors §7): generators write anchored paths through
 * the map store. What the map draws (its paths resolved under its own
 * routing context) is exactly what the generator produced, it survives a
 * restart (read back from the note), and regenerating replaces only the
 * generator's own path types.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { MapStore } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { addGeneratedPaths, toMapPaths } from "../src/worldgen/generators";
import { routeContextPaths } from "../src/worldgen/procedural/contextPaths";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import { parseMapNote } from "../src/maps/mapNote";
import { stepsOf } from "../src/paths/fromHexes";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/m/_m.md";
const grid: ProcGrid = { cols: 14, rows: 10, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };

const newMap = (): MapData => ({
  name: "m", paletteName: "Default", gridSize: { cols: grid.cols, rows: grid.rows }, gridOffset: { x: 0, y: 0 },
  staggerOffset: "odd", baseTerrain: "grass", pathChains: [],
} as MapData);

function plugin(vault: MemVault, maps: MapData[]) {
  const p = {
    app: vault.app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { hexFolder: "world/hexes", maps, hexOrientation: "flat" as const, staggerOffset: "odd" as const },
    getMap: (n: string) => maps.find((m) => m.name === n),
    getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
    getMapPathTypes: () => DEFAULT_PATH_TYPES,
    saveData: async () => {},
    refreshHexMap: () => {},
    mapStore: undefined as unknown as MapStore,
  };
  p.mapStore = new MapStore(p as never);
  return p;
}

async function boot(vault: MemVault, maps: MapData[]) {
  const p = plugin(vault, maps);
  await p.mapStore.init();
  return p;
}

/** Grass with a sea channel down column 6 (the road has to bridge it). */
function terrain(): Map<string, string> {
  const m = new Map<string, string>();
  for (let x = 0; x < grid.cols; x++) for (let y = 0; y < grid.rows; y++) m.set(`${x}_${y}`, x === 6 ? "ocean" : "grass");
  return m;
}

const sameSteps = (a: readonly (readonly string[])[], b: readonly (readonly string[])[]) => {
  const x = stepsOf(a), y = stepsOf(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
};

describe("generated paths through the map store", () => {
  it("a new map's generated roads and rivers draw exactly the generated hexes, and again after a restart", async () => {
    const v = new MemVault();
    const maps = [newMap()];
    const p = await boot(v, maps);
    const cells = terrain();
    p.mapStore.setMany("m", [...cells].filter(([, t]) => t !== "grass").map(([k, t]) => [k, { terrain: t }]));
    const generated = routeContextPaths(cells, DEFAULT_TERRAIN_PALETTE, grid, [
      { type: "Road", avoidImpassable: true, autoRoute: "direct", from: "W", to: "E" },
      { type: "River", avoidImpassable: false, autoRoute: "winding", from: "N", to: "S" },
      { type: "Trail", from: "S" },
    ], 7);
    const { paths, missing } = toMapPaths(p as never, generated, undefined, "m");
    expect(missing).toEqual(["Trail"]);
    addGeneratedPaths(p as never, "m", paths);
    await p.mapStore.flush();

    const want = (t: string) => generated.find((g) => g.type === t)!.hexes;
    const drawn = p.mapStore.resolved("m")!;
    expect(drawn.map((r) => [r.typeName, r.hexes])).toEqual([["Road", want("Road")], ["River", want("River")]]);
    // The compatibility view holds the same chains.
    expect(maps[0].pathChains.map((c) => c.hexes)).toEqual([want("Road"), want("River")]);

    // The note stores anchors (fewer than the hexes), not every hex.
    const note = parseMapNote(v.files.get(NOTE)!)!;
    expect(note.paths.map((x) => x.name)).toEqual(["Road", "River"]);
    expect(note.paths[0].branches[0].anchors.length).toBeLessThan(want("Road").length);

    // Restart: a fresh store reads the note and draws the same hexes; nothing is rewritten.
    v.writes = [];
    const again = await boot(v, [newMap()]);
    expect(again.mapStore.resolved("m")!.map((r) => r.hexes)).toEqual([want("Road"), want("River")]);
    expect(v.writes).toEqual([]);
  });

  it("roads that meet become one road with branches; new paths are named around existing ones", async () => {
    const v = new MemVault();
    const maps = [newMap()];
    const p = await boot(v, maps);
    const cells = terrain();
    p.mapStore.setMany("m", [...cells].filter(([, t]) => t !== "grass").map(([k, t]) => [k, { terrain: t }]));
    p.mapStore.setPaths("m", [{ name: "Road", typeName: "Road", branches: [{ anchors: ["0_0", "3_0"] }] }]);
    const generated = routeContextPaths(cells, DEFAULT_TERRAIN_PALETTE, grid, [
      { type: "Road", from: "W" }, { type: "Road", from: "E" }, { type: "Road", from: "S" },
    ], 2);
    const { paths } = toMapPaths(p as never, generated, undefined, "m");
    expect(paths.map((x) => x.name)).toEqual(["Road 2"]);
    expect(paths[0].branches.length).toBeGreaterThan(1);
    addGeneratedPaths(p as never, "m", paths);
    const drawn = p.mapStore.resolved("m")!.filter((r) => r.path === "Road 2").map((r) => r.hexes);
    expect(sameSteps(drawn, generated.map((g) => g.hexes))).toBe(true);
  });

  it("regenerating replaces whole paths of the generator's types and keeps the rest", async () => {
    const v = new MemVault();
    const maps = [newMap()];
    const p = await boot(v, maps);
    p.mapStore.setPaths("m", [
      { name: "King's road", typeName: "Road", notes: "old", branches: [{ anchors: ["0_0", "5_0"] }] },
      { name: "Glass river", typeName: "River", branches: [{ anchors: ["2_0", "2_9"] }] },
    ]);
    const generated = routeContextPaths(terrain(), DEFAULT_TERRAIN_PALETTE, grid, [{ type: "Road", from: "W", to: "E" }], 4);
    const kept = p.mapStore.paths("m").filter((x) => x.typeName !== "Road").map((x) => x.name);
    const { paths } = toMapPaths(p as never, generated, undefined, "m", kept);
    addGeneratedPaths(p as never, "m", paths, new Set(["Road"]));
    expect(p.mapStore.paths("m").map((x) => [x.name, x.typeName])).toEqual([["Glass river", "River"], ["Road", "Road"]]);
  });
});

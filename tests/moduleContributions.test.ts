import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registry } from "../src/modules";
import {
  MODULE_RUNTIMES,
  moduleArrivalTables,
  moduleDevTools,
  moduleFolders,
  moduleMapProperties,
  moduleNewMapOptionIds,
  moduleNewMapSetup,
  moduleOverlays,
  runOnKindsEnabled,
  runOnScalePicked,
  worldMaps,
} from "../src/modules/runtime";
import { MOON_TETHER_OVERLAY } from "../src/space/moonLinks";
import { ROLE_TABLES_SECTION } from "../src/space/roleTablesSection";
import { DEFAULT_SETTINGS } from "../src/constants";

/** P5–P7: the map UI pieces and World maps reach the core only as module contributions. */

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const runtime = (id: string) => MODULE_RUNTIMES.find((r) => r.id === id)!;

describe("P5: map UI pieces are module contributions", () => {
  it("Space's moon tethers are the only overlay; Generator tables the only Map properties section", () => {
    expect(moduleOverlays()).toEqual([MOON_TETHER_OVERLAY]);
    expect(moduleMapProperties()).toEqual([ROLE_TABLES_SECTION]);
    // The Maps modal draws every module's sections; it names none of them.
    const modal = read("src", "hex-map", "MapModal.ts");
    expect(modal).toMatch(/for \(const section of moduleMapProperties\(\)\) section\.render\(/);
    expect(modal).not.toMatch(/renderRoleTables|SPACE_TABLES_FOLDER/);
  });

  it("New map setup: Edit world types… joins the World types option of Star scatter and Orbits only", () => {
    for (const id of ["procedural:star-scatter", "procedural:orbits"]) {
      const extras = moduleNewMapSetup(id);
      expect(extras).toHaveLength(1);
      expect(extras[0]).toMatchObject({ optionKey: "worldTypes", label: "World types" });
    }
    for (const id of ["procedural:overland", "procedural:planet-surface", "procedural:world-biomes", "blank"]) expect(moduleNewMapSetup(id)).toEqual([]);
    const form = read("src", "worldgen", "NewMapSetupModal.ts");
    expect(form).not.toMatch(/WorldTypesModal|WORLD_TYPES_KEY|STAR_SCATTER_ID|ORBITS_ID/);
    expect(form).toMatch(/for \(const extra of kind \? moduleNewMapSetup\(kind\.id\) : \[\]\)/);
  });

  it("arrival and setup roll on the first module's table source (Space: its World types)", () => {
    const calls: unknown[] = [];
    const plugin = { worldTypeStore: { sourceFor: (...a: unknown[]) => { calls.push(a); return { source: { lookup: "x" } }; } } } as never;
    expect(moduleArrivalTables(plugin, ["void"], "sector")).toEqual({ lookup: "x" });
    expect(calls).toEqual([[undefined, ["void"], "sector"]]);
    for (const f of [["src", "arrival", "ArrivalService.ts"], ["src", "worldgen", "NewMapSetupModal.ts"]]) {
      expect(read(...f)).not.toMatch(/worldTypeStore/);
    }
  });

  it("each generator's New map option ids come from its module (no world-maps import in newMapOptionIds.ts)", () => {
    const ids = moduleNewMapOptionIds();
    expect(Object.keys(ids)).toEqual(expect.arrayContaining(["procedural:overland", "procedural:region-detail", "procedural:world-biomes", "procedural:star-scatter", "procedural:orbits", "procedural:planet-surface"]));
    expect(read("src", "worldgen", "newMapOptionIds.ts")).not.toMatch(/overworld|space/);
  });
});

describe("P7: World maps through its contributions", () => {
  it("brings the biome store, both folder settings, New overworld…, the Biome columns upgrade and the pools folder", () => {
    const wm = runtime("world-maps");
    const stores = wm.stores!({} as never);
    expect(stores.map((s) => s.id)).toEqual(["biomes"]);
    expect(wm.folderSettings!.map((d) => d.key)).toEqual(["biomesFolder", "biomePoolsFolder"]);
    expect(wm.commands!.map((c) => [c.id, c.placementId])).toEqual([["new-overworld", "Plugin.cmd.newOverworld"]]);
    expect(typeof wm.afterStoresReady).toBe("function");
    const plugin = { settings: { worldFolder: "World" } } as never;
    expect(moduleFolders(plugin)).toEqual(["World/biome-pools"]);
  });

  it("seeds the shipped biome notes when any map type is turned on (before the types' own content)", async () => {
    const calls: string[] = [];
    const plugin = { biomeStore: { seedShipped: async (explicit: boolean) => { calls.push(`biomes ${explicit}`); } } } as never;
    await runOnKindsEnabled(plugin, ["space"]);
    expect(calls).toEqual(["biomes true"]);
    const src = read("src", "HexmakerPlugin.ts");
    expect(src).toMatch(/await runOnKindsEnabled\(this, plan\.newKinds\);\n\s+await runOnEnabled\(this, plan\.newKinds\);/);
  });

  it("picking the Biomes scale in the setup wizard writes the shipped biome notes (as New overworld… does); other scales don't", async () => {
    const calls: string[] = [];
    const plugin = { ensureOverworldBiomes: async () => { calls.push("biomes"); } } as never;
    await runOnScalePicked(plugin, "overland");
    await runOnScalePicked(plugin, "planet");
    expect(calls).toEqual([]);
    await runOnScalePicked(plugin, "biomes");
    expect(calls).toEqual(["biomes"]);
  });

  it("offers the sandbox dev helpers (only the plugin decides when: the sandbox marker)", () => {
    expect(Object.keys(moduleDevTools({} as never)).sort()).toEqual(["buildBenchWorld", "buildDemoWorld", "overworldStats"]);
  });

  it("its map-surface hooks are one object, made once, and every entry is defined", () => {
    const api = worldMaps()!;
    expect(api).toBe(worldMaps());
    for (const [k, v] of Object.entries(api)) expect({ k, defined: v !== undefined }).toEqual({ k, defined: true });
  });

  it("the core reaches World maps only through worldMaps() and type imports", () => {
    for (const f of [
      ["src", "hex-map", "HexMapView.ts"],
      ["src", "hex-map", "HexEditorModal.ts"],
      ["src", "hex-map", "MapModal.ts"],
      ["src", "hex-map", "newChildMap.ts"],
      ["src", "arrival", "ArrivalService.ts"],
      ["src", "worldgen", "GeneratorPanel.ts"],
      ["src", "HexmakerPlugin.ts"],
    ]) {
      const src = read(...f);
      const valueImports = [...src.matchAll(/^import (?!type )[^;]*from "[./]+overworld\//gm)].map((m) => m[0]);
      expect({ f: f.join("/"), valueImports }).toEqual({ f: f.join("/"), valueImports: [] });
    }
  });

  it("its settings keys have no defaults, and its River carves upgrade is its own", () => {
    for (const k of registry.module("world-maps")!.owns.settingsKeys) expect(k in DEFAULT_SETTINGS).toBe(false);
    expect(registry.addedPresetPathFields()).toEqual([{ pathType: "River", field: "carves" }]);
    expect(registry.module("world-maps")!.addedPresetPathFields).toEqual([{ pathType: "River", field: "carves" }]);
  });
});

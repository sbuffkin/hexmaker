/**
 * Terrain renames end to end through the real plugin class (#43):
 *  - the editor's rename (renameTerrain → renameTerrainInHexes) only
 *    touches maps drawn with that palette; another palette's terrain of
 *    the same name is a different terrain;
 *  - a terrain renamed by hand in a palette note is offered "Rename
 *    everywhere"; the click backs up the map notes and tables it changes,
 *    then renames the hexes and base terrain of that palette's maps and
 *    moves the terrain's tables.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import * as obsidian from "obsidian";
import { gunzipSync } from "node:zlib";
import { MemVault } from "../helpers/memVault";
import { parseMapNote } from "../../src/maps/mapNote";
import type { MapData, TerrainColor, TerrainPalette } from "../../src/types";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;

const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
  if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const A = "world/hexes/a/_a.md";
const B = "world/hexes/b/_b.md";
const C = "world/hexes/c/_c.md";

function wireDataJson(v: MemVault): void {
  const proto = (mock.Plugin as { prototype: Record<string, unknown> }).prototype;
  proto.loadData = async function () {
    const text = v.files.get(DATA);
    return text === undefined ? null : JSON.parse(text);
  };
  proto.saveData = async function (data: unknown) {
    v.files.set(DATA, JSON.stringify(data, null, 2));
  };
}

interface Plugin {
  settings: { maps: MapData[]; terrainPalettes: TerrainPalette[]; tablesFolder: string };
  saveSettings(): Promise<void>;
  renameTerrain(entry: TerrainColor, name: string): Promise<void>;
  paletteStore: { init(): Promise<void>; sync(): Promise<void>; notePathOf(n: string): string | undefined; onModify(f: unknown): void; renames: { answer(path: string, r: { from: string; to: string }, yes: boolean, palette: string): Promise<void>; pendingFor(path: string): { from: string; to: string }[] } };
  mapStore: { init(): Promise<void>; flush(): Promise<void>; all(m: string): ReadonlyMap<string, { terrain?: string }> };
}

async function boot(): Promise<{ v: MemVault; plugin: Plugin }> {
  const v = new MemVault();
  const hexes = (t: string) => ({ "0_0": { terrain: t }, "1_0": { terrain: t }, "2_0": { terrain: "grass" } });
  v.files.set(DATA, JSON.stringify({
    hexFolder: "world/hexes",
    worldFolder: "world",
    tablesFolder: "world/tables",
    defaultPalette: "Limited",
    maps: [
      { name: "a", paletteName: "Limited", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, baseTerrain: "forest" },
      { name: "b", paletteName: "Expanded", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 } },
      { name: "c", paletteName: "Limited", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 } },
    ],
  }, null, 2));
  wireDataJson(v);
  // The terrain's tables (the forest encounters table has rows).
  v.files.set("world/tables/terrain/encounters/forest.md", "---\ndice: 6\nterrain: forest\n---\n\n| Result | Weight |\n| --- | --- |\n| Wolves | 1 |\n| Bandits | 1 |\n");
  v.files.set("world/tables/terrain/description/forest.md", "---\ndice: 6\nterrain: forest\n---\n\n| Result | Weight |\n| --- | --- |\n");
  const app = {
    ...v.app(),
    workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn(), getActiveViewOfType: () => null },
  };
  (app.vault as Record<string, unknown>).on = () => ({});
  (app.metadataCache as Record<string, unknown>).on = () => ({});
  const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
  const plugin = new HexmakerPlugin(app as never, { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" } as never) as unknown as Plugin & Record<string, unknown>;
  plugin.app = app;
  plugin.manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
  plugin.refreshHexMap = () => {};
  plugin.loadAvailableIcons = () => {};
  plugin.ensureRollerLink = async () => {};
  await (plugin as unknown as { loadSettings(): Promise<void> }).loadSettings();
  await plugin.paletteStore.init();
  await plugin.mapStore.init();
  // Terrain on the maps (in the map notes).
  const ms = plugin.mapStore as unknown as { setMany(m: string, c: [string, { terrain: string }][]): void };
  ms.setMany("a", Object.entries(hexes("forest")) as never);
  ms.setMany("b", Object.entries(hexes("forest")) as never);
  ms.setMany("c", [["3_3", { terrain: "forest" }]]);
  await plugin.saveSettings();
  await plugin.mapStore.flush();
  return { v, plugin };
}

/** A map's terrains, as held (the note leaves out hexes of the base terrain). */
const held = (plugin: Plugin, map: string) => [...plugin.mapStore.all(map).values()].map((h) => h.terrain);
/** A map's terrains as written in its note. */
const terrainsIn = (v: MemVault, path: string) => [...parseMapNote(v.files.get(path)!)!.hexes.values()].map((h) => h.terrain);

describe("terrain renames (real plugin)", () => {
  beforeEach(() => { (obsidian.Notice as unknown as { shown: unknown[] }).shown = []; });

  it("the editor's rename only touches maps on that palette", async () => {
    const { v, plugin } = await boot();
    const limited = plugin.settings.terrainPalettes.find((p) => p.name === "Limited")!;
    await plugin.renameTerrain(limited.terrains.find((t) => t.name === "forest")!, "woods");
    await plugin.mapStore.flush();
    expect(held(plugin, "a")).toEqual(["woods", "woods", "grass"]);
    expect(held(plugin, "c")).toEqual(["woods"]);
    expect(terrainsIn(v, B)).toEqual(["forest", "forest", "grass"]); // Expanded's forest is its own
    expect(plugin.settings.maps.find((m) => m.name === "a")!.baseTerrain).toBe("woods");
    // Expanded still has a forest: the tables are copied, not moved
    expect(v.files.has("world/tables/terrain/encounters/forest.md")).toBe(true);
    expect(v.files.has("world/tables/terrain/encounters/woods.md")).toBe(true);
  });

  it("renamed by hand in the palette note: offered, and Rename everywhere backs up, then renames that palette's maps", async () => {
    const { v, plugin } = await boot();
    const path = plugin.paletteStore.notePathOf("Limited")!;
    const text = v.files.get(path)!;
    const row = text.split("\n").find((l) => l.startsWith("| forest |"))!;
    v.files.set(path, text.replace(row, row.replace("| forest |", "| woods |")));
    const shown = (obsidian.Notice as unknown as { shown: { msg: string }[] }).shown;
    shown.length = 0;
    plugin.paletteStore.onModify(v.app().vault.getAbstractFileByPath(path));
    await plugin.paletteStore.sync();
    const offer = shown.find((n) => n.msg.includes('"forest" is now "woods"'));
    expect(offer?.msg).toBe('"forest" is now "woods" in the Limited palette. Still named "forest": 3 hexes on 2 maps, the base terrain of 1 map, 1 table.');
    // nothing changed yet
    await plugin.mapStore.flush();
    expect(held(plugin, "a")).toEqual(["forest", "forest", "grass"]);
    expect(v.files.has("world/tables/terrain/encounters/woods.md")).toBe(false); // waits for the answer

    const before = { a: v.files.get(A)!, c: v.files.get(C)!, table: v.files.get("world/tables/terrain/encounters/forest.md")! };
    await plugin.paletteStore.renames.answer(path, { from: "forest", to: "woods" }, true, "Limited");
    await plugin.mapStore.flush();
    expect(held(plugin, "a")).toEqual(["woods", "woods", "grass"]);
    expect(held(plugin, "c")).toEqual(["woods"]);
    expect(terrainsIn(v, B)).toEqual(["forest", "forest", "grass"]);
    expect(plugin.settings.maps.find((m) => m.name === "a")!.baseTerrain).toBe("woods");
    // Expanded still has a forest, so the tables are copied (its forest keeps them)
    expect(v.files.get("world/tables/terrain/encounters/woods.md")).toContain("Wolves");
    // the backup holds the map notes and the table as they were
    const backups = [...v.binaries.keys(), ...v.files.keys()].filter((k) => k.includes("/backups/terrain-rename-"));
    expect(backups).toHaveLength(1);
    const raw = v.binaries.get(backups[0]);
    const json = JSON.parse(raw ? gunzipSync(raw).toString("utf8") : v.files.get(backups[0])!) as { from: string; to: string; notes: Record<string, string> };
    expect(json.from).toBe("forest");
    expect(json.notes[A]).toBe(before.a);
    expect(json.notes[C]).toBe(before.c);
    expect(json.notes[B]).toBeUndefined();
    expect(json.notes["world/tables/terrain/encounters/forest.md"]).toBe(before.table);
  });

  it("no backup, no change", async () => {
    const { v, plugin } = await boot();
    v.failBinary = true; // the gzipped backup can't be written
    const p = plugin as unknown as { renameTerrainEverywhere(p: string, a: string, b: string): Promise<string | null> };
    expect(await p.renameTerrainEverywhere("Limited", "forest", "woods")).toBeNull();
    await plugin.mapStore.flush();
    expect(held(plugin, "a")).toEqual(["forest", "forest", "grass"]);
    expect(v.files.has("world/tables/terrain/encounters/woods.md")).toBe(false);
  });
});

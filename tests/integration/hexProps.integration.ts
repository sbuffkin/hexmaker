/**
 * Hex-note properties end to end through the real plugin class (MG4):
 * a paint reaches the hex note's property and the map note; an edit of the
 * property reaches the map and the map note; undo puts both back; a new
 * hex note starts with its properties; a restart writes nothing.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import * as obsidian from "obsidian";
import { MemVault } from "../helpers/memVault";
import { parseMapNote } from "../../src/maps/mapNote";
import { cellPatch } from "../../src/undoBook";
import type { UndoItem } from "../../src/hex-map/undoItems";
import { workModeOf } from "../../src/workMode";
import type { MapData } from "../../src/types";
import type { HexPropsSync } from "../../src/maps/hexPropsSync";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;

const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
  if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const NOTE = "world/hexes/coast/_coast.md";
const H12 = "world/hexes/coast/1_2.md";

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
  settings: { maps: MapData[] };
  saveSettings(): Promise<void>;
  hexProps: HexPropsSync;
  undoBook: { step(map: string, mode: string, dir: "undo" | "redo", prepare: (it: UndoItem) => Promise<UndoItem | null>): Promise<UndoItem | null> };
  undoableEdit<T>(map: string, fn: () => T | Promise<T>): Promise<T>;
  createHexNote(x: number, y: number, map: string): Promise<unknown>;
  paletteStore: { init(): Promise<void> };
  mapStore: { init(): Promise<void>; flush(): Promise<void>; get(m: string, k: string): { terrain?: string; region?: string } | undefined; set(m: string, k: string, p: object, a?: string): boolean };
}

function newVault(): MemVault {
  const v = new MemVault();
  v.files.set(DATA, JSON.stringify({
    hexFolder: "world/hexes",
    worldFolder: "world",
    tablesFolder: "world/tables",
    defaultPalette: "Limited",
    maps: [{ name: "coast", paletteName: "Limited", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 } }],
  }, null, 2));
  // A 1.5.x hex note: map data in its frontmatter.
  v.files.set(H12, "---\nterrain: forest\ntags: [sea]\n---\n# Hex 1, 2\n\nA ruined tower.\n");
  return v;
}

async function boot(v: MemVault): Promise<Plugin> {
  wireDataJson(v);
  const app = {
    ...v.app(),
    workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn(), getActiveViewOfType: () => null, getActiveFile: () => null },
  };
  (app.vault as Record<string, unknown>).on = () => ({});
  (app.metadataCache as Record<string, unknown>).on = () => ({});
  const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
  const manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
  const plugin = new HexmakerPlugin(app as never, manifest as never) as unknown as Plugin & Record<string, unknown>;
  plugin.app = app;
  plugin.manifest = manifest;
  plugin.refreshHexMap = () => {};
  plugin.loadAvailableIcons = () => {};
  plugin.ensureRollerLink = async () => {};
  await (plugin as unknown as { loadSettings(): Promise<void> }).loadSettings();
  await plugin.paletteStore.init();
  await plugin.mapStore.init();
  await plugin.hexProps.start();
  return plugin;
}

/** Let both stores write. */
async function settle(plugin: Plugin): Promise<void> {
  await plugin.hexProps.flush();
  await plugin.mapStore.flush();
}

const terrainInNote = (v: MemVault) => v.frontmatter(H12)?.terrain;
const terrainInMapNote = (v: MemVault, key: string) => parseMapNote(v.files.get(NOTE)!)!.hexes.get(key)?.terrain;

async function undo(plugin: Plugin): Promise<void> {
  const map = plugin.settings.maps[0];
  const item = await plugin.undoBook.step(map.name, workModeOf(map), "undo", async (it) => it);
  if (item?.kind !== "cells") throw new Error("no cells to undo");
  for (const e of item.edits) plugin.mapStore.set(e.map, e.key, cellPatch(e, "undo"));
}

describe("hex-note properties (real plugin)", () => {
  beforeEach(() => { (obsidian.Notice as unknown as { shown: unknown[] }).shown = []; });

  it("the upgrade keeps terrain as a property; paint → note and map note; undo restores both", async () => {
    const v = newVault();
    const plugin = await boot(v);
    expect(v.frontmatter(H12)).toEqual({ terrain: "forest", tags: ["sea"], map: "[[_coast]]" });

    await plugin.undoableEdit("coast", () => plugin.mapStore.set("coast", "1_2", { terrain: "grass" }, "paint-terrain"));
    await settle(plugin);
    expect(terrainInNote(v)).toBe("grass");
    expect(terrainInMapNote(v, "1_2")).toBe("grass");

    await undo(plugin);
    await settle(plugin);
    expect(terrainInNote(v)).toBe("forest");
    expect(terrainInMapNote(v, "1_2")).toBe("forest");
  });

  it("an edit of the property → the map and the map note (and undo takes it back)", async () => {
    const v = newVault();
    const plugin = await boot(v);
    const text = v.files.get(H12)!.replace("terrain: forest", "terrain: Grass");
    v.files.set(H12, text);
    plugin.hexProps.onMetadataChanged(v.app().vault.getAbstractFileByPath(H12) as obsidian.TFile, text);
    await settle(plugin);
    expect(plugin.mapStore.get("coast", "1_2")?.terrain).toBe("grass");
    expect(terrainInMapNote(v, "1_2")).toBe("grass");
    expect(terrainInNote(v)).toBe("grass"); // the palette's spelling

    await undo(plugin);
    await settle(plugin);
    expect(terrainInMapNote(v, "1_2")).toBe("forest");
    expect(terrainInNote(v)).toBe("forest");
  });

  it("a new hex note starts with its properties; a restart writes nothing", async () => {
    const v = newVault();
    const plugin = await boot(v);
    plugin.mapStore.set("coast", "4_4", { terrain: "grass" }, "paint-terrain");
    await plugin.createHexNote(4, 4, "coast");
    await settle(plugin);
    expect(v.frontmatter("world/hexes/coast/4_4.md")).toMatchObject({ map: "[[_coast]]", terrain: "grass" });
    await plugin.hexProps.memory.save();

    const before = new Map(v.files);
    v.writes = [];
    const again = await boot(v);
    await settle(again);
    expect(again.hexProps.writes).toBe(0);
    expect(v.writes.filter((p) => !p.startsWith(".obsidian/"))).toEqual([]);
    for (const p of [H12, "world/hexes/coast/4_4.md", NOTE]) expect(v.files.get(p)).toBe(before.get(p));
  });
});

/**
 * Phase 7 (Decision 3): when terrain, the palette, the size or a type's
 * routing would move a route, it's kept by adding anchors, with a notice
 * offering "Reroute instead". RoutePins takes over MapStore's context
 * hook; PathsService asks it to check before drawing.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { Notice } from "obsidian";
import { MapStore } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import type { MapData, PathChain, PathType, TerrainColor } from "../src/types";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { dropAddedAnchors, pinNoticeText, RoutePins } from "../src/paths/routePins";
import { PathsService } from "../src/paths/PathsService";

(globalThis as Record<string, unknown>).window ??= globalThis;

const ROAD_HEXES = ["0_5", "1_5", "2_5", "3_5", "4_5", "5_5", "6_5"];

async function boot(chains: PathChain[], over: Partial<MapData> = {}) {
  const v = new MemVault();
  const maps = [{ name: "m", paletteName: "Default", gridSize: { cols: 14, rows: 10 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd", baseTerrain: "grass", pathChains: chains, ...over } as MapData];
  const state = {
    palette: DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t })) as TerrainColor[],
    types: DEFAULT_PATH_TYPES.map((t) => ({ ...t })) as PathType[],
  };
  const p = {
    app: v.app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { hexFolder: "world/hexes", maps, hexOrientation: "flat" as const, staggerOffset: "odd" as const },
    getMap: (n: string) => maps.find((m) => m.name === n),
    getMapPalette: () => state.palette,
    getMapPathTypes: () => state.types,
    saveData: async () => {},
    refreshHexMap: () => {},
  };
  const store = new MapStore(p as never);
  const pins = new RoutePins({ getMap: p.getMap, mapStore: store });
  pins.attach();
  await store.init();
  const svc = new PathsService({
    isMapReady: (n) => store.isReady(n),
    getMap: p.getMap,
    orientation: () => "flat",
    stagger: () => "odd",
    pathTypes: () => state.types,
    palette: () => state.palette,
    hexData: (n) => store.all(n),
    routesChanging: (n) => pins.sync(n),
  });
  return { v, maps, state, store, pins, svc };
}

const anchors = (maps: MapData[]) => maps[0].paths![0].branches[0].anchors;

describe("keep the route when terrain changes under it (phase 7)", () => {
  beforeEach(() => { Notice.shown = []; });

  it("painting water under a road keeps its hexes and adds anchors, with a 'Kept the route' notice", async () => {
    const { maps, store, pins } = await boot([{ typeName: "Road", hexes: ROAD_HEXES }]);
    const before = store.resolved("m")![0].hexes;
    expect(before).toEqual(ROAD_HEXES);
    const was = [...anchors(maps)];
    store.set("m", "3_5", { terrain: "shallows" }); // water: impassable by its type
    expect(store.resolved("m")![0].hexes).toEqual(before);
    expect(anchors(maps).length).toBeGreaterThan(was.length);
    const recs = pins.flushNotice();
    expect(recs).toHaveLength(1);
    expect(recs[0].before[0].branches[0].anchors).toEqual(was);
    expect(pinNoticeText(recs)).toMatch(/^Kept the route of Road \(\d+ anchors? added\)\.$/);
  });

  it("'Reroute instead' drops those anchors again, so the road goes round the water", async () => {
    const { maps, store, pins } = await boot([{ typeName: "Road", hexes: ROAD_HEXES }]);
    const was = [...anchors(maps)];
    store.set("m", "3_5", { terrain: "shallows" });
    pins.rerouteInstead(pins.flushNotice());
    expect(anchors(maps)).toEqual(was);
    const now = store.resolved("m")![0].hexes;
    expect(now).not.toContain("3_5");
    expect(now[0]).toBe("0_5");
    expect(now[now.length - 1]).toBe("6_5");
  });

  it("painting forest under a road adds nothing", async () => {
    const { maps, store, pins } = await boot([{ typeName: "Road", hexes: ROAD_HEXES }]);
    const was = JSON.stringify(maps[0].paths);
    store.set("m", "3_5", { terrain: "forest" });
    store.resolved("m");
    expect(JSON.stringify(maps[0].paths)).toBe(was);
    expect(pins.flushNotice()).toEqual([]);
  });

  it("toggling a terrain impassable in the palette pins before the next draw", async () => {
    const { maps, store, state, pins, svc } = await boot([{ typeName: "Road", hexes: ROAD_HEXES }]);
    store.set("m", "3_5", { terrain: "forest" });
    expect(svc.resolvedPathChains("m")[0].hexes).toEqual(ROAD_HEXES);
    const was = anchors(maps).length;
    state.palette.find((t) => t.name === "forest")!.impassable = true;
    expect(svc.resolvedPathChains("m")[0].hexes).toEqual(ROAD_HEXES); // the service asked first
    expect(anchors(maps).length).toBeGreaterThan(was);
    expect(pins.flushNotice()).toHaveLength(1);
  });

  it("growing the map pins a route that would now take the new room", async () => {
    // A wall of water down column 2 with a gap at the bottom: a road from
    // 1, 0 to 3, 0 goes all the way round. With a row added above the map,
    // the short way over the top opens up.
    const { maps, store, pins, svc } = await boot([]);
    store.setMany("m", Array.from({ length: 9 }, (_, y) => [`2_${y}`, { terrain: "shallows" }] as [string, { terrain: string }]));
    svc.resolvedPathChains("m"); // as the map view does before the tool draws
    store.setPaths("m", [{ name: "Road", typeName: "Road", branches: [{ anchors: ["1_0", "3_0"] }] }]);
    const before = svc.resolvedPathChains("m")[0].hexes;
    expect(before.length).toBeGreaterThan(15);
    maps[0].gridOffset = { x: 0, y: -1 };
    maps[0].gridSize = { cols: 14, rows: 11 };
    expect(svc.resolvedPathChains("m")[0].hexes).toEqual(before);
    expect(anchors(maps).length).toBeGreaterThan(2);
    expect(pins.flushNotice()).toHaveLength(1);
  });

  it("switching a type's avoidImpassable keeps its roads' routes (pinned), and Reroute instead takes it", async () => {
    const { maps, store, state, pins, svc } = await boot([{ typeName: "Road", hexes: ROAD_HEXES }]);
    const road = state.types.find((t) => t.name === "Road")!;
    road.avoidImpassable = false;
    svc.resolvedPathChains("m"); // the service has seen this style
    store.set("m", "3_5", { terrain: "shallows" }); // no reroute: the road ignores water
    expect(pins.flushNotice()).toEqual([]);
    const was = [...anchors(maps)];
    road.avoidImpassable = true;
    expect(svc.resolvedPathChains("m")[0].hexes).toEqual(ROAD_HEXES);
    expect(anchors(maps).length).toBeGreaterThan(was.length);
    const recs = pins.flushNotice();
    expect(recs).toHaveLength(1);
    pins.rerouteInstead(recs);
    expect(anchors(maps)).toEqual(was);
    expect(svc.resolvedPathChains("m")[0].hexes).not.toContain("3_5");
  });

  it("dropAddedAnchors restores a branch only while its old anchors are all still there", () => {
    const before = { name: "R", typeName: "Road", branches: [{ anchors: ["0_0", "5_0"] }, { anchors: ["2_0", "2_4"] }] };
    const pinned = { ...before, branches: [{ anchors: ["0_0", "2_1", "5_0"] }, { anchors: ["2_0", "2_4", "4_4"] }] };
    expect(dropAddedAnchors(pinned, before).branches.map((b) => b.anchors)).toEqual([["0_0", "5_0"], ["2_0", "2_4"]]);
    const edited = { ...before, branches: [{ anchors: ["0_0", "9_9"] }, { anchors: ["2_0", "2_4"] }] };
    expect(dropAddedAnchors(edited, before)).toBe(edited);
  });
});

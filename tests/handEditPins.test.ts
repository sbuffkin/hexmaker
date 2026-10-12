/**
 * Route pins for hand edits of the map note (#48, plan-path-anchors 3c).
 *
 * A hand edit is read in one step: terrain typed into the Hexes table can
 * move routes (pinned, with "Reroute instead", like painting), while
 * anchors typed into Path routes are the person's own route. When one edit
 * does both, only the segments that were already drawn keep their route;
 * the segments it added are routed on the map as it is now, never pinned
 * to the terrain before the edit. The same holds when the edit is folded
 * into a pending write (the note changed before its modify event ran).
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { Notice } from "obsidian";
import { MapStore } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { MemVault } from "./helpers/memVault";
import type { MapData, MapPath, PathChain, PathType, TerrainColor } from "../src/types";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { mapRouteContext, pathTypeStyleFor } from "../src/paths/mapContext";
import { contextRouter } from "../src/paths/routeCache";
import { pinChanged, segmentFn } from "../src/paths/edit";
import { pinNoticeText, RoutePins } from "../src/paths/routePins";
import { impassableNames } from "../src/impassable";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/m/_m.md";
const ROAD = ["0_5", "1_5", "2_5", "3_5", "4_5", "5_5", "6_5"];

async function boot(chains: PathChain[]) {
  const v = new MemVault();
  const maps = [{ name: "m", paletteName: "Default", gridSize: { cols: 14, rows: 10 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd", baseTerrain: "grass", pathChains: chains } as MapData];
  const state = { palette: DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t })) as TerrainColor[], types: DEFAULT_PATH_TYPES.map((t) => ({ ...t })) as PathType[] };
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
  store.resolved("m"); // drawn once, as the map view does
  await store.flush();
  const file = () => p.app.vault.getAbstractFileByPath(NOTE) as never;
  /** A hand edit, read by the modify event. */
  const modify = async (text: string) => {
    v.files.set(NOTE, text);
    store.onModify(file());
    await store.flush();
  };
  return { v, maps, store, pins, modify };
}

/** The note with hex rows added to the Hexes table. */
const withHexes = (text: string, rows: [string, string][]) =>
  text.replace(/(\| Hex \| Name \| Terrain[^\n]*\n\| ---[^\n]*\n)/, "$1" + rows.map(([k, t]) => `| ${k} |  | ${t} |  |  |  |  |  |\n`).join(""));
const routeRow = (text: string) => text.split("\n").find((l) => l.startsWith("| Road | main |"))!;
/** The road's main row with `9, 5` typed on at the end. */
const extendTo95 = (text: string) => text.replace(routeRow(text), routeRow(text).replace(/ \|$/, " → 9, 5 |"));
const anchors = (maps: MapData[]) => maps[0].paths![0].branches[0].anchors;

describe("route pins for hand edits of the map note", () => {
  beforeEach(() => { Notice.shown = []; });

  it("water typed under a road in the Hexes table keeps the road, with 'Kept the route' and Reroute instead", async () => {
    const { v, maps, store, pins, modify } = await boot([{ typeName: "Road", hexes: ROAD }]);
    const was = [...anchors(maps)];
    await modify(withHexes(v.files.get(NOTE)!, [["3_5", "shallows"]]));
    expect(store.resolved("m")![0].hexes).toEqual(ROAD);
    expect(anchors(maps).length).toBeGreaterThan(was.length);
    const recs = pins.flushNotice();
    expect(pinNoticeText(recs)).toMatch(/^Kept the route of Road \(1 anchor added\)\.$/);
    // the pin is written to the note
    await store.flush();
    expect(parseMapNote(v.files.get(NOTE)!)!.paths[0].branches[0].anchors).toEqual(anchors(maps));
    pins.rerouteInstead(recs);
    expect(anchors(maps)).toEqual(was);
    expect(store.resolved("m")![0].hexes).not.toContain("3_5");
  });

  it("anchors typed by hand alone: imported as typed, nothing pinned", async () => {
    const { v, maps, store, pins, modify } = await boot([{ typeName: "Road", hexes: ROAD }]);
    const was = [...anchors(maps)];
    await modify(extendTo95(v.files.get(NOTE)!));
    expect(anchors(maps)).toEqual([...was, "9_5"]);
    expect(pins.flushNotice()).toEqual([]);
    expect(store.resolved("m")![0].hexes.slice(-1)).toEqual(["9_5"]);
  });

  it("anchors and terrain in one edit: the old segments keep their route, the new one goes round the new water", async () => {
    const { v, maps, store, pins, modify } = await boot([{ typeName: "Road", hexes: ROAD }]);
    const was = [...anchors(maps)];
    await modify(extendTo95(withHexes(v.files.get(NOTE)!, [["3_5", "shallows"], ["7_5", "shallows"]])));
    const hexes = store.resolved("m")![0].hexes;
    expect(hexes.slice(0, ROAD.length)).toEqual(ROAD); // the drawn road still crosses 3, 5
    expect(hexes).not.toContain("7_5"); // the typed-in stretch avoids the water typed with it
    expect(hexes.slice(-1)).toEqual(["9_5"]);
    expect(anchors(maps)).toEqual([was[0], "3_5", ...was.slice(1), "9_5"]);
    const recs = pins.flushNotice();
    expect(recs).toHaveLength(1);
    expect(recs[0].added).toEqual([{ path: "Road", added: 1 }]);
  });

  it("the same edit folded into a pending write (no modify event yet) pins the same way", async () => {
    const { v, maps, store, pins } = await boot([{ typeName: "Road", hexes: ROAD }]);
    v.files.set(NOTE, extendTo95(withHexes(v.files.get(NOTE)!, [["3_5", "shallows"], ["7_5", "shallows"]]))); // not read yet
    store.set("m", "12_0", { terrain: "forest" }); // our own pending edit
    await store.flush();
    const hexes = store.resolved("m")![0].hexes;
    expect(hexes.slice(0, ROAD.length)).toEqual(ROAD);
    expect(hexes).not.toContain("7_5");
    expect(hexes.slice(-1)).toEqual(["9_5"]);
    expect(store.all("m").get("12_0")?.terrain).toBe("forest");
    expect(pins.flushNotice().map((r) => r.added)).toEqual([[{ path: "Road", added: 1 }]]);
    await store.flush();
    expect(parseMapNote(v.files.get(NOTE)!)!.paths[0].branches[0].anchors).toEqual(anchors(maps));
  });
});

describe("pinChanged with drawnBefore", () => {
  const P = (name: string, typeName: string, ...branches: string[][]): MapPath => ({ name, typeName, branches: branches.map((a) => ({ anchors: a })) });
  const ctxWith = (water: string[]) => mapRouteContext({
    orientation: "flat", stagger: "odd", gridSize: { cols: 14, rows: 10 }, gridOffset: { x: 0, y: 0 }, baseTerrain: "grass",
    terrainOf: new Map(water.map((k) => [k, { terrain: "shallows" }])), impassable: impassableNames(DEFAULT_TERRAIN_PALETTE),
  });

  it("only segments that were drawn before (same type, same anchors, same order) are pinned", () => {
    const style = pathTypeStyleFor(DEFAULT_PATH_TYPES);
    const old = segmentFn(contextRouter(ctxWith([])), style);
    const now = segmentFn(contextRouter(ctxWith(["3_5", "7_5"])), style);
    const drawn = [P("Road", "Road", ["0_5", "5_5", "6_5"])];
    const edited = [P("Road", "Road", ["0_5", "5_5", "6_5", "9_5"]), P("Track", "Road", ["3_2", "3_8"])];
    const r = pinChanged(edited, old, now, ctxWith(["3_5", "7_5"]), drawn);
    expect(r.pinned).toEqual([{ path: "Road", added: 1 }]);
    expect(r.paths[0].branches[0].anchors).toEqual(["0_5", "3_5", "5_5", "6_5", "9_5"]);
    expect(r.paths[1]).toBe(edited[1]); // new: routed under the new terrain, untouched
    // a type change makes it a new segment too
    expect(pinChanged([P("Road", "River", ["0_5", "5_5", "6_5"])], old, now, undefined, drawn).pinned).toEqual([]);
    // without drawnBefore every changed segment is pinned (painting, palette changes)
    expect(pinChanged(edited, old, now, ctxWith(["3_5", "7_5"])).pinned.map((p) => p.path)).toEqual(["Road", "Track"]);
  });
});

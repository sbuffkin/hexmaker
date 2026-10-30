/**
 * The path tool across region seams, end to end (owner O1, 2026-10-14):
 * hook onto a neighbour region's road from the strip and extend it here,
 * carry a road drawn to the edge on into the next region, and the overworld
 * joins the two halves into one line at once.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { Notice } from "./__mocks__/obsidian";
import type { MapData, MapPath, PathType } from "../src/types";
import { PathTool, type PathToolHost } from "../src/hex-map/pathTool";
import { PathsService } from "../src/paths/PathsService";
import { latticeCenter } from "../src/paths/pathGeometry";
import type { StripRef } from "../src/paths/seamHook";
import { childNeighbours, parentOf, regionBox, regionCells, regionCentreCell, type RegionLayout } from "../src/overworld/layout";
import { crossRegionLines, piecesOf } from "../src/overworld/regionPaths";

const T = (name: string, color: string): PathType => ({ name, color, width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" });
const TYPES = [T("Road", "#a33"), T("River", "#33a")];
const layout: RegionLayout = { footprint: "rect", size: 6, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
const P = { West: [1, 1] as [number, number], East: [2, 1] as [number, number] };
const k = (x: number, y: number) => `${x}_${y}`;
const centre = (r: keyof typeof P) => k(...regionCentreCell(layout, ...P[r]));

/** A West hex touching an East hex across their seam. */
function seam(): [string, string] {
  for (const [x, y] of regionCells(layout, ...P.West)) {
    for (const [nx, ny] of childNeighbours(layout, x, y)) {
      const [qx, qy] = parentOf(layout, nx, ny);
      if (qx === P.East[0] && qy === P.East[1]) return [k(x, y), k(nx, ny)];
    }
  }
  throw new Error("no seam");
}

function world() {
  const maps: Record<string, MapData> = {};
  for (const name of ["West", "East"] as const) {
    const b = regionBox(layout, ...P[name]);
    maps[name] = { name, gridOffset: { x: b.x, y: b.y }, gridSize: { cols: b.cols, rows: b.rows }, paths: [] as MapPath[] } as unknown as MapData;
  }
  const svc = new PathsService({
    isMapReady: () => true,
    getMap: (n) => maps[n],
    orientation: () => "flat",
    stagger: () => "odd",
    pathTypes: () => TYPES,
    palette: () => [],
    hexData: () => new Map(),
  });
  const plugin = {
    app: {},
    mapStore: { paths: (n: string) => maps[n].paths ?? [], setPaths: (n: string, ps: MapPath[]) => { maps[n].paths = ps; } },
    paths: svc,
    saveSettings: async () => {},
    getMapPalette: () => [],
    getMap: (n: string) => maps[n],
    getMapPathTypes: () => TYPES,
    mapLabel: (n: string) => n,
  };
  /** The strip of map `name`: the other region's cells (they share one grid). */
  const stripOf = (name: string): Map<string, StripRef> => {
    const other = name === "West" ? "East" : "West";
    return new Map(regionCells(layout, ...P[other as keyof typeof P]).map(([x, y]) => [k(x, y), { map: other, x, y }]));
  };
  let current = "East";
  const opened: { map: string; hex: string }[] = [];
  const typeChanges: string[] = [];
  const host: PathToolHost = {
    plugin: plugin as never,
    mapName: () => current,
    // Events carry lattice coordinates straight through.
    pointerLattice: (e) => ({ cx: e.clientX, cy: e.clientY }),
    hexAtPoint: () => null,
    ownerDocument: () => ({ addEventListener: () => {}, removeEventListener: () => {} }) as unknown as Document,
    pushUndo: () => {},
    redraw: () => {},
    refreshBar: () => {},
    setGrabCursor: () => {},
    typeChanged: () => { typeChanges.push(tool.typeName ?? ""); },
    neighbourStrip: () => stripOf(current),
    openNeighbour: (map, hex, arm) => {
      opened.push({ map, hex });
      tool.reset(); // the view leaves the tool on the old map…
      current = map; // …goes there…
      arm(); // …and sets it up again
    },
  };
  const tool = new PathTool(host);
  const at = (key: string) => {
    const c = latticeCenter(key, { orientation: "flat", stagger: "odd" });
    return { clientX: c.cx, clientY: c.cy };
  };
  const click = (key: string) => {
    const [x, y] = key.split("_").map(Number);
    tool.click(x, y, at(key), false);
  };
  const lines = () => crossRegionLines(layout, [
    ...piecesOf("West", svc.resolved("West"), maps.West.paths ?? []),
    ...piecesOf("East", svc.resolved("East"), maps.East.paths ?? []),
  ]);
  return { maps, tool, at, click, lines, opened, typeChanges, setMap: (m: string) => { current = m; } };
}

describe("hooking onto a neighbour region's road (O1)", () => {
  beforeEach(() => { Notice.shown = []; });

  it("a click on its end in the strip starts a path beside it, its type and name; more clicks extend it; the overworld joins them", () => {
    const w = world();
    const [a] = seam();
    w.maps.West.paths = [{ name: "Kings Road", typeName: "Road", branches: [{ anchors: [centre("West"), a] }] }];
    expect(w.lines()).toEqual([]); // one region only: not on the overworld
    w.tool.typeName = "River"; // the tool was on another type
    expect(w.tool.clickStrip(w.at(a))).toBe(true);
    expect(w.tool.typeName).toBe("Road");
    expect(w.typeChanges).toEqual(["Road"]);
    const start = w.tool.activeHex()!;
    expect(childNeighbours(layout, ...(start.split("_").map(Number) as [number, number])).map(([x, y]) => k(x, y))).toContain(a);
    w.click(centre("East"));
    expect(w.maps.East.paths).toEqual([{ name: "Kings Road", typeName: "Road", branches: [{ anchors: [start, centre("East")] }] }]);
    const lines = w.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0].regions.sort()).toEqual(["East", "West"]);
    expect(lines[0].names).toEqual(["Kings Road"]);
  });

  it("a click on the strip away from any path end is left to the strip (go there)", () => {
    const w = world();
    expect(w.tool.clickStrip(w.at(centre("West")))).toBe(false);
  });

  it("starting by hand on a hex beside its end, same type, takes its name too", () => {
    const w = world();
    const [a, b] = seam();
    w.maps.West.paths = [{ name: "Kings Road", typeName: "Road", branches: [{ anchors: [centre("West"), a] }] }];
    w.tool.typeName = "Road";
    w.click(b);
    w.click(centre("East"));
    expect((w.maps.East.paths ?? []).map((p) => p.name)).toEqual(["Kings Road"]);
    expect(w.lines()).toHaveLength(1);
  });

  it("a type this map doesn't have: says so, starts nothing", () => {
    const w = world();
    const [a] = seam();
    w.maps.West.paths = [{ name: "Old Way", typeName: "Causeway", branches: [{ anchors: [centre("West"), a] }] }];
    expect(w.tool.clickStrip(w.at(a))).toBe(true);
    expect(w.tool.activeHex()).toBeNull();
    expect(Notice.shown.map((n) => n.msg).join("\n")).toContain("has no Causeway path type");
  });
});

describe("carrying a road on across the seam (O1)", () => {
  beforeEach(() => { Notice.shown = []; });

  it("drawn up to the edge, a click in the strip goes on in the neighbour, joined on the overworld", () => {
    const w = world();
    const [a, b] = seam();
    w.setMap("West");
    w.tool.typeName = "Road";
    w.click(centre("West"));
    w.click(a);
    expect(w.tool.activeHex()).toBe(a);
    expect(w.tool.clickStrip(w.at(b))).toBe(true);
    expect(w.opened).toEqual([{ map: "East", hex: b }]);
    expect(w.tool.activeHex()).toBe(b);
    w.click(centre("East"));
    expect(w.maps.East.paths).toEqual([{ name: "Road", typeName: "Road", branches: [{ anchors: [b, centre("East")] }] }]);
    const lines = w.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0].hexes[0] === centre("West") || lines[0].hexes[lines[0].hexes.length - 1] === centre("West")).toBe(true);
  });

  it("not on the edge yet: a hint, nothing opened", () => {
    const w = world();
    w.setMap("West");
    w.tool.typeName = "Road";
    w.click(centre("West"));
    expect(w.tool.clickStrip(w.at(centre("East")))).toBe(true);
    expect(w.opened).toEqual([]);
    expect(w.tool.labelState().note).toContain("draw up to the edge");
  });
});

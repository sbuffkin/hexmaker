import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MapData, PathChain, PathType, TerrainColor } from "../src/types";
import { PathsService, pathTypeStyle, styleForTypes, type PathsHost } from "../src/paths/PathsService";
import { storedMapPaths } from "../src/paths/mapPaths";
import { applyAffine, latticeCenter } from "../src/paths/pathGeometry";
import { hexCenter } from "../src/hex-map/hexGeometry";
import { countPathsOfType, removePathTypeFromChains, removePathTypeFromPaths, renamePathTypeInChains, renamePathTypeInPaths } from "../src/paths/typeRefs";
import { legacyChainsToPaths } from "../src/paths/legacy";

const ROAD: PathType = { name: "Road", color: "#a33", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true };
const TRAIL: PathType = { name: "Trail", color: "#555", width: 2, lineStyle: "dashed", routing: "meander", avoidImpassable: true };
const WATER: TerrainColor = { name: "lake", color: "#00f", impassable: true };
const GRASS: TerrainColor = { name: "grass", color: "#0f0", impassable: false };

/**
 * A sim vault for the paths service: a map whose terrain and palette load
 * separately (as MapStore and PaletteStore do at startup), with a lake
 * across the straight line of a road whose two anchors are far apart.
 */
function simVault(chains: PathChain[], over: Partial<MapData> = {}) {
  const map = { name: "coast", paletteName: "P", gridSize: { cols: 9, rows: 7 }, gridOffset: { x: 0, y: 0 }, pathChains: chains, ...over } as MapData;
  const state = {
    terrainLoaded: false,
    paletteLoaded: false,
    // Before the palette note is read, the palette in memory has no flags.
    palette: [{ name: "lake", color: "#00f" }, GRASS] as TerrainColor[],
    hexes: new Map<string, { terrain?: string }>(),
    types: [ROAD, TRAIL],
  };
  const host: PathsHost = {
    isMapReady: () => state.terrainLoaded && state.paletteLoaded,
    getMap: (n) => (n === map.name ? map : undefined),
    orientation: () => "flat",
    stagger: () => "odd",
    pathTypes: () => state.types,
    palette: () => state.palette,
    hexData: () => state.hexes,
  };
  const loadTerrain = () => {
    // A wall of lake down column 4, except a gap at the bottom row.
    for (let y = 0; y < 6; y++) state.hexes.set(`4_${y}`, { terrain: "lake" });
    state.terrainLoaded = true;
  };
  const loadPalette = () => {
    state.palette = [WATER, GRASS];
    state.paletteLoaded = true;
  };
  return { map, state, host, svc: new PathsService(host), loadTerrain, loadPalette };
}

describe("paths service: the readiness gate (late palette load)", () => {
  it("draws nothing until terrain AND palette are loaded, then the final route, never an intermediate", () => {
    const v = simVault([{ typeName: "Road", hexes: ["1_2", "7_2"] }]);
    const seen: string[][] = [];
    const look = () => seen.push(v.svc.resolvedPathChains("coast").flatMap((c) => c.hexes));

    look(); // nothing loaded
    v.loadTerrain();
    look(); // terrain in, palette still loading: routing now would cross the lake
    expect(v.svc.isReady("coast")).toBe(false);
    v.loadPalette();
    look(); // both: the final route
    look(); // and it stays put

    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([]);
    const final = seen[2];
    expect(final[0]).toBe("1_2");
    expect(final[final.length - 1]).toBe("7_2");
    // Around the lake: through the gap at the bottom, never a lake hex.
    expect(final.some((k) => /^4_[0-5]$/.test(k))).toBe(false);
    expect(final).toContain("4_6");
    expect(seen[3]).toEqual(final);
    // Every non-empty answer is the final one.
    for (const s of seen) if (s.length) expect(s).toEqual(final);
  });

  it("strokes() and resolved() are empty while not ready", () => {
    const v = simVault([{ typeName: "Road", hexes: ["1_2", "2_2"] }]);
    v.loadTerrain();
    expect(v.svc.resolved("coast")).toEqual([]);
    expect(v.svc.strokes("coast")).toEqual([]);
    v.loadPalette();
    expect(v.svc.strokes("coast")).toHaveLength(1);
  });

  it("re-resolves when terrain changes (blocked set), and reuses the result when nothing did", () => {
    const v = simVault([{ typeName: "Road", hexes: ["1_2", "7_2"] }]);
    v.loadTerrain();
    v.loadPalette();
    const a = v.svc.resolvedPathChains("coast");
    expect(v.svc.resolvedPathChains("coast")).toBe(a); // memoised
    v.state.hexes.set("4_6", { terrain: "lake" }); // close the gap
    const b = v.svc.resolvedPathChains("coast");
    expect(b).not.toBe(a);
    // Walled off: the segment falls back to the straight hex line (drawn, never dropped).
    expect(b[0].hexes[0]).toBe("1_2");
    expect(b[0].hexes[b[0].hexes.length - 1]).toBe("7_2");
  });

  it("a hand-drawn (dense) chain resolves to exactly its hexes, terrain notwithstanding", () => {
    const hexes = ["2_1", "3_1", "4_1", "5_1", "6_1"]; // straight through the lake
    const v = simVault([{ typeName: "Road", hexes }]);
    v.loadTerrain();
    v.loadPalette();
    expect(v.svc.resolvedPathChains("coast")).toEqual([{ typeName: "Road", hexes }]);
  });

  it("the base terrain counts as shown terrain for hexes without their own", () => {
    const v = simVault([{ typeName: "Road", hexes: ["1_1", "7_1"] }], { baseTerrain: "lake" });
    v.state.terrainLoaded = true;
    for (let x = 0; x < 9; x++) v.state.hexes.set(`${x}_0`, { terrain: "grass" }); // a grass row on top
    v.loadPalette();
    const [c] = v.svc.resolvedPathChains("coast");
    expect(c.hexes.length).toBeGreaterThan(2);
    expect(c.hexes.slice(1, -1).every((k) => k.endsWith("_0"))).toBe(true);
  });
});

describe("paths service: style comes from the explicit type fields, in one place", () => {
  it("pathTypeStyle: undefined for a type not in the palette, never guessed from a name", () => {
    expect(pathTypeStyle(undefined)).toBeUndefined();
    const f = styleForTypes([ROAD]);
    expect(f("Road")).toEqual({ avoid: true, winding: false });
    expect(f("River")).toBeUndefined();
  });

  it("is the only reader of avoid/winding (the PA5 switch is one line)", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "paths", "PathsService.ts"), "utf8");
    expect(src.match(/pathAvoidsImpassable\(|pathMeanders\(/g)?.length).toBe(2);
    expect(src).toMatch(/return t && \{ avoid: pathAvoidsImpassable\(t\), winding: pathMeanders\(t\) \};/);
    for (const f of ["src/hex-map/HexMapView.ts", "src/export/mapPngRenderer.ts", "src/paths/pathGeometry.ts"]) {
      const body = readFileSync(path.join(process.cwd(), f), "utf8");
      // The renderers never route by themselves (the draw tool's own route click aside).
      expect(body).not.toMatch(/resolvePaths\(/);
    }
  });
});

describe("PNG and screen draw the same polylines", () => {
  it("both take plugin.paths.strokes(...) (lattice units); only the affine differs", () => {
    const view = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexMapView.ts"), "utf8").replace(/\r\n/g, "\n");
    const png = readFileSync(path.join(process.cwd(), "src", "export", "mapPngRenderer.ts"), "utf8").replace(/\r\n/g, "\n");
    const overlay = /private renderPathOverlay[\s\S]*?\n {2}\}\n/.exec(view)![0];
    expect(overlay).toMatch(/this\.plugin\.paths\.strokes\(region\.name, \{\n\s*seamEnd:/);
    expect(png).toMatch(/plugin\.paths\.strokes\(map\.name, \{ laneScale: boldPaths \? PNG_PATH_BOLD : 1 \}\)/);
    // No layout reads in the overlay's stroke loop: the only reads are the calibration's.
    expect(overlay).not.toMatch(/offsetLeft|offsetTop|offsetWidth|getBoundingClientRect/);
  });

  it("for a fixture map (odd grid offset), the screen and PNG polylines are the same lattice polyline", () => {
    const chains: PathChain[] = [
      { typeName: "Road", hexes: ["3_2", "4_2", "5_2", "5_3"] },
      { typeName: "Trail", hexes: ["3_2", "4_2", "5_2", "6_2", "7_3"] },
      { typeName: "Road", hexes: ["7_3", "7_4"] },
    ];
    const v = simVault(chains, { gridOffset: { x: 3, y: 1 } });
    v.state.terrainLoaded = true;
    v.loadPalette();
    const screen = v.svc.strokes("coast", { seamEnd: () => undefined });
    const pngPlain = v.svc.strokes("coast", { laneScale: 1 });
    expect(pngPlain).toEqual(screen);
    // A road and a trail share 3_2–5_2: lanes apart, the same on both.
    expect(screen).toHaveLength(3);
    // The PNG places hexes at hexCenter(x, y, R) of ABSOLUTE coordinates;
    // the polyline × R lands on those centres (through-routed road).
    const R = 50;
    const road = screen.find((s) => s.typeName === "Road" && s.pts.length === 2)!;
    const [p] = applyAffine([road.pts[0]], { sx: R, sy: R, tx: 0, ty: 0 });
    const c = hexCenter(7, 3, "flat", R, "odd");
    expect(p.cx).toBeCloseTo(c.cx, 9);
    expect(p.cy).toBeCloseTo(c.cy, 9);
    expect(latticeCenter("7_3", { orientation: "flat", stagger: "odd" }).cx * R).toBeCloseTo(c.cx, 9);
    // Bolder paths: lanes scale with the strokes; the shape's centreline doesn't move.
    const bold = v.svc.strokes("coast", { laneScale: 1.4 });
    expect(bold.find((s) => s.pts.length === 2)!.pts).toEqual(road.pts);
  });
});

describe("the Phase-3 adapter and type references", () => {
  it("storedMapPaths reads legacy chains as dense-anchor paths (one place, replaced by Phase 3)", () => {
    const chains: PathChain[] = [{ typeName: "Road", hexes: ["1_1", "2_1"] }, { typeName: "Road", hexes: ["5_5"] }];
    expect(storedMapPaths({ pathChains: chains })).toEqual(legacyChainsToPaths(chains));
    expect(storedMapPaths({})).toEqual([]);
  });

  it("renames and removes a type across MapPaths and (for now) chains", () => {
    const paths = legacyChainsToPaths([{ typeName: "Road", hexes: ["1_1"] }, { typeName: "River", hexes: ["2_2"] }, { typeName: "Road", hexes: ["3_3"] }]);
    expect(countPathsOfType(paths, "Road")).toBe(2);
    expect(renamePathTypeInPaths(paths, "Road", "Highway")).toBe(2);
    expect(paths.map((p) => p.typeName)).toEqual(["Highway", "River", "Highway"]);
    // Names are labels: a rename of the type leaves path names alone.
    expect(paths.map((p) => p.name)).toEqual(["Road", "River", "Road 2"]);
    expect(removePathTypeFromPaths(paths, "Highway").map((p) => p.typeName)).toEqual(["River"]);

    const chains: PathChain[] = [{ typeName: "Road", hexes: ["1_1"] }, { typeName: "River", hexes: ["2_2"] }];
    expect(renamePathTypeInChains(chains, "Road", "Highway")).toBe(1);
    expect(removePathTypeFromChains(chains, "River")).toEqual([{ typeName: "Highway", hexes: ["1_1"] }]);
  });
});

/**
 * Region paths across seams on the overworld (owner 2026-10-13: "show
 * cross-region rivers and roads on the overworld map please, make them
 * thinner to not crowd it, if they get too thin (like 'paths' and
 * 'streams') just ignore").
 */
import { describe, it } from "node:test";
import expect from "expect";
import { childNeighbours, childPoint, parentOf, regionCells, regionCentreCell, type RegionLayout } from "../src/overworld/layout";
import { applyAffine, childToParentPlane, composeAffine, type Affine } from "../src/overworld/overworldRender";
import {
  CrossRegionPaths,
  OW_PATH_MIN,
  OW_PATH_SCALE,
  crossRegionLines,
  overworldPathDash,
  overworldPathWidth,
  pathAtGridPoint,
  piecesOf,
  type RegionPathPiece,
  type RegionPathSource,
} from "../src/overworld/regionPaths";
import { REGION_PATHS_ROW } from "../src/overworld/overworldLayer";
import { regionsViewTip } from "../src/hex-map/hexHover";
import { UNKNOWN_PATH_TYPE } from "../src/constants";
import type { MapPath, PathType } from "../src/types";
import { layerOf } from "../src/ui/placement";
import { readFileSync } from "node:fs";
import type { ResolvedBranch } from "../src/paths/resolve";

const layouts: RegionLayout[] = [
  { footprint: "rect", size: 6, orientation: "flat", parentStagger: "odd", childStagger: "odd" },
  { footprint: "rect", size: 5, orientation: "pointy", parentStagger: "even", childStagger: "even" },
];

const k = (x: number, y: number) => `${x}_${y}`;
const xy = (s: string) => s.split("_").map(Number) as [number, number];

/** A cell of region P touching a cell of region Q across their seam: [inP, inQ]. */
function seamPair(l: RegionLayout, P: [number, number], Q: [number, number], skip = 0): [string, string] {
  const found: [string, string][] = [];
  for (const [x, y] of regionCells(l, ...P)) {
    for (const [nx, ny] of childNeighbours(l, x, y)) {
      const [qx, qy] = parentOf(l, nx, ny);
      if (qx === Q[0] && qy === Q[1]) found.push([k(x, y), k(nx, ny)]);
    }
  }
  if (!found.length) throw new Error("not neighbours");
  return found[Math.min(skip, found.length - 1)];
}
const centre = (l: RegionLayout, P: [number, number]) => k(...regionCentreCell(l, ...P));

const piece = (region: string, typeName: string, hexes: string[], path = `${typeName} ${region}`): RegionPathPiece =>
  ({ region, path, typeName, branch: 0, hexes, openStart: true, openEnd: true });

for (const l of layouts) {
  const A: [number, number] = [1, 1], B: [number, number] = [2, 1], C: [number, number] = [3, 1];
  describe(`cross-region detection (${l.orientation})`, () => {
    it("joins a road that continues across a seam", () => {
      const [a, b] = seamPair(l, A, B);
      const lines = crossRegionLines(l, [piece("A", "Road", [centre(l, A), a]), piece("B", "Road", [b, centre(l, B)])]);
      expect(lines).toHaveLength(1);
      expect(lines[0].hexes).toEqual([centre(l, A), a, b, centre(l, B)]);
      expect(lines[0].regions.sort()).toEqual(["A", "B"]);
      expect(lines[0].names).toEqual(["Road A", "Road B"]);
    });

    it("draws nothing for a path that ends at the edge with no partner", () => {
      const [a] = seamPair(l, A, B);
      expect(crossRegionLines(l, [piece("A", "Road", [centre(l, A), a]), piece("B", "Road", [centre(l, B)])])).toEqual([]);
    });

    it("draws nothing when the neighbour's path is a different type", () => {
      const [a, b] = seamPair(l, A, B);
      expect(crossRegionLines(l, [piece("A", "Road", [centre(l, A), a]), piece("B", "River", [b, centre(l, B)])])).toEqual([]);
    });

    it("draws nothing for a path inside one region, even two that touch", () => {
      const c = centre(l, A);
      const [nx, ny] = childNeighbours(l, ...xy(c))[0];
      expect(crossRegionLines(l, [piece("A", "Road", [c]), piece("A", "Road", [k(nx, ny)], "Other")])).toEqual([]);
    });

    it("does not join a fork's start (it sits on its parent branch)", () => {
      const [a, b] = seamPair(l, A, B);
      const fork = { ...piece("B", "Road", [b, centre(l, B)]), openStart: false };
      expect(crossRegionLines(l, [piece("A", "Road", [centre(l, A), a]), fork])).toEqual([]);
    });

    it("joins one line across three regions, whichever way each piece runs", () => {
      const [a, b1] = seamPair(l, A, B);
      const [b2, c] = seamPair(l, B, C);
      const pieces = [
        piece("C", "River", [centre(l, C), c]), // runs towards the seam
        piece("A", "River", [centre(l, A), a]),
        piece("B", "River", [b2, centre(l, B), b1]), // reversed
      ];
      const lines = crossRegionLines(l, pieces);
      expect(lines).toHaveLength(1);
      const h = lines[0].hexes;
      const fwd = [centre(l, C), c, b2, centre(l, B), b1, a, centre(l, A)];
      expect(h[0] === fwd[0] ? h : [...h].reverse()).toEqual(fwd);
      expect(lines[0].regions.sort()).toEqual(["A", "B", "C"]);
    });

    it("keeps a crossing path's fork in its region with it, as its own line", () => {
      const [a, b] = seamPair(l, A, B);
      const main = piece("B", "Road", [b, centre(l, B)], "Kings Road");
      const fork: RegionPathPiece = { ...piece("B", "Road", [centre(l, B), b], "Kings Road"), branch: 1, openStart: false };
      const lines = crossRegionLines(l, [piece("A", "Road", [centre(l, A), a], "Kings Road"), main, fork]);
      expect(lines).toHaveLength(2);
      expect(lines.map((x) => x.hexes.length).sort()).toEqual([2, 4]);
    });
  });
}

describe("overworld widths", () => {
  it("scales a type's width by the overworld factor", () => {
    expect(overworldPathWidth(4)).toBe(4 * OW_PATH_SCALE);
    expect(overworldPathWidth(3)).toBe(3 * OW_PATH_SCALE);
  });

  it("skips types that come out thinner than the minimum (by width, not name)", () => {
    expect(overworldPathWidth(2)).toBeNull();
    expect(overworldPathWidth(1)).toBeNull();
    expect(overworldPathWidth(OW_PATH_MIN / OW_PATH_SCALE)).toBe(OW_PATH_MIN);
    expect(overworldPathWidth(Number.NaN)).toBeNull();
  });

  it("scales dashes with the line", () => {
    expect(overworldPathDash("solid")).toEqual([]);
    expect(overworldPathDash("dashed")).toEqual([8 * OW_PATH_SCALE, 4 * OW_PATH_SCALE]);
  });
});

// ── the cache ────────────────────────────────────────────────────────────

const l = layouts[0];
const A: [number, number] = [1, 1], B: [number, number] = [2, 1];
const T = (name: string, width: number, extra: Partial<PathType> = {}): PathType =>
  ({ name, color: "#123456", width, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct", ...extra });
const rb = (path: string, typeName: string, hexes: string[]): ResolvedBranch => ({ path, typeName, branch: 0, hexes, anchorIdx: [0, hexes.length - 1], fallbackSegments: [] });

function world() {
  const [a, b] = seamPair(l, A, B);
  const [a2, b2] = seamPair(l, A, B, 3);
  const resolved: Record<string, ResolvedBranch[]> = {
    A: [rb("Road", "Road", [centre(l, A), a]), rb("Trail", "Trail", [centre(l, A), a2])],
    B: [rb("Road", "Road", [b, centre(l, B)]), rb("Trail", "Trail", [b2, centre(l, B)])],
  };
  const stored: Record<string, MapPath[]> = { A: [], B: [] };
  const types: Record<string, PathType[]> = { A: [T("Road", 4), T("Trail", 1.5)], B: [T("Road", 4), T("Trail", 1.5)] };
  const calls: Record<string, number> = { A: 0, B: 0 };
  let ow: string[] = [];
  let ready = true;
  const src: RegionPathSource = {
    regions: () => [{ name: "A" }, { name: "B" }],
    ready: () => ready,
    resolved: (r) => { calls[r]++; return resolved[r]; },
    stored: (r) => stored[r],
    types: (r) => types[r],
    overworldPaths: () => ow,
    unknownType: UNKNOWN_PATH_TYPE,
  };
  return { src, resolved, stored, types, calls, a, b, setOw: (n: string[]) => { ow = n; }, setReady: (v: boolean) => { ready = v; } };
}

describe("CrossRegionPaths (cached per overworld)", () => {
  it("draws the road, skips the too-thin trail", () => {
    const w = world();
    const lines = new CrossRegionPaths().lines(l, w.src);
    expect(lines.map((x) => x.typeName)).toEqual(["Road"]);
    expect(lines[0].width).toBe(2);
    expect(lines[0].color).toBe("#123456");
    expect(lines[0].pts[0]).toEqual(childPoint(l, ...xy(centre(l, A))));
  });

  it("reuses every region's pieces and the joined lines until a region changes", () => {
    const w = world();
    const cache = new CrossRegionPaths();
    const first = cache.lines(l, w.src);
    expect(cache.lines(l, w.src)).toBe(first);
    expect(w.calls).toEqual({ A: 1, B: 1 });
    expect(cache.joins).toBe(1);

    // A path edit in B (the road now stops short of the seam), then the map store's change event.
    w.resolved.B = [rb("Road", "Road", [centre(l, B)])];
    expect(cache.lines(l, w.src)).toBe(first); // not told yet: still cached
    cache.invalidate("B");
    expect(cache.lines(l, w.src)).toEqual([]);
    expect(w.calls).toEqual({ A: 1, B: 2 });
    expect(cache.joins).toBe(2);
  });

  it("rebuilds when a path type's width changes (the trail widened past the minimum)", () => {
    const w = world();
    const cache = new CrossRegionPaths();
    expect(cache.lines(l, w.src)).toHaveLength(1);
    w.types.A = [T("Road", 4), T("Trail", 3)];
    w.types.B = [T("Road", 4), T("Trail", 3)];
    expect(cache.lines(l, w.src).map((x) => x.typeName).sort()).toEqual(["Road", "Trail"]);
  });

  it("never caches the empty answer of a region still loading", () => {
    const w = world();
    w.setReady(false);
    const cache = new CrossRegionPaths();
    expect(cache.lines(l, w.src)).toEqual([]);
    w.setReady(true);
    expect(cache.lines(l, w.src)).toHaveLength(1);
  });

  it("leaves out region copies of an overworld path that still exists (that one is drawn already)", () => {
    const w = world();
    const owned = (name: string): MapPath => ({ name, typeName: "Road", branches: [], extra: { "Overworld path": "Great Road" } });
    w.stored.A = [owned("Road")];
    w.stored.B = [owned("Road")];
    const cache = new CrossRegionPaths();
    expect(cache.lines(l, w.src)).toHaveLength(1); // its overworld path was deleted: drawn
    w.setOw(["Great Road"]);
    expect(cache.lines(l, w.src)).toEqual([]);
  });
});

describe("piecesOf", () => {
  it("marks fork starts and join ends as closed, and reads the owner column", () => {
    const branches: ResolvedBranch[] = [
      { ...rb("P", "Road", ["0_0", "1_0"]), joinTo: { branch: 1, hexIdx: 0 } },
      { ...rb("P", "Road", ["1_0", "2_0"]), branch: 1, forkFrom: { branch: 0, hexIdx: 1 } },
    ];
    const ps = piecesOf("R", branches, [{ name: "P", typeName: "Road", branches: [], extra: { "Overworld path": "Big" } }]);
    expect(ps.map((p) => [p.openStart, p.openEnd, p.owner])).toEqual([[true, false, "Big"], [false, true, "Big"]]);
  });
});

describe("hover: the line under the pointer, in the drawing's units", () => {
  const p2g: Affine = [67.6, 0, 0, 68, 66, 173];
  const c2g = composeAffine(childToParentPlane(l), p2g);
  const EM = 28;
  const w = world();
  const lines = new CrossRegionPaths().lines(l, w.src);
  const mid = lines[0].pts[1];
  for (const F of [0.5, 1, 1.7, 3]) {
    it(`finds the road at zoom ×${F}, and nothing a hex away`, () => {
      const [gx, gy] = applyAffine(c2g, ...mid);
      expect(pathAtGridPoint(lines, c2g, p2g, EM, EM * F, 1, gx * F, gy * F)?.typeName).toBe("Road");
      const off = childPoint(l, ...xy(centre(l, [1, 2])));
      const [ox, oy] = applyAffine(c2g, ...off);
      expect(pathAtGridPoint(lines, c2g, p2g, EM, EM * F, 1, ox * F, oy * F)).toBeNull();
    });
  }

  it("puts the path's name first in the Regions view tooltip", () => {
    const opts = { label: (r: string) => r, emptySlot: () => false, canAdd: false };
    expect(regionsViewTip({ region: "North", parentHex: "1_1" }, { ...opts, path: "Kings Road" })).toBe("Kings Road\nNorth: click to go there");
    expect(regionsViewTip(null, { ...opts, path: "Kings Road" })).toBe("Kings Road");
    expect(regionsViewTip({ region: "North", parentHex: "1_1" }, opts)).toBe("North: click to go there");
  });
});

describe("layers menu toggle", () => {
  it("is on unless the map says otherwise, and only writes the field when off", () => {
    const map: { showRegionPaths?: boolean } = {};
    expect(REGION_PATHS_ROW.value(map)).toBe(true);
    REGION_PATHS_ROW.set(map, false);
    expect(map.showRegionPaths).toBe(false);
    expect(REGION_PATHS_ROW.value(map)).toBe(false);
    REGION_PATHS_ROW.set(map, true);
    expect("showRegionPaths" in map).toBe(false);
  });

  it("is a main-layer row of the layers menu, placed by its id", () => {
    expect(REGION_PATHS_ROW.id).toBe("LayersMenu.regionPaths");
    expect(layerOf(REGION_PATHS_ROW.id)).toBe("main");
    // The panel builds module rows right after "Show paths", placed through the disclosure.
    const panel = readFileSync("src/hex-map/HexSidePanel.ts", "utf8");
    expect(panel).toContain('if (opt.key === "showPaths") this.buildModuleRows(panel, disclosure);');
    expect(panel).toContain("disclosure.place(row.id, el,");
  });
});

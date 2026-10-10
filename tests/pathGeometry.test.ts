import { describe, it } from "node:test";
import expect from "expect";
import type { MapPath, PathType } from "../src/types";
import { hexCenter, hexNeighbors } from "../src/hex-map/hexGeometry";
import {
  applyAffine,
  buildPathStrokes,
  calibrateAffine,
  chainPoints,
  edgePointsFromCenters,
  latticeCenter,
  pxToLattice,
  type LatticeGrid,
  type Pt,
} from "../src/paths/pathGeometry";
import { contextRouter } from "../src/paths/routeCache";
import { resolvePath } from "../src/paths/resolve";
import type { RouteContext } from "../src/paths/router";
import { UNKNOWN_PATH_TYPE } from "../src/constants";

type O = "flat" | "pointy";
type S = "odd" | "even";
const GRIDS: LatticeGrid[] = (["flat", "pointy"] as O[]).flatMap((orientation) =>
  (["odd", "even"] as S[]).map((stagger) => ({ orientation, stagger })),
);
const ROUTINGS = ["through", "meander", "edge"] as const;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random walk of neighbouring hexes (may cross itself, like hand-drawn rivers). */
function walk(grid: LatticeGrid, seed: number, len: number): string[] {
  const r = rng(seed);
  let x = Math.floor(r() * 10) - 3;
  let y = Math.floor(r() * 10) - 3;
  const out = [`${x}_${y}`];
  for (let i = 1; i < len; i++) {
    const nb = hexNeighbors(x, y, grid.orientation, grid.stagger);
    [x, y] = nb[Math.floor(r() * 6)];
    out.push(`${x}_${y}`);
  }
  return out;
}

const close = (a: Pt[], b: Pt[], tol: number) => {
  expect(a.length).toBe(b.length);
  a.forEach((p, i) => {
    expect(Math.abs(p.cx - b[i].cx)).toBeLessThan(tol);
    expect(Math.abs(p.cy - b[i].cy)).toBeLessThan(tol);
  });
};

const type = (name: string, routing: PathType["routing"], width = 4): PathType =>
  ({ name, color: "#000", width, lineStyle: "solid", routing });

describe("pathGeometry: lattice units", () => {
  it("lattice centres are hexGeometry centres at radius 1, in absolute coordinates", () => {
    for (const g of GRIDS) {
      for (const [x, y] of [[0, 0], [3, 4], [-1, -4], [7, 2]]) {
        const c = hexCenter(x, y, g.orientation, 1, g.stagger);
        expect(latticeCenter(`${x}_${y}`, g)).toEqual(c);
        // The PNG's hexes at radius R sit exactly on lattice × R.
        const big = hexCenter(x, y, g.orientation, 50, g.stagger);
        expect(Math.abs(big.cx - c.cx * 50)).toBeLessThan(1e-9);
        expect(Math.abs(big.cy - c.cy * 50)).toBeLessThan(1e-9);
      }
    }
  });

  it("gives the identical polyline at R=1 and R=50 (and odd scales) after scaling, every style", () => {
    for (const g of GRIDS) {
      for (let seed = 1; seed <= 25; seed++) {
        const hexes = walk(g, seed, 2 + (seed % 12));
        for (const routing of ROUTINGS) {
          const lattice = chainPoints(hexes, routing, g);
          for (const R of [50, 37.3, 0.013]) {
            // Built directly at radius R (as a pixel renderer would) …
            const centres = hexes.map((k) => {
              const [x, y] = k.split("_").map(Number);
              return hexCenter(x, y, g.orientation, R, g.stagger);
            });
            const atR = routing === "edge"
              ? edgePointsFromCenters(centres, g.orientation === "flat", R)
              : routing === "meander" && centres.length >= 3
                ? centres.slice(0, -1).map((c, i) => ({ cx: (c.cx + centres[i + 1].cx) / 2, cy: (c.cy + centres[i + 1].cy) / 2 }))
                : centres;
            // … equals the lattice polyline scaled by R: no tie flips with scale.
            close(atR, applyAffine(lattice, { sx: R, sy: R, tx: 0, ty: 0 }), 1e-6 * Math.max(1, R));
          }
        }
      }
    }
  });

  it("breaks edge ties deterministically (exact ties on straight runs take the first vertex)", () => {
    for (const g of GRIDS) {
      // A straight run: every turn-cost comparison is an exact tie.
      const hexes = g.orientation === "flat" ? ["2_0", "2_1", "2_2", "2_3", "2_4"] : ["0_2", "1_2", "2_2", "3_2", "4_2"];
      const a = chainPoints(hexes, "edge", g);
      const b = chainPoints([...hexes], "edge", g);
      expect(a).toEqual(b);
      // The outline keeps to one side of the centres (no zig-zag from flipped ties).
      const axis = g.orientation === "flat" ? "cx" : "cy";
      const c0 = latticeCenter(hexes[0], g)[axis];
      const sides = new Set(a.slice(1, -1).map((p) => Math.sign(Math.round((p[axis] - c0) * 1e6))));
      sides.delete(0);
      expect(sides.size).toBe(1);
    }
  });

  it("edge routing runs on the cell outline: neighbours share vertices exactly", () => {
    for (const g of GRIDS) {
      const pts = chainPoints(walk(g, 7, 9), "edge", g);
      for (let i = 1; i < pts.length; i++) {
        const step = Math.hypot(pts[i].cx - pts[i - 1].cx, pts[i].cy - pts[i - 1].cy);
        // Centre→vertex and vertex→vertex steps are both exactly 1 on the lattice
        // (0 where a scribble walks back over its own outline).
        expect(Math.min(step, Math.abs(step - 1))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("pathGeometry: forks join their parent", () => {
  const ctx = (o: O, s: S): RouteContext => ({ orientation: o, stagger: s, bounds: { minX: 0, minY: 0, maxX: 15, maxY: 15 }, blocked: new Set() });
  for (const g of GRIDS) {
    for (const routing of ROUTINGS) {
      it(`${g.orientation}/${g.stagger}, ${routing}: the fork's first point is on the parent's polyline`, () => {
        // Main line along a row/column, fork from its middle hex going off sideways.
        const main = g.orientation === "flat" ? ["2_2", "3_2", "4_2", "5_2", "6_2", "7_2"] : ["2_2", "2_3", "2_4", "2_5", "2_6", "2_7"];
        const fork = main[3];
        const [fx, fy] = fork.split("_").map(Number);
        const off = g.orientation === "flat" ? `${fx}_${fy + 4}` : `${fx + 4}_${fy}`;
        const path: MapPath = { name: "Road", typeName: "T", branches: [{ anchors: main }, { anchors: [fork, off] }] };
        const resolved = resolvePath(path, contextRouter(ctx(g.orientation, g.stagger)));
        expect(resolved[1].forkFrom).toEqual({ branch: 0, hexIdx: 3 });
        const strokes = buildPathStrokes(resolved, [type("T", routing)], g, { unknownType: UNKNOWN_PATH_TYPE });
        expect(strokes).toHaveLength(2);
        const [parent, child] = strokes;
        const start = child.pts[0];
        const onParent = parent.pts.some((p) => Math.abs(p.cx - start.cx) < 1e-9 && Math.abs(p.cy - start.cy) < 1e-9);
        expect(onParent).toBe(true);
        // And it starts at the fork hex: within one cell radius of its centre.
        const c = latticeCenter(fork, g);
        expect(Math.hypot(start.cx - c.cx, start.cy - c.cy)).toBeLessThanOrEqual(1 + 1e-9);
      });
    }
  }

  it("a join (last anchor on another branch) ends on the parent's polyline too", () => {
    const g: LatticeGrid = { orientation: "flat", stagger: "odd" };
    const main = ["2_2", "3_2", "4_2", "5_2", "6_2", "7_2"];
    const path: MapPath = { name: "Loop", typeName: "T", branches: [{ anchors: main }, { anchors: ["4_6", "5_2"] }] };
    const resolved = resolvePath(path, contextRouter({ orientation: "flat", stagger: "odd", bounds: { minX: 0, minY: 0, maxX: 15, maxY: 15 }, blocked: new Set() }));
    expect(resolved[1].joinTo?.branch).toBe(0);
    for (const routing of ["meander", "edge"] as const) {
      const [parent, child] = buildPathStrokes(resolved, [type("T", routing)], g, { unknownType: UNKNOWN_PATH_TYPE });
      const end = child.pts[child.pts.length - 1];
      expect(parent.pts.some((p) => Math.abs(p.cx - end.cx) < 1e-9 && Math.abs(p.cy - end.cy) < 1e-9)).toBe(true);
    }
  });
});

describe("pathGeometry: strokes", () => {
  const g: LatticeGrid = { orientation: "flat", stagger: "odd" };
  const rb = (path: string, typeName: string, hexes: string[]) => ({ path, typeName, branch: 0, hexes, anchorIdx: [0, hexes.length - 1], fallbackSegments: [] });

  it("widths, dashes and lane gaps are in lattice units (px / 35.2)", () => {
    const road: PathType = { name: "Road", color: "#a00", width: 4, lineStyle: "dashed", routing: "through" };
    const river: PathType = { name: "River", color: "#00a", width: 6, lineStyle: "solid", routing: "through" };
    const shared = ["1_1", "2_1", "3_1"];
    const [r, v] = buildPathStrokes([rb("Road", "Road", shared), rb("River", "River", shared)], [road, river], g, { unknownType: UNKNOWN_PATH_TYPE });
    expect(r.width).toBeCloseTo(4 / 35.2, 12);
    expect(r.dash).toEqual([8 / 35.2, 4 / 35.2]);
    expect(v.dash).toEqual([]);
    // Two types on one route: lanes either side, gap (widest + 2) px.
    const c = latticeCenter("2_1", g);
    const offR = r.pts[1].cy - c.cy;
    const offV = v.pts[1].cy - c.cy;
    expect(offR - offV).toBeCloseTo(-pxToLattice(8), 9);
  });

  it("draw order is the palette's type order, then unknown types (grey, under their own name)", () => {
    const a = type("A", "through");
    const b = type("B", "through");
    const strokes = buildPathStrokes(
      [rb("x", "Zed", ["0_0", "1_0"]), rb("y", "B", ["0_2", "1_2"]), rb("z", "A", ["0_4", "1_4"])],
      [a, b], g, { unknownType: UNKNOWN_PATH_TYPE },
    );
    expect(strokes.map((s) => s.typeName)).toEqual(["A", "B", "Zed"]);
    expect(strokes[2].color).toBe(UNKNOWN_PATH_TYPE.color);
  });

  it("one-hex branches draw nothing; seam ends reach the shared edge", () => {
    const t = type("T", "through");
    expect(buildPathStrokes([rb("p", "T", ["3_3"])], [t], g, { unknownType: UNKNOWN_PATH_TYPE })).toEqual([]);
    const [s] = buildPathStrokes([rb("p", "T", ["0_1", "1_1"])], [t], g, {
      unknownType: UNKNOWN_PATH_TYPE,
      seamEnd: (_t, hex) => (hex === "0_1" ? "-1_1" : undefined),
    });
    const a = latticeCenter("0_1", g);
    const b = latticeCenter("-1_1", g);
    expect(s.pts[0]).toEqual({ cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 });
  });
});

describe("calibrateAffine", () => {
  it("maps lattice centres onto measured centres (gap and grid transforms absorbed)", () => {
    for (const g of GRIDS) {
      // A fake screen: cells of radius 2.4em plus 0.3em of gap per axis, offset.
      const sx = 2.5, sy = 2.3, tx = 4, ty = -1;
      const at = (k: string) => { const c = latticeCenter(k, g); return { x: tx + c.cx * sx, y: ty + c.cy * sy }; };
      const a = calibrateAffine({ key: "3_4", at: at("3_4") }, { key: "12_4", at: at("12_4") }, { key: "3_15", at: at("3_15") }, g, 1);
      expect(a.sx).toBeCloseTo(sx, 9);
      expect(a.sy).toBeCloseTo(sy, 9);
      for (const k of ["0_0", "7_9", "-2_3"]) {
        const [p] = applyAffine([latticeCenter(k, g)], a);
        expect(p.cx).toBeCloseTo(at(k).x, 9);
        expect(p.cy).toBeCloseTo(at(k).y, 9);
      }
    }
  });

  it("a one-row or one-column grid falls back to the other axis, then the hex radius", () => {
    const g: LatticeGrid = { orientation: "flat", stagger: "odd" };
    const a = calibrateAffine({ key: "0_0", at: { x: 1, y: 1 } }, null, null, g, 2.2);
    expect(a.sx).toBe(2.2);
    expect(a.sy).toBe(2.2);
  });
});

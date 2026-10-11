/**
 * The path tool's pure parts (plan-path-anchors section 4, phase 5):
 * hit-testing a pointer against the drawn polylines and anchor handles,
 * the click table (replacing the old hex-by-hex pathClickOutcome), and
 * where a drag on the line inserts its anchor.
 */
import { describe, it } from "node:test";
import expect from "expect";
import type { MapPath, PathType } from "../src/types";
import {
  anchorEnd,
  distToPolyline,
  hitTestPaths,
  nearestHexIdx,
  pathClickOutcome,
  pathSummary,
  type PathClickState,
  type PathHit,
} from "../src/hex-map/pathTool";
import { buildPathStrokes, latticeCenter, type LatticeGrid } from "../src/paths/pathGeometry";
import { resolvePaths } from "../src/paths/resolve";
import type { RouteContext } from "../src/paths/router";
import { insertAnchorAt, moveAnchor } from "../src/paths/edit";
import { UNKNOWN_PATH_TYPE } from "../src/constants";

const ROAD: PathType = { name: "Road", color: "#a33", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" };
const RIVER: PathType = { name: "River", color: "#33a", width: 3, lineStyle: "solid", routing: "meander", avoidImpassable: false, autoRoute: "winding" };
const grid: LatticeGrid = { orientation: "flat", stagger: "odd" };
const ctx: RouteContext = { orientation: "flat", stagger: "odd", bounds: { minX: 0, minY: 0, maxX: 19, maxY: 15 }, blocked: new Set() };

const KINGS: MapPath = { name: "King's Road", typeName: "Road", branches: [{ anchors: ["1_5", "9_5"] }, { anchors: ["5_5", "5_10"] }] };
const GLASS: MapPath = { name: "Glass River", typeName: "River", branches: [{ anchors: ["12_1", "12_9"] }] };

function scene(paths: MapPath[] = [KINGS, GLASS]) {
  const resolved = resolvePaths(paths, ctx);
  const strokes = buildPathStrokes(resolved, [ROAD, RIVER], grid, { unknownType: UNKNOWN_PATH_TYPE });
  return { resolved, strokes };
}

const at = (hex: string, dx = 0, dy = 0) => {
  const c = latticeCenter(hex, grid);
  return { cx: c.cx + dx, cy: c.cy + dy };
};

describe("hit-testing paths (pure, lattice units)", () => {
  it("a point on a line hits it; the hex index is the branch's nearest routed hex", () => {
    const { resolved, strokes } = scene();
    const main = resolved.find((r) => r.path === "King's Road" && r.branch === 0)!;
    const hit = hitTestPaths(at("4_5", 0, 0.05), strokes, resolved, grid, null);
    expect(hit).toMatchObject({ path: "King's Road", branch: 0, anchor: null, end: null });
    expect(main.hexes[hit!.hexIdx]).toBe("4_5");
  });

  it("misses beyond half the stroke plus the slack", () => {
    const { resolved, strokes } = scene();
    expect(hitTestPaths(at("4_8"), strokes, resolved, grid, null)).toBeNull();
    expect(distToPolyline({ cx: 0, cy: 1 }, [{ cx: -1, cy: 0 }, { cx: 1, cy: 0 }])).toBeCloseTo(1);
  });

  it("anchor handles count only on the selected path; ends are marked head / tail, a fork's start isn't an end", () => {
    const { resolved, strokes } = scene();
    expect(hitTestPaths(at("9_5"), strokes, resolved, grid, null)?.anchor).toBeNull();
    expect(hitTestPaths(at("9_5"), strokes, resolved, grid, "King's Road")).toMatchObject({ branch: 0, anchor: 1, end: "tail" });
    expect(hitTestPaths(at("1_5"), strokes, resolved, grid, "King's Road")).toMatchObject({ branch: 0, anchor: 0, end: "head" });
    const fork = resolved.find((r) => r.path === "King's Road" && r.branch === 1)!;
    expect(fork.forkFrom).toBeDefined();
    expect(anchorEnd(fork, 0)).toBeNull();
    expect(anchorEnd(fork, 1)).toBe("tail");
  });

  it("where lines overlap, the selected path wins", () => {
    // Old Track runs along part of the King's Road (every hex an anchor: exact).
    const kings = resolvePaths([KINGS], ctx).find((r) => r.branch === 0)!.hexes;
    const over: MapPath = { name: "Old Track", typeName: "Road", branches: [{ anchors: kings.slice(2, 6) }] };
    const { resolved, strokes } = scene([over, KINGS]);
    for (const sel of ["Old Track", "King's Road"]) expect(hitTestPaths(at(kings[3]), strokes, resolved, grid, sel)?.path).toBe(sel);
  });

  it("nearestHexIdx breaks ties toward the lower index", () => {
    const a = latticeCenter("0_0", grid);
    const b = latticeCenter("1_0", grid);
    expect(nearestHexIdx({ cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 }, ["0_0", "1_0"], grid)).toBe(0);
  });
});

describe("dragging the line inserts an anchor in the segment under the pointer", () => {
  it("between the anchors around that hex, then moves it (only that branch changes)", () => {
    const p: MapPath = { name: "R", typeName: "Road", branches: [{ anchors: ["0_5", "6_5", "12_5"] }] };
    const [rb] = resolvePaths([p], ctx);
    const idx = rb.anchorIdx[1] + 3; // inside the second segment
    const hex = rb.hexes[idx];
    const ins = insertAnchorAt(p, rb, idx);
    expect(ins.inserted).toBe(true);
    expect(ins.anchor).toBe(2);
    expect(ins.path.branches[0].anchors).toEqual(["0_5", "6_5", hex, "12_5"]);
    // the shape is unchanged until it moves
    expect(resolvePaths([ins.path], ctx)[0].hexes).toEqual(rb.hexes);
    const moved = moveAnchor(ins.path, 0, ins.anchor, "9_9");
    expect(moved.branches[0].anchors).toEqual(["0_5", "6_5", "9_9", "12_5"]);
    // only the two segments around the moved anchor change
    const now = resolvePaths([moved], ctx)[0];
    expect(now.hexes.slice(0, now.anchorIdx[1] + 1)).toEqual(rb.hexes.slice(0, rb.anchorIdx[1] + 1));
    // the route now passes the dragged-to hex
    expect(resolvePaths([moved], ctx)[0].hexes).toContain("9_9");
    // grabbing an anchor itself inserts nothing
    expect(insertAnchorAt(p, rb, rb.anchorIdx[1])).toMatchObject({ anchor: 1, inserted: false });
  });
});

describe("pathClickOutcome: the click table", () => {
  const S = (o: Partial<PathClickState> = {}): PathClickState => ({ erasing: false, forceNew: false, activeHex: null, selected: null, ...o });
  const hit = (o: Partial<PathHit> = {}): PathHit => ({ path: "King's Road", branch: 0, hexIdx: 3, anchor: null, end: null, ...o });

  it("nothing selected: an empty hex starts a path, a path is selected", () => {
    expect(pathClickOutcome(S(), "4_4", null)).toEqual({ kind: "start" });
    expect(pathClickOutcome(S(), "4_5", hit())).toEqual({ kind: "select", path: "King's Road" });
  });

  it("drawing: every click adds an anchor (far or near); the active end again finishes", () => {
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "15_2", null)).toEqual({ kind: "append" });
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "10_5", hit({ path: "Glass River" }))).toEqual({ kind: "append" });
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "9_5", hit())).toEqual({ kind: "finish" });
  });

  it("selected: an end continues it, anywhere else on it forks, another path is selected, empty map deselects", () => {
    const sel = S({ selected: "King's Road" });
    expect(pathClickOutcome(sel, "9_5", hit({ anchor: 1, end: "tail" }))).toEqual({ kind: "continue", path: "King's Road", branch: 0, end: "tail" });
    expect(pathClickOutcome(sel, "1_5", hit({ anchor: 0, end: "head" }))).toEqual({ kind: "continue", path: "King's Road", branch: 0, end: "head" });
    expect(pathClickOutcome(sel, "4_5", hit())).toEqual({ kind: "fork", path: "King's Road", branch: 0, hexIdx: 3 });
    expect(pathClickOutcome(sel, "12_3", hit({ path: "Glass River" }))).toEqual({ kind: "select", path: "Glass River" });
    expect(pathClickOutcome(sel, "3_12", null)).toEqual({ kind: "deselect" });
  });

  it("Alt-click / New path always starts a new path, even on another path", () => {
    expect(pathClickOutcome(S({ forceNew: true, selected: "King's Road" }), "4_5", hit())).toEqual({ kind: "start" });
    expect(pathClickOutcome(S({ forceNew: true, activeHex: "9_5" }), "4_5", null)).toEqual({ kind: "start" });
  });

  it("erase mode splits the path under the pointer, and does nothing elsewhere", () => {
    expect(pathClickOutcome(S({ erasing: true }), "4_5", hit())).toEqual({ kind: "split", path: "King's Road", branch: 0, hexIdx: 3 });
    expect(pathClickOutcome(S({ erasing: true }), "4_4", null)).toEqual({ kind: "none" });
  });

  it("the mode bar summary names the type and forks", () => {
    expect(pathSummary(KINGS)).toBe("Road, 1 fork");
    expect(pathSummary(GLASS)).toBe("River");
  });
});

/**
 * The path tool's pure parts (plan-path-anchors section 4, phase 5):
 * hit-testing a pointer against the drawn polylines and anchor handles,
 * the click, press and right-click tables (paths of the tool's type are
 * always live, other types inert: no separate edit mode), and
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
  anchorDeleteNotice,
  inertHint,
  pathClickOutcome,
  pathContextOutcome,
  pathPressOutcome,
  pathSummary,
  type PathClickState,
  type PathHit,
} from "../src/hex-map/pathTool";
import { buildPathStrokes, latticeCenter, type LatticeGrid } from "../src/paths/pathGeometry";
import { resolvePaths } from "../src/paths/resolve";
import type { RouteContext } from "../src/paths/router";
import { deleteAnchor, insertAnchorAt, moveAnchor } from "../src/paths/edit";
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

  it("every path of the tool's type has live anchor handles (no selecting first); ends are marked head / tail, a fork's start isn't an end", () => {
    const { resolved, strokes } = scene();
    expect(hitTestPaths(at("9_5"), strokes, resolved, grid, null)).toMatchObject({ branch: 0, anchor: 1, end: "tail", hex: "9_5", editable: true });
    expect(hitTestPaths(at("1_5"), strokes, resolved, grid, null)).toMatchObject({ branch: 0, anchor: 0, end: "head" });
    const roads = (n: string) => n === "King's Road";
    expect(hitTestPaths(at("9_5"), strokes, resolved, grid, null, roads)).toMatchObject({ path: "King's Road", anchor: 1, editable: true });
    const fork = resolved.find((r) => r.path === "King's Road" && r.branch === 1)!;
    expect(fork.forkFrom).toBeDefined();
    expect(anchorEnd(fork, 0)).toBeNull();
    expect(anchorEnd(fork, 1)).toBe("tail");
  });

  it("another type's path is inert: no anchor handles, its line is reported as not editable", () => {
    const { resolved, strokes } = scene();
    const roadsOnly = (n: string) => n === "King's Road";
    // The river's start anchor: no handle for the road tool, and a point on its line is inert.
    const river = resolved.find((r) => r.path === "Glass River")!;
    expect(hitTestPaths(at("12_1"), strokes, resolved, grid, null)).toMatchObject({ path: "Glass River", anchor: 0, editable: true });
    expect(hitTestPaths(at("12_1"), strokes, resolved, grid, null, roadsOnly)?.anchor ?? null).toBeNull();
    const s = strokes.find((x) => x.path === "Glass River")!;
    const mid = s.pts[Math.floor(s.pts.length / 2)];
    expect(hitTestPaths(mid, strokes, resolved, grid, null, roadsOnly)).toMatchObject({ path: "Glass River", anchor: null, end: null, editable: false });
    expect(river.hexes.length).toBeGreaterThan(2);
  });

  it("where lines overlap, the tool's type beats an inert path, then the selected path wins", () => {
    // Old Track runs along part of the King's Road (every hex an anchor: exact).
    const kings = resolvePaths([KINGS], ctx).find((r) => r.branch === 0)!.hexes;
    const over: MapPath = { name: "Old Track", typeName: "Road", branches: [{ anchors: kings.slice(2, 6) }] };
    const { resolved, strokes } = scene([over, KINGS]);
    // A point on the line between two of Old Track's anchors (no handle there).
    const a = latticeCenter(kings[3], grid);
    const b = latticeCenter(kings[4], grid);
    const mid = { cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 };
    for (const sel of ["Old Track", "King's Road"]) expect(hitTestPaths(mid, strokes, resolved, grid, sel)?.path).toBe(sel);
    // Only the King's Road is editable: it wins even when Old Track is selected.
    expect(hitTestPaths(mid, strokes, resolved, grid, "Old Track", (n) => n === "King's Road")).toMatchObject({ path: "King's Road", editable: true });
    // Stacked anchor handles: the selected path's first.
    expect(hitTestPaths(at(kings[3]), strokes, resolved, grid, "Old Track")).toMatchObject({ path: "Old Track", anchor: 1 });
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

describe("pathClickOutcome: the click table (paths of the tool's type are always live)", () => {
  const S = (o: Partial<PathClickState> = {}): PathClickState => ({ erasing: false, forceNew: false, activeHex: null, selected: null, ...o });
  const hit = (o: Partial<PathHit> = {}): PathHit => ({ path: "King's Road", branch: 0, hexIdx: 3, hex: "4_5", anchor: null, end: null, editable: true, ...o });

  it("empty ground starts a path; a line of the tool's type is selected; an end continues it with nothing selected first", () => {
    expect(pathClickOutcome(S(), "4_4", null)).toEqual({ kind: "start" });
    expect(pathClickOutcome(S(), "4_5", hit())).toEqual({ kind: "select", path: "King's Road" });
    expect(pathClickOutcome(S(), "9_5", hit({ anchor: 1, end: "tail" }))).toEqual({ kind: "continue", path: "King's Road", branch: 0, end: "tail" });
    expect(pathClickOutcome(S(), "1_5", hit({ anchor: 0, end: "head" }))).toEqual({ kind: "continue", path: "King's Road", branch: 0, end: "head" });
  });

  it("another type's path is ground: a click there starts a new path (no hijacking)", () => {
    expect(pathClickOutcome(S(), "12_3", hit({ path: "Glass River", editable: false }))).toEqual({ kind: "start" });
    expect(pathClickOutcome(S(), "12_9", hit({ path: "Glass River", editable: false, anchor: null, end: null }))).toEqual({ kind: "start" });
    expect(pathClickOutcome(S({ selected: "King's Road" }), "12_3", hit({ path: "Glass River", editable: false }))).toEqual({ kind: "start" });
  });

  it("drawing: every click adds an anchor (far or near); the active end again finishes", () => {
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "15_2", null)).toEqual({ kind: "append" });
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "10_5", hit({ path: "Glass River" }))).toEqual({ kind: "append" });
    expect(pathClickOutcome(S({ activeHex: "9_5" }), "9_5", hit())).toEqual({ kind: "finish" });
  });

  it("selected: the line again forks, an end continues, another path of the type is selected, empty ground starts a new one", () => {
    const sel = S({ selected: "King's Road" });
    expect(pathClickOutcome(sel, "9_5", hit({ anchor: 1, end: "tail" }))).toEqual({ kind: "continue", path: "King's Road", branch: 0, end: "tail" });
    expect(pathClickOutcome(sel, "4_5", hit())).toEqual({ kind: "fork", path: "King's Road", branch: 0, hexIdx: 3 });
    expect(pathClickOutcome(sel, "12_3", hit({ path: "Old Track" }))).toEqual({ kind: "select", path: "Old Track" });
    expect(pathClickOutcome(sel, "3_12", null)).toEqual({ kind: "start" });
  });

  it("Alt-click / New path always starts a new path, even on another path", () => {
    expect(pathClickOutcome(S({ forceNew: true, selected: "King's Road" }), "4_5", hit())).toEqual({ kind: "start" });
    expect(pathClickOutcome(S({ forceNew: true, activeHex: "9_5" }), "4_5", null)).toEqual({ kind: "start" });
  });

  it("erase mode splits a path of the tool's type under the pointer, and does nothing elsewhere or on another type", () => {
    expect(pathClickOutcome(S({ erasing: true }), "4_5", hit())).toEqual({ kind: "split", path: "King's Road", branch: 0, hexIdx: 3 });
    expect(pathClickOutcome(S({ erasing: true }), "4_4", null)).toEqual({ kind: "none" });
    expect(pathClickOutcome(S({ erasing: true }), "12_3", hit({ path: "Glass River", editable: false }))).toEqual({ kind: "none" });
  });
});

describe("pathPressOutcome: what a left press gets ready to do", () => {
  const P = (o: Partial<{ forceNew: boolean; activeHex: string | null }> = {}) => ({ forceNew: false, activeHex: null, ...o });
  const hit = (o: Partial<PathHit> = {}): PathHit => ({ path: "King's Road", branch: 0, hexIdx: 3, hex: "4_5", anchor: null, end: null, editable: true, ...o });

  it("an anchor of the tool's type moves (ends too: a click on an end still continues), the line inserts an anchor and moves it", () => {
    expect(pathPressOutcome(P(), hit({ anchor: 1, hex: "6_5" }))).toBe("move");
    expect(pathPressOutcome(P(), hit({ anchor: 2, end: "tail", hex: "9_5" }))).toBe("move");
    expect(pathPressOutcome(P(), hit())).toBe("insert");
  });

  it("while drawing: other anchors still move, the active end and lines draw on", () => {
    expect(pathPressOutcome(P({ activeHex: "15_2" }), hit({ anchor: 1, hex: "6_5" }))).toBe("move");
    expect(pathPressOutcome(P({ activeHex: "9_5" }), hit({ anchor: 2, end: "tail", hex: "9_5" }))).toBe("draw");
    expect(pathPressOutcome(P({ activeHex: "15_2" }), hit())).toBe("draw");
  });

  it("another type's path, empty ground, Alt / New path: draw", () => {
    expect(pathPressOutcome(P(), hit({ editable: false }))).toBe("draw");
    expect(pathPressOutcome(P(), null)).toBe("draw");
    expect(pathPressOutcome(P({ forceNew: true }), hit({ anchor: 1 }))).toBe("draw");
  });
});

describe("pathContextOutcome: right-click", () => {
  const hit = (o: Partial<PathHit> = {}): PathHit => ({ path: "King's Road", branch: 1, hexIdx: 3, hex: "4_5", anchor: null, end: null, editable: true, ...o });

  it("an anchor of the tool's type is deleted; Shift opens the path's menu instead", () => {
    expect(pathContextOutcome(hit({ anchor: 2 }), false)).toEqual({ kind: "delete-anchor", path: "King's Road", branch: 1, anchor: 2 });
    expect(pathContextOutcome(hit({ anchor: 2 }), true)).toEqual({ kind: "menu", path: "King's Road", branch: 1, hexIdx: 3 });
  });

  it("the line opens the path's menu; another type's path offers a switch; nothing: the tool menu", () => {
    expect(pathContextOutcome(hit(), false)).toEqual({ kind: "menu", path: "King's Road", branch: 1, hexIdx: 3 });
    expect(pathContextOutcome(hit({ path: "Glass River", editable: false }), false)).toEqual({ kind: "switch", path: "Glass River" });
    expect(pathContextOutcome(null, false)).toEqual({ kind: "none" });
  });

  it("the hover hint over an inert path names its type", () => {
    expect(inertHint(GLASS)).toBe("switch to River to edit Glass River");
  });
});

describe("deleting an anchor that leaves one point", () => {
  it("says the branch or path went, and that undo brings it back; an ordinary delete says nothing", () => {
    const one: MapPath = { name: "Lane", typeName: "Road", branches: [{ anchors: ["0_0", "3_0"] }] };
    expect(anchorDeleteNotice(one, deleteAnchor(one, 0, 1), 0)).toBe("Deleted Lane: it had one point left. Undo brings it back.");
    expect(anchorDeleteNotice(KINGS, deleteAnchor(KINGS, 1, 1), 1)).toBe("Deleted a fork of King's Road: it had one point left. Undo brings it back.");
    expect(anchorDeleteNotice(KINGS, deleteAnchor(KINGS, 0, 0), 0)).toBe("Deleted the main line of King's Road: it had one point left. Undo brings it back.");
    const three: MapPath = { name: "Lane", typeName: "Road", branches: [{ anchors: ["0_0", "3_0", "6_0"] }] };
    expect(anchorDeleteNotice(three, deleteAnchor(three, 0, 1), 0)).toBeNull();
  });
});

describe("pathTool summaries", () => {
  it("the mode bar summary names the type and forks", () => {
    expect(pathSummary(KINGS)).toBe("Road, 1 fork");
    expect(pathSummary(GLASS)).toBe("River");
  });
});

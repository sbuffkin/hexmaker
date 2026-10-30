/**
 * Forks stay attached to their main line (owner decision 2026-10-11):
 * dragging the junction point carries the fork's start with it; deleting
 * it re-attaches the fork to the nearest point of the new route; when the
 * main line itself goes, its forks become paths of their own.
 */
import { describe, it } from "node:test";
import expect from "expect";
import type { MapPath } from "../src/types";
import { keepForksAttached, nearestOnRoute, splitOffOrphans } from "../src/paths/forks";
import { deleteAnchor, moveAnchor } from "../src/paths/edit";
import { resolvePaths } from "../src/paths/resolve";
import type { RouteContext } from "../src/paths/router";
import type { LatticeGrid } from "../src/paths/pathGeometry";

const grid: LatticeGrid = { orientation: "flat", stagger: "odd" };
const ctx: RouteContext = { orientation: "flat", stagger: "odd", bounds: { minX: 0, minY: 0, maxX: 19, maxY: 15 }, blocked: new Set() };
const routes = (p: MapPath) => {
  const r = resolvePaths([p], ctx);
  return p.branches.map((_, i) => r.find((x) => x.branch === i)?.hexes ?? []);
};
const forkOf = (p: MapPath, branch: number) => resolvePaths([p], ctx).find((x) => x.branch === branch)!;

describe("dragging the junction point carries the fork with it", () => {
  const P: MapPath = { name: "King's Road", typeName: "Road", branches: [{ anchors: ["1_5", "5_5", "9_5"] }, { anchors: ["5_5", "5_10"], label: "south" }] };

  it("the fork's first anchor moves to where the point was dropped, and it still forks there", () => {
    expect(forkOf(P, 1).forkFrom).toEqual({ branch: 0, hexIdx: expect.any(Number) });
    const moved = moveAnchor(P, 0, 1, "5_2");
    const out = keepForksAttached(moved, 0, routes(P)[0], routes(moved)[0], grid, { from: "5_5", to: "5_2" });
    expect(out.branches[1]).toEqual({ anchors: ["5_2", "5_10"], label: "south" });
    expect(out.branches[0].anchors).toEqual(["1_5", "5_2", "9_5"]);
    expect(forkOf(out, 1).forkFrom?.branch).toBe(0);
    // Without the rule the fork would be left hanging at 5_5.
    expect(forkOf(moved, 1).forkFrom).toBeUndefined();
  });

  it("a fork that left the route between anchors snaps to the nearest hex of the new route", () => {
    const Q: MapPath = { name: "R", typeName: "Road", branches: [{ anchors: ["1_5", "9_5"] }, { anchors: ["5_5", "5_10"] }] };
    const moved = moveAnchor(Q, 0, 1, "9_1");
    const now = routes(moved)[0];
    expect(now).not.toContain("5_5");
    const out = keepForksAttached(moved, 0, routes(Q)[0], now, grid, { from: "9_5", to: "9_1" });
    expect(out.branches[1].anchors[0]).toBe(nearestOnRoute("5_5", now, grid));
    expect(now).toContain(out.branches[1].anchors[0]);
    expect(out.branches[1].anchors[1]).toBe("5_10");
  });

  it("forks still on the new route, and other paths' branches, are left as they are (same object when nothing moves)", () => {
    const moved = moveAnchor(P, 0, 2, "9_6");
    const out = keepForksAttached(moved, 0, routes(P)[0], routes(moved)[0], grid, { from: "9_5", to: "9_6" });
    expect(out).toBe(moved);
  });

  it("a join (a branch ending on the moved point) follows too", () => {
    const J: MapPath = { name: "Loop", typeName: "Road", branches: [{ anchors: ["1_5", "5_5", "9_5"] }, { anchors: ["3_10", "5_5"] }] };
    const moved = moveAnchor(J, 0, 1, "5_3");
    const out = keepForksAttached(moved, 0, routes(J)[0], routes(moved)[0], grid, { from: "5_5", to: "5_3" });
    expect(out.branches[1].anchors).toEqual(["3_10", "5_3"]);
  });

  it("a fork whose start lands on its own next anchor merges with it; one left with a single anchor goes", () => {
    const M: MapPath = { name: "M", typeName: "Road", branches: [{ anchors: ["1_5", "5_5", "9_5"] }, { anchors: ["5_5", "5_8", "5_10"] }] };
    const moved = moveAnchor(M, 0, 1, "5_8");
    const out = keepForksAttached(moved, 0, routes(M)[0], routes(moved)[0], grid, { from: "5_5", to: "5_8" });
    expect(out.branches[1].anchors).toEqual(["5_8", "5_10"]);
    const S: MapPath = { name: "S", typeName: "Road", branches: [{ anchors: ["1_5", "5_5", "9_5"] }, { anchors: ["5_5", "5_8"] }] };
    const gone = keepForksAttached(moveAnchor(S, 0, 1, "5_8"), 0, routes(S)[0], routes(moveAnchor(S, 0, 1, "5_8"))[0], grid, { from: "5_5", to: "5_8" });
    expect(gone.branches).toHaveLength(1);
  });
});

describe("deleting the junction point re-attaches the fork to the nearest remaining point", () => {
  it("the fork's start moves onto the new route; its other anchors stay", () => {
    const P: MapPath = { name: "K", typeName: "Road", branches: [{ anchors: ["1_5", "5_1", "9_5"] }, { anchors: ["5_1", "4_0"] }] };
    const next = deleteAnchor(P, 0, 1)!;
    const now = routes(next)[0];
    expect(now).not.toContain("5_1");
    const out = keepForksAttached(next, 0, routes(P)[0], now, grid);
    expect(now).toContain(out.branches[1].anchors[0]);
    expect(out.branches[1].anchors[0]).toBe(nearestOnRoute("5_1", now, grid));
    expect(out.branches[1].anchors.slice(1)).toEqual(["4_0"]);
    expect(forkOf(out, 1).forkFrom?.branch).toBe(0);
  });
});

describe("when the main line goes, its forks become paths of their own", () => {
  const main = { anchors: ["1_5", "9_5"] };

  it("one fork: it keeps the path (name, notes) as its main line", () => {
    const P: MapPath = { name: "King's Road", typeName: "Road", notes: "old", branches: [main, { anchors: ["5_5", "5_10"] }] };
    const r = splitOffOrphans(P, 0, routes(P), ["King's Road"]);
    expect(r.path).toEqual({ name: "King's Road", typeName: "Road", notes: "old", branches: [{ anchors: ["5_5", "5_10"] }] });
    expect(r.split).toEqual([]);
  });

  it("two forks: the first keeps the path, the second becomes a new path; a fork of a fork goes with its parent", () => {
    const P: MapPath = {
      name: "King's Road",
      typeName: "Road",
      branches: [main, { anchors: ["3_5", "3_10"] }, { anchors: ["7_5", "7_12"] }, { anchors: ["7_9", "11_9"] }],
    };
    const before = routes(P);
    expect(before[2]).toContain("7_9");
    const r = splitOffOrphans(P, 0, before, ["King's Road", "Road"]);
    expect(r.path?.branches).toEqual([{ anchors: ["3_5", "3_10"] }]);
    expect(r.split).toEqual([{ name: "Road 2", typeName: "Road", branches: [{ anchors: ["7_5", "7_12"] }, { anchors: ["7_9", "11_9"] }] }]);
  });

  it("removing a fork splits off only what hung off that fork; the main line stays", () => {
    const P: MapPath = { name: "K", typeName: "Road", branches: [main, { anchors: ["7_5", "7_12"] }, { anchors: ["7_9", "11_9"] }, { anchors: ["3_5", "3_1"] }] };
    const r = splitOffOrphans(P, 1, routes(P), ["K"]);
    expect(r.path?.branches).toEqual([main, { anchors: ["3_5", "3_1"] }]);
    expect(r.split.map((s) => s.branches)).toEqual([[{ anchors: ["7_9", "11_9"] }]]);
  });

  it("a path with one branch is simply gone; a fork with nothing hanging off it just goes", () => {
    const one: MapPath = { name: "Lane", typeName: "Road", branches: [main] };
    expect(splitOffOrphans(one, 0, routes(one), ["Lane"])).toEqual({ path: null, split: [] });
    const P: MapPath = { name: "K", typeName: "Road", branches: [main, { anchors: ["5_5", "5_10"] }] };
    expect(splitOffOrphans(P, 1, routes(P), ["K"])).toEqual({ path: { name: "K", typeName: "Road", branches: [main] }, split: [] });
  });
});

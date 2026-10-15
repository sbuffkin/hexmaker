/**
 * Hooking onto a neighbour's road or river across the seam (owner O1,
 * 2026-10-14): which neighbour path ends a path here can hook onto, where
 * the hooked path starts, the click test, and carrying a path on across.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { crossFrom, HOOK_R, hookAt, hookedName, hookFor, seamHooks, touchingKeys, type NeighbourBranch, type StripRef } from "../src/paths/seamHook";
import { latticeCenter, type LatticeGrid } from "../src/paths/pathGeometry";

const grid: LatticeGrid = { orientation: "flat", stagger: "odd" };
const c = (k: string) => latticeCenter(k, grid);

/** This map: x 4..7, y 0..3. The strip: neighbour "West" at x 2..3, its own frame shifted by `dx`. */
function strip(dx = 0): Map<string, StripRef> {
  const s = new Map<string, StripRef>();
  for (let x = 2; x <= 3; x++) for (let y = 0; y <= 3; y++) s.set(`${x}_${y}`, { map: "West", x: x + dx, y });
  return s;
}
const inMap = (k: string) => {
  const [x, y] = k.split("_").map(Number);
  return x >= 4 && x <= 7 && y >= 0 && y <= 3;
};
const shift = (dx: number) => (k: string) => {
  const [x, y] = k.split("_").map(Number);
  return `${x + dx}_${y}`;
};
const road = (hexes: string[], extra: Partial<NeighbourBranch> = {}): NeighbourBranch => ({ path: "Kings Road", typeName: "Road", hexes, ...extra });

describe("seamHooks: neighbour path ends beside this map", () => {
  for (const dx of [0, 10]) {
    it(`finds a road ending on the edge, in its own frame shifted by ${dx}`, () => {
      const hexes = ["1_1", "2_1", "3_1"].map(shift(dx));
      const hooks = seamHooks(strip(dx), () => [road(hexes)], inMap, grid);
      expect(hooks).toHaveLength(1);
      const h = hooks[0];
      expect([h.map, h.path, h.typeName, h.end]).toEqual(["West", "Kings Road", "Road", "3_1"]);
      expect(h.touching.sort()).toEqual(touchingKeys("3_1", grid).filter(inMap).sort());
      expect(h.run).toEqual(["2_1", "3_1"]);
      // Straight on from 2_1 → 3_1 is 4_2 (the touching hex nearest the next step).
      expect(h.start).toBe("4_2");
    });
  }

  it("either end of a branch, whichever way it runs", () => {
    const hooks = seamHooks(strip(), () => [road(["3_2", "2_2", "1_2"])], inMap, grid);
    expect(hooks.map((h) => h.end)).toEqual(["3_2"]);
    expect(hooks[0].run).toEqual(["2_2", "3_2"]);
  });

  it("not an end away from the edge, nor a fork's start or a join's end", () => {
    expect(seamHooks(strip(), () => [road(["1_1", "2_1"])], inMap, grid)).toEqual([]); // 2_1 doesn't touch the map
    expect(seamHooks(strip(), () => [road(["3_1", "2_1", "1_1"], { forkFrom: { branch: 0, hexIdx: 0 } })], inMap, grid)).toEqual([]);
    expect(seamHooks(strip(), () => [road(["1_1", "2_1", "3_1"], { joinTo: { branch: 0, hexIdx: 0 } })], inMap, grid)).toEqual([]);
  });

  it("a one-hex branch on the edge is a hook too (any type: never by name)", () => {
    const hooks = seamHooks(strip(), () => [{ path: "Brook", typeName: "Stream", hexes: ["3_0"] }], inMap, grid);
    expect(hooks.map((h) => [h.typeName, h.end, h.run])).toEqual([["Stream", "3_0", ["3_0"]]]);
    expect(hooks[0].touching).toContain(hooks[0].start);
  });
});

describe("hookAt: the click test, in lattice units", () => {
  const hooks = seamHooks(strip(), () => [road(["1_1", "2_1", "3_1"])], inMap, grid);
  it("on the end hex, on the line across the strip", () => {
    expect(hookAt(c("3_1"), hooks, grid)?.path).toBe("Kings Road");
    const a = c("2_1"), b = c("3_1");
    expect(hookAt({ cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 }, hooks, grid)?.end).toBe("3_1");
    // Just inside the hook radius of the end, and just outside it.
    expect(hookAt({ cx: b.cx, cy: b.cy + HOOK_R - 0.01 }, hooks, grid)).not.toBeNull();
  });
  it("nothing a hex or more away", () => {
    expect(hookAt(c("3_3"), hooks, grid)).toBeNull();
    expect(hookAt(c("2_3"), hooks, grid)).toBeNull();
  });
});

describe("hookFor / hookedName: a path started beside a neighbour's takes its name", () => {
  const hooks = seamHooks(strip(), () => [road(["1_1", "2_1", "3_1"])], inMap, grid);
  it("same type, on a hex touching the end", () => {
    expect(hookFor("4_1", "Road", hooks)?.path).toBe("Kings Road");
    expect(hookFor("4_2", "Road", hooks)?.path).toBe("Kings Road");
    expect(hookFor("4_1", "River", hooks)).toBeNull();
    expect(hookFor("5_1", "Road", hooks)).toBeNull();
  });
  it("only when this map has no path called that yet", () => {
    expect(hookedName("Kings Road", ["Road"])).toBe("Kings Road");
    expect(hookedName("Kings Road", ["kings road"])).toBeNull();
  });
});

describe("crossFrom: drawing up to the edge carries on in the neighbour", () => {
  it("the strip hex touching the end nearest the click, as the neighbour's own hex", () => {
    const s = strip(10);
    expect(crossFrom("4_1", c("3_1"), s, grid)).toEqual({ map: "West", hex: "13_1", local: "3_1" });
    expect(crossFrom("4_1", c("3_0"), s, grid)).toEqual({ map: "West", hex: "13_0", local: "3_0" });
    // Clicked further out: still from the hex touching the end.
    expect(crossFrom("4_1", c("2_0"), s, grid)?.local).toBe("3_0");
  });
  it("null when the end isn't on the edge", () => {
    expect(crossFrom("5_1", c("3_1"), strip(), grid)).toBeNull();
  });
});

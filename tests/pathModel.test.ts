import { describe, it } from "node:test";
import expect from "expect";
import type { MapPath } from "../src/types";
import { routeSegment, type RouteContext, type SegmentStyle } from "../src/paths/router";
import { RouteCache, contextRouter, segmentKey } from "../src/paths/routeCache";
import { resolvePath, resolvePaths, resolvedToChains, routeBranch } from "../src/paths/resolve";
import {
  appendAnchor, clonePath, deleteAnchor, deleteBranch, forkAt, insertAnchorAt, moveAnchor,
  newPath, pinChanged, prependAnchor, reverseBranch, segmentFn, splitBranchAt,
} from "../src/paths/edit";
import { routeFnFor } from "../src/paths/fromHexes";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

type O = "flat" | "pointy";
type S = "odd" | "even";
const CONFIGS: [O, S][] = [["flat", "odd"], ["flat", "even"], ["pointy", "odd"], ["pointy", "even"]];
const ROAD: SegmentStyle = { avoid: true, winding: false };
const RIVER: SegmentStyle = { avoid: false, winding: true };

const ctxOf = (o: O = "flat", s: S = "odd", blocked: string[] = [], size = 16): RouteContext => ({
  orientation: o, stagger: s, bounds: { minX: 0, minY: 0, maxX: size - 1, maxY: size - 1 }, blocked: new Set(blocked),
});
const styleFor = (t: string): SegmentStyle | undefined => (t === "Road" ? ROAD : t === "River" ? RIVER : undefined);

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

const isNeighbour = (a: string, b: string, o: O, s: S) => {
  const [x, y] = a.split("_").map(Number);
  return hexNeighbors(x, y, o, s).some(([nx, ny]) => `${nx}_${ny}` === b);
};

const road = (anchors: string[][], name = "King's Road"): MapPath => ({
  name, typeName: "Road", branches: anchors.map((a) => ({ anchors: a })),
});

describe("resolve", () => {
  it("routes each segment, keeps joints once, and indexes the anchors", () => {
    const ctx = ctxOf();
    const [r] = resolvePaths([road([["0_0", "5_0", "5_6"]])], ctx, styleFor);
    const s1 = routeSegment("0_0", "5_0", { ...ctx, ...ROAD }).hexes;
    const s2 = routeSegment("5_0", "5_6", { ...ctx, ...ROAD }).hexes;
    expect(r.hexes).toEqual([...s1, ...s2.slice(1)]);
    expect(r.anchorIdx).toEqual([0, s1.length - 1, s1.length + s2.length - 2]);
    expect(r.fallbackSegments).toEqual([]);
    expect(r.path).toBe("King's Road");
    expect(r.branch).toBe(0);
    for (let k = 1; k < r.hexes.length; k++) expect(isNeighbour(r.hexes[k - 1], r.hexes[k], "flat", "odd")).toBe(true);
  });

  it("derives forks and joins from where a branch starts and ends", () => {
    const ctx = ctxOf();
    const [main] = resolvePaths([road([["0_4", "10_4"]])], ctx, styleFor);
    const mid = main.hexes[4];
    const p = road([["0_4", "10_4"], [mid, "5_12"], ["3_12", main.hexes[8]], ["14_14", "15_15"]]);
    const rs = resolvePaths([p], ctx, styleFor);
    expect(rs[0].forkFrom).toBeUndefined();
    expect(rs[1].forkFrom).toEqual({ branch: 0, hexIdx: 4 });
    expect(rs[2].forkFrom).toBeUndefined();
    expect(rs[2].joinTo).toEqual({ branch: 0, hexIdx: 8 });
    // A branch that doesn't touch the path is just a separate stretch.
    expect(rs[3].forkFrom).toBeUndefined();
    expect(rs[3].joinTo).toBeUndefined();
  });

  it("an anchor off the map or walled off is drawn with the hex-line fallback and flagged", () => {
    const walls = hexNeighbors(8, 8, "flat", "odd").map(([x, y]) => `${x}_${y}`);
    const ctx = ctxOf("flat", "odd", walls);
    const [r] = resolvePaths([road([["0_0", "8_8", "30_8"]])], ctx, styleFor);
    expect(r.fallbackSegments).toEqual([0, 1]);
    expect(r.hexes[r.hexes.length - 1]).toBe("30_8");
  });

  it("unknown types use the fixed default style (avoid, no winding), never one guessed from the name", () => {
    const ctx = ctxOf("flat", "odd", ["3_0", "3_1", "3_2"]);
    const as = (typeName: string): MapPath => ({ name: "x", typeName, branches: [{ anchors: ["0_1", "6_1"] }] });
    const [unknownRiver] = resolvePaths([as("Mystery river")], ctx, styleFor);
    expect(unknownRiver.hexes).toEqual(routeSegment("0_1", "6_1", { ...ctx, avoid: true, winding: false }).hexes);
    expect(unknownRiver.hexes).not.toContain("3_1");
    // Renaming a type changes nothing about routing (the style is all that counts).
    const renamed = (t: string) => (t === "Highway" ? ROAD : undefined);
    expect(resolvePaths([as("Highway")], ctx, renamed)[0].hexes).toEqual(resolvePaths([as("Road")], ctx, styleFor)[0].hexes);
  });

  it("a one-anchor branch resolves to its hex; an empty one to nothing", () => {
    const rs = resolvePath({ name: "a", typeName: "Road", branches: [{ anchors: ["2_2"] }, { anchors: [] }] }, contextRouter(ctxOf()), styleFor);
    expect(rs).toHaveLength(1);
    expect(rs[0].hexes).toEqual(["2_2"]);
    expect(rs[0].anchorIdx).toEqual([0]);
  });

  it("resolvedToChains gives the old PathChain shape", () => {
    const rs = resolvePaths([road([["0_0", "2_0"]])], ctxOf(), styleFor);
    expect(resolvedToChains(rs)).toEqual([{ typeName: "Road", hexes: rs[0].hexes }]);
  });
});

describe("locality (moving anchor k changes only segments k-1 and k)", () => {
  for (const [o, s] of CONFIGS) {
    it(`${o}, ${s}`, () => {
      const rand = rng(99);
      const blocked: string[] = [];
      for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (rand() < 0.2) blocked.push(`${x}_${y}`);
      const ctx = ctxOf(o, s, blocked);
      const pick = () => `${Math.floor(rand() * 16)}_${Math.floor(rand() * 16)}`;
      for (const style of [ROAD, RIVER]) {
        for (let trial = 0; trial < 15; trial++) {
          const anchors = Array.from({ length: 6 }, pick);
          const k = Math.floor(rand() * anchors.length);
          const moved = [...anchors];
          moved[k] = pick();
          const segs = (a: string[]) => a.slice(1).map((b, i) => routeSegment(a[i], b, { ...ctx, ...style }).hexes);
          const before = segs(anchors);
          const after = segs(moved);
          before.forEach((seg, i) => {
            if (i === k - 1 || i === k) return;
            expect(after[i]).toEqual(seg);
          });
          // The resolved branch is exactly the concatenation of its segments.
          const { hexes } = routeBranch(moved, style, contextRouter(ctx));
          expect(hexes).toEqual([moved[0], ...after.flatMap((seg) => seg.slice(1))]);
        }
      }
    });
  }
});

describe("edit ops", () => {
  const ctx = ctxOf();
  const router = contextRouter(ctx);
  const routeFn = routeFnFor(router, ROAD);
  const resolved = (p: MapPath, branch = 0) => resolvePath(p, router, styleFor).find((r) => r.branch === branch)!;
  const hexesOf = (p: MapPath | null) => (p ? resolvePath(p, router, styleFor).map((r) => r.hexes) : []);

  it("newPath names <Type>, <Type> 2… and has one anchor", () => {
    expect(newPath("Road", "3_3", [])).toEqual({ name: "Road", typeName: "Road", branches: [{ anchors: ["3_3"] }] });
    expect(newPath("Road", "3_3", ["road", "Road 2"]).name).toBe("Road 3");
  });

  it("append / prepend add anchors at the ends, never mutate, and ignore a repeat of the end", () => {
    const p = road([["2_2", "6_2"]]);
    const snapshot = clonePath(p);
    const q = appendAnchor(p, 0, "9_5");
    expect(q.branches[0].anchors).toEqual(["2_2", "6_2", "9_5"]);
    expect(prependAnchor(q, 0, "0_0").branches[0].anchors).toEqual(["0_0", "2_2", "6_2", "9_5"]);
    expect(appendAnchor(p, 0, "6_2")).toBe(p);
    expect(prependAnchor(p, 0, "2_2")).toBe(p);
    expect(p).toEqual(snapshot);
    expect(() => appendAnchor(p, 3, "1_1")).toThrow(RangeError);
  });

  it("forkAt starts a branch whose first anchor is the fork hex", () => {
    const p = road([["2_2", "9_2"]]);
    const r = resolved(p);
    const { path, branch } = forkAt(p, r.hexes[3], "to Saltmere");
    expect(branch).toBe(1);
    expect(path.branches[1]).toEqual({ label: "to Saltmere", anchors: [r.hexes[3]] });
    const forked = appendAnchor(path, 1, "5_9");
    expect(resolved(forked, 1).forkFrom).toEqual({ branch: 0, hexIdx: 3 });
    expect(p.branches).toHaveLength(1);
  });

  it("insertAnchorAt puts a routed hex between the anchors around it (and reports an existing anchor)", () => {
    const p = road([["0_0", "8_0", "8_8"]]);
    const r = resolved(p);
    const mid = r.anchorIdx[1];
    const a = insertAnchorAt(p, r, 3);
    expect(a.inserted).toBe(true);
    expect(a.anchor).toBe(1);
    expect(a.path.branches[0].anchors).toEqual(["0_0", r.hexes[3], "8_0", "8_8"]);
    const b = insertAnchorAt(p, r, mid + 2);
    expect(b.anchor).toBe(2);
    expect(b.path.branches[0].anchors).toEqual(["0_0", "8_0", r.hexes[mid + 2], "8_8"]);
    const c = insertAnchorAt(p, r, mid);
    expect(c).toEqual({ path: p, anchor: 1, inserted: false });
    // On open ground, pinning a routed hex of a straight run keeps the line.
    expect(hexesOf(a.path)[0]).toEqual(r.hexes);
  });

  it("moveAnchor moves one anchor", () => {
    const p = road([["0_0", "4_4", "8_0"]]);
    expect(moveAnchor(p, 0, 1, "4_10").branches[0].anchors).toEqual(["0_0", "4_10", "8_0"]);
    expect(moveAnchor(p, 0, 1, "4_4")).toBe(p);
    expect(() => moveAnchor(p, 0, 3, "1_1")).toThrow(RangeError);
  });

  it("deleteAnchor joins two segments; a branch left with one anchor goes; the last branch → null", () => {
    const p = road([["0_0", "4_4", "8_0"], ["4_4", "4_9"]]);
    expect(deleteAnchor(p, 0, 1)!.branches[0].anchors).toEqual(["0_0", "8_0"]);
    const q = deleteAnchor(p, 1, 1)!;
    expect(q.branches).toHaveLength(1);
    expect(deleteAnchor(road([["0_0", "1_0"]]), 0, 0)).toBeNull();
    expect(deleteBranch(p, 0)!.branches).toEqual([{ anchors: ["4_4", "4_9"] }]);
    expect(deleteBranch(road([["0_0", "1_0"]]), 0)).toBeNull();
  });

  it("splitBranchAt erases one hex; both pieces keep their hexes exactly and their anchors", () => {
    const p = road([["0_3", "7_3", "12_9"]]);
    p.branches[0].label = "main";
    const r = resolved(p);
    for (let i = 0; i < r.hexes.length; i++) {
      const out = splitBranchAt(p, r, i, routeFn, ctx);
      const pieces = [r.hexes.slice(0, i), r.hexes.slice(i + 1)].filter((x) => x.length >= 2);
      expect(hexesOf(out)).toEqual(pieces);
      if (out && i >= 2) expect(out.branches[0].label).toBe("main");
      if (out) for (const b of out.branches) for (const a of b.anchors) expect(r.hexes).toContain(a);
      // The original anchors on each side are kept.
      if (out && i > r.anchorIdx[1]) expect(out.branches[0].anchors.slice(0, 2)).toEqual(["0_3", "7_3"]);
    }
    expect(splitBranchAt(road([["0_0", "1_0"]]), resolved(road([["0_0", "1_0"]])), 0, routeFn)).toBeNull();
  });

  it("reverseBranch keeps the line: the reversed branch routes to the reversed hexes", () => {
    for (const [o, s] of CONFIGS) {
      const c = ctxOf(o, s, ["4_4", "4_5", "5_5", "6_3"]);
      const rt = contextRouter(c);
      const p = road([["0_0", "9_7", "2_12", "14_13"]]);
      const r = resolvePath(p, rt, styleFor)[0];
      const q = reverseBranch(p, r, routeFnFor(rt, ROAD), c);
      expect(resolvePath(q, rt, styleFor)[0].hexes).toEqual([...r.hexes].reverse());
      expect(q.branches[0].anchors[0]).toBe("14_13");
    }
  });
});

describe("pinChanged (Decision 3: keep the old route)", () => {
  const paths: MapPath[] = [
    road([["0_5", "12_5"]]),
    { name: "Glass River", typeName: "River", branches: [{ anchors: ["0_10", "15_10"] }] },
  ];

  it("painting water under a road keeps its hexes and adds anchors; painting forest adds nothing", () => {
    const before = new RouteCache(ctxOf());
    const oldRes = resolvePaths(paths, ctxOf(), styleFor, before);
    const roadHexes = oldRes[0].hexes;
    // "Forest": a change that doesn't touch blocked hexes: same signature, nothing to pin.
    expect(before.setContext(ctxOf())).toBe(false);
    // "Water" painted on three hexes of the road.
    const water = roadHexes.slice(3, 6);
    const changed = before.setContext(ctxOf("flat", "odd", water));
    expect(changed).toBe(true);
    const { paths: pinnedPaths, pinned } = pinChanged(paths, segmentFn(before.previous()!, styleFor), segmentFn(before, styleFor), ctxOf());
    expect(pinned.map((x) => x.path)).toEqual(["King's Road"]);
    expect(pinned[0].added).toBeGreaterThan(0);
    const after = resolvePaths(pinnedPaths, ctxOf("flat", "odd", water), styleFor, before);
    expect(after[0].hexes).toEqual(roadHexes);
    // The river ignores impassable terrain: untouched, same object.
    expect(pinnedPaths[1]).toBe(paths[1]);
    // "Reroute instead" = the original anchors: the road goes round the water.
    const rerouted = resolvePaths(paths, ctxOf("flat", "odd", water), styleFor)[0].hexes;
    expect(rerouted).not.toEqual(roadHexes);
    for (const w of water) expect(rerouted).not.toContain(w);
  });

  it("a resize that cuts a route is pinned too", () => {
    const old = ctxOf("pointy", "even", [], 16);
    const small: RouteContext = { ...old, bounds: { minX: 0, minY: 0, maxX: 15, maxY: 6 } };
    const p = [road([["0_6", "8_0", "15_6"]])];
    const oldHexes = resolvePaths(p, old, styleFor)[0].hexes;
    const res = pinChanged(p, segmentFn(contextRouter(old), styleFor), segmentFn(contextRouter(small), styleFor), small);
    expect(resolvePaths(res.paths, small, styleFor)[0].hexes).toEqual(oldHexes);
  });

  it("a type's style change (winding on) is pinned like a context change", () => {
    const ctx = ctxOf();
    const p = [road([["0_0", "14_12"]])];
    const oldHexes = resolvePaths(p, ctx, styleFor)[0].hexes;
    const winding = (t: string) => (t === "Road" ? { avoid: true, winding: true } : undefined);
    const res = pinChanged(p, segmentFn(contextRouter(ctx), styleFor), segmentFn(contextRouter(ctx), winding), ctx);
    expect(res.pinned).toHaveLength(1);
    expect(resolvePaths(res.paths, ctx, winding)[0].hexes).toEqual(oldHexes);
  });
});

describe("RouteCache", () => {
  it("reuses segments under one signature and keeps the previous generation on a change", () => {
    const cache = new RouteCache();
    expect(() => cache.route("0_0", "1_0", ROAD)).toThrow();
    cache.setContext(ctxOf());
    const a = cache.route("0_0", "9_9", ROAD);
    expect(cache.route("0_0", "9_9", ROAD)).toBe(a);
    expect(cache.size).toBe(1);
    // A different style is a different segment.
    expect(cache.route("0_0", "9_9", RIVER)).not.toBe(a);
    expect(segmentKey("0_0", "9_9", ROAD)).not.toBe(segmentKey("9_9", "0_0", ROAD));
    expect(cache.previous()).toBeNull();
    expect(cache.setContext(ctxOf("flat", "odd", ["4_4"]))).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.previous()!.route("0_0", "9_9", ROAD)).toBe(a);
    cache.dropPrevious();
    expect(cache.previous()).toBeNull();
  });

  it("resolving with and without a cache gives the same result", () => {
    const ctx = ctxOf("pointy", "odd", ["3_3", "4_3", "5_3"]);
    const p = [road([["0_0", "8_8", "15_2"], ["8_8", "2_14"]]), { name: "R", typeName: "River", branches: [{ anchors: ["0_15", "15_0"] }] }];
    const cache = new RouteCache();
    expect(resolvePaths(p, ctx, styleFor, cache)).toEqual(resolvePaths(p, ctx, styleFor));
    expect(resolvePaths(p, ctx, styleFor, cache)).toEqual(resolvePaths(p, ctx, styleFor));
  });
});

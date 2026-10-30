import { describe, it } from "node:test";
import expect from "expect";
import type { MapPath, PathChain } from "../src/types";
import type { RouteContext, SegmentStyle } from "../src/paths/router";
import { contextRouter } from "../src/paths/routeCache";
import { resolvePaths } from "../src/paths/resolve";
import { anchorsFor, compactLegacy, mergeChains, reproduces, routeFnFor, stepKey, stepsOf } from "../src/paths/fromHexes";
import { legacyChainsToPaths } from "../src/paths/legacy";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

type O = "flat" | "pointy";
type S = "odd" | "even";
const CONFIGS: [O, S][] = [["flat", "odd"], ["flat", "even"], ["pointy", "odd"], ["pointy", "even"]];
const ROAD: SegmentStyle = { avoid: true, winding: false };
const RIVER: SegmentStyle = { avoid: false, winding: true };
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

const SIZE = 14;
const ctxOf = (o: O, s: S, blocked: Set<string> = new Set()): RouteContext => ({
  orientation: o, stagger: s, bounds: { minX: -2, minY: -3, maxX: SIZE - 3, maxY: SIZE - 4 }, blocked,
});

/** A random neighbour-connected walk inside the bounds; `straightness` biases it to keep going. */
function walk(rand: () => number, ctx: RouteContext, len: number, start?: string, straightness = 0.6): string[] {
  const b = ctx.bounds;
  const inB = ([x, y]: [number, number]) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  const first = start ?? `${b.minX + Math.floor(rand() * (b.maxX - b.minX + 1))}_${b.minY + Math.floor(rand() * (b.maxY - b.minY + 1))}`;
  const out = [first];
  let dir = Math.floor(rand() * 6);
  while (out.length < len) {
    const [x, y] = out[out.length - 1].split("_").map(Number);
    const nb = hexNeighbors(x, y, ctx.orientation, ctx.stagger);
    if (rand() > straightness) dir = Math.floor(rand() * 6);
    let next = nb[dir];
    if (!inB(next)) {
      const ok = nb.filter(inB);
      next = ok[Math.floor(rand() * ok.length)];
    }
    out.push(`${next[0]}_${next[1]}`);
  }
  return out;
}

function randomBlocked(rand: () => number, ctx: RouteContext, p: number): Set<string> {
  const s = new Set<string>();
  const b = ctx.bounds;
  for (let x = b.minX; x <= b.maxX; x++) for (let y = b.minY; y <= b.maxY; y++) if (rand() < p) s.add(`${x}_${y}`);
  return s;
}

/** Oracle: the segment graph's connected components of same-type chains that touch at an end. */
function touches(a: readonly string[], b: readonly string[]): boolean {
  const sb = new Set(b);
  const sa = new Set(a);
  return sb.has(a[0]) || sb.has(a[a.length - 1]) || sa.has(b[0]) || sa.has(b[b.length - 1]);
}

describe("anchorsFor (greedy) is exact on random neighbour-connected chains", () => {
  for (const [o, s] of CONFIGS) {
    for (const style of [ROAD, RIVER]) {
      it(`${o}, ${s}, ${style.winding ? "winding" : "direct"}`, () => {
        const rand = rng(o.length * 31 + s.length * 7 + (style.winding ? 1 : 0));
        for (let trial = 0; trial < 60; trial++) {
          const base = ctxOf(o, s);
          const ctx = { ...ctxOf(o, s, randomBlocked(rand, base, trial % 3 === 0 ? 0 : 0.2)), ...style };
          // Includes back-tracking scribbles (low straightness) and walks across blocked hexes.
          const chain = walk(rand, ctx, 2 + Math.floor(rand() * 25), undefined, trial % 4 === 0 ? 0.1 : 0.7);
          const anchors = anchorsFor(chain, ctx);
          expect(anchors[0]).toBe(chain[0]);
          expect(anchors[anchors.length - 1]).toBe(chain[chain.length - 1]);
          expect(anchors.length).toBeLessThanOrEqual(chain.length);
          expect(reproduces(anchors, chain, ctx)).toBe(true);
          // Same through a cached router.
          expect(anchorsFor(chain, routeFnFor(contextRouter(ctx), style), ctx)).toEqual(anchors);
        }
      });
    }
  }

  it("a chain the router would draw itself needs only its two ends", () => {
    const ctx = { ...ctxOf("flat", "odd"), ...ROAD };
    const route = routeFnFor(contextRouter(ctx), ROAD)("0_0", "9_6").hexes;
    expect(anchorsFor(route, ctx)).toEqual(["0_0", "9_6"]);
  });

  it("collapses consecutive repeats; one hex stays one anchor", () => {
    const ctx = { ...ctxOf("flat", "odd"), ...ROAD };
    expect(anchorsFor(["2_2", "2_2", "3_2", "3_2"], ctx)).toEqual(["2_2", "3_2"]);
    expect(anchorsFor(["2_2"], ctx)).toEqual(["2_2"]);
    expect(anchorsFor([], ctx)).toEqual([]);
  });
});

describe("mergeChains is segment-exact", () => {
  for (const [o, s] of CONFIGS) {
    it(`random networks (${o}, ${s})`, () => {
      const rand = rng(1234 + o.length + s.length);
      for (let trial = 0; trial < 80; trial++) {
        const ctx = ctxOf(o, s);
        const chains: string[][] = [];
        const n = 1 + Math.floor(rand() * 7);
        for (let i = 0; i < n; i++) {
          // Half the chains start (or end) on an earlier chain: forks, continuations, joins.
          let start: string | undefined;
          if (chains.length && rand() < 0.6) {
            const c = chains[Math.floor(rand() * chains.length)];
            start = rand() < 0.4 ? c[c.length - 1] : c[Math.floor(rand() * c.length)];
          }
          const w = walk(rand, ctx, 2 + Math.floor(rand() * 9), start, rand() < 0.2 ? 0.1 : 0.7);
          chains.push(rand() < 0.3 ? w.reverse() : w);
        }
        if (rand() < 0.3) chains.push([...chains[0]].reverse()); // a duplicate stroke
        const groups = mergeChains(chains);
        // Every chain is in exactly one group.
        expect(groups.flatMap((g) => g.members).sort((a, b) => a - b)).toEqual(chains.map((_, i) => i));
        for (const g of groups) {
          // Same set of steps as the chains that went in.
          const want = stepsOf(g.members.map((m) => chains[m]));
          const got = stepsOf(g.branches);
          expect([...got].sort()).toEqual([...want].sort());
          // Branches are neighbour-connected strokes.
          for (const br of g.branches) {
            for (let k = 1; k < br.length; k++) {
              const [x, y] = br[k - 1].split("_").map(Number);
              expect(hexNeighbors(x, y, o, s).some(([nx, ny]) => `${nx}_${ny}` === br[k])).toBe(true);
            }
          }
        }
        // Chains in different groups never touch end-on.
        for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
          for (const i of groups[a].members) for (const j of groups[b].members) {
            if (chains[i].length >= 2 && chains[j].length >= 2) expect(touches(chains[i], chains[j])).toBe(false);
          }
        }
      }
    });
  }

  it("continuations append (reversed if needed), forks start on the path, duplicates drop, crossings stay apart", () => {
    const trunk = ["0_0", "1_0", "2_0", "3_0"];
    const groups = mergeChains([
      trunk,
      ["5_0", "4_0", "3_0"], // ends on the tail: appended reversed
      ["2_0", "2_1", "2_2"], // starts on the interior: a fork
      ["1_0", "2_0"], // already drawn: a duplicate
      ["9_5", "9_6", "9_7"], // elsewhere
      ["8_6", "9_6", "10_6"], // crosses the previous one mid-way only
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({
      branches: [["0_0", "1_0", "2_0", "3_0", "4_0", "5_0"], ["2_0", "2_1", "2_2"]],
      members: [0, 1, 2, 3],
      duplicates: [3],
    });
    expect(groups[1].members).toEqual([4]);
    expect(groups[2].members).toEqual([5]);
  });

  it("a chain continuing the main line's head is prepended", () => {
    const [g] = mergeChains([["2_0", "3_0", "4_0", "5_0"], ["0_0", "1_0", "2_0"]]);
    expect(g.branches).toEqual([["0_0", "1_0", "2_0", "3_0", "4_0", "5_0"]]);
  });

  it("stepKey is undirected", () => {
    expect(stepKey("1_0", "0_0")).toBe(stepKey("0_0", "1_0"));
  });
});

describe("compactLegacy", () => {
  const ctx = ctxOf("flat", "odd");
  const chains: PathChain[] = [
    { typeName: "Road", hexes: ["0_0", "1_0", "2_0", "3_0", "4_0", "5_0"] },
    { typeName: "Road", hexes: ["5_0"] }, // a restart-click leftover
    { typeName: "River", hexes: ["0_5", "1_5", "2_5", "3_5", "2_5", "1_5", "1_6"] }, // a scribble
    { typeName: "Road", hexes: ["5_0", "6_0", "7_0"] }, // continues the first road
    { typeName: "Road", hexes: ["3_0", "3_1", "3_2", "3_3"] }, // a fork
    { typeName: "Road", hexes: ["8_8"], extra: { Notes: "Ruined waystation" } }, // a single with notes
    { typeName: "Road", hexes: ["9_9"], extra: { Built: "1203" } }, // a single with an extra column
    { typeName: "Trail", hexes: ["0_9", "1_9", "2_9"] },
    { typeName: "Road", hexes: ["7_5", "7_6", "7_7"], extra: { Notes: "Toll road" } },
  ];
  const legacy = legacyChainsToPaths(chains);
  const resolvedSteps = (ps: MapPath[], typeName: string) =>
    stepsOf(resolvePaths(ps.filter((p) => p.typeName === typeName), ctx, styleFor).map((r) => r.hexes));

  it("merges touching chains, compresses, drops bare one-hex leftovers, and keeps every step", () => {
    const { paths, report } = compactLegacy(legacy, ctx, { dropSingles: true, styleFor });
    expect(paths.map((p) => [p.name, p.typeName, p.branches.length])).toEqual([
      ["Road", "Road", 2],
      ["River", "River", 1],
      ["Road 2", "Road", 1],
      ["Road 3", "Road", 1],
      ["Trail", "Trail", 1],
      ["Road 4", "Road", 1],
    ]);
    expect(report.singlesDropped).toEqual([{ name: "Road 2", typeName: "Road", hex: "5_0" }]);
    expect(report.merged).toEqual([{ name: "Road", from: ["Road", "Road 3", "Road 4"] }]);
    expect(report.inexact).toEqual([]);
    expect(report.pathsIn).toBe(9);
    expect(report.pathsOut).toBe(6);
    expect(report.anchors).toBe(paths.reduce((n, p) => n + p.branches.reduce((m, b) => m + b.anchors.length, 0), 0));
    // Notes and extra columns survive.
    expect(paths[2]).toEqual({ name: "Road 2", typeName: "Road", notes: "Ruined waystation", branches: [{ anchors: ["8_8"] }] });
    expect(paths[3].extra).toEqual({ Built: "1203" });
    expect(paths[5].notes).toBe("Toll road");
    // Every drawn step is still drawn, per type.
    for (const t of ["Road", "River", "Trail"]) {
      const want = stepsOf(chains.filter((c) => c.typeName === t).map((c) => c.hexes));
      expect([...resolvedSteps(paths, t)].sort()).toEqual([...want].sort());
    }
    // The scribble reproduces its exact stroke.
    const river = resolvePaths([paths[1]], ctx, styleFor)[0];
    expect(river.hexes).toEqual(chains[2].hexes);
  });

  it("keeps one-hex leftovers as one-anchor paths when not dropping", () => {
    const { paths, report } = compactLegacy(legacy, ctx, { dropSingles: false, styleFor });
    expect(report.singlesDropped).toEqual([]);
    expect(paths.filter((p) => p.branches[0].anchors.length === 1)).toHaveLength(3);
  });

  it("combines differing notes of merged chains instead of losing one", () => {
    const ps = legacyChainsToPaths([
      { typeName: "Road", hexes: ["0_0", "1_0", "2_0"], extra: { Notes: "North half" } },
      { typeName: "Road", hexes: ["2_0", "3_0"], extra: { Notes: "South half" } },
    ]);
    const { paths, report } = compactLegacy(ps, ctx, { dropSingles: true, styleFor });
    expect(paths).toHaveLength(1);
    expect(paths[0].notes).toBe("North half; South half");
    expect(report.combinedText).toEqual(["Road"]);
  });

  it("passes non-legacy paths through and names around them", () => {
    const anchored: MapPath = { name: "Road", typeName: "Road", branches: [{ label: "main", anchors: ["0_7", "5_7"] }] };
    const ps = [anchored, ...legacyChainsToPaths([{ typeName: "Road", hexes: ["0_3", "1_3"] }], ["Road"])];
    const { paths } = compactLegacy(ps, ctx, { dropSingles: true, styleFor });
    expect(paths[0]).toBe(anchored);
    expect(paths[1].name).toBe("Road 2");
  });

  it("is deterministic (same input → same output)", () => {
    expect(compactLegacy(legacy, ctx, { dropSingles: true, styleFor })).toEqual(compactLegacy(legacy, ctx, { dropSingles: true, styleFor }));
  });

  it("a gap in a legacy chain (not neighbour-connected) keeps dense anchors and is reported", () => {
    const ps = legacyChainsToPaths([{ typeName: "Road", hexes: ["0_0", "1_0", "6_6"] }]);
    const { paths, report } = compactLegacy(ps, ctx, { dropSingles: true, styleFor });
    expect(paths[0].branches[0].anchors).toEqual(["0_0", "1_0", "6_6"]);
    expect(report.inexact).toEqual(["Road"]);
  });
});

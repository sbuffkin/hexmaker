import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ROUTER_VERSION,
  contextSignature,
  hexDistance,
  hexLine,
  routeSegment,
  type RouteBounds,
  type RouteContext,
} from "../src/paths/router";
import { findRoute as findRouteViaAutoRoute } from "../src/hex-map/autoRoute";
import { hexNeighbors } from "../src/hex-map/hexGeometry";

type O = "flat" | "pointy";
type S = "odd" | "even";
interface RouteCase {
  id: string;
  orientation: O;
  stagger: S;
  bounds: RouteBounds;
  blocked: string[];
  avoid: boolean;
  winding: boolean;
  from: string;
  to: string;
  expected: { hexes: string[]; fallback?: "out-of-bounds" | "no-route" };
}
interface Fixture {
  routerVersion: number;
  routes: RouteCase[];
  hexLines: { orientation: O; stagger: S; from: string; to: string; expected: string[] }[];
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/router-v1.json"), "utf8")) as Fixture;
const CONFIGS: [O, S][] = [["flat", "odd"], ["flat", "even"], ["pointy", "odd"], ["pointy", "even"]];

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

function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isNeighbour = (a: string, b: string, o: O, s: S) => {
  const [x, y] = a.split("_").map(Number);
  return hexNeighbors(x, y, o, s).some(([nx, ny]) => `${nx}_${ny}` === b);
};

describe("ROUTER v1 golden cases (a failure here means the router changed: that is ROUTER v2 + re-anchoring)", () => {
  it("fixture is for this router version and has about 60 cases", () => {
    expect(fixture.routerVersion).toBe(ROUTER_VERSION);
    expect(ROUTER_VERSION).toBe(1);
    expect(fixture.routes.length).toBeGreaterThanOrEqual(60);
  });

  for (const c of fixture.routes) {
    it(c.id, () => {
      const r = routeSegment(c.from, c.to, {
        orientation: c.orientation, stagger: c.stagger, bounds: c.bounds,
        blocked: new Set(c.blocked), avoid: c.avoid, winding: c.winding,
      });
      expect(r.hexes).toEqual(c.expected.hexes);
      expect(r.fallback).toBe(c.expected.fallback);
    });
  }

  it("autoRoute.ts re-exports the same router", () => {
    for (const c of fixture.routes.filter((r) => !r.expected.fallback)) {
      const blocked = new Set(c.blocked);
      const r = findRouteViaAutoRoute(c.from, c.to, {
        orientation: c.orientation, stagger: c.stagger, bounds: c.bounds, meander: c.winding,
        blocked: c.avoid ? (x, y) => blocked.has(`${x}_${y}`) : undefined,
      });
      expect(r).toEqual({ ok: true, hexes: c.expected.hexes });
    }
  });

  for (const l of fixture.hexLines) {
    it(`hexLine ${l.orientation}-${l.stagger} ${l.from} → ${l.to} (edge ties break the same way)`, () => {
      expect(hexLine(l.from, l.to, l.orientation, l.stagger)).toEqual(l.expected);
    });
  }
});

describe("router invariants", () => {
  for (const [o, s] of CONFIGS) {
    it(`same input → same route whatever order the blocked set was built in (${o}, ${s})`, () => {
      const rand = rng(42);
      const bounds = { minX: -3, minY: -2, maxX: 14, maxY: 11 };
      for (let trial = 0; trial < 20; trial++) {
        const blocked: string[] = [];
        for (let x = bounds.minX; x <= bounds.maxX; x++) for (let y = bounds.minY; y <= bounds.maxY; y++) if (rand() < 0.25) blocked.push(`${x}_${y}`);
        const from = `${bounds.minX + Math.floor(rand() * 18)}_${bounds.minY + Math.floor(rand() * 14)}`;
        const to = `${bounds.minX + Math.floor(rand() * 18)}_${bounds.minY + Math.floor(rand() * 14)}`;
        for (const winding of [false, true]) {
          const ctxA: RouteContext = { orientation: o, stagger: s, bounds, blocked: new Set(blocked) };
          const ctxB: RouteContext = { orientation: o, stagger: s, bounds, blocked: new Set(shuffled(blocked, rand)) };
          const a = routeSegment(from, to, { ...ctxA, avoid: true, winding });
          const b = routeSegment(from, to, { ...ctxB, avoid: true, winding });
          expect(b).toEqual(a);
          expect(contextSignature(ctxB)).toBe(contextSignature(ctxA));
        }
      }
    });

    it(`neighbours always route as the direct step, even when both are blocked (${o}, ${s})`, () => {
      const bounds = { minX: 0, minY: 0, maxX: 9, maxY: 9 };
      const all = new Set<string>();
      for (let x = 0; x <= 9; x++) for (let y = 0; y <= 9; y++) all.add(`${x}_${y}`);
      for (let x = 0; x <= 9; x++) for (let y = 0; y <= 9; y++) {
        for (const [nx, ny] of hexNeighbors(x, y, o, s)) {
          if (nx < 0 || ny < 0 || nx > 9 || ny > 9) continue;
          for (const winding of [false, true]) {
            const r = routeSegment(`${x}_${y}`, `${nx}_${ny}`, { orientation: o, stagger: s, bounds, blocked: all, avoid: true, winding });
            expect(r).toEqual({ hexes: [`${x}_${y}`, `${nx}_${ny}`] });
          }
        }
      }
    });

    it(`hexLine is a neighbour-connected line of distance + 1 hexes (${o}, ${s})`, () => {
      const rand = rng(7);
      for (let i = 0; i < 300; i++) {
        const a = `${Math.floor(rand() * 30) - 15}_${Math.floor(rand() * 30) - 15}`;
        const b = `${Math.floor(rand() * 30) - 15}_${Math.floor(rand() * 30) - 15}`;
        const line = hexLine(a, b, o, s);
        const [ax, ay] = a.split("_").map(Number);
        const [bx, by] = b.split("_").map(Number);
        expect(line.length).toBe(hexDistance([ax, ay], [bx, by], o, s) + 1);
        expect(line[0]).toBe(a);
        expect(line[line.length - 1]).toBe(b);
        for (let k = 1; k < line.length; k++) expect(isNeighbour(line[k - 1], line[k], o, s)).toBe(true);
        expect(hexLine(a, b, o, s)).toEqual(line);
      }
    });
  }

  it("routeSegment never fails: off-map and walled-off segments fall back to the hex line", () => {
    const bounds = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
    const off = routeSegment("1_1", "9_9", { orientation: "flat", stagger: "odd", bounds, blocked: new Set(), avoid: true, winding: false });
    expect(off.fallback).toBe("out-of-bounds");
    expect(off.hexes).toEqual(hexLine("1_1", "9_9", "flat", "odd"));
    const walls = new Set(hexNeighbors(3, 3, "flat", "odd").map(([x, y]) => `${x}_${y}`));
    const walled = routeSegment("0_0", "3_3", { orientation: "flat", stagger: "odd", bounds, blocked: walls, avoid: true, winding: false });
    expect(walled.fallback).toBe("no-route");
    expect(walled.hexes).toEqual(hexLine("0_0", "3_3", "flat", "odd"));
    // With avoid off, the same walls don't matter.
    const through = routeSegment("0_0", "3_3", { orientation: "flat", stagger: "odd", bounds, blocked: walls, avoid: false, winding: false });
    expect(through.fallback).toBeUndefined();
  });

  it("contextSignature covers everything a route depends on, and nothing else", () => {
    const base: RouteContext = { orientation: "flat", stagger: "odd", bounds: { minX: 0, minY: 0, maxX: 9, maxY: 9 }, blocked: new Set(["2_2", "3_3"]) };
    const sig = contextSignature(base);
    expect(sig).toMatch(/^v1\|/);
    expect(contextSignature({ ...base, blocked: new Set(["3_3", "2_2"]) })).toBe(sig);
    // A blocked hex outside the bounds can't affect a route.
    expect(contextSignature({ ...base, blocked: new Set(["2_2", "3_3", "40_40"]) })).toBe(sig);
    expect(contextSignature({ ...base, blocked: new Set(["2_2", "3_4"]) })).not.toBe(sig);
    expect(contextSignature({ ...base, blocked: new Set(["2_2"]) })).not.toBe(sig);
    expect(contextSignature({ ...base, orientation: "pointy" })).not.toBe(sig);
    expect(contextSignature({ ...base, stagger: "even" })).not.toBe(sig);
    expect(contextSignature({ ...base, bounds: { minX: 0, minY: 0, maxX: 9, maxY: 10 } })).not.toBe(sig);
  });
});

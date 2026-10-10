/**
 * Writes tests/fixtures/router-v1.json: the golden cases that freeze ROUTER v1.
 *
 * Run ONLY when deliberately creating the fixture for a router version:
 *   npx tsx --tsconfig ./tsconfig.test.json --import ./tests/register.mjs tests/helpers/genRouterGolden.ts
 * A router change that alters any case is ROUTER v2: write a new fixture
 * (router-v2.json) and a re-anchoring migration; never regenerate v1.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { hexLine, routeSegment, type RouteBounds } from "../../src/paths/router";
import { hexNeighbors } from "../../src/hex-map/hexGeometry";

type O = "flat" | "pointy";
type S = "odd" | "even";
interface Case {
  id: string;
  orientation: O;
  stagger: S;
  bounds: RouteBounds;
  blocked: string[];
  avoid: boolean;
  winding: boolean;
  from: string;
  to: string;
}

/** mulberry32 */
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

const B = (minX: number, minY: number, maxX: number, maxY: number): RouteBounds => ({ minX, minY, maxX, maxY });
const CONFIGS: [O, S][] = [["flat", "odd"], ["flat", "even"], ["pointy", "odd"], ["pointy", "even"]];

const cases: Case[] = [];
for (const [o, s] of CONFIGS) {
  const tag = `${o}-${s}`;
  const add = (name: string, c: Omit<Case, "id" | "orientation" | "stagger">) => cases.push({ id: `${tag}/${name}`, orientation: o, stagger: s, ...c });
  const open = B(0, 0, 11, 9);
  add("open-diagonal", { bounds: open, blocked: [], avoid: true, winding: false, from: "0_0", to: "11_9" });
  add("open-diagonal-winding", { bounds: open, blocked: [], avoid: true, winding: true, from: "0_0", to: "11_9" });
  add("open-diagonal-reversed", { bounds: open, blocked: [], avoid: true, winding: false, from: "11_9", to: "0_0" });
  add("straight-x", { bounds: open, blocked: [], avoid: true, winding: false, from: "1_4", to: "10_4" });
  add("straight-y", { bounds: open, blocked: [], avoid: true, winding: false, from: "5_0", to: "5_9" });
  const wall = Array.from({ length: 9 }, (_, y) => `6_${y}`); // gap at y = 9
  add("wall-gap", { bounds: open, blocked: wall, avoid: true, winding: false, from: "2_2", to: "10_3" });
  add("wall-gap-winding", { bounds: open, blocked: wall, avoid: true, winding: true, from: "2_2", to: "10_3" });
  const rand = rng(0x5eed + cases.length);
  const field: string[] = [];
  for (let x = 0; x <= 11; x++) for (let y = 0; y <= 9; y++) if (rand() < 0.3) field.push(`${x}_${y}`);
  add("field", { bounds: open, blocked: field, avoid: true, winding: false, from: "0_5", to: "11_4" });
  add("field-winding", { bounds: open, blocked: field, avoid: true, winding: true, from: "0_5", to: "11_4" });
  add("field-ignored", { bounds: open, blocked: field, avoid: false, winding: false, from: "0_5", to: "11_4" });
  add("strip-hugging", { bounds: B(0, 0, 14, 1), blocked: [], avoid: true, winding: true, from: "0_0", to: "14_1" });
  const centre: string[] = [];
  for (let x = 1; x <= 10; x++) for (let y = 1; y <= 8; y++) centre.push(`${x}_${y}`);
  add("edge-hugging", { bounds: open, blocked: centre, avoid: true, winding: false, from: "0_8", to: "11_1" });
  add("negative-coords", { bounds: B(-6, -5, 5, 4), blocked: ["-1_-1", "-1_0", "0_-1", "0_0"], avoid: true, winding: false, from: "-6_-5", to: "4_3" });
  add("negative-coords-winding", { bounds: B(-6, -5, 5, 4), blocked: [], avoid: true, winding: true, from: "-5_4", to: "5_-5" });
  // 4_4 walled off by all its neighbours.
  const walled = hexNeighbors(4, 4, o, s).map(([x, y]) => `${x}_${y}`);
  add("no-route-fallback", { bounds: open, blocked: walled, avoid: true, winding: false, from: "0_0", to: "4_4" });
  add("off-map-fallback", { bounds: open, blocked: [], avoid: true, winding: false, from: "2_2", to: "15_12" });
  add("same-hex", { bounds: open, blocked: [], avoid: true, winding: true, from: "3_3", to: "3_3" });
}

const routes = cases.map((c) => {
  const r = routeSegment(c.from, c.to, { orientation: c.orientation, stagger: c.stagger, bounds: c.bounds, blocked: new Set(c.blocked), avoid: c.avoid, winding: c.winding });
  return { ...c, expected: r.fallback ? { hexes: r.hexes, fallback: r.fallback } : { hexes: r.hexes } };
});

// hexLine: lines that run exactly along hex edges (the nudge's tie-break).
const lines: { orientation: O; stagger: S; from: string; to: string; expected: string[] }[] = [];
for (const [o, s] of CONFIGS) {
  for (const [from, to] of [["0_0", "2_1"], ["0_0", "4_2"], ["1_1", "1_7"], ["0_0", "6_0"], ["-3_-2", "3_2"], ["5_5", "0_0"]]) {
    lines.push({ orientation: o, stagger: s, from, to, expected: hexLine(from, to, o, s) });
  }
}

const out = { routerVersion: 1, note: "ROUTER v1 golden cases. Never regenerate: a change here is ROUTER v2.", routes, hexLines: lines };
writeFileSync(join(process.cwd(), "tests/fixtures/router-v1.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${routes.length} route cases, ${lines.length} hex lines`);

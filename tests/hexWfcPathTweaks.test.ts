import { describe, it } from "node:test";
import expect from "expect";
import {
  cellKey,
  decodeSetting,
  effectivePathTweaks,
  encodeSetting,
  hexNeighbors,
  learnModel,
  modelToMarkdown,
  parseModelMarkdown,
  pathRouteKey,
  routePaths,
  mulberry32,
  pathsEnabled,
  solve,
  type HexWfcModel,
  type PathTweak,
  type SolveOptions,
} from "../packages/hex-wfc/src";
import { drawnPathType } from "../src/worldgen/generators";
import { wheelValue } from "../src/worldgen/scrub";

/**
 * Per-route path settings on the generator page: on/off, exact count,
 * wiggle, length, follow terrain and "draw as".
 */

/** 30×20 grass map with a bay on the left, a river edge to edge and a tributary into the bay. */
function riverModel(): HexWfcModel {
  const cells = new Map<string, string>();
  for (let x = 0; x < 30; x++) for (let y = 0; y < 20; y++) cells.set(cellKey(x, y), x < 8 && y > 4 && y < 15 ? "Water" : "Grass");
  const main = Array.from({ length: 20 }, (_, y) => cellKey(20, y));
  const trib = Array.from({ length: 14 }, (_, i) => cellKey(20 - i, 10));
  return learnModel(cells, { name: "p", orientation: "flat", paths: [{ type: "River", hexes: main }, { type: "River", hexes: trib }] });
}

const model = riverModel();
const mainRoute = pathRouteKey(model.paths!.find((p) => p.from === "edge")!);
const tribRoute = pathRouteKey(model.paths!.find((p) => p.from === "path")!);
const run = (paths: Record<string, PathTweak>, extra: Partial<SolveOptions> = {}, seed = 1, cols = 30, rows = 20) => {
  const r = solve(model, { cols, rows, orientation: "flat", seed, directionalBias: 1, paths, ...extra });
  if (!r.ok) throw new Error(r.message);
  return r;
};

/** Share of steps along the paths that change direction. */
function turniness(paths: { hexes: string[] }[]): number {
  let turns = 0, steps = 0;
  for (const p of paths) {
    let prev = -1;
    for (let i = 1; i < p.hexes.length; i++) {
      const [x, y] = p.hexes[i - 1].split("_").map(Number);
      const d = hexNeighbors(x, y, "flat").findIndex(([nx, ny]) => cellKey(nx, ny) === p.hexes[i]);
      if (prev >= 0) {
        steps++;
        if (d !== prev) turns++;
      }
      prev = d;
    }
  }
  return steps ? turns / steps : 0;
}

describe("path route keys", () => {
  it("name a route by type and ends", () => {
    expect(mainRoute).toBe("River: edge > edge");
    expect(tribRoute).toBe("River: path > Water");
  });
});

describe("path tweaks", () => {
  it("off leaves a route out and reports it as not wanted", () => {
    const r = run({ [tribRoute]: { off: true } });
    expect(r.paths.every((p) => p.route === mainRoute)).toBe(true);
    expect(r.pathRoutes.find((s) => s.route === tribRoute)).toMatchObject({ wanted: 0, placed: 0 });
    expect(r.warnings.some((w) => w.includes("path"))).toBe(false);
  });

  it("count places exactly that many, and reports the auto count", () => {
    const r = run({ [mainRoute]: { count: 3 }, [tribRoute]: { off: true } }, {}, 2, 60, 40);
    const stat = r.pathRoutes.find((s) => s.route === mainRoute)!;
    expect(stat.wanted).toBe(3);
    expect(stat.placed).toBe(r.paths.length);
    expect(stat.placed).toBeGreaterThanOrEqual(2);
    expect(stat.auto).toBeGreaterThanOrEqual(1);
    expect(run({ [mainRoute]: { count: 0 } }).paths.filter((p) => p.route === mainRoute)).toEqual([]);
  });

  it("wiggle 0 runs straighter than wiggle 3", () => {
    let straight = 0, wiggly = 0;
    for (const seed of [1, 2, 3, 4]) {
      straight += turniness(run({ [mainRoute]: { wiggle: 0 }, [tribRoute]: { off: true } }, {}, seed).paths);
      wiggly += turniness(run({ [mainRoute]: { wiggle: 3 }, [tribRoute]: { off: true } }, {}, seed).paths);
    }
    expect(straight).toBeLessThan(wiggly);
  });

  it("draw-paths off places no paths; unset follows the old features flag", () => {
    expect(run({}, { drawPaths: false }).paths).toEqual([]);
    expect(pathsEnabled(model)).toBe(true);
    expect(pathsEnabled({ ...model, settings: { features: false } })).toBe(false);
    expect(pathsEnabled({ ...model, settings: { features: false, drawPaths: true } })).toBe(true);
  });

  it("draws a route as another path type when asked", () => {
    const m: HexWfcModel = { ...model, settings: { paths: { [mainRoute]: { as: "Trade road" } } } };
    expect(drawnPathType(m, { type: "River", route: mainRoute })).toBe("Trade road");
    expect(drawnPathType(m, { type: "River", route: tribRoute })).toBe("River");
    expect(drawnPathType(undefined, { type: "River" })).toBe("River");
  });
});

describe("path settings in frontmatter", () => {
  it("round-trip through the codec and the generator file", () => {
    const paths: Record<string, PathTweak> = {
      [mainRoute]: { count: 2, wiggle: 1.5, as: "Trade road" },
      [tribRoute]: { off: true, follow: 0 },
    };
    const back = decodeSetting("paths", String(encodeSetting("paths", paths)));
    expect("value" in back ? back.value : back).toEqual(paths);
    const file = parseModelMarkdown(modelToMarkdown({ ...model, settings: { paths, drawPaths: false } }));
    expect(file.warnings).toEqual([]);
    expect(file.model.settings).toMatchObject({ paths, drawPaths: false });
  });

  it("explains a bad option", () => {
    expect(decodeSetting("paths", "River: edge > edge = speed 3")).toHaveProperty("error");
    expect(decodeSetting("paths", "River count 3")).toHaveProperty("error");
  });
});

describe("wheelValue", () => {
  it("scroll up adds a step, down takes one away, within the range", () => {
    expect(wheelValue(3, -100, { min: 0, max: 9 })).toBe(4);
    expect(wheelValue(3, 100, { min: 0, max: 9 })).toBe(2);
    expect(wheelValue(0, 100, { min: 0, max: 9 })).toBe(0);
    expect(wheelValue(9, -100, { min: 0, max: 9 })).toBe(9);
  });
});

describe("path type settings", () => {
  const route = (type: string, to: string, count: number) => ({ type, from: "edge", to, count, turn: 0.2, length: 0.5, through: {} });
  const routes = [route("Road", "town", 3), route("Road", "peak", 1), route("Road", "lake", 2), route("River", "sea", 1)];
  const key = (type: string, to: string) => pathRouteKey({ type, from: "edge", to });

  it("turning a type off turns off its routes only", () => {
    const t = effectivePathTweaks(routes, {}, { Road: { off: true } });
    expect([t[key("Road", "town")].off, t[key("Road", "peak")].off, t[key("River", "sea")].off]).toEqual([true, true, undefined]);
  });

  it("keep turns off the type's least common routes, among those still on", () => {
    const half = effectivePathTweaks(routes, {}, { Road: { keep: 0.5 } });
    // 3 roads: keep round(1.5) = 2, the two most common (town 3, lake 2).
    expect([half[key("Road", "town")].off, half[key("Road", "lake")].off, half[key("Road", "peak")].off]).toEqual([undefined, undefined, true]);
    // With town turned off by hand, keep 0.5 of the remaining two = lake.
    const manual = effectivePathTweaks(routes, { [key("Road", "town")]: { off: true } }, { Road: { keep: 0.5 } });
    expect([manual[key("Road", "lake")].off, manual[key("Road", "peak")].off]).toEqual([undefined, true]);
    // Keeping something always keeps at least one route.
    expect(Object.values(effectivePathTweaks(routes, {}, { Road: { keep: 0.01 } })).filter((t) => !t.off)).toHaveLength(2);
  });

  it("type multipliers multiply each route's own", () => {
    const t = effectivePathTweaks(routes, { [key("Road", "town")]: { wiggle: 2, count: 4 } }, { Road: { wiggle: 0.5, length: 1.5 } });
    expect(t[key("Road", "town")]).toEqual({ wiggle: 1, count: 4, length: 1.5 });
    expect(t[key("Road", "peak")]).toEqual({ wiggle: 0.5, length: 1.5 });
    expect(t[key("River", "sea")]).toEqual({});
  });

  it("round-trip through the file", () => {
    const types = { Road: { keep: 0.5, wiggle: 1.25 }, "Old river": { off: true, follow: 0 } };
    const back = decodeSetting("pathTypes", String(encodeSetting("pathTypes", types)));
    expect(back).toEqual({ value: types });
    expect(decodeSetting("pathTypes", "Road = sometimes")).toHaveProperty("error");
  });
});

describe("paths and impassable terrain", () => {
  // 20x12: land, with a 2-wide lake running top to bottom down the middle
  // except a land bridge on rows 0-1.
  const cols = 20, rows = 12;
  const cells = new Map<string, string>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.set(cellKey(x, y), (x === 9 || x === 10) && y > 1 ? "water" : "grass");
  const grid = { cols, rows, ox: 0, oy: 0, orientation: "flat" as const, stagger: "odd" as const };
  const road = { type: "Road", from: "edge", to: "edge", count: 4, turn: 0.2, length: 1, through: { grass: 1 } };
  const onWater = (paths: { hexes: string[] }[]) => paths.flatMap((p) => p.hexes).filter((h) => cells.get(h) === "water").length;

  it("never cross it by default, going round instead", () => {
    const r = routePaths([road], cells, grid, mulberry32(3), 1, {}, ["water"]);
    expect(r.paths.length).toBeGreaterThan(0);
    expect(onWater(r.paths)).toBe(0);
  });

  it("may cross it when the type allows", () => {
    // A route that likes water: only the guarantee keeps it off.
    const wet = { ...road, through: { water: 1 } };
    expect(onWater(routePaths([wet], cells, grid, mulberry32(3), 1, {}, ["water"]).paths)).toBe(0);
    const tweaks = effectivePathTweaks([wet], {}, { Road: { crossImpassable: true } });
    expect(onWater(routePaths([wet], cells, grid, mulberry32(3), 1, tweaks, ["water"]).paths)).toBeGreaterThan(0);
  });

  it("can still end in it when that terrain is the end (a river into a lake)", () => {
    const river = { type: "River", from: "edge", to: "water", count: 2, turn: 0.2, length: 0.5, through: { grass: 1 } };
    const r = routePaths([river], cells, grid, mulberry32(5), 1, {}, ["water"]);
    expect(r.paths.length).toBeGreaterThan(0);
    for (const p of r.paths) {
      expect(cells.get(p.hexes[p.hexes.length - 1])).toBe("water");
      expect(p.hexes.slice(0, -1).every((h) => cells.get(h) !== "water")).toBe(true);
    }
  });

  it("round-trips the type setting", () => {
    const back = decodeSetting("pathTypes", String(encodeSetting("pathTypes", { River: { crossImpassable: true, keep: 0.5 } })));
    expect(back).toEqual({ value: { River: { crossImpassable: true, keep: 0.5 } } });
  });
});

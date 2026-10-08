import { describe, it } from "node:test";
import expect from "expect";
import {
  cellKey,
  decodeSetting,
  encodeSetting,
  hexNeighbors,
  learnModel,
  modelToMarkdown,
  parseModelMarkdown,
  pathRouteKey,
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

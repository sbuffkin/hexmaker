import { describe, it } from "node:test";
import expect from "expect";
import {
  cellKey,
  decodeSetting,
  encodeSetting,
  learnModel,
  modelToMarkdown,
  mulberry32,
  parseModelMarkdown,
  pathRouteKey,
  resolveSettings,
  routePaths,
  solve,
  type PathFeature,
} from "../packages/hex-wfc/src";

/**
 * G3 (owner 2026-10-16): paths "get out of hand pretty fast, especially on
 * maps generated from ones that have roads/rivers". One overall Paths amount
 * (`paths-amount`, ×0–×2) scales every route's auto count together; a
 * route's own exact count is kept; old files read as ×1.
 */

const cols = 40, rows = 30;
const cells = new Map<string, string>();
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.set(cellKey(x, y), "grass");
const grid = { cols, rows, ox: 0, oy: 0, orientation: "flat" as const, stagger: "odd" as const };
const route = (type: string, count: number): PathFeature => ({ type, from: "edge", to: "none", count, turn: 0.2, length: 0.3, through: { grass: 1 } });
/** A busy example: ten path types with one route each, plus a road it had six of. */
const busy: PathFeature[] = [...Array.from({ length: 10 }, (_, i) => route(`Type ${i}`, 1)), route("Road", 6)];
const placed = (amount: number, tweaks = {}) => routePaths(busy, cells, grid, mulberry32(7), 1, tweaks, [], amount);

describe("G3: overall paths amount", () => {
  it("×1 is what it was (the default)", () => {
    const before = routePaths(busy, cells, grid, mulberry32(7), 1, {}, []);
    expect(placed(1).paths).toEqual(before.paths);
    expect(resolveSettings({ name: "x", terrains: [], adjacency: [], meta: {} }).pathsAmount).toBe(1);
  });

  it("×0.5 roughly halves the paths, even across single routes", () => {
    const full = placed(1).routes.reduce((n, r) => n + r.wanted, 0);
    const half = placed(0.5);
    const wanted = half.routes.reduce((n, r) => n + r.wanted, 0);
    expect(full).toBe(16);
    expect(wanted).toBe(8);
    expect(half.paths.length).toBeGreaterThanOrEqual(6);
    expect(half.paths.length).toBeLessThanOrEqual(9);
    // Spread over the single routes, not all kept at their minimum of one.
    expect(half.routes.filter((r) => r.route.startsWith("Type") && r.wanted === 0).length).toBeGreaterThan(2);
  });

  it("×2 doubles, ×0 places none", () => {
    expect(placed(2).routes.reduce((n, r) => n + r.wanted, 0)).toBe(32);
    const none = placed(0);
    expect(none.paths).toEqual([]);
    expect(none.routes.every((r) => r.wanted === 0)).toBe(true);
    expect(none.warnings).toEqual([]);
  });

  it("a route's own count is kept", () => {
    const road = pathRouteKey(busy[10]);
    const r = placed(0, { [road]: { count: 2 } });
    expect(r.routes.find((s) => s.route === road)?.wanted).toBe(2);
    expect(r.routes.filter((s) => s.route !== road).every((s) => s.wanted === 0)).toBe(true);
  });

  it("solve() applies it to a learned generator's paths", () => {
    const ex = new Map<string, string>();
    for (let x = 0; x < 30; x++) for (let y = 0; y < 20; y++) ex.set(cellKey(x, y), "Grass");
    const lines = Array.from({ length: 6 }, (_, i) => ({ type: "Road", hexes: Array.from({ length: 20 }, (_, y) => cellKey(3 + i * 5, y)) }));
    const model = learnModel(ex, { name: "roads", orientation: "flat", paths: lines });
    const count = (pathsAmount?: number) => {
      const r = solve({ ...model, settings: { ...(model.settings ?? {}), pathsAmount } }, { cols: 30, rows: 20, orientation: "flat", seed: 3 });
      if (!r.ok) throw new Error(r.message);
      return r.pathRoutes.reduce((n, s) => n + s.wanted, 0);
    };
    const base = count(undefined);
    expect(base).toBeGreaterThanOrEqual(4);
    expect(count(1)).toBe(base);
    expect(count(0)).toBe(0);
    expect(count(0.5)).toBe(Math.round(base / 2));
  });
});

describe("G3: paths amount in the generator file", () => {
  const model = learnModel(new Map([[cellKey(0, 0), "Grass"], [cellKey(1, 0), "Grass"]]), { name: "g", orientation: "flat" });

  it("round-trips as paths-amount", () => {
    expect(encodeSetting("pathsAmount", 0.5)).toBe(0.5);
    expect(decodeSetting("pathsAmount", "0.5")).toEqual({ value: 0.5 });
    const text = modelToMarkdown({ ...model, settings: { pathsAmount: 0.5 } });
    expect(text).toMatch(/^paths-amount: 0\.5$/m);
    const back = parseModelMarkdown(text);
    expect(back.warnings).toEqual([]);
    expect(back.model.settings?.pathsAmount).toBe(0.5);
    expect(back.model.meta).not.toHaveProperty("paths-amount");
  });

  it("an old file without it reads as ×1 and writes no key", () => {
    const text = modelToMarkdown(model);
    expect(text).not.toMatch(/paths-amount/);
    const back = parseModelMarkdown(text);
    expect(back.model.settings?.pathsAmount).toBeUndefined();
    expect(resolveSettings(back.model).pathsAmount).toBe(1);
  });
});

describe("G3: the Paths amount control", () => {
  it("is a ×0–×2 multiplier that saves undefined at ×1", async () => {
    const { fakeRoot } = await import("./helpers/fakeDom");
    const { renderPathsAmount } = await import("../src/modules/gen-page/sections/pathsSection");
    const { root, el } = fakeRoot();
    const saved: (number | undefined)[] = [];
    renderPathsAmount(el, 0.5, (v) => saved.push(v));
    const range = root.inputs("range")[0];
    expect([range.attrs.min, range.attrs.max, range.value]).toEqual(["0", "2", "0.5"]);
    expect(root.all((e) => e.text === "Paths amount").length).toBe(1);
    range.value = "0";
    range.fire("change");
    range.value = "1";
    range.fire("change");
    expect(saved).toEqual([0, undefined]);
  });
});

import { describe, it } from "node:test";
import expect from "expect";
import { learnModel, mergeModels, type HexWfcModel } from "../packages/hex-wfc/src";

/** Combining generators learned from several regions (packages/hex-wfc/src/merge.ts). */

/** A cols×rows block filled by `pick(x, y)`, offset by dx. */
function block(cols: number, rows: number, pick: (x: number, y: number) => string, dx = 0): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells[`${x + dx}_${y}`] = pick(x, y);
  return cells;
}
const coast = (_x: number, y: number) => (y < 3 ? "land" : "sea");
const hills = (x: number) => (x < 4 ? "hills" : "land");
const learn = (cells: Record<string, string>, name = "t") => learnModel(cells, { name, orientation: "flat" });
const weights = (m: HexWfcModel) => Object.fromEntries(m.terrains.map((t) => [t.name, t.weight]));
const pairs = (m: HexWfcModel) => Object.fromEntries(m.adjacency.map((e) => [[e.a, e.b].sort().join("|"), e.weight]));

describe("merging generators", () => {
  it("adds up terrain and neighbour counts, as one example with the regions far apart", () => {
    const a = block(8, 6, coast), b = block(8, 6, hills);
    const merged = mergeModels([learn(a), learn(b)], "both");
    const together = learn({ ...a, ...block(8, 6, hills, 100) });
    expect(weights(merged)).toEqual(weights(together));
    expect(pairs(merged)).toEqual(pairs(together));
    expect(merged.exampleHexes).toBe(96);
    expect(merged.name).toBe("both");
  });

  it("keeps relative measures when a region is merged with itself", () => {
    const m = learn(block(10, 8, coast));
    const twice = mergeModels([m, m], "twice");
    for (const t of m.terrains) {
      const u = twice.terrains.find((x) => x.name === t.name)!;
      expect(u.weight).toBe(t.weight * 2);
      expect(u.patch).toBeCloseTo(t.patch ?? NaN);
      expect(u.shape).toBe(t.shape);
      u.layout?.forEach((v, i) => expect(v).toBeCloseTo(t.layout![i]));
    }
  });

  it("weights a shared terrain's measures by how much of it each region had", () => {
    const one: HexWfcModel = { name: "a", meta: {}, adjacency: [], terrains: [{ name: "x", weight: 30, patch: 0.1, shape: "blob" }] };
    const two: HexWfcModel = { name: "b", meta: {}, adjacency: [], terrains: [{ name: "x", weight: 10, patch: 0.5, shape: "line" }] };
    const x = mergeModels([one, two], "ab").terrains[0];
    expect(x.weight).toBe(40);
    expect(x.patch).toBeCloseTo(0.2);
    expect(x.shape).toBe("blob");
  });

  it("adds up path routes and features by route", () => {
    const path = { type: "Road", from: "edge", to: "town", count: 2, turn: 0.2, length: 0.5, through: { land: 1 } };
    const one: HexWfcModel = { name: "a", meta: {}, adjacency: [], terrains: [], paths: [path], features: [{ terrain: "river", from: "edge", to: "sea", count: 1 }] };
    const two: HexWfcModel = {
      name: "b", meta: {}, adjacency: [], terrains: [],
      paths: [{ ...path, count: 1, turn: 0.5, through: { hills: 1 } }, { ...path, to: "none", count: 1 }],
      features: [{ terrain: "river", from: "edge", to: "sea", count: 2 }],
    };
    const m = mergeModels([one, two], "ab", { palette: "Default" });
    const road = m.paths!.find((p) => p.to === "town")!;
    expect(road.count).toBe(3);
    expect(road.turn).toBeCloseTo(0.3);
    expect(road.through.land).toBeCloseTo(2 / 3);
    expect(road.through.hills).toBeCloseTo(1 / 3);
    expect(m.paths).toHaveLength(2);
    expect(m.features).toEqual([{ terrain: "river", from: "edge", to: "sea", count: 3 }]);
    expect(m.meta).toEqual({ palette: "Default" });
  });
});

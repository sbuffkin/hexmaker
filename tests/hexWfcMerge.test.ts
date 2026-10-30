import { describe, it } from "node:test";
import expect from "expect";
import { learnModel, mergeModels, solve, type HexWfcModel } from "../packages/hex-wfc/src";

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

describe("generators with 32 or more terrains", () => {
  // The 32nd terrain uses the top bit of a 32-bit word. A signed/unsigned
  // mismatch there made propagation loop until memory ran out (Obsidian froze
  // on a combined generator with 33 terrains).
  for (const count of [32, 33, 64]) {
    it(`solve with ${count} terrains`, () => {
      const cells: Record<string, string> = {};
      for (let x = 0; x < count * 2; x++) for (let y = 0; y < 6; y++) cells[`${x}_${y}`] = `t${Math.floor(x / 2)}`;
      const model = learn(cells);
      expect(model.terrains).toHaveLength(count);
      const r = solve(model, { cols: 16, rows: 12, orientation: "flat", seed: 7 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.cells.size).toBe(16 * 12);
    });
  }
});

describe("merging with region influence", () => {
  const big = learn(block(20, 10, coast));            // 200 hexes: land and sea
  const small = learn(block(5, 4, (x) => (x < 2 ? "hills" : "land")), "s"); // 20 hexes
  const share = (m: HexWfcModel, name: string) => {
    const total = m.terrains.reduce((n, t) => n + t.weight, 0);
    return (m.terrains.find((t) => t.name === name)?.weight ?? 0) / total;
  };

  it("counts each region by its size when no influence is given", () => {
    expect(share(mergeModels([big, small], "m"), "hills")).toBeCloseTo(8 / 220);
  });

  it("gives each region its share of the influence, whatever its size", () => {
    const even = mergeModels([big, small], "m", {}, [50, 50]);
    // Half of what's learned comes from the small region, where hills are 8 of 20 hexes.
    expect(share(even, "hills")).toBeCloseTo(0.5 * (8 / 20));
    expect(even.exampleHexes).toBe(220);
  });

  it("leaves out a region with no influence", () => {
    const m = mergeModels([big, small], "m", {}, [100, 0]);
    expect(m.terrains.map((t) => t.name).sort()).toEqual(["land", "sea"]);
  });
});

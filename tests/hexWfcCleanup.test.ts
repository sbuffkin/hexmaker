import { describe, it } from "node:test";
import expect from "expect";
import {
  cellKey,
  cleanupStrengths,
  hexNeighbors,
  removeSpecks,
  resolveSettings,
  smoothEdges,
  untouchableTerrains,
  type HexWfcModel,
} from "../packages/hex-wfc/src";

/**
 * The clean-up passes that replaced the single "smoothing" knob: edge
 * smoothing, small-patch removal, and keeping rare terrain.
 */

const grid = { cols: 12, rows: 12, ox: 0, oy: 0, orientation: "flat" as const, stagger: "odd" as const };
const names = ["Grass", "Forest", "Water", "Gem"];
// Every pair may touch, so only the passes' own rules decide what changes.
const model: HexWfcModel = {
  name: "t",
  meta: {},
  terrains: [
    { name: "Grass", weight: 80 },
    { name: "Forest", weight: 10 },
    { name: "Water", weight: 9 },
    { name: "Gem", weight: 1 },
  ],
  adjacency: names.flatMap((a) => names.map((b) => ({ a, b, weight: 1 }))),
};
const rng = () => 0.5;
const neighbours = (k: string) => {
  const [x, y] = k.split("_").map(Number);
  return hexNeighbors(x, y, "flat", "odd").map(([nx, ny]) => cellKey(nx, ny));
};

/** All grass, with a 7-hex water blob around 3_3, a 2-hex forest, a lone forest and a lone gem. */
function sample(): Map<string, string> {
  const cells = new Map<string, string>();
  for (let x = 0; x < grid.cols; x++) for (let y = 0; y < grid.rows; y++) cells.set(cellKey(x, y), "Grass");
  for (const k of [cellKey(3, 3), ...neighbours(cellKey(3, 3))]) cells.set(k, "Water");
  cells.set(cellKey(8, 2), "Forest");
  cells.set(cellKey(8, 3), "Forest");
  cells.set(cellKey(8, 8), "Forest");
  cells.set(cellKey(3, 9), "Gem");
  return cells;
}

const count = (cells: Map<string, string>, t: string) => [...cells.values()].filter((v) => v === t).length;

describe("removeSpecks", () => {
  it("fills patches up to the size and keeps bigger ones", () => {
    const cells = sample();
    removeSpecks(cells, model, grid, 2, new Set(), new Set());
    expect(count(cells, "Forest")).toBe(0);
    expect(count(cells, "Gem")).toBe(0);
    expect(count(cells, "Water")).toBe(7);
  });

  it("size 1 only clears lone hexes", () => {
    const cells = sample();
    removeSpecks(cells, model, grid, 1, new Set(), new Set());
    expect(count(cells, "Forest")).toBe(2);
    expect(count(cells, "Gem")).toBe(0);
  });

  it("leaves kept terrains and protected hexes", () => {
    const cells = sample();
    removeSpecks(cells, model, grid, 3, new Set([cellKey(8, 8)]), new Set(["Gem"]));
    expect(cells.get(cellKey(3, 9))).toBe("Gem");
    expect(cells.get(cellKey(8, 8))).toBe("Forest");
    expect(cells.get(cellKey(8, 2))).toBe("Grass");
  });
});

describe("smoothEdges", () => {
  it("trims a one-hex bump but leaves lone hexes to removeSpecks", () => {
    const cells = sample();
    const blob = new Set([cellKey(3, 3), ...neighbours(cellKey(3, 3))]);
    // A grass hex touching exactly one blob hex becomes a one-hex bump.
    const bump = [...cells.keys()].find(
      (k) => !blob.has(k) && neighbours(k).filter((n) => blob.has(n)).length === 1 && neighbours(k).length === 6,
    )!;
    cells.set(bump, "Water");
    smoothEdges(cells, model, grid, 0.4, new Set(), new Set(), rng);
    expect(cells.get(bump)).toBe("Grass");
    expect(count(cells, "Water")).toBe(7);
    expect(cells.get(cellKey(8, 8))).toBe("Forest");
    expect(cells.get(cellKey(3, 9))).toBe("Gem");
  });
});

describe("untouchableTerrains", () => {
  it("keeps terrains under the rare share, plus scatter and line shapes", () => {
    expect([...untouchableTerrains(model, 0)]).toEqual([]);
    expect([...untouchableTerrains(model, 0.05)]).toEqual(["Gem"]);
    expect([...untouchableTerrains(model, 0.095)].sort()).toEqual(["Gem", "Water"]);
    const shaped: HexWfcModel = { ...model, terrains: model.terrains.map((t) => (t.name === "Forest" ? { ...t, shape: "line" } : t)) };
    expect([...untouchableTerrains(shaped, 0)]).toEqual(["Forest"]);
  });
});

describe("cleanupStrengths", () => {
  const at = (settings: HexWfcModel["settings"]) => cleanupStrengths(resolveSettings({ ...model, settings }));
  it("maps the legacy smoothing knob", () => {
    expect(at({})).toEqual({ edges: 0, speckSize: 0 });
    expect(at({ smoothing: 0.3 })).toEqual({ edges: 0, speckSize: 1 });
    expect(at({ smoothing: 0.7 })).toEqual({ edges: 0.7, speckSize: 1 });
  });
  it("uses the split settings once any is set", () => {
    expect(at({ smoothing: 0.7, edgeSmoothing: 0.4 })).toEqual({ edges: 0.4, speckSize: 0 });
    expect(at({ speckSize: 3 })).toEqual({ edges: 0, speckSize: 3 });
  });
});

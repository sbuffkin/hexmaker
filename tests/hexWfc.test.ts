import { describe, it } from "node:test";
import expect from "expect";
import {
  hexNeighbors,
  cellKey,
  learnModel,
  solve,
  findViolation,
  validateModel,
  restrictModel,
  modelToMarkdown,
  parseModelMarkdown,
  isModelMarkdown,
  type HexWfcModel,
} from "../packages/hex-wfc/src";
import { hexNeighbors as pluginHexNeighbors } from "../src/hex-map/hexGeometry";

/** Paint a cols×rows example: a round lake in grassland with a forest band. */
function exampleMap(cols = 20, rows = 16): Map<string, string> {
  const cells = new Map<string, string>();
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const dx = x - 6, dy = y - 7;
      let t = "Grass";
      if (dx * dx + dy * dy < 12) t = "Water";
      else if (dx * dx + dy * dy < 22) t = "Sand";
      else if (x >= 14) t = "Forest";
      cells.set(cellKey(x, y), t);
    }
  }
  return cells;
}

const lakes = () => learnModel(exampleMap(), { name: "lakes", orientation: "flat", meta: { palette: "Default" } });

describe("hex-wfc grid", () => {
  it("matches the plugin's neighbour function for every orientation and stagger", () => {
    for (const o of ["flat", "pointy"] as const)
      for (const s of ["odd", "even"] as const)
        for (let x = -3; x < 4; x++)
          for (let y = -3; y < 4; y++)
            expect(hexNeighbors(x, y, o, s)).toEqual(pluginHexNeighbors(x, y, o, s));
  });
});

describe("learnModel", () => {
  it("counts terrains and touching pairs, leaving out pairs that never touch", () => {
    const m = lakes();
    expect(m.name).toBe("lakes");
    expect(m.meta.palette).toBe("Default");
    const names = m.terrains.map((t) => t.name).sort();
    expect(names).toEqual(["Forest", "Grass", "Sand", "Water"]);
    expect(m.terrains.reduce((s, t) => s + t.weight, 0)).toBe(20 * 16);
    const pair = (a: string, b: string) =>
      m.adjacency.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    expect(pair("Water", "Water")?.weight).toBeGreaterThan(0);
    expect(pair("Water", "Sand")?.weight).toBeGreaterThan(0);
    expect(pair("Water", "Grass")).toBeUndefined(); // sand ring always separates them
    expect(pair("Water", "Forest")).toBeUndefined();
    expect(validateModel(m)).toEqual([]);
  });

  it("counts each edge once", () => {
    // Two hexes side by side: exactly one edge.
    const m = learnModel({ "0_0": "A", "0_1": "B" }, { name: "t", orientation: "flat" });
    expect(m.adjacency).toEqual([{ a: "A", b: "B", weight: 1 }]);
    const n = learnModel({ "0_0": "A", "0_1": "A" }, { name: "t", orientation: "flat" });
    expect(n.adjacency).toEqual([{ a: "A", b: "A", weight: 1 }]);
  });

  it("ignores unpainted hexes", () => {
    const m = learnModel({ "0_0": "A", "5_5": "B" }, { name: "t", orientation: "pointy" });
    expect(m.adjacency).toEqual([]);
    expect(validateModel(m).length).toBeGreaterThan(0); // neither can touch anything
  });
});

describe("solve", () => {
  for (const orientation of ["flat", "pointy"] as const) {
    for (const stagger of ["odd", "even"] as const) {
      it(`never breaks a learned rule (${orientation}/${stagger})`, () => {
        const model = learnModel(exampleMap(), { name: "lakes", orientation, stagger });
        const r = solve(model, { cols: 25, rows: 20, orientation, stagger, seed: 7 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.cells.size).toBe(25 * 20);
        expect(findViolation(model, r.cells, orientation, stagger)).toBeNull();
      });
    }
  }

  it("is deterministic per seed", () => {
    const model = lakes();
    const a = solve(model, { cols: 20, rows: 15, orientation: "flat", seed: 123 });
    const b = solve(model, { cols: 20, rows: 15, orientation: "flat", seed: 123 });
    const c = solve(model, { cols: 20, rows: 15, orientation: "flat", seed: 124 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect([...a.cells]).toEqual([...b.cells]);
    expect([...a.cells]).not.toEqual([...c.cells]);
  });

  it("respects the offset (absolute coordinates)", () => {
    const r = solve(lakes(), { cols: 4, rows: 3, offset: { x: 10, y: -2 }, orientation: "flat", seed: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.has("10_-2")).toBe(true);
    expect(r.cells.has("13_0")).toBe(true);
    expect(r.cells.has("0_0")).toBe(false);
  });

  it("keeps fixed hexes and fills around them", () => {
    const fixed = { "5_5": "Water", "15_5": "Forest" };
    const model = lakes();
    const r = solve(model, { cols: 20, rows: 12, orientation: "flat", seed: 3, fixed });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.get("5_5")).toBe("Water");
    expect(r.cells.get("15_5")).toBe("Forest");
    expect(findViolation(model, r.cells, "flat")).toBeNull();
  });

  it("reports fixed hexes that break the rules", () => {
    const r = solve(lakes(), {
      cols: 5, rows: 5, orientation: "flat", seed: 1,
      fixed: { "2_2": "Water", "2_3": "Forest" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("fixed-conflict");
  });

  it("rejects fixed hexes with terrains the model doesn't know", () => {
    const r = solve(lakes(), { cols: 3, rows: 3, orientation: "flat", seed: 1, fixed: { "1_1": "Lava" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-input");
  });

  it("reports an impossible model cleanly", () => {
    // A only next to B, B only next to A: a hex triangle can't be 2-coloured.
    const model: HexWfcModel = {
      name: "impossible", meta: {},
      terrains: [{ name: "A", weight: 1 }, { name: "B", weight: 1 }],
      adjacency: [{ a: "A", b: "B", weight: 1 }],
    };
    const r = solve(model, { cols: 4, rows: 4, orientation: "flat", seed: 1, maxRestarts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["contradiction", "fixed-conflict"]).toContain(r.reason);
  });

  it("neighbour weights make terrain clump", () => {
    // Fraction of edges joining two different terrains: lower = clumpier.
    const model = lakes();
    const mixed = (cells: Map<string, string>) => {
      let diff = 0, total = 0;
      for (const [k, t] of cells) {
        const [x, y] = k.split("_").map(Number);
        for (const [nx, ny] of hexNeighbors(x, y, "flat")) {
          const u = cells.get(cellKey(nx, ny));
          if (u === undefined) continue;
          total++;
          if (u !== t) diff++;
        }
      }
      return diff / total;
    };
    const weighted = solve(model, { cols: 30, rows: 30, orientation: "flat", seed: 9 });
    const flat = solve(model, { cols: 30, rows: 30, orientation: "flat", seed: 9, neighbourInfluence: 0 });
    expect(weighted.ok && flat.ok).toBe(true);
    if (!weighted.ok || !flat.ok) return;
    expect(mixed(weighted.cells)).toBeLessThan(mixed(flat.cells));
  });

  it("solves a 60×60 map quickly", () => {
    const r = solve(lakes(), { cols: 60, rows: 60, orientation: "flat", seed: 11 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.ms).toBeLessThan(5000);
  });
});

describe("model helpers", () => {
  it("restrictModel drops terrains missing from a palette", () => {
    const m = restrictModel(lakes(), ["Grass", "Forest", "Sand"]);
    expect(m.terrains.map((t) => t.name).sort()).toEqual(["Forest", "Grass", "Sand"]);
    expect(m.adjacency.every((e) => e.a !== "Water" && e.b !== "Water")).toBe(true);
  });

  it("validateModel flags unknown terrains and bad weights", () => {
    const problems = validateModel({
      name: "x", meta: {},
      terrains: [{ name: "A", weight: 1 }, { name: "A", weight: -1 }],
      adjacency: [{ a: "A", b: "Z", weight: 1 }],
    });
    expect(problems.some((p) => p.includes("twice"))).toBe(true);
    expect(problems.some((p) => p.includes('unknown terrain "Z"'))).toBe(true);
    expect(problems.some((p) => p.includes("invalid weight"))).toBe(true);
  });
});

describe("markdown format", () => {
  it("round-trips a learned model", () => {
    const m = lakes();
    const text = modelToMarkdown(m);
    expect(isModelMarkdown(text)).toBe(true);
    const { model, warnings } = parseModelMarkdown(text);
    expect(warnings).toEqual([]);
    expect(model).toEqual(m);
  });

  it("round-trips awkward names and metadata", () => {
    const m: HexWfcModel = {
      name: "Isles: north #2", meta: { palette: "My palette", "source-map": "a|b" },
      terrains: [{ name: "Deep | Sea", weight: 2.5 }, { name: "Peak\\s", weight: 0 }],
      adjacency: [{ a: "Deep | Sea", b: "Peak\\s", weight: 1 }],
    };
    expect(parseModelMarkdown(modelToMarkdown(m)).model).toEqual(m);
  });

  it("accepts hand edits: reordered pairs, blank weights, extra prose", () => {
    const text = [
      "---", "hex-wfc: 1", "palette: Default", "---",
      "# My generator", "", "Some notes I wrote.", "",
      "## Terrains", "", "| Terrain | Weight |", "|---|---|", "| Grass | |", "| Water | 3 |", "",
      "Prose between tables.", "",
      "## Adjacency", "", "| Terrain | Next to | Weight |", "| --- | --- | --- |",
      "| Water | Grass | 2 |", "| Grass | Water | 1 |", "| Grass | Grass | 5 |", "| Water | Water | nope |",
    ].join("\n");
    const { model, warnings } = parseModelMarkdown(text);
    expect(model.name).toBe("My generator");
    expect(model.meta).toEqual({ palette: "Default" });
    expect(model.terrains).toEqual([{ name: "Grass", weight: 1 }, { name: "Water", weight: 3 }]);
    expect(model.adjacency).toHaveLength(3);
    expect(warnings).toHaveLength(1); // the "nope" row
    const r = solve(model, { cols: 8, rows: 8, orientation: "pointy", seed: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Water–Water was dropped, so water hexes never touch each other.
      expect(findViolation(model, r.cells, "pointy")).toBeNull();
    }
  });

  it("refuses files that aren't generators", () => {
    expect(isModelMarkdown("---\nterrain: Grass\n---\n# Hex")).toBe(false);
    expect(() => parseModelMarkdown("# Hello")).toThrow();
  });
});

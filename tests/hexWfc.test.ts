import { describe, it } from "node:test";
import expect from "expect";
import {
  hexNeighbors,
  hexCenter,
  hexDistance,
  directionRing,
  countPatches,
  encodeSetting,
  decodeSetting,
  type SolveOptions,
  type GeneratorSettings,
  measurePatches,
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

/** 50×50 example: two lakes ringed by sand, a 2-wide ridge, two forests, grass. */
function worldExample(): Map<string, string> {
  const ex = new Map<string, string>();
  const lakes = [[12, 14, 4], [36, 34, 3.5]];
  const forests = [[38, 10, 5], [10, 38, 4]];
  for (let x = 0; x < 50; x++)
    for (let y = 0; y < 50; y++) {
      let t = "Grass";
      for (const [fx, fy, r] of forests) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) t = "Forest";
      if (x > 18 && x < 46 && Math.abs(y - (0.6 * x + 8 + 3 * Math.sin(x / 5))) < 1.1) t = "Ridge";
      for (const [lx, ly, r] of lakes) {
        const d = Math.hypot(x - lx, y - ly);
        if (d < r) t = "Water";
        else if (d < r + 1.3) t = "Sand";
      }
      ex.set(cellKey(x, y), t);
    }
  return ex;
}

const shareOf = (cells: Map<string, string>) => {
  const out: Record<string, number> = {};
  for (const t of cells.values()) out[t] = (out[t] ?? 0) + 1 / cells.size;
  return out;
};

describe("growth: shape learning", () => {
  it("classifies blobs, lines, shores and the background by shape alone", () => {
    const shapes = measurePatches(worldExample(), "flat");
    expect(shapes.get("Water")?.shape).toBe("blob");
    expect(shapes.get("Forest")?.shape).toBe("blob");
    expect(shapes.get("Ridge")?.shape).toBe("line");
    expect(shapes.get("Ridge")?.turn).toBeGreaterThan(0);
    expect(shapes.get("Sand")?.shape).toBe("none"); // thin ring: left to the neighbour rules
    expect(shapes.get("Grass")?.shape).toBe("none"); // background
  });

  it("stores patch size as a share of the map, not a hex count", () => {
    // The same picture at two resolutions gives about the same patch share.
    const disc = (n: number) => {
      const m = new Map<string, string>();
      for (let x = 0; x < n; x++)
        for (let y = 0; y < n; y++)
          m.set(cellKey(x, y), Math.hypot(x - n / 2, y - n / 2) < n / 6 ? "Lake" : "Grass");
      return m;
    };
    const small = measurePatches(disc(24), "flat").get("Lake")!;
    const big = measurePatches(disc(60), "flat").get("Lake")!;
    expect(small.shape).toBe("blob");
    expect(big.shape).toBe("blob");
    expect(Math.abs(small.patch - big.patch)).toBeLessThan(0.02);
  });

  it("classifies single scattered hexes as scatter (no growth)", () => {
    const m = new Map<string, string>();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) m.set(cellKey(x, y), (x * 7 + y * 3) % 11 === 0 ? "Rock" : "Grass");
    expect(measurePatches(m, "pointy").get("Rock")?.shape).toBe("scatter");
  });

  it("directionRing walks the neighbours clockwise in 60° steps", () => {
    for (const o of ["flat", "pointy"] as const)
      for (const s of ["odd", "even"] as const)
        for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) {
          const [cx, cy] = hexCenter(x, y, o, s);
          const ns = hexNeighbors(x, y, o, s);
          const angles = directionRing(o).map((i) => {
            const [nx, ny] = hexCenter(ns[i][0], ns[i][1], o, s);
            expect(Math.hypot(nx - cx, ny - cy)).toBeCloseTo(Math.sqrt(3), 5); // really a neighbour
            return Math.atan2(ny - cy, nx - cx);
          });
          for (let k = 0; k < 6; k++) {
            let step = angles[(k + 1) % 6] - angles[k];
            while (step <= -Math.PI) step += 2 * Math.PI;
            while (step > Math.PI) step -= 2 * Math.PI;
            expect(step).toBeCloseTo(Math.PI / 3, 5); // clockwise on screen (y down)
          }
        }
  });
});

describe("growth: solving", () => {
  const model = learnModel(worldExample(), { name: "world", orientation: "flat" });

  it("keeps every learned rule while growing", () => {
    for (const seed of [1, 2, 3]) {
      const r = solve(model, { cols: 40, rows: 30, orientation: "flat", seed });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.stats.grown).toBeGreaterThan(0);
      expect(findViolation(model, r.cells, "flat")).toBeNull();
    }
  });

  it("produces about the example's terrain mix at different map sizes", () => {
    const target = shareOf(worldExample());
    for (const [cols, rows] of [[20, 20], [50, 50]]) {
      const avg: Record<string, number> = {};
      const seeds = [11, 12, 13, 14, 15];
      for (const seed of seeds) {
        const r = solve(model, { cols, rows, orientation: "flat", seed });
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        for (const [t, v] of Object.entries(shareOf(r.cells))) avg[t] = (avg[t] ?? 0) + v / seeds.length;
      }
      for (const t of Object.keys(target)) {
        // Within 5 percentage points of the example for every terrain.
        expect(Math.abs((avg[t] ?? 0) - target[t])).toBeLessThan(0.05);
      }
    }
  });

  it("featureSize 0 turns growth off", () => {
    const r = solve(model, { cols: 20, rows: 20, orientation: "flat", seed: 4, featureSize: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.grown).toBe(0);
  });

  it("is still deterministic with growth", () => {
    const a = solve(model, { cols: 25, rows: 25, orientation: "pointy", seed: 99 });
    const b = solve(model, { cols: 25, rows: 25, orientation: "pointy", seed: 99 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect([...a.cells]).toEqual([...b.cells]);
  });

  it("round-trips growth columns and tolerates bad ones", () => {
    const text = modelToMarkdown(model);
    expect(text).toContain("| Terrain | Weight | Patch % | Shape | Turn |");
    expect(parseModelMarkdown(text).model).toEqual(model);
    const edited = text.replace(/\| blob \|/, "| splodge |");
    const { warnings } = parseModelMarkdown(edited);
    expect(warnings.some((w) => w.includes('shape "splodge"'))).toBe(true);
  });
});

/** 40×40 example: ocean along the bottom, a forest top-left, towns only in the top half. */
function coastExample(): Map<string, string> {
  const ex = new Map<string, string>();
  for (let x = 0; x < 40; x++)
    for (let y = 0; y < 40; y++) {
      const coast = 30 + 2 * Math.sin(x / 4);
      let t = y > coast ? "Ocean" : y > coast - 1.5 ? "Sand" : "Grass";
      if (t === "Grass" && Math.hypot(x - 8, y - 8) < 6) t = "Forest";
      if (t === "Grass" && y < 20 && x > 16 && (x * 7 + y * 13) % 29 === 0) t = "Town";
      ex.set(cellKey(x, y), t);
    }
  return ex;
}

/** Share of a terrain in the top and bottom thirds of a generated map. */
function thirds(cells: Map<string, string>, rows: number, terrain: string): [number, number] {
  let top = 0, bottom = 0, nTop = 0, nBottom = 0;
  for (const [k, t] of cells) {
    const y = Number(k.split("_")[1]);
    if (y < rows / 3) { nTop++; if (t === terrain) top++; }
    else if (y >= (2 * rows) / 3) { nBottom++; if (t === terrain) bottom++; }
  }
  return [top / nTop, bottom / nBottom];
}

describe("directional bias, randomness and saved settings", () => {
  const model = learnModel(coastExample(), { name: "coast", orientation: "flat" });

  it("learns where each terrain sat", () => {
    const ocean = model.terrains.find((t) => t.name === "Ocean")!.layout!;
    expect(ocean).toHaveLength(9);
    expect(ocean[7]).toBeGreaterThan(2); // S: much more ocean than average
    expect(ocean[1]).toBeLessThan(0.2); // N: almost none
  });

  it("bias 1 keeps the ocean along the bottom; bias 0 doesn't care", () => {
    let biasedTop = 0, biasedBottom = 0, freeTop = 0, freeBottom = 0;
    for (const seed of [1, 2, 3, 4]) {
      const b = solve(model, { cols: 30, rows: 24, orientation: "flat", seed, directionalBias: 1 });
      const f = solve(model, { cols: 30, rows: 24, orientation: "flat", seed, directionalBias: 0 });
      expect(b.ok && f.ok).toBe(true);
      if (!b.ok || !f.ok) return;
      const [bt, bb] = thirds(b.cells, 24, "Ocean");
      const [ft, fb] = thirds(f.cells, 24, "Ocean");
      biasedTop += bt; biasedBottom += bb; freeTop += ft; freeBottom += fb;
      expect(findViolation(model, b.cells, "flat")).toBeNull();
    }
    expect(biasedBottom).toBeGreaterThan(biasedTop * 5);
    // Without bias, the ocean has no particular preference for the bottom.
    expect(freeBottom / (freeTop + freeBottom + 1e-9)).toBeLessThan(0.85);
  });

  it("randomness peppers rare terrain where the example never had it", () => {
    const townsInBottomHalf = (randomness: number) => {
      let n = 0;
      for (const seed of [5, 6, 7, 8]) {
        const r = solve(model, { cols: 30, rows: 30, orientation: "flat", seed, directionalBias: 1, randomness });
        if (!r.ok) continue;
        for (const [k, t] of r.cells) if (t === "Town" && Number(k.split("_")[1]) >= 15) n++;
      }
      return n;
    };
    expect(townsInBottomHalf(0.6)).toBeGreaterThan(townsInBottomHalf(0));
  });

  it("uses settings saved with the model, and options override them", () => {
    const saved = { ...model, settings: { featureSize: 0 } };
    const fromModel = solve(saved, { cols: 20, rows: 20, orientation: "flat", seed: 3 });
    const overridden = solve(saved, { cols: 20, rows: 20, orientation: "flat", seed: 3, featureSize: 1 });
    expect(fromModel.ok && overridden.ok).toBe(true);
    if (fromModel.ok && overridden.ok) {
      expect(fromModel.stats.grown).toBe(0);
      expect(overridden.stats.grown).toBeGreaterThan(0);
    }
  });

  it("round-trips settings (frontmatter) and layout (table)", () => {
    const m = { ...model, settings: { featureSize: 1.5, directionalBias: 0.75, randomness: 0.2 } };
    const text = modelToMarkdown(m);
    expect(text).toContain("feature-size: 1.5");
    expect(text).toContain("directional-bias: 0.75");
    expect(text).toContain("| Terrain | NW | N | NE | W | C | E | SW | S | SE |");
    const back = parseModelMarkdown(text);
    expect(back.warnings).toEqual([]);
    expect(back.model).toEqual(m);
    expect(back.model.meta["feature-size"]).toBeUndefined(); // settings aren't duplicated into meta
  });

  it("warns about bad settings and layout rows instead of failing", () => {
    const text = modelToMarkdown({ ...model, settings: { scatter: 2 } })
      .replace("scatter: 2", "scatter: lots")
      .replace(/\| Ocean \|[^\n]*\n/g, (row) => (row.includes("NW") ? row : "| Ocean | 1 | 2 |\n"));
    const { model: back, warnings } = parseModelMarkdown(text);
    expect(warnings.some((w) => w.includes('"scatter: lots"'))).toBe(true);
    expect(warnings.some((w) => w.startsWith("Layout row"))).toBe(true);
    expect(back.settings).toBeUndefined();
  });
});

/** 40×40 example: a 1-wide river walked along hex neighbours from the top edge into a lake. */
function riverExample(): Map<string, string> {
  const m = new Map<string, string>();
  for (let x = 0; x < 40; x++)
    for (let y = 0; y < 40; y++) {
      const d = Math.hypot(x - 26, y - 28);
      m.set(cellKey(x, y), d < 4.5 ? "Water" : d < 5.8 ? "Sand" : "Grass");
    }
  let cur: [number, number] = [8, 0];
  for (let step = 0; step < 80; step++) {
    m.set(cellKey(cur[0], cur[1]), "River");
    const ns = hexNeighbors(cur[0], cur[1], "flat", "odd");
    if (ns.some(([x, y]) => m.get(cellKey(x, y)) === "Water")) break;
    const goal = [26 + Math.sin(step / 3) * 6, 28];
    ns.sort((a, b) => Math.hypot(a[0] - goal[0], a[1] - goal[1]) - Math.hypot(b[0] - goal[0], b[1] - goal[1]));
    cur = ns.find(([x, y]) => m.get(cellKey(x, y)) !== "River" && x >= 0 && y >= 0)!;
  }
  return m;
}

/** World example plus towns dotted on the grass. */
function townsExample(): Map<string, string> {
  const m = worldExample();
  for (const [k, t] of m) {
    const [x, y] = k.split("_").map(Number);
    if (t === "Grass" && (x * 7 + y * 13) % 53 === 0) m.set(k, "Town");
  }
  return m;
}

const gridOf = (cols: number, rows: number) => ({ cols, rows, ox: 0, oy: 0, orientation: "flat" as const, stagger: "odd" as const });

describe("hex distance", () => {
  it("is 1 for every neighbour and symmetric", () => {
    for (const o of ["flat", "pointy"] as const)
      for (const s of ["odd", "even"] as const)
        for (const [x, y] of [[0, 0], [3, 4], [-2, 5], [7, -3]]) {
          for (const n of hexNeighbors(x, y, o, s)) expect(hexDistance([x, y], n, o, s)).toBe(1);
          expect(hexDistance([x, y], [x + 4, y + 1], o, s)).toBe(hexDistance([x + 4, y + 1], [x, y], o, s));
        }
  });
});

describe("learning: lines, boundaries, features, spacing", () => {
  it("learns a river from the map edge into a lake as a guaranteed feature", () => {
    const m = learnModel(riverExample(), { name: "river", orientation: "flat" });
    expect(m.terrains.find((t) => t.name === "River")?.shape).toBe("line");
    expect(m.features).toEqual([{ terrain: "River", from: "edge", to: "Water", count: 1 }]);
    expect(m.exampleHexes).toBe(1600);
  });

  it("treats a shore between two terrains as a boundary, not a line or feature", () => {
    const m = learnModel(coastExample(), { name: "coast", orientation: "flat" });
    expect(m.terrains.find((t) => t.name === "Sand")?.shape).toBe("none");
    expect(m.terrains.find((t) => t.name === "Ocean")?.shape).toBe("blob"); // thick band, not a line
    expect(m.features ?? []).toEqual([]);
  });

  it("learns how far apart scattered towns are", () => {
    const m = learnModel(townsExample(), { name: "towns", orientation: "flat" });
    const town = m.terrains.find((t) => t.name === "Town")!;
    expect(town.shape).toBe("scatter");
    expect(town.spacing).toBeGreaterThanOrEqual(2);
  });
});

describe("controls", () => {
  const world = learnModel(townsExample(), { name: "world", orientation: "flat" });
  const solveWorld = (extra: Partial<SolveOptions> = {}, seed = 4, cols = 36, rows = 24) =>
    solve(world, { cols, rows, orientation: "flat", seed, ...extra });

  it("never breaks a learned rule, whatever the settings", () => {
    const settings: Partial<SolveOptions>[] = [
      { smoothing: 1 },
      { symmetry: "both" },
      { edgeTerrain: "Water", edgeStrength: 1 },
      { edgeStrength: 1 },
      { counts: { Town: { min: 4, max: 4 }, Water: { min: 2 } } },
      { connected: true, impassable: ["Water", "Ridge"] },
      { lineWidth: 3, featureSize: 2 },
      { spacing: 2, randomness: 0.5 },
      { mix: { Forest: 3, Water: 0.2 }, directionalBias: 1 },
    ];
    for (const extra of settings) {
      const r = solveWorld(extra);
      expect(r.ok).toBe(true);
      if (r.ok) expect(findViolation(world, r.cells, "flat")).toBeNull();
    }
  });

  it("guarantees the river: a connected line from the map edge to water", () => {
    const m = learnModel(riverExample(), { name: "river", orientation: "flat" });
    for (const seed of [1, 2, 3]) {
      const r = solve(m, { cols: 30, rows: 20, orientation: "flat", seed });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(findViolation(m, r.cells, "flat")).toBeNull();
      const river = [...r.cells].filter(([, t]) => t === "River").map(([k]) => k);
      expect(river.length).toBeGreaterThan(5);
      expect(countPatches(new Map(river.map((k) => [k, "River"])), gridOf(30, 20)).get("River")).toBe(1);
      const onEdge = river.some((k) => {
        const [x, y] = k.split("_").map(Number);
        return x === 0 || y === 0 || x === 29 || y === 19;
      });
      const touchesWater = river.some((k) => {
        const [x, y] = k.split("_").map(Number);
        return hexNeighbors(x, y, "flat").some(([nx, ny]) => r.cells.get(cellKey(nx, ny)) === "Water");
      });
      expect(onEdge && touchesWater).toBe(true);
    }
    const off = solve(m, { cols: 30, rows: 20, orientation: "flat", seed: 1, features: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.featureCells.size).toBe(0);
  });

  it("edge terrain makes an island: the whole border is that terrain", () => {
    const r = solveWorld({ edgeTerrain: "Water", edgeStrength: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [k, t] of r.cells) {
      const [x, y] = k.split("_").map(Number);
      if (x === 0 || y === 0 || x === 35 || y === 23) expect(t).toBe("Water");
    }
    expect([...r.cells.values()].filter((t) => t === "Grass").length).toBeGreaterThan(100);
  });

  it("symmetry mirrors the map where the rules allow", () => {
    const r = solveWorld({ symmetry: "left-right" }, 6, 31, 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let same = 0;
    for (const [k, t] of r.cells) {
      const [x, y] = k.split("_").map(Number);
      if (r.cells.get(cellKey(30 - x, y)) === t) same++;
    }
    expect(same / r.cells.size).toBeGreaterThan(0.9);
  });

  it("smoothing leaves fewer lone specks", () => {
    const specks = (cells: Map<string, string>) => {
      let n = 0;
      for (const [k, t] of cells) {
        if (t === "Town") continue;
        const [x, y] = k.split("_").map(Number);
        if (!hexNeighbors(x, y, "flat").some(([nx, ny]) => cells.get(cellKey(nx, ny)) === t)) n++;
      }
      return n;
    };
    let rough = 0, smooth = 0;
    for (const seed of [1, 2, 3]) {
      const a = solveWorld({ smoothing: 0, randomness: 0.4 }, seed);
      const b = solveWorld({ smoothing: 1, randomness: 0.4 }, seed);
      if (a.ok && b.ok) {
        rough += specks(a.cells);
        smooth += specks(b.cells);
      }
    }
    expect(smooth).toBeLessThan(rough);
  });

  it("counts: exact number of towns, at least two lakes", () => {
    for (const seed of [1, 2]) {
      const r = solveWorld({ counts: { Town: { min: 4, max: 4 }, Water: { min: 2 } } }, seed);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const pc = countPatches(r.cells, gridOf(36, 24));
      expect(pc.get("Town")).toBe(4);
      expect(pc.get("Water")).toBeGreaterThanOrEqual(2);
      expect(r.warnings).toEqual([]);
    }
  });

  it("spacing keeps towns apart", () => {
    const towns = (cells: Map<string, string>) =>
      [...cells].filter(([, t]) => t === "Town").map(([k]) => k.split("_").map(Number) as [number, number]);
    const r = solveWorld({ spacing: 2, randomness: 0 }, 3, 40, 40);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ts = towns(r.cells);
    let min = Infinity;
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) min = Math.min(min, hexDistance(ts[i], ts[j], "flat"));
    expect(min).toBeGreaterThanOrEqual(3);
  });

  it("connected land fills cut-off pockets with impassable terrain", () => {
    // Grass and Rock both touch everything; Rock is impassable.
    const model: HexWfcModel = {
      name: "rocks", meta: {},
      terrains: [{ name: "Grass", weight: 1 }, { name: "Rock", weight: 1 }],
      adjacency: [
        { a: "Grass", b: "Grass", weight: 1 },
        { a: "Grass", b: "Rock", weight: 1 },
        { a: "Rock", b: "Rock", weight: 1 },
      ],
    };
    const base = { cols: 20, rows: 20, orientation: "flat" as const, seed: 2, neighbourInfluence: 0 };
    const free = solve(model, base);
    const tied = solve(model, { ...base, connected: true, impassable: ["Rock"] });
    expect(free.ok && tied.ok).toBe(true);
    if (!free.ok || !tied.ok) return;
    const landGroups = (cells: Map<string, string>) =>
      countPatches(new Map([...cells].filter(([, t]) => t === "Grass")), gridOf(20, 20)).get("Grass") ?? 0;
    expect(landGroups(free.cells)).toBeGreaterThan(1);
    expect(landGroups(tied.cells)).toBe(1);
  });

  it("per-terrain mix shifts the terrain share", () => {
    const forest = (extra: Partial<SolveOptions>) => {
      let f = 0;
      for (const seed of [1, 2, 3]) {
        const r = solveWorld(extra, seed);
        if (r.ok) f += [...r.cells.values()].filter((t) => t === "Forest").length;
      }
      return f;
    };
    expect(forest({ mix: { Forest: 3 } })).toBeGreaterThan(forest({}) * 1.5);
  });

  it("line width makes ridges thicker", () => {
    const thickness = (lineWidth: number) => {
      let same = 0, n = 0;
      for (const seed of [1, 2, 3]) {
        const r = solveWorld({ lineWidth }, seed, 40, 30);
        if (!r.ok) continue;
        for (const [k, t] of r.cells) {
          if (t !== "Ridge") continue;
          const [x, y] = k.split("_").map(Number);
          n++;
          same += hexNeighbors(x, y, "flat").filter(([nx, ny]) => r.cells.get(cellKey(nx, ny)) === "Ridge").length;
        }
      }
      return same / n;
    };
    expect(thickness(3)).toBeGreaterThan(thickness(1));
  });
});

describe("setting codec", () => {
  it("round-trips every kind of setting through frontmatter text", () => {
    const cases: [keyof GeneratorSettings, unknown][] = [
      ["featureSize", 1.25],
      ["connected", true],
      ["symmetry", "top-bottom"],
      ["edgeTerrain", "Deep Sea"],
      ["impassable", ["Water", "High peaks, north"]],
      ["mix", { Forest: 1.5, "Deep Sea": 0.5 }],
      ["counts", { Town: { min: 3, max: 3 }, Lake: { min: 1 }, Ruin: { min: 0, max: 2 }, Fort: { max: 1 } }],
    ];
    for (const [field, value] of cases) {
      const back = decodeSetting(field, String(encodeSetting(field, value)));
      expect("value" in back ? back.value : back).toEqual(value);
    }
  });

  it("explains malformed values", () => {
    expect(decodeSetting("counts", "Town lots")).toHaveProperty("error");
    expect(decodeSetting("symmetry", "sideways")).toHaveProperty("error");
    expect(decodeSetting("mix", "Forest")).toHaveProperty("error");
  });

  it("round-trips a model with features and settings", () => {
    const m = learnModel(riverExample(), { name: "river", orientation: "flat" });
    m.settings = {
      featureSize: 1.5, symmetry: "left-right", connected: true, impassable: ["Water"],
      mix: { Grass: 0.8 }, counts: { Water: { min: 1 } }, edgeTerrain: "Water", edgeStrength: 0.5, features: false,
    };
    const back = parseModelMarkdown(modelToMarkdown(m));
    expect(back.warnings).toEqual([]);
    expect(back.model).toEqual(m);
  });
});

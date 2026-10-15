import { describe, it } from "node:test";
import expect from "expect";
import {
  cellKey,
  compassLayout,
  decodeSetting,
  encodeSetting,
  hexDistance,
  hexNeighbors,
  layoutTo5,
  layoutValue,
  learnModel,
  measureNear,
  mergeModels,
  modelToMarkdown,
  mulberry32,
  parseCellKey,
  parseModelMarkdown,
  restrictModel,
  routePaths,
  solve,
  type HexWfcModel,
} from "../packages/hex-wfc/src";

/** Near rules, 5×5 layouts, growth along layouts, side anchors, border-shy paths. */

const flat = { orientation: "flat" as const, stagger: "odd" as const };

/** Hex distance by breadth-first search over the solved map. */
function withinOf(cells: Map<string, string>, anchor: string, distance: number): Set<string> {
  const seen = new Set<string>();
  let frontier = [...cells].filter(([, t]) => t === anchor).map(([k]) => k);
  frontier.forEach((k) => seen.add(k));
  for (let d = 0; d < distance; d++) {
    const next: string[] = [];
    for (const k of frontier) {
      const [x, y] = parseCellKey(k)!;
      for (const [nx, ny] of hexNeighbors(x, y, "flat", "odd")) {
        const n = cellKey(nx, ny);
        if (cells.has(n) && !seen.has(n)) { seen.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return seen;
}

describe("layout grids", () => {
  const three = [1, 2, 3, 1, 2, 3, 1, 2, 3]; // rises west to east

  it("take each cell's value at its centre and blend between centres", () => {
    expect(layoutValue(three, 1 / 6, 0.5)).toBeCloseTo(1);
    expect(layoutValue(three, 0.5, 0.5)).toBeCloseTo(2);
    expect(layoutValue(three, 1 / 3, 0.5)).toBeCloseTo(1.5);
    expect(layoutValue(three, 0, 0)).toBeCloseTo(1); // clamped past the outer centres
  });

  it("work on a 5×5 grid, and a 3×3 one scales up to the same values", () => {
    const five = Array.from({ length: 25 }, (_, i) => (i % 5) + 1);
    expect(layoutValue(five, 0.9, 0.5)).toBeCloseTo(5);
    expect(layoutValue(five, 0.5, 0.5)).toBeCloseTo(3);
    const up = layoutTo5(three);
    expect(up).toHaveLength(25);
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) expect(layoutValue(up, f, 0.5)).toBeCloseTo(layoutValue(three, f, 0.5), 1);
  });
});

describe("format", () => {
  const model: HexWfcModel = {
    name: "m",
    meta: {},
    terrains: [
      { name: "ash", weight: 80, layout: Array.from({ length: 25 }, (_, i) => 1 + (i % 5) / 4) },
      { name: "lava", weight: 15, near: { terrain: "volcano", distance: 3 } },
      { name: "volcano", weight: 5, shape: "scatter", spacing: 6 },
    ],
    adjacency: [{ a: "ash", b: "ash", weight: 5 }],
  };

  it("round-trips the Near column and a 5×5 layout", () => {
    const back = parseModelMarkdown(modelToMarkdown(model));
    if (!("model" in back)) throw new Error("parse failed");
    expect(back.warnings).toEqual([]);
    expect(back.model.terrains.find((t) => t.name === "lava")?.near).toEqual({ terrain: "volcano", distance: 3 });
    expect(back.model.terrains[0].layout).toHaveLength(25);
    expect(back.model.terrains[0].layout![4]).toBeCloseTo(2);
  });

  it("writes 3×3 rows as 5×5 when another terrain has a 5×5 layout", () => {
    const mixed = { ...model, terrains: [...model.terrains, { name: "rock", weight: 1, layout: [1, 1, 1, 1, 3, 1, 1, 1, 1] }] };
    const back = parseModelMarkdown(modelToMarkdown(mixed));
    if (!("model" in back)) throw new Error("parse failed");
    expect(back.model.terrains.find((t) => t.name === "rock")?.layout).toHaveLength(25);
  });

  it("round-trips the near setting, including turning a rule off", () => {
    const value = { lava: { terrain: "volcano dormant", distance: 2 }, ash: null };
    expect(decodeSetting("near", String(encodeSetting("near", value)))).toEqual({ value });
    expect(decodeSetting("near", "lava = volcano")).toHaveProperty("error");
  });
});

describe("near rules", () => {
  // Lava may sit anywhere ash may; only the near rule keeps it by volcanoes.
  const model: HexWfcModel = {
    name: "lava",
    meta: {},
    terrains: [
      { name: "ash", weight: 70 },
      { name: "lava", weight: 25, near: { terrain: "volcano", distance: 2 } },
      { name: "volcano", weight: 5, shape: "scatter", spacing: 8 },
    ],
    adjacency: [
      { a: "ash", b: "ash", weight: 5 },
      { a: "ash", b: "lava", weight: 3 },
      { a: "lava", b: "lava", weight: 4 },
      { a: "lava", b: "volcano", weight: 3 },
      { a: "ash", b: "volcano", weight: 1 },
    ],
  };

  it("leave no hex of the terrain out of reach of its anchor, on every seed", () => {
    let lavaSeen = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = solve(model, { cols: 24, rows: 16, ...flat, seed });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const ok = withinOf(r.cells, "volcano", 2);
      const lava = [...r.cells].filter(([, t]) => t === "lava").map(([k]) => k);
      lavaSeen += lava.length;
      expect(lava.filter((k) => !ok.has(k))).toEqual([]);
    }
    expect(lavaSeen).toBeGreaterThan(0);
  });

  it("can be turned off from the settings", () => {
    const off = { ...model, settings: { near: { lava: null } } };
    let far = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const r = solve(off, { cols: 24, rows: 16, ...flat, seed });
      if (!r.ok) continue;
      const ok = withinOf(r.cells, "volcano", 2);
      far += [...r.cells].filter(([k, t]) => t === "lava" && !ok.has(k)).length;
    }
    expect(far).toBeGreaterThan(0);
  });
});

describe("growth follows the layout", () => {
  // Forest grows in big blobs; its layout wants the west and not the east.
  const model = (bias: number): HexWfcModel => ({
    name: "w",
    meta: {},
    settings: { directionalBias: bias },
    terrains: [
      { name: "grass", weight: 60 },
      { name: "forest", weight: 40, shape: "blob", patch: 0.08, layout: [3, 1, 0.05, 3, 1, 0.05, 3, 1, 0.05] },
    ],
    adjacency: [
      { a: "grass", b: "grass", weight: 5 },
      { a: "grass", b: "forest", weight: 2 },
      { a: "forest", b: "forest", weight: 5 },
    ],
  });
  const eastShare = (bias: number) => {
    let east = 0, all = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = solve(model(bias), { cols: 30, rows: 20, ...flat, seed });
      if (!r.ok) continue;
      for (const [k, t] of r.cells) {
        if (t !== "forest") continue;
        all++;
        if (parseCellKey(k)![0] >= 20) east++;
      }
    }
    return east / Math.max(1, all);
  };

  it("keeps patches out of the third the layout rules out", () => {
    expect(eastShare(2)).toBeLessThan(0.08);
    expect(eastShare(2)).toBeLessThan(eastShare(0));
  });
});

describe("paths: sides and the border", () => {
  const cols = 24, rows = 14;
  const cells = new Map<string, string>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.set(cellKey(x, y), "grass");
  const grid = { cols, rows, ox: 0, oy: 0, ...flat };
  const borderHexes = (hexes: string[]) =>
    hexes.slice(1, -1).filter((h) => { const [x, y] = parseCellKey(h)!; return x === 0 || y === 0 || x === cols - 1 || y === rows - 1; }).length;

  it("start and end on the named sides", () => {
    const river = { type: "River", from: "edge-W", to: "edge-E", count: 3, turn: 0.3, length: 1, through: { grass: 1 } };
    for (let seed = 1; seed <= 5; seed++) {
      const r = routePaths([river], cells, grid, mulberry32(seed), 1, {}, []);
      expect(r.paths.length).toBeGreaterThan(0);
      for (const p of r.paths) {
        expect(parseCellKey(p.hexes[0])![0]).toBe(0);
        expect(parseCellKey(p.hexes[p.hexes.length - 1])![0]).toBe(cols - 1);
      }
    }
  });

  it("survive fitting the model to a palette", () => {
    const m: HexWfcModel = {
      name: "p",
      meta: {},
      terrains: [{ name: "grass", weight: 1 }],
      adjacency: [{ a: "grass", b: "grass", weight: 1 }],
      paths: [{ type: "River", from: "edge-W", to: "edge-E", count: 1, turn: 0.3, length: 1, through: { grass: 1 } }],
    };
    expect(restrictModel(m, ["grass"]).paths).toHaveLength(1);
  });

  it("keep off the border between their ends, unless allowed to cross", () => {
    const road = { type: "Road", from: "edge-N", to: "edge-S", count: 3, turn: 0.4, length: 1, through: { grass: 1 } };
    let shy = 0, free = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const p of routePaths([road], cells, grid, mulberry32(seed), 1, {}, []).paths) shy += borderHexes(p.hexes);
      for (const p of routePaths([road], cells, grid, mulberry32(seed), 1, { "Road: edge-N > edge-S": { crossImpassable: true } }, []).paths)
        free += borderHexes(p.hexes);
    }
    expect(shy).toBeLessThanOrEqual(free);
    expect(shy).toBeLessThan(4);
  });
});

describe("learning from an example", () => {
  // Grass everywhere, a few volcanoes, lava only right around them.
  const example = new Map<string, string>();
  const volcanoes = [[5, 5], [20, 12], [32, 4]];
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 40; x++) {
      const d = Math.min(...volcanoes.map(([vx, vy]) => hexDistance([x, y], [vx, vy], "flat", "odd")));
      example.set(cellKey(x, y), d === 0 ? "volcano" : d <= 2 ? "lava" : "grass");
    }

  it("finds near rules: lava only ever sits by a volcano", () => {
    const rules = measureNear(example, "flat", "odd");
    expect(rules.get("lava")).toEqual({ terrain: "volcano", distance: 2 });
    expect(rules.has("grass")).toBe(false); // grass is everywhere
  });

  it("puts them in the learned model, with a 5×5 layout on a big example", () => {
    const m = learnModel(example, { name: "v", orientation: "flat" });
    expect(m.terrains.find((t) => t.name === "lava")?.near).toEqual({ terrain: "volcano", distance: 2 });
    expect(m.terrains[0].layout).toHaveLength(25);
    const small = learnModel(new Map([...example].filter(([k]) => parseCellKey(k)![0] < 12)), { name: "s", orientation: "flat" });
    expect(small.terrains[0].layout).toHaveLength(9);
  });
});

describe("blending generators toward compass points", () => {
  const biome = (name: string, own: string): HexWfcModel => ({
    name,
    meta: {},
    exampleHexes: 100,
    terrains: [{ name: "grass", weight: 50 }, { name: own, weight: 50, shape: "blob", patch: 0.05, near: { terrain: "grass", distance: 3 } }],
    adjacency: [{ a: "grass", b: "grass", weight: 5 }, { a: "grass", b: own, weight: 2 }, { a: own, b: own, weight: 5 }],
  });
  const valley = biome("valley", "marsh"), forest = biome("forest", "forest heavy");

  it("compass layouts average 1 and lean the right way", () => {
    const east = compassLayout("E");
    expect(east.reduce((a, b) => a + b, 0) / 25).toBeCloseTo(1, 1);
    expect(east[4]).toBeGreaterThan(east[0] * 5); // R1C5 vs R1C1
    expect(compassLayout("C").every((v) => v === 1)).toBe(true);
  });

  it("puts each source's own terrain on its side, and keeps near rules", () => {
    const m = mergeModels([valley, forest], "v-to-f", {}, [50, 50], ["W", "E"]);
    expect(m.settings?.directionalBias).toBeGreaterThanOrEqual(1);
    expect(m.terrains.find((t) => t.name === "marsh")?.near).toEqual({ terrain: "grass", distance: 3 });
    let marshWest = 0, marshAll = 0, forestEast = 0, forestAll = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const r = solve(m, { cols: 30, rows: 18, ...flat, seed });
      if (!r.ok) continue;
      for (const [k, t] of r.cells) {
        const x = parseCellKey(k)![0];
        if (t === "marsh") { marshAll++; if (x < 15) marshWest++; }
        if (t === "forest heavy") { forestAll++; if (x >= 15) forestEast++; }
      }
    }
    expect(marshWest / Math.max(1, marshAll)).toBeGreaterThan(0.75);
    expect(forestEast / Math.max(1, forestAll)).toBeGreaterThan(0.75);
  });
});

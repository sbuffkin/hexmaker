import { describe, it } from "node:test";
import expect from "expect";
import {
  solveHexWfc,
  findViolation,
  learnRulesFromSample,
  mulberry32,
  type WfcInput,
  type AdjacencyRules,
} from "../src/worldgen/wfc";

// A user-style palette with deliberately non-default names: the solver must
// not care what the terrains are called.
const TERRAINS = ["Deep Sea", "Shallows", "Grass", "Woods", "Hills", "Peaks", "Dunes"];

// "Deny list" deck — everything may touch except these pairs.
const RULES: AdjacencyRules = {
  default: "allow",
  pairs: [
    ["Deep Sea", "Grass"], ["Deep Sea", "Woods"], ["Deep Sea", "Hills"],
    ["Deep Sea", "Peaks"], ["Deep Sea", "Dunes"],
    ["Shallows", "Peaks"], ["Shallows", "Hills"],
    ["Peaks", "Grass"], ["Peaks", "Dunes"],
    ["Dunes", "Woods"],
  ],
};

const WEIGHTS = { "Deep Sea": 4, Shallows: 2, Grass: 4, Woods: 3, Hills: 2, Peaks: 1, Dunes: 1 };

function base(overrides: Partial<WfcInput> = {}): WfcInput {
  return {
    cols: 20, rows: 15, orientation: "flat",
    terrains: TERRAINS, rules: RULES, weights: WEIGHTS, seed: 1234,
    ...overrides,
  };
}

describe("solveHexWfc — adjacency", () => {
  for (const orientation of ["flat", "pointy"] as const) {
    for (const stagger of ["odd", "even"] as const) {
      it(`respects every rule (${orientation}/${stagger})`, () => {
        const res = solveHexWfc(base({ orientation, stagger }));
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.cells.size).toBe(20 * 15);
        expect(findViolation(res.cells, { orientation, stagger, terrains: TERRAINS, rules: RULES })).toBeNull();
      });
    }
  }

  it("honours an allow-list ('deny' default) deck", () => {
    // Banded deck: each terrain may only touch itself and the next band.
    const bands = ["A", "B", "C", "D"];
    const rules: AdjacencyRules = {
      default: "deny",
      pairs: [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["A", "B"], ["B", "C"], ["C", "D"]],
    };
    const res = solveHexWfc({ cols: 25, rows: 25, orientation: "pointy", terrains: bands, rules, seed: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(findViolation(res.cells, { orientation: "pointy", terrains: bands, rules })).toBeNull();
  });

  it("uses absolute coords (gridOffset) for stagger parity", () => {
    const offset = { x: -3, y: 5 };
    const res = solveHexWfc(base({ offset }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cells.has("-3_5")).toBe(true);
    expect(res.cells.has("16_19")).toBe(true);
    expect(res.cells.has("0_0")).toBe(false);
    expect(findViolation(res.cells, { orientation: "flat", terrains: TERRAINS, rules: RULES })).toBeNull();
  });

  it("treats an empty deck as 'everything allowed'", () => {
    const res = solveHexWfc(base({ rules: { default: "allow", pairs: [] } }));
    expect(res.ok).toBe(true);
  });

  it("never picks a weight-0 terrain for unpainted hexes", () => {
    const res = solveHexWfc(base({ weights: { ...WEIGHTS, Dunes: 0 } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.cells.values()]).not.toContain("Dunes");
  });
});

describe("solveHexWfc — fixed cells", () => {
  it("preserves pre-painted hexes and fills around them consistently", () => {
    const fixed = { "3_3": "Deep Sea", "4_3": "Deep Sea", "10_7": "Peaks", "15_2": "Dunes", "0_0": "Woods" };
    const res = solveHexWfc(base({ fixed }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const [k, t] of Object.entries(fixed)) expect(res.cells.get(k)).toBe(t);
    expect(findViolation(res.cells, { orientation: "flat", terrains: TERRAINS, rules: RULES })).toBeNull();
  });

  it("keeps fixed weight-0 terrains", () => {
    const res = solveHexWfc(base({ weights: { ...WEIGHTS, Peaks: 0 }, fixed: { "5_5": "Peaks" } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cells.get("5_5")).toBe("Peaks");
  });

  it("ignores fixed hexes outside the grid", () => {
    const res = solveHexWfc(base({ fixed: { "999_999": "Peaks" } }));
    expect(res.ok).toBe(true);
  });

  it("reports adjacent painted hexes that break the rules as fixed-conflict", () => {
    // (2,2) and (2,3) are vertical neighbours in any orientation/stagger.
    const res = solveHexWfc(base({ fixed: { "2_2": "Deep Sea", "2_3": "Peaks" } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("fixed-conflict");
    expect(res.at).toBeDefined();
  });

  it("reports unknown terrain names in fixed hexes as invalid-input", () => {
    const res = solveHexWfc(base({ fixed: { "1_1": "Lava" } }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid-input");
    expect(res.message).toContain("Lava");
  });
});

describe("solveHexWfc — determinism", () => {
  it("same seed ⇒ identical map", () => {
    const a = solveHexWfc(base({ seed: 42 }));
    const b = solveHexWfc(base({ seed: 42 }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([...a.cells.entries()]).toEqual([...b.cells.entries()]);
  });

  it("different seeds ⇒ different maps", () => {
    const a = solveHexWfc(base({ seed: 1 }));
    const b = solveHexWfc(base({ seed: 2 }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([...a.cells.entries()]).not.toEqual([...b.cells.entries()]);
  });

  it("mulberry32 is deterministic and in [0,1)", () => {
    const r1 = mulberry32(99), r2 = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe("solveHexWfc — contradictions", () => {
  it("reports an unsatisfiable deck cleanly instead of throwing or looping", () => {
    // Two terrains that may only touch each other: a 2-colouring, impossible
    // on a hex grid because neighbouring hexes form triangles.
    const res = solveHexWfc({
      cols: 6, rows: 6, orientation: "flat",
      terrains: ["X", "Y"], rules: { default: "deny", pairs: [["X", "Y"]] },
      seed: 3, maxBacktracks: 50, maxRestarts: 2,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(["contradiction", "fixed-conflict"]).toContain(res.reason);
    expect(res.message.length).toBeGreaterThan(0);
  });

  it("reports contradiction (not fixed-conflict) when only search fails", () => {
    // Initial propagation can't see the triangle problem (every cell still
    // has X and Y), so this exercises backtracking + restarts to exhaustion.
    const res = solveHexWfc({
      cols: 6, rows: 6, orientation: "pointy",
      terrains: ["X", "Y"], rules: { default: "deny", pairs: [["X", "Y"]] },
      seed: 5, maxBacktracks: 20, maxRestarts: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("contradiction");
    expect(res.stats.attempts).toBe(2);
  });

  it("rejects empty input", () => {
    expect(solveHexWfc(base({ terrains: [] })).ok).toBe(false);
    expect(solveHexWfc(base({ cols: 0 })).ok).toBe(false);
  });
});

describe("learnRulesFromSample", () => {
  it("derives a deck that the sample itself satisfies, and regenerates from it", () => {
    const sample = solveHexWfc(base({ cols: 12, rows: 12, seed: 11 }));
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    const { rules, weights } = learnRulesFromSample(sample.cells, "flat");
    expect(findViolation(sample.cells, { orientation: "flat", terrains: TERRAINS, rules })).toBeNull();
    const regen = solveHexWfc(base({ rules, weights, seed: 12 }));
    expect(regen.ok).toBe(true);
    if (!regen.ok) return;
    expect(findViolation(regen.cells, { orientation: "flat", terrains: TERRAINS, rules })).toBeNull();
  });
});

describe("solveHexWfc — performance", () => {
  it("solves a 60×60 map (3600 hexes) quickly", () => {
    const t0 = Date.now();
    const res = solveHexWfc(base({ cols: 60, rows: 60, seed: 2026 }));
    const ms = Date.now() - t0;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cells.size).toBe(3600);
    expect(findViolation(res.cells, { orientation: "flat", terrains: TERRAINS, rules: RULES })).toBeNull();
    console.log(`[wfc] 60x60: ${ms} ms, decisions=${res.stats.decisions}, backtracks=${res.stats.backtracks}, attempts=${res.stats.attempts}`);
    // Generous bound so CI noise doesn't flake; real number is logged above.
    expect(ms).toBeLessThan(5000);
  });
});

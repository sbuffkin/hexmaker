import { describe, it } from "node:test";
import expect from "expect";
import { formatAnchor, formatAnchors, parseAnchors } from "../src/paths/anchorText";

const ok = (cell: string) => {
  const r = parseAnchors(cell);
  if ("error" in r) throw new Error(`expected anchors from ${JSON.stringify(cell)}, got error: ${r.error}`);
  return r.anchors;
};
const err = (cell: string) => {
  const r = parseAnchors(cell);
  if (!("error" in r)) throw new Error(`expected an error from ${JSON.stringify(cell)}, got ${JSON.stringify(r.anchors)}`);
  return r.error;
};

describe("formatAnchors", () => {
  it("writes the canonical x, y → x, y form", () => {
    expect(formatAnchors(["0_8", "9_8", "13_8"])).toBe("0, 8 → 9, 8 → 13, 8");
    expect(formatAnchors(["-1_-4"])).toBe("-1, -4");
    expect(formatAnchors([])).toBe("");
    expect(formatAnchor("3_4")).toBe("3, 4");
  });

  it("round-trips through parseAnchors", () => {
    const cases = [["0_0"], ["3_4", "4_4"], ["-1_-4", "0_-3", "12_7", "-20_15"], ["5_5", "5_5"]];
    for (const anchors of cases) expect(ok(formatAnchors(anchors))).toEqual(anchors);
  });
});

describe("parseAnchors: every accepted spelling", () => {
  const want = ["3_4", "9_4"];
  const spellings = [
    "3, 4 → 9, 4",
    "3,4→9,4",
    "3,4 -> 9,4",
    "3, 4 > 9, 4",
    "3, 4; 9, 4",
    "3_4 → 9_4",
    "(3, 4) → (9, 4)",
    "(3,4)->(9,4)",
    "3 4 → 9 4",
    "3, 4  9, 4",
    "3,4 9,4",
    "3_4 9_4",
    "(3, 4) (9, 4)",
    "  3, 4 → 9, 4  ",
    "3, 4 → 9, 4 →", // trailing separator
    "3, 4 →→ 9, 4", // doubled separator
    "03, 4 → 9, 04", // leading zeros
  ];
  for (const s of spellings) {
    it(JSON.stringify(s), () => expect(ok(s)).toEqual(want));
  }

  it("negative coordinates, with every separator", () => {
    expect(ok("-1, -4 → 2, -3")).toEqual(["-1_-4", "2_-3"]);
    expect(ok("-1,-4->-2,-3")).toEqual(["-1_-4", "-2_-3"]);
    expect(ok("-1,-4>-2,-3")).toEqual(["-1_-4", "-2_-3"]);
    expect(ok("-1_-4; -2_-3")).toEqual(["-1_-4", "-2_-3"]);
    expect(ok("(-1, -4) (-2, -3)")).toEqual(["-1_-4", "-2_-3"]);
    expect(ok("-0, 0")).toEqual(["0_0"]);
  });

  it("one anchor", () => {
    expect(ok("3, 4")).toEqual(["3_4"]);
    expect(ok("3_4")).toEqual(["3_4"]);
  });

  it("a mix of spellings in one cell", () => {
    expect(ok("3_4 → (5, 6); 7,8 -> 9 10")).toEqual(["3_4", "5_6", "7_8", "9_10"]);
  });
});

describe("parseAnchors: errors (never half-read)", () => {
  it("empty cells", () => {
    expect(err("")).toMatch(/no anchors/);
    expect(err("   ")).toMatch(/no anchors/);
    expect(err("→")).toMatch(/no anchors/);
  });
  it("an odd count of numbers", () => {
    expect(err("3, 4, 5")).toMatch(/odd/);
    expect(err("3")).toMatch(/odd/);
  });
  it("a piece between separators that isn't exactly one coordinate", () => {
    expect(err("3, 4 → 9")).toMatch(/one coordinate/);
    expect(err("3, 4, 5, 6 → 9, 4")).toMatch(/one coordinate/);
  });
  it("text that isn't a number", () => {
    expect(err("3, x → 9, 4")).toMatch(/can't read/);
    expect(err("3.5, 4")).toMatch(/can't read/);
    expect(err("Saltmere")).toMatch(/can't read/);
    expect(err("3 - 4")).toMatch(/can't read/);
  });
  it("numbers too large to be exact", () => {
    expect(err("99999999999999999999, 1")).toMatch(/too large/);
  });
});

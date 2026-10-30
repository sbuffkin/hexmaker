import { describe, it } from "node:test";
import expect from "expect";
import { legacyChainsToPaths } from "../src/paths/legacy";
import { pathNameKey, uniquePathName } from "../src/paths/names";
import type { PathChain } from "../src/types";

describe("legacyChainsToPaths", () => {
  it("makes one dense-anchor path per chain, every hex an anchor", () => {
    const chains: PathChain[] = [
      { typeName: "Road", hexes: ["0_0", "1_0", "2_1"] },
      { typeName: "River", hexes: ["5_5"] },
    ];
    const paths = legacyChainsToPaths(chains);
    expect(paths).toEqual([
      { name: "Road", typeName: "Road", branches: [{ anchors: ["0_0", "1_0", "2_1"] }] },
      { name: "River", typeName: "River", branches: [{ anchors: ["5_5"] }] },
    ]);
    // Not aliased to the input.
    paths[0].branches[0].anchors.push("9_9");
    expect(chains[0].hexes).toEqual(["0_0", "1_0", "2_1"]);
  });

  it("names <Type>, then <Type> 2, <Type> 3… per type, in chain order", () => {
    const chains: PathChain[] = [
      { typeName: "Road", hexes: ["0_0"] },
      { typeName: "River", hexes: ["1_1"] },
      { typeName: "Road", hexes: ["2_2"] },
      { typeName: "road", hexes: ["3_3"] }, // same name ignoring case
      { typeName: "Road", hexes: ["4_4"] },
    ];
    expect(legacyChainsToPaths(chains).map((p) => p.name)).toEqual(["Road", "River", "Road 2", "road 3", "Road 4"]);
  });

  it("keeps the type as written, even when it's empty", () => {
    const paths = legacyChainsToPaths([{ typeName: "", hexes: ["0_0"] }, { typeName: "", hexes: ["1_0"] }]);
    expect(paths.map((p) => [p.name, p.typeName])).toEqual([["Path", ""], ["Path 2", ""]]);
  });

  it("avoids names already taken", () => {
    expect(legacyChainsToPaths([{ typeName: "Road", hexes: ["0_0"] }], ["road", "Road 2"]).map((p) => p.name)).toEqual(["Road 3"]);
  });

  it("moves a Notes column to notes and keeps every other column in extra", () => {
    const [p] = legacyChainsToPaths([{ typeName: "Road", hexes: ["0_0", "1_0"], extra: { notes: "Paved.", Built: "1203" } }]);
    expect(p.notes).toBe("Paved.");
    expect(p.extra).toEqual({ Built: "1203" });
    const [q] = legacyChainsToPaths([{ typeName: "Road", hexes: ["0_0"], extra: { Notes: "  " } }]);
    expect(q.notes).toBeUndefined();
    expect(q.extra).toBeUndefined();
  });
});

describe("path names", () => {
  it("compare ignoring case and spacing", () => {
    expect(pathNameKey("  King's   Road ")).toBe("king's road");
    expect(uniquePathName("King's Road", ["king's  road"])).toBe("King's Road 2");
    expect(uniquePathName(" Road ", [])).toBe("Road");
    expect(uniquePathName("Road", ["Road", "Road 3"])).toBe("Road 2");
  });
});

import { describe, it } from "node:test";
import expect from "expect";
import {
  exampleShares,
  formatShare,
  formatShareChange,
  hasTerrainTweaks,
  terrainShares,
  withoutTerrainTweaks,
} from "../src/worldgen/shares";
import type { HexWfcModel } from "../packages/hex-wfc/src";

const model: HexWfcModel = {
  name: "m",
  meta: {},
  terrains: [
    { name: "Grass", weight: 3 },
    { name: "Mountain", weight: 1 },
    { name: "Never", weight: 0 },
  ],
  adjacency: [],
  settings: { mix: { Mountain: 2 }, counts: { Mountain: { min: 1 } }, randomness: 0.3 },
};

describe("generator terrain shares", () => {
  it("measures each terrain's share of a map", () => {
    const cells = new Map([["0_0", "Grass"], ["1_0", "Grass"], ["2_0", "Grass"], ["3_0", "Mountain"]]);
    expect(Object.fromEntries(terrainShares(cells))).toEqual({ Grass: 0.75, Mountain: 0.25 });
    expect(terrainShares(new Map()).size).toBe(0);
  });

  it("reads the learned mix from the weights", () => {
    expect(Object.fromEntries(exampleShares(model))).toEqual({ Grass: 0.75, Mountain: 0.25, Never: 0 });
  });

  it("drops only mix and counts for the comparison run", () => {
    expect(hasTerrainTweaks(model)).toBe(true);
    const plain = withoutTerrainTweaks(model);
    expect(plain.settings).toEqual({ randomness: 0.3 });
    expect(hasTerrainTweaks(plain)).toBe(false);
    expect(model.settings?.mix).toEqual({ Mountain: 2 });
    expect(hasTerrainTweaks({ ...model, settings: { mix: {}, counts: {} } })).toBe(false);
  });

  it("formats shares and changes in percentage points", () => {
    expect(formatShare(0.104)).toBe("10%");
    expect(formatShare(0.003)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShareChange(0.16, 0.1)).toBe("+6");
    expect(formatShareChange(0.07, 0.1)).toBe("−3");
    expect(formatShareChange(0.101, 0.1)).toBe("");
  });
});

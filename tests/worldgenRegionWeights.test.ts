import { describe, it } from "node:test";
import expect from "expect";
import { rebalance, toPercents } from "../src/worldgen/regionWeights";

/** Region influence sliders for combined generators (src/worldgen/regionWeights.ts). */

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

describe("region influence", () => {
  it("turns sizes into whole percentages that add up to 100", () => {
    expect(toPercents([950, 400])).toEqual([70, 30]);
    expect(toPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(toPercents([0, 0])).toEqual([50, 50]);
    expect(sum(toPercents([17, 29, 3, 51, 8]))).toBe(100);
  });

  it("moving one slider shares the rest in the others' proportions", () => {
    expect(rebalance([50, 30, 20], 0, 80)).toEqual([80, 12, 8]);
    expect(rebalance([60, 40], 1, 25)).toEqual([75, 25]);
    for (const v of [0, 1, 33, 99, 100]) expect(sum(rebalance([10, 20, 30, 40], 2, v))).toBe(100);
  });

  it("splits evenly when the others were all at 0, and clamps to 0-100", () => {
    expect(rebalance([100, 0, 0], 0, 40)).toEqual([40, 30, 30]);
    expect(rebalance([50, 50], 0, 140)).toEqual([100, 0]);
    expect(rebalance([50, 50], 0, -5)).toEqual([0, 100]);
  });
});

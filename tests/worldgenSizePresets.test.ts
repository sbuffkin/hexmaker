import { describe, it } from "node:test";
import expect from "expect";
import { SIZE_PRESETS, sizePresets } from "../src/worldgen/sizePresets";

/** Preset map sizes on the generator page (src/worldgen/sizePresets.ts). */

describe("size presets", () => {
  it("are the standard sizes without a source region", () => {
    expect(sizePresets()).toEqual(SIZE_PRESETS);
  });

  it("lead with the source region's size", () => {
    expect(sizePresets({ name: "the-coast", cols: 38, rows: 25 })[0]).toEqual({ label: "Like the-coast", cols: 38, rows: 25 });
    expect(sizePresets({ name: "the-coast", cols: 38, rows: 25 })).toHaveLength(SIZE_PRESETS.length + 1);
  });

  it("don't repeat a size the standard presets already have", () => {
    expect(sizePresets({ name: "x", cols: 30, rows: 20 })).toEqual(SIZE_PRESETS);
  });
});

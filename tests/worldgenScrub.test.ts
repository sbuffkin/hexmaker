import { describe, it } from "node:test";
import expect from "expect";
import { scrubValue } from "../src/worldgen/scrub";

describe("scrubValue", () => {
  const opts = { min: 2, max: 200, pxPerStep: 4 };
  it("dragging up raises the value, down lowers it", () => {
    expect(scrubValue(30, -40, opts)).toBe(40);
    expect(scrubValue(30, 40, opts)).toBe(20);
    expect(scrubValue(30, 1, opts)).toBe(30);
  });
  it("clamps to the range and honours the step", () => {
    expect(scrubValue(30, -4000, opts)).toBe(200);
    expect(scrubValue(30, 4000, opts)).toBe(2);
    expect(scrubValue(10, -12, { min: 0, max: 100, step: 5, pxPerStep: 6 })).toBe(20);
  });
});

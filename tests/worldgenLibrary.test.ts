import { describe, it } from "node:test";
import expect from "expect";
import { combinedName, generatorRows, regionRows } from "../src/worldgen/libraryRows";

/** The generator page's file list (src/worldgen/libraryRows.ts). */

const generators = [
  { path: "g/the-coast.md", name: "the-coast", sources: ["the-coast"], palette: "Default", terrains: 31, created: "2026-10-01" },
  { path: "g/mixed.md", name: "mixed", sources: ["the-coast", "the-north"], palette: "Default", terrains: 40 },
  { path: "g/island.md", name: "island", sources: ["island"], palette: "test", terrains: 12 },
];
const regions = [
  { name: "the-north", cols: 30, rows: 20, palette: "Default" },
  { name: "the-coast", cols: 38, rows: 25, palette: "Default" },
  { name: "empty", cols: 10, rows: 10, palette: "test" },
];

describe("generator file list", () => {
  it("lists generators by name, with their regions joined", () => {
    const rows = generatorRows(generators);
    expect(rows.map((r) => r.name)).toEqual(["island", "mixed", "the-coast"]);
    expect(rows[1]).toEqual({ path: "g/mixed.md", name: "mixed", from: "the-coast + the-north", palette: "Default", terrains: 40, created: "" });
  });

  it("filters generators on every typed word, across columns", () => {
    expect(generatorRows(generators, "north").map((r) => r.name)).toEqual(["mixed"]);
    expect(generatorRows(generators, "coast default").map((r) => r.name)).toEqual(["mixed", "the-coast"]);
    expect(generatorRows(generators, "TEST").map((r) => r.name)).toEqual(["island"]);
    expect(generatorRows(generators, "2026-10")).toHaveLength(1);
  });

  it("counts each region's generators, combined ones included", () => {
    const rows = regionRows(regions, generators);
    expect(rows.map((r) => [r.name, r.size, r.generators])).toEqual([
      ["empty", "10×10", 0],
      ["the-coast", "38×25", 2],
      ["the-north", "30×20", 1],
    ]);
    expect(regionRows(regions, generators, "30×20").map((r) => r.name)).toEqual(["the-north"]);
  });

  it("names a combined generator after its regions", () => {
    expect(combinedName(["the-coast", "the-north"])).toBe("the-coast-and-the-north");
  });
});

import { describe, it } from "node:test";
import expect from "expect";
import { pickerItems } from "../src/worldgen/picker";

/** The generator page's one picker (src/worldgen/picker.ts). */

const generators = [
  { path: "g/the-coast.md", name: "the-coast", sourceMap: "the-coast", palette: "Default" },
  { path: "g/the-coast-2.md", name: "the-coast-2", sourceMap: "the-coast", palette: "Default" },
  { path: "g/island.md", name: "island", sourceMap: "island", palette: "test" },
];
const regions = [
  { name: "the-north", cols: 30, rows: 20, palette: "Default" },
  { name: "the-coast", cols: 38, rows: 25, palette: "Default" },
];

describe("generator picker", () => {
  it("lists every generator and region, sorted, when nothing is typed", () => {
    const r = pickerItems(generators, regions);
    expect(r.generators.map((i) => i.label)).toEqual(["island", "the-coast", "the-coast-2"]);
    expect(r.regions.map((i) => i.label)).toEqual(["the-coast", "the-north"]);
    expect(r.generators[0]).toMatchObject({ kind: "generator", value: "g/island.md", detail: "from island · palette test" });
  });

  it("says how many generators a region already has", () => {
    const r = pickerItems(generators, regions);
    expect(r.regions[0].detail).toBe("38×25 · palette Default · 2 generators already");
    expect(r.regions[1].detail).toBe("30×20 · palette Default");
  });

  it("filters both groups on every typed word, in names and details", () => {
    expect(pickerItems(generators, regions, "coast 2").generators.map((i) => i.label)).toEqual(["the-coast-2"]);
    const north = pickerItems(generators, regions, "NORTH");
    expect(north.generators).toEqual([]);
    expect(north.regions.map((i) => i.value)).toEqual(["the-north"]);
    expect(pickerItems(generators, regions, "palette test").generators.map((i) => i.label)).toEqual(["island"]);
  });
});

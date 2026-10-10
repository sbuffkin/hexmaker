import { describe, it } from "node:test";
import expect from "expect";
import {
  impassableNames,
  isImpassable,
  noRouteMessage,
  parseImpassableCell,
  pathAvoidsImpassable,
  setImpassable,
} from "../src/impassable";
import { parsePaletteNote, serializePaletteTable, terrainsEqual, buildPaletteNote } from "../src/palettes/paletteNote";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import type { TerrainColor } from "../src/types";

describe("impassable terrain (P1)", () => {
  it("water types are impassable by default; land isn't", () => {
    expect(isImpassable({ type: "water" })).toBe(true);
    expect(isImpassable({ type: "deep-water" })).toBe(true);
    expect(isImpassable({ type: "shallows" })).toBe(true);
    expect(isImpassable({ type: "forest" })).toBe(false);
    expect(isImpassable({})).toBe(false);
  });

  it("an explicit flag wins over the type", () => {
    expect(isImpassable({ type: "water", impassable: false })).toBe(false);
    expect(isImpassable({ type: "mountains", impassable: true })).toBe(true);
  });

  it("setImpassable stores only real overrides", () => {
    const t: TerrainColor = { name: "lake", color: "#00f", type: "water" };
    setImpassable(t, true);
    expect("impassable" in t).toBe(false);
    setImpassable(t, false);
    expect(t.impassable).toBe(false);
    setImpassable(t, true);
    expect("impassable" in t).toBe(false);
  });

  it("the bundled fantasy palettes have impassable water", () => {
    expect(impassableNames(LIMITED_TERRAIN_PALETTE).length).toBeGreaterThan(0);
    expect(impassableNames(DEFAULT_TERRAIN_PALETTE)).toEqual(expect.arrayContaining(["ocean", "trench", "shallows"]));
    expect(impassableNames(DEFAULT_TERRAIN_PALETTE)).not.toContain("grass");
  });

  it("roads avoid impassable terrain, rivers don't", () => {
    const road = DEFAULT_PATH_TYPES.find((p) => p.name === "Road")!;
    const river = DEFAULT_PATH_TYPES.find((p) => p.name === "River")!;
    expect(pathAvoidsImpassable(road)).toBe(true);
    expect(pathAvoidsImpassable(river)).toBe(false);
    // Unset: by name.
    expect(pathAvoidsImpassable({ name: "Trail" })).toBe(true);
    expect(pathAvoidsImpassable({ name: "Mountain stream" })).toBe(false);
    expect(pathAvoidsImpassable({ name: "River", avoidImpassable: true })).toBe(true);
  });

  it("the no-route message names the blockers and the way out", () => {
    const msg = noRouteMessage(["ocean", "trench"]);
    expect(msg).toContain("ocean, trench");
    expect(msg).toContain("Cross impassable");
    expect(noRouteMessage([])).toMatch(/No route/);
  });

  it("parses Impassable cells", () => {
    expect(parseImpassableCell("yes")).toBe(true);
    expect(parseImpassableCell(" No ")).toBe(false);
    expect(parseImpassableCell("")).toBeUndefined();
    expect(parseImpassableCell(undefined)).toBeUndefined();
  });
});

describe("palette note Impassable column", () => {
  it("is left out when no terrain overrides its default (notes don't churn)", () => {
    const table = serializePaletteTable([{ name: "ocean", color: "#29507f", type: "water" }]);
    expect(table).not.toContain("Impassable");
  });

  it("round-trips overrides", () => {
    const terrains: TerrainColor[] = [
      { name: "ford", color: "#4a82a5", type: "shallows", impassable: false },
      { name: "cliffs", color: "#777777", type: "mountains", impassable: true },
      { name: "grass", color: "#69a168", type: "grassland" },
    ];
    const note = buildPaletteNote(terrains);
    expect(note).toContain("| Impassable |");
    const back = parsePaletteNote(note)!;
    expect(back).toEqual(terrains);
    expect(terrainsEqual(back, terrains)).toBe(true);
  });

  it("a changed flag is a change", () => {
    const a: TerrainColor[] = [{ name: "x", color: "#000000" }];
    const b: TerrainColor[] = [{ name: "x", color: "#000000", impassable: true }];
    expect(terrainsEqual(a, b)).toBe(false);
  });

  it("reads a hand-written Impassable column", () => {
    const md = "| Terrain | Color | Impassable |\n| --- | --- | --- |\n| lava | #f00 | yes |\n| sea | #00f | no |\n";
    expect(parsePaletteNote(md)).toEqual([
      { name: "lava", color: "#f00", impassable: true },
      { name: "sea", color: "#00f", impassable: false },
    ]);
  });
});

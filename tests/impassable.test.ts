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

// PA4 = A: impassable defaults come from terrain type groups, so any palette works.
import { IMPASSABLE_BY_DEFAULT_TYPES, impassableSourceText } from "../src/impassable";
import { effectiveTerrainType, TERRAIN_TYPES, terrainTypeGroup, typesInGroup } from "../src/terrainTypes";

describe("impassable by type group (PA4)", () => {
	it("the whole water group is impassable by default, and nothing else", () => {
		expect(typesInGroup("water")).toEqual(["deep-water", "water", "shallows"]);
		expect([...IMPASSABLE_BY_DEFAULT_TYPES].sort()).toEqual(["deep-water", "shallows", "water"]);
		for (const t of TERRAIN_TYPES) {
			expect(isImpassable({ type: t.id })).toBe(t.group === "water");
		}
	});

	it("every type has a group; coast is land, space types are space", () => {
		for (const t of TERRAIN_TYPES) expect(["water", "land", "space"]).toContain(t.group);
		expect(terrainTypeGroup("coast")).toBe("land");
		expect(terrainTypeGroup("nebula")).toBe("space");
		expect(terrainTypeGroup(undefined)).toBeUndefined();
	});

	it("a custom palette inherits by type, whatever the names", () => {
		const custom: TerrainColor[] = [
			{ name: "Mirror Mere", color: "#00f", type: "water" },
			{ name: "Kraken Deeps", color: "#003", type: "deep-water" },
			{ name: "Coral Shelf", color: "#0aa", type: "shallows" },
			{ name: "Glass Strand", color: "#ffd", type: "coast" },
			{ name: "Ashwood", color: "#333", type: "forest" },
		];
		expect(impassableNames(custom)).toEqual(["Mirror Mere", "Kraken Deeps", "Coral Shelf"]);
	});

	it("an untyped custom terrain counts as the type its name suggests", () => {
		expect(effectiveTerrainType({ name: "Black Lake" })).toBe("water");
		expect(effectiveTerrainType({ name: "Mirror Mere", type: "water" })).toBe("water");
		expect(effectiveTerrainType({ name: "Mirror Mere" })).toBeUndefined();
		expect(isImpassable({ name: "Black Lake" })).toBe(true);
		expect(isImpassable({ name: "Old Forest" })).toBe(false);
		// A known type wins over the name.
		expect(isImpassable({ name: "Lake District", type: "hills" })).toBe(false);
	});

	it("a per-terrain override still wins, and only overrides are stored", () => {
		expect(isImpassable({ name: "Ford", type: "shallows", impassable: false })).toBe(false);
		expect(isImpassable({ name: "Lava Field", type: "volcanic", impassable: true })).toBe(true);
		const lake: TerrainColor = { name: "Black Lake", color: "#00f" };
		setImpassable(lake, true);
		expect("impassable" in lake).toBe(false);
		setImpassable(lake, false);
		expect(lake.impassable).toBe(false);
	});

	it("the palette editor says where a value comes from", () => {
		expect(impassableSourceText({ type: "water" })).toBe("Default for its type group (Water: impassable)");
		expect(impassableSourceText({ type: "forest" })).toBe("Default for its type group (Land: passable)");
		expect(impassableSourceText({ type: "forest", impassable: true })).toBe("Set for this terrain");
		expect(impassableSourceText({ name: "Zorp" })).toBe("Default (no type: passable)");
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import type { TerrainColor } from "../src/types";
import {
	compareTerrainTypes,
	groupPaletteByType,
	matchesTerrainFilter,
	resolveTerrainType,
	terrainTypeLabel,
	type TerrainFilterState,
} from "../src/hex-table/terrainTypeFilter";

const PALETTE: TerrainColor[] = [
	{ name: "dark forest", color: "#030", type: "forest" },
	{ name: "ocean", color: "#00f", type: "water" },
	{ name: "pine wood", color: "#050", type: "forest" },
	{ name: "mystery", color: "#999" },
	{ name: "bogus", color: "#111", type: "not-a-type" },
	{ name: "void", color: "#000", type: "void" },
];
const BY_NAME = new Map(PALETTE.map((t) => [t.name, t]));

const filter = (f: Partial<Record<keyof TerrainFilterState, string[]>>): TerrainFilterState => ({
	terrains: new Set(f.terrains ?? []),
	excludeTerrains: new Set(f.excludeTerrains ?? []),
	types: new Set(f.types ?? []),
	excludeTypes: new Set(f.excludeTypes ?? []),
});

describe("resolveTerrainType", () => {
	it("returns the palette entry's type", () => {
		expect(resolveTerrainType("dark forest", BY_NAME)).toBe("forest");
	});
	it("does not infer from the name when the entry has no type", () => {
		expect(resolveTerrainType("mystery", BY_NAME)).toBe("");
		// "pine" would infer forest, but only the palette counts
		expect(resolveTerrainType("pine grove", BY_NAME)).toBe("");
	});
	it("ignores unknown type ids, unset and missing terrains", () => {
		expect(resolveTerrainType("bogus", BY_NAME)).toBe("");
		expect(resolveTerrainType("", BY_NAME)).toBe("");
		expect(resolveTerrainType(null, BY_NAME)).toBe("");
		expect(resolveTerrainType(undefined, BY_NAME)).toBe("");
	});
});

describe("terrainTypeLabel", () => {
	it("labels known ids and blanks the rest", () => {
		expect(terrainTypeLabel("forest")).toBe("Forest");
		expect(terrainTypeLabel("")).toBe("");
		expect(terrainTypeLabel("nope")).toBe("");
	});
});

describe("compareTerrainTypes", () => {
	it("orders by vocabulary with untyped last", () => {
		const ids = ["", "void", "forest", "water", "nope"];
		ids.sort(compareTerrainTypes);
		expect(ids.slice(0, 3)).toEqual(["water", "forest", "void"]);
		expect(compareTerrainTypes("", "nope")).toBe(0);
	});
});

describe("groupPaletteByType", () => {
	it("groups typed entries in vocabulary order and keeps the rest untyped", () => {
		const { groups, untyped } = groupPaletteByType(PALETTE);
		expect(groups.map((g) => g.typeId)).toEqual(["water", "forest", "void"]);
		expect(groups[1].label).toBe("Forest");
		expect(groups[1].entries.map((e) => e.name)).toEqual(["dark forest", "pine wood"]);
		expect(untyped.map((e) => e.name)).toEqual(["mystery", "bogus"]);
	});
	it("handles an empty palette", () => {
		expect(groupPaletteByType([])).toEqual({ groups: [], untyped: [] });
	});
});

describe("matchesTerrainFilter", () => {
	const forest = { terrain: "dark forest", effectiveTerrain: "dark forest", type: "forest" };
	const pine = { terrain: "pine wood", effectiveTerrain: "pine wood", type: "forest" };
	const ocean = { terrain: "ocean", effectiveTerrain: "ocean", type: "water" };
	const bare = { terrain: "", effectiveTerrain: "", type: "" };
	// A hex with a note but no terrain, on a map whose base terrain is void
	const based = { terrain: "", effectiveTerrain: "void", type: "void" };

	it("passes everything with an empty filter", () => {
		for (const r of [forest, ocean, bare, based]) expect(matchesTerrainFilter(r, filter({}))).toBe(true);
	});
	it("includes every terrain of a selected type", () => {
		const f = filter({ types: ["forest"] });
		expect(matchesTerrainFilter(forest, f)).toBe(true);
		expect(matchesTerrainFilter(pine, f)).toBe(true);
		expect(matchesTerrainFilter(ocean, f)).toBe(false);
		expect(matchesTerrainFilter(bare, f)).toBe(false);
	});
	it("unions terrain and type includes", () => {
		const f = filter({ types: ["water"], terrains: ["pine wood"] });
		expect(matchesTerrainFilter(ocean, f)).toBe(true);
		expect(matchesTerrainFilter(pine, f)).toBe(true);
		expect(matchesTerrainFilter(forest, f)).toBe(false);
	});
	it("excludes by type, and exclusion beats inclusion", () => {
		expect(matchesTerrainFilter(forest, filter({ excludeTypes: ["forest"] }))).toBe(false);
		expect(matchesTerrainFilter(ocean, filter({ excludeTypes: ["forest"] }))).toBe(true);
		expect(matchesTerrainFilter(forest, filter({ types: ["forest"], excludeTerrains: ["dark forest"] }))).toBe(false);
		expect(matchesTerrainFilter(pine, filter({ types: ["forest"], excludeTerrains: ["dark forest"] }))).toBe(true);
	});
	it("matches base-terrain hexes by displayed terrain, type, or 'no terrain'", () => {
		expect(matchesTerrainFilter(based, filter({ types: ["void"] }))).toBe(true);
		expect(matchesTerrainFilter(based, filter({ terrains: ["void"] }))).toBe(true);
		expect(matchesTerrainFilter(based, filter({ terrains: [""] }))).toBe(true);
		expect(matchesTerrainFilter(based, filter({ excludeTypes: ["void"] }))).toBe(false);
		expect(matchesTerrainFilter(based, filter({ excludeTerrains: [""] }))).toBe(false);
	});
	it("untyped rows never match a type include", () => {
		expect(matchesTerrainFilter(bare, filter({ types: ["forest"] }))).toBe(false);
		expect(matchesTerrainFilter(bare, filter({ excludeTypes: ["forest"] }))).toBe(true);
	});
});

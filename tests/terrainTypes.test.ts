import { describe, it } from "node:test";
import expect from "expect";
import { TERRAIN_TYPES, inferTerrainType, isTerrainType, terrainTypeInfo } from "../src/terrainTypes";
import { buildPaletteNote, parsePaletteNote, updatePaletteNote } from "../src/palettes/paletteNote";
import { seedTerrainTypes } from "../src/palettes/PaletteStore";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { PALETTE_PRESETS } from "../src/palettes/presets";
import type { TerrainPalette } from "../src/types";

describe("terrain type vocabulary", () => {
	it("has unique ids and both map kinds", () => {
		const ids = TERRAIN_TYPES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(TERRAIN_TYPES.some((t) => t.kind === "world")).toBe(true);
		expect(TERRAIN_TYPES.some((t) => t.kind === "space")).toBe(true);
		expect(isTerrainType("forest")).toBe(true);
		expect(isTerrainType("nope")).toBe(false);
		expect(terrainTypeInfo("void")?.kind).toBe("space");
	});

	it("every shipped palette terrain has a valid type", () => {
		for (const p of PALETTE_PRESETS) {
			for (const t of p.terrains) {
				expect({ palette: p.name, terrain: t.name, ok: isTerrainType(t.type) }).toMatchObject({ ok: true });
				expect({ palette: p.name, terrain: t.name, kind: terrainTypeInfo(t.type)?.kind }).toMatchObject({ kind: p.kind });
			}
		}
	});
});

describe("inferTerrainType", () => {
	it("reads custom names", () => {
		expect(inferTerrainType("dark forest")).toBe("forest");
		expect(inferTerrainType("Glass Desert")).toBe("desert");
		expect(inferTerrainType("frozen lake")).toBe("water");
		expect(inferTerrainType("salt marsh")).toBe("wetland");
		expect(inferTerrainType("ruined city")).toBe("settlement");
	});

	it("prefers the keyword nearest the end ('forested hills' is hills)", () => {
		expect(inferTerrainType("forested hills")).toBe("hills");
		expect(inferTerrainType("jungle mountains")).toBe("mountains");
		expect(inferTerrainType("hill forest")).toBe("forest");
	});

	it("falls back to the category, respects the kind filter, and returns undefined when unsure", () => {
		expect(inferTerrainType("Mirkwood", "forest")).toBe("forest");
		expect(inferTerrainType("gas giant", undefined, "space")).toBe("gas-giant");
		expect(inferTerrainType("ocean world", undefined, "space")).toBe("world");
		expect(inferTerrainType("Zorblax")).toBeUndefined();
	});
});

describe("Type column in palette notes", () => {
	const terrains = [
		{ name: "Pinewood", color: "#123456", type: "forest" },
		{ name: "Kelp sea", color: "#0000ff", category: "sea", type: "water" },
		{ name: "Untyped", color: "#ffffff" },
	];

	it("round-trips", () => {
		expect(parsePaletteNote(buildPaletteNote(terrains))).toEqual(terrains);
	});

	it("old five-column notes parse without types, and gain the column on rewrite", () => {
		const old = "| Terrain | Color | Icon | Icon color | Category |\n| --- | --- | --- | --- | --- |\n| grass | #00ff00 |  |  | lowlands |\n";
		const parsed = parsePaletteNote(old)!;
		expect(parsed).toEqual([{ name: "grass", color: "#00ff00", category: "lowlands" }]);
		parsed[0].type = "grassland";
		const updated = updatePaletteNote(old, parsed);
		expect(updated).toContain("| Type |");
		expect(parsePaletteNote(updated)).toEqual(parsed);
	});
});

describe("seedTerrainTypes", () => {
	it("copies preset types by name and infers the rest, leaving typed terrains alone", () => {
		const palettes: TerrainPalette[] = [{
			name: "Mine",
			terrains: [
				{ name: "ocean", color: "#000" },
				{ name: "dark forest", color: "#000" },
				{ name: "Zorblax", color: "#000" },
				{ name: "grass", color: "#000", type: "desert" },
			],
		}];
		expect(seedTerrainTypes(palettes)).toBe(2);
		expect(palettes[0].terrains.map((t) => t.type)).toEqual(["water", "forest", undefined, "desert"]);
	});

	it("is a no-op on the shipped palettes", () => {
		const copy: TerrainPalette[] = [DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE].map((terrains, i) => ({
			name: `p${i}`,
			terrains: terrains.map((t) => ({ ...t })),
		}));
		expect(seedTerrainTypes(copy)).toBe(0);
	});
});

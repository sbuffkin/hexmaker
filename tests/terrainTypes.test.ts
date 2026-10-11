import { describe, it } from "node:test";
import expect from "expect";
import { TERRAIN_TYPES, inferTerrainType, isTerrainType, terrainTypeInfo } from "../src/terrainTypes";
import { refinedSpaceType } from "../src/modules/space/terrainTypes";
import { buildPaletteNote, parsePaletteNote, updatePaletteNote } from "../src/palettes/paletteNote";
import { seedTerrainTypes, upgradePaletteData } from "../src/palettes/PaletteStore";
import { presetToPalette, getPreset } from "../src/palettes/presets";
import { SPACE_SECTOR_PALETTE_NAME, SPACE_SYSTEM_PALETTE_NAME } from "../src/modules/space/presets";
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
				// A space preset may use land and water types (Space - Planet's surfaces).
				const info = terrainTypeInfo(t.type);
				const fits = info?.kind === p.kind || (p.kind === "space" && (info?.group === "land" || info?.group === "water"));
				expect({ palette: p.name, terrain: t.name, fits }).toMatchObject({ fits: true });
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

describe("space role types (owner rule: never special-case names)", () => {
	it("each Orbits / Star scatter role has its own type in the shipped palettes", () => {
		const sys = getPreset(SPACE_SYSTEM_PALETTE_NAME)!.terrains;
		const typeOf = (n: string) => sys.find((t) => t.name === n)?.type;
		expect(typeOf("moon")).toBe("moon");
		expect(typeOf("comet")).toBe("comet");
		expect(typeOf("debris field")).toBe("debris");
		expect(typeOf("starport")).toBe("starport");
		expect(typeOf("jump point")).toBe("jump-point");
		expect(typeOf("jump limit")).toBe("jump-limit");
		expect(getPreset(SPACE_SECTOR_PALETTE_NAME)!.terrains.find((t) => t.name === "star system")?.type).toBe("star-system");
	});

	it("suggests the new types from names (a suggestion only)", () => {
		expect(inferTerrainType("starport")).toBe("starport");
		expect(inferTerrainType("jump gate")).toBe("jump-point");
		expect(inferTerrainType("space station")).toBe("station");
		expect(inferTerrainType("Pale moon")).toBe("moon");
		expect(inferTerrainType("star system")).toBe("star-system");
	});

	it("refinedSpaceType turns the old name rule into a type once", () => {
		expect(refinedSpaceType({ name: "moon", type: "world" })).toBe("moon");
		expect(refinedSpaceType({ name: "Luna", type: "world" })).toBeUndefined();
		expect(refinedSpaceType({ name: "Halley's comet", type: "asteroids" })).toBe("comet");
		expect(refinedSpaceType({ name: "debris field", type: "asteroids" })).toBe("debris");
		expect(refinedSpaceType({ name: "asteroid belt", type: "asteroids" })).toBeUndefined();
		expect(refinedSpaceType({ name: "Highport", type: "station" })).toBe("starport");
		expect(refinedSpaceType({ name: "Gateway", type: "station" })).toBe("jump-point");
		expect(refinedSpaceType({ name: "Outpost", type: "station" })).toBeUndefined();
		expect(refinedSpaceType({ name: "jump limit", type: "void" })).toBe("jump-limit");
		expect(refinedSpaceType({ name: "star system", type: "star" })).toBe("star-system");
		// Only upgrades the old coarse type; a terrain already typed otherwise is left alone.
		expect(refinedSpaceType({ name: "moon", type: "desert" })).toBeUndefined();
		expect(refinedSpaceType({ name: "moon" })).toBeUndefined();
	});

	it("upgradePaletteData retypes old space palettes and copies a preset's child palette and submap rows once", () => {
		// An old install of Space - Sector / System: coarse types, no child palette, no submap rows.
		const oldSystem = presetToPalette(getPreset(SPACE_SYSTEM_PALETTE_NAME)!);
		for (const t of oldSystem.terrains) {
			if (t.type === "moon") t.type = "world";
			if (t.type === "comet" || t.type === "debris") t.type = "asteroids";
			if (t.type === "starport" || t.type === "jump-point") t.type = "station";
			if (t.type === "jump-limit") t.type = "void";
		}
		delete oldSystem.submapDefaults;
		const oldSector = presetToPalette(getPreset(SPACE_SECTOR_PALETTE_NAME)!);
		delete oldSector.childPalette;
		const mine: TerrainPalette = { name: "Mine", terrains: [{ name: "Moonlet", color: "#999", type: "world" }] };
		expect(upgradePaletteData([oldSystem, oldSector, mine])).toBe(2);
		expect(oldSystem.terrains.map((t) => t.type)).toEqual(getPreset(SPACE_SYSTEM_PALETTE_NAME)!.terrains.map((t) => t.type));
		expect(Object.keys(oldSystem.submapDefaults ?? {}).sort()).toEqual(Object.keys(getPreset(SPACE_SYSTEM_PALETTE_NAME)!.submapDefaults!).sort());
		expect(oldSector.childPalette).toBe(SPACE_SYSTEM_PALETTE_NAME);
		expect(mine.terrains[0].type).toBe("world");
		// Second run: nothing left to do.
		expect(upgradePaletteData([oldSystem, oldSector, mine])).toBe(0);
	});

	it("keeps rows the user already has and never touches a renamed or custom palette's metadata", () => {
		const sector = presetToPalette(getPreset(SPACE_SECTOR_PALETTE_NAME)!, "My sector");
		delete sector.childPalette;
		delete sector.submapDefaults;
		expect(upgradePaletteData([sector])).toBe(0);
		expect(sector.childPalette).toBeUndefined();
		const system = presetToPalette(getPreset(SPACE_SYSTEM_PALETTE_NAME)!);
		system.submapDefaults = { moon: { cols: 5 } };
		upgradePaletteData([system]);
		expect(system.submapDefaults.moon).toEqual({ cols: 5 });
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

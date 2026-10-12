/**
 * Phase 6 (plan-tables-everywhere §1.3): Open sea's terrain weights were
 * built into the code by name (ocean 80, trench 20). They are data now:
 * a biome with no shipped generator is drawn from its shipped biome note's
 * Mix (water 80, deep water 20), the same mix as the Open sea note in the
 * vault. Same odds, by type; no terrain name is read.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { biomeProfiles, OPEN_SEA, profileFromFields } from "../src/overworld/biomes";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { MODELS } from "./overworldFixtures";
import type { TerrainColor } from "../src/types";

describe("Open sea: weights from data, not names", () => {
	it("water 80% and deep water 20%, as the old ocean 80 / trench 20", () => {
		const p = biomeProfiles(MODELS, DEFAULT_TERRAIN_PALETTE).get(OPEN_SEA)!;
		expect(p.types.get("water")).toBeCloseTo(0.8, 12);
		expect(p.types.get("deep-water")).toBeCloseTo(0.2, 12);
		expect([...p.types.keys()].sort()).toEqual(["deep-water", "water"]);
	});

	it("is exactly the Open sea note's profile (the same as with the notes loaded)", () => {
		const fromCode = biomeProfiles(MODELS, DEFAULT_TERRAIN_PALETTE).get(OPEN_SEA)!;
		const fromNote = profileFromFields({ ...biomePreset(OPEN_SEA)!, id: OPEN_SEA }, DEFAULT_TERRAIN_PALETTE);
		expect(fromCode).toEqual(fromNote);
	});

	it("works on a palette with none of the old names (no special defaults)", () => {
		const custom: TerrainColor[] = [
			{ name: "Brine", color: "#00f", type: "water" },
			{ name: "Abyss", color: "#003", type: "deep-water" },
			{ name: "Meadow", color: "#0f0", type: "grassland" },
		];
		const p = biomeProfiles(MODELS, custom).get(OPEN_SEA)!;
		expect(p.names.get("water")).toEqual(new Map([["Brine", 1]]));
		expect(p.names.get("deep-water")).toEqual(new Map([["Abyss", 1]]));
	});

	it("with the shipped biome data deleted, Open sea has no profile (and nothing throws)", () => {
		const without = BIOME_PRESETS.filter((b) => b.id !== OPEN_SEA);
		expect(biomeProfiles(MODELS, DEFAULT_TERRAIN_PALETTE, without).has(OPEN_SEA)).toBe(false);
		expect(biomeProfiles(new Map(), DEFAULT_TERRAIN_PALETTE, []).size).toBe(0);
	});

	it("no terrain names or weights for it are left in the code", () => {
		const code = readFileSync("src/overworld/biomes.ts", "utf8");
		expect(code).not.toMatch(/OPEN_SEA_TERRAINS|"trench"|weight: 80/);
		expect(code).not.toMatch(/=== OPEN_SEA \?/);
	});
});

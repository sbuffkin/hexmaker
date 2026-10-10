import { describe, it } from "node:test";
import expect from "expect";
import { BASE_TERRAIN_HELP, BASE_TERRAIN_NONE_LABEL } from "../src/worldgen/NewMapSetupModal";
import { TERRAIN_TABLES_SUMMARY } from "../src/wizardText";
import { emptyTableMessage } from "../src/random-tables/randomTable";

/** Fresh-eyes round 4 (setup, new map, maps modal): wording that must stay true. */

describe("Base terrain wording", () => {
	it("doesn't claim None creates every hex note (notes are made on use)", () => {
		for (const text of [BASE_TERRAIN_NONE_LABEL, BASE_TERRAIN_HELP]) {
			expect(text).not.toMatch(/every hex note|up front/i);
		}
	});

	it("says what it does: unpainted hexes show the base, or nothing with None", () => {
		expect(BASE_TERRAIN_NONE_LABEL).toMatch(/unpainted hexes stay blank/i);
		expect(BASE_TERRAIN_HELP).toMatch(/haven't painted/i);
		expect(BASE_TERRAIN_HELP).toMatch(/first add something/i);
	});
});

describe("Wizard finish summary: terrain tables", () => {
	it("says the tables are empty and ready to fill, not ready-made encounters", () => {
		expect(TERRAIN_TABLES_SUMMARY).toMatch(/empty/i);
		expect(TERRAIN_TABLES_SUMMARY).toMatch(/fill in/i);
		expect(TERRAIN_TABLES_SUMMARY).not.toMatch(/encounter tables for every terrain/i);
	});

	it("rolling one of those tables still explains it has no entries yet (E6)", () => {
		const setupTable = "---\ndice: 20\n---\n\n| Result | Weight |\n|--------|--------|\n|  | 1 |\n";
		expect(emptyTableMessage(setupTable)).toMatch(/no entries yet/);
	});
});

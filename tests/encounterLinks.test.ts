import { describe, it } from "node:test";
import expect from "expect";
import { displayedEncounterLinks } from "../src/encounterLinks";

describe("displayedEncounterLinks (fresh-eyes round 3: editor 'None' vs table 'ocean')", () => {
	const ocean = "world/tables/terrain/encounters/ocean";

	it("shows the terrain's table for a hex with no note yet (what its note will get)", () => {
		expect(displayedEncounterLinks(false, [], ocean)).toEqual([ocean]);
	});

	it("shows nothing for a noteless hex whose terrain has no table", () => {
		expect(displayedEncounterLinks(false, [], null)).toEqual([]);
	});

	it("trusts the note's own section once the note exists", () => {
		expect(displayedEncounterLinks(true, ["coast"], ocean)).toEqual(["coast"]);
		// The user removed the terrain table from the note: it stays removed.
		expect(displayedEncounterLinks(true, [], ocean)).toEqual([]);
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import { displayedEncounterLinks, linkDisplayName } from "../src/encounterLinks";

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

describe("linkDisplayName (round 6 U2: no raw wiki paths in the hex editor)", () => {
	it("shows a terrain table by its name and kind", () => {
		expect(linkDisplayName("world/tables/terrain/encounters/grass")).toBe("grass encounters");
		expect(linkDisplayName("world/tables/terrain/descriptions/grass.md")).toBe("grass descriptions");
	});
	it("shows other notes by their basename", () => {
		expect(linkDisplayName("world/towns/Ashby")).toBe("Ashby");
		expect(linkDisplayName("Cole's Ford")).toBe("Cole's Ford");
		expect(linkDisplayName("world/towns/Ashby#Market")).toBe("Ashby");
	});
	it("uses an alias when the link has one", () => {
		expect(linkDisplayName("world/towns/Ashby|the village")).toBe("the village");
	});
});

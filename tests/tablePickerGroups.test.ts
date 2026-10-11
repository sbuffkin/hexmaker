import { describe, it } from "node:test";
import expect from "expect";
import { MAP_MADE_GROUP_LABEL, tableFitsWant, tableMadeBy } from "../src/random-tables/resolve";
import { groupTablesForPicker } from "../src/notePickers";
import { makeTableTemplate } from "../src/utils";
import { parseMiniYaml } from "./helpers/memVault";

/**
 * Table pickers (inputs audit item 10 / picker focus 4): the terrain and
 * region tables the map makes sit apart from the user's own tables, found
 * by their frontmatter, never their name or folder.
 */

const fmOf = (note: string) => parseMiniYaml(/^---\n([\s\S]*?)\n---/.exec(note)![1]);

describe("tables the map made", () => {
	it("are told by table-type: description or encounters", () => {
		// What ensureTerrainTables / region tables write.
		expect(tableMadeBy(fmOf(makeTableTemplate(20, { "table-type": "description", "roll-filter": false, "encounter-filter": false })))).toBe("map");
		expect(tableMadeBy(fmOf(makeTableTemplate(20, { region: "Basin", "table-type": "encounters" })))).toBe("map");
		expect(tableMadeBy({ "table-type": "Encounters" })).toBe("map");
		// Starter tables and the user's own tables are the user's.
		expect(tableMadeBy(fmOf(makeTableTemplate(20, { "table-type": "landmark" })))).toBeUndefined();
		expect(tableMadeBy(fmOf(makeTableTemplate(20)))).toBeUndefined();
		expect(tableMadeBy(undefined)).toBeUndefined();
		// A user's table named like a terrain table is still theirs.
		expect(tableMadeBy({ dice: 20 })).toBeUndefined();
	});

	it("group after the user's, or drop out, through tableFitsWant", () => {
		expect(tableFitsWant({ madeBy: "map" }, { mapMade: "group" })).toEqual({ fit: "any", group: "map" });
		expect(tableFitsWant({ madeBy: "map" }, { mapMade: "hide" }).fit).toBe("no");
		expect(tableFitsWant({ madeBy: "map" }, {})).toEqual({ fit: "any" });
		expect(tableFitsWant({}, { mapMade: "group" })).toEqual({ fit: "any" });
		// Row-type wants still apply inside the group.
		expect(tableFitsWant({ madeBy: "map", rows: "text" }, { mapMade: "group", rows: ["note"] }).fit).toBe("no");
	});

	it("pickers list the user's tables first, the map's in their own group, order kept", () => {
		const items = [
			{ name: "weather", madeBy: undefined },
			{ name: "forest encounters", madeBy: "map" as const },
			{ name: "my dragons", madeBy: undefined },
			{ name: "Basin", madeBy: "map" as const },
		];
		const g = groupTablesForPicker(items, (i) => ({ madeBy: i.madeBy }));
		expect(g.own.map((i) => i.name)).toEqual(["weather", "my dragons"]);
		expect(g.mapMade.map((i) => i.name)).toEqual(["forest encounters", "Basin"]);
		expect(groupTablesForPicker(items, (i) => ({ madeBy: i.madeBy }), { mapMade: "hide" }).mapMade).toEqual([]);
		expect(MAP_MADE_GROUP_LABEL).toBe("Made by the map");
	});
});

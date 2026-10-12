/**
 * Phase 6 (plan-tables-everywhere, F14): the Names role. A map made from a
 * hex takes the hex's own name, else a name rolled on the Names table set
 * on the parent map (or a map above it), else the hex's terrain and
 * coordinates as before.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { rollMapName, tidyMapName, MAX_ROLLED_NAME } from "../src/maps/mapNames";
import { notesLookup } from "../src/random-tables/resolve";
import { ENGINE_ROLES, NAMES_ROLE } from "../src/worldgen/tableRoles";
import { inheritedRoleTables } from "../src/worldgen/tableSources";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { defaultSubmapLabel } from "../src/hex-map/submapNav";
import { defaultRegionName } from "../src/overworld/regionWorld";

const TABLES = {
	"t/Star names.md": "---\ndice: 4\nrows: text\n---\n| d4 | Result | Weight | When |\n|---|---|---|---|\n| 1 | Kerrin's Reach | 1 | type: world |\n| 2 | Vesper | 1 | type: world |\n| 3 | The Cauldron | 1 | type: gas-giant |\n| 4 | [[Old names]] | 1 | type: world |\n",
	"t/Old names.md": "| Result | Weight |\n|---|---|\n| [[Places/Hollow Mere]] | 1 |\n",
	"t/Nothing.md": "| Result | Weight |\n|---|---|\n| (nothing) | 1 |\n",
	"t/Loop.md": "| Result | Weight |\n|---|---|\n| [[Loop]] | 1 |\n",
};
const lookup = notesLookup(TABLES);

describe("the Names role", () => {
	it("is the core's, for every map type, and has no table by default", () => {
		expect(ENGINE_ROLES).toContain(NAMES_ROLE);
		expect(NAMES_ROLE.rows).toBe("text");
		expect(NAMES_ROLE.defaultTable).toBeUndefined();
	});

	it("rolls a name, the hex's type as When context; a linked note gives its name", () => {
		const seen = new Set<string>();
		for (let seed = 1; seed <= 60; seed++) seen.add(rollMapName("t/Star names", lookup, { seed, type: "world" })!);
		expect([...seen].sort()).toEqual(["Hollow Mere", "Kerrin's Reach", "Vesper"]);
		expect(rollMapName("t/Star names", lookup, { seed: 3, type: "gas-giant" })).toBe("The Cauldron");
	});

	it("is seeded: the same seed gives the same name", () => {
		expect(rollMapName("t/Star names", lookup, { seed: 42, type: "world" })).toBe(rollMapName("t/Star names", lookup, { seed: 42, type: "world" }));
	});

	it("no table, a missing table, (nothing), a loop or no fitting row: no name (terrain and coordinates are used)", () => {
		expect(rollMapName(undefined, lookup)).toBeUndefined();
		expect(rollMapName("t/Gone", lookup)).toBeUndefined();
		expect(rollMapName("t/Nothing", lookup, { seed: 1 })).toBeUndefined();
		expect(rollMapName("t/Loop", lookup, { seed: 1 })).toBeUndefined();
		expect(rollMapName("t/Star names", lookup, { seed: 1, type: "asteroids" })).toBeUndefined();
	});

	it("tidies what a row says into a name", () => {
		expect(tidyMapName("  [[Places/Hollow Mere|The Mere]] ")).toBe("The Mere");
		expect(tidyMapName("folder/Saltmere.md")).toBe("Saltmere");
		expect(tidyMapName("Kerrin's   Reach: #3?")).toBe("Kerrin's Reach 3");
		expect(tidyMapName("  ")).toBeUndefined();
		expect(tidyMapName("word ".repeat(30))!.length).toBeLessThanOrEqual(MAX_ROLLED_NAME);
	});

	it("the table is set per map, inherited down the map tree, and saved as names-table in the map note", () => {
		const roleTables: Record<string, Record<string, string> | undefined> = { sector: { names: "t/Star names.md" }, system: undefined };
		const parent: Record<string, string | undefined> = { system: "sector", planet: "system" };
		expect(inheritedRoleTables("planet", (m) => roleTables[m], (m) => parent[m]).names).toEqual({ link: "t/Star names.md", from: "sector" });
		const note = buildMapNote("sector", { settings: { paletteName: "Space - Sector", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, roleTables: { names: "t/Star names.md" } }, hexes: new Map(), paths: [] });
		expect(note).toContain('names-table: "[[t/Star names]]"');
		expect(parseMapNote(note)!.settings.roleTables).toEqual({ names: "t/Star names.md" });
	});

	it("a rolled name stands where the hex's name would (still unique among the maps)", () => {
		expect(defaultSubmapLabel("Vesper", "The Drift", 2, 7, { terrain: "ocean world", taken: ["Vesper"] })).toBe("Vesper (2)");
		expect(defaultSubmapLabel(undefined, "The Drift", 2, 7, { terrain: "ocean world" })).toBe("Ocean world 2, 7");
		expect(defaultRegionName("Overworld", 3, 4, "Hollow Mere", () => false)).toBe("Hollow Mere");
		expect(defaultRegionName("Overworld", 3, 4, undefined, () => false)).toBe("Overworld 3, 4");
	});
});

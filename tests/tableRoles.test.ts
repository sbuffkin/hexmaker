/**
 * Phase 3, T11: where a role's table comes from. The map's own Tables
 * win, inherited down the map tree; then the generator setup (World
 * types / a converted set); a table that's gone falls through.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { inheritedRoleTables, layeredSource, notesTableSource, fittingRoleTables, attrsForTerrain } from "../src/worldgen/tableSources";
import { notesLookup } from "../src/random-tables/resolve";
import { roleOdds, rollRole } from "../src/worldgen/tableRoles";
import { worldTypesSource } from "../src/space/worldTypesSource";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { SPACE_SECTOR_TERRAINS } from "../src/modules/space/presets";
import { tableNoteMarkdown } from "../src/space/spaceTables";
import { parseRandomTable } from "../src/random-tables/randomTable";
import { mulberry32 } from "../packages/hex-wfc/src/rng";

const tree: Record<string, { parent?: string; tables?: Record<string, string> }> = {
	root: { tables: { "sector-hexes": "t/Root sector.md", star: "t/Root stars.md" } },
	sector: { parent: "root", tables: { "sector-hexes": "t/Drift sector.md" } },
	system: { parent: "sector" },
	loopA: { parent: "loopB", tables: { star: "t/A.md" } },
	loopB: { parent: "loopA" },
};
const tablesOf = (m: string) => tree[m]?.tables;
const parentOf = (m: string) => tree[m]?.parent;

describe("map tables, inherited down the map tree", () => {
	it("a map's own table wins; the rest come from the nearest map above", () => {
		expect(inheritedRoleTables("system", tablesOf, parentOf)).toEqual({
			"sector-hexes": { link: "t/Drift sector.md", from: "sector" },
			star: { link: "t/Root stars.md", from: "root" },
		});
		expect(inheritedRoleTables("root", tablesOf, parentOf)["sector-hexes"]).toEqual({ link: "t/Root sector.md", from: "root" });
	});

	it("nothing set anywhere: nothing (and a parent loop stops)", () => {
		expect(inheritedRoleTables("unknown", tablesOf, parentOf)).toEqual({});
		expect(inheritedRoleTables("loopB", tablesOf, parentOf)).toEqual({ star: { link: "t/A.md", from: "loopA" } });
	});
});

const one = (name: string, weight = 1) => tableNoteMarkdown({ title: "x", description: "x", rows: "terrain", terrainTypes: ["world"], columns: [], entries: [{ result: name, weight }] });

describe("precedence: map → generator setup → equal odds", () => {
	const notes = notesLookup({ "t/Only gardens.md": one("garden world"), "t/Other.md": one("ice world") });
	const terrains = SPACE_SECTOR_TERRAINS.map((t) => t.name);
	const worlds = SPACE_SECTOR_TERRAINS.filter((t) => t.type === "world").map((t) => t.name);
	const base = worldTypesSource({ name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS }, SPACE_SECTOR_TERRAINS);

	it("the map's table replaces the setup's for that role only", () => {
		const src = layeredSource(base, { "sector-hexes": "t/Only gardens.md" }, notes, terrains)!;
		expect(roleOdds(src, "sector-hexes", {}, worlds).odds).toEqual([{ terrain: "garden world", odds: 1 }]);
		expect(src.tableFor("star")).toBe(base.tableFor("star"));
		const pick = rollRole(src, "sector-hexes", { rand: mulberry32(1) }, worlds);
		expect(pick?.terrain).toBe("garden world");
	});

	it("no map tables: the setup's source as it is", () => {
		expect(layeredSource(base, {}, notes, terrains)).toBe(base);
	});

	it("a map table that's gone falls through to the setup's, and says so", () => {
		const src = layeredSource(base, { "sector-hexes": "t/Deleted.md" }, notes, terrains)!;
		expect(src.tableFor("sector-hexes")).toBe(base.tableFor("sector-hexes"));
		expect(roleOdds(src, "sector-hexes", {}, worlds).notes.join(" ")).toMatch(/isn't there/);
	});

	it("no setup and no map table: equal odds", () => {
		expect(layeredSource(undefined, {}, notes, terrains)).toBeUndefined();
		const odds = roleOdds(undefined, "sector-hexes", {}, ["a", "b"]);
		expect(odds.from).toBe("equal odds");
	});

	it("a map table with no setup under it still rolls", () => {
		const src = layeredSource(undefined, { "sector-hexes": "t/Other.md" }, notes, terrains)!;
		expect(roleOdds(src, "sector-hexes", {}, worlds).odds).toEqual([{ terrain: "ice world", odds: 1 }]);
	});

	it("finds a terrain's row (its map setup) in any role's table", () => {
		const src = notesTableSource({ "inner-orbits": "t/Setup.md" }, notesLookup({
			"t/Setup.md": tableNoteMarkdown({ title: "x", description: "x", rows: "terrain", columns: ["Size"], entries: [{ result: "lava world", weight: 1, cells: { Size: "9×9" } }] }),
		}), ["lava world"], "t");
		expect(attrsForTerrain(src, "lava world")).toEqual({ Size: "9×9" });
		expect(attrsForTerrain(src, "ice world")).toBeUndefined();
	});
});

describe("the role table picker (T11, §2.5)", () => {
	it("lists tables whose rows fit the role, the space folder first; rows: any tables are left out", () => {
		const t = (fm: string) => parseRandomTable(`---\ndice: 0\n${fm}---\n| Result | Weight |\n| --- | --- |\n| a | 1 |\n`);
		const tables = [
			{ path: "w/t/zz/Gardens.md", table: t("rows: terrain\nterrain-type: world\n") },
			{ path: "w/t/space/Set/Sector/Charted sector.md", table: t("rows: terrain\nterrain-type: world, station\n") },
			{ path: "w/t/Encounters.md", table: t("") },
			{ path: "w/t/space/Set/System/Stars.md", table: t("rows: terrain\nterrain-type: star\n") },
			{ path: "w/t/Names.md", table: t("rows: text\n") },
		];
		expect(fittingRoleTables(tables, "sector-hexes", "w/t/space")).toEqual(["w/t/space/Set/Sector/Charted sector.md", "w/t/zz/Gardens.md"]);
		expect(fittingRoleTables(tables, "star", "w/t/space")).toEqual(["w/t/space/Set/System/Stars.md"]);
	});
});

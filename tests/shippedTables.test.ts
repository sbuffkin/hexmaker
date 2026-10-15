/**
 * Phase 6 (plan-tables-everywhere): shipped tables are module data, not
 * code. The starter weather and rumours tables moved out of
 * src/regionTables.ts into the World module's tables/ folder; Orbits'
 * Moons and System extras tables ship with the Space module. Installing
 * them never writes over a note that's there, and writes nothing when every
 * one is there.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { registry } from "../src/modules";
import { parseRandomTableWithReport, rowOdds, resolveTable } from "../src/random-tables/randomTable";
import { shippedTablesToInstall } from "../src/random-tables/shippedTables";
import { makeTableTemplate } from "../src/utils";
import { ENGINE_ROLES } from "../src/worldgen/tableRoles";
import { readSurface } from "./helpers/source";

// Frozen copies of the rows that were code constants (STARTER_WEATHER / STARTER_RUMORS, now deleted).
const OLD_WEATHER: [string, number][] = [
	["Clear and calm", 4], ["Overcast, cool", 3], ["Light rain", 3], ["Fog until midday", 2], ["Strong wind", 2],
	["Heavy rain; travel slowed", 2], ["Thunderstorm", 1], ["Unseasonal heat or cold", 1], ["Strange weather (magical or ill-omened)", 1],
];
const OLD_RUMORS: [string, number][] = [
	["A traveller went missing on the road nearby", 1], ["Strange lights were seen in the hills at night", 1],
	["A merchant pays well for an escort", 1], ["Bandits have been seen near the river crossing", 1],
	["An old ruin was uncovered by a landslide", 1], ["A local noble is looking for a lost heirloom", 1],
	["Wolves (or worse) are taking livestock", 1], ["A hermit claims to know a secret way through", 1],
];
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const shipped = (path: string) => registry.shippedTables().find((t) => t.path === path)!;

describe("starter weather and rumours: data in the World module", () => {
	for (const [path, type, rows] of [["weather.md", "weather", OLD_WEATHER], ["rumors.md", "rumors", OLD_RUMORS]] as const) {
		it(`${path}: the same note a default vault was given before, so the same odds`, () => {
			const t = shipped(path);
			expect(t.module).toBe("world");
			// What ensureTerrainTables wrote with the default d100: the vault's copies are adopted as they are.
			const before = makeTableTemplate(100, { "table-type": type, "roll-filter": false, "encounter-filter": false }, "```duckmage-roller\n```", rows);
			expect(lf(t.text)).toBe(before);
			const { table, issues } = parseRandomTableWithReport(t.text);
			expect(issues).toEqual([]);
			expect(table.entries.map((e) => [e.result, e.weight])).toEqual(rows);
			// Readable: every row shows its roll range, and the ranges are what's rolled.
			expect(table.entries.every((e) => e.range)).toBe(true);
			expect(resolveTable(table).mode).toBe("ranges");
		});
	}

	it("no row constants are left in the code", () => {
		const code = readFileSync("src/regionTables.ts", "utf8") + readSurface("plugin");
		expect(code).not.toMatch(/STARTER_WEATHER|STARTER_RUMORS|Clear and calm|went missing on the road/);
	});

	it("only a world vault gets them; a space-only vault gets Orbits' tables and no fantasy ones", () => {
		expect(registry.shippedTables(["world"]).map((t) => t.path)).toEqual(["weather.md", "rumors.md"]);
		expect(registry.shippedTables(["space"]).map((t) => t.path)).toEqual(["space/Orbits/Moons.md", "space/Orbits/Gas giant moons.md", "space/Orbits/System extras.md"]);
	});
});

describe("Orbits' shipped tables read cleanly", () => {
	for (const t of registry.shippedTables(["space"])) {
		it(t.path, () => {
			const { table, issues } = parseRandomTableWithReport(t.text);
			expect(issues).toEqual([]);
			expect(table.entries.length).toBeGreaterThan(1);
			// A die table's ranges match its weights exactly (what you see is what you roll).
			if (table.dice > 0) {
				const total = table.entries.reduce((s, e) => s + e.weight, 0);
				expect(total).toBe(table.dice);
				expect(rowOdds(table)).toEqual(table.entries.map((e) => `${Math.round((100 * e.weight) / total)}%`));
			}
		});
	}

	it("every role's default table is one its module ships", () => {
		for (const r of ENGINE_ROLES.filter((x) => x.defaultTable)) {
			expect(registry.shippedTables().some((t) => t.path === r.defaultTable)).toBe(true);
		}
	});
});

describe("installing shipped tables", () => {
	const tables = registry.shippedTables();

	it("writes the missing ones under the tables folder", () => {
		const plan = shippedTablesToInstall(tables, "world/tables", () => false);
		expect(plan.map((t) => t.path)).toEqual(tables.map((t) => `world/tables/${t.path}`));
		expect(shippedTablesToInstall(tables, "", () => false)[0].path).toBe("weather.md");
	});

	it("never writes over a note that's there (an edited copy wins)", () => {
		const plan = shippedTablesToInstall(tables, "world/tables", (p) => p === "world/tables/weather.md");
		expect(plan.map((t) => t.path)).not.toContain("world/tables/weather.md");
		expect(plan).toHaveLength(tables.length - 1);
	});

	it("writes nothing when every one is there (a restart changes nothing, smoke C5)", () => {
		expect(shippedTablesToInstall(tables, "world/tables", () => true)).toEqual([]);
	});
});

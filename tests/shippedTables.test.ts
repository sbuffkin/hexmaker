/**
 * Phase 6 (plan-tables-everywhere): shipped tables are module data, not
 * code. The starter weather and rumours tables moved out of
 * src/regionTables.ts into the World module's tables/ folder (owner T1:
 * weather is one word a row, rumours ship empty); Orbits'
 * Moons and System extras tables ship with the Space module. Installing
 * them never writes over a note that's there, and writes nothing when every
 * one is there.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { registry } from "../src/modules";
import { parseRandomTableWithReport, rowOdds, resolveTable } from "../src/random-tables/randomTable";
import { shippedTablesToInstall } from "../src/random-tables/shippedTables";
import { makeTableTemplate } from "../src/utils";
import { ENGINE_ROLES } from "../src/worldgen/tableRoles";
import { tableIsEmpty } from "../src/random-tables/emptyTable";
import { readSurface, readSource } from "./helpers/source";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const shipped = (path: string) => registry.shippedTables().find((t) => t.path === path)!;
const FM = (type: string) => ({ "table-type": type, "roll-filter": false, "encounter-filter": false });
const ROLLER = "```duckmage-roller\n```";

// Owner T1 (2026-10-16): no starter rumours; the starter weather is one word a row.
const WEATHER: [string, number][] = [["Sunny", 5], ["Cloudy", 4], ["Rainy", 4], ["Windy", 3], ["Foggy", 2], ["Stormy", 1], ["Snowy", 1]];

describe("starter weather and rumours: data in the World module", () => {
	it("weather.md: one-word results on a d20, every roll range exact", () => {
		const t = shipped("weather.md");
		expect(t.module).toBe("world");
		expect(lf(t.text)).toBe(makeTableTemplate(20, FM("weather"), ROLLER, WEATHER));
		const { table, issues } = parseRandomTableWithReport(t.text);
		expect(issues).toEqual([]);
		expect(table.entries.map((e) => [e.result, e.weight])).toEqual(WEATHER);
		expect(table.entries.every((e) => !/\s/.test(e.result))).toBe(true);
		expect(table.entries.reduce((s, e) => s + e.weight, 0)).toBe(table.dice);
		expect(table.entries.every((e) => e.range)).toBe(true);
		expect(resolveTable(table).mode).toBe("ranges");
	});

	it("rumors.md ships empty, like the terrain tables (Roll off, Add entries)", () => {
		const t = shipped("rumors.md");
		expect(t.module).toBe("world");
		// The same empty note a terrain table starts as.
		expect(lf(t.text)).toBe(makeTableTemplate(100, FM("rumors"), ROLLER));
		expect(parseRandomTableWithReport(t.text).table.entries).toEqual([]);
		expect(tableIsEmpty(t.text)).toBe(true);
	});

	it("no row constants are left in the code", () => {
		const code = readSource("src/regionTables.ts") + readSurface("plugin");
		expect(code).not.toMatch(/STARTER_WEATHER|STARTER_RUMORS|Clear and calm|went missing on the road/);
	});

	it("a vault's own weather and rumours tables are never rewritten (only missing ones are written)", () => {
		const plan = shippedTablesToInstall(registry.shippedTables(["world"]), "world/tables", (p) => p === "world/tables/weather.md" || p === "world/tables/rumors.md");
		expect(plan).toEqual([]);
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

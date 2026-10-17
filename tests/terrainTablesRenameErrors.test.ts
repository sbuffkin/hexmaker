/**
 * A renamed terrain's tables that can't follow it (P2 cleanup): the failure
 * is logged with the plugin's prefix and said in a notice, instead of being
 * swallowed. Tables that could move still move.
 */
import { afterEach, describe, it } from "node:test";
import expect from "expect";
import { Notice } from "./__mocks__/obsidian"; // the mock: Notice.shown records every notice
import { MemVault } from "./helpers/memVault";
import { TerrainTablesService, renameTablesFailedText } from "../src/services/TerrainTablesService";
import type { TerrainColor } from "../src/types";

function capture<T>(fn: () => Promise<T>): Promise<{ said: unknown[][]; out: T }> {
	const orig = console.error;
	const said: unknown[][] = [];
	console.error = (...a: unknown[]) => said.push(a);
	return fn().then((out) => ({ said, out })).finally(() => { console.error = orig; });
}

function setup(failMove: (from: string) => boolean) {
	const vault = new MemVault({
		"world/tables/terrain/description/forest.md": "---\ntable-type: description\n---\n| Result | Weight |\n",
		"world/tables/terrain/encounters/forest.md": "---\ntable-type: encounters\n---\n| Result | Weight |\n",
	});
	const app = vault.app();
	const realRename = app.fileManager.renameFile;
	app.fileManager.renameFile = async (f, to) => {
		if (failMove(f.path)) throw new Error("locked");
		await realRename(f, to);
	};
	const entry: TerrainColor = { name: "forest", color: "#228822" } as TerrainColor;
	const plugin = {
		app,
		settings: { tablesFolder: "world/tables", terrainPalettes: [{ name: "Default", terrains: [entry] }] },
		renameTerrainInHexes: async () => new Map(),
		ensureRollerLink: async () => {},
		saveSettings: async () => {},
		refreshHexMapWithOverrides: () => {},
		refreshHexTableTerrainRename: () => {},
	};
	return { vault, entry, service: new TerrainTablesService(plugin as never) };
}

describe("terrain rename: tables that can't follow", () => {
	afterEach(() => { Notice.shown.length = 0; });

	it("logs each failed move with the Hexmaker prefix and shows one notice; the others still move", async () => {
		const { vault, entry, service } = setup((p) => p.includes("/encounters/"));
		const { said } = await capture(() => service.renameTerrain(entry, "woods"));
		expect(vault.files.has("world/tables/terrain/description/woods.md")).toBe(true);
		expect(vault.files.has("world/tables/terrain/encounters/forest.md")).toBe(true);
		expect(said.length).toBe(1);
		expect(String(said[0][0])).toMatch(/^Hexmaker: couldn't move world\/tables\/terrain\/encounters\/forest\.md/);
		expect(Notice.shown.map((n) => n.msg)).toEqual([renameTablesFailedText("forest", "woods", ["world/tables/terrain/encounters/forest.md"])]);
		expect(entry.name).toBe("woods");
	});

	it("says nothing when every table moves", async () => {
		const { entry, service } = setup(() => false);
		const { said } = await capture(() => service.renameTerrain(entry, "woods"));
		expect(said).toEqual([]);
		expect(Notice.shown).toEqual([]);
	});

	it("the notice names the old name and every table left behind", () => {
		expect(renameTablesFailedText("forest", "woods", ["a.md"])).toBe(`Renamed "forest" to "woods", but couldn't move or copy its table a.md: it's still under the old name.`);
		expect(renameTablesFailedText("forest", "woods", ["a.md", "b.md"])).toMatch(/its tables a\.md, b\.md: they're still under the old name\.$/);
	});
});

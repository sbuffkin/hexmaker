import { describe, it } from "node:test";
import expect from "expect";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { MapStore } from "../src/maps/MapStore";
import { PaletteStore } from "../src/palettes/PaletteStore";
import { runNoteFormatUpgrades } from "../src/migrations/registry";
import type { NoteFormatHost } from "../src/migrations/noteRewrites";
import { upgradeTableRangesOnce } from "../src/migrations/v1.5-table-roll-ranges";
import { migrateMapData } from "../src/compat";
import { DEFAULT_SETTINGS, DEFAULT_PALETTE_NAME } from "../src/constants";
import { MemVault } from "./helpers/memVault";
import type { HexmakerPluginSettings, MapData } from "../src/types";

/**
 * Golden test for the upgrade from 1.5.6 (owner MG7: the migrations moved
 * into src/migrations with no change in what they write). A small 1.5.6
 * vault goes through every start-up upgrade, in start-up order (palettes,
 * then map notes, then note formats, then table roll ranges), and the
 * whole result is compared with tests/fixtures/migrations/golden-1.5.6.json:
 * every note, every backup (unzipped), and the settings.
 *
 * Dates are replaced by placeholders. To accept an intended change run
 * with UPDATE_GOLDEN=1 and review the fixture's diff.
 */

(globalThis as Record<string, unknown>).window ??= globalThis;

const FIX = path.join(process.cwd(), "tests", "fixtures");
const GOLDEN = path.join(FIX, "migrations", "golden-1.5.6.json");
const read = (p: string) => fs.readFileSync(path.join(FIX, p), "utf8").replace(/\r\n/g, "\n");

const HEX = (fm: string, body = "# Hex\n\n### Description\nA ruined tower.\n") => `---\n${fm}\n---\n${body}`;

/** A vault as 1.5.6 left it: map data in hex-note frontmatter, palettes only in data.json. */
function vault156(): MemVault {
	return new MemVault({
		"world/hexes/coast/1_2.md": HEX("terrain: ocean\ntags: [sea]"),
		"world/hexes/coast/3_4.md": HEX("terrain: forest\nicon: castle.png\ngm-icons:\n  - skull.png\nregion: Basin\nduckmage-submap: coast-3-4\nlocked: true"),
		"world/hexes/coast/0_0.md": HEX("gm-icon: trap.png"),
		"world/hexes/coast/0_1.md": read("compat/note-formats/hex-note-1.5.6.md"),
		"world/hexes/coast/5_5.md": "# No frontmatter at all\n",
		"world/hexes/coast-3-4/0_0.md": HEX("terrain: hills"),
		"world/tokens/Ana the smith.md": read("compat/note-formats/token-note-1.5.6.md"),
		"world/workflows/npc.md": read("compat/note-formats/workflow-1.5.6.md"),
		"world/workflows/templates/npc.md": "## name\n$name\n",
		"world/tables/beach.md": read("compat/legacy-table-1.5.6.md"),
		"world/tables/plain.md": "---\ndice: 6\n---\n\n| Result | Weight |\n|---|---|\n| a | 1 |\n| b | 1 |\n| c | 1 |\n",
	});
}

function settings156(): HexmakerPluginSettings {
	const d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HexmakerPluginSettings;
	const maps = [
		{ name: "coast", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, roadChains: [["1_2", "2_2", "3_2"]], riverChains: [["0_0"], ["4_4", "4_5"]] },
		{ name: "coast-3-4", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, parent: { map: "coast", hex: "3_4" } },
	].map((m) => migrateMapData(m, DEFAULT_PALETTE_NAME));
	return {
		...d,
		worldFolder: "world",
		hexFolder: "world/hexes",
		tablesFolder: "world/tables",
		workflowsFolder: "world/workflows",
		maps,
		palettesMigrated: false,
		terrainPalettes: [
			{ name: "Default", terrains: [{ name: "ocean", color: "#14223d" }, { name: "forest", color: "#2d5a27" }, { name: "hills", color: "#8a7f5a" }] },
		],
	} as HexmakerPluginSettings;
}

const DATE = /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?/g;
const scrub = (s: string) => s.replace(DATE, (m) => (m.length > 10 ? "<time>" : "<date>"));

async function upgrade(): Promise<Record<string, unknown>> {
	const vault = vault156();
	const settings = settings156();
	const app = vault.app() as unknown as Record<string, unknown> & { fileManager: Record<string, unknown> };
	app.fileManager.trashFile = async (f: { path: string }) => { vault.files.delete(f.path); };
	const plugin: Record<string, unknown> = {
		app,
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings,
		getMap: (n: string) => settings.maps.find((m: MapData) => m.name === n),
		saveData: async () => {},
		saveSettings: async () => {},
		refreshHexMap: () => {},
		refreshPaletteEditors: () => {},
		ensureTablesForNewTerrains: async () => {},
		getPaletteByName: (name: string) => settings.terrainPalettes.find((p) => p.name === name),
	};
	const palettes = new PaletteStore(plugin as never);
	plugin.paletteStore = palettes;
	const maps = new MapStore(plugin as never);
	plugin.mapStore = maps;
	await palettes.init();
	await maps.init();
	const host: NoteFormatHost = {
		app: app as never,
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings,
		mapStore: maps,
		paletteStore: palettes,
		hexMapDataView: (map, x, y) => {
			const h = maps.get(map, `${x}_${y}`);
			return { map, mapLabel: map, x, y, terrain: h?.terrain, region: h?.region, name: h?.name };
		},
		saveSettings: async () => {},
	};
	await runNoteFormatUpgrades(host);
	await upgradeTableRangesOnce({ app: app as never, manifest: { dir: ".obsidian/plugins/hexmaker" }, settings, saveSettings: async () => {} });

	const files: Record<string, string> = {};
	for (const p of [...vault.files.keys()].sort()) files[scrub(p)] = scrub(vault.files.get(p)!);
	const backups: Record<string, unknown> = {};
	for (const p of [...vault.binaries.keys()].sort()) {
		backups[scrub(p)] = JSON.parse(scrub(gunzipSync(vault.binaries.get(p)!).toString("utf8")));
	}
	const { savedWith: _sw, ...rest } = settings as HexmakerPluginSettings & { savedWith?: string };
	return { files, backups, settings: JSON.parse(scrub(JSON.stringify(rest))) };
}

describe("migration golden: a 1.5.6 vault upgrades to exactly the recorded result", () => {
	it("matches tests/fixtures/migrations/golden-1.5.6.json", async () => {
		const got = await upgrade();
		if (process.env.UPDATE_GOLDEN === "1" || !fs.existsSync(GOLDEN)) {
			fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
			fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
		}
		const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
		expect(got).toEqual(want);
	});

	it("is the same on a second run (deterministic)", async () => {
		expect(await upgrade()).toEqual(await upgrade());
	});
});

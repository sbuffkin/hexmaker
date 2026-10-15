/**
 * Duplicate map names in a 1.5.x data.json (fresh-eyes 2026-10-13, F11 /
 * the seed's two "asdf" entries), end to end through the real plugin's
 * load and the map-note migration.
 *
 * 1.5.6 looked every map up by name (getMap: first wins), and a map's hex
 * data lived in its hex notes, in one folder per name. So two entries with
 * one name were one map: the later entry was never read or written. The
 * upgrade must keep everything the first entry and the shared hex notes
 * hold, write one map note, keep the later entry in data.json as it was
 * (a downgrade still reads it), and every list must count the map once.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import * as obsidian from "obsidian";
import { MemVault } from "../helpers/memVault";
import { parseMapNote } from "../../src/maps/mapNote";
import { uniqueMapsByName } from "../../src/maps/mapTree";
import type { MapData } from "../../src/types";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;

const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const ASDF = "world/hexes/asdf/_asdf.md";

function wireDataJson(v: MemVault): void {
	const proto = (mock.Plugin as { prototype: Record<string, unknown> }).prototype;
	proto.loadData = async function () {
		const text = v.files.get(DATA);
		return text === undefined ? null : JSON.parse(text);
	};
	proto.saveData = async function (data: unknown) {
		v.files.set(DATA, JSON.stringify(data, null, 2));
	};
}

const FIRST_CHAINS = [{ typeName: "Road", hexes: ["1_1", "2_1", "3_1"] }];

/** The seed's shape: the first "asdf" has a road and a viewport, the second nothing of its own. */
function data156() {
	return {
		hexFolder: "world/hexes",
		hexOrientation: "flat",
		savedWith: "1.5.6",
		setupComplete: true,
		maps: [
			{ name: "coast", paletteName: "Default", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [] },
			{ name: "asdf", paletteName: "Default", gridSize: { cols: 20, rows: 16 }, gridOffset: { x: 0, y: 0 }, pathChains: FIRST_CHAINS, savedViewport: { scrollLeft: 10, scrollTop: 20, zoom: 1 } },
			{ name: "asdf", paletteName: "Default", gridSize: { cols: 20, rows: 16 }, gridOffset: { x: 0, y: 0 }, pathChains: [] },
		],
	};
}

const hexNote = (terrain: string, prose: string) => `---\nterrain: ${terrain}\n---\n\n### Description\n\n${prose}\n`;

async function boot() {
	const v = new MemVault({
		[DATA]: JSON.stringify(data156(), null, 2),
		"world/hexes/asdf/1_1.md": hexNote("grass", "A meadow."),
		"world/hexes/asdf/2_1.md": hexNote("forest", "Old trees."),
		"world/hexes/asdf/3_1.md": hexNote("hills", "Rolling hills."),
		"world/hexes/coast/0_0.md": hexNote("ocean", "Waves."),
	});
	wireDataJson(v);
	const app = {
		...v.app(),
		workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn() },
	};
	(app.vault as Record<string, unknown>).on = () => ({});
	(app.metadataCache as Record<string, unknown>).on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const plugin = new HexmakerPlugin(app as never, { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" } as never) as unknown as {
		settings: { maps: MapData[] };
		getMap(name: string): MapData | undefined;
		loadSettings(): Promise<void>;
		saveSettings(): Promise<void>;
		paletteStore: { init(): Promise<void> };
		mapStore: { init(): Promise<void>; flush(): Promise<void>; all(name: string): Map<string, { terrain?: string }> };
	} & Record<string, unknown>;
	plugin.app = app;
	plugin.manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
	plugin.refreshHexMap = () => {};
	plugin.loadAvailableIcons = () => {};
	plugin.ensureTablesForNewTerrains = async () => {};
	await plugin.loadSettings();
	await plugin.paletteStore.init();
	await plugin.mapStore.init();
	await plugin.saveSettings();
	await plugin.mapStore.flush();
	return { v, plugin };
}

describe("duplicate map names from 1.5.x: nothing lost, counted once (real plugin)", () => {
	beforeEach(() => { (obsidian.Notice as unknown as { shown: unknown[] }).shown = []; });

	it("one map note holds every hex of the shared folder and the first entry's road", async () => {
		const { v, plugin } = await boot();
		const note = parseMapNote(v.files.get(ASDF)!)!;
		expect(note).not.toBeNull();
		expect([...note.hexes].map(([k, h]) => `${k}:${h.terrain}`).sort()).toEqual(["1_1:grass", "2_1:forest", "3_1:hills"]);
		expect(note.paths).toHaveLength(1);
		expect(plugin.mapStore.all("asdf").size).toBe(3);
		// The note's path draws the old road's three hexes.
		const anchors = note.paths[0].branches.flatMap((b) => b.anchors);
		expect(anchors[0]).toBe("1_1");
		expect(anchors[anchors.length - 1]).toBe("3_1");
	});

	it("the backup is the first entry's data (the one 1.5.6 used), not overwritten by the second", async () => {
		const { v } = await boot();
		const backups = [...v.files.keys()].filter((p) => /backups\/map-notes-[^/]+\/asdf\.json$/.test(p));
		expect(backups).toHaveLength(1);
		const b = JSON.parse(v.files.get(backups[0])!) as { hexes: [string, unknown][]; pathChains: unknown[] };
		expect(b.pathChains).toEqual(FIRST_CHAINS);
		expect(b.hexes.map(([k]) => k).sort()).toEqual(["1_1", "2_1", "3_1"]);
	});

	it("hex notes keep their prose", async () => {
		const { v } = await boot();
		expect(v.files.get("world/hexes/asdf/2_1.md")).toContain("Old trees.");
	});

	it("data.json keeps both entries as written (a downgrade reads them as before), lists count the map once", async () => {
		const { v, plugin } = await boot();
		const disk = (JSON.parse(v.files.get(DATA)!) as { maps: { name: string }[] }).maps.map((m) => m.name);
		expect(disk).toEqual(["coast", "asdf", "asdf"]);
		expect(uniqueMapsByName(plugin.settings.maps).map((m) => m.name)).toEqual(["coast", "asdf"]);
		expect(plugin.getMap("asdf")!.savedViewport).toBeDefined();
		const shown = (obsidian.Notice as unknown as { shown: { msg: string }[] }).shown.map((n) => n.msg);
		expect(shown.some((m) => m.includes("map data for 2 maps"))).toBe(true);
	});
});

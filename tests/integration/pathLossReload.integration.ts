/**
 * Issue #47 / incident 2026-10-10, end to end through the real plugin class:
 * HexmakerPlugin.saveSettings (data.json without the notes' paths),
 * onExternalSettingsChange (echo filter, loadSettings, reloadFromNotes) and
 * MapStore's note writes, with a neighbour map dirty (its world slot just
 * changed) while a data.json reload lands in the middle of a save burst.
 *
 * The unit tests (tests/pathLossReload.test.ts) drive MapStore with a
 * simulated reload; this one runs the plugin's own load / save / reload
 * code against an in-memory vault, so a change to any link in that chain
 * that brings the loss back fails here.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import * as obsidian from "obsidian";
import { MemVault } from "../helpers/memVault";
import { parseMapNote } from "../../src/maps/mapNote";
import type { MapData, MapPath } from "../../src/types";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;

// The unit-test obsidian mock lacks the UI base classes the plugin module's
// views extend; stubs are enough here (no view is ever opened).
// The module object itself (an import namespace may be a copy).
const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const COAST = "world/hexes/coast/_coast.md";
const NORTH = "world/hexes/north/_north.md";

/** Obsidian's Plugin.loadData / saveData, against data.json in the in-memory vault. */
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

function initialData() {
	return {
		hexFolder: "world/hexes",
		hexOrientation: "flat",
		featureLevel: "advanced",
		installedAt: "2026-01-01",
		expandedByDefault: false,
		defaultPalette: "Default",
		maps: [
			{ name: "coast", paletteName: "Default", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["1_2", "2_2", "3_2"] }, { typeName: "River", hexes: ["5_0", "5_1", "5_2", "5_3"] }] },
			{ name: "north", paletteName: "Default", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["0_0", "1_0", "2_0"] }] },
		],
	};
}

interface Booted {
	v: MemVault;
	plugin: {
		settings: { maps: MapData[]; dismissedHints?: string[] };
		getMap(name: string): MapData | undefined;
		loadSettings(): Promise<void>;
		saveSettings(): Promise<void>;
		onExternalSettingsChange(): Promise<void>;
		paletteStore: { init(): Promise<void> };
		mapStore: { init(): Promise<void>; flush(): Promise<void>; sync(): Promise<void>; holdsPaths(name: string): boolean; paths(name: string): readonly MapPath[] };
	};
}

async function boot(): Promise<Booted> {
	const v = new MemVault();
	v.files.set(DATA, JSON.stringify(initialData(), null, 2));
	wireDataJson(v);
	const app = {
		...v.app(),
		workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn() },
	};
	(app.vault as Record<string, unknown>).on = () => ({});
	(app.metadataCache as Record<string, unknown>).on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const plugin = new HexmakerPlugin(app as never, { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" } as never) as unknown as Booted["plugin"] & Record<string, unknown>;
	plugin.app = app;
	plugin.manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
	// Nothing to show in a test (no views, no icons).
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

const notePaths = (v: MemVault, path: string): MapPath[] => parseMapNote(v.files.get(path)!)!.paths;
const diskMaps = (v: MemVault): Record<string, unknown>[] => (JSON.parse(v.files.get(DATA)!) as { maps: Record<string, unknown>[] }).maps;
const settle = async (b: Booted) => {
	await b.plugin.mapStore.flush();
	await new Promise((r) => setTimeout(r, 0));
	await b.plugin.mapStore.flush();
};

describe("#47: a data.json reload mid-save-burst keeps every map's paths (real plugin)", () => {
	beforeEach(() => { (obsidian.Notice as unknown as { shown: unknown[] }).shown = []; });

	it("setup: the notes hold the paths (format 5) and data.json doesn't", async () => {
		const { v, plugin } = await boot();
		expect(notePaths(v, COAST)).toHaveLength(2);
		expect(notePaths(v, NORTH)).toHaveLength(1);
		expect(plugin.mapStore.holdsPaths("coast")).toBe(true);
		for (const m of diskMaps(v)) {
			expect(m.paths).toBeUndefined();
			expect(m.pathChains).toBeUndefined();
		}
	});

	it("an outside data.json change lands mid-burst while the neighbour map is dirty: notes and memory keep every path", async () => {
		const b = await boot();
		const { v, plugin } = b;
		const coastBefore = JSON.stringify(plugin.getMap("coast")!.paths);
		const northBefore = JSON.stringify(plugin.getMap("north")!.paths);
		// A new region was placed next to coast: its world slot changed, so its note write is queued.
		plugin.getMap("coast")!.world = { id: "w1", cx: 0, cy: 0 };
		const maps = plugin.settings.maps;
		let loads = 0;
		const load = plugin.loadSettings.bind(plugin);
		plugin.loadSettings = async () => { loads++; await load(); };
		const burst: Promise<void>[] = [plugin.saveSettings(), plugin.saveSettings()];
		// Another device (or a hand edit) changes data.json: not one of our own writes.
		const disk = JSON.parse(v.files.get(DATA)!) as { dismissedHints?: string[] };
		disk.dismissedHints = [...(disk.dismissedHints ?? []), "from-elsewhere"];
		v.files.set(DATA, JSON.stringify(disk, null, 2));
		burst.push(plugin.onExternalSettingsChange());
		// The burst goes on while the reload is in flight.
		burst.push(plugin.saveSettings(), plugin.mapStore.sync(), plugin.saveSettings());
		await Promise.all(burst);
		await settle(b);
		// The reload really happened: fresh map objects from data.json, which holds no paths…
		expect(loads).toBe(1);
		expect(plugin.settings.maps).not.toBe(maps);
		expect(plugin.getMap("coast")).not.toBe(maps[0]);
		// …and no map lost a path, in its note or in memory.
		expect(notePaths(v, COAST)).toHaveLength(2);
		expect(notePaths(v, NORTH)).toHaveLength(1);
		expect(JSON.stringify(plugin.getMap("coast")!.paths)).toBe(coastBefore);
		expect(JSON.stringify(plugin.getMap("north")!.paths)).toBe(northBefore);
		expect(plugin.mapStore.paths("coast")).toHaveLength(2);
		// The write guard never had to step in.
		expect((obsidian.Notice as unknown as { shown: { msg: string }[] }).shown.filter((n) => n.msg.includes("would have removed"))).toEqual([]);
	});

	it("the same, with our own save echoed back as an external change (echo filter bypassed): nothing is lost", async () => {
		const b = await boot();
		const { v, plugin } = b;
		const before = [JSON.stringify(plugin.getMap("coast")!.paths), JSON.stringify(plugin.getMap("north")!.paths)];
		plugin.getMap("north")!.world = { id: "w2", cx: 1, cy: 0 };
		const p = plugin as unknown as { isOwnWrite: (d: unknown) => boolean };
		const own = p.isOwnWrite;
		p.isOwnWrite = () => false; // as if Obsidian's watcher missed that the write was ours
		try {
			const burst: Promise<void>[] = [plugin.saveSettings(), plugin.onExternalSettingsChange(), plugin.saveSettings(), plugin.mapStore.sync()];
			await Promise.all(burst);
		} finally {
			p.isOwnWrite = own;
		}
		await settle(b);
		expect(notePaths(v, COAST)).toHaveLength(2);
		expect(notePaths(v, NORTH)).toHaveLength(1);
		expect([JSON.stringify(plugin.getMap("coast")!.paths), JSON.stringify(plugin.getMap("north")!.paths)]).toEqual(before);
	});

	it("our own save echoed back is ignored: the settings aren't reloaded at all", async () => {
		const { plugin } = await boot();
		let loads = 0;
		const load = plugin.loadSettings.bind(plugin);
		plugin.loadSettings = async () => { loads++; await load(); };
		await plugin.saveSettings();
		await plugin.onExternalSettingsChange();
		expect(loads).toBe(0);
	});

	it("after the burst, a fresh start reads the same paths back from the notes", async () => {
		const b = await boot();
		const { v, plugin } = b;
		plugin.getMap("coast")!.world = { id: "w3", cx: 0, cy: 0 };
		const disk = JSON.parse(v.files.get(DATA)!) as { dismissedHints?: string[] };
		disk.dismissedHints = ["x"];
		v.files.set(DATA, JSON.stringify(disk, null, 2));
		await Promise.all([plugin.saveSettings(), plugin.onExternalSettingsChange(), plugin.saveSettings()]);
		await settle(b);
		const expected = [JSON.stringify(plugin.getMap("coast")!.paths), JSON.stringify(plugin.getMap("north")!.paths)];
		// Restart: a new plugin instance on the same vault.
		const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
		const again = new HexmakerPlugin(plugin.app as never, plugin.manifest as never) as unknown as Booted["plugin"] & Record<string, unknown>;
		again.app = (plugin as unknown as Record<string, unknown>).app;
		again.manifest = (plugin as unknown as Record<string, unknown>).manifest;
		again.refreshHexMap = () => {};
		again.loadAvailableIcons = () => {};
		again.ensureTablesForNewTerrains = async () => {};
		await again.loadSettings();
		await again.paletteStore.init();
		await again.mapStore.init();
		expect([JSON.stringify(again.getMap("coast")!.paths), JSON.stringify(again.getMap("north")!.paths)]).toEqual(expected);
		expect(again.getMap("coast")!.world).toEqual({ id: "w3", cx: 0, cy: 0 });
	});
});

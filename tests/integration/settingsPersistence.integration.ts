/**
 * Characterisation of the plugin's settings persistence (loadSettings,
 * saveData, saveSettings, onExternalSettingsChange) through the real plugin
 * class against an in-memory vault, written before it moved out of
 * HexmakerPlugin (plan-architecture-refactor L1b) and kept as its guard:
 *
 * - loadSettings reads data.json ONCE, and nothing awaits between swapping
 *   in the new settings and handing their maps to the map store
 *   (mapStore.adoptAll; incident 2026-10-10);
 * - a fresh install writes data.json once on load (first-time choices), an
 *   existing vault whose data is unchanged writes nothing;
 * - saveData skips a write identical to data.json and stamps savedWith /
 *   dataFormat through saveSettings;
 * - our own save echoed back as an external change is ignored (no reload),
 *   an outside change reloads into fresh map objects.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { MemVault } from "../helpers/memVault";
import type { MapData } from "../../src/types";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
let loads = 0;
let writes = 0;

function wireDataJson(v: MemVault): void {
	const proto = (mock.Plugin as { prototype: Record<string, unknown> }).prototype;
	proto.loadData = async function () {
		loads++;
		const text = v.files.get(DATA);
		return text === undefined ? null : JSON.parse(text);
	};
	proto.saveData = async function (data: unknown) {
		writes++;
		v.files.set(DATA, JSON.stringify(data, null, 2));
	};
}

const existing = () => ({
	hexFolder: "world/hexes",
	hexOrientation: "flat",
	expandedByDefault: false,
	defaultPalette: "Default",
	kindContent: ["world"],
	setupComplete: true,
	maps: [{ name: "coast", paletteName: "Default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, pathChains: [] }],
});

type Plugin = {
	settings: Record<string, unknown> & { maps: MapData[]; hiddenIcons?: string[]; savedWith?: string; dataFormat?: number };
	loadSettings(): Promise<void>;
	saveSettings(): Promise<void>;
	saveData(data: unknown): Promise<void>;
	onExternalSettingsChange(): Promise<void>;
	getMap(name: string): MapData | undefined;
	mapStore: { adoptAll(): void; init(): Promise<void>; flush(): Promise<void> };
	paletteStore: { init(): Promise<void> };
};

async function make(v: MemVault): Promise<Plugin> {
	wireDataJson(v);
	const app = { ...v.app(), workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn() } };
	(app.vault as Record<string, unknown>).on = () => ({});
	(app.metadataCache as Record<string, unknown>).on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "9.9.9-test" };
	const plugin = new HexmakerPlugin(app as never, manifest as never) as unknown as Plugin & Record<string, unknown>;
	plugin.app = app;
	plugin.manifest = manifest;
	plugin.refreshHexMap = () => {};
	plugin.loadAvailableIcons = () => {};
	plugin.ensureTablesForNewTerrains = async () => {};
	return plugin;
}

describe("settings persistence (characterisation, L1b)", () => {
	beforeEach(() => { loads = 0; writes = 0; });

	it("loadSettings reads data.json once and hands the maps to the map store with no await in between", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify(existing()));
		const plugin = await make(v);
		// Watch the settings swap and the adoptAll call: no microtask may run between them.
		let swappedAt = -1;
		let tick = 0;
		let settings = plugin.settings;
		Object.defineProperty(plugin, "settings", {
			configurable: true,
			get: () => settings,
			set: (s) => { settings = s; swappedAt = tick; queueMicrotask(() => { tick++; }); },
		});
		const adoptAll = plugin.mapStore.adoptAll.bind(plugin.mapStore);
		const seen: { swappedAt: number; tick: number; maps: unknown }[] = [];
		plugin.mapStore.adoptAll = () => { seen.push({ swappedAt, tick, maps: settings.maps }); adoptAll(); };
		await plugin.loadSettings();
		expect(loads).toBe(1);
		expect(seen).toHaveLength(1);
		expect(seen[0].swappedAt).toBe(seen[0].tick);
		expect(seen[0].maps).toBe(settings.maps);
		expect(plugin.getMap("coast")?.paletteName).toBe("Default");
	});

	it("an existing vault with nothing new to record isn't written on load; a fresh install is, once", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify(existing()));
		await (await make(v)).loadSettings();
		expect(writes).toBe(0);
		const fresh = new MemVault();
		const plugin = await make(fresh);
		await plugin.loadSettings();
		expect(writes).toBe(1);
		const saved = JSON.parse(fresh.files.get(DATA)!) as Record<string, unknown>;
		expect(typeof saved.expandedByDefault).toBe("boolean");
		expect(typeof saved.defaultPalette).toBe("string");
		// The shipped placeholder map (DEFAULT_SETTINGS).
		expect(plugin.settings.maps.map((m) => m.name)).toEqual(["default"]);
	});

	it("saveData skips a write identical to data.json; saveSettings stamps the version and data format", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify(existing()));
		const plugin = await make(v);
		await plugin.loadSettings();
		await plugin.saveSettings();
		expect(writes).toBe(1);
		const saved = JSON.parse(v.files.get(DATA)!) as Record<string, unknown>;
		expect(saved.savedWith).toBe("9.9.9-test");
		expect(typeof saved.dataFormat).toBe("number");
		await plugin.saveSettings();
		await plugin.saveData(plugin.settings);
		expect(writes).toBe(1);
		plugin.settings.hiddenIcons = ["x"];
		await plugin.saveSettings();
		expect(writes).toBe(2);
	});

	it("our own save echoed back is ignored; an outside change reloads into fresh map objects", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify(existing()));
		const plugin = await make(v);
		await plugin.loadSettings();
		plugin.settings.hiddenIcons = ["mine"];
		await plugin.saveSettings();
		const before = plugin.settings;
		loads = 0;
		await plugin.onExternalSettingsChange();
		expect(loads).toBe(1); // read to compare, not reloaded
		expect(plugin.settings).toBe(before);
		// Another device's change: reloaded.
		const disk = JSON.parse(v.files.get(DATA)!) as Record<string, unknown>;
		disk.hiddenIcons = ["theirs"];
		v.files.set(DATA, JSON.stringify(disk));
		loads = 0;
		await plugin.onExternalSettingsChange();
		expect(loads).toBe(2); // the compare, then loadSettings' one read
		expect(plugin.settings).not.toBe(before);
		expect(plugin.settings.hiddenIcons).toEqual(["theirs"]);
		expect(plugin.getMap("coast")).not.toBe(before.maps[0]);
	});

	it("after an echo, data.json counts as written: saving the same again doesn't write", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify(existing()));
		const plugin = await make(v);
		await plugin.loadSettings();
		plugin.settings.hiddenIcons = ["a"];
		await plugin.saveSettings();
		await plugin.onExternalSettingsChange();
		const n = writes;
		await plugin.saveSettings();
		expect(writes).toBe(n);
	});
});

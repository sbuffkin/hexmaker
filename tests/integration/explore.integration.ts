/**
 * plan-hex-flower, end to end through the real plugin class: a map that
 * explores with a hex flower keeps its keys (explore-with, hex-flower-at,
 * explore-reveal) in its map note and data.json; a party step fills a
 * blank hex (map note written); a restart reads it all back and writes
 * nothing (no data.json write, no map note rewrite).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "../helpers/memVault";
import { parseMapNote } from "../../src/maps/mapNote";
import { buildFlowerNote } from "../../src/hexflower/flowerNote";
import { emptyFlower } from "../../src/hexflower/flower";
import { runPartyEntered } from "../../src/modules/runtime";
import type { MapData } from "../../src/types";
import { DEFAULT_TERRAIN_PALETTE, EXPANDED_PALETTE_NAME } from "../../src/constants";

/** A terrain of the Expanded palette (every flower cell shows it). */
const TERRAIN = DEFAULT_TERRAIN_PALETTE[1].name;

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
// Obsidian's global for notice fragments (the step's notice).
g.createFragment ??= () => ({ appendText() {}, createEl: () => ({ addEventListener() {} }) });
const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const NOTE = "world/hexes/vale/_vale.md";
const FLOWER = "world/hex flowers/Wilds.md";
let dataWrites = 0;

function wireDataJson(v: MemVault): void {
	const proto = (mock.Plugin as { prototype: Record<string, unknown> }).prototype;
	proto.loadData = async function () {
		const text = v.files.get(DATA);
		return text === undefined ? null : JSON.parse(text);
	};
	proto.saveData = async function (data: unknown) {
		dataWrites++;
		v.files.set(DATA, JSON.stringify(data, null, 2));
	};
	proto.registerMarkdownCodeBlockProcessor = function () {};
}

type Plugin = {
	app: unknown;
	manifest: unknown;
	settings: { maps: MapData[] };
	getMap(name: string): (MapData & Record<string, unknown>) | undefined;
	loadSettings(): Promise<void>;
	saveSettings(): Promise<void>;
	paletteStore: { init(): Promise<void> };
	mapStore: { init(): Promise<void>; flush(): Promise<void>; get(m: string, k: string): { terrain?: string } | undefined };
	moduleStores: { id: string; init(): Promise<void> }[];
} & Record<string, unknown>;

async function start(v: MemVault, app?: unknown): Promise<Plugin> {
	wireDataJson(v);
	const a = app ?? {
		...v.app(),
		workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn() },
	};
	const av = a as { vault: Record<string, unknown>; metadataCache: Record<string, unknown> };
	av.vault.on = () => ({});
	av.metadataCache.on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const manifest = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
	const plugin = new HexmakerPlugin(a as never, manifest as never) as unknown as Plugin;
	plugin.app = a;
	plugin.manifest = manifest;
	plugin.refreshHexMap = () => {};
	plugin.loadAvailableIcons = () => {};
	plugin.ensureTablesForNewTerrains = async () => {};
	await plugin.loadSettings();
	await plugin.paletteStore.init();
	await plugin.mapStore.init();
	await plugin.moduleStores.find((s) => s.id === "hex-flowers")!.init();
	return plugin;
}

function vault(): MemVault {
	const flower = emptyFlower("Wilds", EXPANDED_PALETTE_NAME);
	flower.cells = flower.cells.map(() => ({ result: TERRAIN }));
	const v = new MemVault({ [FLOWER]: buildFlowerNote(flower) });
	v.files.set(DATA, JSON.stringify({
		hexFolder: "world/hexes",
		worldFolder: "world",
		hexOrientation: "flat",
		defaultPalette: EXPANDED_PALETTE_NAME,
		maps: [{
			name: "vale", paletteName: EXPANDED_PALETTE_NAME, gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
			seed: 3, exploreWith: ["[[world/hex flowers/Wilds]] -> terrain"], hexFlowerAt: ["Wilds: 10"], exploreReveal: "entered",
		}],
	}, null, 2));
	return v;
}

describe("exploring through the real plugin", () => {
	it("the map note holds the module's keys, read back as written", async () => {
		const v = vault();
		const plugin = await start(v);
		await plugin.saveSettings();
		await plugin.mapStore.flush();
		const note = v.files.get(NOTE)!;
		expect(note).toMatch(/^explore-with: /m);
		expect(note).toMatch(/^hex-flower-at: /m);
		const back = parseMapNote(note)!.settings as Record<string, unknown>;
		expect(back.exploreWith).toEqual(["[[world/hex flowers/Wilds]] -> terrain"]);
		expect(back.hexFlowerAt).toEqual(["Wilds: 10"]);
		expect(back.exploreReveal).toBe("entered");
	});

	it("a party step fills a blank hex; a restart keeps it all and writes nothing", async () => {
		const v = vault();
		const plugin = await start(v);
		await plugin.saveSettings();
		await plugin.mapStore.flush();
		const undo = await runPartyEntered(plugin as never, { map: "vale", from: "2_2", to: "3_2" });
		expect(undo.map((u) => u.kind)).toEqual(["cells", "map-field"]);
		expect(plugin.mapStore.get("vale", "3_2")?.terrain).toBe(TERRAIN);
		await plugin.saveSettings();
		await plugin.mapStore.flush();
		const note = v.files.get(NOTE)!;
		const data = v.files.get(DATA)!;
		expect(parseMapNote(note)!.hexes.get("3_2")?.terrain).toBe(TERRAIN);

		// Restart on the same vault: nothing is rewritten.
		dataWrites = 0;
		const writesBefore = v.writes.length;
		const again = await start(v);
		await again.saveSettings();
		await again.mapStore.flush();
		expect(dataWrites).toBe(0);
		expect(v.files.get(DATA)).toBe(data);
		expect(v.files.get(NOTE)).toBe(note);
		expect(v.writes.slice(writesBefore)).toEqual([]);
		const map = again.getMap("vale")!;
		expect(map.exploreWith).toEqual(["[[world/hex flowers/Wilds]] -> terrain"]);
		expect(map.hexFlowerAt).toEqual(plugin.getMap("vale")!.hexFlowerAt);
		expect(again.mapStore.get("vale", "3_2")?.terrain).toBe(TERRAIN);
	});
});

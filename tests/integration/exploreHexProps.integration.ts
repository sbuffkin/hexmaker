/**
 * Hex flowers × hex-note properties (int/hexflower-hexprops), end to end
 * through the real plugin class:
 *
 * - a party step's fill (a `discover` write) reaches an existing hex note's
 *   properties like any map change, is never a hand edit, and isn't read
 *   back from the note as one; undo takes the property back off;
 * - the hex-flower map-note keys never reach a hex note;
 * - stores held (fresh install, wizard open, F19): the mirror writes
 *   nothing until the stores start, and a note written before then never
 *   wins over newer memory (CLAUDE.md, incident 2026-10-14).
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { MemVault } from "../helpers/memVault";
import { buildFlowerNote } from "../../src/hexflower/flowerNote";
import { emptyFlower } from "../../src/hexflower/flower";
import { runPartyEntered } from "../../src/modules/runtime";
import { setHandEditListener } from "../../src/modeGate";
import { cellPatch } from "../../src/undoBook";
import type { UndoItem } from "../../src/hex-map/undoItems";
import type { HexPropsSync } from "../../src/maps/hexPropsSync";
import type { MapData } from "../../src/types";
import { DEFAULT_TERRAIN_PALETTE, EXPANDED_PALETTE_NAME } from "../../src/constants";

const TERRAIN = DEFAULT_TERRAIN_PALETTE[1].name;

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.createFragment ??= () => ({ appendText() {}, createEl: () => ({ addEventListener() {} }) });
const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const MANIFEST = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };
const FLOWER = "world/hex flowers/Wilds.md";
const HEX = "world/hexes/vale/3_2.md";

type Plugin = {
	app: unknown;
	settings: { maps: MapData[] };
	getMap(name: string): MapData | undefined;
	loadSettings(): Promise<void>;
	saveSettings(): Promise<void>;
	hexProps: HexPropsSync;
	createHexNote(x: number, y: number, map: string): Promise<unknown>;
	paletteStore: { init(): Promise<void> };
	mapStore: {
		init(): Promise<void>;
		flush(): Promise<void>;
		get(m: string, k: string): { terrain?: string } | undefined;
		set(m: string, k: string, p: object, a?: string): boolean;
	};
	moduleStores: { id: string; init(): Promise<void> }[];
} & Record<string, unknown>;

function wireDataJson(v: MemVault): void {
	const proto = (mock.Plugin as { prototype: Record<string, unknown> }).prototype;
	proto.loadData = async function () {
		const text = v.files.get(DATA);
		return text === undefined ? null : JSON.parse(text);
	};
	proto.saveData = async function (data: unknown) {
		v.files.set(DATA, JSON.stringify(data, null, 2));
	};
	proto.registerMarkdownCodeBlockProcessor = function () {};
}

/** The plugin with its stores started (unless `held`), the mirror started with them. */
async function boot(v: MemVault, held = false): Promise<Plugin> {
	wireDataJson(v);
	const app = {
		...v.app(),
		workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn(), getActiveViewOfType: () => null, getActiveFile: () => null },
	};
	(app.vault as Record<string, unknown>).on = () => ({});
	(app.metadataCache as Record<string, unknown>).on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const plugin = new HexmakerPlugin(app as never, MANIFEST as never) as unknown as Plugin;
	plugin.app = app;
	plugin.manifest = MANIFEST;
	plugin.refreshHexMap = () => {};
	plugin.loadAvailableIcons = () => {};
	plugin.ensureTablesForNewTerrains = async () => {};
	plugin.ensureRollerLink = async () => {};
	await plugin.loadSettings();
	await plugin.paletteStore.init();
	if (!held) await startStores(plugin);
	return plugin;
}

/** What onload does once the stores may start: map store, module stores, then the mirror. */
async function startStores(plugin: Plugin): Promise<void> {
	await plugin.mapStore.init();
	await plugin.moduleStores.find((s) => s.id === "hex-flowers")!.init();
	await plugin.hexProps.start();
}

async function settle(plugin: Plugin): Promise<void> {
	await plugin.hexProps.flush();
	await plugin.mapStore.flush();
	await plugin.hexProps.flush();
}

function exploreVault(): MemVault {
	const flower = emptyFlower("Wilds", EXPANDED_PALETTE_NAME);
	flower.cells = flower.cells.map(() => ({ result: TERRAIN }));
	const v = new MemVault({ [FLOWER]: buildFlowerNote(flower) });
	v.files.set(DATA, JSON.stringify({
		hexFolder: "world/hexes",
		worldFolder: "world",
		tablesFolder: "world/tables",
		hexOrientation: "flat",
		defaultPalette: EXPANDED_PALETTE_NAME,
		maps: [{
			name: "vale", paletteName: EXPANDED_PALETTE_NAME, gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
			seed: 3, exploreWith: ["[[world/hex flowers/Wilds]] -> terrain"], hexFlowerAt: ["Wilds: 10"], exploreReveal: "entered",
		}],
	}, null, 2));
	// A note the user wrote for a hex the party hasn't reached yet.
	v.files.set(HEX, "---\nmap: \"[[_vale]]\"\n---\n# Hex 3, 2\n\nA ford.\n");
	return v;
}

/** Hand edits reported while `fn` runs. */
async function handEditsDuring(fn: () => Promise<void>): Promise<string[]> {
	const seen: string[] = [];
	setHandEditListener((map, action) => seen.push(`${map}:${action}`));
	try { await fn(); } finally { setHandEditListener(null); }
	return seen;
}

afterEach(() => setHandEditListener(null));

describe("hex flower fills × hex-note properties (real plugin)", () => {
	it("a party step's fill reaches the hex note's property, is no hand edit, and undo takes it back", async () => {
		const v = exploreVault();
		const plugin = await boot(v);
		await settle(plugin);
		expect(v.frontmatter(HEX)?.terrain).toBeUndefined();

		let undo: UndoItem[] = [];
		const hand = await handEditsDuring(async () => {
			undo = await runPartyEntered(plugin as never, { map: "vale", from: "2_2", to: "3_2" });
			await settle(plugin);
		});
		expect(plugin.mapStore.get("vale", "3_2")?.terrain).toBe(TERRAIN);
		expect(v.frontmatter(HEX)?.terrain).toBe(TERRAIN);
		expect(hand).toEqual([]);
		// The hex-flower map-note keys stay in the map note.
		const fm = v.frontmatter(HEX)!;
		for (const k of ["explore-with", "hex-flower-at", "explore-reveal", "exploreWith", "hexFlowerAt"]) expect(k in fm).toBe(false);
		expect(v.files.get(HEX)).toContain("A ford.");

		// The mirror's own write isn't read back as an edit: another pass writes nothing.
		const writes = plugin.hexProps.writes;
		plugin.hexProps.onMetadataChanged(v.app().vault.getAbstractFileByPath(HEX) as never);
		await settle(plugin);
		expect(plugin.hexProps.writes).toBe(writes);
		expect(plugin.mapStore.get("vale", "3_2")?.terrain).toBe(TERRAIN);

		// Undo the step's cells: the property comes off again.
		const cells = undo.find((u) => u.kind === "cells");
		expect(cells).toBeTruthy();
		if (cells?.kind === "cells") for (const e of cells.edits) plugin.mapStore.set(e.map, e.key, cellPatch(e, "undo"));
		await settle(plugin);
		expect(plugin.mapStore.get("vale", "3_2")?.terrain).toBeUndefined();
		expect(v.frontmatter(HEX)?.terrain).toBeUndefined();
	});

	it("stores held: nothing is mirrored before they start, and a note written meanwhile never wins over newer memory", async () => {
		const v = new MemVault();
		v.files.set(DATA, JSON.stringify({ hexFolder: "world/hexes", worldFolder: "world", hexOrientation: "flat", setupComplete: true, maps: [] }, null, 2));
		const plugin = await boot(v, true);
		const make = plugin.createNewMap as (opts: Record<string, unknown>) => Promise<{ name: string }>;
		const made = await make.call(plugin, { name: "Moor", cols: 4, rows: 4, palette: EXPANDED_PALETTE_NAME, stagger: "odd", terrain: new Map([["1_1", TERRAIN]]), quiet: true });
		const name = made.name;
		const path = `world/hexes/${name}/1_1.md`;
		await plugin.createHexNote(1, 1, name);
		expect(v.frontmatter(path)?.terrain).toBe(TERRAIN);
		const noteBefore = v.files.get(path);

		// Painted while held: memory moves on, the note isn't touched yet.
		const other = DEFAULT_TERRAIN_PALETTE.find((t) => t.name !== TERRAIN)!.name;
		expect(plugin.mapStore.set(name, "1_1", { terrain: other })).toBe(true);
		await plugin.saveSettings();
		await plugin.hexProps.flush();
		expect(plugin.hexProps.writes).toBe(0);
		expect(v.files.get(path)).toBe(noteBefore);

		// The wizard closes: the stores start. Memory wins; the note follows it.
		const hand = await handEditsDuring(async () => {
			await startStores(plugin);
			await settle(plugin);
		});
		expect(hand).toEqual([]);
		expect(plugin.mapStore.get(name, "1_1")?.terrain).toBe(other);
		expect(v.frontmatter(path)?.terrain).toBe(other);
		await plugin.hexProps.memory.save();

		// A restart rewrites nothing.
		const before = new Map(v.files);
		v.writes = [];
		const again = await boot(v);
		await settle(again);
		expect(again.hexProps.writes).toBe(0);
		expect(again.mapStore.get(name, "1_1")?.terrain).toBe(other);
		expect(v.files.get(path)).toBe(before.get(path));
		expect(v.writes.filter((p) => !p.startsWith(".obsidian/"))).toEqual([]);
	});
});

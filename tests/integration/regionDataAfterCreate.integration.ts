/**
 * Incident 2026-10-14 (KB incident-2026-10-14-region-data-after-create),
 * end to end through the real plugin class: a region's map note was written
 * when the map was created, and the fields set after that (`submap-kind`,
 * its world slot, `arrival: open`) never reached it. On a fresh install the
 * stores wait for the setup wizard (F19), so maps made meanwhile (the
 * sandbox demo world, a New map from the command palette) were written by
 * createNewMap's flush while MapStore.sync ignored every later change; when
 * the stores started, init read those stale notes back as the truth and the
 * regions lost their region status in memory too.
 *
 * Each region entry point runs twice: with the stores started (normal use)
 * and held (fresh install, wizard open, then released). Memory and the map
 * notes must keep every region field, before and after a restart.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "../helpers/memVault";
import type { MapData } from "../../src/types";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;

// Stubs for the UI base classes the plugin module's views extend (no view is opened).
const mock = require("obsidian") as Record<string, unknown>;
for (const name of ["Component", "ItemView", "Menu", "PluginSettingTab", "Scope", "Setting", "MarkdownRenderer"]) {
	if (!mock[name]) mock[name] = class {};
}

const DATA = ".obsidian/plugins/hexmaker/data.json";
const MANIFEST = { id: "hexmaker", dir: ".obsidian/plugins/hexmaker", version: "0.0.0-test" };

type Plugin = {
	settings: { maps: MapData[]; setupComplete?: boolean };
	app: unknown;
	getMap(name: string): MapData | undefined;
	loadSettings(): Promise<void>;
	saveSettings(): Promise<void>;
	paletteStore: { init(): Promise<void> };
	mapStore: { init(): Promise<void>; flush(): Promise<void>; isReady(): boolean; readNoteText(name: string): Promise<string | null> };
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
}

async function start(v: MemVault, held: boolean): Promise<Plugin> {
	wireDataJson(v);
	const app = { ...v.app(), workspace: { getLeavesOfType: () => [], on: () => ({}), onLayoutReady: (fn: () => void) => fn() } };
	(app.vault as Record<string, unknown>).on = () => ({});
	(app.metadataCache as Record<string, unknown>).on = () => ({});
	const { default: HexmakerPlugin } = await import("../../src/HexmakerPlugin");
	const plugin = new HexmakerPlugin(app as never, MANIFEST as never) as unknown as Plugin;
	plugin.app = app;
	plugin.manifest = MANIFEST;
	plugin.refreshHexMap = () => {};
	plugin.loadAvailableIcons = () => {};
	plugin.ensureTablesForNewTerrains = async () => {};
	await plugin.loadSettings();
	await plugin.paletteStore.init();
	// Held: a fresh install with the setup wizard open (startupWritesWait):
	// the map store starts only when the wizard is done or a map opens.
	if (!held) await plugin.mapStore.init();
	return plugin;
}

/** A fresh vault (no world folder yet, as a new install). */
function freshVault(): MemVault {
	const v = new MemVault();
	v.files.set(DATA, JSON.stringify({ hexFolder: "world/hexes", hexOrientation: "flat", setupComplete: true, maps: [] }, null, 2));
	return v;
}

/** The fields that make a map a region, per map with a parent. */
function regionFields(p: Plugin): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const m of p.settings.maps) {
		if (!m.parent) continue;
		out[m.name] = { parent: m.parent, submapKind: m.submapKind ?? null, world: m.world ?? null, arrival: m.arrival ?? null };
	}
	return out;
}

/** Run `make` (held or not), start the stores, restart; memory and notes keep every region field throughout. */
async function check(held: boolean, make: (p: Plugin) => Promise<void>, minRegions: number): Promise<void> {
	const v = freshVault();
	const p = await start(v, held);
	await make(p);
	await p.saveSettings();
	await p.mapStore.flush();
	const expected = regionFields(p);
	const regions = Object.values(expected).filter((f) => (f as { submapKind: string | null }).submapKind === "region");
	expect(regions.length).toBeGreaterThanOrEqual(minRegions);
	if (held) {
		// The wizard closes (or a map opens): the stores start now.
		await p.mapStore.init();
	}
	await p.mapStore.flush();
	expect(regionFields(p)).toEqual(expected);
	// The notes say the same.
	for (const [name, f] of Object.entries(expected) as [string, { submapKind: string | null; world: unknown; arrival: string | null }][]) {
		const text = (await p.mapStore.readNoteText(name)) ?? "";
		if (f.submapKind) expect({ name, kind: text.includes(`\nsubmap-kind: ${f.submapKind}\n`) }).toEqual({ name, kind: true });
		if (f.world) expect({ name, world: /\nworld: /.test(text) }).toEqual({ name, world: true });
		if (f.arrival) expect({ name, arrival: text.includes(`\narrival: ${f.arrival}\n`) }).toEqual({ name, arrival: true });
	}
	// Restart: a new plugin instance reads everything back from the notes.
	const again = await start(v, false);
	expect(regionFields(again)).toEqual(expected);
}

/** A small overworld (three hexes, 8×8 brick regions), every region made (buildOverworld → generateMissingRegions). */
async function smallOverworld(p: Plugin): Promise<string> {
	const { buildOverworld } = await import("../../src/overworld/demoWorld");
	const plugin = p as never;
	await (p.ensureOverworldBiomes as () => Promise<void>).call(p);
	await (p.ensurePaletteInstalled as (n: string) => Promise<unknown>).call(p, "Expanded");
	const ow = await buildOverworld(plugin, { name: "Isles", cells: [[0, 0], [1, 0], [0, 1]], cols: 2, rows: 2, seed: 7, regionSize: 8 });
	expect(ow.errors).toEqual([]);
	return ow.name;
}

for (const held of [false, true]) {
	const when = held ? "stores held (fresh install, wizard open)" : "stores started";
	describe(`incident 2026-10-14: region fields set after createNewMap reach the note (${when})`, () => {
		it("createNewMap, then the follow-up settings writes (world slot, kind, arrival)", async () => {
			await check(held, async (p) => {
				const make = p.createNewMap as (opts: Record<string, unknown>) => Promise<{ name: string }>;
				const ow = await make.call(p, { name: "Top", cols: 4, rows: 4, palette: "Default", stagger: "odd", quiet: true });
				const child = await make.call(p, { name: "Child", cols: 8, rows: 8, palette: "Default", stagger: "odd", terrain: new Map([["1_1", "forest"]]), quiet: true, parent: { map: ow.name, hex: "1_1" } });
				const m = p.getMap(child.name)!;
				m.world = { id: "w1", cx: 1, cy: 1 };
				m.arrival = "open";
				await (p.linkRegion as (...a: unknown[]) => Promise<boolean>).call(p, ow.name, 1, 1, child.name);
			}, 1);
		});

		it("make every region (buildOverworld → generateMissingRegions → createRegion)", async () => {
			await check(held, async (p) => { await smallOverworld(p); }, 3);
		});

		it("the new-region mode's Create (setBiomeAt) and walking into new land (walkIntoHex)", async () => {
			await check(held, async (p) => {
				const owName = await smallOverworld(p);
				const { setBiomeAt, walkIntoHex, hexBiomeAt } = await import("../../src/overworld/regionsVault");
				const plugin = p as never;
				const biome = hexBiomeAt(plugin, owName, "0_0")!;
				expect(biome).toBeTruthy();
				const made = await setBiomeAt(plugin, owName, 1, 1, biome);
				expect("error" in made ? made.error : "").toBe("");
				const from = (made as { name: string }).name;
				const walked = await walkIntoHex(plugin, owName, 2, 1, biome, { from });
				expect("error" in walked ? walked.error : "").toBe("");
			}, 5);
		});
	});
}

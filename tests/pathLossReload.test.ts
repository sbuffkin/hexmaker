/**
 * Incident 2026-10-10: a data.json reload (onExternalSettingsChange) in the
 * middle of a burst of saveSettings calls wiped map notes' paths. loadSettings
 * hands MapStore fresh map objects with no `paths` (data.json never holds the
 * paths of maps whose note does); any sync/flush that reached them before
 * reloadFromNotes read "missing" as "empty" and wrote that to the note.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { Notice } from "obsidian";
import { MapStore, withoutNotePaths } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { MemVault } from "./helpers/memVault";
import type { MapData, MapPath } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/coast/_coast.md";
const NORTH = "world/hexes/north/_north.md";

const maps = (): MapData[] => [
	{ name: "coast", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["1_2", "2_2", "3_2"] }, { typeName: "River", hexes: ["5_0", "5_1", "5_2", "5_3"] }] } as MapData,
	{ name: "north", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["0_0", "1_0", "2_0"] }] } as MapData,
];

function plugin(vault: MemVault, list: MapData[]) {
	const p = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", maps: list },
		getMap: (n: string) => p.settings.maps.find((m) => m.name === n),
		saveData: async () => {},
		refreshHexMap: () => {},
	};
	return p;
}

async function boot() {
	const v = new MemVault();
	const p = plugin(v, maps());
	const store = new MapStore(p as never);
	await store.init();
	return { v, p, store };
}

/** What loadSettings does on an external data.json change: fresh map objects, read from what we last saved. */
function reloadDataJson(p: ReturnType<typeof plugin>, store: MapStore): MapData[] {
	const disk = JSON.parse(JSON.stringify(withoutNotePaths(p.settings, (n) => store.holdsPaths(n)))) as { maps: MapData[] };
	p.settings = { ...p.settings, maps: disk.maps };
	return disk.maps;
}

const notePaths = (v: MemVault, path = NOTE): MapPath[] => parseMapNote(v.files.get(path)!)!.paths;

describe("incident 2026-10-10: paths survive a data.json reload mid-burst", () => {
	it("setup: the notes hold the paths and data.json doesn't", async () => {
		const { v, p, store } = await boot();
		expect(notePaths(v)).toHaveLength(2);
		expect(notePaths(v, NORTH)).toHaveLength(1);
		const fresh = reloadDataJson(p, store);
		expect(fresh.every((m) => m.paths === undefined && m.pathChains === undefined)).toBe(true);
	});

	it("a saveSettings sync that reaches the fresh objects before reloadFromNotes keeps every map's paths", async () => {
		const { v, p, store } = await boot();
		reloadDataJson(p, store);
		await store.sync(); // the burst's next saveSettings
		expect(notePaths(v)).toHaveLength(2);
		expect(notePaths(v, NORTH)).toHaveLength(1);
		expect(store.paths("coast")).toHaveLength(2);
		await store.reloadFromNotes();
		expect(notePaths(v)).toHaveLength(2);
		expect(store.paths("north")).toHaveLength(1);
	});

	it("a flush already queued for a dirty map (its world slot just changed) keeps its paths", async () => {
		const { v, p, store } = await boot();
		p.getMap("coast")!.world = { id: "w1", cx: 1, cy: 0 };
		void store.sync(); // coast is dirty: the flush is queued
		const fresh = reloadDataJson(p, store); // Obsidian's reload lands before the queue runs
		const reload = store.reloadFromNotes();
		await reload;
		expect(notePaths(v)).toHaveLength(2);
		expect(fresh[0].paths).toHaveLength(2);
		expect(fresh[0].pathChains!.length).toBeGreaterThan(0);
		expect(parseMapNote(v.files.get(NOTE)!)!.settings).toMatchObject({ world: { id: "w1", cx: 1, cy: 0 } });
	});

	it("the fresh map's hexes and settings are the note's too", async () => {
		const { v, p, store } = await boot();
		store.set("coast", "4_4", { terrain: "forest", name: "Old Tower" });
		await store.flush();
		reloadDataJson(p, store);
		await store.sync();
		expect(store.get("coast", "4_4")).toEqual({ terrain: "forest", name: "Old Tower" });
		const back = parseMapNote(v.files.get(NOTE)!)!;
		expect(back.hexes.get("4_4")).toEqual({ terrain: "forest", name: "Old Tower" });
		expect(back.paths).toHaveLength(2);
	});
});

describe("map store: write guard against dropping every path or hex", () => {
	it("refuses a write that would empty a note's paths without an explicit delete, and says so", async () => {
		const { v, p, store } = await boot();
		Notice.shown.length = 0;
		// Something hands the store a map object whose paths read as empty (not a delete).
		const m = p.getMap("coast")!;
		const replaced = { ...m, paths: [], pathChains: [] } as MapData;
		p.settings = { ...p.settings, maps: p.settings.maps.map((x) => (x === m ? replaced : x)) };
		(store as unknown as { known: Map<string, MapData> }).known?.delete("coast");
		(store as unknown as { dirty: Set<string> }).dirty.add("coast");
		await store.flush();
		expect(notePaths(v)).toHaveLength(2);
		expect(Notice.shown.some((n) => n.msg.includes("_coast.md") && n.msg.includes("kept"))).toBe(true);
		// Memory takes the note's paths back, so the map shows them again.
		expect(store.paths("coast")).toHaveLength(2);
	});

	it("an explicit delete of every path still empties the note (setPaths)", async () => {
		const { v, store } = await boot();
		store.setPaths("coast", []);
		await store.flush();
		expect(notePaths(v)).toEqual([]);
	});

	it("deleting every path through pathChains (the path tool) still empties the note", async () => {
		const { v, p, store } = await boot();
		expect(store.paths("north")).toHaveLength(1);
		p.getMap("north")!.pathChains!.splice(0);
		await store.sync();
		expect(notePaths(v, NORTH)).toEqual([]);
	});

	it("clearing every hex by hand edits through the store still empties the note's hexes", async () => {
		const { v, store } = await boot();
		store.set("coast", "4_4", { terrain: "forest" });
		await store.flush();
		store.set("coast", "4_4", { terrain: null });
		await store.flush();
		expect(parseMapNote(v.files.get(NOTE)!)!.hexes.size).toBe(0);
	});

	it("refuses a write that would drop every hex the note holds when nothing cleared them", async () => {
		const { v, store } = await boot();
		store.set("coast", "4_4", { terrain: "forest" });
		await store.flush();
		// Lose the in-memory table (not a user clear).
		(store as unknown as { hexes: Map<string, unknown> }).hexes.delete("coast");
		(store as unknown as { dirty: Set<string> }).dirty.add("coast");
		await store.flush();
		expect(parseMapNote(v.files.get(NOTE)!)!.hexes.get("4_4")).toEqual({ terrain: "forest" });
		expect(store.get("coast", "4_4")).toEqual({ terrain: "forest" });
	});
});

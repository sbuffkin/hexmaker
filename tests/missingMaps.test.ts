/**
 * SM-DEL (owner, round 5): a map whose folder and map note were deleted by
 * hand is marked missing (Restore / Remove), never silently re-created as
 * an empty note. Restore puts back exactly what the note held (hexes,
 * paths, settings) from the map cache.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile, TFolder } from "obsidian";
import { MapStore } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/isle/_isle.md";
const CACHE = ".obsidian/plugins/hexmaker/map-cache/isle.md";

function plugin(vault: MemVault, maps: MapData[]) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", maps },
		getMap: (n: string) => maps.find((m) => m.name === n),
		saveData: async () => {},
		refreshHexMap: () => {},
	};
}

const isle = (): MapData => ({ name: "isle", paletteName: "Expanded", gridSize: { cols: 6, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [] }) as MapData;

/** data.json's copy of a map: settings without paths (the note holds them). */
function fromDataJson(m: MapData): MapData {
	const { paths: _p, pathChains: _c, ...rest } = JSON.parse(JSON.stringify(m)) as MapData;
	return rest as MapData;
}

async function boot(vault: MemVault, maps: MapData[]) {
	const p = plugin(vault, maps);
	const store = new MapStore(p as never);
	await store.init();
	return { p, store };
}

/** A painted map with a path, its note written and cached. */
async function painted(vault: MemVault) {
	const map = isle();
	const { store } = await boot(vault, [map]);
	store.setMany("isle", [["1_1", { terrain: "forest" }], ["2_2", { terrain: "hills" }], ["3_3", { terrain: "ocean", name: "Bay" }]]);
	store.setPaths("isle", [{ name: "Old road", typeName: "Road", branches: [{ anchors: ["0_1", "4_3"] }] }]);
	map.baseTerrain = "ocean";
	await store.sync();
	await store.flush();
	return map;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("missing maps (SM-DEL)", () => {
	it("every note write is cached outside the vault's notes", async () => {
		const vault = new MemVault();
		await painted(vault);
		expect(vault.files.get(CACHE)).toBe(vault.files.get(NOTE));
	});

	it("folder and note deleted while closed: marked missing, nothing re-created", async () => {
		const vault = new MemVault();
		const map = await painted(vault);
		vault.remove("world/hexes/isle");
		const { store } = await boot(vault, [fromDataJson(map)]);
		expect(store.isMissing("isle")).toBe(true);
		expect(store.missingMaps()).toEqual(["isle"]);
		expect(store.isReady("isle")).toBe(false);
		await store.sync();
		await store.flush();
		expect(vault.files.has(NOTE)).toBe(false);
		expect([...vault.folders].some((f) => f === "world/hexes/isle")).toBe(false);
	});

	it("Restore brings back hexes, paths and settings exactly, from the cache", async () => {
		const vault = new MemVault();
		const map = await painted(vault);
		const before = vault.files.get(NOTE)!;
		vault.remove("world/hexes/isle");
		const copy = fromDataJson(map);
		delete copy.baseTerrain; // a setting only the note still had
		const { store } = await boot(vault, [copy]);
		const r = await store.restoreMissing("isle");
		expect(r).toEqual({ source: "cache" });
		expect(store.isMissing("isle")).toBe(false);
		expect(vault.files.get(NOTE)).toBe(before);
		expect(store.get("isle", "3_3")).toEqual({ terrain: "ocean", name: "Bay" });
		expect(store.all("isle").size).toBe(3);
		expect(store.paths("isle").map((p) => [p.name, p.branches[0].anchors])).toEqual([["Old road", ["0_1", "4_3"]]]);
		expect(copy.baseTerrain).toBe("ocean");
		const note = parseMapNote(vault.files.get(NOTE)!)!;
		expect(note.hexes.size).toBe(3);
	});

	it("a fresh install's placeholder (never had a note) is created, not missing", async () => {
		const vault = new MemVault();
		const { store } = await boot(vault, [isle()]);
		expect(store.isMissing("isle")).toBe(false);
		expect(vault.files.has(NOTE)).toBe(true);
	});

	it("a cached map whose folder still has hex notes with map data migrates instead", async () => {
		const vault = new MemVault();
		const map = await painted(vault);
		vault.files.delete(NOTE);
		vault.files.set("world/hexes/isle/1_1.md", "---\nterrain: desert\n---\n# Hex\n");
		const { store } = await boot(vault, [fromDataJson(map)]);
		expect(store.isMissing("isle")).toBe(false);
		expect(store.get("isle", "1_1")?.terrain).toBe("desert");
	});

	it("deleted mid-session: marked missing after a moment; Restore uses what's in memory", async () => {
		const vault = new MemVault();
		const map = isle();
		const { store } = await boot(vault, [map]);
		store.setMany("isle", [["4_4", { terrain: "forest" }]]);
		await store.flush();
		vault.remove("world/hexes/isle");
		const folder = new TFolder();
		folder.path = "world/hexes/isle";
		store.onDelete(folder);
		await sleep(400);
		await store.flush();
		expect(store.isMissing("isle")).toBe(true);
		expect(vault.files.has(NOTE)).toBe(false);
		// Edits while missing stay in memory and are never written…
		store.setMany("isle", [["5_4", { terrain: "hills" }]]);
		await store.flush();
		expect(vault.files.has(NOTE)).toBe(false);
		// …until Restore.
		expect(await store.restoreMissing("isle")).toEqual({ source: "memory" });
		const note = parseMapNote(vault.files.get(NOTE)!)!;
		expect([...note.hexes.keys()].sort()).toEqual(["4_4", "5_4"]);
	});

	it("the plugin's own Delete (expectRemoval) doesn't mark the map missing", async () => {
		const vault = new MemVault();
		const { store } = await boot(vault, [isle()]);
		store.expectRemoval("isle");
		vault.remove("world/hexes/isle");
		const note = new TFile();
		note.path = NOTE;
		store.onDelete(note);
		await sleep(400);
		await store.flush();
		expect(store.isMissing("isle")).toBe(false);
	});

	it("a missing map's note put back by hand loads again (onCreate)", async () => {
		const vault = new MemVault();
		const map = await painted(vault);
		const text = vault.files.get(NOTE)!;
		vault.remove("world/hexes/isle");
		const { store } = await boot(vault, [fromDataJson(map)]);
		vault.files.set(NOTE, text);
		const f = new TFile();
		f.path = NOTE;
		store.onCreate(f);
		await store.flush();
		expect(store.isMissing("isle")).toBe(false);
		expect(store.all("isle").size).toBe(3);
	});

	it("data.json replaced from outside: a map without a note is missing, not written", async () => {
		const vault = new MemVault();
		const maps = [isle()];
		const { store } = await boot(vault, maps);
		maps.push({ name: "far", paletteName: "Expanded", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapData);
		await store.reloadFromNotes();
		await store.sync();
		expect(store.isMissing("far")).toBe(true);
		expect(vault.files.has("world/hexes/far/_far.md")).toBe(false);
	});
});

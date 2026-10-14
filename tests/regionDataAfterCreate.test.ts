/**
 * Incident 2026-10-14: maps made while the map store waits to start (a
 * fresh install's stores wait for the setup wizard, F19) had their note
 * written by createNewMap's flush, then sync() ignored every later change
 * (region kind, world slot, arrival), and init() read the stale note back
 * over memory. The store keeps the notes it wrote up to date before it is
 * ready, and never reads its own note back over newer memory.
 * End to end: tests/integration/regionDataAfterCreate.integration.ts.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { MapStore } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/vale/_vale.md";
const PLACEHOLDER = "world/hexes/default/_default.md";

function setup() {
	const v = new MemVault();
	const p = {
		app: v.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", maps: [{ name: "default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 } } as MapData] },
		getMap: (n: string) => p.settings.maps.find((m) => m.name === n),
		saveData: async () => {},
		refreshHexMap: () => {},
	};
	const store = new MapStore(p as never);
	return { v, p, store };
}

/** What createNewMap does: push the map, set its cells, flush (the store isn't started yet). */
async function makeMap(p: ReturnType<typeof setup>["p"], store: MapStore): Promise<MapData> {
	const map = { name: "vale", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 8, y: 0 }, parent: { map: "default", hex: "1_0" } } as MapData;
	p.settings.maps.push(map);
	store.setMany("vale", [["8_0", { terrain: "forest" }], ["9_1", { terrain: "hills" }]]);
	await store.flush();
	return map;
}

const noteSettings = (v: MemVault) => parseMapNote(v.files.get(NOTE)!)!.settings;

describe("incident 2026-10-14: fields set after a map is made reach its note before the store starts", () => {
	it("sync before ready rewrites the notes this session wrote", async () => {
		const { v, p, store } = setup();
		expect(store.isReady()).toBe(false);
		const map = await makeMap(p, store);
		expect(noteSettings(v)).not.toHaveProperty("submapKind");
		map.submapKind = "region";
		map.world = { id: "w1", cx: 1, cy: 0 };
		map.arrival = "open";
		await store.sync();
		expect(noteSettings(v)).toMatchObject({ submapKind: "region", world: { id: "w1", cx: 1, cy: 0 }, arrival: "open" });
	});

	it("sync before ready still writes nothing else (a fresh install's placeholder map gets no note, F19)", async () => {
		const { v, p, store } = setup();
		await makeMap(p, store);
		await store.sync();
		expect(v.files.has(PLACEHOLDER)).toBe(false);
	});

	it("init never reads its own note back over memory: fields set after the last write are kept and written", async () => {
		const { v, p, store } = setup();
		const map = await makeMap(p, store);
		// Set after the note was written, with no sync in between (the old loss).
		map.submapKind = "region";
		map.world = { id: "w1", cx: 1, cy: 0 };
		map.arrival = "open";
		await store.init();
		expect(p.getMap("vale")).toMatchObject({ submapKind: "region", world: { id: "w1", cx: 1, cy: 0 }, arrival: "open" });
		expect(store.get("vale", "8_0")).toEqual({ terrain: "forest" });
		expect(noteSettings(v)).toMatchObject({ submapKind: "region", world: { id: "w1", cx: 1, cy: 0 }, arrival: "open" });
	});

	it("init folds in a hand edit made to that note meanwhile, and keeps memory's other fields", async () => {
		const { v, p, store } = setup();
		const map = await makeMap(p, store);
		map.submapKind = "region";
		await store.sync();
		map.arrival = "open";
		// Edited by hand before the store started (no onModify yet): a name and a hex.
		v.files.set(NOTE, v.files.get(NOTE)!.replace("cols: 8", "display-name: The Vale\ncols: 8").replace(/\| 9_1 \|([^\n]*)hills/, "| 9_1 |$1mountains"));
		await store.init();
		expect(p.getMap("vale")).toMatchObject({ displayName: "The Vale", submapKind: "region", arrival: "open" });
		expect(store.get("vale", "9_1")?.terrain).toBe("mountains");
		expect(noteSettings(v)).toMatchObject({ displayName: "The Vale", submapKind: "region", arrival: "open" });
	});
});

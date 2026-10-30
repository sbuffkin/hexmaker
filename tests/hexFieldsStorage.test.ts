import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { MapStore } from "../src/maps/MapStore";
import { buildMapNote, hexRowsToWrite, parseMapNote, updateMapNote, type HexData } from "../src/maps/mapNote";
import { setFieldFiller } from "../src/maps/fieldFill";
import { setModeMapLookup } from "../src/modeGate";
import { allows, COMMAND_ACTIONS } from "../src/workMode";
import { cellEdits, cellPatch } from "../src/undoBook";
import { computeHexFields, FIELD_ROLLS_COLUMN } from "../src/fields/hexFields";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const NOTE = "world/hexes/m/_m.md";

function boot(v: MemVault, workMode?: string) {
	const maps = [{ name: "m", paletteName: "Default", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, pathChains: [], ...(workMode ? { workMode } : {}) } as MapData];
	const p = {
		app: v.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", maps },
		getMap: (n: string) => maps.find((m) => m.name === n),
		saveData: async () => {},
		refreshHexMap: () => {},
	};
	const store = new MapStore(p as never);
	return { p, store, maps, ready: store.init() };
}

const modify = async (store: MapStore, p: { app: { vault: { getAbstractFileByPath(path: string): unknown } } }, v: MemVault, text: string) => {
	v.files.set(NOTE, text);
	store.onModify(p.app.vault.getAbstractFileByPath(NOTE) as never);
	await store.flush();
};

afterEach(() => {
	setFieldFiller(null);
	setModeMapLookup(null);
});

describe("hex fields storage: ## Hexes columns are an official extension point", () => {
	it("field columns and Field rolls round-trip, in the user's column order, any header case", () => {
		const note = [
			"---", "hexmaker-map: 6", "cols: 6", "rows: 6", "---", "# m",
			"## Hexes",
			"| Hex | Population | Name | Terrain | Icon | GM icons | Area | Locations | Locked | Field rolls |",
			"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
			"| 1_1 | 440 |  | forest |  |  |  |  |  | Population: 400 |",
			"| 2_2 | 12 |  |  |  |  |  |  |  |  |",
		].join("\n");
		const d = parseMapNote(note)!;
		expect(d.hexes.get("1_1")).toEqual({ terrain: "forest", extra: { Population: "440", "Field rolls": "Population: 400" } });
		// A hex whose only data is a field value is a row (never dropped as empty).
		expect(hexRowsToWrite(d.hexes).map(([k]) => k)).toEqual(["1_1", "2_2"]);
		// Written back with a value under another header case: the note's column, the note's order.
		d.hexes.set("2_2", { extra: { population: "13" } });
		const out = updateMapNote(note, "m", d);
		expect(out).toContain("| Hex | Population | Name | Terrain |");
		expect(out).toMatch(/\| 2_2 \| 13 \|/);
		expect(parseMapNote(out)!.hexes.get("1_1")).toEqual(d.hexes.get("1_1"));
	});

	it("a new note gets field columns after the known ones", () => {
		const hexes = new Map<string, HexData>([["0_0", { terrain: "hills", extra: { Population: "5", [FIELD_ROLLS_COLUMN]: "Population: 5" } }]]);
		const text = buildMapNote("m", { settings: { gridSize: { cols: 2, rows: 2 } } as never, hexes, paths: [] });
		expect(text).toMatch(/\| Hex \| Name \| Terrain \| .*Locked \| Population \| Field rolls \|/);
		expect(parseMapNote(text)!.hexes.get("0_0")).toEqual(hexes.get("0_0"));
	});

	it("a script's edit of a field column survives the plugin's next write (read first, then written)", async () => {
		const v = new MemVault();
		const { store, p, ready } = boot(v);
		await ready;
		store.set("m", "1_1", { terrain: "grass", extra: { Population: "10" } });
		await store.flush();
		// A script edits the column while Obsidian is open, before the plugin heard of it…
		v.files.set(NOTE, v.files.get(NOTE)!.replace("| 10 |", "| 250 |"));
		// …and the plugin paints another hex.
		store.set("m", "2_2", { terrain: "lava" });
		await store.flush();
		const d = parseMapNote(v.files.get(NOTE)!)!;
		expect(d.hexes.get("1_1")?.extra).toEqual({ Population: "250" });
		expect(store.get("m", "1_1")?.extra).toEqual({ Population: "250" });
		// A script that adds a column of its own: kept too, and seen by the store.
		await modify(store, p, v, v.files.get(NOTE)!.replace("| Population |", "| Population | Ruler |").replace(/(\| 1_1 .*?\| 250 \|)/, "$1 Fenmarch |").replace(/(\| --- \|)( --- \|)$/m, "$1$2 --- |"));
		store.set("m", "3_3", { terrain: "hills" });
		await store.flush();
		expect(store.get("m", "1_1")?.extra).toEqual({ Population: "250", Ruler: "Fenmarch" });
		expect(parseMapNote(v.files.get(NOTE)!)!.hexes.get("1_1")?.extra).toEqual({ Population: "250", Ruler: "Fenmarch" });
	});
});

describe("hex fields storage: filled when a hex gets terrain", () => {
	const filler = (calls: string[]) => (map: string, key: string, h: HexData) => {
		calls.push(`${map}/${key}/${h.terrain}`);
		return { Population: "400", [FIELD_ROLLS_COLUMN]: "Population: 400" };
	};

	it("set and setMany fill a hex that had no terrain, in the same write; never a hex that had one", async () => {
		const v = new MemVault();
		const { store, ready } = boot(v);
		await ready;
		const calls: string[] = [];
		setFieldFiller(filler(calls));
		store.set("m", "1_1", { terrain: "grass" }, "paint-terrain");
		expect(store.get("m", "1_1")).toEqual({ terrain: "grass", extra: { Population: "400", [FIELD_ROLLS_COLUMN]: "Population: 400" } });
		store.set("m", "1_1", { terrain: "forest" }, "paint-terrain");
		store.setMany("m", [["2_2", { terrain: "hills" }], ["3_3", { name: "No terrain" }]]);
		expect(calls).toEqual(["m/1_1/grass", "m/2_2/hills"]);
		expect(store.get("m", "1_1")?.extra?.Population).toBe("400");
		expect(store.get("m", "3_3")?.extra).toBeUndefined();
	});

	it("undo puts the hex back without filling again; redo brings the same values", async () => {
		const v = new MemVault();
		const { store, ready } = boot(v);
		await ready;
		const calls: string[] = [];
		setFieldFiller(filler(calls));
		const { cells } = await store.record(() => store.set("m", "1_1", { terrain: "grass" }, "paint-terrain"));
		const [edit] = cellEdits(cells);
		store.set("m", "1_1", cellPatch(edit, "undo"));
		expect(store.get("m", "1_1")).toBeUndefined();
		store.set("m", "1_1", cellPatch(edit, "redo"));
		expect(store.get("m", "1_1")?.extra?.Population).toBe("400");
		expect(calls).toHaveLength(1);
	});

	it("work modes: painting in Play is refused (nothing filled); exploring's fill counts as discover", async () => {
		const v = new MemVault();
		const { store, ready, maps } = boot(v, "play");
		await ready;
		setModeMapLookup((n) => maps.find((m) => m.name === n));
		const calls: string[] = [];
		setFieldFiller(filler(calls));
		expect(store.set("m", "1_1", { terrain: "grass" }, "paint-terrain")).toBe(false);
		expect(calls).toEqual([]);
		expect(store.set("m", "1_1", { terrain: "grass" }, "discover")).toBe(true);
		expect(store.get("m", "1_1")?.extra?.Population).toBe("400");
		// Typing a field is map data: Build and God, not Play.
		expect(store.set("m", "1_1", { extra: { Population: "1" } }, "edit-fields")).toBe(false);
	});

	it("edit-fields is Build's; Recalculate fields is classified", () => {
		expect(allows("play", "edit-fields")).toBe(false);
		expect(allows("build", "edit-fields")).toBe(true);
		expect(allows("god", "edit-fields")).toBe(true);
		expect(COMMAND_ACTIONS["recalculate-fields"]).toBe("edit-fields");
	});

	it("a rolled number cell may be a dice sum", () => {
		const decls = { fields: [{ name: "Population", type: "whole number" as const, default: "0", table: "t" }], influences: [] };
		expect(computeHexFields(undefined, { decls, roll: () => "3d6 × 100", effects: new Map(), rand: () => 0 }, "fill")).toEqual({ Population: "300", [FIELD_ROLLS_COLUMN]: "Population: 300" });
	});
});

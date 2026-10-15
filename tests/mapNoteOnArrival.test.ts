/**
 * Phase 4, T6: the map note's optional "On arrival" column, the per-map
 * generator tables (T11) and the arrival keys. Written only when needed,
 * read forgivingly, kept through hand edits and a data.json reload (the
 * path-loss incident class: missing ≠ empty).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { buildMapNote, parseMapNote, updateMapNote, type HexData, type MapNoteData } from "../src/maps/mapNote";
import { MapStore, withoutNotePaths } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

const data = (hexes: [string, HexData][], settings: MapNoteData["settings"] = {}): MapNoteData => ({
	settings: { paletteName: "Space - Sector", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, ...settings },
	hexes: new Map(hexes),
	paths: [],
});

describe("the On arrival column", () => {
	it("is written only once some hex needs it, as a link", () => {
		const plain = buildMapNote("drift", data([["1_1", { terrain: "garden world" }]]));
		expect(plain).not.toContain("On arrival");
		const note = buildMapNote("drift", data([
			["1_1", { terrain: "garden world" }],
			["4_7", { terrain: "star system", onArrival: "world/tables/space/Default space/Sector/Mainworlds" }],
			["5_2", { onArrival: "world/tables/space/Default space/Sector/Uncharted" }],
		]));
		expect(note).toContain("| Hex | Name | Terrain | Icon | GM icons | Area | Locations | Locked | On arrival |");
		expect(note).toContain("| 4_7 |  | star system |  |  |  |  |  | [[world/tables/space/Default space/Sector/Mainworlds]] |");
		// A hex with nothing but an On arrival roll still gets its row.
		expect(note).toContain("| 5_2 |  |  |  |  |  |  |  | [[world/tables/space/Default space/Sector/Uncharted]] |");
	});

	it("round-trips, and reads a hand-typed table (a plain name, a link with an alias)", () => {
		const note = buildMapNote("drift", data([["4_7", { terrain: "star system", onArrival: "t/Mainworlds" }]]));
		expect(parseMapNote(note)!.hexes.get("4_7")).toEqual({ terrain: "star system", onArrival: "t/Mainworlds" });
		const typed = note.replace("[[t/Mainworlds]]", "My table");
		expect(parseMapNote(typed)!.hexes.get("4_7")?.onArrival).toBe("My table");
		const header = note.replace("| On arrival |", "| Roll on arrival |");
		expect(parseMapNote(header)!.hexes.get("4_7")?.onArrival).toBe("t/Mainworlds");
	});

	it("a cleared cell drops the column again on the next write", () => {
		const note = buildMapNote("drift", data([["4_7", { terrain: "star system", onArrival: "t/Mainworlds" }]]));
		const next = updateMapNote(note, "drift", data([["4_7", { terrain: "ocean world" }]]));
		// The column stays while the note has it (the user's arrangement), empty.
		expect(parseMapNote(next)!.hexes.get("4_7")).toEqual({ terrain: "ocean world" });
	});
});

describe("map settings for arrival and generator tables", () => {
	it("are plain keys, read back the same", () => {
		const note = buildMapNote("drift", data([], {
			seed: 1234,
			arrivalMode: "make places",
			arrival: "open",
			arrivalRerolls: 2,
			roleTables: { "sector-hexes": "world/tables/space/Default space/Sector/Unexplored sector.md", star: "t/Stars.md" },
		}));
		expect(note).toContain("seed: 1234");
		expect(note).toContain("on-arrival: make places");
		expect(note).toContain("arrival: open");
		expect(note).toContain("arrival-rerolls: 2");
		expect(note).toContain('sector-hexes-table: "[[world/tables/space/Default space/Sector/Unexplored sector]]"');
		expect(note).toContain('star-table: "[[t/Stars]]"');
		const back = parseMapNote(note)!.settings;
		expect(back).toMatchObject({ seed: 1234, arrivalMode: "make places", arrival: "open", arrivalRerolls: 2 });
		expect(back.roleTables).toEqual({ "sector-hexes": "world/tables/space/Default space/Sector/Unexplored sector.md", star: "t/Stars.md" });
	});

	it("a map without them writes none of them", () => {
		const note = buildMapNote("drift", data([]));
		for (const k of ["seed:", "on-arrival:", "arrival:", "-table:"]) expect(note).not.toContain(k);
	});

	it("a role table key typed by hand is read (and an unknown role is the user's own key)", () => {
		const note = buildMapNote("drift", data([])).replace("---\n# ", "inner-orbits-table: \"[[My orbits]]\"\nfoo-table: x\n---\n# ");
		const back = parseMapNote(note)!.settings;
		expect(back.roleTables).toEqual({ "inner-orbits": "My orbits.md" });
		expect(updateMapNote(note, "drift", parseMapNote(note)!)).toContain("foo-table: x");
	});
});

describe("On arrival cells in the map store (missing ≠ empty)", () => {
	const NOTE = "world/hexes/drift/_drift.md";
	const maps = (): MapData[] => [{ name: "drift", paletteName: "Space - Sector", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 }, pathChains: [] } as MapData];
	const boot = async () => {
		const v = new MemVault();
		const p = {
			app: v.app(),
			manifest: { dir: ".obsidian/plugins/hexmaker" },
			settings: { hexFolder: "world/hexes", maps: maps() },
			getMap: (n: string) => p.settings.maps.find((m) => m.name === n),
			saveData: async () => {},
			refreshHexMap: () => {},
		};
		const store = new MapStore(p as never);
		await store.init();
		return { v, p, store };
	};

	it("survive a data.json reload and a hand edit elsewhere in the note", async () => {
		const { v, p, store } = await boot();
		store.setMany("drift", [["4_7", { terrain: "star system", onArrival: "t/Mainworlds" }], ["5_5", { onArrival: "t/Uncharted" }]]);
		await store.flush();
		expect(parseMapNote(v.files.get(NOTE)!)!.hexes.get("5_5")).toEqual({ onArrival: "t/Uncharted" });
		// data.json reload: fresh map objects.
		const disk = JSON.parse(JSON.stringify(withoutNotePaths(p.settings, (n) => store.holdsPaths(n)))) as { maps: MapData[] };
		p.settings = { ...p.settings, maps: disk.maps };
		store.adoptAll();
		await store.sync();
		expect(store.get("drift", "4_7")).toEqual({ terrain: "star system", onArrival: "t/Mainworlds" });
		// A hand edit to another hex.
		v.files.set(NOTE, v.files.get(NOTE)!.replace("| 4_7 |  | star system |", "| 4_7 | Kerrin | star system |"));
		store.onModify(p.app.vault.getAbstractFileByPath(NOTE) as never);
		await store.flush();
		expect(store.get("drift", "4_7")).toEqual({ name: "Kerrin", terrain: "star system", onArrival: "t/Mainworlds" });
		expect(store.get("drift", "5_5")).toEqual({ onArrival: "t/Uncharted" });
	});

	it("clearing the cell (a roll on arrival) writes the hex without it", async () => {
		const { v, store } = await boot();
		store.setMany("drift", [["4_7", { terrain: "star system", onArrival: "t/Mainworlds" }]]);
		await store.flush();
		store.set("drift", "4_7", { terrain: "ocean world", onArrival: null });
		await store.flush();
		expect(parseMapNote(v.files.get(NOTE)!)!.hexes.get("4_7")).toEqual({ terrain: "ocean world" });
	});
});

import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { MapStore, HEX_DATA_KEYS, withoutNotePaths } from "../src/maps/MapStore";
import { parseMapNote } from "../src/maps/mapNote";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

async function gunzipJson(bytes: Uint8Array) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
	return JSON.parse(await new Response(stream).text());
}

const HEX = (fm: string, body = "# Hex\n\n### Description\nA ruined tower.\n") => `---\n${fm}\n---\n${body}`;

/** Old-format vault: map data in hex-note frontmatter. */
function oldVault(): MemVault {
	return new MemVault({
		"world/hexes/coast/1_2.md": HEX("terrain: ocean\ntags: [sea]"),
		"world/hexes/coast/3_4.md": HEX("terrain: forest\nicon: castle.png\ngm-icons:\n  - skull.png\n  - skull.png\nregion: Basin\nduckmage-submap: coast-3-4\nlocked: true"),
		"world/hexes/coast/0_0.md": HEX("gm-icon: trap.png"),
		"world/hexes/coast/5_5.md": "# No frontmatter at all\n",
		"world/hexes/coast/notes.md": HEX("terrain: lava"), // not a hex note
		"world/hexes/coast-3-4/0_0.md": HEX("terrain: hills"),
	});
}

function plugin(vault: MemVault, maps: MapData[]) {
	const saved: unknown[] = [];
	const p = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { hexFolder: "world/hexes", maps },
		getMap: (n: string) => maps.find((m) => m.name === n),
		saveData: async (s: unknown) => { saved.push(s); },
		refreshHexMap: () => {},
		saved,
	};
	return p;
}

const maps = (): MapData[] => [
	{ name: "coast", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["1_2", "3_4"] }] } as MapData,
	{ name: "coast-3-4", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, parent: { map: "coast", hex: "3_4" } } as MapData,
];

async function boot(vault: MemVault, m = maps()) {
	const p = plugin(vault, m);
	const store = new MapStore(p as never);
	await store.init();
	return { p, store };
}

describe("map store: migration from hex-note frontmatter", () => {
	let vault: MemVault;
	beforeEach(() => { vault = oldVault(); });

	it("moves every per-hex field into the map note", async () => {
		const { store } = await boot(vault);
		expect(store.get("coast", "1_2")).toEqual({ terrain: "ocean" });
		expect(store.get("coast", "3_4")).toEqual({
			terrain: "forest", icon: "castle.png", gmIcons: ["skull.png", "skull.png"],
			region: "Basin", submap: "coast-3-4", locked: true,
		});
		expect(store.get("coast", "0_0")).toEqual({ gmIcons: ["trap.png"] });
		expect(store.get("coast-3-4", "0_0")).toEqual({ terrain: "hills" });

		const note = parseMapNote(vault.files.get("world/hexes/coast/_coast.md")!)!;
		expect(note.hexes.get("3_4")?.submap).toBe("coast-3-4");
		expect(note.paths).toEqual([{ typeName: "Road", hexes: ["1_2", "3_4"] }]);
		expect(note.settings.gridSize).toEqual({ cols: 6, rows: 6 });
	});

	it("cleans hex notes: data keys gone, a link to the map note, bodies untouched", async () => {
		const before = new Map([...vault.files.keys()].map((p) => [p, vault.body(p)]));
		await boot(vault);
		for (const p of ["world/hexes/coast/1_2.md", "world/hexes/coast/3_4.md", "world/hexes/coast/0_0.md"]) {
			const fm = vault.frontmatter(p)!;
			for (const k of HEX_DATA_KEYS) expect(fm).not.toHaveProperty(k);
			expect(fm["hexmaker-map"]).toBe("[[_coast]]");
			expect(vault.body(p)).toBe(before.get(p));
		}
		// User frontmatter survives
		expect(vault.frontmatter("world/hexes/coast/1_2.md")!.tags).toEqual(["sea"]);
		// Notes without map data, and non-hex notes, are left alone
		expect(vault.files.get("world/hexes/coast/5_5.md")).toBe("# No frontmatter at all\n");
		expect(vault.frontmatter("world/hexes/coast/notes.md")!.terrain).toBe("lava");
		// No note is deleted
		expect(vault.files.has("world/hexes/coast/5_5.md")).toBe(true);
	});

	it("writes a JSON backup per map before cleaning", async () => {
		await boot(vault);
		const backups = [...vault.files.keys()].filter((p) => p.includes("/backups/map-notes-"));
		expect(backups.map((p) => p.split("/").pop()).sort()).toEqual(["coast-3-4.json", "coast.json"]);
		const b = JSON.parse(vault.files.get(backups.find((p) => p.endsWith("/coast.json"))!)!);
		expect(new Map(b.hexes).get("3_4")).toMatchObject({ terrain: "forest", locked: true });
	});

	it("keeps a gzipped full-text copy of every hex note it cleans", async () => {
		const original = new Map(vault.files);
		await boot(vault);
		const gz = [...vault.binaries.keys()].filter((p) => p.includes("/backups/map-notes-"));
		expect(gz.map((p) => p.split("/").pop()).sort()).toEqual(["coast-3-4-hex-notes.json.gz", "coast-hex-notes.json.gz"]);
		const b = await gunzipJson(vault.binaries.get(gz.find((p) => p.endsWith("/coast-hex-notes.json.gz"))!)!);
		expect(b.map).toBe("coast");
		// Exactly the notes that were cleaned, byte for byte as they were
		expect(Object.keys(b.notes).sort()).toEqual(["world/hexes/coast/0_0.md", "world/hexes/coast/1_2.md", "world/hexes/coast/3_4.md"]);
		for (const [p, text] of Object.entries(b.notes)) expect(text).toBe(original.get(p));
	});

	it("leaves hex notes untouched if the full-text backup can't be written", async () => {
		vault.failBinary = true;
		const original = new Map(vault.files);
		const { store } = await boot(vault);
		for (const p of ["world/hexes/coast/1_2.md", "world/hexes/coast/3_4.md", "world/hexes/coast-3-4/0_0.md"]) {
			expect(vault.files.get(p)).toBe(original.get(p));
		}
		// The map notes still exist and are used
		expect(store.get("coast", "3_4")?.terrain).toBe("forest");
	});

	it("never overwrites an earlier full-text backup", async () => {
		await boot(vault);
		// An old device syncs map data back into a hex note; the next start cleans it again.
		vault.files.set("world/hexes/coast/1_2.md", HEX("terrain: desert"));
		await boot(vault);
		const names = [...vault.binaries.keys()].map((p) => p.split("/").pop()).filter((n) => n!.startsWith("coast-hex"));
		expect(names.sort()).toEqual(["coast-hex-notes-2.json.gz", "coast-hex-notes.json.gz"]);
	});

	it("leaves hex notes untouched if the map note doesn't read back the same", async () => {
		// A write that drops the last table row simulates a bad save.
		vault.corrupt = (path, c) => (path.endsWith("_coast.md") ? c.replace(/\n\| 3_4 [^\n]*/, "") : c);
		const original = new Map(vault.files);
		const { store } = await boot(vault);
		for (const p of ["world/hexes/coast/1_2.md", "world/hexes/coast/3_4.md"]) {
			expect(vault.files.get(p)).toBe(original.get(p));
		}
		// The other map still migrated
		expect(vault.frontmatter("world/hexes/coast-3-4/0_0.md")!.terrain).toBeUndefined();
		expect(store.get("coast-3-4", "0_0")).toEqual({ terrain: "hills" });
	});

	it("restarting after a migration is a no-op (no hex note rewritten)", async () => {
		const m = maps();
		await boot(vault, m);
		vault.writes = [];
		const { store } = await boot(vault, m);
		expect(vault.writes).toEqual([]);
		expect(store.get("coast", "3_4")?.terrain).toBe("forest");
	});

	it("finishes an interrupted cleanup on the next start", async () => {
		const m = maps();
		await boot(vault, m);
		// Crash mid-cleanup: one hex note still carries its (same) data.
		vault.files.set("world/hexes/coast/1_2.md", HEX("terrain: ocean\ntags: [sea]"));
		const { store } = await boot(vault, m);
		expect(vault.frontmatter("world/hexes/coast/1_2.md")!.terrain).toBeUndefined();
		expect(store.get("coast", "1_2")).toEqual({ terrain: "ocean" });
	});

	it("an edit synced in from an older device wins, then gets cleaned", async () => {
		const m = maps();
		await boot(vault, m);
		// Old plugin version painted 1_2 swamp and gave 0_0 terrain
		vault.files.set("world/hexes/coast/1_2.md", HEX("terrain: swamp"));
		vault.files.set("world/hexes/coast/0_0.md", HEX("terrain: hills\ngm-icons:\n  - trap.png"));
		const { store } = await boot(vault, m);
		await store.flush();
		expect(store.get("coast", "1_2")).toEqual({ terrain: "swamp" });
		expect(store.get("coast", "0_0")).toEqual({ terrain: "hills", gmIcons: ["trap.png"] });
		expect(parseMapNote(vault.files.get("world/hexes/coast/_coast.md")!)!.hexes.get("1_2")).toEqual({ terrain: "swamp" });
		expect(vault.frontmatter("world/hexes/coast/1_2.md")!.terrain).toBeUndefined();
	});

	it("a fresh install (no maps, no hex notes) writes nothing", async () => {
		const empty = new MemVault();
		await boot(empty, []);
		expect(empty.writes).toEqual([]);
	});

	it("a map with no hex notes at all still gets a map note", async () => {
		const v = new MemVault();
		const { store } = await boot(v, [{ name: "blank", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapData]);
		expect(v.files.has("world/hexes/blank/_blank.md")).toBe(true);
		expect(store.all("blank").size).toBe(0);
	});
});

describe("map store: edits", () => {
	it("set/clear reach the map note; no hex note is created", async () => {
		const v = new MemVault();
		const { store } = await boot(v, [{ name: "m", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapData]);
		store.set("m", "1_1", { terrain: "grass", icon: "tree.png" });
		store.set("m", "2_2", { terrain: "hills" });
		store.set("m", "1_1", { icon: null });
		await store.flush();
		const note = parseMapNote(v.files.get("world/hexes/m/_m.md")!)!;
		expect(note.hexes.get("1_1")).toEqual({ terrain: "grass" });
		expect(note.hexes.get("2_2")).toEqual({ terrain: "hills" });
		expect([...v.files.keys()].filter((p) => /\/\d+_\d+\.md$/.test(p))).toEqual([]);
	});

	it("a hand edit of the map note reloads that map", async () => {
		const v = new MemVault();
		const m = [{ name: "m", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapData];
		const { store, p } = await boot(v, m);
		store.set("m", "0_0", { terrain: "grass" });
		await store.flush();
		const path = "world/hexes/m/_m.md";
		v.files.set(path, v.files.get(path)!.replace("| 0_0 |  | grass |", "| 0_0 |  | desert |").replace("cols: 3", "cols: 5"));
		store.onModify(p.app.vault.getAbstractFileByPath(path) as never);
		await store.flush();
		expect(store.get("m", "0_0")?.terrain).toBe("desert");
		expect(m[0].gridSize.cols).toBe(5);
	});

	it("renaming a hex in the map note by hand updates its note's alias, keeping the user's", async () => {
		const v = new MemVault({ "world/hexes/m/1_1.md": HEX("hexmaker-map: \"[[_m]]\"\naliases:\n  - Old Oak\n  - My alias") });
		const m = [{ name: "m", gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as MapData];
		const { store, p } = await boot(v, m);
		store.set("m", "1_1", { name: "Old Oak", terrain: "grass" });
		await store.flush();
		const path = "world/hexes/m/_m.md";
		expect(v.files.get(path)).toContain("| 1_1 | Old Oak | grass |");
		v.files.set(path, v.files.get(path)!.replace("| 1_1 | Old Oak |", "| 1_1 | Lone Oak |"));
		store.onModify(p.app.vault.getAbstractFileByPath(path) as never);
		await store.flush();
		expect(store.get("m", "1_1")?.name).toBe("Lone Oak");
		expect(v.frontmatter("world/hexes/m/1_1.md")!.aliases).toEqual(["My alias", "Lone Oak"]);
	});

	it("rename moves the note with the map", async () => {
		const v = oldVault();
		const m = maps();
		const { store } = await boot(v, m);
		// Simulate the folder move the modal does, then rename.
		for (const [path, c] of [...v.files]) {
			if (path.startsWith("world/hexes/coast/")) {
				v.files.delete(path);
				v.files.set(path.replace("world/hexes/coast/", "world/hexes/shore/"), c);
			}
		}
		m[0].name = "shore";
		await store.renameMap("coast", "shore");
		expect(v.files.has("world/hexes/shore/_shore.md")).toBe(true);
		expect(v.files.has("world/hexes/shore/_coast.md")).toBe(false);
		expect(store.get("shore", "3_4")?.terrain).toBe("forest");
	});
});

describe("map store: odd settings", () => {
	it("two maps with the same name (old data.json) migrate once, data intact", async () => {
		const v = new MemVault({
			"world/hexes/asdf/1_1.md": HEX("terrain: forest"),
			"world/hexes/asdf/2_2.md": HEX("terrain: hills\nicon: tower.png"),
		});
		const m = [
			{ name: "asdf", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, pathChains: [{ typeName: "Road", hexes: ["1_1", "2_2"] }] } as MapData,
			{ name: "asdf", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, pathChains: [] } as MapData,
		];
		const { store } = await boot(v, m);
		expect(store.get("asdf", "1_1")).toEqual({ terrain: "forest" });
		expect(store.get("asdf", "2_2")).toEqual({ terrain: "hills", icon: "tower.png" });
		const note = parseMapNote(v.files.get("world/hexes/asdf/_asdf.md")!)!;
		expect(note.hexes.size).toBe(2);
		expect(note.paths).toEqual([{ typeName: "Road", hexes: ["1_1", "2_2"] }]);
		// and a restart keeps it
		const again = await boot(v, m);
		expect(again.store.get("asdf", "2_2")?.icon).toBe("tower.png");
	});
});

describe("map store: a broken map note", () => {
	it("is never migrated over or rewritten; fixing it by hand brings it back", async () => {
		const v = oldVault();
		const m = maps();
		await boot(v, m);
		const path = "world/hexes/coast/_coast.md";
		const good = v.files.get(path)!;
		const broken = good.replace("hexmaker-map: 1", "hexmaker-mpa: 1");
		v.files.set(path, broken);
		const { store, p } = await boot(v, m);
		store.set("coast", "9_9", { terrain: "lava" });
		await store.flush();
		expect(v.files.get(path)).toBe(broken);
		// hex notes were not touched either
		expect(v.frontmatter("world/hexes/coast/3_4.md")!["hexmaker-map"]).toBe("[[_coast]]");
		// the user fixes it
		v.files.set(path, good);
		store.onModify(p.app.vault.getAbstractFileByPath(path) as never);
		await store.flush();
		expect(store.get("coast", "3_4")?.terrain).toBe("forest");
	});
});

describe("map store: paths live only in the map note", () => {
	it("data.json leaves out the paths of maps whose note holds them", async () => {
		const v = new MemVault();
		const m = maps();
		const { store } = await boot(v, m);
		const settings = { maps: m, other: 1 };
		const disk = withoutNotePaths(settings, (n) => store.holdsPaths(n));
		expect(disk.maps.every((x) => !("pathChains" in x))).toBe(true);
		expect(disk.other).toBe(1);
		// In memory nothing changed.
		expect(m[0].pathChains).toHaveLength(1);
		// Their notes have them.
		expect(parseMapNote(v.files.get("world/hexes/coast/_coast.md")!)!.paths).toEqual(m[0].pathChains);
	});

	it("a map whose note can't be read keeps its paths in data.json", async () => {
		const v = new MemVault({ "world/hexes/coast/_coast.md": "---\nbroken: [\n---\n" });
		const { store } = await boot(v);
		expect(store.holdsPaths("coast")).toBe(false);
		expect(store.holdsPaths("coast-3-4")).toBe(true);
	});

	it("a data.json synced in from another device doesn't overwrite the notes' paths", async () => {
		const v = new MemVault();
		const m = maps();
		const { store, p } = await boot(v, m);
		// Sync replaces data.json: fresh map objects without paths.
		const fresh = maps().map((x) => ({ ...x, pathChains: [] }));
		p.settings.maps.splice(0, p.settings.maps.length, ...fresh);
		await store.reloadFromNotes();
		expect(fresh[0].pathChains).toEqual([{ typeName: "Road", hexes: ["1_2", "3_4"] }]);
		await store.sync();
		expect(parseMapNote(v.files.get("world/hexes/coast/_coast.md")!)!.paths).toHaveLength(1);
	});
});

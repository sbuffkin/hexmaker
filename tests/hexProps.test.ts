/**
 * Hex-note properties (owner MG4): the pure rules (src/maps/hexProps.ts),
 * the two-way sync on a real MapStore over an in-memory vault
 * (src/maps/hexPropsSync.ts), and the one-time step that adds them
 * (src/migrations/unreleased-hex-note-properties.ts).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { Notice } from "./__mocks__/obsidian";
import { MapStore } from "../src/maps/MapStore";
import { HexPropsSync, type HexPropsHost } from "../src/maps/hexPropsSync";
import { planPropsSync, propsOf, readProps, setPropsInFm, setPropsInText, yamlScalar, type HexProps } from "../src/maps/hexProps";
import { hexNoteProperties, withHexProps } from "../src/migrations/unreleased-hex-note-properties";
import { runRewrite, type NoteFormatHost } from "../src/migrations/noteRewrites";
import { setModeMapLookup } from "../src/modeGate";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

// ── the rules ───────────────────────────────────────────────────────────────

describe("hex-note properties: what the note says and what the map says", () => {
	it("are the hex's terrain, area, icon and name", () => {
		expect(propsOf({ terrain: "forest", region: "Basin", icon: "castle.png", name: "Glass Wastes", gmIcons: ["x.png"], locked: true })).toEqual({ terrain: "forest", area: "Basin", icon: "castle.png", name: "Glass Wastes" });
		expect(propsOf(undefined)).toEqual({});
	});

	it("reads area, else the 1.5 region key; links read as their name; lists of one are fine", () => {
		expect(readProps({ terrain: "forest", region: "Basin" })).toEqual({ props: { terrain: "forest", area: "Basin" }, unreadable: [], oldAreaKey: true });
		expect(readProps({ area: "[[Basin]]", region: "Old" }).props).toEqual({ area: "Basin" });
		expect(readProps({ name: 42, icon: ["castle.png"], terrain: "  " }).props).toEqual({ name: "42", icon: "castle.png" });
		expect(readProps({ terrain: ["a", "b"], area: { x: 1 } })).toMatchObject({ props: {}, unreadable: ["terrain", "area"] });
		expect(readProps(undefined)).toEqual({ props: {}, unreadable: [], oldAreaKey: false });
	});

	it("tells a hand edit from a stale copy; the map wins when both changed", () => {
		const note = (props: HexProps) => ({ props, unreadable: [], oldAreaKey: false });
		// The note still shows what was written; the map changed: a stale copy (rewritten).
		expect(planPropsSync(note({ terrain: "forest" }), { terrain: "hills" }, { terrain: "forest" })).toEqual({ imports: {}, mapWon: [] });
		// The note changed, the map didn't: a hand edit.
		expect(planPropsSync(note({ terrain: "swamp" }), { terrain: "forest" }, { terrain: "forest" })).toEqual({ imports: { terrain: "swamp" }, mapWon: [] });
		// Cleared by hand.
		expect(planPropsSync(note({}), { terrain: "forest" }, { terrain: "forest" }).imports).toEqual({ terrain: null });
		// Both changed: the map note wins.
		expect(planPropsSync(note({ terrain: "swamp" }), { terrain: "hills" }, { terrain: "forest" })).toEqual({ imports: {}, mapWon: ["terrain"] });
		// No record (a note this device never wrote): only what the map lacks comes from the note.
		expect(planPropsSync(note({ terrain: "swamp", name: "Fen" }), { terrain: "hills" }, undefined)).toEqual({ imports: { name: "Fen" }, mapWon: [] });
		// An unreadable value is never taken.
		expect(planPropsSync({ props: {}, unreadable: ["terrain"], oldAreaKey: false }, { terrain: "hills" }, { terrain: "x" }).imports).toEqual({});
	});

	it("rewrites only its own keys in the text, in place; new ones go last", () => {
		const text = "---\nmap: \"[[_coast]]\"\nterrain: forest # mine\ntags: [a]\n---\n# Hex\n";
		expect(setPropsInText(text, { terrain: "hills", area: "Basin" })).toBe("---\nmap: \"[[_coast]]\"\nterrain: hills\ntags: [a]\narea: Basin\n---\n# Hex\n");
		expect(setPropsInText(text, {})).toBe("---\nmap: \"[[_coast]]\"\ntags: [a]\n---\n# Hex\n");
		// Nothing to change: the very same text.
		const same = "---\nterrain: hills\n---\nbody";
		expect(setPropsInText(same, { terrain: "hills" })).toBe(same);
	});

	it("puts area where region was, drops list values with their key, keeps CRLF", () => {
		expect(setPropsInText("---\nregion: Basin\nicon:\n  - a.png\nx: 1\n---\n", { area: "Basin" })).toBe("---\narea: Basin\nx: 1\n---\n");
		expect(setPropsInText("---\r\nterrain: a\r\n---\r\nbody\r\n", { terrain: "b" })).toBe("---\r\nterrain: b\r\n---\r\nbody\r\n");
	});

	it("adds a frontmatter only when there's something to write, and removes one it emptied", () => {
		expect(setPropsInText("# Hex\n", {})).toBe("# Hex\n");
		expect(setPropsInText("# Hex\n", { terrain: "forest" })).toBe("---\nterrain: forest\n---\n# Hex\n");
		expect(setPropsInText("---\nterrain: forest\n---\n# Hex\n", {})).toBe("# Hex\n");
	});

	it("leaves fields it's told to keep", () => {
		expect(setPropsInText("---\nname: Mine\nterrain: a\n---\n", { terrain: "b" }, ["name"])).toBe("---\nname: Mine\nterrain: b\n---\n");
		expect(withHexProps("---\nname: Mine\n---\n", { terrain: "b" })).toBe("---\nname: Mine\nterrain: b\n---\n");
	});

	it("quotes values YAML would read as something else", () => {
		expect(yamlScalar("forest")).toBe("forest");
		expect(yamlScalar("desert rocky")).toBe("desert rocky");
		expect(yamlScalar("true")).toBe('"true"');
		expect(yamlScalar("12")).toBe('"12"');
		expect(yamlScalar("a: b")).toBe('"a: b"');
		expect(yamlScalar("#tag")).toBe('"#tag"');
	});

	it("frontmatter objects: same keys, area where region was, kept fields alone", () => {
		const fm: Record<string, unknown> = { terrain: "forest", region: "Basin", tags: ["a"], name: "Mine" };
		setPropsInFm(fm, { terrain: "Forest", area: "Basin" }, ["name"]);
		expect(Object.entries(fm)).toEqual([["terrain", "Forest"], ["area", "Basin"], ["tags", ["a"]], ["name", "Mine"]]);
	});
});

// ── the sync, on a real MapStore ────────────────────────────────────────────

const HEX = (fm: string, body = "# Hex\n\n### Description\nA ruined tower.\n") => `---\n${fm}\n---\n${body}`;
const P12 = "world/hexes/coast/1_2.md";
const P34 = "world/hexes/coast/3_4.md";

interface Rig {
	vault: MemVault;
	store: MapStore;
	sync: HexPropsSync;
	host: HexPropsHost & { active: string | null; undone: () => void; names: string[]; tableLinks: string[] };
	maps: MapData[];
	settings: { hexFolder: string; maps: MapData[]; hexNoteProperties?: boolean };
}

async function rig(vault: MemVault, opts: { props?: boolean; maps?: MapData[] } = {}): Promise<Rig> {
	const maps = opts.maps ?? [{ name: "coast", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 } } as MapData];
	const settings = { hexFolder: "world/hexes", maps, ...(opts.props === false ? { hexNoteProperties: false } : {}) };
	const app = vault.app() as unknown as HexPropsHost["app"] & Record<string, unknown>;
	const plugin = {
		app, manifest: { dir: ".obsidian/plugins/hexmaker" }, settings,
		getMap: (n: string) => maps.find((m) => m.name === n),
		saveData: async () => {}, refreshHexMap: () => {},
	};
	const store = new MapStore(plugin as never);
	await store.init();
	let last: { map: string; key: string; before: Record<string, unknown> | undefined }[] = [];
	const host = {
		app, manifest: plugin.manifest, settings, mapStore: store,
		getMap: plugin.getMap,
		getMapPalette: () => ["ocean", "Forest", "hills", "swamp"].map((name) => ({ name, color: "#000" })),
		availableIcons: ["castle.png", "tower.png"],
		mapLabel: (m: string) => m[0].toUpperCase() + m.slice(1),
		undoableEdit: async <T,>(_map: string, fn: () => T | Promise<T>) => {
			const r = await store.record(fn);
			last = r.cells.map((c) => ({ map: c.map, key: c.key, before: c.before as Record<string, unknown> | undefined }));
			return r.result;
		},
		setHexName: async (map: string, x: number, y: number, name: string) => { host.names.push(name); store.set(map, `${x}_${y}`, { name: name || null }, "edit-note"); },
		syncHexEncounterTableLink: async (path: string, t: string | null) => { host.tableLinks.push(`${path}=${t}`); },
		active: null as string | null,
		names: [] as string[],
		tableLinks: [] as string[],
		undone: () => { for (const c of last) store.set(c.map, c.key, { terrain: null, region: null, icon: null, name: null, ...(c.before ?? {}) }); },
	};
	app.workspace = { getActiveFile: () => (host.active ? Object.assign(new TFile(), { path: host.active }) : null) } as never;
	const sync = new HexPropsSync(host as never);
	await sync.start();
	Notice.shown = []; // the map-note move's own notices
	return { vault, store, sync, host: host as Rig["host"], maps, settings };
}

/** A hand edit of a note (as typed, or in the properties panel): the text changes, the change event fires. */
function edit(r: Rig, path: string, fn: (text: string) => string): void {
	const next = fn(r.vault.files.get(path)!);
	r.vault.files.set(path, next);
	r.sync.onMetadataChanged(r.vault.app().vault.getAbstractFileByPath(path) as TFile, next);
}

const fm = (r: Rig, path: string) => r.vault.frontmatter(path);

function oldVault(): MemVault {
	return new MemVault({
		[P12]: HEX("terrain: ocean\ntags: [sea]"),
		[P34]: HEX("terrain: forest\nicon: castle.png\nregion: Basin"),
		"world/hexes/coast/0_0.md": "# Just prose\n",
	});
}

describe("hex-note properties sync: map → notes", () => {
	beforeEach(() => { Notice.shown = []; setModeMapLookup(null); });
	afterEach(() => setModeMapLookup(null));

	it("an upgraded vault keeps the properties; starting writes nothing more", async () => {
		const vault = oldVault();
		const r = await rig(vault);
		expect(fm(r, P34)).toEqual({ terrain: "forest", icon: "castle.png", area: "Basin", map: "[[_coast]]" });
		expect(r.sync.writes).toBe(0);
	});

	it("paint → the note's property, coalesced; a hex without a note gets none", async () => {
		const r = await rig(oldVault());
		r.store.set("coast", "1_2", { terrain: "hills" }, "paint-terrain");
		r.store.set("coast", "1_2", { terrain: "swamp" }, "paint-terrain");
		r.store.set("coast", "5_5", { terrain: "hills" }, "paint-terrain");
		r.store.set("coast", "0_0", { icon: "tower.png", region: "Basin" });
		await r.sync.flush();
		expect(fm(r, P12)).toEqual({ terrain: "swamp", tags: ["sea"], map: "[[_coast]]" });
		expect(r.vault.files.has("world/hexes/coast/5_5.md")).toBe(false);
		expect(r.vault.files.get("world/hexes/coast/0_0.md")).toBe("---\narea: Basin\nicon: tower.png\n---\n# Just prose\n");
		expect(r.sync.writes).toBe(2);
		// Cleared on the map: the property goes.
		r.store.set("coast", "1_2", { terrain: null }, "paint-terrain");
		await r.sync.flush();
		expect(fm(r, P12)).toEqual({ tags: ["sea"], map: "[[_coast]]" });
	});

	it("our own write's change event is an echo: nothing is imported", async () => {
		const r = await rig(oldVault());
		r.store.set("coast", "1_2", { terrain: "hills" }, "paint-terrain");
		await r.sync.flush();
		const writes = r.vault.writes.length;
		r.sync.onMetadataChanged(r.vault.app().vault.getAbstractFileByPath(P12) as TFile, r.vault.files.get(P12)!);
		await r.sync.flush();
		expect(r.vault.writes.length).toBe(writes);
		expect(r.store.get("coast", "1_2")?.terrain).toBe("hills");
	});

	it("a restart with nothing changed writes nothing (memory saved and read back)", async () => {
		const r = await rig(oldVault());
		r.store.set("coast", "1_2", { terrain: "hills" }, "paint-terrain");
		await r.sync.flush();
		await r.store.flush();
		await r.sync.memory.save();
		const before = new Map(r.vault.files);
		const writes = r.vault.writes.length;
		const again = await rig(r.vault);
		expect(again.sync.writes).toBe(0);
		expect(r.vault.writes.length).toBe(writes);
		for (const p of [P12, P34]) expect(r.vault.files.get(p)).toBe(before.get(p));
	});

	it("off: nothing is written and nothing followed", async () => {
		const r = await rig(oldVault(), { props: false });
		expect(fm(r, P34)).toEqual({ map: "[[_coast]]" });
		r.store.set("coast", "3_4", { terrain: "hills" }, "paint-terrain");
		await r.sync.flush();
		expect(fm(r, P34)).toEqual({ map: "[[_coast]]" });
	});
});

describe("hex-note properties sync: notes → map", () => {
	beforeEach(() => { Notice.shown = []; setModeMapLookup(null); });
	afterEach(() => setModeMapLookup(null));

	it("a hand edit goes to the map (palette spelling), as one undo step; undo puts both back", async () => {
		const r = await rig(oldVault());
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: forest"));
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("Forest");
		expect(fm(r, P12)?.terrain).toBe("Forest"); // the map's spelling written back
		expect(r.host.tableLinks).toEqual([`${P12}=Forest`]);
		r.host.undone();
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("ocean");
		expect(fm(r, P12)?.terrain).toBe("ocean");
	});

	it("area (and the old region key), icon and name edits go to the map", async () => {
		const r = await rig(oldVault());
		edit(r, P34, (t) => t.replace("area: Basin", "region: Dustbowl").replace("icon: castle.png", "icon: Tower.png"));
		await r.sync.flush();
		expect(r.store.get("coast", "3_4")).toMatchObject({ region: "Dustbowl", icon: "tower.png" });
		expect(fm(r, P34)).toEqual({ terrain: "forest", icon: "tower.png", area: "Dustbowl", map: "[[_coast]]" });
		edit(r, P34, (t) => t.replace("---\n#", "name: Glass Wastes\n---\n#"));
		await r.sync.flush();
		expect(r.host.names).toEqual(["Glass Wastes"]);
		expect(r.store.get("coast", "3_4")?.name).toBe("Glass Wastes");
	});

	it("the map wins when the map and the note changed the same field at once", async () => {
		const r = await rig(oldVault());
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: swamp"));
		r.store.set("coast", "1_2", { terrain: "hills" }, "paint-terrain");
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("hills");
		expect(fm(r, P12)?.terrain).toBe("hills");
	});

	it("a value the palette doesn't have is put back, with a notice", async () => {
		const r = await rig(oldVault());
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: lava"));
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("ocean");
		expect(fm(r, P12)?.terrain).toBe("ocean");
		expect(Notice.shown.map((n) => n.msg)).toEqual(['Coast 1, 2: not put on the map (terrain "lava": isn\'t in this map\'s palette). The note\'s property was put back.']);
	});

	it("a mode that locks painting refuses the edit: put back, with the usual hint", async () => {
		const r = await rig(oldVault());
		r.maps[0].workMode = "play";
		setModeMapLookup((n) => r.maps.find((m) => m.name === n));
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: hills"));
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("ocean");
		expect(fm(r, P12)?.terrain).toBe("ocean");
		expect(Notice.shown[0]?.msg).toContain("Switch to Build to paint terrain");
	});

	it("while the note is open, a refused edit is left as typed until the note is left", async () => {
		const r = await rig(oldVault());
		r.host.active = P12;
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: hil"));
		await r.sync.flush();
		expect(fm(r, P12)?.terrain).toBe("hil");
		expect(Notice.shown).toEqual([]);
		// Typed on: a value the palette has goes straight to the map; the text is left alone.
		const typed = r.vault.files.get(P12)!.replace("terrain: hil", "terrain: HILLS");
		edit(r, P12, () => typed);
		await r.sync.flush();
		expect(r.store.get("coast", "1_2")?.terrain).toBe("hills");
		expect(r.vault.files.get(P12)).toBe(typed);
		// Left: the map's spelling goes back in.
		r.host.active = null;
		r.sync.onFileOpen(null);
		edit(r, P12, (t) => t); // the next change event settles it
		await r.sync.flush();
		expect(fm(r, P12)?.terrain).toBe("hills");
	});

	it("leaving a note with a refused edit puts it back then", async () => {
		const r = await rig(oldVault());
		r.sync.onFileOpen(r.vault.app().vault.getAbstractFileByPath(P12) as TFile);
		r.host.active = P12;
		edit(r, P12, (t) => t.replace("terrain: ocean", "terrain: lava"));
		await r.sync.flush();
		expect(fm(r, P12)?.terrain).toBe("lava");
		r.host.active = null;
		r.sync.onFileOpen(null);
		await r.sync.flush();
		expect(fm(r, P12)?.terrain).toBe("ocean");
		expect(Notice.shown).toHaveLength(1);
	});

	it("a note's own name the map lacks is taken onto the map (no record yet)", async () => {
		const vault = new MemVault({ [P12]: HEX('map: "[[_coast]]"\nname: Saltmarsh') });
		const r = await rig(vault);
		expect(r.store.get("coast", "1_2")?.name).toBe("Saltmarsh");
		expect(fm(r, P12)).toEqual({ map: "[[_coast]]", name: "Saltmarsh" });
	});
});

// ── the one-time step ───────────────────────────────────────────────────────

describe("unreleased-hex-note-properties: notes stripped by the map-note move get their properties back", () => {
	async function stripped() {
		// An unreleased build moved the map data and stripped the notes.
		const vault = new MemVault({
			[P12]: HEX("terrain: ocean\nregion: Basin\ntags: [sea]"),
			[P34]: HEX("terrain: forest\nicon: castle.png"),
		});
		const maps = [{ name: "coast", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 } } as MapData];
		const settings: NoteFormatHost["settings"] = { hexFolder: "world/hexes", maps, noteFormatUpgrades: [], hexNoteProperties: false };
		const plugin = { app: vault.app(), manifest: { dir: ".obsidian/plugins/hexmaker" }, settings, getMap: (n: string) => maps.find((m) => m.name === n), saveData: async () => {}, refreshHexMap: () => {} };
		const store = new MapStore(plugin as never);
		await store.init();
		expect(vault.frontmatter(P34)).toEqual({ map: "[[_coast]]" });
		delete settings.hexNoteProperties;
		// A name of the note's own, which the map doesn't have.
		vault.files.set(P34, vault.files.get(P34)!.replace('map: "[[_coast]]"', 'map: "[[_coast]]"\nname: Mine'));
		const remembered = new Map<string, HexProps>();
		const host: NoteFormatHost = {
			app: vault.app() as never, manifest: plugin.manifest, settings, mapStore: store,
			hexMapDataView: (map, x, y) => ({ map, mapLabel: map, x, y }),
			hexProps: { remember: (p, v) => { remembered.set(p, v); } },
			saveSettings: async () => {},
		};
		return { vault, host, remembered, settings };
	}

	it("adds them once, backed up first, keeping the note's own values", async () => {
		const { vault, host, remembered } = await stripped();
		const r = await runRewrite(host, hexNoteProperties);
		expect(r.changed.sort()).toEqual([P12, P34]);
		expect(vault.files.get(P12)).toBe(HEX('tags:\n  - sea\nmap: "[[_coast]]"\nterrain: ocean\narea: Basin'));
		expect(vault.files.get(P34)).toBe(HEX('map: "[[_coast]]"\nname: Mine\nterrain: forest\nicon: castle.png'));
		expect(r.backup).toContain("hex-properties");
		expect(remembered.get(P12)).toEqual({ terrain: "ocean", area: "Basin" });
		const again = await runRewrite(host, hexNoteProperties);
		expect(again.changed).toEqual([]);
		expect(again.backup).toBeUndefined();
	});

	it("does nothing when the setting is off", async () => {
		const { host, settings } = await stripped();
		settings.hexNoteProperties = false;
		expect((await runRewrite(host, hexNoteProperties)).changed).toEqual([]);
	});
});

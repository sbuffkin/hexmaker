import { describe, it } from "node:test";
import expect from "expect";
import {
	withMapLink,
	buildMapNote,
	hexRowsToWrite,
	mapNoteKey,
	parseMapNote,
	updateMapNote,
	readMapNote,
	refreshProblemCallouts,
	parseHexKey,
	HELP_CALLOUT,
	type HexData,
	type MapNoteData,
} from "../src/maps/mapNote";
import type { MapPath } from "../src/types";

/** An old every-hex path as the reader makes it: every hex an anchor, named after its type. */
const dense = (typeName: string, hexes: string[], more: Partial<MapPath> = {}): MapPath => ({ name: typeName, typeName, branches: [{ anchors: hexes }], ...more });

const sample = (): MapNoteData => ({
	settings: {
		paletteName: "Default",
		gridSize: { cols: 38, rows: 25 },
		gridOffset: { x: -2, y: 0 },
		staggerOffset: "even",
		terrainType: "grass",
		createdWith: "1.5.6",
		showCoords: false,
		showFactionOverlay: true,
		parent: { map: "the-north", hex: "3_4" },
		world: { id: "wabc", cx: 1, cy: -1 },
		backgroundImage: { path: "maps/bg.png", offsetX: 10, offsetY: -5, scale: 1.5, rotation: 0, opacity: 0.8 },
		gridDisplayScaleX: 1.02,
	},
	hexes: new Map<string, HexData>([
		["3_4", { terrain: "dunes", region: "Basin" }],
		["-1_0", { terrain: "ocean" }],
		["12_9", { terrain: "forest", icon: "bw-castle.png", gmIcons: ["skull.png", "skull.png"], locations: ["the-coast-12-9"], locked: true }],
		["5_5", {}],
	]),
	paths: [
		{ name: "King's Road", typeName: "Road", notes: "Paved | mostly", branches: [{ anchors: ["3_4", "5_4"] }, { anchors: ["4_4", "4_6"], label: "to the mill" }] },
		{ name: "Big River", typeName: "River | big", branches: [{ anchors: ["0_0", "0_1"] }], extra: { Ford: "at 0, 1" } },
	],
});

describe("map notes", () => {
	it("round-trips settings, hexes and paths", () => {
		const data = sample();
		const back = parseMapNote(buildMapNote("the-coast", data))!;
		expect(back.settings).toEqual(data.settings);
		expect([...back.hexes].sort()).toEqual(hexRowsToWrite(data.hexes).sort());
		expect(back.paths).toEqual(data.paths);
		expect(mapNoteKey(back)).toBe(mapNoteKey(data));
	});

	it("keeps unknown MapData fields in a catch-all instead of dropping them", () => {
		const data = sample();
		(data.settings as Record<string, unknown>).futureThing = { a: [1, 2] };
		const back = parseMapNote(buildMapNote("m", data))!;
		expect((back.settings as Record<string, unknown>).futureThing).toEqual({ a: [1, 2] });
	});

	it("never stores the name, viewport or paths in frontmatter", () => {
		const data = sample();
		const s = data.settings as Record<string, unknown>;
		s.name = "x"; s.savedViewport = { zoom: 2, panX: 0, panY: 0, fontSize: "" }; s.pathChains = [];
		const note = buildMapNote("m", data);
		expect(note).not.toContain("savedViewport");
		expect(note).not.toContain("hexmaker-extra");
	});

	it("is not fooled by notes that aren't map notes", () => {
		expect(parseMapNote("# just a note")).toBeNull();
		expect(parseMapNote("---\ntags: x\n---\n| Hex | Terrain |\n|---|---|\n| 1_1 | a |")).toBeNull();
	});

	it("handles CRLF and hand-edited tables (reordered columns, blank cells)", () => {
		const note = "---\r\nhexmaker-map: 1\r\ncols: 3\r\nrows: 2\r\n---\r\n| Terrain | Hex | Locked |\r\n|---|---|---|\r\n| ocean | 0_0 | |\r\n| hills | 2_1 | yes |\r\n| | 1_1 | |\r\n";
		const d = parseMapNote(note)!;
		expect(d.settings.gridSize).toEqual({ cols: 3, rows: 2 });
		expect(d.hexes.get("0_0")).toEqual({ terrain: "ocean" });
		expect(d.hexes.get("2_1")).toEqual({ terrain: "hills", locked: true });
		expect(d.hexes.get("1_1")).toEqual({});
	});

	it("rewrites only its own parts, keeping the user's prose and frontmatter", () => {
		const data = sample();
		const user = buildMapNote("m", data)
			.replace("---\n# m", "tags: [campaign]\n---\n# m\n\nMy notes about this region.")
			+ "\n## Session log\nWe crossed the river.\n";
		data.hexes.set("3_4", { terrain: "forest" });
		data.settings.showCoords = true;
		const out = updateMapNote(user, "m", data);
		expect(out).toContain("tags: [campaign]");
		expect(out).toContain("My notes about this region.");
		expect(out).toContain("## Session log\nWe crossed the river.");
		const back = parseMapNote(out)!;
		expect(back.hexes.get("3_4")).toEqual({ terrain: "forest" });
		expect(back.settings.showCoords).toBe(true);
		expect(out.match(/## Hexes/g)).toHaveLength(1);
	});

	it("sparse rows: hexes with only the base terrain (or nothing) aren't written", () => {
		const hexes = new Map<string, HexData>([
			["0_0", { terrain: "void" }],
			["1_0", { terrain: "star" }],
			["2_0", { terrain: "void", icon: "x.png" }],
			["3_0", {}],
		]);
		expect(hexRowsToWrite(hexes, "void").map(([k]) => k)).toEqual(["1_0", "2_0"]);
		expect(hexRowsToWrite(hexes).map(([k]) => k)).toEqual(["0_0", "1_0", "2_0"]);
	});

	it("display name: round-trips as display-name and heads the note", () => {
		for (const displayName of ["Barony of Saltmere", "Cole's Ford: the crossing", "1984", "Thornwood #2"]) {
			const data: MapNoteData = { settings: { paletteName: "Default", displayName }, hexes: new Map(), paths: [] };
			const note = buildMapNote("barony-of-saltmere", data);
			expect(note).toContain("display-name: ");
			expect(note).toContain(`# ${displayName}`);
			expect(parseMapNote(note)!.settings.displayName).toBe(displayName);
			// An update (e.g. a rename) rewrites the key in place, once.
			const renamed = updateMapNote(note, "barony-of-saltmere", { ...data, settings: { ...data.settings, displayName: "New" } });
			expect(parseMapNote(renamed)!.settings.displayName).toBe("New");
			expect(renamed.match(/display-name:/g)).toHaveLength(1);
		}
		// Maps from before display names: no key, the slug heads the note.
		const old = buildMapNote("thornwood", { settings: { paletteName: "Default" }, hexes: new Map(), paths: [] });
		expect(old).not.toContain("display-name");
		expect(old).toContain("# thornwood");
		expect(parseMapNote(old)!.settings.displayName).toBeUndefined();
	});

	it("strings that look like YAML specials survive", () => {
		const data: MapNoteData = { settings: { paletteName: "true", terrainType: "123", createdWith: "1.5" }, hexes: new Map(), paths: [] };
		const back = parseMapNote(buildMapNote("m", data))!;
		expect(back.settings.paletteName).toBe("true");
		expect(back.settings.terrainType).toBe("123");
	});

	it("handles a big map quickly (chult-sized)", () => {
		const hexes = new Map<string, HexData>();
		for (let x = 0; x < 63; x++) for (let y = 0; y < 61; y++) hexes.set(`${x}_${y}`, { terrain: (x + y) % 3 ? "grass" : "forest" });
		const t0 = Date.now();
		const back = parseMapNote(buildMapNote("chult", { settings: { gridSize: { cols: 63, rows: 61 } }, hexes, paths: [] }))!;
		expect(back.hexes.size).toBe(3843);
		expect(Date.now() - t0).toBeLessThan(1500);
	});
});

describe("unknown table columns (forward compatibility)", () => {
	// A note written by a newer build: Hexes has "Ruler" + "Rumours",
	// Paths has a "Name" column. This build must keep them on every rewrite.
	const newer = [
		"---", "hexmaker-map: 1", "cols: 4", "rows: 4", "---", "# m", "",
		"## Hexes", "",
		"| Hex | Name | Terrain | Icon | GM icons | Region | Ruler | Rumours | Locked |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		"| 1_1 |  | forest |  |  | Basin | fenmarch | saltmere, old-mine |  |",
		"| 2_1 |  | hills |  |  |  |  |  | yes |",
		"| 3_1 |  |  |  |  |  | reedholm |  |  |",
		"", "## Paths", "",
		"| Type | Hexes | Name |",
		"| --- | --- | --- |",
		"| Road | 1_1 2_1 | King's \\| Way |",
		"| River | 0_0 0_1 |  |",
		"",
	].join("\n");

	it("parses unknown columns into opaque per-hex extras", () => {
		const d = parseMapNote(newer)!;
		expect(d.hexes.get("1_1")).toEqual({ terrain: "forest", region: "Basin", extra: { "Ruler": "fenmarch", Rumours: "saltmere, old-mine" } });
		expect(d.hexes.get("2_1")).toEqual({ terrain: "hills", locked: true });
		// A hex whose only data is in an unknown column is still a row.
		expect(d.hexes.get("3_1")).toEqual({ extra: { "Ruler": "reedholm" } });
		expect(d.paths[0]).toEqual(dense("Road", ["1_1", "2_1"], { extra: { Name: "King's | Way" } }));
		expect(d.paths[1]).toEqual(dense("River", ["0_0", "0_1"]));
		expect(d.legacyPaths).toEqual(["Road", "River"]);
	});

	it("round-trips unknown columns through parse → update → parse, in their original order", () => {
		const d = parseMapNote(newer)!;
		const out = updateMapNote(newer, "m", d);
		const header = out.split("\n").find((l) => l.startsWith("| Hex"))!;
		expect(header.indexOf("Ruler")).toBeGreaterThan(0);
		expect(header.indexOf("Ruler")).toBeLessThan(header.indexOf("Rumours"));
		const back = parseMapNote(out)!;
		expect([...back.hexes]).toEqual([...d.hexes]);
		expect(back.paths).toEqual(d.paths);
		expect(mapNoteKey(back)).toBe(mapNoteKey(d));
		// and through a fresh build too
		const rebuilt = parseMapNote(buildMapNote("m", back))!;
		expect([...rebuilt.hexes]).toEqual([...d.hexes]);
		expect(rebuilt.paths).toEqual(d.paths);
	});

	it("edits to known columns keep the unknown values", () => {
		const d = parseMapNote(newer)!;
		// what MapStore.set does: spread the old hex, patch known fields
		d.hexes.set("1_1", { ...d.hexes.get("1_1")!, terrain: "swamp", name: "Fen" });
		d.hexes.set("3_1", { ...d.hexes.get("3_1")!, terrain: "grass" });
		d.paths[0] = { ...d.paths[0], branches: [{ anchors: [...d.paths[0].branches[0].anchors, "3_1"] }] };
		const back = parseMapNote(updateMapNote(newer, "m", d))!;
		expect(back.hexes.get("1_1")).toEqual({ name: "Fen", terrain: "swamp", region: "Basin", extra: { "Ruler": "fenmarch", Rumours: "saltmere, old-mine" } });
		expect(back.hexes.get("3_1")).toEqual({ terrain: "grass", extra: { "Ruler": "reedholm" } });
		expect(back.paths[0].extra).toEqual({ Name: "King's | Way" });
		expect(back.paths[0].branches[0].anchors).toEqual(["1_1", "2_1", "3_1"]);
	});

	it("a hex with only the base terrain plus an unknown value is still written", () => {
		const hexes = new Map<string, HexData>([["0_0", { terrain: "void", extra: { Rumours: "a" } }], ["1_0", { terrain: "void" }]]);
		expect(hexRowsToWrite(hexes, "void").map(([k]) => k)).toEqual(["0_0"]);
	});

	it("notes without unknown columns are written exactly as before", () => {
		const note = buildMapNote("m", sample());
		expect(note).toContain("| Hex | Name | Terrain | Icon | GM icons | Region | Locations | Locked |\n");
		expect(note).toContain("| Path | Type | Route | Notes | Ford |\n");
		expect(note).toContain("| Path | Branch | Anchors |\n");
	});

	it("keeps the column order (and header spelling) the user gave both tables", () => {
		const reordered = [
			"---", "hexmaker-map: 3", "---", "# m", "",
			"## Hexes", "",
			"| Terrain | Rumours | Hex | Name | Locked | Locations | Region | GM icons | Icon |",
			"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
			"| forest | saltmere | 1_1 | Fen |  |  |  |  |  |",
			"| hills |  | 2_1 |  | yes |  |  |  |  |",
			"", "## Paths", "",
			"| Name | Hexes | Type |",
			"| --- | --- | --- |",
			"| King's Way | 1_1 2_1 | Road |",
			"",
		].join("\n");
		const d = parseMapNote(reordered)!;
		// Converted once: the derived Summary is added, the old Paths table becomes Paths + Path routes (its extra column kept).
		const current = updateMapNote(reordered, "m", d);
		expect(current).toContain(reordered.slice(reordered.indexOf("| Terrain | Rumours"), reordered.indexOf("\n\n## Paths")));
		expect(current).toContain("| Path | Type | Route | Notes | Name |\n| --- | --- | --- | --- | --- |\n| Road | Road | 1, 1 → 2, 1 |  | King's Way |");
		expect(current).toContain("## Path routes\n\n| Path | Branch | Anchors |\n| --- | --- | --- |\n| Road | main | 1, 1 → 2, 1 |");
		expect(updateMapNote(current, "m", parseMapNote(current)!)).toBe(current);
		// an edit rewrites values in place, order unchanged (and the legend follows)
		d.hexes.set("2_1", { ...d.hexes.get("2_1")!, terrain: "swamp" });
		const out = updateMapNote(current, "m", d);
		expect(out).toBe(current.replace("| hills |  | 2_1 |", "| swamp |  | 2_1 |").replace("| hills | 1 |", "| swamp | 1 |"));
	});

	it("appends known columns a hand-made table lacks at the end", () => {
		const old = "---\nhexmaker-map: 1\n---\n| Terrain | Hex | Notes |\n|---|---|---|\n| ocean | 0_0 | deep |\n";
		const d = parseMapNote(old)!;
		d.hexes.set("0_0", { ...d.hexes.get("0_0")!, name: "Sea" });
		const out = updateMapNote(old, "m", d);
		const header = out.split("\n").find((l) => l.includes("| Hex |"))!;
		expect(header).toBe("| Terrain | Hex | Notes | Name | Icon | GM icons | Region | Locations | Locked |");
		expect(parseMapNote(out)!.hexes.get("0_0")).toEqual({ name: "Sea", terrain: "ocean", extra: { Notes: "deep" } });
	});

	it("unknown values change the comparison key", () => {
		const d = parseMapNote(newer)!;
		const before = mapNoteKey(d);
		d.hexes.set("3_1", { extra: { "Ruler": "other" } });
		expect(mapNoteKey(d)).not.toBe(before);
	});
});

describe("region biome", () => {
	const withBiome = (biome: unknown): MapNoteData => ({ settings: { paletteName: "Default", biome } as never, hexes: new Map(), paths: [] });

	it("is written as readable biome / biome-from keys and read back", () => {
		const note = buildMapNote("m", withBiome({ generator: "preset-deep-forest", from: ["preset-valley", "biome-swamp"] }));
		expect(note).toContain("\nbiome: preset-deep-forest\n");
		expect(note).toContain("\nbiome-from: [preset-valley, biome-swamp]\n");
		expect(note).not.toContain("hexmaker-extra");
		expect((parseMapNote(note)!.settings as Record<string, unknown>).biome)
			.toEqual({ generator: "preset-deep-forest", from: ["preset-valley", "biome-swamp"] });
	});

	it("accepts hand edits: a bare name, and an unquoted list", () => {
		const note = "---\nhexmaker-map: 1\nbiome: deep forest\nbiome-from: [valley, swamp]\n---\n";
		expect((parseMapNote(note)!.settings as Record<string, unknown>).biome)
			.toEqual({ generator: "deep forest", from: ["valley", "swamp"] });
	});

	it("survives an update that keeps the user's prose", () => {
		const note = buildMapNote("m", withBiome({ generator: "biome-taiga" })) + "\nMy notes.\n";
		const out = updateMapNote(note, "m", withBiome({ generator: "biome-tundra" }));
		expect(out).toContain("\nbiome: biome-tundra\n");
		expect(out.match(/^biome:/gm)).toHaveLength(1);
		expect(out).toContain("My notes.");
	});

	it("falls back to the catch-all for shapes it can't write readably", () => {
		const back = parseMapNote(buildMapNote("m", withBiome({ generator: "x", weights: { a: 1 } })))!;
		expect((back.settings as Record<string, unknown>).biome).toEqual({ generator: "x", weights: { a: 1 } });
	});
});

describe("new hex notes", () => {
	it("swap map-data keys for a link to the map note, keeping the rest", () => {
		const t = "---\nterrain:\ntags: [hex]\ngm-icons:\n  - a.png\n  - b.png\nregion: North\n---\n# Hex 1, 2\n";
		expect(withMapLink(t, "coast")).toBe('---\nmap: "[[_coast]]"\ntags: [hex]\n---\n# Hex 1, 2\n');
	});

	it("adds frontmatter to a template without any", () => {
		expect(withMapLink("# Hex\n", "m")).toBe('---\nmap: "[[_m]]"\n---\n# Hex\n');
	});

	it("handles an empty frontmatter block and CRLF", () => {
		expect(withMapLink("---\r\n---\r\n\r\n# Hex\r\n", "m")).toBe('---\r\nmap: "[[_m]]"\r\n---\r\n\r\n# Hex\r\n');
	});
});

// ── #42: readable, hand-editable map notes ─────────────────────────────────

const fmOf = (note: string) => note.slice(4, note.indexOf("\n---", 4));
const v1 = (fm: string, body = "") => `---\nhexmaker-map: 1\n${fm}\n---\n# m\n\n${body}`;

describe("map notes: plain keys instead of JSON (#42)", () => {
	it("writes parent, world and the background image as plain keys and wikilinks", () => {
		const note = buildMapNote("the-coast", sample());
		const fm = fmOf(note);
		expect(fm).toContain('\nparent: "[[_the-north]]"\nparent-hex: 3, 4\n');
		expect(fm).toContain("\nworld: wabc\nworld-x: 1\nworld-y: -1\n");
		expect(fm).toContain('\nbackground-image: "[[maps/bg.png]]"\nbackground-x: 10\nbackground-y: -5\nbackground-scale: 1.5\nbackground-rotation: 0\nbackground-opacity: 0.8');
		expect(fm).toContain("\nswatch-terrain: grass\n");
		expect(fm).toMatch(/^hexmaker-map: 5$/m);
		expect(fm).not.toMatch(/[{}]/);
	});

	it("writes unknown map settings as readable hexmaker-* keys, not one JSON catch-all", () => {
		const data = sample();
		const s = data.settings as Record<string, unknown>;
		s.originX = 2; s.futureThing = { a: [1, 2], label: "x" };
		const note = buildMapNote("m", data);
		expect(note).toContain("\nhexmaker-origin-x: 2\n");
		expect(note).toContain("\nhexmaker-future-thing:\n  a: [1, 2]\n  label: x\n");
		expect(note).not.toContain("hexmaker-extra");
		const back = parseMapNote(note)!.settings as Record<string, unknown>;
		expect(back.originX).toBe(2);
		expect(back.futureThing).toEqual({ a: [1, 2], label: "x" });
	});

	it("table links are wikilinks; the resolver turns them back into paths", () => {
		const data: MapNoteData = { settings: { paletteName: "Default", weatherTable: "world/tables/weather.md" }, hexes: new Map(), paths: [] };
		const note = buildMapNote("m", data);
		expect(note).toContain('weather-table: "[[world/tables/weather]]"');
		expect(parseMapNote(note)!.settings.weatherTable).toBe("world/tables/weather.md");
		// Obsidian shortened the link after a move: the resolver finds the file.
		const moved = note.replace("[[world/tables/weather]]", "[[weather]]");
		expect(parseMapNote(moved, { resolveLink: (l) => (l === "weather" ? "lore/weather.md" : undefined) })!.settings.weatherTable).toBe("lore/weather.md");
		const bg = buildMapNote("m", sample()).replace("[[maps/bg.png]]", "[[bg.png]]");
		expect(parseMapNote(bg, { resolveLink: (l) => (l === "bg.png" ? "art/bg.png" : undefined) })!.settings.backgroundImage!.path).toBe("art/bg.png");
	});

	it("long decimals are written to 4 places", () => {
		const note = buildMapNote("m", { settings: { gridDisplayScaleX: 1.0123456789012345, gridDisplayOffsetY: -3.3333333333333335 }, hexes: new Map(), paths: [] });
		expect(note).toContain("grid-display-scale-x: 1.0123\n");
		expect(note).toContain("grid-display-offset-y: -3.3333\n");
	});

	it("reads the old JSON form and the old key names, and converts them on the next write", () => {
		const old = v1([
			"terrain-theme: forest",
			'parent: {"map":"the-north","hex":"3_4"}',
			'world: {"id":"wabc","cx":1,"cy":-1}',
			'background-image: {"path":"maps/bg.png","offsetX":10,"offsetY":-5,"scale":1.5}',
			'hidden-link-badges: ["Quests","Towns"]',
			'hexmaker-extra: {"originX":0}',
		].join("\n"), "My prose.\n");
		const d = parseMapNote(old)!;
		expect(d.format).toBe(1);
		expect(d.settings).toMatchObject({
			terrainType: "forest", parent: { map: "the-north", hex: "3_4" }, world: { id: "wabc", cx: 1, cy: -1 },
			backgroundImage: { path: "maps/bg.png", offsetX: 10, offsetY: -5, scale: 1.5 }, hiddenLinkBadges: ["Quests", "Towns"],
		});
		expect((d.settings as Record<string, unknown>).originX).toBe(0);
		const out = updateMapNote(old, "m", d);
		const fm = fmOf(out);
		expect(fm).not.toMatch(/[{}]/);
		expect(fm).not.toContain("terrain-theme");
		expect(fm).not.toContain("hexmaker-extra");
		expect(fm).toContain("hidden-link-badges: [Quests, Towns]");
		expect(out).toContain("My prose.");
		expect(mapNoteKey(parseMapNote(out)!)).toBe(mapNoteKey(d));
	});
});

describe("map notes: Obsidian's Properties panel (#42)", () => {
	// What the Properties panel writes after editing any property of a
	// format-1 note: its objects and lists as block YAML.
	const panel = [
		"---",
		"hexmaker-map: 1",
		"cols: 6",
		"rows: 4",
		"palette: Default",
		"parent:",
		"  map: the-north",
		"  hex: 3_4",
		"world:",
		"  id: wabc",
		"  cx: 1",
		"  cy: -1",
		"background-image:",
		"  path: maps/bg.png",
		"  offsetX: 10",
		"  offsetY: -5",
		"  scale: 1.5",
		"hidden-link-badges:",
		"  - Quests",
		"  - Towns",
		"biome: deep forest",
		"biome-from:",
		"  - valley",
		"  - swamp",
		"tags:",
		"  - campaign",
		"  - north",
		"---",
		"# m",
		"",
		"Notes.",
		"",
	].join("\n");

	it("reads block YAML objects and lists", () => {
		const d = parseMapNote(panel)!;
		expect(d.settings).toMatchObject({
			gridSize: { cols: 6, rows: 4 },
			parent: { map: "the-north", hex: "3_4" },
			world: { id: "wabc", cx: 1, cy: -1 },
			backgroundImage: { path: "maps/bg.png", offsetX: 10, offsetY: -5, scale: 1.5 },
			hiddenLinkBadges: ["Quests", "Towns"],
			biome: { generator: "deep forest", from: ["valley", "swamp"] },
		});
	});

	it("the next write is valid frontmatter: no orphaned indented lines, the user's list intact", () => {
		const d = parseMapNote(panel)!;
		const out = updateMapNote(panel, "m", d);
		const fm = fmOf(out).split("\n");
		// every indented line belongs to the user's tags list
		const indented = fm.filter((l) => /^\s/.test(l));
		expect(indented).toEqual(["  - campaign", "  - north"]);
		expect(fm[fm.indexOf("tags:") + 1]).toBe("  - campaign");
		expect(mapNoteKey(parseMapNote(out)!)).toBe(mapNoteKey(d));
		expect(out).toContain("Notes.");
	});

	it("reads the new format after a panel edit too (quoted values, block lists)", () => {
		const note = buildMapNote("m", sample())
			.replace("parent-hex: 3, 4", 'parent-hex: "3,4"')
			.replace("show-coords: false", 'show-coords: "no"');
		const d = parseMapNote(note)!;
		expect(d.settings.parent).toEqual({ map: "the-north", hex: "3_4" });
		expect(d.settings.showCoords).toBe(false);
	});
});

describe("map notes: forgiving tables (#42)", () => {
	const messy = [
		"---", "hexmaker-map: 2", "cols: 9", "rows: 9", "---", "# m", "",
		"## Hexes", "",
		"|  terrain | HEX |gm-icons| locked | My Notes |",
		"| 3,4 | forest |  |  |  |",
		"| forest | 3, 4 | skull.png; trap.png | ✓ | keep me |",
		"| hills | (5, 6) |  | x |  |",
		"| Swamp | [[7_8]] |  | True |  |",
		"|| grass | 1_1 |  |  |  ||",
		"| sand | 2_2 |",
		"|  |  |  |  |  |",
		"", "## Paths", "",
		"type | HEXES",
		"--- | ---",
		"Road | 3_4, 5_6 [[7_8]]",
		"",
		"Some prose under the paths.",
		"",
	].join("\n");

	it("reads case/space-insensitive headers, no separator row, any coordinate form, yes-like values and stray pipes", () => {
		const r = readMapNote(messy);
		expect(r && r.ok).toBe(true);
		const d = parseMapNote(messy)!;
		// The first row has its cells in the wrong columns: reported, not guessed.
		expect(d.problems!.map((p) => p.text)).toEqual(["| 3,4 | forest |  |  |  |"]);
		expect(d.hexes.get("3_4")).toEqual({ terrain: "forest", gmIcons: ["skull.png", "trap.png"], locked: true, extra: { "My Notes": "keep me" } });
		expect(d.hexes.get("5_6")).toEqual({ terrain: "hills", locked: true });
		expect(d.hexes.get("7_8")).toEqual({ terrain: "Swamp", locked: true });
		expect(d.hexes.get("1_1")).toEqual({ terrain: "grass" });
		expect(d.hexes.get("2_2")).toEqual({ terrain: "sand" });
		expect(d.paths).toEqual([dense("Road", ["3_4", "5_6", "7_8"])]);
	});

	it("the next write tidies the formatting without changing any value, and keeps the column order", () => {
		const d = parseMapNote(messy)!;
		const out = updateMapNote(messy, "m", d);
		const lines = out.split("\n");
		const head = lines.findIndex((l) => l.startsWith("| Terrain | Hex |"));
		expect(lines[head]).toBe("| Terrain | Hex | GM icons | Locked | My Notes | Name | Icon | Region | Locations |");
		expect(lines[head + 1]).toMatch(/^\| --- \|/);
		expect(out).toContain("| forest | 3_4 | skull.png, trap.png | yes | keep me |  |  |  |  |");
		expect(out).toContain("| Path | Type | Route | Notes |\n| --- | --- | --- | --- |\n| Road | Road | 3, 4 → 7, 8 |  |");
		expect(out).toContain("| Road | main | 3, 4 → 5, 6 → 7, 8 |");
		expect(out).toContain("Some prose under the paths.");
		const back = parseMapNote(out)!;
		expect([...back.hexes].sort()).toEqual([...d.hexes].sort());
		expect(back.paths).toEqual(d.paths);
		expect(updateMapNote(out, "m", back)).toBe(out);
	});
});

describe("map notes: rows and settings that can't be read (#42)", () => {
	const base = buildMapNote("m", { settings: { paletteName: "Default", gridSize: { cols: 5, rows: 5 } }, hexes: new Map([["1_1", { terrain: "grass" }]]), paths: [dense("Road", ["1_1", "2_1"])] });
	const withRows = (rows: string[]) => base.replace("| 1_1 |  | grass |  |  |  |  |  |", ["| 1_1 |  | grass |  |  |  |  |  |", ...rows].join("\n"));

	it("keeps them as written at the end of the table and lists them in a warning callout", () => {
		const note = withRows(["| 3_x |  | forest |  |  |  |  |  |", "| 2_2 |  | hills |  |  |  |  | maybe |", "| 1_1 |  | swamp |  |  |  |  |  |"]);
		const d = parseMapNote(note)!;
		expect(d.hexes.get("1_1")).toEqual({ terrain: "grass" });
		expect(d.problems!.map((p) => p.reason)).toEqual([
			"\"3_x\" isn't a hex (write it like 3_4)",
			"Locked should be yes or empty, not \"maybe\"",
			"hex 1_1 already has a row above",
		]);
		d.hexes.set("4_4", { terrain: "lava" });
		const out = updateMapNote(note, "m", d);
		const table = out.slice(out.indexOf("| Hex |"), out.indexOf("> [!warning]"));
		expect(table.trim().split("\n").slice(-3)).toEqual(["| 3_x |  | forest |  |  |  |  |  |", "| 2_2 |  | hills |  |  |  |  | maybe |", "| 1_1 |  | swamp |  |  |  |  |  |"]);
		expect(out).toContain("> [!warning] Hexmaker couldn't read 3 rows in this table");
		expect(out).toContain("> - `| 3_x |  | forest |  |  |  |  |  |`: \"3_x\" isn't a hex (write it like 3_4)");
		expect(out).toContain("| 4_4 |  | lava |");
		// stable: rewriting again changes nothing, the callout isn't duplicated
		expect(updateMapNote(out, "m", parseMapNote(out)!)).toBe(out);
		// fixed by hand: the rows read and the callout goes
		const fixed = out.replace("| 3_x |", "| 3_3 |").replace("| maybe |", "| yes |").replace("| 1_1 |  | swamp |  |  |  |  |  |\n", "");
		const fd = parseMapNote(fixed)!;
		expect(fd.problems).toEqual([]);
		expect(fd.hexes.get("3_3")).toEqual({ terrain: "forest" });
		expect(fd.hexes.get("2_2")).toEqual({ terrain: "hills", locked: true });
		expect(updateMapNote(fixed, "m", fd)).not.toContain("[!warning]");
	});

	it("bad path rows are kept and reported the same way", () => {
		const road = "| Road | main | 1, 1 → 2, 1 |";
		const note = base.replace(road, `${road}\n| River | main | 1, 1 → there |\n|  | fork | 2, 2 |`);
		const d = parseMapNote(note)!;
		expect(d.paths).toEqual([dense("Road", ["1_1", "2_1"])]);
		expect(d.problems!.map((p) => p.where)).toEqual(["Path routes", "Path routes"]);
		const out = updateMapNote(note, "m", d);
		expect(out).toContain("| River | main | 1, 1 → there |");
		expect(out).toContain("> [!warning] Hexmaker couldn't read 2 rows in this table");
	});

	it("a setting that can't be read stays as written (not overwritten) and is listed at the top", () => {
		const note = base.replace("cols: 5", "cols: five").replace("palette: Default", "palette: Default\nshow-coords: perhaps");
		const d = parseMapNote(note)!;
		expect(d.settings.gridSize).toBeUndefined();
		expect(d.settings.showCoords).toBeUndefined();
		expect(d.problems!.map((p) => [p.key, p.field])).toEqual([["cols", "gridSize"], ["show-coords", "showCoords"]]);
		const out = updateMapNote(note, "m", { ...d, settings: { ...d.settings, gridSize: { cols: 5, rows: 5 }, showCoords: true } });
		const fm = fmOf(out);
		expect(fm).toContain("cols: five");
		expect(fm).toContain("show-coords: perhaps");
		expect(fm.match(/^cols:/gm)).toHaveLength(1);
		expect(fm.match(/^show-coords:/gm)).toHaveLength(1);
		expect(out).toContain("> [!warning] Hexmaker couldn't read 2 settings");
		const again = updateMapNote(out, "m", parseMapNote(out)!);
		expect(again.match(/\[!warning\]/g)).toHaveLength(1);
	});

	it("refreshProblemCallouts only adds, updates or clears the callouts", () => {
		const note = withRows(["| oops |  | forest |"]);
		const out = refreshProblemCallouts(note);
		expect(out).toBe(note.replace("| oops |  | forest |\n", "| oops |  | forest |\n\n> [!warning] Hexmaker couldn't read a row in this table\n> It's kept as written at the end of the table. Fix it there and this box goes away.\n> - `| oops |  | forest |`: \"oops\" isn't a hex (write it like 3_4)\n"));
		expect(refreshProblemCallouts(out)).toBe(out);
		expect(refreshProblemCallouts(out.replace("| oops |", "| 4_4 |"))).toBe(note.replace("| oops |", "| 4_4 |"));
		expect(refreshProblemCallouts(base)).toBe(base);
	});
});

describe("map notes: never rebuilt over the user's text (#42)", () => {
	it("a Hexes table whose header lost its Hex column can't be read (so it isn't written over)", () => {
		const note = buildMapNote("m", sample()).replace("| Hex | Name |", "| Hexx | Name |");
		const r = readMapNote(note);
		expect(r).toEqual({ ok: false, reason: "the Hexes table needs a header row with a Hex column" });
		expect(parseMapNote(note)).toBeNull();
	});

	it("a broken --- fence is not a map note", () => {
		const note = buildMapNote("m", sample()).replace(/\n---\n# /, "\n--\n# ");
		expect(readMapNote(note)).toBeNull();
	});

	it("updateMapNote keeps every line even of a note it can't read", () => {
		const text = "hexmaker-map: 1\nMy whole campaign.\n| Hex | Terrain |\n";
		const out = updateMapNote(text, "m", sample());
		expect(out.endsWith(text)).toBe(true);
	});
});

describe("map notes: the help callout (#42)", () => {
	it("new notes open with a collapsed How to edit callout, once", () => {
		const note = buildMapNote("m", sample());
		// then the derived Summary, then the Hexes
		expect(note).toContain(`# m\n\n${HELP_CALLOUT.join("\n")}\n\n## Summary\n`);
		expect(note).toMatch(/\n\| Terrain \| Hexes \|[^#]*\n\n## Hexes\n/);
		expect(updateMapNote(note, "m", parseMapNote(note)!).match(/How to edit this note/g)).toHaveLength(1);
	});

	it("older notes get it once, in place of the old one-line intro", () => {
		const old = "---\nhexmaker-map: 1\n---\n# m\n\nHexmap World Creator map. Each hex's name, terrain, icons, region and submap live in the table below — edit it here or paint on the map. Hex notes hold descriptions and links, and only exist once a hex has some.\n\nMy own intro.\n\n## Hexes\n\n| Hex | Terrain |\n| --- | --- |\n";
		const out = updateMapNote(old, "m", parseMapNote(old)!);
		expect(out).not.toContain("Hexmap World Creator map. Each hex's");
		expect(out).toContain(`# m\n\n${HELP_CALLOUT.join("\n")}\n\nMy own intro.`);
		expect(updateMapNote(out, "m", parseMapNote(out)!)).toBe(out);
	});

	it("older notes without the intro get it under the title", () => {
		const old = "---\nhexmaker-map: 1\n---\n# m\nMy own intro.\n";
		const out = updateMapNote(old, "m", parseMapNote(old)!);
		expect(out).toContain(`# m\n\n${HELP_CALLOUT.join("\n")}\nMy own intro.`);
	});

	it("isn't put back once the user deleted it", () => {
		const note = buildMapNote("m", sample()).replace(HELP_CALLOUT.join("\n") + "\n\n", "");
		expect(updateMapNote(note, "m", parseMapNote(note)!)).not.toContain("How to edit");
	});
});

describe("parseHexKey", () => {
	it("reads the usual ways of writing a hex", () => {
		for (const s of ["3_4", "3,4", "3, 4", " 3 , 4 ", "(3, 4)", "3 4", "[[3_4]]", "[[world/hexes/m/3_4|Glass]]", "03_04"]) expect(parseHexKey(s)).toBe("3_4");
		expect(parseHexKey("-1_-2")).toBe("-1_-2");
		for (const s of ["", "3", "3_x", "a, b", "3_4_5"]) expect(parseHexKey(s)).toBeNull();
	});
});

describe("map notes: the derived Summary (format 4, #46 M1)", () => {
	const ctx = { paletteTerrains: ["grass", "forest", "dunes"], pathTypes: ["Road", "River"], paletteNote: "world/palettes/Default" };
	const data = (): MapNoteData => ({
		settings: { paletteName: "Default", gridSize: { cols: 38, rows: 25 }, gridOffset: { x: -7, y: -8 }, baseTerrain: "grass", regions: { footprint: "hex", size: 3, blend: "wide" } },
		hexes: new Map<string, HexData>([
			["0_0", { terrain: "forest", region: "Basin" }],
			["1_0", { terrain: "forest", region: "Basin", regionMap: "basin-map" }],
			["2_0", { terrain: "Mountain Ridge", locations: ["saltmere", "old-mine"] }],
			["3_0", { name: "Lone Oak" }],
		]),
		paths: [dense("Road", ["0_0", "1_0", "2_0"]), dense("Trail", ["-7_-8"])],
	});
	const summaryOf = (note: string) => note.slice(note.indexOf("## Summary"), note.indexOf("## Hexes"));

	it("shows the palette, extent, base terrain, legend, regions, maps and what isn't in the palette", () => {
		const s = summaryOf(buildMapNote("m", data(), ctx));
		expect(s).toContain("*Generated by Hexmaker from the tables below and the map's palette. Edits here are replaced.*");
		expect(s).toContain("- **Palette:** [[world/palettes/Default]]\n");
		expect(s).toContain("- **Hexes:** −7…30 × −8…16 (38×25)\n");
		expect(s).toContain("- **Base terrain:** grass (hexes not listed in the table)\n");
		expect(s).toContain("- **Regions:** [[Basin]] (2 hexes)\n");
		expect(s).toContain("- **Region settings:** hex flowers of 37 hexes, wide blend\n");
		expect(s).toContain("- **Maps from hexes:** 1 region map, 2 locations\n");
		expect(s).toContain("- **⚠ Not in the palette:** Mountain Ridge (1 hex).");
		expect(s).toContain("- **⚠ Path types not in the palette:** Trail\n");
		expect(s).toContain("| Terrain | Hexes |\n| --- | --- |\n| grass (base) | 947 |\n| forest | 2 |\n| Mountain Ridge (⚠ not in the palette) | 1 |\n");
	});

	it("without the palette, nothing is flagged and the palette is named plainly", () => {
		const s = summaryOf(buildMapNote("m", data()));
		expect(s).toContain("- **Palette:** Default\n");
		expect(s).not.toContain("⚠");
	});

	it("is never read as data", () => {
		const note = buildMapNote("m", data(), ctx);
		const without = note.replace(summaryOf(note), "");
		expect(mapNoteKey(parseMapNote(note)!)).toBe(mapNoteKey(parseMapNote(without)!));
		expect(parseMapNote(note)!.problems).toEqual([]);
	});

	it("doesn't churn: a rewrite with the same data and palette changes nothing", () => {
		const note = buildMapNote("m", data(), ctx);
		expect(updateMapNote(note, "m", parseMapNote(note)!, ctx)).toBe(note);
		// a palette that now has the terrain: the flag goes
		const fixed = updateMapNote(note, "m", parseMapNote(note)!, { ...ctx, paletteTerrains: [...ctx.paletteTerrains, "Mountain Ridge"] });
		expect(fixed).not.toContain("Not in the palette");
	});

	it("edits inside it are replaced; text typed under it and the user's own Summary are kept", () => {
		const note = buildMapNote("m", data(), ctx) + "\n## Summary\nSession 3: we found the mine.\n";
		const edited = note.replace("- **Regions:** [[Basin]] (2 hexes)", "- **Regions:** lots").replace("\n\n## Hexes", "\n\nMy note about the map.\n\n## Hexes");
		const out = updateMapNote(edited, "m", parseMapNote(edited)!, ctx);
		expect(out).toContain("- **Regions:** [[Basin]] (2 hexes)");
		expect(out).not.toContain("lots");
		expect(out).toContain("My note about the map.");
		expect(out).toContain("## Summary\nSession 3: we found the mine.\n");
		expect(out.match(/Generated by Hexmaker/g)).toHaveLength(1);
	});

	it("comes back above the Hexes when deleted, and is added to older notes there", () => {
		const note = buildMapNote("m", data(), ctx);
		const deleted = note.replace(summaryOf(note), "");
		expect(updateMapNote(deleted, "m", parseMapNote(deleted)!, ctx)).toBe(note);
		const v3 = "---\nhexmaker-map: 3\n---\n# m\n\nIntro.\n\n## Hexes\n\n| Hex | Terrain |\n| --- | --- |\n| 1_1 | forest |\n";
		const out = updateMapNote(v3, "m", parseMapNote(v3)!);
		expect(out).toContain("Intro.\n\n## Summary\n");
		expect(out).toMatch(/\| forest \| 1 \|\n\n## Hexes\n/);
	});
});

describe("map notes: the derived Route column (format 5)", () => {
	const ctx = { pathTypes: ["Road", "River"] };
	const data = (paths: MapNoteData["paths"]): MapNoteData => ({ settings: { paletteName: "Default" }, hexes: new Map(), paths });

	it("reads main-line ends and forks; with routed stats the hexes; warns about the type and straight segments", () => {
		const road: MapPath = { name: "King's Road", typeName: "Road", branches: [{ anchors: ["0_8", "9_8", "13_8"] }, { anchors: ["9_8", "9_12"] }, { anchors: ["13_8", "15_5"] }] };
		const trail: MapPath = { name: "Old Track", typeName: "Trail", branches: [{ anchors: ["-1_2"] }] };
		const bare: MapPath = { name: "Plan", typeName: "Road", branches: [] };
		const note = buildMapNote("m", data([road, trail, bare]), {
			...ctx,
			pathRoutes: { "king's road": { hexes: 31, fallbacks: [["9_8", "9_12"]] } },
		});
		expect(note).toContain("| King's Road | Road | 0, 8 → 13, 8 · 2 forks · 31 hexes · ⚠ no route from 9, 8 to 9, 12: drawn straight |  |");
		expect(note).toContain("| Old Track | Trail | -1, 2 · ⚠ type not in palette |  |");
		expect(note).toContain("| Plan | Road | no route yet |  |");
		// derived cells are never read back (not kept as unknown columns)
		const d = parseMapNote(note)!;
		expect(d.paths).toEqual([road, trail, bare]);
		d.paths[1].typeName = "River";
		expect(updateMapNote(note, "m", d, ctx)).not.toContain("⚠");
	});

	it("a hand-edited Route is replaced; format 4's Warning column is dropped", () => {
		const note = buildMapNote("m", data([dense("Road", ["3_4", "4_4"])]), ctx);
		const edited = note.replace("| Road | Road | 3, 4 → 4, 4 |  |", "| Road | Road | the old road |  |");
		expect(updateMapNote(edited, "m", parseMapNote(edited)!, ctx)).toBe(note);
		const withWarning = note.replace("| Path | Type | Route | Notes |\n| --- | --- | --- | --- |\n| Road | Road | 3, 4 → 4, 4 |  |", "| Path | Type | Route | Warning | Notes |\n| --- | --- | --- | --- | --- |\n| Road | Road | 3, 4 → 4, 4 | ⚠ old |  |");
		expect(parseMapNote(withWarning)!.paths).toEqual([dense("Road", ["3_4", "4_4"])]);
		expect(updateMapNote(withWarning, "m", parseMapNote(withWarning)!, ctx)).toBe(note);
	});
});


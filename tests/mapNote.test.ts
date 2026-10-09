import { describe, it } from "node:test";
import expect from "expect";
import {
	withMapLink,
	buildMapNote,
	hexRowsToWrite,
	mapNoteKey,
	parseMapNote,
	updateMapNote,
	type HexData,
	type MapNoteData,
} from "../src/maps/mapNote";

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
		["12_9", { terrain: "forest", icon: "bw-castle.png", gmIcons: ["skull.png", "skull.png"], submap: "the-coast-12-9", locked: true }],
		["5_5", {}],
	]),
	paths: [
		{ typeName: "Road", hexes: ["3_4", "4_4", "5_4"] },
		{ typeName: "River | big", hexes: ["0_0", "0_1"] },
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

describe("new hex notes", () => {
	it("swap map-data keys for a link to the map note, keeping the rest", () => {
		const t = "---\nterrain:\ntags: [hex]\ngm-icons:\n  - a.png\n  - b.png\nregion: North\n---\n# Hex 1, 2\n";
		expect(withMapLink(t, "coast")).toBe('---\nhexmaker-map: "[[_coast]]"\ntags: [hex]\n---\n# Hex 1, 2\n');
	});

	it("adds frontmatter to a template without any", () => {
		expect(withMapLink("# Hex\n", "m")).toBe('---\nhexmaker-map: "[[_m]]"\n---\n# Hex\n');
	});

	it("handles an empty frontmatter block and CRLF", () => {
		expect(withMapLink("---\r\n---\r\n\r\n# Hex\r\n", "m")).toBe('---\r\nhexmaker-map: "[[_m]]"\r\n---\r\n\r\n# Hex\r\n');
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import {
	buildMapNote,
	parseMapList,
	parseMapNote,
	parseRegionShape,
	parseRegionSize,
	updateMapNote,
	type HexData,
	type MapNoteData,
} from "../src/maps/mapNote";
import {
	addLocationPatch,
	applyRegionSettingsEdit,
	filterByQuery,
	hexChildMaps,
	moveItem,
	regionCellCount,
	regionGridSize,
	regionMirrorFixes,
	regionsLocked,
	regionsOf,
	regionSettingsProblem,
	removeMapPatch,
	renameMapPatch,
	setRegionPatch,
	submapKindOf,
	submapMenuPlan,
} from "../src/maps/submaps";
import { buildMapTree } from "../src/maps/mapTree";
import type { MapData, RegionSettings } from "../src/types";

const note = (hexRows: string[], header = "| Hex | Terrain | Submap |", fm: string[] = []) => [
	"---", "hexmaker-map: 2", ...fm, "---", "# m", "", "## Hexes", "",
	header, "| --- | --- | --- |", ...hexRows, "", "## Paths", "", "| Type | Hexes |", "| --- | --- |", "",
].join("\n");

describe("map note format 3: Region map and Locations", () => {
	it("reads the old Submap column as the hex's one location (K8)", () => {
		const d = parseMapNote(note(["| 3_4 | forest | coast-3-4 |"]))!;
		expect(d.hexes.get("3_4")).toEqual({ terrain: "forest", locations: ["coast-3-4"] });
	});

	it("renames Submap to Locations in place on the next write, as links, and marks format 4", () => {
		const text = note(["| 3_4 | forest | coast-3-4 |", "| 4_4 | hills |  |"]);
		const out = updateMapNote(text, "m", parseMapNote(text)!);
		expect(out).toMatch(/^hexmaker-map: 4$/m);
		expect(out).toContain("| Hex | Terrain | Locations |");
		expect(out).toContain("| 3_4 | forest | [[_coast-3-4]] |");
		expect(out).not.toContain("Submap");
		// No region map anywhere: no Region map column.
		expect(out).not.toContain("Region map");
		const back = parseMapNote(out)!;
		expect(back.hexes.get("3_4")).toEqual({ terrain: "forest", locations: ["coast-3-4"] });
		// and a second write changes nothing
		expect(updateMapNote(out, "m", back)).toBe(out);
	});

	it("writes Region map (only when used) and several locations, and reads them back", () => {
		const hexes = new Map<string, HexData>([
			["1_1", { terrain: "forest", regionMap: "fenmarch", locations: ["saltmere", "old-mine", "ship"] }],
			["2_1", { terrain: "hills" }],
		]);
		const text = buildMapNote("m", { settings: { paletteName: "Default" }, hexes, paths: [] });
		expect(text).toContain("| Hex | Name | Terrain | Icon | GM icons | Region | Region map | Locations | Locked |");
		expect(text).toContain("| [[_saltmere]], [[_old-mine]], [[_ship]] |");
		expect(text).toContain("| [[_fenmarch]] |");
		expect([...parseMapNote(text)!.hexes]).toEqual([...hexes]);
	});

	it("reads Locations tolerantly: plain names, links with paths or aliases, semicolons, repeats", () => {
		expect(parseMapList("saltmere, old-mine")).toEqual(["saltmere", "old-mine"]);
		expect(parseMapList("[[_saltmere]]; [[world/hexes/old-mine/_old-mine.md|The Old Mine]], saltmere")).toEqual(["saltmere", "old-mine"]);
		expect(parseMapList("[[_a, b]]")).toEqual(["a, b"]);
		expect(parseMapList("")).toEqual([]);
		const d = parseMapNote(note(["| 1_1 | forest | [[_saltmere\\|Saltmere]], old-mine |"], "| Hex | Terrain | Locations |"))!;
		expect(d.hexes.get("1_1")).toEqual({ terrain: "forest", locations: ["saltmere", "old-mine"] });
	});

	it("keeps extra region maps typed into one cell as locations (nothing dropped)", () => {
		const d = parseMapNote(note(["| 1_1 | [[_fen]], [[_reed]] | town |"], "| Hex | Region map | Locations |"))!;
		expect(d.hexes.get("1_1")).toEqual({ regionMap: "fen", locations: ["reed", "town"] });
	});

	it("merges a Submap column with a Locations column", () => {
		const text = ["---", "hexmaker-map: 2", "---", "| Hex | Terrain | Locations | Submap |", "| --- | --- | --- | --- |", "| 1_1 | forest | a | b |", ""].join("\n");
		expect(parseMapNote(text)!.hexes.get("1_1")).toEqual({ terrain: "forest", locations: ["a", "b"] });
	});

	it("writes the Region column as links to region notes and reads plain names too (#46 M4)", () => {
		const text = note(["| 1_1 | forest | Basin |"], "| Hex | Terrain | Region |");
		const d = parseMapNote(text)!;
		expect(d.hexes.get("1_1")).toEqual({ terrain: "forest", region: "Basin" });
		const out = updateMapNote(text, "m", d);
		expect(out).toContain("| 1_1 | forest | [[Basin]] |");
		expect(parseMapNote(out)!.hexes.get("1_1")).toEqual({ terrain: "forest", region: "Basin" });
		// a path-qualified link (Obsidian's rename can write one) reads as the note name
		expect(parseMapNote(note(["| 1_1 | forest | [[regions/Basin\\|B]] |"], "| Hex | Terrain | Region |"))!.hexes.get("1_1")!.region).toBe("Basin");
		// names that can't be links stay plain
		const odd = new Map<string, HexData>([["1_1", { region: "North #2" }]]);
		expect(buildMapNote("m", { settings: { paletteName: "D" }, hexes: odd, paths: [] })).toContain("| North #2 |");
	});

	it("replaces the old help line only when it's still the plugin's own words", () => {
		const v2 = buildMapNote("m", { settings: { paletteName: "D" }, hexes: new Map(), paths: [] })
			.replace(/^hexmaker-map: 4$/m, "hexmaker-map: 2")
			.replace(/^> - \*\*Hexes\*\*.*$/m, "> - **Hexes**: one row per hex that has something set. *Hex* is the column and row, like `3_4`. *Terrain* and *Region* use names from the map's palette. *Icon* and *GM icons* are icon file names; separate several with commas. *Submap* is the map that opens from the hex. *Locked* `yes` keeps generators off it.");
		const out = updateMapNote(v2, "m", parseMapNote(v2)!);
		expect(out).toContain("*Locations* links the maps");
		expect(out).not.toContain("*Submap* is the map");
		const edited = v2.replace("*Submap* is the map that opens from the hex.", "*Submap* is my dungeon.");
		expect(updateMapNote(edited, "m", parseMapNote(edited)!)).toContain("*Submap* is my dungeon.");
	});
});

describe("map note settings: submap kind and region settings", () => {
	const data = (settings: Record<string, unknown>): MapNoteData => ({ settings: { paletteName: "Default", ...settings } as never, hexes: new Map(), paths: [] });

	it("round-trips submap-kind and the region settings as plain keys", () => {
		const regions: RegionSettings = { footprint: "hex", size: 3, blend: "wide", palette: "Expanded" };
		const text = buildMapNote("m", data({ submapKind: "region", regions }));
		expect(text).toMatch(/^submap-kind: region$/m);
		expect(text).toMatch(/^region-shape: hex flower$/m);
		expect(text).toMatch(/^region-size: 37 hexes$/m);
		expect(text).toMatch(/^region-blend: wide$/m);
		expect(text).toMatch(/^region-palette: Expanded$/m);
		expect(text).not.toMatch(/[{}]/);
		const back = parseMapNote(text)!;
		expect(back.settings.submapKind).toBe("region");
		expect(back.settings.regions).toEqual(regions);
		const rect = parseMapNote(buildMapNote("m", data({ regions: { footprint: "rect", size: 8 } })))!;
		expect(rect.settings.regions).toEqual({ footprint: "rect", size: 8 });
	});

	it("reads region sizes and shapes the way people write them", () => {
		expect(parseRegionShape("Hex Flower")).toBe("hex");
		expect(parseRegionShape("bricks")).toBe("rect");
		expect(parseRegionShape("circle")).toBeNull();
		expect(parseRegionSize("37", "hex")).toBe(3);
		expect(parseRegionSize("91 hexes", "hex")).toBe(5);
		expect(parseRegionSize("radius 2", "hex")).toBe(2);
		expect(parseRegionSize("4", "hex")).toBe(4);
		expect(typeof parseRegionSize("40", "hex")).toBe("string");
		expect(parseRegionSize("8 × 8", "rect")).toBe(8);
		expect(parseRegionSize("10", "rect")).toBe(10);
		expect(typeof parseRegionSize("8x10", "rect")).toBe("string");
	});

	it("reports an unreadable region setting and keeps the line as written", () => {
		const text = ["---", "hexmaker-map: 3", "region-shape: circle", "region-size: 37 hexes", "submap-kind: ship", "---", "# m", "", "## Hexes", "", "| Hex | Terrain |", "| --- | --- |", ""].join("\n");
		const d = parseMapNote(text)!;
		expect(d.settings.regions).toBeUndefined();
		expect(d.settings.submapKind).toBeUndefined();
		expect(d.problems!.map((p) => p.key).sort()).toEqual(["region-shape", "submap-kind"]);
		const out = updateMapNote(text, "m", d);
		expect(out).toContain("region-shape: circle");
		expect(out).toContain("submap-kind: ship");
	});
});

describe("submaps: hex links", () => {
	it("lists a hex's maps, region first", () => {
		expect(hexChildMaps({ regionMap: "r", locations: ["a", "r", "b"] })).toEqual(["r", "a", "b"]);
		expect(hexChildMaps(undefined)).toEqual([]);
	});

	it("adds, sets, removes and renames links without losing any", () => {
		expect(addLocationPatch({ locations: ["a"] }, "b")).toEqual({ locations: ["a", "b"] });
		expect(addLocationPatch({ locations: ["a"] }, "a")).toEqual({});
		expect(addLocationPatch({ regionMap: "r" }, "r")).toEqual({});
		// a region taken from the locations; an older region map becomes a location
		expect(setRegionPatch({ locations: ["a", "r"] }, "r")).toEqual({ regionMap: "r", locations: ["a"] });
		expect(setRegionPatch({ regionMap: "old" }, "r")).toEqual({ regionMap: "r", locations: ["old"] });
		expect(setRegionPatch({}, "r")).toEqual({ regionMap: "r" });
		expect(removeMapPatch({ regionMap: "r", locations: ["a", "b"] }, "a")).toEqual({ locations: ["b"] });
		expect(removeMapPatch({ regionMap: "r", locations: ["a"] }, "r")).toEqual({ regionMap: null });
		expect(removeMapPatch({ locations: ["a"] }, "a")).toEqual({ locations: null });
		expect(removeMapPatch({ locations: ["a"] }, "z")).toEqual({});
		expect(renameMapPatch({ regionMap: "a", locations: ["a", "b"] }, "a", "c")).toEqual({ regionMap: "c", locations: ["c", "b"] });
		expect(renameMapPatch({ locations: ["b"] }, "a", "c")).toBeNull();
	});

	it("moves a location in the list", () => {
		expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
		expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
		expect(moveItem(["a"], 5, 0)).toEqual(["a"]);
	});

	it("right-click menu: up to two locations by name, from three a Locations (n) item (K7)", () => {
		expect(submapMenuPlan({ regionMap: "r", locations: ["a", "b"] })).toEqual({ region: "r", open: ["a", "b"], listCount: 0 });
		expect(submapMenuPlan({ locations: ["a", "b", "c"] })).toEqual({ region: undefined, open: [], listCount: 3 });
		expect(submapMenuPlan(undefined)).toEqual({ region: undefined, open: [], listCount: 0 });
	});

	it("filters the locations list by name or label", () => {
		const items = [{ name: "saltmere", label: "Saltmere" }, { name: "old-mine", label: "The Old Mine" }];
		expect(filterByQuery(items, "mine").map((i) => i.name)).toEqual(["old-mine"]);
		expect(filterByQuery(items, "SALT").map((i) => i.name)).toEqual(["saltmere"]);
		expect(filterByQuery(items, "  ")).toHaveLength(2);
	});
});

const m = (name: string, extra: Partial<MapData> = {}): MapData =>
	({ name, paletteName: "D", gridSize: { cols: 1, rows: 1 }, gridOffset: { x: 0, y: 0 }, pathChains: [], ...extra });

describe("submaps: kinds, regions and the lock", () => {
	it("every older child map is a location (K8)", () => {
		expect(submapKindOf(m("a", { parent: { map: "p", hex: "1_1" } }))).toBe("location");
		expect(submapKindOf(m("a", { parent: { map: "p", hex: "1_1" }, submapKind: "region" }))).toBe("region");
		expect(submapKindOf(m("a"))).toBeUndefined();
	});

	it("locks the region settings while any region exists, derived from the maps", () => {
		const maps = [m("p"), m("loc", { parent: { map: "p", hex: "1_1" } })];
		expect(regionsLocked(maps, "p")).toBe(false);
		maps.push(m("r", { parent: { map: "p", hex: "2_1" }, submapKind: "region" }));
		expect(regionsLocked(maps, "p")).toBe(true);
		expect(regionsLocked(maps, "other")).toBe(false);
	});

	it("lists a map's regions in reading order", () => {
		const maps = [
			m("c", { parent: { map: "p", hex: "0_2" }, submapKind: "region" }),
			m("b", { parent: { map: "p", hex: "5_1" }, submapKind: "region" }),
			m("a", { parent: { map: "p", hex: "1_1" }, submapKind: "region" }),
		];
		expect(regionsOf(maps, "p").map((r) => r.name)).toEqual(["a", "b", "c"]);
	});

	it("only blend and generator change once locked", () => {
		const old: RegionSettings = { footprint: "hex", size: 3, blend: "normal", palette: "D" };
		const next: RegionSettings = { footprint: "rect", size: 8, blend: "wide", palette: "E" };
		expect(applyRegionSettingsEdit(old, next, true)).toEqual({ footprint: "hex", size: 3, blend: "wide", palette: "D", generator: undefined });
		expect(applyRegionSettingsEdit(old, next, false)).toEqual(next);
	});

	it("region sizes", () => {
		expect(regionCellCount({ footprint: "hex", size: 3 })).toBe(37);
		expect(regionGridSize({ footprint: "hex", size: 3 })).toEqual({ cols: 7, rows: 7 });
		expect(regionGridSize({ footprint: "rect", size: 8 })).toEqual({ cols: 8, rows: 8 });
		expect(regionSettingsProblem({ footprint: "hex", size: 6 })).toMatch(/7, 19/);
		expect(regionSettingsProblem({ footprint: "rect", size: 1 })).toMatch(/2 to 32/);
		expect(regionSettingsProblem({ footprint: "rect", size: 12 })).toBeNull();
	});
});

describe("submaps: region mirror repair (the map record wins)", () => {
	const run = (maps: MapData[], hexes: Record<string, Record<string, HexData>>) =>
		regionMirrorFixes(maps, (mp, k) => hexes[mp]?.[k], (mp) => Object.entries(hexes[mp] ?? {}));

	it("names a region on its parent hex, keeping what was there as a location", () => {
		const maps = [m("p"), m("r", { parent: { map: "p", hex: "1_1" }, submapKind: "region" })];
		const fixes = run(maps, { p: { "1_1": { regionMap: "x", locations: ["a"] } } });
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({ map: "p", hex: "1_1", patch: { regionMap: "r", locations: ["a", "x"] } });
	});

	it("moves a region map cell that the map's record doesn't back up into the locations", () => {
		const maps = [m("p"), m("loc", { parent: { map: "p", hex: "1_1" } })];
		const fixes = run(maps, { p: { "1_1": { regionMap: "loc", locations: ["a"] } } });
		expect(fixes[0]).toMatchObject({ patch: { regionMap: null, locations: ["loc", "a"] } });
	});

	it("leaves agreeing hexes and unknown names alone", () => {
		const maps = [m("p"), m("r", { parent: { map: "p", hex: "1_1" }, submapKind: "region" })];
		expect(run(maps, { p: { "1_1": { regionMap: "r" }, "2_1": { regionMap: "no-such-map" } } })).toEqual([]);
	});

	it("a second region on one hex stays reachable as a location", () => {
		const maps = [
			m("p"),
			m("r1", { parent: { map: "p", hex: "1_1" }, submapKind: "region" }),
			m("r2", { parent: { map: "p", hex: "1_1" }, submapKind: "region" }),
		];
		const fixes = run(maps, { p: {} });
		expect(fixes).toHaveLength(1);
		expect(fixes[0].patch).toEqual({ regionMap: "r1", locations: ["r2"] });
	});
});

describe("map tree: a map's regions in one group", () => {
	it("groups regions under their map, in reading order, before its locations", () => {
		const maps = [
			m("world"),
			m("town", { parent: { map: "world", hex: "0_0" } }),
			m("r2", { parent: { map: "world", hex: "2_1" }, submapKind: "region" }),
			m("r1", { parent: { map: "world", hex: "1_1" }, submapKind: "region" }),
			m("inn", { parent: { map: "r1", hex: "0_0" } }),
		];
		const tree = buildMapTree(maps);
		expect(tree).toHaveLength(1);
		const kids = tree[0].children;
		expect(kids[0]).toMatchObject({ kind: "regions", parent: "world", label: "Regions (2)" });
		expect(kids[0].children.map((c) => (c.kind === "map" ? c.name : ""))).toEqual(["r1", "r2"]);
		// a location of a region sits under that region
		expect(kids[0].children[0].children.map((c) => (c.kind === "map" ? c.name : ""))).toEqual(["inn"]);
		expect(kids[1]).toMatchObject({ kind: "map", name: "town" });
	});
});

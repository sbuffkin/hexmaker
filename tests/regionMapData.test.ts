import { describe, it } from "node:test";
import expect from "expect";
import {
	hasRegionMapData,
	normRegion,
	regionMapDataLines,
	regionUse,
	renamedRegionValue,
	renamedTokenMap,
	setRegionMapData,
	type RegionMapDataView,
} from "../src/regionMapData";
import { LOCATION_SECTIONS, withLocationLine } from "../src/noteTemplates";
import { readSurface } from "./helpers/source";

const REGION: RegionMapDataView = {
	kind: "region",
	maps: [{ map: "the-coast", label: "The Coast", hexes: 12 }, { map: "hills", label: "Hills", hexes: 1 }],
	encounterTable: "world/tables/regions/Dustbowl",
};

// ── R1: Map data callout in region and faction notes ────────────────────────

describe("region / faction Map data callout (R1)", () => {
	it("lists the maps with hex counts and the region's encounter table", () => {
		expect(regionMapDataLines(REGION)).toEqual([
			"> [!hexmaker] Map data",
			"> Maps: [[_the-coast|The Coast]] (12 hexes), [[_hills|Hills]] (1 hex)",
			"> Encounter table: [[world/tables/regions/Dustbowl|Dustbowl]]",
		]);
	});

	it("shows a dash for none; factions have no encounter table line", () => {
		expect(regionMapDataLines({ kind: "region", maps: [] })).toEqual(["> [!hexmaker] Map data", "> Maps: —", "> Encounter table: —"]);
		expect(regionMapDataLines({ kind: "faction", maps: [{ map: "m", label: "M|ap", hexes: 2 }] })).toEqual([
			"> [!hexmaker] Map data",
			"> Maps: [[_m|Map]] (2 hexes)",
		]);
	});

	it("goes under the title only when asked, and updates in place", () => {
		const note = "---\nregion-color: \"#aa0000\"\n---\n# Dustbowl\nDry and windy.\n";
		expect(setRegionMapData(note, REGION)).toBe(note);
		const added = setRegionMapData(note, REGION, true);
		expect(added).toBe(`---\nregion-color: "#aa0000"\n---\n# Dustbowl\n\n${regionMapDataLines(REGION).join("\n")}\n\nDry and windy.\n`);
		expect(hasRegionMapData(added)).toBe(true);
		expect(setRegionMapData(added, REGION, true)).toBe(added);
		const moved = setRegionMapData(added, { ...REGION, maps: [] });
		expect(moved).toContain("> Maps: —");
		expect(moved.match(/\[!hexmaker\]/g)).toHaveLength(1);
		expect(moved).toContain("Dry and windy.");
	});

	it("keeps CRLF notes CRLF", () => {
		const note = "# Reds\r\nA faction.\r\n";
		const out = setRegionMapData(note, { kind: "faction", maps: [] }, true);
		expect(out.replace(/\r\n/g, "")).not.toContain("\n");
	});

	it("counts a region's hexes per map, by name or link, any case", () => {
		const hexes: Record<string, { region?: string }[]> = {
			coast: [{ region: "Dustbowl" }, { region: "dustbowl" }, { region: "Other" }, {}],
			hills: [{ region: "Other" }],
			sea: [{ region: "Dustbowl" }],
		};
		const maps = [{ name: "coast", label: "The Coast" }, { name: "hills", label: "Hills" }, { name: "sea", label: "Sea" }];
		expect(regionUse("Dustbowl", maps, (m) => hexes[m])).toEqual([
			{ map: "coast", label: "The Coast", hexes: 2 },
			{ map: "sea", label: "Sea", hexes: 1 },
		]);
		expect(normRegion("[[world/regions/Dustbowl|Dust]]")).toBe("dustbowl");
	});
});

// ── R2: renames ─────────────────────────────────────────────────────────────

describe("rename handlers (R2)", () => {
	it("a renamed region note renames matching Region values, keeping their form", () => {
		expect(renamedRegionValue("Dustbowl", "Dustbowl", "Dust Flats")).toBe("Dust Flats");
		expect(renamedRegionValue("dustbowl", "Dustbowl", "Dust Flats")).toBe("Dust Flats");
		expect(renamedRegionValue("[[world/regions/Dustbowl]]", "Dustbowl", "Dust Flats")).toBe("[[world/regions/Dust Flats]]");
		expect(renamedRegionValue("Other", "Dustbowl", "Dust Flats")).toBeNull();
	});

	it("a renamed map renames token-map, as a name or a link to its map note", () => {
		expect(renamedTokenMap("old-map", "old-map", "new-map")).toBe("new-map");
		expect(renamedTokenMap("[[_old-map]]", "old-map", "new-map")).toBe("[[_new-map]]");
		expect(renamedTokenMap("[[world/hexes/old-map/_old-map|Old]]", "old-map", "new-map")).toBe("[[world/hexes/old-map/_new-map|Old]]");
		expect(renamedTokenMap("other", "old-map", "new-map")).toBeNull();
		expect(renamedTokenMap(undefined, "old-map", "new-map")).toBeNull();
	});
});

// ── R3: Location line ───────────────────────────────────────────────────────

describe("Location line in notes made from a hex (R3)", () => {
	it("is for towns, dungeons, features and quests", () => {
		expect([...LOCATION_SECTIONS]).toEqual(["Towns", "Dungeons", "Features", "Quests"]);
	});

	it("goes under the title, linking the hex by path and reading map x, y", () => {
		const town = "# Saltmarsh\n\n## Description\n";
		expect(withLocationLine(town, "world/hexes/coast/3_4.md", "The Coast 3, 4")).toBe(
			"# Saltmarsh\n\nLocation: [[world/hexes/coast/3_4|The Coast 3, 4]]\n\n## Description\n",
		);
	});

	it("is the whole note when the note starts empty", () => {
		expect(withLocationLine("", "hexes/m/0_1.md", "M 0, 1")).toBe("Location: [[hexes/m/0_1|M 0, 1]]\n");
	});

	it("goes after frontmatter when there's no title, and isn't added twice", () => {
		const note = "---\ntags: [dungeon]\n---\nA cave.\n";
		const once = withLocationLine(note, "hexes/m/0_1.md", "M 0, 1");
		expect(once).toBe("---\ntags: [dungeon]\n---\nLocation: [[hexes/m/0_1|M 0, 1]]\n\nA cave.\n");
		expect(withLocationLine(once, "hexes/m/0_1.md", "M 0, 1")).toBe(once);
	});
});

// ── T2: terrain tables' dead `terrain:` key ─────────────────────────────────

describe("terrain tables (T2)", () => {
	it("new terrain tables don't get a terrain: key nothing reads", async () => {
		const src = readSurface("plugin");
		const body = src.slice(src.indexOf("// Create any still-missing table files"), src.indexOf("async backfillTerrainLinks"));
		expect(body).toContain('"table-type": tableType');
		expect(body).not.toMatch(/^\s*terrain: entry\.name,/m);
	});
});

// ── R2 through the real map store ───────────────────────────────────────────

describe("renaming a region note keeps its hexes (R2, map store)", () => {
	it("rewrites the Region values via set and the map note follows", async () => {
		const { MapStore } = await import("../src/maps/MapStore");
		const { parseMapNote } = await import("../src/maps/mapNote");
		const { MemVault } = await import("./helpers/memVault");
		const { renameRegionInStore } = await import("../src/regionMapData");
		(globalThis as Record<string, unknown>).window ??= globalThis;
		const vault = new MemVault({
			"world/hexes/coast/1_2.md": "---\nterrain: ocean\nregion: Basin\n---\n# Hex\n",
			"world/hexes/coast/3_4.md": "---\nterrain: forest\nregion: Hills\n---\n# Hex\n",
		});
		const maps = [{ name: "coast", gridSize: { cols: 6, rows: 6 }, gridOffset: { x: 0, y: 0 } }];
		const p = {
			app: vault.app(),
			manifest: { dir: ".obsidian/plugins/hexmaker" },
			settings: { hexFolder: "world/hexes", maps },
			getMap: (n: string) => maps.find((m) => m.name === n),
			saveData: async () => {},
			refreshHexMap: () => {},
		};
		const store = new MapStore(p as never);
		await store.init();
		expect(store.get("coast", "1_2")?.region).toBe("Basin");

		expect(renameRegionInStore(store, ["coast", "coast"], "Basin", "Low Basin")).toBe(1);
		await store.flush();
		expect(store.get("coast", "1_2")?.region).toBe("Low Basin");
		expect(store.get("coast", "3_4")?.region).toBe("Hills");
		const note = parseMapNote(vault.files.get("world/hexes/coast/_coast.md")!)!;
		expect(note.hexes.get("1_2")?.region).toBe("Low Basin");
		expect(note.hexes.get("3_4")?.region).toBe("Hills");
	});
});

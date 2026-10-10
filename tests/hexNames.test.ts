import { describe, it } from "node:test";
import expect from "expect";
import { buildMapNote, mapNoteKey, parseMapNote, updateMapNote, type HexData, type MapNoteData } from "../src/maps/mapNote";
import { cleanHexName, nextAliases, renamedHexes } from "../src/maps/hexNames";
import { hexHoverLabel } from "../src/hex-map/hexHover";
import { hexTableLines, type HexRow } from "../src/export/exporters/mapWithTable";
import { buildManualHtml, entryTitle, isKeyed } from "../src/export/manual/manualHtml";
import type { ManualData, ManualHex } from "../src/export/manual/manualModel";
import { pngHexNameY, pngTokenRadius } from "../src/export/handoutLabels";
import { groupSize, tokenGroupOffsets, tokenNamePlacement } from "../src/hex-map/tokenDefaults";

const note = (hexes: [string, HexData][], baseTerrain?: string): MapNoteData => ({
	settings: { gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, baseTerrain, showHexNames: false, showTokenNames: true },
	hexes: new Map(hexes),
	paths: [],
});

describe("N1: hex names in the map note", () => {
	it("round-trip through the Hexes table's Name column", () => {
		const data = note([
			["1_1", { name: "Glass Wastes", terrain: "dunes" }],
			["2_1", { name: "The | Pipe", terrain: "hills", region: "North" }],
			["3_1", { terrain: "forest" }],
		]);
		const text = buildMapNote("m", data);
		expect(text).toContain("| Hex | Name | Terrain | Icon | GM icons | Region | Submap | Locked |");
		expect(text).toContain("| 1_1 | Glass Wastes | dunes |");
		const back = parseMapNote(text)!;
		expect(back.hexes.get("1_1")).toEqual({ name: "Glass Wastes", terrain: "dunes" });
		expect(back.hexes.get("2_1")).toEqual({ name: "The | Pipe", terrain: "hills", region: "North" });
		expect(back.hexes.get("3_1")).toEqual({ terrain: "forest" });
		expect(mapNoteKey(back)).toBe(mapNoteKey(data));
	});

	it("the label toggles round-trip as frontmatter keys", () => {
		const back = parseMapNote(buildMapNote("m", note([])))!;
		expect(back.settings.showHexNames).toBe(false);
		expect(back.settings.showTokenNames).toBe(true);
		expect(buildMapNote("m", note([]))).toContain("show-hex-names: false");
	});

	it("old notes without a Name column still parse, and gain it on the next write", () => {
		const old = "---\nhexmaker-map: 1\ncols: 4\nrows: 4\n---\n## Hexes\n\n| Hex | Terrain | Icon | GM icons | Region | Submap | Locked |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1_1 | dunes |  |  | Basin |  |  |\n";
		const parsed = parseMapNote(old)!;
		expect(parsed.hexes.get("1_1")).toEqual({ terrain: "dunes", region: "Basin" });
		parsed.hexes.set("1_1", { ...parsed.hexes.get("1_1"), name: "Basin Gate" });
		const updated = updateMapNote(old, "m", parsed);
		expect(updated).toContain("| 1_1 | Basin Gate | dunes |");
		expect(parseMapNote(updated)!.hexes.get("1_1")?.name).toBe("Basin Gate");
	});

	it("a hex with only a name (and the base terrain) is still written", () => {
		const text = buildMapNote("m", note([["2_2", { name: "Lone Oak", terrain: "grass" }], ["3_3", { terrain: "grass" }]], "grass"));
		expect(text).toContain("| 2_2 | Lone Oak | grass |");
		expect(text).not.toContain("| 3_3 |");
	});

	it("names are cleaned to one line", () => {
		expect(cleanHexName("  Glass\nWastes  ")).toBe("Glass Wastes");
		expect(cleanHexName("a|b")).toBe("a b");
		expect(cleanHexName(undefined)).toBe("");
	});

	it("hover text leads with the name", () => {
		expect(hexHoverLabel(3, 4, "dunes", null, "Glass Wastes")).toBe("Glass Wastes · dunes · hex 3, 4");
		expect(hexHoverLabel(3, 4, "dunes", null)).toBe("dunes · hex 3, 4");
	});
});

describe("X4: the name as the note's alias", () => {
	it("adds the name, keeping the user's aliases", () => {
		expect(nextAliases(undefined, undefined, "Glass Wastes")).toEqual(["Glass Wastes"]);
		expect(nextAliases(["Sandsea"], undefined, "Glass Wastes")).toEqual(["Sandsea", "Glass Wastes"]);
		expect(nextAliases("Sandsea", undefined, "Glass Wastes")).toEqual(["Sandsea", "Glass Wastes"]);
	});

	it("rename swaps only the plugin's alias", () => {
		expect(nextAliases(["Sandsea", "Glass Wastes", "GW"], "Glass Wastes", "Glass Sea")).toEqual(["Sandsea", "GW", "Glass Sea"]);
	});

	it("unnaming removes the old name only", () => {
		expect(nextAliases(["Sandsea", "Glass Wastes"], "Glass Wastes", "")).toEqual(["Sandsea"]);
		expect(nextAliases(["Glass Wastes"], "Glass Wastes", null)).toEqual([]);
	});

	it("no change → null (no write)", () => {
		expect(nextAliases(["Glass Wastes"], "Glass Wastes", "Glass Wastes")).toBeNull();
		expect(nextAliases(["Glass Wastes"], undefined, "Glass Wastes")).toBeNull();
		expect(nextAliases(undefined, undefined, "")).toBeNull();
		expect(nextAliases("Sandsea", "Old", "")).toBeNull();
	});

	it("hand edits of the map note are found as renames", () => {
		const before = new Map<string, HexData>([["1_1", { name: "A" }], ["2_2", { name: "B" }], ["3_3", { terrain: "x" }]]);
		const after = new Map<string, HexData>([["1_1", { name: "A" }], ["2_2", { name: "C" }], ["3_3", { terrain: "x", name: "D" }]]);
		expect(renamedHexes(before, after)).toEqual([
			{ key: "2_2", oldName: "B", newName: "C" },
			{ key: "3_3", oldName: undefined, newName: "D" },
		]);
	});
});

describe("X1: handout options", () => {
	const row = (over: Partial<HexRow>): HexRow => ({
		hex: "1,1", name: "", terrain: "", towns: "", dungeons: "", features: "", quests: "", factions: "", encounters: "", description: "", ...over,
	});

	it("the reference table has every column by default, Name only when a hex has one", () => {
		expect(hexTableLines([row({ terrain: "grass" })])[0]).toBe("| Hex | Terrain | Towns | Dungeons | Features | Quests | Factions | Encounters | Description |");
		expect(hexTableLines([row({ terrain: "grass", name: "Lone Oak" })])[0]).toBe("| Hex | Name | Terrain | Towns | Dungeons | Features | Quests | Factions | Encounters | Description |");
	});

	it("prints only the chosen columns, dropping hexes left empty", () => {
		const lines = hexTableLines([row({ terrain: "grass", towns: "Farwharf" }), row({ hex: "2,1", terrain: "grass" })], ["towns"]);
		expect(lines).toEqual(["| Hex | Towns |", "| --- | --- |", "| 1,1 | Farwharf |"]);
		expect(hexTableLines([row({ terrain: "grass" })], ["towns"])).toEqual([]);
	});

	it("the PNG puts a hex name on the side away from the coordinates", () => {
		expect(pngHexNameY("bottom", false, 100, 50)).toBeLessThan(100);
		expect(pngHexNameY(undefined, false, 100, 50)).toBeLessThan(100);
		expect(pngHexNameY("top", false, 100, 50)).toBeGreaterThan(100);
		expect(pngHexNameY("bottom", true, 100, 50)).toBeGreaterThan(100);
	});

	it("PNG tokens keep their on-screen size relative to the hex", () => {
		expect(pngTokenRadius("md", 44)).toBeCloseTo(20);
		expect(pngTokenRadius("sm", 44)).toBeLessThan(pngTokenRadius("md", 44));
		expect(pngTokenRadius("lg", 44)).toBeGreaterThan(pngTokenRadius("md", 44));
		expect(tokenGroupOffsets(3)).toHaveLength(3);
		expect(tokenGroupOffsets(7)).toHaveLength(7);
	});

	it("N5: a lone token's name sits under it; a shared hex lists names one per line", () => {
		expect(tokenNamePlacement(tokenGroupOffsets(1), 0)).toEqual({ dx: 0, dy: 0, line: 0 });
		const two = tokenGroupOffsets(2);
		expect(tokenNamePlacement(two, 0)).toEqual({ dx: 0, dy: 0, line: 0 });
		expect(tokenNamePlacement(two, 1)).toEqual({ dx: 0, dy: 0, line: 1 });
		expect(tokenNamePlacement(tokenGroupOffsets(3), 2).dy).toBeCloseTo(0.4);
		expect(groupSize([{ size: "sm" }, { size: "lg" }])).toBe("lg");
		expect(groupSize([{ size: "sm" }, {}])).toBe("md");
		expect(groupSize([{ size: "sm" }])).toBe("sm");
	});

	const noLinks = { towns: [], dungeons: [], features: [], quests: [], factions: [] };
	const hex = (over: Partial<ManualHex> = {}): ManualHex => ({
		number: "0101", x: 0, y: 0, terrain: "grass", landmark: "", description: "", hidden: "", secret: "", weather: "", hooks: "",
		links: { ...noLinks }, ...over,
	});

	it("the manual keys and titles a named hex by its name", () => {
		expect(isKeyed(hex({ name: "Lone Oak" }), true)).toBe(true);
		expect(isKeyed(hex(), true)).toBe(false);
		expect(entryTitle(hex({ name: "Lone Oak", links: { ...noLinks, towns: ["Farwharf"] } }))).toBe("Lone Oak");
	});

	it("the manual leaves out the parts the user unticks", () => {
		const d: ManualData = {
			title: "m", version: "1", date: "2026-10-10", hexCount: 1, keyedCount: 1, player: true, numberDigits: 2,
			overviewMapUri: "data:,", legend: [{ name: "grass", color: "#6a6", hexCount: 1 }], paths: [],
			tables: [{ name: "grass", die: "d6", rows: [{ roll: "1", result: "wolves" }], usedBy: 1 }],
			factions: [{ name: "Guzzard", hexCount: 1, regions: [] }], regions: [],
			sections: [{ label: "A1", range: "0101–0101", mapUri: "data:,", hexes: [hex({ name: "Lone Oak" })] }],
			index: [{ category: "Named hexes", entries: [{ name: "Lone Oak", hexes: ["0101"] }] }],
		};
		const full = buildManualHtml(d);
		for (const s of ["Map legend", "Random encounter tables", "Factions and regions", "Index of locations"]) expect(full).toContain(s);
		const handout = buildManualHtml({ ...d, omit: ["legend", "tables", "factions", "index"] });
		for (const s of ["Map legend", "Random encounter tables", "Factions and regions", "Index of locations"]) expect(handout).not.toContain(s);
		expect(handout).toContain("Lone Oak");
	});
});

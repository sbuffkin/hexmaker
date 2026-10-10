import { describe, it } from "node:test";
import expect from "expect";
import {
	buildPaletteNote,
	paletteDerivedStale,
	parsePaletteNote,
	refreshPaletteDerived,
	serializePaletteTable,
	updatePaletteNote,
} from "../src/palettes/paletteNote";
import { parsePathTypes, pathTypesDerivedStale, serializePathTypes, setPathTypes } from "../src/palettes/pathTypeTable";
import { refreshNoteDerived } from "../src/palettes/PaletteStore";
import { classifyPaletteTable, isPaletteFrontmatter, tableMarkdown } from "../src/palettes/paletteReadingView";
import { avoidImpassableNoteCell, impassableNoteCell, parseImpassableCell, pathAvoidsImpassable } from "../src/impassable";
import { effectiveTerrainType, isDerivedCell, normalizeTerrainType, parseTerrainTypeCell, terrainTypeCell } from "../src/terrainTypes";
import type { PathType, TerrainColor } from "../src/types";

const row = (table: string, name: string) => table.split("\n").find((l) => l.startsWith(`| ${name} |`));

// P1: palette notes show the values the plugin works out, in parentheses.
describe("palette derived cells (P1)", () => {
	const terrains: TerrainColor[] = [
		{ name: "ocean", color: "#29507f", type: "water" },
		{ name: "crags", color: "#777777" },
		{ name: "ford", color: "#4a82a5", type: "shallows", impassable: false },
		{ name: "Mirror Mere", color: "#0000ff" },
	];

	it("always writes the Impassable column, defaults in parentheses", () => {
		const table = serializePaletteTable(terrains);
		expect(table.split("\n")[0]).toBe("| Terrain | Color | Icon | Icon color | Category | Type | Impassable |");
		expect(row(table, "ocean")).toBe("| ocean | #29507f |  |  |  | water | (yes) |");
		expect(row(table, "crags")).toBe("| crags | #777777 |  |  |  | (mountains) | (no) |");
		expect(row(table, "ford")).toBe("| ford | #4a82a5 |  |  |  | shallows | no |");
		// Nothing to infer: the type stays blank, the default still shows.
		expect(row(table, "Mirror Mere")).toBe("| Mirror Mere | #0000ff |  |  |  |  | (no) |");
	});

	it("round-trips: parenthesised values read back as unset", () => {
		expect(parsePaletteNote(buildPaletteNote(terrains))).toEqual(terrains);
		expect(parseImpassableCell("(yes)")).toBeUndefined();
		expect(parseImpassableCell(" (no) ")).toBeUndefined();
		expect(parseTerrainTypeCell("(mountains)")).toBeUndefined();
		expect(parseTerrainTypeCell("Snow")).toBe("snow");
		expect(parseTerrainTypeCell("lava-ish")).toBe("lava-ish");
		expect(isDerivedCell("(x)")).toBe(true);
		expect(isDerivedCell("x")).toBe(false);
	});

	it("a hand edit that removes the parentheses makes the value explicit", () => {
		const note = buildPaletteNote(terrains)
			.replace("| crags | #777777 |  |  |  | (mountains) | (no) |", "| crags | #777777 |  |  |  | mountains | yes |")
			.replace("| ocean | #29507f |  |  |  | water | (yes) |", "| ocean | #29507f |  |  |  | water | yes |");
		const parsed = parsePaletteNote(note)!;
		expect(parsed.find((t) => t.name === "crags")).toEqual({ name: "crags", color: "#777777", type: "mountains", impassable: true });
		// Same as the default, but now the user's own: kept explicit, written plain.
		expect(parsed.find((t) => t.name === "ocean")).toEqual({ name: "ocean", color: "#29507f", type: "water", impassable: true });
		expect(row(serializePaletteTable(parsed), "ocean")).toBe("| ocean | #29507f |  |  |  | water | yes |");
	});

	it("older builds read the new cells as unset", () => {
		// parseImpassableCell as shipped before derived cells (1.5.5).
		const oldParseImpassable = (raw: string | undefined) => {
			const v = (raw ?? "").trim().toLowerCase();
			if (["yes", "y", "true", "x", "✓", "impassable"].includes(v)) return true;
			if (["no", "n", "false", "-", "passable"].includes(v)) return false;
			return undefined;
		};
		expect(oldParseImpassable("(yes)")).toBeUndefined();
		expect(oldParseImpassable("(no)")).toBeUndefined();
		// Older builds kept an unknown type as typed; "(mountains)" isn't a
		// type, so the name is used, as for a blank cell.
		const oldType = normalizeTerrainType("(mountains)") ?? "(mountains)";
		expect(effectiveTerrainType({ name: "crags", type: oldType })).toBe("mountains");
	});

	it("an older-format note (no Impassable column, blank types) still reads, and is stale", () => {
		const old = "---\nhexmaker-palette: 1\n---\n\nIntro.\n\n| Terrain | Color | Icon | Icon color | Category | Type |\n| --- | --- | --- | --- | --- | --- |\n| sea | #00f |  |  |  | water |\n| crags | #777 |  |  |  |  |\n\nOutro.\n";
		expect(parsePaletteNote(old)).toEqual([
			{ name: "sea", color: "#00f", type: "water" },
			{ name: "crags", color: "#777" },
		]);
		expect(paletteDerivedStale(old)).toBe(true);
		const fresh = refreshPaletteDerived(old);
		expect(fresh).toContain("| sea | #00f |  |  |  | water | (yes) |");
		expect(fresh).toContain("| crags | #777 |  |  |  | (mountains) | (no) |");
		expect(fresh).toContain("Intro.");
		expect(fresh).toContain("Outro.");
		expect(parsePaletteNote(fresh)).toEqual(parsePaletteNote(old));
		expect(paletteDerivedStale(fresh)).toBe(false);
		expect(refreshPaletteDerived(fresh)).toBe(fresh);
	});

	it("a derived cell that no longer matches is stale; a filled one never is", () => {
		const note = buildPaletteNote(terrains);
		expect(paletteDerivedStale(note)).toBe(false);
		// The user types a type: the Impassable default it implies changes.
		const typed = note.replace("| crags | #777777 |  |  |  | (mountains) | (no) |", "| crags | #777777 |  |  |  | water | (no) |");
		expect(paletteDerivedStale(typed)).toBe(true);
		expect(refreshPaletteDerived(typed)).toContain("| crags | #777777 |  |  |  | water | (yes) |");
		// Filled-in values are the user's, whatever they say.
		const own = note.replace("| crags | #777777 |  |  |  | (mountains) | (no) |", "| crags | #777777 |  |  |  | Mountains | Y |");
		expect(paletteDerivedStale(own)).toBe(false);
	});

	it("in-app edits regenerate the derived cells", () => {
		const note = buildPaletteNote(terrains);
		const next = terrains.map((t) => (t.name === "crags" ? { ...t, type: "water" } : t));
		expect(updatePaletteNote(note, next)).toContain("| crags | #777777 |  |  |  | water | (yes) |");
	});

	it("cell helpers", () => {
		expect(terrainTypeCell({ name: "dark forest" })).toBe("(forest)");
		expect(terrainTypeCell({ name: "x", type: "hills" })).toBe("hills");
		expect(terrainTypeCell({ name: "Mirror Mere" })).toBe("");
		expect(impassableNoteCell({ name: "lake" })).toBe("(yes)");
		expect(impassableNoteCell({ name: "lake", impassable: false })).toBe("no");
	});
});

describe("path types Avoid impassable derived cells (P1)", () => {
	const types: PathType[] = [
		{ name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through" },
		{ name: "River", color: "#3b82f6", width: 3, lineStyle: "solid", routing: "meander" },
		{ name: "Trail", color: "#8b5a2b", width: 2, lineStyle: "dashed", routing: "through", avoidImpassable: false },
	];

	it("writes the default in parentheses and reads it back as unset", () => {
		const table = serializePathTypes(types);
		expect(row(table, "Road")).toBe("| Road | #a16207 | 4 | solid | through | (yes) |");
		expect(row(table, "River")).toBe("| River | #3b82f6 | 3 | solid | meander | (no) |");
		expect(row(table, "Trail")).toBe("| Trail | #8b5a2b | 2 | dashed | through | no |");
		const back = parsePathTypes(`## Path types\n\n${table}\n`)!.types;
		expect(back).toEqual(types);
		expect(back.map(pathAvoidsImpassable)).toEqual([true, false, false]);
		expect(avoidImpassableNoteCell({ name: "Creek" })).toBe("(no)");
	});

	it("a hand edit removing the parentheses makes it explicit", () => {
		const note = setPathTypes(buildPaletteNote([{ name: "grass", color: "#0f0" }]), types).replace(
			"| River | #3b82f6 | 3 | solid | meander | (no) |",
			"| River | #3b82f6 | 3 | solid | meander | no |",
		);
		expect(parsePathTypes(note)!.types[1].avoidImpassable).toBe(false);
	});

	it("an older table with blank cells reads the same and gets its defaults shown", () => {
		const old = "## Path types\n\n| Path | Color | Width | Style | Routing | Avoid impassable |\n| --- | --- | --- | --- | --- | --- |\n| Road | #a16207 | 4 | solid | through |  |\n| River | #3b82f6 | 3 | solid | meander |  |\n";
		expect(parsePathTypes(old)!.types).toEqual(types.slice(0, 2));
		expect(pathTypesDerivedStale(old)).toBe(true);
		const fresh = setPathTypes(old, types.slice(0, 2));
		expect(fresh).toContain("| River | #3b82f6 | 3 | solid | meander | (no) |");
		expect(pathTypesDerivedStale(fresh)).toBe(false);
		expect(setPathTypes(fresh, types.slice(0, 2))).toBe(fresh);
	});

	it("refreshNoteDerived updates both tables and leaves a fresh note alone", () => {
		const old = "---\nhexmaker-palette: 1\n---\n\n| Terrain | Color |\n| --- | --- |\n| lake | #00f |\n\n## Path types\n\n| Path | Color | Width | Style | Routing | Avoid impassable |\n| --- | --- | --- | --- | --- | --- |\n| River | #3b82f6 | 3 | solid | meander |  |\n";
		const fresh = refreshNoteDerived(old);
		expect(fresh).toContain("| lake | #00f |  |  |  | (water) | (yes) |");
		expect(fresh).toContain("| River | #3b82f6 | 3 | solid | meander | (no) |");
		expect(refreshNoteDerived(fresh)).toBe(fresh);
	});
});

// P2: reading view reads the rendered tables with the note parsers.
describe("palette reading view (P2)", () => {
	it("recognises the terrain table and its columns", () => {
		const headers = ["Terrain", "Color", "Icon", "Icon color", "Category", "Type", "Impassable"];
		const rows = [["ocean", "#29507f", "wave.png", "#ffffff", "", "water", "(yes)"]];
		const view = classifyPaletteTable(headers, rows)!;
		expect(view.kind).toBe("terrains");
		if (view.kind !== "terrains") return;
		expect([view.name, view.color, view.icon]).toEqual([0, 1, 2]);
		expect(view.tints.get("ocean")).toBe("#ffffff");
	});

	it("recognises the path types table and reads each row's style", () => {
		const table = serializePathTypes([{ name: "Trail | old", color: "#8b5a2b", width: 2, lineStyle: "dashed", routing: "edge" }]);
		const lines = table.split("\n");
		const headers = ["Path", "Color", "Width", "Style", "Routing", "Avoid impassable"];
		expect(lines[0]).toBe(`| ${headers.join(" | ")} |`);
		const view = classifyPaletteTable(headers, [["Trail | old", "#8b5a2b", "2", "dashed", "edge", "(yes)"]])!;
		expect(view.kind).toBe("paths");
		if (view.kind !== "paths") return;
		expect(view.types.get("Trail | old")).toMatchObject({ lineStyle: "dashed", routing: "edge", width: 2 });
	});

	it("leaves other tables alone", () => {
		expect(classifyPaletteTable(["Terrain", "Palette", "Generator"], [["moon", "Space", "blank"]])).toBeNull();
		expect(classifyPaletteTable(["a", "b"], [["1", "2"]])).toBeNull();
	});

	it("only palette notes are decorated", () => {
		expect(isPaletteFrontmatter({ "hexmaker-palette": 1 })).toBe(true);
		expect(isPaletteFrontmatter({ tags: [] })).toBe(false);
		expect(isPaletteFrontmatter(null)).toBe(false);
	});

	it("tableMarkdown escapes pipes", () => {
		expect(tableMarkdown(["A"], [["x|y"]])).toBe("| A |\n| --- |\n| x\\|y |");
	});
});

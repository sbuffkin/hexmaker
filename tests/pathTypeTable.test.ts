import { describe, it } from "node:test";
import expect from "expect";
import { parsePathTypes, serializePathTypes, setPathTypes, PATH_TYPES_HEADING } from "../src/palettes/pathTypeTable";
import { buildPaletteNote, parsePaletteNote } from "../src/palettes/paletteNote";
import { DEFAULT_PATH_TYPES } from "../src/constants";

const NOTE = buildPaletteNote([{ name: "grass", color: "#00ff00" }]);

describe("palette path types table", () => {
	it("round-trips the default path types", () => {
		const note = setPathTypes(NOTE, DEFAULT_PATH_TYPES);
		expect(note).toContain(PATH_TYPES_HEADING);
		expect(parsePathTypes(note)!.types).toEqual(DEFAULT_PATH_TYPES);
		// The terrain table is still the terrain table.
		expect(parsePaletteNote(note)).toEqual([{ name: "grass", color: "#00ff00" }]);
	});

	it("reads hand-typed tables forgivingly: any column order, aliases, case, loose values", () => {
		const note = [
			"## path types",
			"",
			"| Style | Name | Colour | Line width | Routing | Avoid |",
			"|-|-|-|-|-|-|",
			"| Dashed | Trail | #8b5a2b | 2 |  | no |",
			"| . . dotted | Ley line | violet | 40 | along the edge | |",
			"| solid | Creek | #39f |  |  | yes |",
		].join("\n");
		const types = parsePathTypes(note)!.types;
		expect(types[0]).toMatchObject({ name: "Trail", lineStyle: "dashed", routing: "through", avoidImpassable: false });
		expect(types[1]).toMatchObject({ name: "Ley line", color: "violet", lineStyle: "dotted", routing: "edge" });
		expect(types[1].avoidImpassable).toBeUndefined();
		// No routing given: a creek meanders like a river; a missing width is the default.
		expect(types[2]).toMatchObject({ routing: "meander", width: 3, avoidImpassable: true });
	});

	it("clamps widths to 1–10", () => {
		const note = "| Path | Width |\n| --- | --- |\n| A | 40 |\n| B | 0 |\n| C | 4px |";
		expect(parsePathTypes(note)!.types.map((t) => t.width)).toEqual([10, 1, 4]);
	});

	it("reports rows without a name or repeating one, and keeps them in the note", () => {
		const note = setPathTypes(NOTE, DEFAULT_PATH_TYPES).replace(
			"| River |",
			"|  | #123456 | 2 | solid | through |  |\n| road | #000000 | 1 | solid | through |  |\n| River |",
		);
		const parsed = parsePathTypes(note)!;
		expect(parsed.skipped).toHaveLength(2);
		expect(parsed.types.map((t) => t.name)).toEqual(["Road", "River"]);
		const rewritten = setPathTypes(note, parsed.types);
		expect(rewritten).toContain("| road | #000000 |");
		expect(rewritten).toContain("couldn't read");
		expect(parsePathTypes(rewritten)!.skipped).toEqual([]);
	});

	it("keeps the user's own columns and the text around the table", () => {
		const note = [
			"Intro.",
			"",
			"## Path types",
			"",
			"| Path | Color | Width | Style | Routing | Avoid impassable | Travel days |",
			"| --- | --- | --- | --- | --- | --- | --- |",
			"| Road | #a16207 | 4 | solid | through | yes | 1 per 3 hexes |",
			"",
			"Outro.",
		].join("\n");
		const types = parsePathTypes(note)!.types;
		types[0].color = "#000000";
		const out = setPathTypes(note, types);
		expect(out).toContain("| Road | #000000 | 4 | solid | through | yes | 1 per 3 hexes |");
		expect(out).toContain("Intro.");
		expect(out).toContain("Outro.");
	});

	it("returns the note untouched when nothing changed", () => {
		const note = setPathTypes(NOTE, DEFAULT_PATH_TYPES);
		expect(setPathTypes(note, DEFAULT_PATH_TYPES.map((t) => ({ ...t })))).toBe(note);
	});

	it("an empty table (header kept) means no path types", () => {
		const note = `${NOTE}\n## Path types\n\n${serializePathTypes([])}\n`;
		expect(parsePathTypes(note)!.types).toEqual([]);
	});

	it("the terrain Type column takes a type's label or any case, and keeps what it can't place", () => {
		const note = "| Terrain | Color | Type |\n| --- | --- | --- |\n| sea | #00f | Deep water |\n| ice | #fff | snow |\n| bog | #350 | WETLAND |\n| odd | #123 | moonrock |";
		expect(parsePaletteNote(note)!.map((t) => t.type)).toEqual(["deep-water", "snow", "wetland", "moonrock"]);
	});

	it("a path table placed before the terrains isn't mistaken for the terrain table", () => {
		const note = "| Name | Color | Width |\n| --- | --- | --- |\n| Road | #111 | 3 |\n\n| Terrain | Color |\n| --- | --- |\n| sea | #00f |";
		expect(parsePaletteNote(note)).toEqual([{ name: "sea", color: "#00f" }]);
		expect(parsePathTypes(note)!.types.map((t) => t.name)).toEqual(["Road"]);
	});
});

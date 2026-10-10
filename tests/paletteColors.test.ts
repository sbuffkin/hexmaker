import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { colorCell, colorCellStale, parseColorCell } from "../src/palettes/colorCell";
import { buildPaletteNote, parsePaletteNote, updatePaletteNote, wrapPaletteColors } from "../src/palettes/paletteNote";
import { parsePathTypes, setPathTypes, wrapPathTypeColors } from "../src/palettes/pathTypeTable";
import { refreshNoteDerived, wrapNoteColors } from "../src/palettes/PaletteStore";
import { classifyPaletteTable } from "../src/palettes/paletteReadingView";
import type { PathType, TerrainColor } from "../src/types";

// Colours in palette notes are written as inline code (`#14223d`), because
// Obsidian reads a bare #14223d in a note's body as a tag.

const FIXTURE = readFileSync(path.join(process.cwd(), "tests", "fixtures", "compat", "palette-bare-colours.md"), "utf8").replace(/\r\n/g, "\n");

const TERRAINS: TerrainColor[] = [
	{ name: "ocean", color: "#14223d", category: "sea", type: "water" },
	{ name: "grass", color: "#69a168", icon: "bw-grassland.png", iconColor: "#ffffff" },
	{ name: "glow", color: "rgb(1, 2, 3)", iconColor: "violet" },
];
const PATHS: PathType[] = [
	{ name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" },
	{ name: "Ley", color: "hsl(280 60% 50%)", width: 2, lineStyle: "dotted", routing: "edge", avoidImpassable: false, autoRoute: "winding" },
];

/** Body text outside inline code and frontmatter: where Obsidian looks for tags. */
function tagsIn(note: string): string[] {
	const body = note.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/`[^`\n]*`/g, "").replace(/^ {4}.*$/gm, "");
	return body.match(/(?<![\w#])#[A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*/g) ?? [];
}

describe("colour cells", () => {
	it("every spelling of a colour reads as the same colour", () => {
		for (const raw of ["`#14223d`", "#14223d", "14223d", "` #14223D `", "  #14223D  ", "`14223D`"]) {
			expect(parseColorCell(raw)).toBe("#14223d");
		}
		expect(parseColorCell("abc")).toBe("#abc");
		expect(parseColorCell("#ABCD")).toBe("#abcd");
		expect(parseColorCell("`violet`")).toBe("violet");
		expect(parseColorCell("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
		expect(parseColorCell("")).toBe("");
		expect(parseColorCell("``")).toBe("");
		expect(parseColorCell(undefined)).toBe("");
	});

	it("writes every colour as inline code; an empty cell stays empty", () => {
		expect(colorCell("#14223D")).toBe("`#14223d`");
		expect(colorCell("violet")).toBe("`violet`");
		expect(colorCell("rgb(1, 2, 3)")).toBe("`rgb(1, 2, 3)`");
		expect(colorCell("")).toBe("");
		expect(colorCell(undefined)).toBe("");
		expect(colorCellStale("`#14223d`")).toBe(false);
		expect(colorCellStale("")).toBe(false);
		expect(colorCellStale("#14223d")).toBe(true);
		expect(colorCellStale("`#14223D`")).toBe(true);
	});
});

describe("palette notes write colours as inline code", () => {
	it("round-trips the terrain and path types tables", () => {
		const note = setPathTypes(buildPaletteNote(TERRAINS), PATHS);
		expect(note).toContain("| ocean | `#14223d` |  |  | sea | water |");
		expect(note).toContain("| grass | `#69a168` | bw-grassland.png | `#ffffff` |");
		expect(note).toContain("| glow | `rgb(1, 2, 3)` |  | `violet` |");
		expect(note).toContain("| Road | `#a16207` | 4 |");
		expect(note).toContain("| Ley | `hsl(280 60% 50%)` | 2 |");
		expect(parsePaletteNote(note)).toEqual(TERRAINS);
		expect(parsePathTypes(note)!.types).toEqual(PATHS);
		expect(tagsIn(note)).toEqual([]);
		// Nothing left to convert or refresh.
		expect(wrapNoteColors(note)).toBe(note);
		expect(refreshNoteDerived(note, PATHS)).toBe(note);
	});

	it("an in-app edit writes the whole terrain table with inline-code colours", () => {
		const updated = updatePaletteNote(FIXTURE, parsePaletteNote(FIXTURE)!);
		expect(updated).toContain("| ocean | `#14223d` |");
		expect(updated).toContain("| grass | `#69a168` | bw-grassland.png | `#fff` |");
		expect(updated).toContain("deep #blue water"); // the user's own column, as typed
	});
});

describe("older palette notes (bare colours)", () => {
	it("still read, with every spelling (compat fixture)", () => {
		expect(parsePaletteNote(FIXTURE)!.map((t) => [t.name, t.color, t.iconColor])).toEqual([
			["ocean", "#14223d", undefined],
			["grass", "#69a168", "#fff"],
			["crags", "#777777", "violet"],
			["ash | cinder", "rgb(51, 51, 51)", undefined],
		]);
		expect(parsePathTypes(FIXTURE)!.types.map((t) => [t.name, t.color])).toEqual([
			["Road", "#a16207"],
			["River", "#3b82f6"],
			["Trail", "#888888"],
		]);
	});

	it("convert only the colour cells; every other character stays", () => {
		const out = wrapNoteColors(FIXTURE);
		const before = FIXTURE.split("\n");
		const after = out.split("\n");
		expect(after).toHaveLength(before.length);
		const changed = before.flatMap((l, i) => (l === after[i] ? [] : [[l, after[i]]]));
		expect(changed).toEqual([
			["| ocean | #14223d |  |  | sea | water | (yes) | deep #blue water |", "| ocean | `#14223d` |  |  | sea | water | (yes) | deep #blue water |"],
			["| grass |   69A168   | bw-grassland.png | #FFF | lowlands | (grassland) | (no) | spaced out |", "| grass |   `#69a168`   | bw-grassland.png | `#fff` | lowlands | (grassland) | (no) | spaced out |"],
			["| crags | `#777777` |  | violet |  | (mountains) | (no) |  |", "| crags | `#777777` |  | `violet` |  | (mountains) | (no) |  |"],
			["| ash \\| cinder | rgb(51, 51, 51) | bw-volcano.png |  |  |  | (no) | escaped pipe |", "| ash \\| cinder | `rgb(51, 51, 51)` | bw-volcano.png |  |  |  | (no) | escaped pipe |"],
			["| Road | #a16207 | 4 | solid | through | yes | direct |", "| Road | `#a16207` | 4 | solid | through | yes | direct |"],
			["| River | ` #3B82F6 ` | 3 | solid | meander | no | winding |", "| River | `#3b82f6` | 3 | solid | meander | no | winding |"],
		]);
		expect(parsePaletteNote(out)).toEqual(parsePaletteNote(FIXTURE));
		expect(parsePathTypes(out)!.types).toEqual(parsePathTypes(FIXTURE)!.types);
		// The user's own #tag in their prose is theirs; no colour is a tag any more.
		expect(tagsIn(FIXTURE)).toContain("#a16207");
		expect(tagsIn(out)).toEqual(["#blue", "#tag"]);
	});

	it("keep CRLF line endings when converted", () => {
		const crlf = FIXTURE.replace(/\n/g, "\r\n");
		const out = wrapNoteColors(crlf);
		expect(out).toBe(wrapNoteColors(FIXTURE).replace(/\n/g, "\r\n"));
	});

	it("convert idempotently: a second pass changes nothing", () => {
		const once = wrapNoteColors(FIXTURE);
		expect(wrapNoteColors(once)).toBe(once);
		expect(wrapPaletteColors(once)).toBe(once);
		expect(wrapPathTypeColors(once)).toBe(once);
		const refreshed = refreshNoteDerived(FIXTURE);
		expect(refreshNoteDerived(refreshed)).toBe(refreshed);
		expect(tagsIn(refreshed)).toEqual(["#blue", "#tag"]);
	});

	it("a note with nothing to convert is returned as is", () => {
		const plain = "Just text with #tag.\n\n| A | B |\n| - | - |\n| #fff | x |\n";
		expect(wrapNoteColors(plain)).toBe(plain);
	});
});

describe("reading view of a converted note", () => {
	it("reads the colour out of the code chip (its text has no backticks)", () => {
		const headers = ["Terrain", "Color", "Icon", "Icon color"];
		const view = classifyPaletteTable(headers, [["grass", "#69a168", "bw-grassland.png", "#ffffff"]]);
		expect(view?.kind).toBe("terrains");
		if (view?.kind !== "terrains") return;
		expect(view.color).toBe(1);
		expect(view.tints.get("grass")).toBe("#ffffff");
	});
});

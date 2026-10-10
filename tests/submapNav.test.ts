import { describe, it } from "node:test";
import expect from "expect";
import { defaultSubmapLabel, defaultSubmapName, mapAncestors, uniqueMapSlug } from "../src/hex-map/submapNav";
import {
	buildPaletteNote,
	parsePaletteNote,
	readChildPalette,
	setChildPalette,
} from "../src/palettes/paletteNote";
import { PALETTE_PRESETS, SPACE_SECTOR_PALETTE_NAME, SPACE_SYSTEM_PALETTE_NAME, presetToPalette } from "../src/palettes/presets";

describe("mapAncestors", () => {
	const parents: Record<string, string | undefined> = {
		galaxy: undefined,
		sector: "galaxy",
		"sector-3-4": "sector",
		station: "sector-3-4",
	};
	const parentOf = (m: string) => parents[m];

	it("lists ancestors root first, excluding the start map", () => {
		expect(mapAncestors("station", parentOf)).toEqual(["galaxy", "sector", "sector-3-4"]);
		expect(mapAncestors("sector", parentOf)).toEqual(["galaxy"]);
	});

	it("is empty for a root map or an unknown map", () => {
		expect(mapAncestors("galaxy", parentOf)).toEqual([]);
		expect(mapAncestors("nowhere", parentOf)).toEqual([]);
	});

	it("stops on cycles instead of looping", () => {
		const cyc: Record<string, string> = { a: "b", b: "c", c: "a" };
		expect(mapAncestors("a", (m) => cyc[m])).toEqual(["c", "b"]);
		expect(mapAncestors("self", () => "self")).toEqual([]);
	});

	it("caps the depth", () => {
		const deep = (m: string) => `${m}x`;
		expect(mapAncestors("m", deep, 3)).toHaveLength(3);
	});
});

describe("defaultSubmapName", () => {
	it("names a submap after its parent and hex", () => {
		expect(defaultSubmapName("sector", 3, 4, [])).toBe("sector-3-4");
		expect(defaultSubmapName("Spinward Marches", -1, 0, [])).toBe("spinward-marches--1-0");
	});

	it("adds a counter when the name is taken", () => {
		expect(defaultSubmapName("sector", 3, 4, ["sector-3-4"])).toBe("sector-3-4-2");
		expect(defaultSubmapName("sector", 3, 4, ["sector-3-4", "sector-3-4-2"])).toBe("sector-3-4-3");
	});
});

describe("child-palette frontmatter", () => {
	const terrains = [{ name: "void", color: "#000000" }];

	it("is written by buildPaletteNote and read back", () => {
		const note = buildPaletteNote(terrains, "Space - System");
		expect(readChildPalette(note)).toBe("Space - System");
		expect(parsePaletteNote(note)).toEqual(terrains);
		expect(readChildPalette(buildPaletteNote(terrains))).toBeUndefined();
	});

	it("reads quoted, unquoted and CRLF values", () => {
		expect(readChildPalette("---\nchild-palette: Overland\n---\n")).toBe("Overland");
		expect(readChildPalette("---\r\nchild-palette: 'Overland'\r\n---\r\n")).toBe("Overland");
		expect(readChildPalette("---\nchild-palette:\n---\n")).toBeUndefined();
		expect(readChildPalette("child-palette: not frontmatter")).toBeUndefined();
	});

	it("sets, replaces and clears the value, keeping other frontmatter and the body", () => {
		const base = "---\nhexmaker-palette: 1\ntags: [x]\n---\nBody text\n";
		const set = setChildPalette(base, "Space - System");
		expect(readChildPalette(set)).toBe("Space - System");
		expect(set).toContain("tags: [x]");
		expect(set).toContain("Body text");

		const replaced = setChildPalette(set, "Overland");
		expect(readChildPalette(replaced)).toBe("Overland");
		expect(replaced.match(/child-palette/g)).toHaveLength(1);

		const cleared = setChildPalette(replaced, undefined);
		expect(readChildPalette(cleared)).toBeUndefined();
		expect(cleared).toBe(base);
	});

	it("adds frontmatter when the note has none", () => {
		const out = setChildPalette("| Terrain | Color |\n|---|---|\n| a | #000 |", "B");
		expect(readChildPalette(out)).toBe("B");
		expect(parsePaletteNote(out)).toEqual([{ name: "a", color: "#000" }]);
	});

	it("returns content untouched when the value already matches (no CRLF churn)", () => {
		const crlf = "---\r\nchild-palette: \"B\"\r\n---\r\nbody\r\n";
		expect(setChildPalette(crlf, "B")).toBe(crlf);
		const none = "plain\r\nnote";
		expect(setChildPalette(none, undefined)).toBe(none);
	});
});

describe("preset child palettes", () => {
	it("Space - Sector suggests Space - System, and installs carry it", () => {
		const sector = PALETTE_PRESETS.find((p) => p.name === SPACE_SECTOR_PALETTE_NAME)!;
		expect(sector.childPalette).toBe(SPACE_SYSTEM_PALETTE_NAME);
		expect(presetToPalette(sector).childPalette).toBe(SPACE_SYSTEM_PALETTE_NAME);
	});

	it("every child palette names a real preset", () => {
		const names = new Set(PALETTE_PRESETS.map((p) => p.name));
		for (const p of PALETTE_PRESETS) if (p.childPalette) expect(names.has(p.childPalette)).toBe(true);
	});
});

// NAV2 = A: new submaps get a readable default name; the folder name is derived.
describe("NAV2: readable submap names", () => {
	it("defaults to the hex's name, else '<parent display name> x, y'", () => {
		expect(defaultSubmapLabel("Glass Wastes", "The Realm", 3, 4)).toBe("Glass Wastes");
		expect(defaultSubmapLabel("  Glass   Wastes ", "The Realm", 3, 4)).toBe("Glass Wastes");
		expect(defaultSubmapLabel(undefined, "The Realm", 3, 4)).toBe("The Realm 3, 4");
		expect(defaultSubmapLabel("", "sector", -1, 0)).toBe("sector -1, 0");
		expect(defaultSubmapLabel("   ", "sector", 2, 2)).toBe("sector 2, 2");
	});

	it("the folder name is a free slug made from the name", () => {
		expect(uniqueMapSlug("The Realm 3, 4", [])).toBe("the-realm-3-4");
		expect(uniqueMapSlug("sector -1, 0", [])).toBe("sector--1-0");
		expect(uniqueMapSlug("Glass Wastes", ["glass-wastes"])).toBe("glass-wastes-2");
		expect(uniqueMapSlug("Glass Wastes", ["glass-wastes", "glass-wastes-2"])).toBe("glass-wastes-3");
		// Nothing left of the name: still a usable folder.
		expect(uniqueMapSlug("!!!", [])).toBe("submap");
		expect(uniqueMapSlug("!!!", ["submap"])).toBe("submap-2");
	});

	it("defaultSubmapName keeps its old slug shape", () => {
		expect(defaultSubmapName("sector", 3, 4, [])).toBe("sector-3-4");
	});
});

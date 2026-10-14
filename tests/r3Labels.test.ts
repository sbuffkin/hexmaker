import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { layoutHexName, NAME_LINE_HEIGHT, NAME_MAX_FONT_EM, NAME_MIN_FONT_EM } from "../src/hex-map/hexNameLayer";
import {
	DEFAULT_NAME_FONT,
	MIN_NAME_SCREEN_PX,
	NAME_FONT_STACKS,
	nameFontShorthand,
	nameSizeId,
	nameStyleId,
	parseNameFamily,
	parseNameSize,
	parseNameStyle,
	readableFloorEm,
	resolveNameFont,
} from "../src/hex-map/hexNameFont";
import { pngHexNamePx } from "../src/export/handoutLabels";
import { buildMapNote, parseMapNote, readMapNote, type MapNoteData } from "../src/maps/mapNote";
import {
	DEFAULT_SECTION_WORDS,
	MAP_KINDS,
	newTerrains,
	kindForChain,
	mapKindInfo,
	sectionWords,
	sectionWordsFor,
	terrainsForTables,
	type MapKindInfo,
} from "../src/mapKinds";
import { linkedNotesText } from "../src/hex-map/linkBadges";
import { hexTableLines, type HexRow } from "../src/export/exporters/mapWithTable";
import { buildManualHtml } from "../src/export/manual/manualHtml";
import type { ManualData, ManualHex } from "../src/export/manual/manualModel";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import { readSurface } from "./helpers/source";

const read = (...p: string[]) => readFileSync(p.join("/"), "utf8").replace(/\r\n/g, "\n");

// ── NM3: hex names always legible, overflow allowed, font options ──────────

// A bold sans font: about 0.6em a character, narrower for i/l/space.
const measure = (t: string) => [...t].reduce((w, c) => w + (c === " " ? 0.28 : /[il.']/.test(c) ? 0.3 : /[mwMW]/.test(c) ? 0.9 : 0.6), 0);
const flat = { measure, hexW: 4.4, hexH: 3.81, flat: true };
const pointy = { measure, hexW: 3.81, hexH: 4.4, flat: false };
const NAMES = ["Hut", "Gullmouth", "The Drowned Abbey", "Old Mill of the Fens by the Long Grey Lake", "Supercalifragilisticexpialidocious"];

describe("NM3: hex names keep a readable size on screen", () => {
	it("works out the floor from the grid's font and the zoom", () => {
		expect(readableFloorEm(16, 1)).toBeCloseTo(MIN_NAME_SCREEN_PX / 16);
		expect(readableFloorEm(16, 0.5)).toBeCloseTo(MIN_NAME_SCREEN_PX / 8);
		expect(readableFloorEm(40, 1)).toBeCloseTo(MIN_NAME_SCREEN_PX / 40);
		expect(MIN_NAME_SCREEN_PX).toBeGreaterThanOrEqual(10);
		expect(MIN_NAME_SCREEN_PX).toBeLessThanOrEqual(11);
	});

	it("never sets a name smaller than the floor, at any zoom", () => {
		for (const o of [flat, pointy]) {
			for (const gridPx of [4, 6, 9, 16, 30, 60]) {
				const floorEm = readableFloorEm(gridPx, 1);
				for (const name of NAMES) {
					const l = layoutHexName(name, { ...o, floorEm });
					// On screen: font em × grid px ≥ the minimum.
					expect(l.fontEm * gridPx).toBeGreaterThanOrEqual(MIN_NAME_SCREEN_PX - 0.01);
				}
			}
		}
	});

	it("on a fitted 20×16 map (tiny hexes) long names spill past the hex at the readable size", () => {
		// About 6px per grid em when a 20×16 map fits a laptop view.
		const floorEm = readableFloorEm(6, 1);
		expect(floorEm).toBeGreaterThan(NAME_MAX_FONT_EM);
		const l = layoutHexName("The Drowned Abbey", { ...flat, floorEm });
		expect(l.fontEm).toBeCloseTo(floorEm, 2);
		expect(l.overflow).toBe(true);
		expect(l.lines.join(" ")).toBe("The Drowned Abbey");
	});

	it("wraps only at spaces and never cuts, even when spilling", () => {
		for (const o of [flat, pointy]) {
			for (const floorEm of [undefined, 0.2, 0.7, 1.5, 3]) {
				for (const name of NAMES) {
					const l = layoutHexName(name, { ...o, floorEm });
					expect(l.lines.join(" ")).toBe(name);
					expect(l.lines.join("")).not.toContain("…");
					expect(l.lines.length).toBeLessThanOrEqual(3);
				}
			}
		}
	});

	it("spills away from the coordinates, not over them", () => {
		const floorEm = 2; // far bigger than the hex allows
		const name = "Old Mill of the Fens";
		// Coordinates at the bottom: the label's lower edge stays near the centre.
		const up = layoutHexName(name, { ...flat, floorEm, coords: "bottom" });
		const h = up.lines.length * NAME_LINE_HEIGHT * up.fontEm;
		expect(up.dyEm + h / 2).toBeLessThanOrEqual(0.35 + 1e-3);
		// Coordinates at the top: its upper edge does.
		const down = layoutHexName(name, { ...flat, floorEm, coords: "top" });
		const h2 = down.lines.length * NAME_LINE_HEIGHT * down.fontEm;
		expect(down.dyEm - h2 / 2).toBeGreaterThanOrEqual(-0.35 - 1e-3);
	});

	it("zoomed in, a long name shrinks to stay inside its hex rather than spill", () => {
		const l = layoutHexName("Old Mill of the Fens by the Long Grey Lake", { ...flat, floorEm: 0.1 });
		expect(l.overflow).toBe(false);
		expect(l.fontEm).toBeLessThan(NAME_MIN_FONT_EM);
	});

	it("scales the size with the map's name size", () => {
		expect(layoutHexName("Hut", { ...flat, scale: 1.5 }).fontEm).toBeCloseTo(NAME_MAX_FONT_EM * 1.5, 3);
		expect(layoutHexName("Hut", { ...flat, scale: 0.85 }).fontEm).toBeCloseTo(NAME_MAX_FONT_EM * 0.85, 3);
		// A bigger size can't push a name below the readable floor either.
		const l = layoutHexName("The Drowned Abbey", { ...flat, scale: 1.5, floorEm: 0.9 });
		expect(l.fontEm).toBeGreaterThanOrEqual(0.9);
	});

	it("keeps the labels' CSS in step: font from the layer, lines as computed", () => {
		const css = read("styles.css");
		const at = css.indexOf(".duckmage-hex-name-label {");
		const rule = css.slice(at, css.indexOf("}", at));
		expect(rule).toMatch(/font-family:\s*var\(--duckmage-name-family/);
		expect(rule).toMatch(/font-weight:\s*var\(--duckmage-name-weight/);
		expect(rule).toMatch(/font-style:\s*var\(--duckmage-name-style/);
		expect(rule).toMatch(/white-space:\s*pre/);
	});

	it("a bigger name size raises the readable floor (L / XL still read bigger zoomed out)", () => {
		const layer = read("src", "hex-map", "hexNameLayer.ts");
		expect(layer).toMatch(/readableFloorEm\(gridFont, zoom\) \* Math\.max\(1, font\.scale\)/);
	});

	it("redraws names when the zoom settles (the floor depends on it)", () => {
		const src = readSurface("map-view");
		expect(src).toMatch(/if \(this\.zoom !== this\.namesZoom\)/);
		expect(src).toMatch(/renderHexNameLayer\([^)]*font, this\.zoom\)/);
	});
});

describe("NM3: hex-name font options", () => {
	it("reads font, size and style forgivingly", () => {
		expect(parseNameFamily("Serif")).toBe("serif");
		expect(parseNameFamily("sans-serif")).toBe("sans");
		expect(parseNameFamily("Handwritten")).toBe("handwritten");
		expect(parseNameFamily("script")).toBe("handwritten");
		expect(parseNameFamily("theme")).toBe("theme");
		expect(parseNameFamily("comic")).toBeUndefined();
		expect(parseNameSize("large")).toBe(1.25);
		expect(parseNameSize("XL")).toBe(1.5);
		expect(parseNameSize("120%")).toBeCloseTo(1.2);
		expect(parseNameSize("1.1")).toBeCloseTo(1.1);
		expect(parseNameSize(9)).toBe(3); // clamped
		expect(parseNameSize("big")).toBeUndefined();
		expect(parseNameStyle("Bold Italic")).toEqual({ bold: true, italic: true });
		expect(parseNameStyle("regular")).toEqual({ bold: false, italic: false });
		expect(parseNameStyle("italic")).toEqual({ bold: false, italic: true });
		expect(parseNameStyle("fancy")).toBeUndefined();
	});

	it("uses the map's choice, then the plugin default, then bold theme medium", () => {
		expect(resolveNameFont(undefined, undefined)).toEqual(DEFAULT_NAME_FONT);
		const global = { hexNameFont: "serif", hexNameSize: "large", hexNameStyle: "italic" };
		expect(resolveNameFont({}, global)).toMatchObject({ family: "serif", size: "large", bold: false, italic: true });
		// Per key: the map overrides only what it sets; junk falls through.
		expect(resolveNameFont({ hexNameFont: "handwritten", hexNameSize: "junk" }, global))
			.toMatchObject({ family: "handwritten", size: "large", italic: true });
		expect(nameSizeId(1.1)).toBeNull();
		expect(nameStyleId(true, true)).toBe("bold italic");
		expect(nameStyleId(false, false)).toBe("regular");
	});

	it("builds the same font for the canvas (PNG) as on screen", () => {
		const f = resolveNameFont({ hexNameFont: "serif", hexNameStyle: "bold italic" }, undefined);
		expect(nameFontShorthand(f, 14, "Inter")).toBe(`italic 700 14px ${NAME_FONT_STACKS.serif}`);
		expect(nameFontShorthand(DEFAULT_NAME_FONT, 12, "Inter")).toBe("700 12px Inter");
	});

	it("bundles no fonts: every stack ends in a generic family", () => {
		for (const stack of Object.values(NAME_FONT_STACKS)) expect(stack).toMatch(/(serif|sans-serif|cursive)$/);
	});

	it("sizes PNG names by the map's size, never below the readable minimum", () => {
		expect(pngHexNamePx(100)).toBe(27);
		expect(pngHexNamePx(100, 1.5)).toBe(41);
		expect(pngHexNamePx(10, 0.85)).toBe(MIN_NAME_SCREEN_PX);
		const src = readSurface("png-renderer");
		expect(src).toMatch(/resolveNameFont\(map, plugin\.settings\)/);
		expect(src).toMatch(/pngHexNamePx\(R, nameFont\.scale\)/);
	});

	it("stores the font in the map note as plain keys, and flags unreadable ones", () => {
		const data: MapNoteData = {
			settings: { paletteName: "Default", gridSize: { cols: 3, rows: 2 }, gridOffset: { x: 0, y: 0 }, hexNameFont: "serif", hexNameSize: "large", hexNameStyle: "bold italic" },
			hexes: new Map(),
			paths: [],
		};
		const note = buildMapNote("m", data);
		expect(note).toContain("name-font: serif");
		expect(note).toContain("name-size: large");
		expect(note).toContain("name-style: bold italic");
		const back = parseMapNote(note)!;
		expect(back.settings).toMatchObject({ hexNameFont: "serif", hexNameSize: "large", hexNameStyle: "bold italic" });
		// Typed by hand: read as written, a typo is listed (and kept), not fatal.
		const typo = readMapNote(note.replace("name-font: serif", "name-font: Gothic").replace("name-size: large", "name-size: 130%"));
		expect(typo?.ok).toBe(true);
		if (!typo?.ok) return;
		expect(typo.data.settings.hexNameSize).toBe("130%");
		expect(typo.data.problems?.some((p) => p.key === "name-font")).toBe(true);
	});

	it("has the font row in the layers menu Labels group, and the default in settings (both paths)", () => {
		const panel = readSurface("side-panel");
		expect(panel).toMatch(/buildNameFontRow\(labelTitle, labelGroup\)/);
		const tab = readSurface("settings-tab");
		expect(tab).toMatch(/key: "hexNameFont"/);
		// The pre-1.13 page draws the same definitions (display → renderDefinitions).
		expect(tab).toContain("this.renderDefinitions(containerEl, this.getSettingDefinitions())");
	});
});

// ── G4b: space-flavoured section names, by map type ────────────────────────

const space = MAP_KINDS.find((k) => k.id === "space")!;

describe("G4b: link section words follow the map type", () => {
	it("uses the usual words with no map type", () => {
		for (const [s, w] of Object.entries(DEFAULT_SECTION_WORDS)) expect(sectionWords(s)).toEqual(w);
		expect(sectionWords("towns").label).toBe("Towns"); // any case
	});

	it("space maps say Settlements, Sites, Points of Interest, Missions", () => {
		const w = sectionWordsFor(space);
		expect(w("Towns")).toEqual({ label: "Settlements", one: "Settlement", noun: "a settlement" });
		expect(w("dungeons").label).toBe("Sites");
		expect(w("Features").label).toBe("Points of Interest");
		expect(w("Quests").label).toBe("Missions");
		// Not listed: the usual words.
		expect(w("Factions").label).toBe("Factions");
		expect(w("Encounters Table").label).toBe("Encounters Table");
	});

	it("finds the type from the palette's terrain types, then the parents' (not from names)", () => {
		const t = (terrains: { type?: string }[], kind?: string) => ({ terrains, kind });
		expect(kindForChain([t(SPACE_SECTOR_TERRAINS)])).toBe("space");
		expect(kindForChain([t(SPACE_SYSTEM_TERRAINS)])).toBe("space");
		expect(kindForChain([t(DEFAULT_TERRAIN_PALETTE)])).toBeUndefined();
		// A planet surface (shared land types, no type declared) under a star system keeps the space words.
		expect(kindForChain([t(DEFAULT_TERRAIN_PALETTE), t(SPACE_SYSTEM_TERRAINS)])).toBe("space");
		// A palette named "Space" with no space types is not space.
		expect(kindForChain([t([{ type: "forest" }])])).toBeUndefined();
		// CM3: the nearest declared type wins (a world palette under a system is world).
		expect(kindForChain([t(DEFAULT_TERRAIN_PALETTE, "world"), t(SPACE_SYSTEM_TERRAINS, "space")])).toBe("world");
	});

	it("is data: a map type's section words come from its module", () => {
		const custom: MapKindInfo = { ...space, id: "space", sectionWords: { Towns: { label: "Habitats", one: "Habitat", noun: "a habitat" } } };
		expect(sectionWordsFor(custom)("Towns").label).toBe("Habitats");
		expect(mapKindInfo("space")).toBe(space);
		expect(sectionWordsFor(mapKindInfo(kindForChain([{ terrains: [{ type: "void" }] }])))("Towns").label).toBe("Settlements");
	});

	it("names links in the hover text, the PDF table and the manual in those words", () => {
		const w = sectionWordsFor(space);
		expect(linkedNotesText(new Map([["Towns", ["Kerrigan IV"]], ["Dungeons", ["A", "B"]]]), w)).toBe("Settlement: Kerrigan IV · Sites: A, B");
		const row: HexRow = { hex: "1, 1", name: "", terrain: "void", towns: "Port", dungeons: "", features: "", quests: "", factions: "", encounters: "", description: "" };
		expect(hexTableLines([row], ["towns"], w)[0]).toBe("| Hex | Settlements |");
		expect(hexTableLines([row], ["towns"])[0]).toBe("| Hex | Towns |");
		const noLinks = { towns: [], dungeons: [], features: [], quests: [], factions: [] };
		const hex: ManualHex = { number: "0101", x: 0, y: 0, terrain: "void", landmark: "", description: "", hidden: "", secret: "", weather: "", hooks: "", links: { ...noLinks, towns: ["Port"] } };
		const d: ManualData = {
			title: "m", version: "1", date: "2026-10-10", hexCount: 1, keyedCount: 1, player: true, numberDigits: 2,
			overviewMapUri: "data:,", legend: [], paths: [], tables: [], factions: [], regions: [],
			sections: [{ label: "A1", range: "0101–0101", mapUri: "data:,", hexes: [hex] }],
			index: [], linkLabels: { towns: "Settlements" },
		};
		expect(buildManualHtml(d)).toContain("Settlements");
	});

	it("is wired into the hex editor, hex table, badges legend and exports", () => {
		expect(readSurface("hex-editor")).toMatch(/sectionWordsFor\(this\.mapName\)\(section\)/);
		expect(readSurface("hex-table")).toMatch(/this\.colLabel\(col\)/);
		expect(readSurface("map-view")).toMatch(/label: words\(s\)\.label/);
		expect(readSurface("png-renderer")).toMatch(/name: sectionWords\(s\)\.label/);
		expect(read("src", "export", "exporters", "singleHex.ts")).toMatch(/sectionWordsFor\(/);
		expect(read("src", "export", "exporters", "hexcrawlManual.ts")).toMatch(/linkLabels:/);
	});
});

// ── HG5: every terrain gets (empty) tables when it's created ───────────────

describe("HG5: new terrains get their tables", () => {
	it("spots terrains not seen before, once each", () => {
		const known = new Set(["forest", "hills"]);
		const now = [{ name: "forest" }, { name: "lava" }, { name: "hills" }, { name: "lava" }, { name: "ash" }];
		expect(newTerrains(known, now).map((t) => t.name)).toEqual(["lava", "ash"]);
		expect(newTerrains(new Set(["lava", "ash", "forest", "hills"]), now)).toEqual([]);
	});

	it("covers every palette a map uses, even one of a map type that's off", () => {
		const world = { name: "Limited", terrains: [{ name: "forest" }] };
		const sector = { name: "Sector", terrains: SPACE_SECTOR_TERRAINS };
		// Space only: the fantasy palette is skipped (G4) …
		expect(terrainsForTables([world, sector], ["space"]).some((t) => t.name === "forest")).toBe(false);
		// … unless a map uses it.
		expect(terrainsForTables([world, sector], ["space"], ["Limited"]).some((t) => t.name === "forest")).toBe(true);
	});

	it("runs after every save and palette-note import, creates empty tables, and moves them on rename", () => {
		const src = readSurface("plugin");
		const save = /async saveSettings\(\)[\s\S]*?\n {2}\}/.exec(src)![0];
		expect(save).toMatch(/void this\.(plugin\.)?ensureTablesForNewTerrains\(\)/);
		expect(read("src", "palettes", "PaletteStore.ts")).toMatch(/ensureTablesForNewTerrains\(\)/);
		const create = /private async createTerrainTableFiles[\s\S]*?\n {2}\}/.exec(src)![0];
		// The usual template with no rows: makeTableTemplate(dice, fm, link) — no 4th (rows) argument.
		expect(create).toMatch(/this\.buildRollerLink\(\),\n\s*\),/);
		const rename = /private async renameTerrainTables[\s\S]*?\n {2}\}/.exec(src)![0];
		expect(rename).toMatch(/fileManager\.renameFile\(oldFile, newPath\)/);
		// A new terrain named in its editor moves its placeholder's tables.
		expect(read("src", "hex-map", "TerrainEntryEditorModal.ts")).toMatch(/if \(nameChanged\) await this\.plugin\.renameTerrain\(this\.entry, this\.pendingName\)/);
	});
});

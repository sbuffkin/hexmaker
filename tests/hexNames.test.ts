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

// ── Round 6: readable names (S4, U5), token names (S8), PNG labels (S5) ────
import { balancedLines, ellipsize, hexHalfWidthAt, hexNameTone, layoutHexName, NAME_MAX_FONT_EM, NAME_MIN_FONT_EM, NAME_LINE_HEIGHT } from "../src/hex-map/hexNameLayer";
import { clampLabelTop, clampLabelX, pngBadgeCircles, wrapHexName } from "../src/export/handoutLabels";
import { readFileSync as readCss } from "node:fs";

describe("hex name labels read on any terrain (round 6 S4)", () => {
	it("puts dark text on light terrain and light text on dark terrain", () => {
		expect(hexNameTone("#ffffff")).toBe("dark"); // snow
		expect(hexNameTone("#e0e8a0")).toBe("dark"); // pale hills
		expect(hexNameTone("#2a4d7a")).toBe("light"); // ocean
		expect(hexNameTone("#5f9e5f")).toBe("light"); // grass
	});

	it("keeps the theme colours with no or an unknown fill", () => {
		expect(hexNameTone(undefined)).toBeNull();
		expect(hexNameTone("var(--x)")).toBeNull();
	});

	it("has CSS for both tones", () => {
		const css = readCss("styles.css", "utf8");
		expect(css).toMatch(/\.duckmage-hex-name-label\.is-on-light\s*\{/);
		expect(css).toMatch(/\.duckmage-hex-name-label\.is-on-dark\s*\{/);
	});
});

describe("hex names stay inside their hex (round 6 U5, round 7 R7)", () => {
	// A bold sans font: about 0.6em a character, narrower for i/l/space.
	const measure = (t: string) => [...t].reduce((w, c) => w + (c === " " ? 0.28 : /[il.']/.test(c) ? 0.3 : /[mwMW]/.test(c) ? 0.9 : 0.6), 0);
	const flat = { measure, hexW: 4.4, hexH: 3.81, flat: true };
	const pointy = { measure, hexW: 3.81, hexH: 4.4, flat: false };
	const fitsInHex = (l: ReturnType<typeof layoutHexName>, o: typeof flat) => {
		const h = l.lines.length * NAME_LINE_HEIGHT * l.fontEm;
		const far = Math.abs(l.dyEm) + h / 2;
		const room = 2 * hexHalfWidthAt(far, o.hexW, o.hexH, o.flat);
		return l.lines.every((line) => measure(line) * l.fontEm <= room + 1e-9);
	};

	it("keeps a short name on one line at full size", () => {
		const l = layoutHexName("Hut", flat);
		expect(l.lines).toEqual(["Hut"]);
		expect(l.fontEm).toBe(NAME_MAX_FONT_EM);
		expect(l.cut).toBe(false);
	});

	it("never breaks inside a word (the tester saw 'The / Drowne', 'Gullmout / h')", () => {
		for (const o of [flat, pointy]) {
			for (const name of ["The Drowned Abbey", "Gullmouth", "Saltmere Keep", "Hermit's Hut"]) {
				const l = layoutHexName(name, o);
				expect(l.cut).toBe(false);
				// Joined back with spaces, the lines are exactly the name.
				expect(l.lines.join(" ")).toBe(name);
				expect(l.lines.length).toBeLessThanOrEqual(3);
				expect(fitsInHex(l, o)).toBe(true);
			}
		}
	});

	it("shrinks a single long word rather than wrapping it", () => {
		const l = layoutHexName("Gullmouth", flat);
		expect(l.lines).toEqual(["Gullmouth"]);
		expect(l.fontEm).toBeLessThan(NAME_MAX_FONT_EM);
		expect(l.fontEm).toBeGreaterThanOrEqual(NAME_MIN_FONT_EM);
	});

	it("splits at the most balanced spaces", () => {
		expect(balancedLines(["The", "Drowned", "Abbey"], 2, measure)).toEqual(["The Drowned", "Abbey"]);
		expect(balancedLines(["The", "Drowned", "Abbey"], 3, measure)).toEqual(["The", "Drowned", "Abbey"]);
		expect(balancedLines(["Old", "Mill", "of", "the", "Fens"], 2, measure)).toEqual(["Old Mill of", "the Fens"]);
		expect(balancedLines(["Hut"], 2, measure)).toEqual(["Hut"]);
	});

	it("uses a third line rather than cutting a name beside the badges", () => {
		// Flat hex, one M badge at the right: the tester's dungeon.
		const l = layoutHexName("The Drowned Abbey", { ...flat, rightLimit: 2.55 - 1.2 - 0.08 });
		expect(l.cut).toBe(false);
		expect(l.lines.join(" ")).toBe("The Drowned Abbey");
		expect(l.dxEm).toBeLessThan(0); // shifted left, clear of the badge
	});

	it("ellipsizes a word too wide even at the smallest size", () => {
		const l = layoutHexName("Supercalifragilisticexpialidocious", flat);
		expect(l.lines).toHaveLength(1);
		expect(l.lines[0].endsWith("…")).toBe(true);
		expect(l.cut).toBe(true);
		expect(l.fontEm).toBe(NAME_MIN_FONT_EM);
		expect(fitsInHex(l, flat)).toBe(true);
	});

	it("cuts a name that needs more than three lines after whole words", () => {
		const name = "Old Mill of the Fens by the Long Grey Lake of Kings";
		const l = layoutHexName(name, flat);
		expect(l.lines.length).toBeLessThanOrEqual(3);
		expect(l.cut).toBe(true);
		expect(l.lines[l.lines.length - 1].endsWith("…")).toBe(true);
		// The lines before the last hold whole words only.
		expect(name.startsWith(l.lines.slice(0, -1).join(" ") + " ")).toBe(true);
		expect(fitsInHex(l, flat)).toBe(true);
	});

	it("sits on the side away from the coordinates", () => {
		expect(layoutHexName("Saltmere Keep", { ...flat, coords: "bottom" }).dyEm).toBeLessThanOrEqual(0);
		expect(layoutHexName("Saltmere Keep", { ...flat, coords: "top" }).dyEm).toBeGreaterThanOrEqual(0);
		// Coordinates in the middle: the name keeps clear of the centre.
		const mid = layoutHexName("Hut", { ...flat, coords: "middle" });
		expect(mid.dyEm - (NAME_LINE_HEIGHT * mid.fontEm) / 2).toBeGreaterThanOrEqual(0.5 - 1e-3);
	});

	it("ellipsize keeps what fits and adds an ellipsis", () => {
		expect(ellipsize("Abbey", 10, measure)).toBe("Abbey");
		const cut = ellipsize("Abbeyfield", 3, measure);
		expect(cut.endsWith("…")).toBe(true);
		expect(measure(cut)).toBeLessThanOrEqual(3);
	});

	it("lets CSS show the computed lines as they are (no CSS word breaking)", () => {
		const css = readCss("styles.css", "utf8");
		const at = css.indexOf(".duckmage-hex-name-label {");
		const rule = css.slice(at, css.indexOf("}", at));
		expect(rule).toMatch(/white-space:\s*pre/);
		expect(rule).toMatch(/font-size:\s*var\(--duckmage-name-font/);
		expect(rule).not.toMatch(/overflow-wrap:\s*anywhere|line-clamp/);
	});

	it("wraps PNG names at the most balanced space", () => {
		const m = (s: string) => s.length * 10;
		expect(wrapHexName("Hut", 100, m)).toEqual(["Hut"]);
		expect(wrapHexName("Frostfang Watchtower of the Old Kings", 100, m))
			.toEqual(["Frostfang Watchtower", "of the Old Kings"]);
		expect(wrapHexName("Supercalifragilistic", 100, m)).toEqual(["Supercalifragilistic"]);
	});
});

describe("token names are readable on the map (round 6 S8)", () => {
	it("are at least 0.9em and 11px", () => {
		const css = readCss("styles.css", "utf8");
		const at = css.indexOf(".duckmage-token-name {");
		const rule = css.slice(at, css.indexOf("}", at));
		expect(rule).toMatch(/font-size:\s*max\(0\.9em, 11px\)/);
	});
});

describe("PNG labels stay inside the image (round 6 S5)", () => {
	it("shifts a label at the right edge inward", () => {
		// "CSV Meridian Resolve", 200px wide, centred 30px from the right edge.
		expect(clampLabelX(970, 200, 1000, 4)).toBe(896);
		expect(clampLabelX(20, 200, 1000, 4)).toBe(104);
		expect(clampLabelX(500, 200, 1000, 4)).toBe(500);
		expect(clampLabelX(50, 2000, 1000, 4)).toBe(500);
	});

	it("lifts a label that would run off the bottom", () => {
		expect(clampLabelTop(990, 24, 1000, 4)).toBe(972);
		expect(clampLabelTop(-5, 24, 1000, 4)).toBe(4);
	});
});

describe("link badges in the PNG (round 6 R6)", () => {
	it("stacks up to three in one column at the hex's right side (size S)", () => {
		const c = pngBadgeCircles(100, 100, 44, true, 2, "s"); // em = 20px
		expect(c).toHaveLength(2);
		expect(c[0].r).toBeCloseTo(8);
		// Right edge at cx + 1.95em, centred on the middle row.
		expect(c[0].x + c[0].r).toBeCloseTo(139);
		expect((c[0].y + c[1].y) / 2).toBeCloseTo(100);
	});

	it("uses two columns for four or five kinds", () => {
		const c = pngBadgeCircles(0, 0, 22, false, 5, "s");
		expect(new Set(c.map((p) => p.x.toFixed(2))).size).toBe(2);
		expect(new Set(c.map((p) => p.y.toFixed(2))).size).toBe(3);
	});
});

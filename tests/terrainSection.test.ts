import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { terrainStartsCollapsed } from "../src/hex-map/terrainSection";
import { FILTER_FROM, filterMatches } from "../src/ui/pickers";

describe("hex editor Terrain section (fresh-eyes round 5)", () => {
	it("a hex with a terrain opens collapsed to its summary; a bare hex opens expanded", () => {
		expect(terrainStartsCollapsed(true, false)).toBe(true);
		expect(terrainStartsCollapsed(false, false)).toBe(false);
	});

	it("collapsing it once keeps it collapsed; expanding it doesn't stick (round 6 R3)", () => {
		expect(terrainStartsCollapsed(false, true)).toBe(true);
		expect(terrainStartsCollapsed(true, true)).toBe(true);
		// After "▸ change" on one hex, the next hex with a terrain still opens collapsed.
		expect(terrainStartsCollapsed(true, false)).toBe(true);
	});

	it("the filter matches names case-insensitively; blank shows all", () => {
		expect(filterMatches("hill", "Forested Hills")).toBe(true);
		expect(filterMatches("  FOREST ", "Forested Hills")).toBe(true);
		expect(filterMatches("ocean", "cliffs")).toBe(false);
		expect(filterMatches("", "cliffs")).toBe(true);
		expect(FILTER_FROM).toBeLessThan(50);
	});

	const modal = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexEditorModal.ts"), "utf8").replace(/\r\n/g, "\n");
	const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");
	const r5 = css.slice(css.indexOf("Fresh-eyes r5 (map view"));

	it("the editor wires the start state and the summary hint, and never remembers an expand", () => {
		expect(modal).toMatch(/terrainStartsCollapsed\(directTerrain !== null, s\.hexEditorTerrainCollapsed \?\? false\)/);
		expect(modal).toMatch(/text: "▸ change"/);
		expect(modal).not.toMatch(/settings\.hexEditorTerrainExpanded\s*=/);
	});

	it("long palettes get a filter box and the grid grows instead of scrolling in a small box", () => {
		expect(modal).toMatch(/addPickerFilter\(grid, \{\s*things: "terrains",\s*count: palette\.length/);
		expect(modal).toMatch(/cls: "duckmage-terrain-picker duckmage-terrain-picker-grow"/);
		expect(r5).toMatch(/\.duckmage-hex-editor \.duckmage-terrain-picker\.duckmage-terrain-picker-grow \{\s*max-height: none;\s*overflow-y: visible;/);
	});
});

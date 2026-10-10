import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { TERRAIN_FILTER_MIN, terrainMatches, terrainStartsCollapsed } from "../src/hex-map/terrainSection";

describe("hex editor Terrain section (fresh-eyes round 5)", () => {
	it("a hex with a terrain opens collapsed to its summary; a bare hex opens expanded", () => {
		expect(terrainStartsCollapsed(true, false, undefined)).toBe(true);
		expect(terrainStartsCollapsed(false, false, undefined)).toBe(false);
	});

	it("expanding it once keeps it expanded; collapsing it once keeps it collapsed", () => {
		expect(terrainStartsCollapsed(true, false, true)).toBe(false);
		expect(terrainStartsCollapsed(false, true, false)).toBe(true);
		expect(terrainStartsCollapsed(true, true, false)).toBe(true);
	});

	it("the filter matches names case-insensitively; blank shows all", () => {
		expect(terrainMatches("Forested Hills", "hill")).toBe(true);
		expect(terrainMatches("Forested Hills", "  FOREST ")).toBe(true);
		expect(terrainMatches("cliffs", "ocean")).toBe(false);
		expect(terrainMatches("cliffs", "")).toBe(true);
		expect(TERRAIN_FILTER_MIN).toBeLessThan(50);
	});

	const modal = readFileSync(path.join(process.cwd(), "src", "hex-map", "HexEditorModal.ts"), "utf8").replace(/\r\n/g, "\n");
	const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8").replace(/\r\n/g, "\n");
	const r5 = css.slice(css.indexOf("Fresh-eyes r5 (map view"));

	it("the editor wires the start state, the summary hint and the remembered expand", () => {
		expect(modal).toMatch(/terrainStartsCollapsed\(directTerrain !== null, s\.hexEditorTerrainCollapsed \?\? false, s\.hexEditorTerrainExpanded\)/);
		expect(modal).toMatch(/text: "▸ change"/);
		expect(modal).toMatch(/if \(flag === "hexEditorTerrainCollapsed"\) this\.plugin\.settings\.hexEditorTerrainExpanded = collapsed;/);
	});

	it("long palettes get a filter box and the grid grows instead of scrolling in a small box", () => {
		expect(modal).toMatch(/palette\.length > TERRAIN_FILTER_MIN[\s\S]{0,200}placeholder: "Filter terrains…"/);
		expect(modal).toMatch(/cls: "duckmage-terrain-picker duckmage-terrain-picker-grow"/);
		expect(r5).toMatch(/\.duckmage-hex-editor \.duckmage-terrain-picker\.duckmage-terrain-picker-grow \{\s*max-height: none;\s*overflow-y: visible;/);
	});
});

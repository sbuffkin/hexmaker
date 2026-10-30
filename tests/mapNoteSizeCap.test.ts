import { describe, it } from "node:test";
import expect from "expect";
import { buildMapNote, parseMapNote, summaryLines, updateMapNote, type HexData } from "../src/maps/mapNote";
import { MAX_GRID_SIDE } from "../src/sizeInput";
import { readSource } from "./helpers/source";

const note = (fm: string, body = "") => `---\nhexmaker-map: 6\n${fm}\n---\n# m\n\n${body}`;

describe("map note size: capped at the size fields' maximum (security #4)", () => {
	it("a huge cols/rows reads as the maximum, quickly, and is reported", () => {
		const t0 = Date.now();
		const d = parseMapNote(note("cols: 100000000\nrows: 99999999"))!;
		expect(d.settings.gridSize).toEqual({ cols: MAX_GRID_SIDE, rows: MAX_GRID_SIDE });
		expect(d.problems!.map((p) => [p.key, p.field, p.text])).toEqual([
			["cols", "gridSize", "cols: 100000000"],
			["rows", "gridSize", "rows: 99999999"],
		]);
		expect(d.problems![0].reason).toMatch(/200 or less/);
		// Every map-note write counts terrain over cols × rows: bounded now.
		summaryLines({ settings: d.settings, hexes: new Map(), paths: [] });
		expect(Date.now() - t0).toBeLessThan(2000);
	});

	it("sizes up to the maximum (the owner's largest map, chult, is 63 × 61) read unchanged, with no problem", () => {
		for (const [cols, rows] of [[63, 61], [MAX_GRID_SIDE, MAX_GRID_SIDE], [1, 1]]) {
			const d = parseMapNote(note(`cols: ${cols}\nrows: ${rows}`))!;
			expect(d.settings.gridSize).toEqual({ cols, rows });
			expect(d.problems ?? []).toEqual([]);
		}
		const hexes = new Map<string, HexData>([["62_60", { terrain: "grass" }]]);
		const back = parseMapNote(buildMapNote("chult", { settings: { gridSize: { cols: 63, rows: 61 } }, hexes, paths: [] }))!;
		expect(back.settings.gridSize).toEqual({ cols: 63, rows: 61 });
	});

	it("a rewrite keeps the note's own value and its hexes past the cut (nothing is lost)", () => {
		const src = note("cols: 250\nrows: 10", "## Hexes\n\n| Hex | Terrain |\n| --- | --- |\n| 240,3 | forest |\n| 1,1 | grass |\n");
		const d = parseMapNote(src)!;
		expect(d.settings.gridSize).toEqual({ cols: MAX_GRID_SIDE, rows: 10 });
		expect(d.hexes.get("240_3")?.terrain).toBe("forest");
		const out = updateMapNote(src, "m", { settings: d.settings, hexes: d.hexes, paths: d.paths });
		expect(out).toMatch(/^cols: 250$/m);
		expect(out).toMatch(/^rows: 10$/m);
		expect(out).toMatch(/^\| 240_3 \| forest \|/m);
		expect(out).toMatch(/cols: 250.*200 or less/);
	});

	it("the size fields use the same maximum", () => {
		for (const f of ["src/SetupWizardView.ts", "src/worldgen/NewMapSetupModal.ts", "src/modules/gen-page/sections/previewColumn.ts"]) {
			const maxes = [...readSource(f).matchAll(/(?:sizeFromInput\(\w+|makeScrubbable\((?:cols|rows)\w*)[^)]*?max: (\d+)/g)].map((m) => Number(m[1]));
			expect(maxes.length).toBeGreaterThan(0);
			for (const m of maxes) expect(m).toBe(MAX_GRID_SIDE);
		}
	});
});

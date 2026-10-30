import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { applyTokenFrontmatter } from "../src/frontmatter";
import { applyGridChange, applyGridUndo, bandIsBlank, prepareGrid } from "../src/hex-map/gridChange";
import { gridBoxOf, type GridBox } from "../src/maps/gridGrowth";
import type { UndoItem } from "../src/hex-map/undoItems";
import { readSource } from "./helpers/source";

/** plan-hf4-map-grows: the "grid" undo entry (a map that grew, taken back while its new rows are blank). */

const SMALL: GridBox = { x: 0, y: 0, cols: 3, rows: 3 };
const GROWN: GridBox = { x: 0, y: -2, cols: 3, rows: 5 };

function setup(files: Record<string, string> = {}) {
	const vault = new MemVault(files);
	const cells = new Map<string, Record<string, unknown>>();
	const map = { name: "m", gridSize: { cols: 3, rows: 5 }, gridOffset: { x: 0, y: -2 } };
	let saves = 0;
	const plugin = {
		app: vault.app(),
		getMap: (n: string) => (n === "m" ? map : undefined),
		saveSettings: async () => { saves++; },
		mapStore: { get: (_m: string, k: string) => cells.get(k) },
		hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
	};
	const item: Extract<UndoItem, { kind: "grid" }> = { kind: "grid", mapName: "m", before: SMALL, after: GROWN };
	return { vault, cells, map, plugin, item, saves: () => saves };
}

describe("the grid undo entry", () => {
	it("undo takes the grown rows back while they are blank; redo grows them again", () => {
		const s = setup();
		expect(prepareGrid(s.plugin as never, s.item, "undo")).toBe(s.item);
		expect(applyGridUndo(s.plugin as never, s.item, "undo")).toBe(true);
		expect(gridBoxOf(s.map)).toEqual(SMALL);
		expect(prepareGrid(s.plugin as never, s.item, "undo")).toBeNull();
		expect(prepareGrid(s.plugin as never, s.item, "redo")).toBe(s.item);
		expect(applyGridUndo(s.plugin as never, s.item, "redo")).toBe(true);
		expect(gridBoxOf(s.map)).toEqual(GROWN);
		expect(s.saves()).toBe(2);
	});

	it("a grid changed since (a + button) is left alone", () => {
		const s = setup();
		applyGridChange(s.plugin as never, "m", { ...GROWN, cols: 4 });
		expect(prepareGrid(s.plugin as never, s.item, "undo")).toBeNull();
	});

	it("rows with map data, a hex note or a token since stay", async () => {
		const painted = setup();
		painted.cells.set("1_-2", { terrain: "forest" });
		expect(applyGridUndo(painted.plugin as never, painted.item, "undo")).toBe(false);
		expect(gridBoxOf(painted.map)).toEqual(GROWN);

		const noted = setup({ "world/hexes/m/2_-1.md": "# 2, -1\n" });
		expect(bandIsBlank(noted.plugin as never, "m", GROWN, SMALL)).toBe(false);

		const token = setup({ "world/tokens/Scout.md": "" });
		await applyTokenFrontmatter(token.plugin.app as never, "world/tokens/Scout.md", { hex: "0_-1", map: "m", visible: true });
		expect(bandIsBlank(token.plugin as never, "m", GROWN, SMALL)).toBe(false);
		// A token inside the old grid doesn't count.
		const inside = setup({ "world/tokens/Scout.md": "" });
		await applyTokenFrontmatter(inside.plugin.app as never, "world/tokens/Scout.md", { hex: "1_1", map: "m", visible: true });
		expect(bandIsBlank(inside.plugin as never, "m", GROWN, SMALL)).toBe(true);
	});

	it("the map view prepares and applies it, then keeps the view still", () => {
		const undo = readSource("src/hex-map/view/undoController.ts");
		expect(undo).toMatch(/case "grid": return prepareGrid\(/);
		expect(undo).toMatch(/applyGridUndo\(this\.host\.plugin, item, dir\)[\s\S]{0,120}this\.host\.renderGrid\(\);\s*this\.host\.keepViewStill\(before, gridBoxOf\(map\)\);/);
	});
});

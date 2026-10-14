/**
 * The uncharted marker: a "?" only on hexes whose On arrival cell is still
 * unresolved, drawn without layout reads (CLAUDE.md read-then-write rule),
 * toggled from the layers menu (Labels → Uncharted, on by default).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { renderUnchartedLayer, unchartedKeys, UNCHARTED_LAYER_CLASS } from "../src/hex-map/unchartedLayer";
import { parseMapNote, buildMapNote } from "../src/maps/mapNote";
import { readSurface } from "./helpers/source";

/** Just enough of an element for the layer: children, classes, text, css props. */
class FakeEl {
	children: FakeEl[] = [];
	props: Record<string, string> = {};
	constructor(public cls = "", public text = "", public parent?: FakeEl) {}
	createDiv(o: { cls?: string } = {}) { const c = new FakeEl(o.cls, "", this); this.children.push(c); return c; }
	createSpan(o: { cls?: string; text?: string } = {}) { const c = new FakeEl(o.cls, o.text, this); this.children.push(c); return c; }
	setCssProps(p: Record<string, string>) { Object.assign(this.props, p); }
	querySelector(sel: string) { return this.children.find((c) => `.${c.cls}` === sel) ?? null; }
	remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
}

const placements = [
	{ key: "0,0", ox: 10, oy: 10 },
	{ key: "1,0", ox: 30, oy: 10 },
	{ key: "2,0", ox: 50, oy: 10 },
];

describe("the uncharted marker", () => {
	it("marks only hexes with an On arrival roll still to make", () => {
		const keys = unchartedKeys(new Map([
			["0_0", { onArrival: "Uncharted" }],
			["1_0", {}],
			["2_0", { onArrival: "  " }],
		]));
		expect([...keys]).toEqual(["0_0"]);
		const grid = new FakeEl();
		renderUnchartedLayer(grid as never, placements, { w: 100, h: 20 }, keys);
		const layer = grid.querySelector(`.${UNCHARTED_LAYER_CLASS}`)!;
		expect(layer.children.map((c) => c.text)).toEqual(["?"]);
		expect(layer.children[0].props).toEqual({ "--duckmage-uncharted-x": "10.000%", "--duckmage-uncharted-y": "50.000%" });
	});

	it("redraws in place, and leaves no layer once every cell is resolved", () => {
		const grid = new FakeEl();
		renderUnchartedLayer(grid as never, placements, { w: 100, h: 20 }, new Set(["0_0", "2_0"]));
		renderUnchartedLayer(grid as never, placements, { w: 100, h: 20 }, new Set(["2_0"]));
		expect(grid.children).toHaveLength(1);
		expect(grid.children[0].children).toHaveLength(1);
		renderUnchartedLayer(grid as never, placements, { w: 100, h: 20 }, new Set());
		expect(grid.children).toHaveLength(0);
	});

	it("never reads layout: it uses the coordinate layer's measured placements", () => {
		const src = readFileSync(path.join(__dirname, "../src/hex-map/unchartedLayer.ts"), "utf8");
		for (const read of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "getBoundingClientRect", "getComputedStyle"]) {
			expect(src.includes(`.${read}`) || src.includes(`${read}(`)).toBe(false);
		}
		// The view draws it right after the coordinate layer measured the hexes.
		const view = readSurface("map-view");
		const body = view.slice(view.indexOf("private renderMeasuredLayers"));
		expect(body.indexOf("this.renderCoordLabelsLayer(gridContainer)")).toBeLessThan(body.indexOf("renderUnchartedLayer("));
		expect(body.indexOf("renderUnchartedLayer(gridContainer, this.coordPlacements")).toBeGreaterThan(0);
	});

	it("its layers-menu toggle is kept per map in the map note (show-uncharted)", () => {
		const note = buildMapNote("drift", { settings: { paletteName: "Space - Sector", gridSize: { cols: 2, rows: 2 }, gridOffset: { x: 0, y: 0 }, showUncharted: false } as never, hexes: new Map(), paths: [] });
		expect(note).toContain("show-uncharted: false");
		expect(parseMapNote(note)!.settings.showUncharted).toBe(false);
		const panel = readSurface("side-panel");
		expect(panel).toMatch(/key: "showUncharted",\s+label: "Uncharted \(\?\)", cssClass: "duckmage-hide-uncharted",\s+inLabels: true/);
		const css = readFileSync(path.join(__dirname, "../styles.css"), "utf8");
		expect(css).toContain(".duckmage-hide-uncharted .duckmage-uncharted-layer { display: none; }");
	});
});

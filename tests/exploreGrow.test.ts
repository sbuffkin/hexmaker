import { describe, it } from "node:test";
import expect from "expect";
import { fakeRoot } from "./helpers/fakeDom";
import { setup, undoRedo } from "./helpers/exploreFixture";
import { capGrowth, gridBoxOf } from "../src/maps/gridGrowth";
import { AT_MAX_SIZE } from "../src/hexflower/exploreGrow";
import { exploreStep } from "../src/hexflower/exploreHooks";
import { EXPLORE_PROPS, GROW_LABEL } from "../src/hexflower/exploreProps";
import { EXPLORE_FIELDS } from "../src/hexflower/exploreFields";

/** Owner HF4 (plan-hf4-map-grows): an explored map grows as the party nears its edge. */

describe("the map grows as the party nears its edge (HF4)", () => {
	it("a step into an edge hex grows that side by sight + 3, blank, as the first part of the step's undo", async () => {
		const s = setup();
		await s.flowers.init();
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_0" });
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -3, cols: 5, rows: 8 });
		expect(undo.map((u) => u.kind)).toEqual(["grid", "cells", "map-field"]);
		// Blank: only the hex entered was filled.
		expect([...s.store.all("m").keys()]).toEqual(["2_0"]);
		expect(s.notices[0]).toMatch(/\nThe map grew 3 rows north\.$/);
		// The next step north has room.
		await exploreStep(s.plugin as never, { map: "m", from: "2_0", to: "2_-1" });
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -3, cols: 5, rows: 8 });
	});

	it("a step in the middle, a map that isn't explored, explore-grow: off and a map with neighbouring regions don't grow", async () => {
		const mid = setup();
		await mid.flowers.init();
		await exploreStep(mid.plugin as never, { map: "m", from: "2_1", to: "2_2" });
		expect(gridBoxOf(mid.mapData)).toEqual({ x: 0, y: 0, cols: 5, rows: 5 });

		const plain = setup({ exploreWith: [] });
		await plain.flowers.init();
		expect(await exploreStep(plain.plugin as never, { map: "m", from: "2_1", to: "2_0" })).toEqual([]);
		expect(gridBoxOf(plain.mapData).rows).toBe(5);

		const off = setup({ exploreGrow: "off" });
		await off.flowers.init();
		await exploreStep(off.plugin as never, { map: "m", from: "2_1", to: "2_0" });
		expect(gridBoxOf(off.mapData).rows).toBe(5);

		const world = setup({ world: { id: "w", cx: 0, cy: 0 } }, "regionA");
		await world.flowers.init();
		await exploreStep(world.plugin as never, { map: "regionA", from: "2_1", to: "2_0" });
		await exploreStep(world.plugin as never, { map: "regionA", from: "2_0", to: "1_0" });
		expect(gridBoxOf(world.mapData).rows).toBe(5);
		// Told once a session.
		expect(world.notices.filter((n) => n === "This map has neighbouring regions, so it can't grow.")).toHaveLength(1);
	});

	it("the step's reveal fills into the new hexes; one undo takes the fills and the rows back; redo brings both", async () => {
		const s = setup({ exploreReveal: "1 ring" });
		await s.flowers.init();
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_0" });
		// Sight 1: the "?" ring is 2 out, so grow to 1 + 3 = 4 rows of room.
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -4, cols: 5, rows: 9 });
		expect(s.store.get("m", "2_-1")?.terrain).toBeTruthy();
		const filled = [...s.store.all("m")];
		await undoRedo(s.plugin, undo, "undo");
		expect(s.store.all("m").size).toBe(0);
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: 0, cols: 5, rows: 5 });
		await undoRedo(s.plugin, undo, "redo");
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -4, cols: 5, rows: 9 });
		expect([...s.store.all("m")]).toEqual(filled);
	});

	it("undo keeps the rows when one of their hexes was painted since", async () => {
		const s = setup();
		await s.flowers.init();
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_0" });
		s.store.set("m", "3_-2", { terrain: "hills" });
		await undoRedo(s.plugin, undo, "undo");
		expect(s.store.get("m", "2_0")).toBeUndefined();
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -3, cols: 5, rows: 8 });
	});

	it("the party's Reveal button grows for the rings it reveals, and fills into them", async () => {
		const s = setup({ gridSize: { cols: 5, rows: 9 } });
		await s.flowers.init();
		s.store.set("m", "0_4", { terrain: "forest" });
		const undo = await s.ex.reveal("m", "0_4", 2);
		// Sight 2 from the left edge: room for 2 + 3 columns to the west.
		expect(gridBoxOf(s.mapData)).toEqual({ x: -5, y: 0, cols: 10, rows: 9 });
		expect(undo[0]).toMatchObject({ kind: "grid" });
		expect(s.store.get("m", "-2_4")?.terrain).toBeTruthy();
		expect(s.notices.at(-1)).toMatch(/The map grew 5 columns west\.$/);
	});

	it("Map properties: a switch, on by default, writes explore-grow: off only when turned off", async () => {
		const s = setup();
		const { root, el } = fakeRoot();
		EXPLORE_PROPS.render(el as never, s.plugin as never, s.mapData as never, () => {});
		const box = root.all((e) => e.tag === "input" && e.attrs["aria-label"] === GROW_LABEL)[0] as unknown as { checked: boolean; fire(t: string): void };
		expect(box.checked).toBe(true);
		box.checked = false;
		box.fire("change");
		expect(s.mapData.exploreGrow).toBe("off");
		box.checked = true;
		box.fire("change");
		expect("exploreGrow" in s.mapData).toBe(false);
		expect(EXPLORE_FIELDS.find((f) => f.field === "exploreGrow")?.key).toBe("explore-grow");
	});

});

describe("growth stops at the biggest map (HF8 step 5, owner C2)", () => {
	it("cuts the room so no side passes 200 hexes, then stops; says so once a session", async () => {
		const s = setup({ gridSize: { cols: 5, rows: 198 }, gridOffset: { x: 0, y: 0 } }, "tall");
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "tall", from: "2_1", to: "2_0" });
		// It wanted 3 rows north; only 2 fit.
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -2, cols: 5, rows: 200 });
		await exploreStep(s.plugin as never, { map: "tall", from: "2_0", to: "2_-2" });
		expect(gridBoxOf(s.mapData)).toEqual({ x: 0, y: -2, cols: 5, rows: 200 });
		await exploreStep(s.plugin as never, { map: "tall", from: "2_-2", to: "2_-1" });
		expect(s.notices.filter((n) => n.includes(AT_MAX_SIZE))).toHaveLength(1);
		// Sideways it still grows.
		await exploreStep(s.plugin as never, { map: "tall", from: "1_5", to: "0_5" });
		expect(gridBoxOf(s.mapData)).toMatchObject({ x: -3, cols: 8, rows: 200 });
	});

	it("capGrowth takes from the side growing more, and says when it cut", () => {
		expect(capGrowth({ x: 0, y: 0, cols: 198, rows: 10 }, { top: 0, bottom: 0, left: 3, right: 1 }, 200)).toEqual({ room: { top: 0, bottom: 0, left: 1, right: 1 }, cut: true });
		expect(capGrowth({ x: 0, y: 0, cols: 200, rows: 10 }, { top: 2, bottom: 0, left: 3, right: 0 }, 200)).toEqual({ room: { top: 2, bottom: 0, left: 0, right: 0 }, cut: true });
		expect(capGrowth({ x: 0, y: 0, cols: 10, rows: 10 }, { top: 2, bottom: 0, left: 3, right: 0 }, 200)).toEqual({ room: { top: 2, bottom: 0, left: 3, right: 0 }, cut: false });
	});
});

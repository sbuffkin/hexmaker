import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { fakeRoot } from "./helpers/fakeDom";
import { cellPatch, type UndoDirection } from "../src/undoBook";
import type { HexData } from "../src/maps/mapNote";
import type { UndoItem } from "../src/hex-map/undoItems";
import { applyGroup, applyMapField, prepareGroup } from "../src/hex-map/view/undoGroup";
import { applyGridUndo, prepareGrid } from "../src/hex-map/gridChange";
import { gridBoxOf } from "../src/maps/gridGrowth";
import { ExploreService } from "../src/hexflower/ExploreService";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { exploreStep } from "../src/hexflower/exploreHooks";
import { EXPLORE_PROPS, GROW_LABEL } from "../src/hexflower/exploreProps";
import { EXPLORE_FIELDS } from "../src/hexflower/exploreFields";
import { emptyFlower } from "../src/hexflower/flower";
import { buildFlowerNote } from "../src/hexflower/flowerNote";

/** Owner HF4 (plan-hf4-map-grows): an explored map grows as the party nears its edge. */

const TERRAINS = ["grassland", "forest", "hills"];

class FakeStore {
	hexes = new Map<string, Map<string, HexData>>();
	private rec: ((m: string, k: string, b: HexData | undefined) => void) | null = null;
	get(m: string, k: string) { return this.hexes.get(m)?.get(k); }
	all(m: string) { return this.hexes.get(m) ?? new Map<string, HexData>(); }
	set(m: string, k: string, patch: Record<string, unknown>) {
		this.rec?.(m, k, this.get(m, k));
		const t = this.hexes.get(m) ?? new Map<string, HexData>();
		this.hexes.set(m, t);
		const h: Record<string, unknown> = { ...(t.get(k) ?? {}) };
		for (const [f, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete h[f]; else h[f] = v; }
		if (Object.keys(h).length) t.set(k, h as HexData); else t.delete(k);
		return true;
	}
	async record<T>(fn: () => T) {
		const before = new Map<string, { map: string; key: string; before?: HexData }>();
		this.rec = (map, key, b) => { if (!before.has(key)) before.set(key, { map, key, before: b ? { ...b } : undefined }); };
		const result = await fn();
		this.rec = null;
		return { result, cells: [...before.values()].map((c) => ({ ...c, after: this.get(c.map, c.key) ? { ...this.get(c.map, c.key)! } : undefined })) };
	}
}

function setup(map: Record<string, unknown> = {}, name = "m") {
	const flower = emptyFlower("Wilds", "P");
	flower.cells = flower.cells.map((_, i) => ({ result: TERRAINS[i % 3] }));
	const vault = new MemVault({ "world/hex flowers/Wilds.md": buildFlowerNote(flower) });
	const store = new FakeStore();
	const mapData = {
		name, paletteName: "P", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
		seed: 11, exploreWith: ["[[Wilds]] -> terrain"], ...map,
	} as Record<string, unknown> & { gridSize: { cols: number; rows: number }; gridOffset: { x: number; y: number } };
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
		mapStore: store,
		tableNotes: { lookup: () => ({ table: () => undefined }) },
		getMap: (n: string) => (n === name ? mapData : undefined),
		getPaletteOrPresetTerrains: () => TERRAINS.map((t) => ({ name: t, color: "#000" })),
		hexPath: (x: number, y: number) => `world/hexes/${name}/${x}_${y}.md`,
		saveSettings: async () => {},
		pushUndo: () => {},
		refreshHexMap: () => {},
	};
	const flowers = new FlowerStore(plugin as never, () => {});
	setFlowerStore(plugin as never, flowers);
	const notices: string[] = [];
	const ex = new ExploreService(plugin as never, (text) => notices.push(text));
	setExplore(plugin as never, ex);
	return { plugin, store, mapData, flowers, ex, notices };
}

/** Undo / redo a step's group the way the map view does: prepare every part, then apply. */
async function undoRedo(plugin: ReturnType<typeof setup>["plugin"], items: UndoItem[], dir: UndoDirection) {
	const store = plugin.mapStore;
	const prepare = async (it: UndoItem, d: UndoDirection): Promise<UndoItem | null> => {
		if (it.kind === "group") return prepareGroup(it, d, prepare);
		if (it.kind === "grid") return prepareGrid(plugin as never, it, d);
		return it;
	};
	const apply = async (it: UndoItem, d: UndoDirection): Promise<void> => {
		if (it.kind === "cells") for (const e of it.edits) store.set(e.map, e.key, cellPatch(e, d));
		else if (it.kind === "map-field") applyMapField(plugin as never, it, d);
		else if (it.kind === "grid") applyGridUndo(plugin as never, it, d);
		else if (it.kind === "group") await applyGroup(it, d, apply);
	};
	const ready = await prepare({ kind: "group", items }, dir);
	if (ready) await apply(ready, dir);
}

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

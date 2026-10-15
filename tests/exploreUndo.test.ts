import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { cellPatch, type UndoDirection } from "../src/undoBook";
import type { HexData } from "../src/maps/mapNote";
import type { UndoItem } from "../src/hex-map/undoItems";
import { applyGroup, applyMapField, prepareGroup, prepareMapField } from "../src/hex-map/view/undoGroup";
import { ExploreService } from "../src/hexflower/ExploreService";
import { exploreOrder } from "../src/hexflower/exploreOrder";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { exploreFrontier, exploreHexMenu, exploreStep } from "../src/hexflower/exploreHooks";
import { emptyFlower } from "../src/hexflower/flower";
import { buildFlowerNote } from "../src/hexflower/flowerNote";
import { readSurface } from "./helpers/source";

/** plan-hex-flower phase 4: a party step fills a blank hex, undone as one with the move. */

const TERRAINS = ["grassland", "forest", "hills"];

/** A map store in memory with the parts exploring uses. */
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

function setup(map: Record<string, unknown> = {}) {
	const flower = emptyFlower("Wilds", "P");
	flower.cells = flower.cells.map((_, i) => ({ result: TERRAINS[i % 3] }));
	const vault = new MemVault({ "world/hex flowers/Wilds.md": buildFlowerNote(flower) });
	const store = new FakeStore();
	const mapData = {
		name: "m", paletteName: "P", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [],
		seed: 11, exploreWith: ["[[Wilds]] -> terrain"], ...map,
	} as Record<string, unknown>;
	let saves = 0;
	const pushed: UndoItem[] = [];
	const plugin = {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
		mapStore: store,
		tableNotes: { lookup: () => ({ table: () => undefined }) },
		getMap: (n: string) => (n === "m" ? mapData : undefined),
		getPaletteOrPresetTerrains: () => TERRAINS.map((name) => ({ name, color: "#000" })),
		hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
		saveSettings: async () => { saves++; },
		pushUndo: (_m: string, it: UndoItem) => pushed.push(it),
		refreshHexMap: () => {},
	};
	const flowers = new FlowerStore(plugin as never, () => {});
	setFlowerStore(plugin as never, flowers);
	const notices: string[] = [];
	const ex = new ExploreService(plugin as never, (text) => notices.push(text));
	setExplore(plugin as never, ex);
	return { plugin, store, mapData, flowers, ex, pushed, notices, saves: () => saves };
}

/** Apply undo items the way the map view does (cells and map fields). */
async function applyAll(plugin: ReturnType<typeof setup>["plugin"], items: UndoItem[], dir: UndoDirection) {
	const apply = async (it: UndoItem, d: UndoDirection): Promise<void> => {
		if (it.kind === "cells") for (const e of it.edits) plugin.mapStore.set(e.map, e.key, cellPatch(e, d));
		else if (it.kind === "map-field") applyMapField(plugin as never, it, d);
		else if (it.kind === "group") await applyGroup(it, d, apply);
	};
	await applyGroup({ kind: "group", items }, dir, apply);
}

describe("exploring: a party step", () => {
	it("fills a blank hex's terrain from the flower, stores the walk, and undoes in one go", async () => {
		const s = setup();
		await s.flowers.init();
		s.store.set("m", "1_1", { terrain: "forest" });
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1", token: "party.md" });
		const t = s.store.get("m", "2_1")?.terrain;
		expect(TERRAINS).toContain(t);
		expect(s.mapData.hexFlowerAt).toEqual([expect.stringMatching(/^Wilds: \d+$/)]);
		expect(undo.map((u) => u.kind)).toEqual(["cells", "map-field"]);
		expect(s.notices).toEqual([expect.stringMatching(/^2, 1: (grassland|forest|hills) \(\d+ → [a-z-]+ from forest\)$/)]);
		await applyAll(s.plugin, undo, "undo");
		expect(s.store.get("m", "2_1")).toBeUndefined();
		expect(s.mapData.hexFlowerAt).toBeUndefined();
		await applyAll(s.plugin, undo, "redo");
		expect(s.store.get("m", "2_1")?.terrain).toBe(t);
	});

	it("a hand-painted hex is untouched; a map with no rules does nothing", async () => {
		const s = setup();
		await s.flowers.init();
		s.store.set("m", "2_1", { terrain: "hills" });
		expect(await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" })).toEqual([]);
		expect(s.store.get("m", "2_1")).toEqual({ terrain: "hills" });
		const none = setup({ exploreWith: [] });
		await none.flowers.init();
		expect(await exploreStep(none.plugin as never, { map: "m", from: "1_1", to: "2_1" })).toEqual([]);
		expect(none.store.get("m", "2_1")).toBeUndefined();
	});

	it("the same walk fills the same way (seeded)", async () => {
		const a = setup();
		const b = setup();
		await a.flowers.init();
		await b.flowers.init();
		for (const s of [a, b]) {
			await exploreStep(s.plugin as never, { map: "m", from: "0_0", to: "1_0" });
			await exploreStep(s.plugin as never, { map: "m", from: "1_0", to: "2_0" });
		}
		expect([...a.store.all("m")]).toEqual([...b.store.all("m")]);
	});

	it("reveal neighbours fills the blank hexes around too", async () => {
		const s = setup({ exploreReveal: "neighbours" });
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "m", from: "1_2", to: "2_2" });
		expect(s.store.all("m").size).toBe(7);
	});

	it("hex menu: Roll this hex on a blank hex, Reroll on the latest fill; the frontier marks blank neighbours", async () => {
		const s = setup();
		await s.flowers.init();
		s.store.set("m", "2_2", { terrain: "forest" });
		expect(exploreHexMenu(s.plugin as never, "m", "2_3").map((i) => i.id)).toEqual(["hex.explore-roll"]);
		expect(exploreHexMenu(s.plugin as never, "m", "2_2")).toEqual([]);
		expect(exploreFrontier(s.plugin as never, "m").sort()).toEqual(["1_1", "1_2", "2_1", "2_3", "3_1", "3_2"]);
		await s.ex.rollHex("m", "2_3");
		expect(s.store.get("m", "2_3")?.terrain).toBeDefined();
		expect(s.pushed.map((u) => u.kind)).toEqual(["group"]);
		expect(exploreHexMenu(s.plugin as never, "m", "2_3").map((i) => i.id)).toEqual(["hex.explore-reroll"]);
		await s.ex.reroll("m");
		expect(s.store.get("m", "2_3")?.terrain).toBeDefined();
		expect(s.pushed).toHaveLength(2);
	});

	it("fill the whole map: every hex, outward from the start", async () => {
		const s = setup();
		await s.flowers.init();
		expect(exploreOrder("0_0", (k) => s.ex.neighbours(s.mapData as never, k)).length).toBe(25);
		await s.ex.fillAll("m", "2_2");
		expect(s.store.all("m").size).toBe(25);
	});
});

describe("undo groups and map fields", () => {
	it("a group keeps the parts still in place; a map field undoes only while it shows its after", async () => {
		const map: Record<string, unknown> = { name: "m", hexFlowerAt: ["W: 3"] };
		const plugin = { getMap: () => map, saveSettings: async () => {} };
		const field: UndoItem = { kind: "map-field", mapName: "m", field: "hexFlowerAt", before: ["W: 10"], after: ["W: 3"] };
		expect(prepareMapField(plugin as never, field as never, "undo")).toBe(field);
		expect(prepareMapField(plugin as never, field as never, "redo")).toBeNull();
		const group = await prepareGroup({ kind: "group", items: [field, field] }, "undo", async (it) => (it === field ? it : null));
		expect(group).toEqual({ kind: "group", items: [field, field] });
		expect(await prepareGroup({ kind: "group", items: [field] }, "undo", async () => null)).toBeNull();
		applyMapField(plugin as never, field as never, "undo");
		expect(map.hexFlowerAt).toEqual(["W: 10"]);
		const order: number[] = [];
		await applyGroup({ kind: "group", items: [{ kind: "group", items: [] }, field] }, "undo", async (it) => { order.push(it.kind === "group" ? 1 : 2); });
		expect(order).toEqual([2, 1]);
	});

	it("the map view groups the token's move with what the step filled", () => {
		const view = readSurface("map-view");
		expect(view).toMatch(/const filled = await runPartyEntered\(this\.plugin, step\);/);
		expect(view).toMatch(/this\.(?:host\.)?(?:undos\.)?pushUndo\(filled\.length \? \{ kind: "group", items: \[token, \.\.\.filled\] \} : token, party\.map\);/);
		// Dragging the party travels the same way.
		expect(view).toMatch(/if \(token\.party && token\.map === this\.activeMapName\) void this\.moveParty\(token, closestHex, true\);/);
		expect(view).toMatch(/case "group": return prepareGroup\(/);
	});
});

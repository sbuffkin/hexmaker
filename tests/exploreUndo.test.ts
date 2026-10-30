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
import { EXPLORE_MENU, exploreFrontier, exploreHexMenu, exploreLook, explorePartyClick, explorePartyControls, exploreStep, PICK_CONTROL_ID, revealBrush, SEES_CONTROL_ID, setSight } from "../src/hexflower/exploreHooks";
import { clearRevealed, revealedNow } from "../src/hex-map/revealBounce";
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

	it("reveal neighbours (the older value) fills the blank hexes around too", async () => {
		const s = setup({ exploreReveal: "neighbours" });
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "m", from: "1_2", to: "2_2" });
		expect(s.store.all("m").size).toBe(7);
	});

	it("reveal 2 rings on entry fills two rings around (in the grid)", async () => {
		const s = setup({ exploreReveal: "2 rings" });
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_2" });
		// 1 + 6 + 12 = 19, all inside the 5×5 grid around 2_2.
		expect(s.store.all("m").size).toBe(19);
	});

	it("Sees and Look (HF11): set the sight, then look around where the party stands: rings filled, one undo, the hexes bounce in", async () => {
		clearRevealed();
		const s = setup();
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_2" });
		expect(s.store.all("m").size).toBe(1);
		expect([...revealedNow("m")]).toEqual([["2_2", 0]]);
		const controls = () => explorePartyControls(s.plugin as never, { map: "m", hex: "2_2", token: "party.md" });
		expect(controls().map((c) => [c.id, c.label, c.buttons.map((b) => b.label)])).toEqual([
			[SEES_CONTROL_ID, "Sees", ["0", "1", "2", "3", "Look"]],
			[PICK_CONTROL_ID, "Reveal hexes", ["Pick"]],
		]);
		const button = (label: string) => controls()[0].buttons.find((b) => b.label === label)!;
		expect(button("0").selected).toBe(true);
		// Sees 1, then Look: the ring around the party.
		expect(await button("1").run!()).toEqual([]);
		expect(s.mapData.exploreReveal).toBe("1 ring");
		expect(button("1").selected).toBe(true);
		const undo = await button("Look").run!();
		expect(s.store.all("m").size).toBe(7);
		expect(undo.map((u) => u.kind)).toEqual([...Array(6).fill("cells"), "map-field"]);
		expect(s.notices.at(-1)).toMatch(/^Revealed 6 hexes \(1 ring around 2, 2\)\./);
		const bouncing = revealedNow("m");
		expect([...bouncing].filter(([, r]) => r === 1).length).toBe(6);
		// Later, Sees 2 (the party climbed a tree): the second ring only.
		await button("2").run!();
		const undo2 = await button("Look").run!();
		expect(s.store.all("m").size).toBe(19);
		// Undo takes back exactly that look.
		await applyAll(s.plugin, undo2, "undo");
		expect(s.store.all("m").size).toBe(7);
		// Nothing left to see: told so, no undo.
		await button("1").run!();
		expect(await button("Look").run!()).toEqual([]);
		expect(s.notices.at(-1)).toMatch(/^Nothing new to reveal 1 ring around 2, 2\.$/);
		// Not an explored map: no controls.
		const plain = setup({ exploreWith: [] });
		expect(explorePartyControls(plain.plugin as never, { map: "m", hex: "2_2", token: "p.md" })).toEqual([]);
	});

	it("the party's own hex clicked is a look (a step in place); every later step reveals the sight", async () => {
		const s = setup();
		await s.flowers.init();
		await exploreStep(s.plugin as never, { map: "m", from: "2_1", to: "2_2" });
		const click = { map: "m", token: "party.md", from: "2_2", to: "2_2", orientation: "flat" as const, stagger: "odd" as const };
		expect(explorePartyClick(s.plugin as never, click)).toBe("look");
		expect(explorePartyClick(s.plugin as never, { ...click, to: "2_3" })).toBe("none");
		setSight(s.plugin as never, "m", 2);
		const undo = await exploreLook(s.plugin as never, { map: "m", hex: "2_2", token: "party.md" });
		expect(s.store.all("m").size).toBe(19);
		expect(undo.some((u) => u.kind === "cells")).toBe(true);
		// Sees 0: a step fills only the hex entered.
		setSight(s.plugin as never, "m", 0);
		expect(s.mapData.exploreReveal).toBeUndefined();
		const plain = setup({ exploreWith: [] });
		expect(explorePartyClick(plain.plugin as never, click)).toBe("none");
	});

	it("Roll this hex fills exactly that hex, even with Sees 2 (owner HF11); a brush stroke fills each hex crossed, one notice", async () => {
		const s = setup({ exploreReveal: "2 rings" });
		await s.flowers.init();
		s.store.set("m", "0_0", { terrain: "forest" });
		const menu = exploreHexMenu(s.plugin as never, "m", "4_4");
		menu.find((m) => m.id === EXPLORE_MENU.roll.menuId)!.run();
		await new Promise((r) => setTimeout(r, 20));
		expect(s.store.all("m").size).toBe(2);
		expect(s.store.get("m", "4_4")?.terrain).toBeTruthy();
		expect(s.pushed.length).toBe(1);
		// The brush: three hexes in one stroke, one undo's worth of entries, one notice.
		const before = s.notices.length;
		const undo = await revealBrush(s.plugin as never, "m").stroke(["1_1", "1_2", "4_4", "1_3"], false);
		expect(s.store.all("m").size).toBe(5);
		expect(undo.filter((u) => u.kind === "cells").length).toBe(3);
		expect(s.notices.length).toBe(before + 1);
		expect(s.notices.at(-1)).toBe("Filled 3 hexes.");
		// Right-click on a map filled as it goes: nothing (a fill isn't taken back by a brush).
		expect(await revealBrush(s.plugin as never, "m").stroke(["1_1"], true)).toEqual([]);
		expect(s.store.get("m", "1_1")).toBeTruthy();
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
		// One undo: the move, what the step marked at once (Solo play's visited hexes, P2) and what it filled.
		expect(view).toMatch(/const marked = runPartyStep\(this\.plugin, step\);/);
		expect(view).toMatch(/const items = \[token, \.\.\.marked, \.\.\.filled\];/);
		expect(view).toMatch(/this\.(?:host\.)?(?:undos\.)?pushUndo\(items\.length > 1 \? \{ kind: "group", items \} : token, party\.map\);/);
		// Dragging the party travels the same way.
		expect(view).toMatch(/if \(isParty\(token\) && token\.map === this\.activeMapName\) void this\.moveParty\(token, closestHex, true\);/);
		expect(view).toMatch(/case "group": return prepareGroup\(/);
	});
});

/**
 * New regions in Build (owner 2026-10-12): "you do NOT have to switch to
 * god mode just to extend your world … rerolls NEED to work on build mode
 * until the user 'locks' the region by painting their own stuff on it etc.
 * Just navigating in shouldn't lock it." And "no reroll on right click for
 * session-new blocks": the overworld menu offers Reroll and Lock on a new
 * (open) region.
 *
 * - Extending the world (a first biome, a new region, walking into new
 *   land and growing the grid, arrival) is Build.
 * - An open region locks on the first hand edit (painting, a path drawn by
 *   hand), with one notice; navigating, viewing, rerolling and generated
 *   writes never lock it. Lock stays as a button.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import expect from "expect";
import { Notice } from "obsidian";
import { ArrivalService } from "../src/arrival/ArrivalService";
import { EventsService } from "../src/arrival/EventsService";
import { effectiveArrivalMode } from "../src/arrival/arrival";
import { guardWrite, HAND_EDIT_ACTIONS, noteHandEdit, setHandEditListener, setModeMapLookup } from "../src/modeGate";
import { allows, handEditLocks, MENU_ACTIONS, TOOL_ACTIONS, WORK_MODES, type ModeAction } from "../src/workMode";
import { createRegion, paintBiomeHex, regenerateRegion, reshapeLock, setBiomeAt, walkIntoHex, walkLock } from "../src/overworld/regionsVault";
import { editRegionPlan, overworldMenu } from "../src/overworld/overworldInput";
import { representativeTerrain } from "../src/overworld/biomes";
import { layerOf } from "../src/ui/placement";
import { MapStore } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import { DEFAULT_TERRAIN_PALETTE, DEFAULT_PATH_TYPES } from "../src/constants";
import type { MapData, PathType, TerrainColor } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

type Hex = { terrain?: string; locked?: boolean; biome?: string };
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** An overworld (3 × 3, 4×4 regions) whose store gates hand edits like MapStore.set (an action → guardWrite). */
function world(mode = "build", arrivalMode?: string) {
	const overworld = {
		name: "ow", paletteName: "Default", workMode: mode, seed: 99,
		gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd",
		regions: { footprint: "rect", size: 4, blend: "normal", worldId: "w1", stagger: "odd" },
		pathChains: [],
		...(arrivalMode ? { arrivalMode } : {}),
	} as unknown as MapData;
	const maps: MapData[] = [overworld];
	const store = new Map<string, Map<string, Hex>>();
	const hexes = (m: string): Map<string, Hex> => {
		let h = store.get(m);
		if (!h) store.set(m, (h = new Map()));
		return h;
	};
	hexes("ow").set("1_1", { terrain: representativeTerrain("taiga", DEFAULT_TERRAIN_PALETTE)! });
	hexes("ow").set("2_1", { terrain: representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE)! });
	const notes = new Map<string, string>();
	let saves = 0;
	const plugin = {
		settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
		getMap: (n: string) => maps.find((m) => m.name === n),
		rolledMapName: () => undefined,
		parentOf: (n: string) => maps.find((m) => m.name === n)?.parent,
		getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
		getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
		mapLabel: (n: string) => n,
		arrivalModeFor: (n: string) => effectiveArrivalMode(n, (m) => maps.find((x) => x.name === m)?.arrivalMode, (m) => maps.find((x) => x.name === m)?.parent?.map),
		refreshHexMap: () => {},
		refreshPlaceBars: () => {},
		mapStore: {
			get: (m: string, k: string) => store.get(m)?.get(k),
			all: (m: string) => hexes(m),
			set: (m: string, k: string, patch: Hex, action?: ModeAction) => {
				if (action && !guardWrite(m, action)) return false;
				hexes(m).set(k, { ...hexes(m).get(k), ...patch });
				return true;
			},
			setMany: (m: string, cells: Iterable<[string, Hex]>) => {
				for (const [k, h] of cells) hexes(m).set(k, { ...hexes(m).get(k), ...h });
			},
			record: async <T,>(fn: () => Promise<T>) => ({ result: await fn(), cells: [] }),
			flush: async () => {},
			editNoteText: async (m: string, edit: (c: string) => string) => {
				const cur = notes.get(m) ?? `# ${m}\n\n## Arrival\n\n- Not locked yet\n`;
				notes.set(m, edit(cur));
				return true;
			},
		},
		saveSettings: async () => { saves++; },
		createNewMap: async (name: string, cols: number, rows: number, _p: string, x: number, y: number, stagger: string, _pr: unknown, cells?: Map<string, string>, extra?: { parent?: { map: string; hex: string } }) => {
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			maps.push({ name: slug, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x, y }, staggerOffset: stagger, parent: extra?.parent, submapKind: "region", pathChains: [] } as unknown as MapData);
			// Generated cells are written in bulk, never as a hand edit.
			plugin.mapStore.setMany(slug, [...(cells ?? [])].map(([k, t]) => [k, { terrain: t }]));
			return { name: slug };
		},
		ensureOverworldBiomes: async () => {},
		linkRegion: async (_p: string, x: number, y: number, child: string) => {
			const m = maps.find((n) => n.name === child)!;
			m.parent = { map: "ow", hex: `${x}_${y}` };
			m.submapKind = "region";
			return true;
		},
	};
	(plugin as Record<string, unknown>).events = new EventsService(plugin as never);
	const service = new ArrivalService(plugin as never);
	(plugin as Record<string, unknown>).arrival = service;
	setModeMapLookup((n) => plugin.getMap(n));
	setHandEditListener((n) => service.lockOnHandEdit(n));
	const regionOf = (hex: string) => maps.find((m) => m.submapKind === "region" && m.parent?.hex === hex);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { plugin: plugin as any, service, overworld, maps, hexes, notes, regionOf, saves: () => saves };
}

const lockNotices = () => Notice.shown.filter((n) => /locked: your edits are kept/.test(n.msg));

describe("extending the world never needs God (Build is enough)", () => {
	beforeEach(() => { Notice.shown = []; });
	afterEach(() => { setHandEditListener(null); setModeMapLookup(null); });

	it("the policy: every extend action is allowed in Build", () => {
		const extend: ModeAction[] = ["new-child-map", "place-biome", "grow-map", "discover", "lock-place"];
		for (const a of extend) expect({ a, build: allows("build", a) }).toEqual({ a, build: true });
		expect(allows("build", TOOL_ACTIONS.biome)).toBe(true);
		for (const id of ["ow.set-biome", "ow.arrive", "ow.reroll", "ow.lock", "hex.new-map", "editor.new-map"] as const) {
			expect({ id, build: allows("build", MENU_ACTIONS[id]) }).toEqual({ id, build: true });
		}
	});

	it("a biome on an empty brick, the Biome painter on an empty hex, and walking past the edge all work in Build", async () => {
		const w = world("build");
		expect(reshapeLock(w.plugin, "ow", 0, 0)).toBeUndefined();
		const set = await setBiomeAt(w.plugin, "ow", 0, 0, "grassland");
		expect("name" in set).toBe(true);
		const painted = await paintBiomeHex(w.plugin, "ow", 2, 2, "taiga");
		expect(painted).toMatchObject({ step: "place" });
		expect(w.regionOf("2_2")).toBeTruthy();
		// Walking into new land: hex 3, 1 is past the 3-wide grid, so the overworld grows to take it in.
		const from = (await createRegion(w.plugin, "ow", 2, 1, { fill: "match" })) as { name: string };
		expect(walkLock(w.plugin, from.name, "ow")).toBeUndefined();
		const walked = await walkIntoHex(w.plugin, "ow", 3, 1, "grassland", { from: from.name });
		expect(walked).toMatchObject({ grew: true });
		expect(w.overworld.gridSize.cols).toBe(4);
		expect(w.regionOf("3_1")?.arrival).toBe("open");
	});

	it("arrival makes a place in Build too", async () => {
		const w = world("build", "make places");
		const made = await w.service.arrive("ow", 2, 1);
		expect(made).toBeTruthy();
		expect(w.regionOf("2_1")?.arrival).toBe("open");
	});

	it("Reroll, Settings… and a biome change work on an open region in Build, and none of them lock it", async () => {
		const w = world("build");
		const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
		expect(editRegionPlan(w.overworld, w.regionOf("1_1"))).toMatchObject({ biome: "pick", reroll: true, settings: true, lock: true });
		await regenerateRegion(w.plugin, r.name, { seed: 1234 });
		await regenerateRegion(w.plugin, r.name, { seed: 77, blend: "wide" });
		await setBiomeAt(w.plugin, "ow", 1, 1, "grassland");
		await tick();
		expect(w.regionOf("1_1")?.arrival).toBe("open");
		expect(lockNotices()).toEqual([]);
	});
});

describe("an open region locks on the first hand edit", () => {
	beforeEach(() => { Notice.shown = []; });
	afterEach(() => { setHandEditListener(null); setModeMapLookup(null); });

	it("painting a hex locks it, writes it locked once and says so once", async () => {
		const w = world("build");
		const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
		const region = w.regionOf("1_1")!;
		expect(region.arrival).toBe("open");
		const key = [...w.hexes(r.name).keys()][0];
		expect(w.plugin.mapStore.set(r.name, key, { terrain: "grass" }, "paint-terrain")).toBe(true);
		// Locked at once: the rest of the stroke sees it locked.
		expect(region.arrival).toBe("locked");
		w.plugin.mapStore.set(r.name, key, { terrain: "forest" }, "paint-terrain");
		w.plugin.mapStore.set(r.name, key, { icon: "x.png" }, "paint-icon");
		await tick();
		expect(lockNotices().map((n) => n.msg)).toEqual(["Region locked: your edits are kept. Rerolling it now needs God mode."]);
		expect(w.notes.get(r.name)).toContain("- Locked");
		// Locked: changing it now needs God (the Reroll / Lock menu items are gone).
		expect(editRegionPlan(w.overworld, region)).toMatchObject({ reroll: false, lock: false });
		expect(overworldMenu(w.overworld, true, 0, region).map((i) => i.id)).not.toContain("reroll");
	});

	it("every hand-edit action locks; notes, tokens, links and viewing don't", async () => {
		for (const a of HAND_EDIT_ACTIONS) {
			const w = world("build");
			const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
			noteHandEdit(r.name, a);
			expect({ a, state: w.regionOf("1_1")!.arrival }).toEqual({ a, state: "locked" });
		}
		await tick();
		Notice.shown = [];
		const w = world("build");
		const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
		for (const a of ["edit-note", "token", "link-note", "link-map", "view", "navigate", "open-editor", "roll"] as ModeAction[]) {
			expect(guardWrite(r.name, a)).toBe(true);
		}
		// Navigating in and viewing read the map; nothing is written.
		w.plugin.getMap(r.name);
		[...w.plugin.mapStore.all(r.name)];
		await tick();
		expect(w.regionOf("1_1")!.arrival).toBe("open");
		expect(lockNotices()).toEqual([]);
	});

	it("generated writes never lock: a neighbour made next to it, and its own reroll", async () => {
		const w = world("build");
		const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
		await createRegion(w.plugin, "ow", 2, 1, { fill: "match" });
		await regenerateRegion(w.plugin, r.name, { seed: 5 });
		await tick();
		expect(w.regionOf("1_1")!.arrival).toBe("open");
		expect(w.regionOf("2_1")!.arrival).toBe("open");
		expect(lockNotices()).toEqual([]);
	});

	it("only open places with a parent lock: an overworld, a locked region and an old region (no arrival key) don't change", () => {
		expect(handEditLocks({ arrival: "open", parent: { map: "ow", hex: "1_1" } })).toBe(true);
		expect(handEditLocks({ arrival: "open" })).toBe(false);
		expect(handEditLocks({ arrival: "locked", parent: {} })).toBe(false);
		expect(handEditLocks({ parent: {} })).toBe(false);
		expect(handEditLocks(undefined)).toBe(false);
	});

	it("a refused write (Play) doesn't lock", async () => {
		const w = world("build");
		const r = (await createRegion(w.plugin, "ow", 1, 1, { fill: "match", biome: "taiga" })) as { name: string };
		w.regionOf("1_1")!.workMode = "play";
		expect(w.plugin.mapStore.set(r.name, "4_4", { terrain: "grass" }, "paint-terrain")).toBe(false);
		await tick();
		expect(w.regionOf("1_1")!.arrival).toBe("open");
	});

	it("the real map store: a hand edit (set with an action) is heard, bulk generated writes (setMany) are not", async () => {
		const v = new MemVault();
		const maps = [{ name: "m", paletteName: "Default", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd", pathChains: [] } as unknown as MapData];
		const state = { palette: DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t })) as TerrainColor[], types: DEFAULT_PATH_TYPES.map((t) => ({ ...t })) as PathType[] };
		const p = {
			app: v.app(),
			manifest: { dir: ".obsidian/plugins/hexmaker" },
			settings: { hexFolder: "world/hexes", maps, hexOrientation: "flat" as const, staggerOffset: "odd" as const },
			getMap: (n: string) => maps.find((m) => m.name === n),
			getMapPalette: () => state.palette,
			getMapPathTypes: () => state.types,
			saveData: async () => {},
			refreshHexMap: () => {},
		};
		const store = new MapStore(p as never);
		await store.init();
		const heard: string[] = [];
		setHandEditListener((n, a) => heard.push(`${n}:${a}`));
		store.setMany("m", [["0_0", { terrain: "grass" }]]);
		store.set("m", "1_1", { name: "Hill" }, "edit-note");
		store.set("m", "1_0", { terrain: "grass" });
		expect(heard).toEqual([]);
		store.set("m", "2_2", { terrain: "forest" }, "paint-terrain");
		expect(heard).toEqual(["m:paint-terrain"]);
		await store.flush();
	});
});

describe("the overworld right-click menu on a new region: Reroll and Lock", () => {
	it("shows Reroll and Lock only on an open region, placed main", () => {
		const ids = (region?: { arrival?: string }) => overworldMenu({ workMode: "build" }, true, 0, region).map((i) => i.id);
		expect(ids({ arrival: "open" })).toEqual(["enter-region", "edit-region", "reroll", "lock", "center"]);
		expect(ids({ arrival: "locked" })).toEqual(["enter-region", "edit-region", "center"]);
		expect(ids({})).toEqual(["enter-region", "edit-region", "center"]);
		expect(overworldMenu({ workMode: "build" }, false, 0, { arrival: "open" }).map((i) => i.id)).toEqual(["set-biome", "center"]);
		expect(layerOf("OverworldMenu.reroll")).toBe("main");
		expect(layerOf("OverworldMenu.lock")).toBe("main");
	});

	it("by mode (the map view's mode menu): Reroll in Build and God, Lock in every mode", () => {
		for (const m of WORK_MODES) {
			expect({ m, reroll: allows(m, MENU_ACTIONS["ow.reroll"]) }).toEqual({ m, reroll: m !== "play" });
			expect({ m, lock: allows(m, MENU_ACTIONS["ow.lock"]) }).toEqual({ m, lock: true });
		}
	});
});

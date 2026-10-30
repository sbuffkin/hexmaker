import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { cellEdits, cellPatch, currentCellEdits, sameValue, stillCurrent, UndoBook, type UndoDirection } from "../src/undoBook";
import { canDo, guardWrite, setModeMapLookup } from "../src/modeGate";
import { MapStore } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import type { MapData } from "../src/types";

(globalThis as Record<string, unknown>).window ??= globalThis;

/**
 * Parallel undo (owner WM6): one queue per map per work mode, kept while
 * the vault is open; undo in a mode undoes only that mode's actions; an
 * entry whose target changed later (in another mode) is skipped.
 */

/** A toy "world": token positions, and an entry that moved one. */
type Move = { token: string; from: string; to: string };

function world() {
	const where = new Map<string, string>([["party", "0_0"]]);
	const book = new UndoBook<Move>();
	/** Do a move in a mode, recording it. */
	const move = (mode: "play" | "build" | "god", token: string, to: string) => {
		const from = where.get(token)!;
		where.set(token, to);
		book.push("m", mode, { token, from, to });
	};
	/** The entry is still current when the token is where it left it (undo) / where it found it (redo). */
	const prepare = (e: Move, dir: UndoDirection) =>
		sameValue(where.get(e.token), dir === "undo" ? e.to : e.from) ? e : null;
	const step = async (mode: "play" | "build" | "god", dir: UndoDirection) => {
		const e = await book.step("m", mode, dir, prepare);
		if (e) where.set(e.token, dir === "undo" ? e.from : e.to);
		return e;
	};
	return { where, book, move, step };
}

describe("undo book: one queue per map per mode (WM6)", () => {
	it("undo in a mode only undoes that mode's actions; switching back resumes its queue", async () => {
		const w = world();
		w.move("build", "party", "1_0");
		w.move("play", "party", "2_0"); // the party moves on in Play
		w.where.set("scout", "5_5");
		w.move("play", "scout", "6_5");
		// Play's undo: the scout first, then the party's Play move.
		await w.step("play", "undo");
		expect(w.where.get("scout")).toBe("5_5");
		await w.step("play", "undo");
		expect(w.where.get("party")).toBe("1_0");
		// Back in Build: its queue is where it was; the Build move undoes now
		// (the party is back where Build left it).
		expect(w.book.canUndo("m", "build")).toBe(true);
		await w.step("build", "undo");
		expect(w.where.get("party")).toBe("0_0");
	});

	it("an entry whose target moved later in another mode is skipped (popped), not reverted", async () => {
		const w = world();
		w.move("build", "party", "1_0"); // Build
		w.move("play", "party", "3_3"); // then Play moves it again
		const e = await w.step("build", "undo");
		expect(e).toBeNull(); // nothing to undo: the Build move was superseded
		expect(w.where.get("party")).toBe("3_3"); // the newer Play move stands
		expect(w.book.size("m", "build")).toEqual({ undo: 0, redo: 0 }); // popped, not kept
		// Play still undoes its own move.
		await w.step("play", "undo");
		expect(w.where.get("party")).toBe("1_0");
	});

	it("a skipped entry doesn't block older ones in the same queue", async () => {
		const w = world();
		w.where.set("scout", "9_9");
		w.move("build", "scout", "8_8"); // older Build action
		w.move("build", "party", "1_0"); // newer Build action
		w.move("god", "party", "4_4"); // superseded in God
		await w.step("build", "undo"); // skips the party entry, undoes the scout
		expect(w.where.get("scout")).toBe("9_9");
		expect(w.where.get("party")).toBe("4_4");
	});

	it("redo replays only while the target is still where undo left it", async () => {
		const w = world();
		w.move("build", "party", "1_0");
		await w.step("build", "undo");
		expect(w.book.canRedo("m", "build")).toBe(true);
		await w.step("build", "redo");
		expect(w.where.get("party")).toBe("1_0");
		await w.step("build", "undo");
		w.move("play", "party", "7_7"); // moved meanwhile
		expect(await w.step("build", "redo")).toBeNull();
		expect(w.where.get("party")).toBe("7_7");
	});

	it("a new action clears only its own mode's redo; queues are per map", () => {
		const book = new UndoBook<number>();
		book.push("a", "build", 1);
		book.push("a", "play", 2);
		book.push("b", "build", 3);
		expect(book.size("a", "build").undo).toBe(1);
		expect(book.size("a", "play").undo).toBe(1);
		expect(book.size("b", "build").undo).toBe(1);
		expect(book.canUndo("a", "god")).toBe(false);
	});

	it("keeps at most `depth` entries per queue", () => {
		const book = new UndoBook<number>(3);
		for (let i = 0; i < 5; i++) book.push("m", "build", i);
		expect(book.size("m", "build").undo).toBe(3);
	});

	it("follows a renamed map and forgets a deleted one; tells listeners", () => {
		const book = new UndoBook<number>();
		let heard = 0;
		const stop = book.onChange(() => heard++);
		book.push("old", "build", 1);
		book.renameMap("old", "new");
		expect(book.canUndo("new", "build")).toBe(true);
		expect(book.canUndo("old", "build")).toBe(false);
		book.forgetMap("new");
		expect(book.canUndo("new", "build")).toBe(false);
		stop();
		book.push("x", "build", 1);
		expect(heard).toBe(3);
	});
});

describe("undo checks: still-current parts of an entry", () => {
	it("stillCurrent keeps the hexes that still show the stroke's paint", () => {
		const terrain = new Map([["0_0", "forest"], ["1_0", "swamp"]]); // 1_0 repainted since
		const stroke = [
			{ key: "0_0", oldT: null, newT: "forest" },
			{ key: "1_0", oldT: "hills", newT: "forest" },
		];
		const kept = stillCurrent(stroke, "undo", (e) => terrain.get(e.key) ?? null, (e) => e.oldT, (e) => e.newT);
		expect(kept!.map((e) => e.key)).toEqual(["0_0"]);
		expect(stillCurrent([stroke[1]], "undo", (e) => terrain.get(e.key) ?? null, (e) => e.oldT, (e) => e.newT)).toBeNull();
	});

	it("cell edits are per field: undo restores what changed and leaves the rest", () => {
		const edits = cellEdits([
			{ map: "m", key: "2_2", before: { terrain: "hills", name: "Old Keep" }, after: { terrain: "forest", name: "Old Keep" } },
			{ map: "m", key: "3_3", before: undefined, after: undefined },
		]);
		expect(edits).toEqual([{ map: "m", key: "2_2", fields: { terrain: ["hills", "forest"] } }]);
		expect(cellPatch(edits[0], "undo")).toEqual({ terrain: "hills" });
		expect(cellPatch(edits[0], "redo")).toEqual({ terrain: "forest" });
		// A field cleared by the action comes back; one added goes (null clears).
		const added = cellEdits([{ map: "m", key: "1_1", before: {}, after: { icon: "tower.png" } }]);
		expect(cellPatch(added[0], "undo")).toEqual({ icon: null });
	});

	it("currentCellEdits drops fields changed since (in another mode)", () => {
		const edits = cellEdits([{ map: "m", key: "2_2", before: { terrain: "hills", icon: "a.png" }, after: { terrain: "forest", icon: "b.png" } }]);
		const now = { terrain: "swamp", icon: "b.png" }; // terrain repainted since
		const kept = currentCellEdits(edits, "undo", () => now)!;
		expect(kept[0].fields).toEqual({ icon: ["a.png", "b.png"] });
		expect(currentCellEdits(edits, "undo", () => ({ terrain: "swamp" }))).toBeNull();
	});

	it("sameValue compares lists in order and ignores undefined fields", () => {
		expect(sameValue(["a", "a"], ["a", "a"])).toBe(true);
		expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
		expect(sameValue({ hex: "1_1", map: "m", x: undefined }, { map: "m", hex: "1_1" })).toBe(true);
		expect(sameValue(null, undefined)).toBe(true);
		expect(sameValue(null, { hex: "1_1" })).toBe(false);
	});
});

describe("work mode write gate", () => {
	afterEach(() => setModeMapLookup(null));

	it("allows everything with no lookup or an unknown map", () => {
		expect(canDo("x", "delete-map")).toBe(true);
		setModeMapLookup(() => undefined);
		expect(canDo("x", "delete-map")).toBe(true);
	});

	it("follows each map's own mode", () => {
		const maps: Record<string, { workMode?: string }> = { p: { workMode: "play" }, b: {}, g: { workMode: "god" } };
		setModeMapLookup((n) => maps[n]);
		expect(canDo("p", "paint-terrain")).toBe(false);
		expect(canDo("p", "token")).toBe(true);
		expect(canDo("p", "edit-note")).toBe(true);
		expect(canDo("b", "paint-terrain")).toBe(true);
		expect(canDo("b", "delete-map")).toBe(false);
		expect(canDo("g", "delete-map")).toBe(true);
		const warn = console.warn;
		const said: unknown[] = [];
		console.warn = (...a: unknown[]) => said.push(a.join(" "));
		try {
			expect(guardWrite("p", "edit-path")).toBe(false);
		} finally {
			console.warn = warn;
		}
		expect(String(said[0])).toMatch(/Switch to Build to change paths/);
	});
});

describe("map store: mode-gated writes and recording for undo", () => {
	afterEach(() => setModeMapLookup(null));

	async function boot(mode: string) {
		const maps: MapData[] = [{ name: "m", gridSize: { cols: 4, rows: 4 }, gridOffset: { x: 0, y: 0 }, workMode: mode } as MapData];
		const vault = new MemVault({});
		const p = {
			app: vault.app(),
			manifest: { dir: ".obsidian/plugins/hexmaker" },
			settings: { hexFolder: "world/hexes", maps },
			getMap: (n: string) => maps.find((m) => m.name === n),
			saveData: async () => {},
			refreshHexMap: () => {},
		};
		const store = new MapStore(p as never);
		await store.init();
		setModeMapLookup((n) => p.getMap(n));
		return { store, maps };
	}

	it("refuses a locked action in Play and writes nothing; Build writes", async () => {
		const { store, maps } = await boot("play");
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(store.set("m", "1_1", { terrain: "forest" }, "paint-terrain")).toBe(false);
		} finally {
			console.warn = warn;
		}
		expect(store.get("m", "1_1")).toBeUndefined();
		// Note text (a hex's name) is never locked.
		expect(store.set("m", "1_1", { name: "Old Keep" }, "edit-note")).toBe(true);
		// Writes with no action (derived data, renames) are never locked.
		expect(store.set("m", "2_2", { terrain: "hills" })).toBe(true);
		maps[0].workMode = "build";
		expect(store.set("m", "1_1", { terrain: "forest" }, "paint-terrain")).toBe(true);
		expect(store.get("m", "1_1")).toEqual({ name: "Old Keep", terrain: "forest" });
	});

	it("record() returns every hex changed, before and after, for undo", async () => {
		const { store } = await boot("build");
		store.set("m", "0_0", { terrain: "hills", name: "Keep" });
		const { result, cells } = await store.record(async () => {
			store.set("m", "0_0", { terrain: "forest" });
			store.setMany("m", [["1_0", { terrain: "lake" }]]);
			store.set("m", "0_0", { terrain: "swamp" }); // second change: first "before" kept
			return 7;
		});
		expect(result).toBe(7);
		const edits = cellEdits(cells);
		expect(edits).toEqual([
			{ map: "m", key: "0_0", fields: { terrain: ["hills", "swamp"] } },
			{ map: "m", key: "1_0", fields: { terrain: [undefined, "lake"] } },
		]);
		// Undo puts it back, field by field.
		for (const e of edits) store.set(e.map, e.key, cellPatch(e, "undo"));
		expect(store.get("m", "0_0")).toEqual({ terrain: "hills", name: "Keep" });
		expect(store.get("m", "1_0")).toBeUndefined();
	});
});

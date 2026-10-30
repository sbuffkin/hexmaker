import { describe, it } from "node:test";
import expect from "expect";
import { setup, undoRedo } from "./helpers/exploreFixture";
import { readSource } from "./helpers/source";
import { exploreStep } from "./helpers/exploring";
import { emptyFlower } from "../src/hexflower/flower";
import { buildFlowerNote } from "../src/hexflower/flowerNote";
import { sectionText } from "../src/sections";
import { editedSinceText } from "../src/hex-map/noteUndo";
import { UndoBook } from "../src/undoBook";
import type { UndoItem } from "../src/hex-map/undoItems";

/**
 * Owner HF7: the text a step writes into hex notes (Features, Description…)
 * is part of the step's undo (one undo = the whole step); the play log
 * keeps its lines. The notice's Undo is the map view's undo of that step.
 */

const NOTE = "world/hexes/m/2_1.md";

/** A map that also writes "Old shrine" into Features on every new hex. */
async function withRuins(map: Record<string, unknown> = {}) {
	const ruins = emptyFlower("Ruins", "P");
	ruins.cells = ruins.cells.map(() => ({ result: "Old shrine" }));
	const s = setup({ exploreWith: ["[[Wilds]] -> terrain", "[[Ruins]] -> Features"], ...map }, "m", { "world/hex flowers/Ruins.md": buildFlowerNote(ruins) });
	await s.flowers.init();
	const vault = s.plugin.app as unknown as { vault: { read(f: { path: string }): Promise<string> } };
	const features = async () => sectionText(await vault.vault.read({ path: NOTE }), "Features");
	return { ...s, features };
}

describe("a step's note text is part of its undo (HF7)", () => {
	it("undo takes the Features text back, redo writes it again; the note made by the step stays", async () => {
		const s = await withRuins();
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		expect(await s.features()).toBe("Old shrine");
		expect(undo.filter((u) => u.kind === "note-section")).toEqual([{ kind: "note-section", path: NOTE, section: "Features", before: "", after: "Old shrine" }]);
		await undoRedo(s.plugin, undo, "undo");
		expect(await s.features()).toBe("");
		expect(s.store.get("m", "2_1")).toBeUndefined();
		await undoRedo(s.plugin, undo, "redo");
		expect(await s.features()).toBe("Old shrine");
	});

	it("in a note that already had text, only the step's section changes back; the rest is untouched", async () => {
		const s = await withRuins();
		const v = (s.plugin.app as unknown as { vault: { create(p: string, c: string): Promise<unknown>; read(f: { path: string }): Promise<string> } }).vault;
		const mine = "# 2, 1\n\n### Features\n\n### Description\nA wide meadow.\n";
		await v.create(NOTE, mine);
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		expect(await s.features()).toBe("Old shrine");
		await undoRedo(s.plugin, undo, "undo");
		expect(await s.features()).toBe("");
		expect(sectionText(await v.read({ path: NOTE }), "Description")).toBe("A wide meadow.");
	});

	it("a section edited since stays, and the user is told; the rest of the step still goes", async () => {
		const s = await withRuins();
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		const v = (s.plugin.app as unknown as { vault: { process(f: { path: string }, fn: (c: string) => string): Promise<string> } }).vault;
		await v.process({ path: NOTE }, (c) => c.replace("Old shrine", "Old shrine, now a camp"));
		const told: string[] = [];
		await undoRedo(s.plugin, undo, "undo", told);
		expect(await s.features()).toBe("Old shrine, now a camp");
		expect(told).toEqual(["Features in 2_1 was edited since, so it stays."]);
		expect(editedSinceText({ kind: "note-section", path: NOTE, section: "Features", before: "", after: "x" })).toBe(told[0]);
		expect(s.store.get("m", "2_1")).toBeUndefined();
	});

	it("Reroll takes the note text back before rolling again (no doubled lines)", async () => {
		const s = await withRuins();
		await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		await s.ex.reroll("m");
		expect(await s.features()).toBe("Old shrine");
	});
});

describe("the step notice's Undo is the map view's undo (one path)", () => {
	function withView(s: Awaited<ReturnType<typeof withRuins>>, queue: UndoItem[]) {
		const calls: string[] = [];
		const view = {
			activeMapName: "m",
			undo: async (match: (it: UndoItem) => boolean) => {
				const top = queue[queue.length - 1];
				if (!top || !match(top)) { calls.push("not the latest"); return false; }
				queue.pop();
				calls.push("undone");
				return true;
			},
		};
		(s.plugin.app as unknown as Record<string, unknown>).workspace = { getLeavesOfType: () => [{ view }] };
		return calls;
	}

	it("pops the step's own entry from the map's queue", async () => {
		const s = await withRuins();
		const actions: { label: string; run: () => void }[][] = [];
		(s.ex as unknown as { show: (t: string, a: { label: string; run: () => void }[]) => void }).show = (_t, a) => actions.push(a);
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		// The map view pushes the step as one group: the token, the visited marks, then what exploring returned.
		const step: UndoItem = { kind: "group", items: [{ kind: "token", path: "p.md", before: null, after: null }, ...undo] };
		const queue: UndoItem[] = [step];
		const calls = withView(s, queue);
		actions[0].find((a) => a.label === "Undo")!.run();
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toEqual(["undone"]);
		expect(queue).toEqual([]);
	});

	it("when another change came after the step, nothing is undone and the user is told", async () => {
		const s = await withRuins();
		const shown: string[] = [];
		const actions: { label: string; run: () => void }[][] = [];
		(s.ex as unknown as { show: (t: string, a: { label: string; run: () => void }[]) => void }).show = (t, a) => { shown.push(t); actions.push(a); };
		const undo = await exploreStep(s.plugin as never, { map: "m", from: "1_1", to: "2_1" });
		const queue: UndoItem[] = [{ kind: "group", items: undo }, { kind: "map-field", mapName: "m", field: "x", before: 1, after: 2 }];
		const calls = withView(s, queue);
		actions[0].find((a) => a.label === "Undo")!.run();
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toEqual(["not the latest"]);
		expect(queue).toHaveLength(2);
		expect(shown.at(-1)).toBe("This step isn't the latest change on the map any more: use the map's Undo.");
	});

	it("the notice says the play log keeps its lines; nothing takes the step back on its own", () => {
		const src = readSource("src/hexflower/ExploreService.ts");
		expect(src).toMatch(/\(the play log keeps its lines\)/);
		expect(src).not.toMatch(/notes and the play log stay/);
		expect(src).not.toMatch(/setTokenHex/);
	});

	it("the queue can undo only its latest entry (never an older one in its place)", async () => {
		const book = new UndoBook<string>();
		book.push("m", "play", "older");
		book.push("m", "play", "step");
		expect(book.peek("m", "play", "undo")).toBe("step");
		// The latest is rejected (changed since): dropped, and the older one is left alone.
		expect(await book.step("m", "play", "undo", () => null, true)).toBeNull();
		expect(book.peek("m", "play", "undo")).toBe("older");
		expect(book.peek("m", "play", "redo")).toBeUndefined();
	});
});

/**
 * SP2: the World types dialog saves automatically (worldTypesDraft.ts).
 * Only rows that read are written; incomplete rows never are; nothing is
 * written when nothing changed; hand edits to the note are never
 * overwritten.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemVault } from "./helpers/memVault";
import {
	DEFAULT_WORLD_TYPES,
	FEATURE_COLUMNS,
	STAR_COLUMNS,
	WORLD_TYPE_COLUMNS,
	buildWorldTypes,
	copyWorldTypeRows,
	updateWorldTypes,
} from "../src/space/worldTypes";
import { DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { WorldTypeStore } from "../src/space/WorldTypeStore";
import { WorldTypesDraft } from "../src/space/worldTypesDraft";
import { TFile } from "obsidian";

const NOTE = `world/world-types/${DEFAULT_WORLD_TYPES}.md`;
const W = (c: string) => WORLD_TYPE_COLUMNS.indexOf(c as never);

function storePlugin(vault: MemVault) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", worldTypesSeeded: true } as Record<string, unknown>,
		saveSettings: async () => {},
	};
}

/** A store over a note (with or without Stars / Sector features), and a draft listening to it like the dialog. */
async function setup(text = buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS, { stars: [{ star: "red dwarf", weight: 2 }], features: [{ feature: "anomaly", chance: 0.02 }] })) {
	const v = new MemVault({ [NOTE]: text });
	const store = new WorldTypeStore(storePlugin(v) as never);
	await store.init();
	v.writes.length = 0;
	const draft = new WorldTypesDraft(store, DEFAULT_WORLD_TYPES);
	const syncs: ReturnType<WorldTypesDraft["sync"]>[] = [];
	store.onChange(() => syncs.push(draft.sync()));
	/** A hand edit to the note, read back as Obsidian would (vault modify event). */
	const handEdit = async (next: string, notify = true) => {
		v.files.set(NOTE, next);
		if (!notify) return;
		const f = new TFile();
		f.path = NOTE;
		f.name = NOTE.slice(NOTE.lastIndexOf("/") + 1);
		f.basename = f.name.replace(/\.md$/, "");
		f.extension = "md";
		store.onModify(f);
		await store.ensureDefault(); // waits for the store's queue
	};
	return { v, store, draft, syncs, handEdit };
}

describe("World types autosave (SP2)", () => {
	it("writes nothing when nothing changed, or an edit was undone", async () => {
		const { v, draft } = await setup();
		expect(draft.hasChanges()).toBe(false);
		expect(await draft.save()).toBe(false);
		const row = draft.cells.worlds[0];
		const was = row[W("Weight")];
		row[W("Weight")] = "99";
		expect(draft.hasChanges()).toBe(true);
		row[W("Weight")] = was;
		expect(draft.hasChanges()).toBe(false);
		expect(await draft.save()).toBe(false);
		expect(v.writes).toEqual([]);
	});

	it("a restart with the dialog opened and closed rewrites nothing (smoke C5)", async () => {
		const { v } = await setup();
		const store = new WorldTypeStore(storePlugin(v) as never);
		await store.init();
		const draft = new WorldTypesDraft(store, DEFAULT_WORLD_TYPES);
		if (draft.hasChanges()) await draft.save();
		expect(v.writes).toEqual([]);
	});

	it("autosave writes rows that read", async () => {
		const { v, store, draft, syncs } = await setup();
		draft.cells.worlds[0][W("Weight")] = "42";
		draft.cells.stars.push(["white dwarf", "3", ""]);
		expect(await draft.save()).toBe(true);
		expect(v.writes).toEqual([NOTE]);
		const t = store.get(DEFAULT_WORLD_TYPES)!;
		expect(t.rows[0].weight).toBe(42);
		expect(t.stars!.map((s) => s.star)).toEqual(["red dwarf", "white dwarf"]);
		// Our own save coming back is not a hand edit: the rows stay as typed.
		expect(syncs.at(-1)).toEqual({ changed: false, replaced: [] });
		expect(draft.hasChanges()).toBe(false);
		expect(await draft.save()).toBe(false);
		expect(v.writes).toEqual([NOTE]);
	});

	it("never writes an incomplete row (half made, or an unknown map kind)", async () => {
		const { v, store, draft } = await setup();
		const before = v.files.get(NOTE);
		const blank = WORLD_TYPE_COLUMNS.map(() => "");
		const unknownKind = [...draft.cells.worlds[0]];
		unknownKind[W("World")] = "ice moon";
		unknownKind[W("Map")] = "planet";
		draft.cells.worlds.push(blank, unknownKind);
		draft.cells.features.push(["black hole", "", ""].slice(0, FEATURE_COLUMNS.length)); // no chance yet
		expect(draft.incompleteCount()).toBe(3);
		expect(draft.hasChanges()).toBe(false);
		expect(await draft.save()).toBe(false);
		expect(v.files.get(NOTE)).toBe(before);
		// A real edit beside them writes only that; the Sector odds stay as they were.
		draft.cells.worlds[0][W("Weight")] = "7";
		await draft.save();
		const t = store.get(DEFAULT_WORLD_TYPES)!;
		expect(t.rows.map((r) => r.world)).not.toContain("ice moon");
		expect(t.features).toEqual([{ feature: "anomaly", chance: 0.02 }]);
		expect(v.files.get(NOTE)).not.toContain("black hole");
		// They stay in the dialog until fixed or removed.
		expect(draft.incompleteCount()).toBe(3);
	});

	it("closing with only incomplete edits writes nothing (and adds no empty table)", async () => {
		const { v, draft } = await setup(buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS));
		const noExtras = updateWorldTypes(v.files.get(NOTE)!, DEFAULT_WORLD_TYPE_ROWS);
		expect(noExtras).toBe(v.files.get(NOTE));
		draft.cells.stars.push(STAR_COLUMNS.map(() => ""));
		draft.cells.worlds.push(WORLD_TYPE_COLUMNS.map(() => ""));
		// What the dialog does on close.
		if (draft.hasChanges()) await draft.save();
		expect(v.writes).toEqual([]);
	});

	it("takes in hand edits to tables it hasn't changed, and keeps its own", async () => {
		const { v, store, draft, syncs, handEdit } = await setup();
		draft.cells.stars[0][1] = "5"; // edited here, not saved yet
		const rows = copyWorldTypeRows(store.get(DEFAULT_WORLD_TYPES)!.rows);
		rows[0].weight = 13;
		await handEdit(updateWorldTypes(v.files.get(NOTE)!, rows));
		expect(syncs.at(-1)).toEqual({ changed: true, replaced: [] });
		expect(draft.cells.worlds[0][W("Weight")]).toBe("13");
		expect(draft.cells.stars[0][1]).toBe("5");
		await draft.save();
		const t = store.get(DEFAULT_WORLD_TYPES)!;
		expect(t.rows[0].weight).toBe(13);
		expect(t.stars![0].weight).toBe(5);
	});

	it("a table changed in both places takes the note's rows (and says so)", async () => {
		const { v, store, draft, syncs, handEdit } = await setup();
		draft.cells.worlds.push(WORLD_TYPE_COLUMNS.map(() => "")); // incomplete: kept
		draft.cells.worlds[0][W("Weight")] = "1";
		const rows = copyWorldTypeRows(store.get(DEFAULT_WORLD_TYPES)!.rows);
		rows[0].weight = 13;
		await handEdit(updateWorldTypes(v.files.get(NOTE)!, rows));
		expect(syncs.at(-1)).toEqual({ changed: true, replaced: ["worlds"] });
		expect(draft.cells.worlds[0][W("Weight")]).toBe("13");
		expect(draft.incompleteCount()).toBe(1);
		expect(draft.hasChanges()).toBe(false);
	});

	it("a save never overwrites a hand edit it hasn't seen yet", async () => {
		const { v, store, draft, handEdit } = await setup();
		draft.cells.worlds[0][W("Weight")] = "1";
		draft.cells.stars[0][1] = "9";
		const rows = copyWorldTypeRows(store.get(DEFAULT_WORLD_TYPES)!.rows);
		rows[0].weight = 13;
		await handEdit(updateWorldTypes(v.files.get(NOTE)!, rows), false); // on disk, event not yet read
		await draft.save();
		const t = store.get(DEFAULT_WORLD_TYPES)!;
		expect(t.rows[0].weight).toBe(13); // the hand edit stands
		expect(t.stars![0].weight).toBe(9); // the table only edited here is saved
	});
});

describe("World types dialog: no Save button, autosave status like the hex editor", () => {
	const modal = readFileSync(path.join(process.cwd(), "src", "space", "WorldTypesModal.ts"), "utf8").replace(/\r\n/g, "\n");
	it("has no Save button or 'Unsaved changes'", () => {
		expect(modal).not.toContain('text: "Save"');
		expect(modal).not.toContain("Unsaved changes");
		expect(modal).toContain("SAVE_STATUS_TEXT[state]");
		expect(modal).toContain("AUTOSAVE_MS");
	});
	it("saves on close (readable rows only) and marks incomplete rows", () => {
		const at = modal.indexOf("onClose(): void {");
		expect(modal.slice(at, at + 200)).toContain("this.saveNow();");
		expect(modal).toContain("Incomplete, not saved:");
	});
});

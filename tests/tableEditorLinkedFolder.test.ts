/**
 * The table editor's linked-folder sync (security review #9) and its
 * stale-write guard (#6). Row text and the folder come from the table
 * note, which may come from someone else's pack.
 */
import { describe, it } from "node:test";
import expect from "expect";
import type { App, TFile } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { readSource } from "./helpers/source";
import {
	currentText,
	linkedFolderAllowed,
	missingRowNotes,
	renameUpdatedEntries,
	retireDeletedEntries,
	rowNotePath,
	syncLinkedFolder,
} from "../src/random-tables/tableEditor/linkedFolder";
import type { RandomTableEntry } from "../src/random-tables/randomTable";

const appOf = (v: MemVault) => v.app() as unknown as App;
const rows = (...names: string[]): RandomTableEntry[] => names.map((result) => ({ result, weight: 1 }));

describe("linked folder: where notes may be made", () => {
	it("only a folder inside the world folder, not hidden, not the vault root", () => {
		expect(linkedFolderAllowed("world/towns", { worldFolder: "world" })).toBe(true);
		expect(linkedFolderAllowed("world", { worldFolder: "world" })).toBe(true);
		expect(linkedFolderAllowed("Private", { worldFolder: "world" })).toBe(false);
		expect(linkedFolderAllowed("world/.obsidian", { worldFolder: "world" })).toBe(false);
		expect(linkedFolderAllowed("world/../Private", { worldFolder: "world" })).toBe(false);
		expect(linkedFolderAllowed("", { worldFolder: "world" })).toBe(false);
		// A blank world folder setting means "world".
		expect(linkedFolderAllowed("world/npcs", { worldFolder: "" })).toBe(true);
	});

	it("a row's note path is its text cleaned into a file name", () => {
		expect(rowNotePath("world/towns", "Brindle")).toBe("world/towns/Brindle.md");
		expect(rowNotePath("world/towns", "../../Session notes")).toBe("world/towns/Session notes.md");
		expect(rowNotePath("world/towns", "a/b")).toBe("world/towns/a b.md");
		expect(rowNotePath("world/towns", "/")).toBeNull();
	});
});

describe("linked folder: sync", () => {
	it("makes stub notes inside the folder only, with cleaned names", async () => {
		const v = new MemVault({ "world/towns/Old.md": "# Old\n" });
		const entries = rows("Old", "New town", "../../escape", "a:b", "//");
		await syncLinkedFolder(appOf(v), entries, "world/towns", new Set());
		expect([...v.files.keys()].sort()).toEqual([
			"world/towns/New town.md",
			"world/towns/Old.md",
			"world/towns/a b.md",
			"world/towns/escape.md",
		]);
		expect(v.files.get("world/towns/New town.md")).toBe("# New town\n");
		// A note isn't added back as a new row when its row's text was cleaned to make it.
		expect(entries.map((e) => e.result)).toEqual(["Old", "New town", "../../escape", "a:b", "//"]);
	});

	it("adds a row for a note added by hand, skips _ notes, and doesn't remake notes missing at open", async () => {
		const v = new MemVault({ "world/towns/Hand made.md": "", "world/towns/_Retired.md": "" });
		const entries = rows("Gone");
		await syncLinkedFolder(appOf(v), entries, "world/towns", new Set(["Gone"]));
		expect(entries.map((e) => e.result)).toEqual(["Gone", "Hand made"]);
		expect(v.files.has("world/towns/Gone.md")).toBe(false);
	});

	it("reports rows whose note is missing, by cleaned name", () => {
		const v = new MemVault({ "world/towns/a b.md": "" });
		expect([...missingRowNotes(appOf(v), "world/towns", rows("a/b", "c"))]).toEqual(["c"]);
	});

	it("renames a renamed row's note within the folder, never out of it", async () => {
		const v = new MemVault({ "world/towns/Old.md": "x", "world/towns/Keep.md": "y" });
		const entries = rows("New", "../../Outside");
		const orig = new WeakMap<RandomTableEntry, string>([[entries[0], "Old"], [entries[1], "Keep"]]);
		await renameUpdatedEntries(appOf(v), entries, orig, "world/towns");
		expect([...v.files.keys()].sort()).toEqual(["world/towns/New.md", "world/towns/Outside.md"]);
	});

	it("retires a deleted row's note with a _ prefix", async () => {
		const v = new MemVault({ "world/towns/Gone.md": "x" });
		await retireDeletedEntries(appOf(v), new Set(["Gone", "Kept"]), rows("Kept"), "world/towns");
		expect([...v.files.keys()]).toEqual(["world/towns/_Gone.md"]);
	});
});

describe("table editor: no silent overwrite", () => {
	it("reads the note's text now (null when it's gone)", async () => {
		const v = new MemVault({ "world/tables/T.md": "now" });
		const app = appOf(v);
		const f = app.vault.getAbstractFileByPath("world/tables/T.md") as TFile;
		expect(await currentText(app, f)).toBe("now");
		v.remove("world/tables/T.md");
		expect(await currentText(app, f)).toBeNull();
	});

	it("checks the note against the text read at open before any write, and again inside the write", () => {
		const src = readSource("src", "random-tables", "RandomTableEditorModal.ts");
		const save = src.slice(src.indexOf("this.flushAndSave = async () => {"));
		const check = save.indexOf("(await currentText(this.app, this.file)) !== rawContent");
		expect(check).toBeGreaterThan(-1);
		// Before the linked-folder notes are touched.
		expect(check).toBeLessThan(save.indexOf("await renameUpdatedEntries("));
		expect(save).toContain("if (current !== before) return current;");
		expect(save).toContain("linkedFolderAllowed(linkedFolder, this.plugin.settings)");
	});
});

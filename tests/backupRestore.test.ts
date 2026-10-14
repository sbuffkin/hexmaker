/**
 * Owner MG2: backups stay in the plugin's folder; "Restore from upgrade
 * backup…" lists the backups that hold notes, shows what one would put
 * back, and restores after backing up the notes as they are now.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { gunzipSync } from "node:zlib";
import { backupNotes, listNoteBackups, planRestore, writeJsonBackup } from "../src/backup";
import { restoreBackup } from "../src/BackupsModal";
import { MemVault } from "./helpers/memVault";

(globalThis as Record<string, unknown>).window ??= globalThis;

const ROOT = ".obsidian/plugins/hexmaker/backups";

async function vaultWithBackups() {
	const vault = new MemVault({
		"world/hexes/coast/1_2.md": "---\nmap: \"[[_coast]]\"\n---\n# Hex\nnow\n",
		"world/tables/beach.md": "| d6 | Result | Weight |\n",
	});
	const a = vault.app().vault.adapter;
	await writeJsonBackup(a, `${ROOT}/map-notes-2026-10-13`, "coast-hex-notes", JSON.stringify({
		map: "coast", savedAt: "2026-10-13T08:00:00.000Z",
		notes: { "world/hexes/coast/1_2.md": "---\nterrain: ocean\n---\n# Hex\nthen\n", "world/hexes/coast/9_9.md": "# gone since\n" },
	}));
	await writeJsonBackup(a, `${ROOT}/table-ranges-2026-10-14`, "tables", JSON.stringify({
		kind: "table-ranges", savedAt: "2026-10-14T09:00:00.000Z", notes: { "world/tables/beach.md": "| d6 | Result | Weight |\n" },
	}));
	// Not a notes backup: a map's data, and a report.
	await a.mkdir(`${ROOT}/map-notes-2026-10-13`);
	await a.write(`${ROOT}/map-notes-2026-10-13/coast.json`, JSON.stringify({ map: "coast", hexes: [] }));
	await a.write(`${ROOT}/map-notes-2026-10-13/coast-paths-report.md`, "# report\n");
	return vault;
}

describe("MG2: reading backups back", () => {
	it("lists only backups that hold notes, newest first", async () => {
		const vault = await vaultWithBackups();
		const list = await listNoteBackups(vault.app().vault.adapter as never, ROOT);
		expect(list.map((b) => `${b.folder}/${b.name}`)).toEqual(["table-ranges-2026-10-14/tables.json.gz", "map-notes-2026-10-13/coast-hex-notes.json.gz"]);
		expect(Object.keys(list[1].notes)).toEqual(["world/hexes/coast/1_2.md", "world/hexes/coast/9_9.md"]);
		expect(await listNoteBackups(new MemVault().app().vault.adapter as never, ROOT)).toEqual([]);
	});

	it("reads a notes backup's JSON forgivingly", () => {
		expect(backupNotes({ notes: { a: "x", b: 3 } })).toEqual({ a: "x" });
		expect(backupNotes({ hexes: [] })).toBeNull();
		expect(backupNotes(null)).toBeNull();
	});

	it("says what a restore would do to each note", () => {
		const plan = planRestore({ a: "1", b: "2", c: "3" }, (p) => ({ a: "1", b: "changed" } as Record<string, string>)[p] ?? null);
		expect(plan).toEqual([{ path: "a", status: "same" }, { path: "b", status: "changed" }, { path: "c", status: "missing" }]);
	});
});

describe("MG2: restoring", () => {
	it("puts changed notes back, makes missing ones again, leaves the same ones, after backing up the notes as they are", async () => {
		const vault = await vaultWithBackups();
		const [, hexBackup] = await listNoteBackups(vault.app().vault.adapter as never, ROOT);
		const before = vault.files.get("world/hexes/coast/1_2.md");
		const r = await restoreBackup(vault.app() as never, ROOT, hexBackup, new Date("2026-10-15T10:00:00Z"));
		expect(r.restored).toEqual(["world/hexes/coast/1_2.md", "world/hexes/coast/9_9.md"]);
		expect(vault.files.get("world/hexes/coast/1_2.md")).toBe("---\nterrain: ocean\n---\n# Hex\nthen\n");
		expect(vault.files.get("world/hexes/coast/9_9.md")).toBe("# gone since\n");
		// The undo backup holds the notes as they were just before.
		expect(r.undo).toBe(`${ROOT}/restore-2026-10-15/before-restore.json.gz`);
		const undo = JSON.parse(gunzipSync(vault.binaries.get(r.undo!)!).toString("utf8"));
		expect(undo.notes).toEqual({ "world/hexes/coast/1_2.md": before });
		expect(undo.created).toEqual(["world/hexes/coast/9_9.md"]);
		expect(undo.restoredFrom).toBe(hexBackup.path);
		// ...and is itself offered, so the restore can be undone.
		const again = await listNoteBackups(vault.app().vault.adapter as never, ROOT);
		expect(again[0].path).toBe(r.undo);
		await restoreBackup(vault.app() as never, ROOT, again[0], new Date("2026-10-15T10:05:00Z"));
		expect(vault.files.get("world/hexes/coast/1_2.md")).toBe(before);
	});

	it("changes nothing when the notes are already as in the backup", async () => {
		const vault = await vaultWithBackups();
		const [tables] = await listNoteBackups(vault.app().vault.adapter as never, ROOT);
		const writes = vault.writes.length;
		expect(await restoreBackup(vault.app() as never, ROOT, tables)).toEqual({ restored: [] });
		expect(vault.writes.length).toBe(writes);
	});

	it("changes nothing when the notes as they are can't be backed up first", async () => {
		const vault = await vaultWithBackups();
		const [, hexBackup] = await listNoteBackups(vault.app().vault.adapter as never, ROOT);
		const snapshot = new Map(vault.files);
		vault.failBinary = true;
		await expect(restoreBackup(vault.app() as never, ROOT, hexBackup)).rejects.toThrow();
		expect(new Map(vault.files)).toEqual(snapshot);
	});
});

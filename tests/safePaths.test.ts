/**
 * src/vault/safePaths.ts: paths that come from note text (a pack, a synced
 * vault) are checked before the plugin writes to them.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { isFolderInside, isInsideFolder, isNoteInside, isSafeNotePath, isSafeVaultPath, noteFileName } from "../src/vault/safePaths";

describe("safe vault paths", () => {
	it("refuses absolute, drive, backslash, dot-dot, hidden and empty parts", () => {
		for (const bad of ["", "/etc/x.md", "C:/x.md", "a\\b.md", "../x.md", "a/../b.md", "./a.md", "a//b.md", ".obsidian/x.md", "world/.trash/x.md", "a/"]) {
			expect([bad, isSafeVaultPath(bad)]).toEqual([bad, false]);
		}
		expect(isSafeVaultPath("world/towns/Brindle.md")).toBe(true);
		expect(isSafeVaultPath("world/_coast/_coast.md")).toBe(true);
	});

	it("a note path is a safe .md path", () => {
		expect(isSafeNotePath("world/a.md")).toBe(true);
		expect(isSafeNotePath("world/a.MD")).toBe(true);
		expect(isSafeNotePath("world/a.png")).toBe(false);
		expect(isSafeNotePath("world/a.md/../b.md")).toBe(false);
	});

	it("inside a folder means the folder or below it, not a sibling with the same prefix", () => {
		expect(isInsideFolder("world/a.md", "world")).toBe(true);
		expect(isInsideFolder("world", "world/")).toBe(true);
		expect(isInsideFolder("worldly/a.md", "world")).toBe(false);
		expect(isInsideFolder("anything.md", "")).toBe(true);
		expect(isNoteInside("world/a.md", ["world"])).toBe(true);
		expect(isNoteInside("Notes.md", ["world", "wf"])).toBe(false);
	});

	it("a folder inside the roots: safe, and the vault root only when a root is the vault root", () => {
		expect(isFolderInside("world/towns", ["world"])).toBe(true);
		expect(isFolderInside("world/.hidden", ["world"])).toBe(false);
		expect(isFolderInside("world/../x", ["world"])).toBe(false);
		expect(isFolderInside("", ["world"])).toBe(false);
		expect(isFolderInside("", [""])).toBe(true);
		expect(isFolderInside("Elsewhere", ["world"])).toBe(false);
	});
});

describe("note file names from text", () => {
	it("leaves a fine name as it is", () => {
		for (const ok of ["Brindle", "Room #1", "The [old] mill", "Ünïcødé café", "a.b"]) expect(noteFileName(ok)).toBe(ok);
	});

	it("takes out separators and characters Windows refuses, and control characters", () => {
		expect(noteFileName("../../etc/passwd")).toBe("etc passwd");
		expect(noteFileName("a/b\\c")).toBe("a b c");
		expect(noteFileName('What? "Here": <x>|*')).toBe("What Here x");
		expect(noteFileName("tab\there\nnew")).toBe("tab here new");
	});

	it("no leading dot, no trailing dot or space, no device names, at most 120 characters", () => {
		expect(noteFileName(".hidden")).toBe("hidden");
		expect(noteFileName("trailing. ")).toBe("trailing");
		expect(noteFileName("CON")).toBe("CON_");
		expect(noteFileName("x".repeat(300))).toHaveLength(120);
		expect(noteFileName("/")).toBe("");
		expect(noteFileName("  ")).toBe("");
	});
});

/**
 * Owner MG1 / MG1b / MG7: the "Hexmaker upgrade <date>" note, the one
 * combined notice linking it, the changelog points it lists, and the data
 * stamp an older build reads.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { Notice } from "obsidian";
import { beginNoticeBatch, combinedTimeout, endNoticeBatch, noticeBatchOpen, noticeUpgrade } from "../src/ui/notify";
import { takeUpgradeReport } from "../src/migrations/upgradeReport";
import { UPDATE_DEVICES_LINE, changelogPoints, upgradeNoteName, upgradeNoteText, writeUpgradeNote } from "../src/migrations/upgradeNote";
import { DATA_FORMAT, dataFormatOf, newerDataText, stampToSave, writtenByNewer } from "../src/migrations/stamp";
import { MemVault } from "./helpers/memVault";

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
/** createFragment stand-in that keeps the text and the link's click handler. */
const clicks: (() => void)[] = [];
g.createFragment = (build: (f: unknown) => void) => {
	const parts: string[] = [];
	const el = (): Record<string, unknown> => ({
		createEl: (_t: string, o?: { text?: string }) => { if (o?.text) parts.push(o.text); return el(); },
		addEventListener: (_e: string, fn: (ev: unknown) => void) => { clicks.push(() => fn({ preventDefault() {}, stopPropagation() {} })); },
	});
	const frag = { ...el(), get textContent() { return parts.join("\n"); } };
	build(frag);
	return frag;
};
const shown = () => (Notice as unknown as { shown: { msg: unknown; timeout?: number }[] }).shown;
const text = (m: unknown) => (typeof m === "string" ? m : (m as { textContent: string }).textContent);

const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const DATE = new Date(2026, 9, 14, 9, 5);

describe("MG1: the upgrade note", () => {
	const input = {
		date: DATE,
		from: "1.5.6",
		to: "1.6.0",
		backupsFolder: ".obsidian/plugins/hexmaker/backups",
		pluginName: "Hexmap World Creator",
		changelog: CHANGELOG,
		entries: [
			{ text: "map data for 2 maps now lives in map notes (_<map>.md).", ids: ["v1.5-map-data-to-map-notes"], backups: [".obsidian/plugins/hexmaker/backups/map-notes-2026-10-14"] },
			{ text: "added roll ranges to 3 tables.", backups: [".obsidian/plugins/hexmaker/backups/table-ranges-2026-10-14/tables.json.gz"], check: ["1 table was left without roll ranges"] },
		],
	};

	it("is named by the date and says 'update every device first' as its first line", () => {
		expect(upgradeNoteName(DATE)).toBe("Hexmaker upgrade 2026-10-14");
		const lines = upgradeNoteText(input).split("\n");
		expect(lines[0]).toBe("# Hexmaker upgrade 2026-10-14");
		expect(lines.slice(1).find((l) => l.trim())).toBe(UPDATE_DEVICES_LINE);
		expect(UPDATE_DEVICES_LINE).toMatch(/^\*\*Update every device that shares this vault first\.\*\*/);
	});

	it("lists what changed, where the backups are, and what to check", () => {
		const t = upgradeNoteText(input);
		expect(t).toContain("updated this vault from version 1.5.6 to version 1.6.0 on 2026-10-14 at 09:05.");
		expect(t).toContain("- Map data for 2 maps now lives in map notes (_<map>.md).");
		expect(t).toContain("- Added roll ranges to 3 tables.");
		expect(t).toContain("- `.obsidian/plugins/hexmaker/backups/map-notes-2026-10-14`");
		expect(t).toContain("- `.obsidian/plugins/hexmaker/backups/table-ranges-2026-10-14/tables.json.gz`");
		expect(t).toContain("**Hexmap World Creator: Open backups folder**");
		expect(t).toContain("**Hexmap World Creator: Restore from upgrade backup…**");
		expect(t).toContain("- [ ] 1 table was left without roll ranges.");
		expect(t).toContain("- [ ] Open your maps once: each should look as it did before.");
		const order = ["## What changed", "## Backups", "## To check", "## What's new"].map((h) => t.indexOf(h));
		expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
	});

	it("includes the changelog's points newer than the version it came from", () => {
		const t = upgradeNoteText(input);
		expect(t).toContain("### Your data");
		expect(t).toContain("- Terrain palettes are now notes in the palettes folder that you can read and edit.");
		// Slice markers never show.
		expect(t).not.toContain("<!--");
	});

	it("changelog points: every point is one short sentence; Unreleased always, older versions not", () => {
		const pts = changelogPoints(CHANGELOG, "1.5.6").filter((l) => l.startsWith("- "));
		expect(pts.length).toBeGreaterThan(10);
		for (const p of pts) {
			expect(p).toMatch(/\.$/);
			expect(p.split(/[.!?]\s/).length).toBe(1);
			expect(p.length).toBeLessThan(140);
		}
		const md = "# Changelog\n\n## Unreleased\n\n- New.\n\n## 1.6.0\n\n### A\n\n- Six.\n\n## 1.5.6\n\n- Old.\n";
		expect(changelogPoints(md, "1.5.6")).toEqual(["- New.", "", "### A", "", "- Six."]);
		expect(changelogPoints(md, "1.6.0")).toEqual(["- New."]);
		expect(changelogPoints(md, undefined)).toContain("- Old.");
	});

	it("says 'an older version' when data.json had no savedWith", () => {
		expect(upgradeNoteText({ ...input, from: undefined })).toContain("from an older version to version 1.6.0");
	});

	it("is written in the world folder, never over an earlier note", async () => {
		const vault = new MemVault({ "World/Hexmaker upgrade 2026-10-14.md": "mine" });
		const p = await writeUpgradeNote(vault.app() as never, "World", input);
		expect(p).toBe("World/Hexmaker upgrade 2026-10-14 (2).md");
		expect(vault.files.get("World/Hexmaker upgrade 2026-10-14.md")).toBe("mine");
		expect(vault.files.get(p)).toBe(upgradeNoteText(input));
		const root = new MemVault();
		expect(await writeUpgradeNote(root.app() as never, "", input)).toBe("Hexmaker upgrade 2026-10-14.md");
	});
});

describe("MG1b: one combined notice, linking the note", () => {
	beforeEach(() => { shown().length = 0; if (noticeBatchOpen()) endNoticeBatch(); shown().length = 0; takeUpgradeReport(); clicks.length = 0; });

	it("every upgrade notice is recorded for the note, with its details", () => {
		noticeUpgrade("added roll ranges to 2 tables.", { ids: ["v1.5-table-roll-ranges"], backups: ["b/t.json.gz"] });
		expect(takeUpgradeReport()).toEqual([{ text: "added roll ranges to 2 tables.", ids: ["v1.5-table-roll-ranges"], backups: ["b/t.json.gz"] }]);
		expect(takeUpgradeReport()).toEqual([]);
	});

	it("keeps the timer, and ends with a link to the note (one message too)", () => {
		let opened = 0;
		beginNoticeBatch();
		noticeUpgrade("map data for 14 maps now lives in map notes.");
		endNoticeBatch({ text: "What changed, and the backups: Hexmaker upgrade 2026-10-14", open: () => { opened++; } });
		expect(shown()).toHaveLength(1);
		expect(text(shown()[0].msg)).toContain("What changed, and the backups: Hexmaker upgrade 2026-10-14");
		expect(shown()[0].timeout).toBe(combinedTimeout(1));
		expect(clicks).toHaveLength(1);
		clicks[0]();
		expect(opened).toBe(1);
	});
});

describe("MG7: the data stamp", () => {
	it("reads a 1.5.x data.json (no stamp) as format 1, and this build's as current", () => {
		expect(dataFormatOf({ savedWith: "1.5.6" })).toBe(1);
		expect(dataFormatOf(null)).toBe(1);
		expect(dataFormatOf({ dataFormat: 2 })).toBe(2);
		expect(dataFormatOf({ dataFormat: "3" })).toBe(3);
		expect(dataFormatOf({ dataFormat: "junk" })).toBe(1);
		expect(DATA_FORMAT).toBe(2);
	});

	it("tells data written by a newer build, and never lowers a newer stamp", () => {
		expect(writtenByNewer({ dataFormat: DATA_FORMAT + 1 })).toBe(true);
		expect(writtenByNewer({ dataFormat: DATA_FORMAT })).toBe(false);
		expect(writtenByNewer({ dataFormat: 2 }, 1)).toBe(true); // what a 1.5.x patch would check
		expect(stampToSave(undefined)).toBe(DATA_FORMAT);
		expect(stampToSave(1)).toBe(DATA_FORMAT);
		expect(stampToSave(DATA_FORMAT + 3)).toBe(DATA_FORMAT + 3);
		expect(newerDataText("1.7.0", 3)).toMatch(/updated by version 1\.7\.0 .*data format 3.*Update the plugin on this device/);
	});

	it("is documented in the migrations README exactly as written", () => {
		const readme = readFileSync(new URL("../src/migrations/README.md", import.meta.url), "utf8");
		expect(readme).toContain('"dataFormat": 2');
		expect(readme).toContain("hexmaker-map:");
	});
});

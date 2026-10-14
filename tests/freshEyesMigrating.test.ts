/**
 * Fresh-eyes 2026-10-13, a 1.5.x user upgrading (F2, F5, F6, F9, F11):
 * upgrade notices, their wording, tall modals, the README's Center hex and
 * duplicate map names in lists. Section heading levels (F1) are in
 * sectionLevels.test.ts; duplicate names end to end in
 * integration/duplicateMapNames.integration.ts.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { Notice } from "obsidian";
import {
	BACKGROUND_PREFIX,
	beginNoticeBatch,
	combinedTimeout,
	combinedUpgradeLines,
	endNoticeBatch,
	noticeBatchOpen,
	noticeUpgrade,
	UPGRADE_NOTICE_MS,
} from "../src/ui/notify";
import { oneHexPiecesText } from "../src/migrations/v1.5-map-data-to-map-notes";
import { tableRangesNoticeText } from "../src/migrations/v1.5-table-roll-ranges";
import { uniqueMapsByName } from "../src/maps/mapTree";
import { readSurface } from "./helpers/source";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Obsidian globals the notice batch uses.
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
/** A stand-in for Obsidian's createFragment: records the text it's built with. */
g.createFragment ??= (build: (f: unknown) => void) => {
	const parts: string[] = [];
	const el = (): Record<string, unknown> => ({ createEl: (_t: string, o?: { text?: string }) => { if (o?.text) parts.push(o.text); return el(); } });
	const frag = { ...el(), get textContent() { return parts.join("\n"); } };
	build(frag);
	return frag;
};

const shown = () => (Notice as unknown as { shown: { msg: unknown; timeout?: number }[] }).shown;
const text = (m: unknown) => (typeof m === "string" ? m : (m as { textContent: string }).textContent);

describe("F2: upgrade notices at start-up are one notice, in order", () => {
	beforeEach(() => { shown().length = 0; if (noticeBatchOpen()) endNoticeBatch(); shown().length = 0; });

	it("outside start-up an upgrade notice shows at once, with the plugin's name", () => {
		noticeUpgrade("added roll ranges to 2 tables.");
		expect(shown().map((n) => n.msg)).toEqual([`${BACKGROUND_PREFIX} added roll ranges to 2 tables.`]);
		expect(shown()[0].timeout).toBe(UPGRADE_NOTICE_MS);
	});

	it("during start-up they wait, then show as ONE notice listing each in order", () => {
		beginNoticeBatch();
		noticeUpgrade("map data for 14 maps now lives in map notes.");
		noticeUpgrade("paths on 9 maps moved to the new format.");
		noticeUpgrade("updated note formats.");
		noticeUpgrade("added roll ranges to 271 tables.");
		expect(shown()).toHaveLength(0);
		endNoticeBatch();
		expect(shown()).toHaveLength(1);
		expect(text(shown()[0].msg).split("\n")).toEqual([
			`${BACKGROUND_PREFIX} updated this vault.`,
			"Map data for 14 maps now lives in map notes.",
			"Paths on 9 maps moved to the new format.",
			"Updated note formats.",
			"Added roll ranges to 271 tables.",
		]);
		expect(shown()[0].timeout).toBe(combinedTimeout(4));
		expect(noticeBatchOpen()).toBe(false);
	});

	it("one message in the batch is shown as it is; none shows nothing", () => {
		beginNoticeBatch();
		expect(endNoticeBatch()).toBeNull();
		beginNoticeBatch();
		noticeUpgrade("terrain palettes are now notes.");
		endNoticeBatch();
		expect(shown().map((n) => n.msg)).toEqual([`${BACKGROUND_PREFIX} terrain palettes are now notes.`]);
	});

	it("combined lines drop repeats and a doubled prefix; time grows with the list, capped", () => {
		expect(combinedUpgradeLines([`${BACKGROUND_PREFIX} a.`, "a.", "b."])).toEqual([`${BACKGROUND_PREFIX} updated this vault.`, "A.", "B."]);
		expect(combinedTimeout(1)).toBe(15000);
		expect(combinedTimeout(4)).toBe(33000);
		expect(combinedTimeout(20)).toBe(45000);
	});

	it("background notices let clicks through to the toolbar and close with their own ×", () => {
		const css = read("../styles.css");
		expect(css).toMatch(/\.notice\.duckmage-bg-notice\s*\{[^}]*pointer-events:\s*none/);
		expect(css).toMatch(/\.duckmage-bg-notice \.duckmage-bg-notice-close\s*\{[^}]*pointer-events:\s*auto/);
		const notify = read("../src/ui/notify.ts");
		expect(notify).toContain('el.addClass("duckmage-bg-notice")');
	});

	it("the plugin batches its start-up upgrades and shows them once they're all done", () => {
		const plugin = readSurface("plugin");
		expect(plugin).toContain("beginNoticeBatch();");
		expect(plugin).toMatch(/Promise\.allSettled\(\[storesReady, formatsDone, registered, rangesDone\]\)\.then\(\(\) => this\.finishStartupUpgrades\(\)\)/);
		// MG1: once done, the upgrade note is written, then the one notice links it.
		expect(plugin).toMatch(/private async finishStartupUpgrades[\s\S]*?writeUpgradeNote[\s\S]*?endNoticeBatch\(link\)/);
	});
});

describe("F2/F5: upgrade notice wording", () => {
	it("the roll-ranges notice says where the backup is", () => {
		const path = ".obsidian/plugins/hexmaker/backups/table-ranges-2026-10-13/tables.json.gz";
		expect(tableRangesNoticeText(271, path)).toBe(`added roll ranges to 271 tables. The originals are backed up in ${path}.`);
		expect(tableRangesNoticeText(1, undefined)).toBe("added roll ranges to 1 table.");
	});

	it("one-hex leftovers don't read as lost roads: older versions never drew them", () => {
		const t = oneHexPiecesText(166);
		expect(t).toContain("166 path pieces only one hex long were left out");
		expect(t).toContain("never drew a path that short");
		expect(t).not.toMatch(/dropped/);
		expect(oneHexPiecesText(1)).toMatch(/^1 path piece only one hex long was left out/);
	});
});

describe("F6: tall modals stay inside the window and scroll inside", () => {
	it("the shared modal base clamps every modal to the viewport", () => {
		const base = readSurface("modal-base");
		const drag = base.slice(base.indexOf("protected makeDraggable(): void {"));
		expect(drag.slice(0, 600)).toContain("this.viewportClamp ??= this.clampToViewport();");
		expect(base).toContain('win.addEventListener("resize", fit);');
	});

	it("the modal is a flex column whose content can shrink and scroll", () => {
		const css = read("../styles.css").replace(/\r\n/g, "\n");
		const modal = /\.modal\.duckmage-editor-modal-drag \{([^}]*)\}/.exec(css)![1];
		expect(modal).toMatch(/display: flex;/);
		expect(modal).toMatch(/flex-direction: column;/);
		expect(modal).toMatch(/max-height: min\(90vh, 860px\);/);
		const content = /\.duckmage-editor-modal-drag \.modal-content \{([^}]*)\}/.exec(css)![1];
		expect(content).toMatch(/overflow-y: auto;/);
		expect(content).toMatch(/min-height: 0;/);
	});

	it("the full terrain palette has no inner scroll box (the modal scrolls as one)", () => {
		const css = read("../styles.css").replace(/\r\n/g, "\n");
		const strip = css.indexOf(".duckmage-hex-editor .duckmage-terrain-picker {");
		const full = css.indexOf(".duckmage-hex-editor .duckmage-terrain-picker.duckmage-terrain-picker-full {");
		expect(full).toBeGreaterThan(strip);
		expect(css.slice(full, css.indexOf("}", full))).toMatch(/max-height: none;/);
	});
});

describe("F9: README and help name the Center hex button", () => {
	it("no ⌖ toolbar button is described; Center hex is", () => {
		const readme = read("../README.md");
		const help = read("../src/hex-map/help.md");
		expect(readme).not.toMatch(/⌖` button in the toolbar/);
		expect(help).not.toMatch(/\| \*\*⌖\*\* \|/);
		expect(readme).toMatch(/\*\*Center hex\*\* \(in the drawing tools panel/);
		expect(help).toContain("**Center hex** asks for X, Y");
		expect(readSurface("map-view")).toContain('text: "Center hex"');
	});
});

describe("F11: duplicate map names count once", () => {
	it("first wins, order kept", () => {
		const maps = [{ name: "a", n: 1 }, { name: "asdf", n: 2 }, { name: "asdf", n: 3 }, { name: "b", n: 4 }];
		expect(uniqueMapsByName(maps).map((m) => m.n)).toEqual([1, 2, 4]);
	});

	it("the hex table, generator library and export list use it", () => {
		expect(readSurface("hex-table").match(/uniqueMapsByName\(this\.plugin\.settings\.maps\)/g)).toHaveLength(3);
		expect(read("../src/worldgen/GeneratorLibrary.ts").match(/uniqueMapsByName\(this\.plugin\.settings\.maps\)/g)).toHaveLength(2);
		expect(readSurface("export-modal")).toContain("uniqueMapsByName(plugin.settings.maps)");
		expect(readSurface("map-modal")).toContain("const maps = uniqueMapsByName(this.plugin.settings.maps);");
	});
});

import { describe, it } from "node:test";
import expect from "expect";
import { codeInNote, coreKinds, isSafePackPath, packPathProblem, type PackKind } from "../src/packs/packKinds";
import { planImport, type ImportPlan, type LoadedPack } from "../src/packs/packPlan";
import { PackImportModal } from "../src/packs/PackImportModal";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import { App } from "./__mocks__/obsidian";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";

const enc = (s: string) => new TextEncoder().encode(s);
const kinds: PackKind[] = coreKinds({ worldFolder: "world" }, { palettes: "world/palettes", generators: "world/generators" });

describe("content packs: names any system can take (security #12)", () => {
	it("refuses Windows-forbidden and control characters", () => {
		for (const bad of ["tables/a:b.md", "tables/a*.md", "tables/what?.md", 'tables/"q".md', "tables/a<b>.md", "tables/a|b.md", "tables/tab\there.md", "tables/nul\u0000.md", "tables/bell\u0007.md", "tables/del\u007f.md"]) {
			expect({ bad, ok: isSafePackPath(bad) }).toEqual({ bad, ok: false });
		}
		expect(packPathProblem("tables/a:b.md")).toMatch(/characters some systems can't use/);
	});

	it("refuses a part ending in a dot or a space", () => {
		for (const bad of ["tables/x.md.", "tables/x.md ", "tables/sea./x.md", "tables/sea /x.md"]) {
			expect({ bad, why: packPathProblem(bad) }).toEqual({ bad, why: "its name ends in a dot or a space" });
		}
	});

	it("refuses device names, with or without an extension, in any case", () => {
		for (const bad of ["tables/CON.md", "tables/nul.md", "tables/Aux", "tables/com1.md", "tables/LPT9.md", "towns/prn/x.md", "tables/COM¹.md"]) {
			expect({ bad, why: packPathProblem(bad) }).toEqual({ bad, why: expect.stringMatching(/a name Windows keeps for itself/) });
		}
	});

	it("still takes ordinary names (spaces, accents, dashes, dots inside)", () => {
		for (const ok of ["tables/sea/Ships 2.md", "towns/Café du Nord.md", "tables/d6 - weather.v2.md", "tables/Console.md", "tables/Connor.md", "tables/com10.md", "quests/It's (maybe) fine!.md", "tables/a#b.md"]) {
			expect({ ok, why: packPathProblem(ok) }).toEqual({ ok, why: null });
		}
	});

	it("keeps the old unsafe-path reason for traversal and hidden parts", () => {
		for (const bad of ["../x.md", "/abs.md", "C:/x.md", "tables/../../x.md", "tables/.obsidian/x.md", "a\\b.md", "tables//x.md"]) expect(packPathProblem(bad)).toBe("unsafe path");
	});
});

describe("content packs: code other plugins run (security #12)", () => {
	it("finds Dataview JS blocks and inline queries, and Templater tags", () => {
		expect(codeInNote("# Town\n\n```dataviewjs\ndv.paragraph(1)\n```\n")).toEqual(["Dataview JS"]);
		expect(codeInNote("  ~~~ dataviewjs\nx\n~~~")).toEqual(["Dataview JS"]);
		expect(codeInNote("Gold: `$= dv.current().gold`")).toEqual(["Dataview JS"]);
		expect(codeInNote("Made <% tp.date.now() %>")).toEqual(["Templater"]);
		expect(codeInNote("<%* await tp.file.move('x') %>\n```dataviewjs\n```")).toEqual(["Dataview JS", "Templater"]);
	});

	it("leaves plain notes, plain dataview queries and lone signs alone", () => {
		expect(codeInNote("| Result | Weight |\n|---|---|\n| Wolves | 3 |")).toEqual([]);
		expect(codeInNote("```dataview\nTABLE file.name\n```")).toEqual([]);
		expect(codeInNote("Costs 5% more; 3 < 4 and 50% off <%")).toEqual([]);
		expect(codeInNote("`$` and `= x`")).toEqual([]);
	});

	it("runs in linear time on a hostile note", () => {
		const t0 = Date.now();
		codeInNote("<%".repeat(200_000) + " `$".repeat(100_000) + "\n```".repeat(50_000));
		expect(Date.now() - t0).toBeLessThan(500);
	});

	it("the import plan marks such notes and leaves out bad names with the reason", async () => {
		const pack: LoadedPack = {
			manifest: { format: 1, name: "P", description: "", madeWith: "", date: "", kinds: [] },
			inferred: true,
			files: [
				{ path: "towns/Saltwatch.md", data: enc("```dataviewjs\ndv.span(1)\n```") },
				{ path: "towns/Plain.md", data: enc("Just a town.") },
				{ path: "towns/CON.md", data: enc("x") },
				{ path: "towns/a:b.md", data: enc("x") },
			],
		};
		const plan = await planImport(pack, kinds, async () => null);
		expect(plan.items.map((i) => [i.packPath, i.code])).toEqual([["towns/Saltwatch.md", ["Dataview JS"]], ["towns/Plain.md", undefined]]);
		expect(plan.skipped).toEqual([
			{ path: "towns/CON.md", reason: '"CON.md" is a name Windows keeps for itself' },
			{ path: "towns/a:b.md", reason: "its name has characters some systems can't use" },
		]);
	});
});

describe("content packs: the import preview warns about code", () => {
	async function preview(files: { path: string; text: string }[]): Promise<FakeEl> {
		const pack: LoadedPack = {
			manifest: { format: 1, name: "P", description: "", madeWith: "", date: "", kinds: [] },
			inferred: false,
			files: files.map((f) => ({ path: f.path, data: enc(f.text) })),
		};
		const plan: ImportPlan = await planImport(pack, kinds, async () => null);
		const app = Object.assign(new App(), { loadLocalStorage: () => null, saveLocalStorage: () => {} });
		const plugin = { app, settings: {} } as unknown as HexmakerPlugin;
		const modal = new PackImportModal(plugin.app, plugin, kinds);
		const { root, el } = fakeRoot();
		const m = modal as unknown as { contentEl: HTMLElement; titleEl: HTMLElement; modalEl: HTMLElement; pack: LoadedPack; plan: ImportPlan; renderPreview(): void; steps(): unknown[] };
		m.contentEl = el;
		m.titleEl = fakeRoot().el;
		m.modalEl = fakeRoot().el;
		m.pack = pack;
		m.plan = plan;
		m.steps = () => [];
		m.renderPreview();
		return root;
	}
	const texts = (root: FakeEl, cls: string) => root.all((e) => e.classes.has(cls)).map((e) => e.text);

	it("says how many notes carry code and tags each one", async () => {
		const root = await preview([
			{ path: "towns/Saltwatch.md", text: "```dataviewjs\ndv.span(1)\n```" },
			{ path: "tables/Loot.md", text: "<% tp.file.title %>" },
			{ path: "towns/Plain.md", text: "Just a town." },
		]);
		expect(texts(root, "duckmage-pack-warning")).toEqual([
			"2 notes have Dataview JS or Templater code, which runs when the note is opened if you have that plugin. Only import code from people you trust; the notes are marked below.",
		]);
		expect(texts(root, "duckmage-pack-tag-code").sort()).toEqual(["has Dataview JS code", "has Templater code"]);
	});

	it("shows no warning for a pack without code", async () => {
		const root = await preview([{ path: "towns/Plain.md", text: "Just a town." }]);
		expect(texts(root, "duckmage-pack-warning")).toEqual([]);
		expect(texts(root, "duckmage-pack-tag-code")).toEqual([]);
	});
});

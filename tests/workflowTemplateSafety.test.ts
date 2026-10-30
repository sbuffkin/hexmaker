/**
 * Security review #1: a workflow's `template-file` is note text (it can
 * come from someone else's pack), and the workflow editor writes the
 * template back on close. Only Markdown notes under the workflows or world
 * folder are written; an unchanged template isn't written at all; and a
 * template edited elsewhere while the editor was open is never overwritten.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile, type App } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { readSource } from "./helpers/source";
import { isWritableTemplate, resolveWorkflowTemplate, resultsNotePlace, saveWorkflowTemplate, templateRoots, templateSave } from "../src/random-tables/workflowFiles";

function appOf(vault: MemVault): App {
	const app = vault.app();
	return {
		...app,
		metadataCache: {
			...app.metadataCache,
			// Link resolution: a bare name finds the first note (or file) with that name.
			getFirstLinkpathDest: (link: string) => {
				for (const p of vault.files.keys()) {
					const name = p.slice(p.lastIndexOf("/") + 1);
					if (p === link || name === link || name.replace(/\.md$/, "") === link) return app.vault.getAbstractFileByPath(p);
				}
				return null;
			},
		},
	} as unknown as App;
}

const roots = templateRoots({ worldFolder: "world", workflowsFolder: "world/workflows" });

describe("workflow templates: what may be written", () => {
	it("allows Markdown notes under the workflows or world folder only", () => {
		expect(isWritableTemplate("world/workflows/templates/Town.md", roots)).toBe(true);
		expect(isWritableTemplate("world/towns/Town template.md", roots)).toBe(true);
		expect(isWritableTemplate("Session notes.md", roots)).toBe(false);
		expect(isWritableTemplate("world/maps/coast.png", roots)).toBe(false);
		expect(isWritableTemplate("world/../Session notes.md", roots)).toBe(false);
		expect(isWritableTemplate("world/.obsidian/x.md", roots)).toBe(false);
		expect(isWritableTemplate("worldly/x.md", roots)).toBe(false);
	});

	it("a workflows folder set outside the world folder counts too; a blank one is world/workflows", () => {
		expect(isWritableTemplate("tables-wf/t.md", templateRoots({ worldFolder: "world", workflowsFolder: "tables-wf" }))).toBe(true);
		expect(templateRoots({ worldFolder: "", workflowsFolder: "" })).toEqual(["world/workflows", "world"]);
	});

	it("never resolves a template-file to an image, a PDF or a canvas", () => {
		const vault = new MemVault({ "world/maps/coast.png": "PNG", "world/workflows/Wf.md": "", "Notes.md": "hi" });
		const app = appOf(vault);
		expect(resolveWorkflowTemplate(app, "world/maps/coast.png", "world/workflows/Wf.md")).toBeNull();
		expect(resolveWorkflowTemplate(app, '"[[coast.png]]"', "world/workflows/Wf.md")).toBeNull();
		expect(resolveWorkflowTemplate(app, "Notes", "world/workflows/Wf.md")?.path).toBe("Notes.md");
	});
});

describe("workflow templates: saving on close", () => {
	it("the verdict: skip when unchanged, write when the note is as read, stale otherwise", () => {
		expect(templateSave("a", "a", "a")).toBe("skip");
		expect(templateSave("a", "a", "changed")).toBe("skip");
		expect(templateSave("a", "b", "a")).toBe("write");
		expect(templateSave("a", "b", "edited elsewhere")).toBe("stale");
		expect(templateSave("a", "b", null)).toBe("stale");
		expect(templateSave(null, "new", null)).toBe("write");
		expect(templateSave(null, "new", "made elsewhere")).toBe("stale");
	});

	it("writes nothing when the template text is what was read", async () => {
		const vault = new MemVault({ "world/workflows/templates/T.md": "## a\n$a\n" });
		const app = appOf(vault);
		const file = app.vault.getAbstractFileByPath("world/workflows/templates/T.md") as TFile;
		expect(await saveWorkflowTemplate(app, file, "## a\n$a\n", "## a\n$a\n")).toBe("skip");
		expect(vault.writes).toEqual([]);
	});

	it("writes an edited template that wasn't touched elsewhere", async () => {
		const vault = new MemVault({ "world/workflows/templates/T.md": "old" });
		const app = appOf(vault);
		const file = app.vault.getAbstractFileByPath("world/workflows/templates/T.md") as TFile;
		expect(await saveWorkflowTemplate(app, file, "old", "new")).toBe("write");
		expect(vault.files.get("world/workflows/templates/T.md")).toBe("new");
	});

	it("keeps an edit made elsewhere while the editor was open", async () => {
		const vault = new MemVault({ "world/workflows/templates/T.md": "edited in another pane" });
		const app = appOf(vault);
		const file = app.vault.getAbstractFileByPath("world/workflows/templates/T.md") as TFile;
		expect(await saveWorkflowTemplate(app, file, "old", "mine")).toBe("stale");
		expect(vault.files.get("world/workflows/templates/T.md")).toBe("edited in another pane");
		expect(vault.writes).toEqual([]);
	});

	it("re-checks inside the write: an edit landing between the read and the write wins", async () => {
		const vault = new MemVault({ "world/workflows/templates/T.md": "old" });
		const app = appOf(vault);
		const process = app.vault.process.bind(app.vault);
		app.vault.process = (async (f: TFile, fn: (c: string) => string) => {
			vault.files.set(f.path, "late edit");
			return process(f, fn);
		}) as typeof app.vault.process;
		const file = app.vault.getAbstractFileByPath("world/workflows/templates/T.md") as TFile;
		expect(await saveWorkflowTemplate(app, file, "old", "mine")).toBe("stale");
		expect(vault.files.get("world/workflows/templates/T.md")).toBe("late edit");
	});

	it("makes a new template (and its folder), but not over one made meanwhile", async () => {
		const vault = new MemVault({});
		const app = appOf(vault);
		expect(await saveWorkflowTemplate(app, "world/workflows/templates/New.md", null, "## a\n$a\n")).toBe("write");
		expect(vault.files.get("world/workflows/templates/New.md")).toBe("## a\n$a\n");
		expect(await saveWorkflowTemplate(app, "world/workflows/templates/New.md", null, "other")).toBe("stale");
		expect(vault.files.get("world/workflows/templates/New.md")).toBe("## a\n$a\n");
	});
});

describe("workflow editor wiring", () => {
	it("saves the template only through saveWorkflowTemplate, only when it may be written", () => {
		const src = readSource("src", "random-tables", "WorkflowEditorModal.ts");
		expect(src).toContain("if (templateWritable) await this.saveTemplate(");
		expect(src).toContain("saveWorkflowTemplate(this.app, target, atOpen, text)");
		// No direct template writes left in the modal.
		expect(src).not.toMatch(/vault\.process\(tmplFile/);
		expect(src).not.toMatch(/vault\.create\(templatePath/);
	});
});

describe("workflow wizard: where a result is saved (security review #9)", () => {
	const settings = { worldFolder: "world" };
	it("a results folder inside the world folder, not hidden; blank is the vault root", () => {
		expect(resultsNotePlace("world/results/", "Encounter", settings)).toEqual({ folder: "world/results", name: "Encounter" });
		expect(resultsNotePlace("", "Encounter", settings)).toEqual({ folder: "", name: "Encounter" });
		expect(resultsNotePlace("Private", "x", settings)).toEqual({ error: "Save the note inside the world folder (world)." });
		expect(resultsNotePlace("world/.obsidian", "x", settings)).toHaveProperty("error");
		expect(resultsNotePlace("world/../Private", "x", settings)).toHaveProperty("error");
	});

	it("the note name is cleaned into a file name, and required", () => {
		expect(resultsNotePlace("world/r", "../../Session: notes", settings)).toEqual({ folder: "world/r", name: "Session notes" });
		expect(resultsNotePlace("world/r", " / ", settings)).toEqual({ error: "Note name is required." });
	});

	it("the wizard saves through it", () => {
		const src = readSource("src", "random-tables", "WorkflowWizardModal.ts");
		expect(src.match(/resultsNotePlace\(this\.saveResultsFolderInput\.value, this\.saveNoteNameInput\.value, this\.plugin\.settings\)/g)).toHaveLength(2);
	});
});

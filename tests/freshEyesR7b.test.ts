import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { isLinkableNotePath, isTemplateNotePath, templateNoteRules } from "../src/templateNotes";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("R12: template notes are never offered for linking", () => {
	const rules = templateNoteRules(
		{ templatePath: "world/hextemplate.md", workflowsFolder: "world/workflows" },
		["Templates/", undefined, ""],
	);

	it("excludes the hex template, workflow templates and template folders", () => {
		expect(isTemplateNotePath("world/hextemplate.md", rules)).toBe(true);
		expect(isTemplateNotePath("World/HexTemplate.md", rules)).toBe(true);
		expect(isTemplateNotePath("world/workflows/templates/npc.md", rules)).toBe(true);
		expect(isTemplateNotePath("Templates/daily.md", rules)).toBe(true);
	});

	it("keeps ordinary world notes, including ones merely named like a template", () => {
		expect(isTemplateNotePath("world/towns/Saltmere Keep.md", rules)).toBe(false);
		expect(isTemplateNotePath("world/towns/templates of doom.md", rules)).toBe(false);
		expect(isTemplateNotePath("world/workflows/npc.md", rules)).toBe(false);
	});

	it("a hex template path without .md still matches; a blank one matches nothing", () => {
		expect(isTemplateNotePath("hex tpl.md", templateNoteRules({ templatePath: "hex tpl" }))).toBe(true);
		expect(templateNoteRules({ templatePath: "" }).paths).toEqual([]);
	});

	it("linkable = not `_`-prefixed and not a template", () => {
		expect(isLinkableNotePath("world/towns/A.md", "A", rules)).toBe(true);
		expect(isLinkableNotePath("world/towns/_draft.md", "_draft", rules)).toBe(false);
		expect(isLinkableNotePath("world/hextemplate.md", "hextemplate", rules)).toBe(false);
	});

	it("every note picker uses plugin.isLinkableNote", () => {
		for (const p of [
			["src", "hex-map", "TokenModal.ts"],
			["src", "hex-map", "HexEditorModal.ts"],
			["src", "hex-map", "FileLinkSuggestModal.ts"],
			["src", "hex-map", "FolderTreePickerModal.ts"],
			["src", "hex-table", "LinkPickerModal.ts"],
			["src", "hex-map", "FactionPickerModal.ts"],
			["src", "hex-map", "GeoRegionPickerModal.ts"],
		]) {
			expect({ file: p.join("/"), ok: /this\.plugin\.isLinkableNote\(f(, this\.purpose)?\)/.test(read(...p)) }).toEqual({ file: p.join("/"), ok: true });
		}
	});
});

describe("R12: the token form's note list picks the row actually clicked", () => {
	const src = read("src", "hex-map", "TokenModal.ts");
	it("press keeps focus; the pick happens on click, only on the pressed row", () => {
		expect(src).toMatch(/addEventListener\("mousedown", \(e\) => \{\s*e\.preventDefault\(\);\s*pressed = row;/);
		expect(src).toMatch(/const ok = e\.detail === 0 \|\| pressed === row;/);
	});
	it("re-focusing doesn't rebuild an unchanged list", () => {
		expect(src).toMatch(/if \(this\.renderedQuery !== el\.value\.trim\(\)\)/);
	});
});

describe("S13: installing a palette gives its terrains their tables", () => {
	it("installPalettePreset creates terrain tables when the vault uses them", () => {
		const src = read("src", "HexmakerPlugin.ts");
		const m = /async installPalettePreset[\s\S]*?\n {2}\}/.exec(src);
		expect(m![0]).toMatch(/await this\.ensureTerrainTables\(palette\.terrains\)/);
	});
});

describe("U15: a new stand-alone map starts on a generator", () => {
	it("the guided form picks the setup wizard's first-map generator instead of Blank", () => {
		const src = read("src", "worldgen", "NewMapSetupModal.ts");
		expect(src).toMatch(/firstMapGenerator\(fitting, enabledKinds\(this\.plugin\.settings\)\)/);
		// …but a user's own pick (incl. Blank) stays.
		expect(src).toMatch(/!this\.origin && !where\.neighbour && !this\.pickedKind && this\.kindId === BLANK_ID/);
	});
});

describe("Note pickers say what they're for (template pickers list templates)", () => {
	const rules = templateNoteRules({ templatePath: "world/hextemplate.md", workflowsFolder: "world/workflows" }, ["Templates"]);

	it("'link' (the default) hides templates; 'template' lists them", () => {
		for (const p of ["world/hextemplate.md", "world/workflows/templates/npc.md", "Templates/daily.md"]) {
			const base = p.replace(/^.*\//, "").replace(/\.md$/, "");
			expect(isLinkableNotePath(p, base, rules)).toBe(false);
			expect(isLinkableNotePath(p, base, rules, "link")).toBe(false);
			expect(isLinkableNotePath(p, base, rules, "template")).toBe(true);
		}
	});

	it("'_' notes stay hidden whatever the purpose; ordinary notes show for both", () => {
		expect(isLinkableNotePath("Templates/_wip.md", "_wip", rules, "template")).toBe(false);
		expect(isLinkableNotePath("world/towns/A.md", "A", rules, "template")).toBe(true);
		expect(isLinkableNotePath("world/towns/A.md", "A", rules, "link")).toBe(true);
	});

	it("the plugin and the general file picker take the purpose explicitly, defaulting to 'link'", () => {
		expect(read("src", "HexmakerPlugin.ts")).toMatch(/isLinkableNote\(file: TFile, purpose: NotePickPurpose = "link"\)/);
		const picker = read("src", "hex-map", "FileLinkSuggestModal.ts");
		expect(picker).toMatch(/private purpose: NotePickPurpose = "link"/);
		expect(picker).toMatch(/this\.plugin\.isLinkableNote\(f, this\.purpose\)/);
	});
});

describe("New map form: a background image can be dropped from the computer", () => {
	const src = read("src", "worldgen", "NewMapSetupModal.ts");
	it("the More section's background row is a drop zone, imported into the map's _bg folder on create", () => {
		expect(src).toMatch(/attachImageDropZone\(bgRowEl,/);
		expect(src).toMatch(/importBinaryFileToVault\(this\.plugin, this\.bgFile, mapBgImportFolder\(this\.plugin\.settings\.hexFolder, result\.name\)\)/);
	});
	it("Properties uses the same shared drop zone and folder", () => {
		const modal = read("src", "hex-map", "MapModal.ts");
		expect(modal).toMatch(/attachImageDropZone\(bgRow,/);
		expect(modal).toMatch(/mapBgImportFolder\(this\.plugin\.settings\.hexFolder, mapName\)/);
	});
	it("mapBgImportFolder is {hexFolder}/{map}/_bg", async () => {
		const { mapBgImportFolder } = await import("../src/utils");
		expect(mapBgImportFolder("world/hexes/", "test-land")).toBe("world/hexes/test-land/_bg");
		expect(mapBgImportFolder("", "test-land")).toBe("test-land/_bg");
	});
});

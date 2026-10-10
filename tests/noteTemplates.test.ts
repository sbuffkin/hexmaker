import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import {
	DEFAULT_TOWN_TEMPLATE,
	fillNoteTemplate,
	hexTemplatePathFor,
	noteTemplateFor,
	templatesFolderFor,
	townTemplatePathFor,
} from "../src/noteTemplates";
import { isLinkableNotePath, isTemplateNotePath, templateNoteRules } from "../src/templateNotes";
import { DEFAULT_SETTINGS } from "../src/constants";

/** PA3 = A + note: all plugin note templates in one user-editable folder. */
describe("templates folder (PA3)", () => {
	it("defaults to 'templates' in the world folder; the setting wins", () => {
		expect(templatesFolderFor({ worldFolder: "RPG/world" })).toBe("RPG/world/templates");
		expect(templatesFolderFor({ worldFolder: "" })).toBe("world/templates");
		expect(templatesFolderFor({ worldFolder: "RPG/world", templatesFolder: "/My Templates/" })).toBe("My Templates");
		expect(DEFAULT_SETTINGS.templatesFolder).toBe("");
	});

	it("an existing Template path is kept; blank uses hex.md in the templates folder", () => {
		expect(hexTemplatePathFor({ worldFolder: "w", templatePath: "RPG/world/hextemplate.md" })).toBe("RPG/world/hextemplate.md");
		expect(hexTemplatePathFor({ worldFolder: "w", templatePath: "tpl/hex" })).toBe("tpl/hex.md");
		expect(hexTemplatePathFor({ worldFolder: "w", templatePath: "" })).toBe("w/templates/hex.md");
		expect(townTemplatePathFor({ worldFolder: "w" })).toBe("w/templates/town.md");
		expect(townTemplatePathFor({ worldFolder: "w", templatesFolder: "T" })).toBe("T/town.md");
	});

	it("the town template is basic and open-ended, with Rumours", () => {
		expect(DEFAULT_TOWN_TEMPLATE).toMatch(/^# \{\{title\}\}/);
		expect(DEFAULT_TOWN_TEMPLATE).toMatch(/^## Rumours$/m);
		expect(DEFAULT_TOWN_TEMPLATE).toMatch(/^## Description$/m);
		// Few headings, no ### (those are hex-note link sections).
		expect((DEFAULT_TOWN_TEMPLATE.match(/^#/gm) ?? []).length).toBeLessThanOrEqual(6);
		expect(DEFAULT_TOWN_TEMPLATE).not.toMatch(/^###/m);
		expect(fillNoteTemplate(DEFAULT_TOWN_TEMPLATE, "Gullmouth")).toMatch(/^# Gullmouth\n/);
	});

	it("only Towns get a note template from the link sections", () => {
		expect(noteTemplateFor("Towns")).toBe("town");
		for (const s of ["Dungeons", "Features", "Quests", "Factions", "Encounters Table"]) expect(noteTemplateFor(s)).toBeNull();
	});

	it("notes in the templates folder are never offered for linking", () => {
		const rules = templateNoteRules({ worldFolder: "RPG/world", workflowsFolder: "RPG/world/workflows", templatePath: "" });
		expect(isTemplateNotePath("RPG/world/templates/town.md", rules)).toBe(true);
		expect(isTemplateNotePath("RPG/world/templates/hex.md", rules)).toBe(true);
		expect(isLinkableNotePath("RPG/world/templates/town.md", "town", rules)).toBe(false);
		expect(isLinkableNotePath("RPG/world/templates/town.md", "town", rules, "template")).toBe(true);
		expect(isTemplateNotePath("RPG/world/towns/Gullmouth.md", rules)).toBe(false);
	});

	it("new town notes from the hex editor and link pickers use the town template", () => {
		const editor = readFileSync("src/hex-map/HexEditorModal.ts", "utf8");
		expect(editor).toContain("this.plugin.newLinkedNoteContent(section, name)");
		const picker = readFileSync("src/hex-table/LinkPickerModal.ts", "utf8");
		expect(picker).toContain("this.plugin.newLinkedNoteContent(this.section, name)");
	});

	it("the Templates folder setting is in both settings paths", () => {
		const tab = readFileSync("src/HexmakerSettingTab.ts", "utf8");
		expect(tab).toMatch(/folderText\(\s*"Templates folder",\s*"templatesFolder"/);
		expect(tab).toContain('.setName("Templates folder")');
	});
});

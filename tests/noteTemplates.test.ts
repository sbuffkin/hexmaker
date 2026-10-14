import { describe, it } from "node:test";
import expect from "expect";
import {
	DEFAULT_TOWN_TEMPLATE,
	fillNoteTemplate,
	hexTemplatePathFor,
	LINK_NOTE_TEMPLATES,
	linkNoteTemplate,
	linkNoteTemplatePathFor,
	noteTemplateFor,
	templatesFolderFor,
	townTemplatePathFor,
} from "../src/noteTemplates";
import { isLinkableNotePath, isTemplateNotePath, templateNoteRules } from "../src/templateNotes";
import { DEFAULT_SETTINGS } from "../src/constants";
import { readSurface } from "./helpers/source";

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

	it("every place-like link section gets its own note template, the same way (F17)", () => {
		expect(noteTemplateFor("Towns")).toBe("town");
		expect(noteTemplateFor("Dungeons")).toBe("dungeon");
		expect(noteTemplateFor("features")).toBe("feature");
		expect(noteTemplateFor("Quests")).toBe("quest");
		expect(noteTemplateFor("Factions")).toBe("faction");
		// A new encounter table is a table, not a note template.
		expect(noteTemplateFor("Encounters Table")).toBeNull();
		expect(linkNoteTemplatePathFor({ worldFolder: "w" }, "Dungeons")).toBe("w/templates/dungeon.md");
		expect(linkNoteTemplatePathFor({ worldFolder: "w", templatesFolder: "T" }, "Towns")).toBe("T/town.md");
		expect(linkNoteTemplatePathFor({ worldFolder: "w" }, "Encounters Table")).toBeNull();
		for (const [section, t] of Object.entries(LINK_NOTE_TEMPLATES)) {
			expect(fillNoteTemplate(t.starter, "X")).toMatch(/^# X\n/);
			expect(t.starter).not.toMatch(/^###/m);
			expect(linkNoteTemplate(section)).toBe(t);
		}
		// No branch on a section name: the plugin looks the template up.
		const plugin = readSurface("plugin");
		const body = plugin.slice(plugin.indexOf("async newLinkedNoteContent("), plugin.indexOf("withHexLocation(content: string"));
		expect(body).toContain("linkNoteTemplate(section)");
		expect(body).not.toMatch(/"Towns"|"Dungeons"/);
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
		const editor = readSurface("hex-editor");
		// …and say which hex they're in (a Location line, R3).
		expect(editor).toContain("this.plugin.newLinkedNoteContent(section, name, path)");
		const picker = readSurface("link-picker");
		expect(picker).toContain("this.plugin.newLinkedNoteContent(this.linkSection, name, this.hexPath)");
	});

	it("the Templates folder setting is in both settings paths", () => {
		const tab = readSurface("settings-tab");
		expect(tab).toMatch(/folderText\(\s*"Templates folder",\s*"templatesFolder"/);
		// The pre-1.13 page draws the same definitions (display → renderDefinitions).
		expect(tab).toContain("this.renderDefinitions(containerEl, this.getSettingDefinitions())");
	});
});

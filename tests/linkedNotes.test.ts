/**
 * Cleanup P3: "create a note and link it into a hex section" lives once,
 * in HexNotesService (createLinkedNote / linkNoteToHex / createAndLinkNote),
 * used by the hex editor's link sections, its table picker and the hex
 * table's LinkPickerModal. The picker used to make a missing hex note with
 * vault.create(path, ""), so it had no template and no map link; it now
 * goes through plugin.createHexNote like the editor.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile, type App } from "obsidian";
import { MemVault } from "./helpers/memVault";
import { readSource, readSurface } from "./helpers/source";
import { HexNotesService } from "../src/services/HexNotesService";
import { LinkPickerModal } from "../src/hex-table/LinkPickerModal";
import type HexmakerPlugin from "../src/HexmakerPlugin";

const HEX_TEMPLATE = "---\nmap: \"[[_coast]]\"\n---\n# Hex {{x}}, {{y}}\n\n### Towns\n\n### Encounters Table\n";

function setup(files: Record<string, string> = {}) {
	const vault = new MemVault(files);
	const base = vault.app();
	const app = {
		...base,
		metadataCache: {
			...base.metadataCache,
			fileToLinktext: (f: TFile) => f.path.replace(/\.md$/, ""),
			getFirstLinkpathDest: () => null,
		},
	} as unknown as App;
	const made: string[] = [];
	const plugin = {
		app,
		settings: { hexFolder: "world/hexes" },
		hexPath: (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`,
		// The real one fills the template, adds the map link and the hex's properties.
		createHexNote: async (x: number, y: number, map: string) => {
			made.push(`${map}:${x},${y}`);
			return (await app.vault.create(`world/hexes/${map}/${x}_${y}.md`, HEX_TEMPLATE.replace("{{x}}", String(x)).replace("{{y}}", String(y)))) as TFile;
		},
		hexLinkAlias: () => "coast 1, 2",
		withHexLocation: (content: string, hexPath: string) => `${content}Location: [[${hexPath}]]\n`,
		newLinkedNoteContent: async (section: string, title: string) => `# ${title}\n(${section} template)\n`,
	} as unknown as HexmakerPlugin & { hexNotes: HexNotesService };
	const service = new HexNotesService(plugin);
	(plugin as { hexNotes: HexNotesService }).hexNotes = service;
	return { vault, app, plugin, service, made };
}

describe("HexNotesService: linked notes", () => {
	it("creates the note from the section's template, makes the hex note from the hex template, links both ways", async () => {
		const { vault, service, made } = setup();
		const link = await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Towns", folder: "world/towns", name: "Brindle" });
		expect(link).toBe("world/towns/Brindle");
		expect(vault.files.get("world/towns/Brindle.md")).toMatch(/^# Brindle\n\(Towns template\)\n/);
		expect(made).toEqual(["coast:1,2"]);
		const hex = vault.files.get("world/hexes/coast/1_2.md")!;
		expect(hex).toMatch(/^---\nmap: "\[\[_coast\]\]"\n---\n# Hex 1, 2/);
		expect(hex).toMatch(/### Towns\n\n\[\[world\/towns\/Brindle\]\]/);
		// The backlink to the hex.
		expect(vault.files.get("world/towns/Brindle.md")).toContain("world/hexes/coast/1_2");
	});

	it("reuses an existing note and an existing hex note", async () => {
		const { vault, service, made } = setup({ "world/towns/Brindle.md": "# Brindle\nmine\n", "world/hexes/coast/1_2.md": "# Hex\n\n### Towns\n" });
		await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Towns", folder: "world/towns", name: "Brindle" });
		expect(made).toEqual([]);
		expect(vault.files.get("world/towns/Brindle.md")).toMatch(/^# Brindle\nmine\n/);
		expect(vault.files.get("world/hexes/coast/1_2.md")).toContain("[[world/towns/Brindle]]");
	});

	it("a caller's template is used as given; a place made from a hex gets its Location line", async () => {
		const { vault, service } = setup();
		await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Encounters Table", folder: "world/tables", name: "Coast", template: "| d6 | Result |\n" });
		expect(vault.files.get("world/tables/Coast.md")).toMatch(/^\| d6 \| Result \|\n/);
		await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Towns", folder: "world/towns", name: "Port", template: "# Port\n" });
		expect(vault.files.get("world/towns/Port.md")).toMatch(/^# Port\nLocation: \[\[world\/hexes\/coast\/1_2.md\]\]/);
	});

	it("a typed name is cleaned into a file name, so it can't reach another folder", async () => {
		const { vault, service } = setup();
		await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Towns", folder: "world/towns", name: "../../Session notes" });
		expect(vault.files.has("world/towns/Session notes.md")).toBe(true);
		expect([...vault.files.keys()].every((p) => p.startsWith("world/"))).toBe(true);
		expect(await service.createAndLinkNote({ x: 1, y: 2, mapName: "coast", section: "Towns", folder: "world/towns", name: " / " })).toBeNull();
	});

	it("links nothing when the hex note can't be made", async () => {
		const { vault, plugin, service } = setup({ "world/towns/A.md": "# A\n" });
		(plugin as unknown as { createHexNote: () => Promise<null> }).createHexNote = async () => null;
		const a = vault.app().vault.getAbstractFileByPath("world/towns/A.md") as TFile;
		expect(await service.linkNoteToHex(a, 3, 3, "coast", "Towns")).toBeNull();
		expect(vault.files.get("world/towns/A.md")).toBe("# A\n");
	});
});

describe("LinkPickerModal (hex table) goes through the service", () => {
	it("picking a note for a hex without a note makes it from the hex template, not an empty note", async () => {
		const { vault, app, plugin, made } = setup({ "world/towns/Brindle.md": "# Brindle\n" });
		let linked = 0;
		const modal = new LinkPickerModal(app, plugin, { x: 4, y: 5, mapName: "coast" }, "Towns", "world/towns", () => linked++);
		(modal as unknown as { close(): void }).close = () => {};
		const file = app.vault.getAbstractFileByPath("world/towns/Brindle.md") as TFile;
		await (modal as unknown as { addLink(f: TFile): Promise<void> }).addLink(file);
		expect(made).toEqual(["coast:4,5"]);
		expect(vault.files.get("world/hexes/coast/4_5.md")).toMatch(/^---\nmap: "\[\[_coast\]\]"\n---\n# Hex 4, 5[\s\S]*### Towns\n\n\[\[world\/towns\/Brindle\]\]/);
		expect(linked).toBe(1);
	});

	it("Create makes the note with the picker's template and links it", async () => {
		const { vault, app, plugin } = setup();
		const modal = new LinkPickerModal(app, plugin, { x: 1, y: 1, mapName: "coast" }, "Encounters Table", "world/tables", () => {}, "| d6 | Result | Weight |\n");
		(modal as unknown as { close(): void }).close = () => {};
		await (modal as unknown as { createAndLink(n: string): Promise<void> }).createAndLink("Shore");
		expect(vault.files.get("world/tables/Shore.md")).toMatch(/^\| d6 \| Result \| Weight \|\n/);
		expect(vault.files.get("world/hexes/coast/1_1.md")).toContain("[[world/tables/Shore]]");
	});

	it("no picker or section writes hex notes or creates linked notes itself any more", () => {
		const picker = readSource("src", "hex-table", "LinkPickerModal.ts");
		expect(picker).not.toMatch(/vault\.create\(/);
		expect(picker).not.toMatch(/createFolder/);
		const editor = readSurface("hex-editor");
		expect(editor).toContain("this.plugin.hexNotes.createAndLinkNote(");
		expect(editor).toContain("this.plugin.hexNotes.linkNoteToHex(");
		expect(editor).toContain("this.plugin.hexNotes.createLinkedNote(\"Encounters Table\"");
		expect(readSource("src", "hex-map", "editor", "LinkSection.ts")).not.toMatch(/vault\.create\(/);
	});
});

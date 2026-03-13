import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import {
	addLinkToSection,
	removeLinkFromSection,
	getLinksInSection,
	getSectionContent,
	getAllSectionData,
	setSectionContent,
} from "../src/sections";

/** Build a minimal mock App backed by an in-memory string. */
function makeApp(filePath: string, initialContent: string) {
	let stored = initialContent;

	const file = Object.create(TFile.prototype) as TFile;
	file.path = filePath;

	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === filePath ? file : null),
			read: vi.fn(async () => stored),
			modify: vi.fn(async (_f: unknown, content: string) => { stored = content; }),
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
			getFirstLinkpathDest: vi.fn(() => null),
			fileToLinktext: vi.fn((f: TFile) => f.path),
		},
	} as unknown as import("obsidian").App;

	return { app, getContent: () => stored };
}

// ── addLinkToSection ──────────────────────────────────────────────────────────

describe("addLinkToSection", () => {
	it("appends a link under an existing section", async () => {
		const { app, getContent } = makeApp("hex.md", "### Towns\n\n[[Riverdale]]\n");
		await addLinkToSection(app, "hex.md", "Towns", "[[Millhaven]]");
		expect(getContent()).toContain("[[Millhaven]]");
		expect(getContent()).toContain("[[Riverdale]]");
	});

	it("creates the section when it does not exist", async () => {
		const { app, getContent } = makeApp("hex.md", "Some content.");
		await addLinkToSection(app, "hex.md", "Towns", "[[Newtown]]");
		expect(getContent()).toContain("### Towns");
		expect(getContent()).toContain("[[Newtown]]");
	});

	it("does not add a duplicate link", async () => {
		const { app, getContent } = makeApp("hex.md", "### Towns\n\n[[Riverdale]]\n");
		await addLinkToSection(app, "hex.md", "Towns", "[[Riverdale]]");
		const count = (getContent().match(/\[\[Riverdale\]\]/g) ?? []).length;
		expect(count).toBe(1);
	});

	it("does not modify other sections", async () => {
		const { app, getContent } = makeApp("hex.md", "### Dungeons\n\n[[Cave]]\n\n### Towns\n\n");
		await addLinkToSection(app, "hex.md", "Towns", "[[Village]]");
		expect(getContent()).toContain("[[Cave]]");
	});

	it("is a no-op when file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		// Should not throw
		await expect(addLinkToSection(app, "MISSING.md", "Towns", "[[X]]")).resolves.toBeUndefined();
	});
});

// ── removeLinkFromSection ─────────────────────────────────────────────────────

describe("removeLinkFromSection", () => {
	it("removes an existing link from a section", async () => {
		const { app, getContent } = makeApp("hex.md", "### Towns\n\n[[Riverdale]]\n[[Millhaven]]\n");
		await removeLinkFromSection(app, "hex.md", "Towns", "Riverdale");
		expect(getContent()).not.toContain("[[Riverdale]]");
		expect(getContent()).toContain("[[Millhaven]]");
	});

	it("is a no-op when the link is not present", async () => {
		const original = "### Towns\n\n[[Millhaven]]\n";
		const { app, getContent } = makeApp("hex.md", original);
		await removeLinkFromSection(app, "hex.md", "Towns", "Missing");
		expect(getContent()).toBe(original);
	});

	it("is a no-op when the section does not exist", async () => {
		const original = "### Dungeons\n\n[[Cave]]\n";
		const { app, getContent } = makeApp("hex.md", original);
		await removeLinkFromSection(app, "hex.md", "Towns", "Cave");
		expect(getContent()).toBe(original);
	});

	it("does not remove a link from a different section", async () => {
		const { app, getContent } = makeApp("hex.md", "### Towns\n\n[[Village]]\n\n### Dungeons\n\n[[Village]]\n");
		await removeLinkFromSection(app, "hex.md", "Towns", "Village");
		// Link in Dungeons should survive
		expect(getContent()).toContain("### Dungeons");
		const dungeonSection = getContent().split("### Dungeons")[1];
		expect(dungeonSection).toContain("[[Village]]");
	});
});

// ── getLinksInSection ─────────────────────────────────────────────────────────

describe("getLinksInSection", () => {
	it("returns all wiki-links in the section", async () => {
		const { app } = makeApp("hex.md", "### Towns\n\n[[Riverdale]]\n[[Millhaven]]\n");
		const links = await getLinksInSection(app, "hex.md", "Towns");
		expect(links).toEqual(["Riverdale", "Millhaven"]);
	});

	it("returns empty array when section has no links", async () => {
		const { app } = makeApp("hex.md", "### Towns\n\nJust text, no links.\n");
		const links = await getLinksInSection(app, "hex.md", "Towns");
		expect(links).toEqual([]);
	});

	it("returns empty array when section does not exist", async () => {
		const { app } = makeApp("hex.md", "### Dungeons\n\n[[Cave]]\n");
		const links = await getLinksInSection(app, "hex.md", "Towns");
		expect(links).toEqual([]);
	});

	it("returns empty array when file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		const links = await getLinksInSection(app, "MISSING.md", "Towns");
		expect(links).toEqual([]);
	});

	it("handles links with display text (pipe syntax)", async () => {
		const { app } = makeApp("hex.md", "### Towns\n\n[[path/to/Town|Town Name]]\n");
		const links = await getLinksInSection(app, "hex.md", "Towns");
		expect(links).toEqual(["path/to/Town"]);
	});

	it("stops at the next heading", async () => {
		const { app } = makeApp("hex.md", "### Towns\n\n[[A]]\n\n### Dungeons\n\n[[B]]\n");
		const links = await getLinksInSection(app, "hex.md", "Towns");
		expect(links).toEqual(["A"]);
	});
});

// ── getSectionContent ─────────────────────────────────────────────────────────

describe("getSectionContent", () => {
	it("returns the trimmed body of a section", async () => {
		const { app } = makeApp("hex.md", "### Description\n\nA misty valley.\n");
		const content = await getSectionContent(app, "hex.md", "Description");
		expect(content).toBe("A misty valley.");
	});

	it("returns empty string when section does not exist", async () => {
		const { app } = makeApp("hex.md", "### Other\n\nSomething\n");
		const content = await getSectionContent(app, "hex.md", "Description");
		expect(content).toBe("");
	});

	it("returns empty string when file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		const content = await getSectionContent(app, "MISSING.md", "Description");
		expect(content).toBe("");
	});

	it("stops at the next heading", async () => {
		const { app } = makeApp("hex.md", "### Description\n\nLine one.\n\n### Notes\n\nLine two.\n");
		const content = await getSectionContent(app, "hex.md", "Description");
		expect(content).toBe("Line one.");
		expect(content).not.toContain("Line two");
	});

	it("stops at a horizontal rule", async () => {
		const { app } = makeApp("hex.md", "### Description\n\nBefore rule.\n\n---\n\nAfter rule.\n");
		const content = await getSectionContent(app, "hex.md", "Description");
		expect(content).toBe("Before rule.");
	});
});

// ── getAllSectionData ─────────────────────────────────────────────────────────

describe("getAllSectionData", () => {
	it("returns empty maps for a file with no sections", async () => {
		const { app } = makeApp("hex.md", "Just prose, no headings.");
		const { text, links } = await getAllSectionData(app, "hex.md");
		expect(text.size).toBe(0);
		expect(links.size).toBe(0);
	});

	it("returns empty maps when file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		const { text, links } = await getAllSectionData(app, "MISSING.md");
		expect(text.size).toBe(0);
		expect(links.size).toBe(0);
	});

	it("captures text and links from multiple sections", async () => {
		const content = [
			"### Description",
			"",
			"Foggy mountains.",
			"",
			"### Towns",
			"",
			"[[Riverdale]]",
			"[[Millhaven]]",
		].join("\n");
		const { app } = makeApp("hex.md", content);
		const { text, links } = await getAllSectionData(app, "hex.md");

		expect(text.get("description")).toBe("Foggy mountains.");
		expect(links.get("towns")).toEqual(["Riverdale", "Millhaven"]);
	});

	it("uses lowercase keys for section names", async () => {
		const { app } = makeApp("hex.md", "### My Section\n\nHello.\n");
		const { text } = await getAllSectionData(app, "hex.md");
		expect(text.has("my section")).toBe(true);
	});
});

// ── setSectionContent ─────────────────────────────────────────────────────────

describe("setSectionContent", () => {
	it("replaces the body of an existing section", async () => {
		const { app, getContent } = makeApp("hex.md", "### Description\n\nOld text.\n");
		await setSectionContent(app, "hex.md", "Description", "New text.");
		expect(getContent()).toContain("New text.");
		expect(getContent()).not.toContain("Old text.");
	});

	it("creates the section when it does not exist", async () => {
		const { app, getContent } = makeApp("hex.md", "Some content.");
		await setSectionContent(app, "hex.md", "Notes", "My note.");
		expect(getContent()).toContain("### Notes");
		expect(getContent()).toContain("My note.");
	});

	it("clears section body when new text is empty", async () => {
		const { app, getContent } = makeApp("hex.md", "### Description\n\nOld text.\n");
		await setSectionContent(app, "hex.md", "Description", "");
		expect(getContent()).not.toContain("Old text.");
	});

	it("does not create a section for empty new text", async () => {
		const original = "No sections here.";
		const { app, getContent } = makeApp("hex.md", original);
		await setSectionContent(app, "hex.md", "Notes", "");
		expect(getContent()).toBe(original);
	});

	it("does not affect adjacent sections", async () => {
		const { app, getContent } = makeApp("hex.md",
			"### Description\n\nOld.\n\n### Towns\n\n[[A]]\n",
		);
		await setSectionContent(app, "hex.md", "Description", "Updated.");
		expect(getContent()).toContain("### Towns");
		expect(getContent()).toContain("[[A]]");
	});

	it("is a no-op when file does not exist", async () => {
		const { app } = makeApp("hex.md", "");
		await expect(setSectionContent(app, "MISSING.md", "Description", "text")).resolves.toBeUndefined();
	});
});

/**
 * Link/text section heading levels (fresh-eyes 2026-10-13 F1, owner MG3).
 *
 * 1.5.6 read and wrote only "###" sections. This build also reads "##" to
 * "######" (a hand-written "## Encounters" is the Encounters Table), but a
 * note 1.5.6 read correctly must read identically: the plugin's "###"
 * heading wins over the same section at another level, and a section ends at
 * the next heading of any level (so "## Dungeons" never swallows the "###"
 * sections below it).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import {
	findSectionHeading,
	getAllSectionData,
	insertLinkInSection,
	replaceSectionText,
	sectionText,
} from "../src/sections";
import { linksBySection, type LinkCacheLike } from "../src/hex-map/linkBadges";
import { LINK_SECTIONS } from "../src/types";

/**
 * The seed vault's Slattville hex (the-coast 12_10), prose shortened: an
 * old hand-made template's lowercase "###" sections, then a hand-written
 * "## Towns" / "## Dungeons", then the plugin's own "###" link sections.
 */
const SLATTVILLE = [
	"---",
	"terrain: beach",
	"icon: I_Town.png",
	"region: Coasts",
	"---",
	"",
	"# Location X,Y",
	"",
	"**Region:**  ",
	"**Terrain:** *(woods / marsh / beach)*",
	"",
	"---",
	"",
	"### description",
	"",
	"[[Slattville]] is here. A town of reeds and stilts.",
	"",
	"---",
	"",
	"### landmark",
	"",
	"A massive glittering lighthouse.",
	"",
	"---",
	"",
	"### settlements & points of interest",
	"",
	"Links to settlements or named locations in this hex.  ",
	"",
	"---",
	"",
	"### hidden",
	"",
	"Davy Jones' locker is deep below the waves.",
	"",
	"---",
	"",
	"### encounters",
	"",
	"- **Table:** *(terrain from world/encounters)*",
	"",
	"---",
	"",
	"### factions & control",
	"",
	"Who holds sway.",
	"",
	"---",
	"",
	"### hooks & rumors",
	"",
	"",
	"",
	"## Towns",
	"",
	"[[Shoredunn]]",
	"",
	"## Dungeons",
	"",
	"[[basin spire]]",
	"",
	"### Towns",
	"",
	"",
	"[[Slattville]]",
	"### Dungeons",
	"",
	"### Features",
	"",
	"### Encounters Table",
	"",
	"[[RPG/duckmage/tables/terrain/encounters/beach]]",
	"",
	"[[RPG/duckmage/tables/regions/Coasts]]",
	"### Factions",
	"",
	"[[Cathedral of the Depths]]",
	"",
	"[[RPG/duckmage/factions/Shipsmen]]",
	"",
].join("\n");

/** A custom template that uses "##" for the plugin's sections. */
const HASH2_TEMPLATE = [
	"# 4_5",
	"",
	"## Description",
	"Rolling hills.",
	"",
	"## Towns",
	"[[Brindle]]",
	"",
	"## Dungeons",
	"[[The Pit]]",
	"",
	"## Factions",
	"[[Red Hand]]",
	"",
].join("\n");

/** The plain released template shape. */
const PLAIN = [
	"# 1_1",
	"",
	"### Description",
	"Flat land.",
	"",
	"---",
	"",
	"### Towns",
	"",
	"[[Millhaven]]",
	"",
	"---",
	"",
	"### Dungeons",
	"",
	"[[Cave]]",
	"#### Notes",
	"[[Not in dungeons]]",
	"",
].join("\n");

/** 1.5.6's getLinksInSection, verbatim apart from taking text (tag 1.5.6, src/sections.ts). */
function links156(content: string, section: string): string[] {
	const esc = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`^###\\s+${esc}\\s*$`, "mi").exec(content);
	if (!match) return [];
	const afterHeading = match.index + match[0].length;
	const next = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const body = content.slice(afterHeading, next ? afterHeading + next.index : content.length);
	const out: string[] = [];
	const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) out.push(m[1]);
	return out;
}

/** 1.5.6's getAllSectionData text map (tag 1.5.6): every ### heading, lowercased. */
function text156(content: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /^###\s+(.+?)\s*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const after = m.index + m[0].length;
		const next = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(after));
		out.set(m[1].toLowerCase(), content.slice(after, next ? after + next.index : content.length).trim());
	}
	return out;
}

function appWith(path: string, content: string) {
	const file = Object.create(TFile.prototype) as TFile;
	file.path = path;
	return {
		vault: { getAbstractFileByPath: (p: string) => (p === path ? file : null), read: async () => content },
	} as unknown as import("obsidian").App;
}

/** A metadata cache shaped like Obsidian's (headings + links with offsets). */
function cacheOf(md: string): LinkCacheLike {
	const headings: NonNullable<LinkCacheLike["headings"]> = [];
	const links: NonNullable<LinkCacheLike["links"]> = [];
	let offset = 0;
	for (const line of md.split("\n")) {
		const h = /^(#{1,6})\s+(.*)$/.exec(line);
		if (h) headings.push({ heading: h[2], level: h[1].length, position: { start: { offset } } });
		const re = /\[\[([^\]|]+)\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line))) links.push({ link: m[1], position: { start: { offset: offset + m.index } } });
		offset += line.length + 1;
	}
	return { headings, links };
}

describe("section heading levels: Slattville (1.5.6 note with ## and ### Towns)", () => {
	it("reads every link section exactly as 1.5.6 did", async () => {
		const { links } = await getAllSectionData(appWith("h.md", SLATTVILLE), "h.md");
		for (const s of LINK_SECTIONS) {
			expect({ s, links: links.get(s.toLowerCase()) ?? [] }).toEqual({ s, links: links156(SLATTVILLE, s) });
		}
		expect(links.get("towns")).toEqual(["Slattville"]);
		expect(links.get("dungeons")).toEqual([]);
	});

	it("reads every ### text section exactly as 1.5.6 did", async () => {
		const { text } = await getAllSectionData(appWith("h.md", SLATTVILLE), "h.md");
		for (const [key, body] of text156(SLATTVILLE)) {
			if (key === "towns" || key === "dungeons" || key === "features" || key === "factions" || key === "encounters table") continue;
			expect({ key, text: text.get(key) }).toEqual({ key, text: body });
		}
	});

	it("doesn't show the hand-written ## Towns as a second Towns section", async () => {
		const { headings } = await getAllSectionData(appWith("h.md", SLATTVILLE), "h.md");
		expect(headings.get("towns")).toBe("Towns");
		expect([...headings.values()].filter((h) => h.toLowerCase() === "towns")).toHaveLength(1);
	});

	it("writes a link under the plugin's ### Dungeons and leaves ## Dungeons as written", () => {
		const out = insertLinkInSection(SLATTVILLE, "Dungeons", "[[Sunken Vault]]");
		expect(links156(out, "Dungeons")).toEqual(["Sunken Vault"]);
		expect(out).toContain("## Dungeons\n\n[[basin spire]]\n\n### Towns");
		expect(out.indexOf("[[Sunken Vault]]")).toBeGreaterThan(out.indexOf("### Dungeons"));
	});

	it("the hover/badges read the same sections as the editor", () => {
		const by = linksBySection(cacheOf(SLATTVILLE));
		expect(by.get("Towns")).toEqual(["Slattville"]);
		expect(by.has("Dungeons")).toBe(false);
		expect(by.get("Factions")).toEqual(["Cathedral of the Depths", "Shipsmen"]);
	});
});

describe("section heading levels: custom template with ## headings", () => {
	it("reads the ## sections (no ### copy exists)", async () => {
		const { links, text } = await getAllSectionData(appWith("h.md", HASH2_TEMPLATE), "h.md");
		expect(links.get("towns")).toEqual(["Brindle"]);
		expect(links.get("dungeons")).toEqual(["The Pit"]);
		expect(links.get("factions")).toEqual(["Red Hand"]);
		expect(text.get("description")).toBe("Rolling hills.");
	});

	it("writes into the ## section rather than appending a ### duplicate", () => {
		const out = insertLinkInSection(HASH2_TEMPLATE, "Towns", "[[Oakvale]]");
		expect(out).not.toContain("### Towns");
		expect(out).toMatch(/## Towns\n\[\[Brindle\]\]\n\n\[\[Oakvale\]\]\n\n## Dungeons/);
		const t = replaceSectionText(HASH2_TEMPLATE, "Description", "Steep hills.");
		expect(sectionText(t, "Description")).toBe("Steep hills.");
		expect(t).toContain("## Towns\n[[Brindle]]");
	});

	it("once a ### copy exists (1.5.6 appended one), the ### one wins", () => {
		const withCopy = HASH2_TEMPLATE + "\n### Towns\n\n[[Appended]]\n";
		expect(findSectionHeading(withCopy, "Towns")?.level).toBe(3);
		expect(links156(withCopy, "Towns")).toEqual(["Appended"]);
	});

	it("badges read the ## sections and stop at the next one", () => {
		const by = linksBySection(cacheOf(HASH2_TEMPLATE));
		expect(by.get("Towns")).toEqual(["Brindle"]);
		expect(by.get("Dungeons")).toEqual(["The Pit"]);
	});

	it("a ## section ends at a ### plugin section below it (badges)", () => {
		const md = ["# 1_1", "## Dungeons", "[[Pit]]", "### Towns", "[[Brindle]]", "### Factions", "[[Red Hand]]"].join("\n");
		const by = linksBySection(cacheOf(md));
		expect(by.get("Dungeons")).toEqual(["Pit"]);
		expect(by.get("Towns")).toEqual(["Brindle"]);
	});
});

describe("section heading levels: plain ### note", () => {
	it("reads like 1.5.6, including stopping at a #### subheading", async () => {
		const { links, text } = await getAllSectionData(appWith("h.md", PLAIN), "h.md");
		for (const s of LINK_SECTIONS) expect(links.get(s.toLowerCase()) ?? []).toEqual(links156(PLAIN, s));
		expect(links.get("dungeons")).toEqual(["Cave"]);
		expect(text.get("description")).toBe(text156(PLAIN).get("description"));
	});

	it("a section write never replaces a #### subsection inside it", () => {
		const out = replaceSectionText(PLAIN, "Dungeons", "[[Other]]");
		expect(out).toContain("#### Notes\n[[Not in dungeons]]");
	});
});

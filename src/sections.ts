import { App, TFile } from "obsidian";
import { splitGuidance } from "./hexGuidance";

/**
 * Other names people give the plugin's sections. A note's own heading is
 * matched to a section by these, in any case, at any heading level from ##
 * to ###### (# is the note's title), with a trailing colon or "and" for "&"
 * allowed, so a hand-written "## Encounters" or "#### Rumours:" is the
 * section the plugin shows and writes to, not a duplicate it appends.
 */
const SECTION_ALIASES: Record<string, string[]> = {
	"encounters table": ["encounters", "encounter table", "encounter", "random encounters"],
	"hooks & rumors": ["hooks & rumours", "rumors", "rumours", "hooks", "rumors & hooks", "rumours & hooks"],
	"description": ["desc"],
	"landmark": ["landmarks"],
	"towns": ["town", "settlements", "settlement"],
	"dungeons": ["dungeon"],
	"features": ["feature"],
	"quests": ["quest"],
	"factions": ["faction"],
};

const normalizeHeading = (s: string): string =>
	s.trim().replace(/[:：]+$/, "").replace(/\s+and\s+/gi, " & ").replace(/\s+/g, " ").toLowerCase();

const ALIAS_TO_SECTION = new Map<string, string>();
for (const [section, aliases] of Object.entries(SECTION_ALIASES)) for (const a of aliases) ALIAS_TO_SECTION.set(a, section);

/** The section a heading names: one of the plugin's (by alias) or the heading itself, lowercased. */
export function canonicalSection(heading: string): string {
	const h = normalizeHeading(heading);
	return ALIAS_TO_SECTION.get(h) ?? h;
}

const HEADING = /^(#{2,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

interface HeadingMatch {
	/** Offset of the heading line. */
	index: number;
	/** Offset just past the heading text (where the section body starts). */
	end: number;
	/** The heading as written. */
	text: string;
}

/** Every section heading in the note (## to ######), in order. */
export function sectionHeadings(content: string): HeadingMatch[] {
	const out: HeadingMatch[] = [];
	const re = new RegExp(HEADING.source, "gm");
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) out.push({ index: m.index, end: m.index + m[0].length, text: m[2] });
	return out;
}

/** The first heading naming `section` (see canonicalSection), or null. */
export function findSectionHeading(content: string, section: string): HeadingMatch | null {
	const want = canonicalSection(section);
	return sectionHeadings(content).find((h) => canonicalSection(h.text) === want) ?? null;
}

/** Where a section's body ends: the next heading of any level, a --- rule, or the end. */
function sectionEndAfter(content: string, afterHeading: number): number {
	const next = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	return next ? afterHeading + next.index : content.length;
}

/** Insert a wiki-link under the named ### section, creating the section if absent. */
export async function addLinkToSection(app: App, filePath: string, section: string, linkText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => insertLinkInSection(content, section, linkText));
}

/**
 * Note text with `linkText` added under the "### section" heading (the
 * heading is appended if missing). Unchanged if the link is already there.
 */
export function insertLinkInSection(content: string, section: string, linkText: string): string {
	const match = findSectionHeading(content, section);
	if (!match) {
		return separateRulesFromText(content.trimEnd() + `\n\n### ${section}\n\n${linkText}\n`);
	}
	const afterHeading = match.end;
	const nextBoundaryMatch = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundaryMatch ? afterHeading + nextBoundaryMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);
	if (sectionContent.includes(linkText)) return separateRulesFromText(content);
	const trimmedSection = sectionContent.trimEnd();
	const insertAt = afterHeading + trimmedSection.length;
	// One blank line above the link (the heading match can swallow a newline
	// of an empty section); the template's `---` usually follows the link,
	// so keep a blank line before it too.
	const before = content.slice(0, insertAt).replace(/[\r\n]+$/, "");
	return separateRulesFromText(before + "\n\n" + linkText + content.slice(insertAt));
}

/**
 * Text directly above a `---` rule renders as a big setext heading in
 * Markdown (fresh-eyes round 5: a Dungeons link written just above the hex
 * template's rule showed as a heading). Puts a blank line between a text
 * line and a following rule. Frontmatter and fenced code are left alone.
 * Every section writer runs this, so older notes heal on their next write.
 */
export function separateRulesFromText(content: string): string {
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const isRule = (l: string) => /^ {0,3}-{3,}\s*$/.test(l);
	let start = 0;
	if (lines.length > 1 && lines[0].trim() === "---") {
		const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
		if (close > 0) start = close + 1;
	}
	const out = lines.slice(0, start);
	let inFence = false;
	let changed = false;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		if (/^ {0,3}(```|~~~)/.test(line)) inFence = !inFence;
		else if (!inFence && i > start && isRule(line)) {
			const prev = lines[i - 1];
			if (prev.trim() !== "" && !/^ {0,3}#{1,6}(\s|$)/.test(prev) && !isRule(prev)) {
				out.push("");
				changed = true;
			}
		}
		out.push(line);
	}
	return changed ? out.join(eol) : content;
}

/** Remove a wiki-link from under the named ### section. Removes the whole line containing it. */
export async function removeLinkFromSection(app: App, filePath: string, section: string, linkTarget: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => {
		const match = findSectionHeading(content, section);
		if (!match) return content;
		const afterHeading = match.end;
		const nextBoundaryMatch = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundaryMatch ? afterHeading + nextBoundaryMatch.index : content.length;
		const escapedTarget = linkTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const lineRegex = new RegExp(`\\n[^\\n]*\\[\\[${escapedTarget}(?:\\|[^\\]]+)?\\]\\][^\\n]*`, "g");
		const sectionBody = content.slice(afterHeading, sectionEnd);
		const newBody = sectionBody.replace(lineRegex, "");
		return separateRulesFromText(content.slice(0, afterHeading) + newBody + content.slice(sectionEnd));
	});
}

/** Return all wiki-link targets found under a named ### section. */
export async function getLinksInSection(app: App, filePath: string, section: string): Promise<string[]> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.read(file);

	const match = findSectionHeading(content, section);
	if (!match) return [];

	const afterHeading = match.end;
	const nextBoundaryMatch = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundaryMatch ? afterHeading + nextBoundaryMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);

	const links: string[] = [];
	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m;
	while ((m = linkRegex.exec(sectionContent)) !== null) {
		links.push(m[1]);
	}
	return links;
}

/** Return the plain text body of a named ### section (stops at next heading or ---). */
export async function getSectionContent(app: App, filePath: string, section: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return "";
	const content = await app.vault.read(file);

	const match = findSectionHeading(content, section);
	if (!match) return "";

	const afterHeading = match.end;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	// The template's guidance prompt under the heading isn't section text.
	return splitGuidance(content.slice(afterHeading, sectionEnd)).text.trim();
}

/** Read a file once and return all text and link section content in a single pass. */
export async function getAllSectionData(
	app: App,
	filePath: string,
	preloadedContent?: string,
): Promise<{ text: Map<string, string>; links: Map<string, string[]>; headings: Map<string, string> }> {
	const text  = new Map<string, string>();
	const links = new Map<string, string[]>();
	/** Section key → the heading as written in the note (for sections shown under their own name). */
	const headings = new Map<string, string>();
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return { text, links, headings };
	const content = preloadedContent ?? await app.vault.read(file);

	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	for (const h of sectionHeadings(content)) {
		const name = canonicalSection(h.text);
		// The first heading for a section is the one the plugin reads and writes.
		if (headings.has(name)) continue;
		const body = content.slice(h.end, sectionEndAfter(content, h.end));
		const sectionLinks: string[] = [];
		let lm: RegExpExecArray | null;
		const lr = new RegExp(linkRegex.source, "g");
		while ((lm = lr.exec(body)) !== null) sectionLinks.push(lm[1]);
		headings.set(name, h.text);
		links.set(name, sectionLinks);
		// The template's guidance prompt under the heading isn't section text.
		text.set(name, splitGuidance(body).text.trim());
	}
	return { text, links, headings };
}

/**
 * A back-link to a hex note that can't be mistaken for another map's hex:
 * the full path, shown as `alias` (round 6 S2: a town note got a bare
 * "[[7_7]]", the same on every map). "|", "[" and "]" are dropped from the
 * alias so the link stays well-formed.
 */
export function hexBacklinkText(hexFilePath: string, alias: string): string {
	const target = hexFilePath.replace(/\.md$/i, "");
	const shown = alias.replace(/[|[\]]/g, "").replace(/\s+/g, " ").trim();
	return shown ? `[[${target}|${shown}]]` : `[[${target}]]`;
}

/**
 * Append a backlink to hexFilePath at the end of targetFilePath, unless
 * a link to the hex file already exists anywhere in the target note. With
 * `alias`, the link is path-qualified and reads as the alias (see
 * hexBacklinkText); without, it's Obsidian's shortest link.
 */
export async function addBacklinkToFile(app: App, targetFilePath: string, hexFilePath: string, alias?: string): Promise<void> {
	const hexFile    = app.vault.getAbstractFileByPath(hexFilePath);
	const targetFile = app.vault.getAbstractFileByPath(targetFilePath);
	if (!(hexFile instanceof TFile) || !(targetFile instanceof TFile)) return;

	// Skip if the target already links back to the hex
	const cache = app.metadataCache.getFileCache(targetFile);
	const alreadyLinked = cache?.links?.some(
		l => app.metadataCache.getFirstLinkpathDest(l.link, targetFilePath) === hexFile,
	);
	if (alreadyLinked) return;

	const linkText = alias !== undefined
		? hexBacklinkText(hexFile.path, alias)
		: `[[${app.metadataCache.fileToLinktext(hexFile, targetFilePath)}]]`;
	await app.vault.process(targetFile, (content) =>
		content.trimEnd() + (content.trim() ? "\n\n" : "") + linkText + "\n",
	);
}

/** Replace the body of a named ### section in-place, creating the section if absent. */
export async function setSectionContent(app: App, filePath: string, section: string, newText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => replaceSectionText(content, section, newText));
}

/** Text of a named ### section in `content` (guidance prompt left out). */
export function sectionText(content: string, section: string): string {
	const match = findSectionHeading(content, section);
	if (!match) return "";
	const afterHeading = match.end;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	return splitGuidance(content.slice(afterHeading, sectionEnd)).text.trim();
}

/** Note text with the body of "### section" replaced (heading appended if missing). */
export function replaceSectionText(content: string, section: string, newText: string): string {
	const match = findSectionHeading(content, section);
	if (!match) {
		return newText.trim()
			? content.trimEnd() + `\n\n### ${section}\n${newText.trim()}\n`
			: content;
	}
	const afterHeading = match.end;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	// Keep the template's guidance prompt on top of the section.
	const { guidance } = splitGuidance(content.slice(afterHeading, sectionEnd));
	const guide = guidance.length ? `${guidance.join("\n")}\n` : "";
	const replacement = newText.trim()
		? `\n${guide}${guide ? "\n" : ""}${newText.trim()}\n`
		: `\n${guide}`;
	return separateRulesFromText(content.slice(0, afterHeading) + replacement + content.slice(sectionEnd));
}

/** `existing` with `addition` on a new line (either may be empty). */
export function joinSectionText(existing: string, addition: string): string {
	const a = existing.trimEnd();
	const b = addition.trim();
	if (!b) return a;
	return a ? `${a}\n${b}` : b;
}

/** Note text with `addition` appended to the end of "### section" (P2 "Add to this hex"). */
export function appendSectionText(content: string, section: string, addition: string): string {
	if (!addition.trim()) return content;
	return replaceSectionText(content, section, joinSectionText(sectionText(content, section), addition));
}

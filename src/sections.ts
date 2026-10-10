import { App, TFile } from "obsidian";
import { escapeRegex } from "./textUtils";
import { splitGuidance } from "./hexGuidance";

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
	const headingRegex = new RegExp(`^###\\s+${escapeRegex(section)}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) {
		return separateRulesFromText(content.trimEnd() + `\n\n### ${section}\n\n${linkText}\n`);
	}
	const afterHeading = match.index + match[0].length;
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
		const headingRegex = new RegExp(`^###\\s+${escapeRegex(section)}\\s*$`, "mi");
		const match = headingRegex.exec(content);
		if (!match) return content;
		const afterHeading = match.index + match[0].length;
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

	const headingRegex = new RegExp(`^###\\s+${escapeRegex(section)}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return [];

	const afterHeading = match.index + match[0].length;
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

	const headingRegex = new RegExp(`^###\\s+${escapeRegex(section)}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return "";

	const afterHeading = match.index + match[0].length;
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
): Promise<{ text: Map<string, string>; links: Map<string, string[]> }> {
	const text  = new Map<string, string>();
	const links = new Map<string, string[]>();
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return { text, links };
	const content = preloadedContent ?? await app.vault.read(file);

	// Find every ### heading and capture the body up to the next boundary
	const headingRegex = /^###\s+(.+?)\s*$/gm;
	const boundaryRegex = /\n(?:#{1,6} |-{3,})/m;
	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = headingRegex.exec(content)) !== null) {
		const name = m[1].toLowerCase();
		const afterHeading = m.index + m[0].length;
		const nextBoundary = boundaryRegex.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
		const body = content.slice(afterHeading, sectionEnd);

		// Collect wiki-links
		const sectionLinks: string[] = [];
		let lm: RegExpExecArray | null;
		const lr = new RegExp(linkRegex.source, "g");
		while ((lm = lr.exec(body)) !== null) sectionLinks.push(lm[1]);

		links.set(name, sectionLinks);
		// The template's guidance prompt under the heading isn't section text.
		text.set(name, splitGuidance(body).text.trim());
	}
	return { text, links };
}

/**
 * Append a backlink to hexFilePath at the end of targetFilePath, unless
 * a link to the hex file already exists anywhere in the target note.
 */
export async function addBacklinkToFile(app: App, targetFilePath: string, hexFilePath: string): Promise<void> {
	const hexFile    = app.vault.getAbstractFileByPath(hexFilePath);
	const targetFile = app.vault.getAbstractFileByPath(targetFilePath);
	if (!(hexFile instanceof TFile) || !(targetFile instanceof TFile)) return;

	// Skip if the target already links back to the hex
	const cache = app.metadataCache.getFileCache(targetFile);
	const alreadyLinked = cache?.links?.some(
		l => app.metadataCache.getFirstLinkpathDest(l.link, targetFilePath) === hexFile,
	);
	if (alreadyLinked) return;

	const linkText = `[[${app.metadataCache.fileToLinktext(hexFile, targetFilePath)}]]`;
	await app.vault.process(targetFile, (content) =>
		content.trimEnd() + (content.trim() ? "\n\n" : "") + linkText + "\n",
	);
}

/** Replace the body of a named ### section in-place, creating the section if absent. */
export async function setSectionContent(app: App, filePath: string, section: string, newText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => {
		const headingRegex = new RegExp(`^###\\s+${escapeRegex(section)}\\s*$`, "mi");
		const match = headingRegex.exec(content);
		if (!match) {
			return newText.trim()
				? content.trimEnd() + `\n\n### ${section}\n${newText.trim()}\n`
				: content;
		}
		const afterHeading = match.index + match[0].length;
		const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
		// Keep the template's guidance prompt on top of the section.
		const { guidance } = splitGuidance(content.slice(afterHeading, sectionEnd));
		const guide = guidance.length ? `${guidance.join("\n")}\n` : "";
		const replacement = newText.trim()
			? `\n${guide}${guide ? "\n" : ""}${newText.trim()}\n`
			: `\n${guide}`;
		return separateRulesFromText(content.slice(0, afterHeading) + replacement + content.slice(sectionEnd));
	});
}

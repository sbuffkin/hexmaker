import { App, TFile } from "obsidian";

/** Insert a wiki-link under the named ### section, creating the section if absent. */
export async function addLinkToSection(app: App, filePath: string, section: string, linkText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => {
		const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
		const match = headingRegex.exec(content);
		if (!match) {
			return content.trimEnd() + `\n\n### ${section}\n\n${linkText}\n`;
		}
		const afterHeading = match.index + match[0].length;
		const nextBoundaryMatch = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundaryMatch ? afterHeading + nextBoundaryMatch.index : content.length;
		const sectionContent = content.slice(afterHeading, sectionEnd);
		if (sectionContent.includes(linkText)) return content;
		const trimmedSection = sectionContent.trimEnd();
		const insertAt = afterHeading + trimmedSection.length;
		return content.slice(0, insertAt) + "\n\n" + linkText + content.slice(insertAt);
	});
}

/** Remove a wiki-link from under the named ### section. Removes the whole line containing it. */
export async function removeLinkFromSection(app: App, filePath: string, section: string, linkTarget: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	await app.vault.process(file, (content) => {
		const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
		const match = headingRegex.exec(content);
		if (!match) return content;
		const afterHeading = match.index + match[0].length;
		const nextBoundaryMatch = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundaryMatch ? afterHeading + nextBoundaryMatch.index : content.length;
		const escapedTarget = linkTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const lineRegex = new RegExp(`\\n[^\\n]*\\[\\[${escapedTarget}(?:\\|[^\\]]+)?\\]\\][^\\n]*`, "g");
		const sectionBody = content.slice(afterHeading, sectionEnd);
		const newBody = sectionBody.replace(lineRegex, "");
		return content.slice(0, afterHeading) + newBody + content.slice(sectionEnd);
	});
}

/** Return all wiki-link targets found under a named ### section. */
export async function getLinksInSection(app: App, filePath: string, section: string): Promise<string[]> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
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

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return "";

	const afterHeading = match.index + match[0].length;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	return content.slice(afterHeading, sectionEnd).trim();
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
		text.set(name, body.trim());
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
		const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
		const match = headingRegex.exec(content);
		if (!match) {
			return newText.trim()
				? content.trimEnd() + `\n\n### ${section}\n${newText.trim()}\n`
				: content;
		}
		const afterHeading = match.index + match[0].length;
		const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
		const replacement = newText.trim() ? `\n${newText.trim()}\n` : "\n";
		return content.slice(0, afterHeading) + replacement + content.slice(sectionEnd);
	});
}

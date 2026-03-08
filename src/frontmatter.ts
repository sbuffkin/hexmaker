import { App, TFile } from "obsidian";

export function getTerrainFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const terrain = cache?.frontmatter?.terrain;
	return typeof terrain === "string" ? terrain : null;
}

export async function setTerrainInFile(app: App, path: string, terrainKey: string | null): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	const content = await app.vault.read(file);
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	let newContent: string;
	if (fmMatch) {
		const fmBlock = fmMatch[1];
		const rest = content.slice(fmMatch[0].length);
		let newFm: string;
		if (terrainKey === null) {
			newFm = fmBlock.replace(/^\s*terrain:\s*[^\r\n]*(?:\r?\n)?/gm, "").trimEnd();
		} else {
			const terrainLine = /^\s*terrain:\s*.*$/m;
			newFm = terrainLine.test(fmBlock)
				? fmBlock.replace(terrainLine, `terrain: ${terrainKey}`)
				: fmBlock.trimEnd() + (fmBlock.endsWith("\n") ? "" : "\n") + `terrain: ${terrainKey}\n`;
		}
		newContent = `---\n${newFm}\n---\n${rest}`;
	} else {
		if (terrainKey === null) return true;
		newContent = `---\nterrain: ${terrainKey}\n---\n\n${content}`;
	}
	await app.vault.modify(file, newContent);
	return true;
}

export function getIconOverrideFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const icon = cache?.frontmatter?.icon;
	return typeof icon === "string" ? icon : null;
}

export async function setIconOverrideInFile(app: App, path: string, icon: string | null): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	const content = await app.vault.read(file);
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	let newContent: string;
	if (fmMatch) {
		const fmBlock = fmMatch[1];
		const rest = content.slice(fmMatch[0].length);
		let newFm: string;
		if (icon === null) {
			newFm = fmBlock.replace(/^\s*icon:\s*[^\r\n]*(?:\r?\n)?/gm, "").trimEnd();
		} else {
			const iconLine = /^\s*icon:\s*.*$/m;
			newFm = iconLine.test(fmBlock)
				? fmBlock.replace(iconLine, `icon: ${icon}`)
				: fmBlock.trimEnd() + (fmBlock.endsWith("\n") ? "" : "\n") + `icon: ${icon}\n`;
		}
		newContent = `---\n${newFm}\n---\n${rest}`;
	} else {
		if (icon === null) return true;
		newContent = `---\nicon: ${icon}\n---\n\n${content}`;
	}
	await app.vault.modify(file, newContent);
	return true;
}

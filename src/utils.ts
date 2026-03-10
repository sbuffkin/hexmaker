import type DuckmagePlugin from "./DuckmagePlugin";

export function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

export function makeTableTemplate(dice: number, exampleRows = 3, extraFrontmatter?: Record<string, string>, preamble?: string): string {
	const rows = exampleRows === 1
		? "|  | 1 |"
		: Array.from({ length: exampleRows }, (_, i) =>
			`| Example result ${String.fromCharCode(65 + i)} | 1 |`,
		).join("\n");
	const extra = extraFrontmatter
		? Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n"
		: "";
	const preambleBlock = preamble ? `\n${preamble}\n` : "";
	return `---\ndice: ${dice}\n${extra}---\n${preambleBlock}\n| Result | Weight |\n|--------|--------|\n${rows}\n`;
}

export function getIconUrl(plugin: DuckmagePlugin, iconFilename: string): string {
	if (plugin.vaultIconsSet.has(iconFilename)) {
		const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
		return plugin.app.vault.adapter.getResourcePath(`${folder}/${iconFilename}`);
	}
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}

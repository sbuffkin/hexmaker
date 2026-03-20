import type DuckmagePlugin from "./DuckmagePlugin";

export function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

export function makeTableTemplate(dice: number, extraFrontmatter?: Record<string, string | boolean | number>, preamble?: string): string {
	const rows = "|  | 1 |";
	const extra = extraFrontmatter
		? Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n"
		: "";
	const preambleBlock = preamble ? `\n${preamble}\n` : "";
	return `---\ndice: ${dice}\n${extra}---\n${preambleBlock}\n| Result | Weight |\n|--------|--------|\n${rows}\n`;
}

/**
 * Creates an icon element inside `parent`.
 * When `iconColor` is provided the icon is rendered as a CSS-masked div: the icon
 * shape is used as a mask and `iconColor` is the fill (ideal for monochrome icons).
 * Otherwise a plain <img> is used for full-colour rendering.
 */
export function createIconEl(
	parent: HTMLElement,
	src: string,
	alt: string,
	iconColor: string | undefined,
	cls: string,
): HTMLElement {
	if (iconColor) {
		const div = parent.createEl("div", { cls, title: alt });
		div.style.maskImage = `url('${src}')`;
		div.style.setProperty("-webkit-mask-image", `url('${src}')`);
		div.style.maskSize = "contain";
		div.style.setProperty("-webkit-mask-size", "contain");
		div.style.maskRepeat = "no-repeat";
		div.style.setProperty("-webkit-mask-repeat", "no-repeat");
		div.style.maskPosition = "center";
		div.style.setProperty("-webkit-mask-position", "center");
		div.style.backgroundColor = iconColor;
		return div;
	}
	const img = parent.createEl("img", { cls });
	(img as HTMLImageElement).src = src;
	(img as HTMLImageElement).alt = alt;
	return img;
}


export function getIconUrl(plugin: DuckmagePlugin, iconFilename: string): string {
	if (plugin.vaultIconsSet.has(iconFilename)) {
		const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
		return plugin.app.vault.adapter.getResourcePath(`${folder}/${iconFilename}`);
	}
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}

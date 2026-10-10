import type HexmakerPlugin from "./HexmakerPlugin";
import { normalizePath } from "obsidian";
import { BUNDLED_ICONS } from "./bundledIcons";

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "");
}

export function normalizeFolder(path: string): string {
	if (!path) return "";
	return normalizePath(path);
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
 * A CSS `url("…")` value for `src`. SVG icons are inlined as raw
 * `data:image/svg+xml,<svg xmlns="…">` text, whose quotes would end the
 * string early and make the whole value invalid (the mask is then dropped
 * and the icon shows as a solid block), so quotes, backslashes and line
 * breaks are percent-encoded.
 */
export function cssUrl(src: string): string {
	return `url("${src.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
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
		const div = parent.createDiv({ cls: `${cls} duckmage-masked-icon`, title: alt });
		div.setCssProps({
			'--duckmage-mask-url': cssUrl(src),
			'--duckmage-bg': iconColor,
		});
		return div;
	}
	const img = parent.createEl("img", { cls });
	img.src = src;
	img.alt = alt;
	return img;
}


export function getIconUrl(plugin: HexmakerPlugin, iconFilename: string): string {
	if (plugin.vaultIconsSet.has(iconFilename)) {
		const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
		return plugin.app.vault.adapter.getResourcePath(`${folder}/${iconFilename}`);
	}
	const bundled = BUNDLED_ICONS.get(iconFilename);
	if (bundled) return bundled;
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}

/** Icon groups shown as tabs in icon pickers. */
export type IconPack = "terrain" | "space" | "custom";

export const ICON_PACK_LABELS: Record<IconPack, string> = {
	terrain: "Terrain",
	space: "Space",
	custom: "Custom",
};

/**
 * The icon tab a picker opens on before the user picks one this session:
 * Space for space-only setups (map types = just Space), so a sci-fi user
 * doesn't scroll past cactus and evergreen icons (fresh-eyes r5); All
 * otherwise. Unset map types mean all types, so All.
 */
export function defaultIconPack(settings: { mapKinds?: string[] }): IconPack | "all" {
	const kinds = settings.mapKinds;
	return Array.isArray(kinds) && kinds.includes("space") && !kinds.includes("world") ? "space" : "all";
}

/** Which picker tab an icon belongs to: the user's icons folder wins over bundled names. */
export function iconPack(icon: string, vaultIcons: Set<string>): IconPack {
	if (vaultIcons.has(icon)) return "custom";
	if (icon.startsWith("space-")) return "space";
	if (icon.startsWith("bw-")) return "terrain";
	return "custom";
}

/** Human label for an icon file name: drops the pack prefix and extension. */
export function iconLabel(icon: string): string {
	return icon
		.replace(/^(bw|space)-/, "")
		.replace(/\.(png|jpg|jpeg|gif|svg|webp)$/i, "")
		.replace(/-/g, " ");
}

/**
 * Write a File (from a drag-drop event) into the vault at the given folder.
 * Creates intermediate folders as needed. Auto-renames on collision
 * (foo.png → foo (1).png) so existing assets aren't clobbered.
 * Returns the resolved vault-relative path of the written file.
 */
export async function importBinaryFileToVault(
	plugin: HexmakerPlugin,
	file: File,
	destFolder: string,
): Promise<string> {
	const folder = normalizeFolder(destFolder);
	if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
		await plugin.app.vault.createFolder(folder);
	}
	const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
	const dot = safeName.lastIndexOf(".");
	const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
	const ext = dot > 0 ? safeName.slice(dot) : "";
	let candidate = folder ? `${folder}/${safeName}` : safeName;
	let n = 1;
	while (plugin.app.vault.getAbstractFileByPath(candidate)) {
		const next = `${stem} (${n})${ext}`;
		candidate = folder ? `${folder}/${next}` : next;
		n++;
	}
	const buffer = await file.arrayBuffer();
	await plugin.app.vault.createBinary(candidate, buffer);
	return candidate;
}

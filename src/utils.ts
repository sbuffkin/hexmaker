import type DuckmagePlugin from "./DuckmagePlugin";

export function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

export function getIconUrl(plugin: DuckmagePlugin, iconFilename: string): string {
	if (plugin.vaultIconsSet.has(iconFilename)) {
		const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
		return plugin.app.vault.adapter.getResourcePath(`${folder}/${iconFilename}`);
	}
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}

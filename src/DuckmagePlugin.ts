import { Notice, Plugin, TFile } from "obsidian";
import { HexMapView } from "./HexMapView";
import { DuckmageSettingTab } from "./DuckmageSettingTab";
import { DEFAULT_SETTINGS, DEFAULT_TERRAIN_PALETTE, VIEW_TYPE_HEX_MAP } from "./constants";
import { normalizeFolder } from "./utils";
import type { DuckmagePluginSettings } from "./types";
import DEFAULT_HEX_TEMPLATE from "./defaultHexTemplate.md";

export default class DuckmagePlugin extends Plugin {
	settings: DuckmagePluginSettings;
	availableIcons: string[] = [];
	vaultIconsSet: Set<string> = new Set();

	async onload() {
		await this.loadSettings();
		await this.loadAvailableIcons();

		this.registerView(VIEW_TYPE_HEX_MAP, (leaf) => new HexMapView(leaf, this));
		this.addRibbonIcon("map", "Duckmage: Open hex map", () => this.openHexMap());
		this.addCommand({
			id: "open-hex-map",
			name: "Open Duckmage hex map",
			callback: () => this.openHexMap(),
		});
		this.addSettingTab(new DuckmageSettingTab(this.app, this));
	}

	onunload() {}

	private openHexMap(): void {
		this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE_HEX_MAP });
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!this.settings.gridOffset) this.settings.gridOffset = { x: 0, y: 0 };
		if (!Array.isArray(this.settings.terrainPalette) || this.settings.terrainPalette.length === 0) {
			this.settings.terrainPalette = [...DEFAULT_TERRAIN_PALETTE];
		} else {
			// Merge in any new default entries not already present by name
			const existing = new Set(this.settings.terrainPalette.map(e => e.name));
			for (const entry of DEFAULT_TERRAIN_PALETTE) {
				if (!existing.has(entry.name)) {
					this.settings.terrainPalette.push({ ...entry });
				}
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadAvailableIcons() {
		this.vaultIconsSet = new Set();
		const pluginIcons: string[] = [];
		const vaultIcons: string[] = [];

		try {
			const result = await this.app.vault.adapter.list(`${this.manifest.dir}/icons`);
			pluginIcons.push(...result.files
				.filter(f => f.toLowerCase().endsWith(".png"))
				.map(f => f.split("/").pop() as string));
		} catch {}

		const iconsFolder = normalizeFolder(this.settings.iconsFolder ?? "");
		if (iconsFolder) {
			try {
				const result = await this.app.vault.adapter.list(iconsFolder);
				for (const f of result.files) {
					if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f)) {
						const name = f.split("/").pop() as string;
						this.vaultIconsSet.add(name);
						vaultIcons.push(name);
					}
				}
			} catch {}
		}

		// Combine both sources, deduplicate by filename, sorted
		this.availableIcons = [...new Set([...pluginIcons, ...vaultIcons])].sort();
	}

	hexPath(x: number, y: number): string {
		const folder = normalizeFolder(this.settings.hexFolder);
		return folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
	}

	/** Create a hex note from the configured template (or the built-in default). */
	async createHexNote(x: number, y: number): Promise<TFile | null> {
		const path = this.hexPath(x, y);
		const templatePath = (this.settings.templatePath ?? "").replace(/^\/+|\/+$/g, "");
		let content: string;

		if (templatePath) {
			try {
				content = await this.app.vault.adapter.read(templatePath);
			} catch {
				new Notice("Template not found: " + templatePath);
				return null;
			}
		} else {
			content = DEFAULT_HEX_TEMPLATE;
		}

		content = content
			.replace(/\{\{x\}\}/g, String(x))
			.replace(/\{\{y\}\}/g, String(y))
			.replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`);

		const folder = normalizeFolder(this.settings.hexFolder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		try {
			return await this.app.vault.create(path, content);
		} catch (e) {
			new Notice("Could not create note: " + (e instanceof Error ? e.message : String(e)));
			return null;
		}
	}
}

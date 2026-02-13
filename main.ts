import { App, ItemView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";

/** Normalize folder path: no leading/trailing slashes. */
function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

/** Get terrain key from a note's frontmatter (from cache or by reading). */
function getTerrainFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const terrain = cache?.frontmatter?.terrain;
	return typeof terrain === "string" ? terrain : null;
}

/** Set terrain in a note's frontmatter. File must already exist. */
async function setTerrainInFile(app: App, path: string, terrainKey: string | null): Promise<boolean> {
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
			// Remove any terrain line (including optional newline); support quoted values
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

export interface TerrainColor {
	name: string;
	color: string;
}

interface DuckmagePluginSettings {
	mySetting: string;
	hexFolder: string;
	templatePath: string;
	hexGap: string;
	terrainPalette: TerrainColor[];
}

const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
	{ name: "mountain", color: "#9ca3af" },
	{ name: "water", color: "#60a5fa" },
	{ name: "grass", color: "#84cc16" },
	{ name: "forest", color: "#15803d" },
	{ name: "cliffs", color: "#a16207" },
	{ name: "desert", color: "#eab308" },
	{ name: "snow", color: "#e0f2fe" },
];

const DEFAULT_SETTINGS: DuckmagePluginSettings = {
	mySetting: "default",
	hexFolder: "world/hexes",
	templatePath: "",
	hexGap: "0.15",
	terrainPalette: DEFAULT_TERRAIN_PALETTE,
};

export default class DuckmagePlugin extends Plugin {
	settings: DuckmagePluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_HEX_MAP, (leaf) => new HexMapView(leaf, this));

		this.addRibbonIcon("map", "Duckmage: Open hex map", () => this.openHexMap());

		this.addCommand({
			id: "open-hex-map",
			name: "Open Duckmage hex map",
			callback: () => this.openHexMap(),
		});

		// Settings tab
		this.addSettingTab(new DuckmageSettingTab(this.app, this));
	}

	private openHexMap(): void {
		const leaf = this.app.workspace.getLeaf(false);
		leaf.setViewState({ type: VIEW_TYPE_HEX_MAP });
	}

	onunload() {}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!Array.isArray(this.settings.terrainPalette) || this.settings.terrainPalette.length === 0) {
			this.settings.terrainPalette = [...DEFAULT_TERRAIN_PALETTE];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Path for hex note at (x, y). */
	hexPath(x: number, y: number): string {
		const folder = normalizeFolder(this.settings.hexFolder);
		return folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
	}
}

class HexMapView extends ItemView {
	static readonly GRID_COLS = 20;
	static readonly GRID_ROWS = 16;
	plugin: DuckmagePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: DuckmagePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HEX_MAP;
	}

	getDisplayText(): string {
		return "Hex map";
	}

	async onOpen(): Promise<void> {
		this.renderGrid();
	}

	/**
	 * @param terrainOverrides - If set, use these terrain keys for the given paths instead of cache (for immediate UI update after set/clear).
	 */
	private renderGrid(terrainOverrides?: Map<string, string | null>): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClasses(["duckmage-hex-map-container"]);
		const gap = this.plugin.settings.hexGap?.trim() || "0.15";
		contentEl.style.setProperty("--duckmage-hex-gap", /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap);

		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		const palette = this.plugin.settings.terrainPalette ?? [];
		for (let y = 0; y < HexMapView.GRID_ROWS; y++) {
			const rowEl = contentEl.createDiv({ cls: "duckmage-hex-row" });
			for (let x = 0; x < HexMapView.GRID_COLS; x++) {
				const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
				const file = this.app.vault.getAbstractFileByPath(path);
				const exists = file instanceof TFile;
				const terrainKey =
					terrainOverrides?.has(path) ? terrainOverrides.get(path)! : getTerrainFromFile(this.app, path);
				const terrainColor =
					terrainKey != null ? palette.find((p) => p.name === terrainKey)?.color : undefined;

				const hexEl = rowEl.createDiv({
					cls: `duckmage-hex ${exists ? "duckmage-hex-exists" : ""}`,
					attr: { "data-x": String(x), "data-y": String(y) },
				});
				hexEl.tabIndex = -1;
				if (terrainColor) hexEl.style.backgroundColor = terrainColor;
				hexEl.createSpan({ cls: "duckmage-hex-label", text: `${x},${y}` });
				if (exists) hexEl.createSpan({ cls: "duckmage-hex-dot" });

				hexEl.addEventListener("click", () => this.onHexClick(x, y));
				hexEl.addEventListener("contextmenu", (e) => this.onHexContextMenu(e, x, y));
			}
		}
	}

	private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
		evt.preventDefault();
		const path = this.plugin.hexPath(x, y);
		const palette = this.plugin.settings.terrainPalette ?? [];
		const hexEl = evt.currentTarget as HTMLElement;

		const clearHighlight = () => {
			hexEl.blur();
			window.getSelection()?.removeAllRanges();
		};

		const menu = new Menu();
		for (const entry of palette) {
			menu.addItem((item) =>
				item
					.setTitle(entry.name)
					.setIcon("palette")
					.onClick(async () => {
						clearHighlight();
						let file = this.app.vault.getAbstractFileByPath(path);
						if (!(file instanceof TFile)) {
							file = await this.createHexNote(x, y, path);
							if (!file) return;
						}
						await setTerrainInFile(this.app, path, entry.name);
						this.renderGrid(new Map([[path, entry.name]]));
					})
			);
		}
		const fileExists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
		if (fileExists) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Clear color")
					.onClick(async () => {
						clearHighlight();
						await setTerrainInFile(this.app, path, null);
						this.renderGrid(new Map([[path, null]]));
					})
			);
		}
		menu.showAtMouseEvent(evt);
	}

	private async onHexClick(x: number, y: number): Promise<void> {
		const path = this.plugin.hexPath(x, y);
		const abstract = this.app.vault.getAbstractFileByPath(path);
		let fileToOpen: TFile | null = abstract instanceof TFile ? abstract : null;

		if (!fileToOpen) {
			const created = await this.createHexNote(x, y, path);
			if (created) {
				fileToOpen = created;
				this.renderGrid();
			} else return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(fileToOpen);
	}

	private async createHexNote(x: number, y: number, path: string): Promise<TFile | null> {
		const templatePath = (this.plugin.settings.templatePath ?? "").replace(/^\/+|\/+$/g, "");
		const DEFAULT_TEMPLATE = `# Hex {{x}}, {{y}}\n\n`;

		let content: string;
		if (templatePath) {
			try {
				content = await this.app.vault.adapter.read(templatePath);
			} catch {
				new Notice("Template not found: " + templatePath);
				return null;
			}
		} else {
			content = DEFAULT_TEMPLATE;
		}

		content = content
			.replace(/\{\{x\}\}/g, String(x))
			.replace(/\{\{y\}\}/g, String(y))
			.replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`);

		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		if (folder) {
			const folderObj = this.app.vault.getAbstractFileByPath(folder);
			if (!folderObj) await this.app.vault.createFolder(folder);
		}

		try {
			const created = await this.app.vault.create(path, content);
			return created;
		} catch (e) {
			new Notice("Could not create note: " + (e instanceof Error ? e.message : String(e)));
			return null;
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Sample modal — edit main.ts to customize.");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class DuckmageSettingTab extends PluginSettingTab {
	plugin: DuckmagePlugin;

	constructor(app: App, plugin: DuckmagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Hex notes folder")
			.setDesc("Vault-relative path where hex notes (x_y.md) are stored.")
			.addText((text) =>
				text
					.setPlaceholder("world/hexes")
					.setValue(this.plugin.settings.hexFolder)
					.onChange(async (value) => {
						this.plugin.settings.hexFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Template path")
			.setDesc("Vault-relative path to the template file for new hex notes. Use {{x}}, {{y}}, {{title}} as placeholders.")
			.addText((text) =>
				text
					.setPlaceholder("templates/hex.md")
					.setValue(this.plugin.settings.templatePath)
					.onChange(async (value) => {
						this.plugin.settings.templatePath = (value ?? "").replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Hex cell spacing")
			.setDesc("Gap between hex cells (e.g. 0.15 for a small gap, 0 for none). Use a number for em units, or add 'em'/'px' (e.g. 0.2em).")
			.addText((text) =>
				text
					.setPlaceholder("0.15")
					.setValue(this.plugin.settings.hexGap ?? "0.15")
					.onChange(async (value) => {
						this.plugin.settings.hexGap = (value ?? "0.15").trim() || "0";
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Terrain palette" });
		const paletteDesc = containerEl.createDiv({ cls: "setting-item-description" });
		paletteDesc.setText("Right-click a hex to set its color. Add or edit terrain types and colors below.");
		paletteDesc.style.marginBottom = "0.75em";

		const listEl = containerEl.createDiv({ cls: "duckmage-palette-list" });
		const palette = this.plugin.settings.terrainPalette ?? [];
		for (let i = 0; i < palette.length; i++) {
			const entry = palette[i];
			const itemEl = listEl.createDiv({ cls: "duckmage-palette-item" });
			new Setting(itemEl)
				.addText((text) =>
					text
						.setPlaceholder("Name (e.g. mountain)")
						.setValue(entry.name)
						.onChange(async (value) => {
							entry.name = (value ?? "").trim() || entry.name;
							await this.plugin.saveSettings();
						})
				)
				.addColorPicker((color) => {
					color.setValue(entry.color).onChange(async (value) => {
						entry.color = value;
						await this.plugin.saveSettings();
					});
				})
				.addExtraButton((btn) =>
					btn.setIcon("trash-2").onClick(async () => {
						this.plugin.settings.terrainPalette.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		}

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add terrain color").onClick(async () => {
				this.plugin.settings.terrainPalette.push({ name: "New", color: "#888888" });
				await this.plugin.saveSettings();
				this.display();
			})
		);
	}
}

import { Notice, Plugin, TFile } from "obsidian";
import { HexMapView } from "./HexMapView";
import { HexTableView } from "./HexTableView";
import { RandomTableView } from "./RandomTableView";
import { DuckmageSettingTab } from "./DuckmageSettingTab";
import { DEFAULT_SETTINGS, DEFAULT_TERRAIN_PALETTE, VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES } from "./constants";
import { normalizeFolder, makeTableTemplate } from "./utils";
import type { DuckmagePluginSettings } from "./types";
import DEFAULT_HEX_TEMPLATE from "./defaultHexTemplate.md";
import { getTerrainFromFile } from "./frontmatter";
import { addLinkToSection, getLinksInSection } from "./sections";

export default class DuckmagePlugin extends Plugin {
	settings: DuckmagePluginSettings;
	availableIcons: string[] = [];
	vaultIconsSet: Set<string> = new Set();

	async onload() {
		await this.loadSettings();
		await this.loadAvailableIcons();

		this.registerView(VIEW_TYPE_HEX_MAP,       (leaf) => new HexMapView(leaf, this));
		this.registerView(VIEW_TYPE_HEX_TABLE,     (leaf) => new HexTableView(leaf, this));
		this.registerView(VIEW_TYPE_RANDOM_TABLES, (leaf) => new RandomTableView(leaf, this));
		this.addRibbonIcon("map", "Duckmage: Open hex map", () => this.openHexMap());
		this.addCommand({
			id: "open-hex-map",
			name: "Open Duckmage hex map",
			callback: () => this.openHexMap(),
		});
		this.addCommand({
			id: "open-hex-table",
			name: "Open Duckmage hex table",
			callback: () => this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE_HEX_TABLE }),
		});
		this.addCommand({
			id: "open-random-tables",
			name: "Open Duckmage random tables",
			callback: () => this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE_RANDOM_TABLES }),
		});
		this.addSettingTab(new DuckmageSettingTab(this.app, this));

		this.registerObsidianProtocolHandler("duckmage-roll", (params) => {
			const filePath = params["file"];
			if (!filePath) return;
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
			if (leaves.length > 0) {
				this.app.workspace.revealLeaf(leaves[0]);
				(leaves[0].view as any).openTable?.(filePath);
			} else {
				void this.app.workspace.getLeaf("tab").setViewState({
					type: VIEW_TYPE_RANDOM_TABLES,
					state: { filePath },
				});
			}
		});
	}

	onunload() {}

	private openHexMap(): void {
		this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE_HEX_MAP });
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!this.settings.gridOffset) this.settings.gridOffset = { x: 0, y: 0 };
		if (!Array.isArray(this.settings.roadChains))  this.settings.roadChains  = [];
		if (!Array.isArray(this.settings.riverChains)) this.settings.riverChains = [];
		if (!this.settings.roadColor)  this.settings.roadColor  = "#a16207";
		if (!this.settings.riverColor) this.settings.riverColor = "#3b82f6";
		if (!this.settings.hexOrientation) this.settings.hexOrientation = "pointy";
		if (!this.settings.tablesFolder) this.settings.tablesFolder = "world/tables";
		if (!this.settings.defaultTableDice) this.settings.defaultTableDice = 100;
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

	refreshHexMap(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach(leaf => {
			(leaf.view as HexMapView).renderGrid();
		});
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

	/** Build the Obsidian URI roller link for a table file path. */
	buildRollerLink(filePath: string): string {
		const vault = encodeURIComponent(this.app.vault.getName());
		const file = encodeURIComponent(filePath);
		return `[🎲 Open in Duckmage Roller](obsidian://duckmage-roll?vault=${vault}&file=${file})`;
	}

	/** Add a roller link to a table file if it doesn't already have one. */
	async ensureRollerLink(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		if (content.includes("obsidian://duckmage-roll")) return;
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
		const insertAt = fmMatch ? fmMatch[0].length : 0;
		const link = this.buildRollerLink(filePath);
		const newContent = content.slice(0, insertAt) + "\n" + link + "\n\n" + content.slice(insertAt);
		await this.app.vault.modify(file, newContent);
	}

	/** Add roller links to all existing table files in the tables folder that don't have one. */
	async ensureAllRollerLinks(): Promise<void> {
		const folder = normalizeFolder(this.settings.tablesFolder);
		const prefix = folder ? folder + "/" : "";
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => !prefix || f.path.startsWith(prefix));

		let count = 0;
		for (const file of files) {
			const content = await this.app.vault.read(file);
			if (content.includes("obsidian://duckmage-roll")) continue;
			const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
			const insertAt = fmMatch ? fmMatch[0].length : 0;
			const link = this.buildRollerLink(file.path);
			const newContent = content.slice(0, insertAt) + "\n" + link + "\n\n" + content.slice(insertAt);
			await this.app.vault.modify(file, newContent);
			count++;
		}
		new Notice(`Duckmage: added roller links to ${count} table${count !== 1 ? "s" : ""}.`);
	}

	/** Create missing description/encounters table files for every terrain type in the palette. */
	async ensureTerrainTables(): Promise<void> {
		const folder = normalizeFolder(this.settings.tablesFolder);

		// Generic section tables (landmark, hidden, secret) at the root of the tables folder
		for (const sectionType of ["landmark", "hidden", "secret"] as const) {
			const path = folder ? `${folder}/${sectionType}.md` : `${sectionType}.md`;
			if (!this.app.vault.getAbstractFileByPath(path)) {
				if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
					try { await this.app.vault.createFolder(folder); } catch { /* may already exist */ }
				}
				try {
					await this.app.vault.create(
						path,
						makeTableTemplate(this.settings.defaultTableDice, 1, { "table-type": sectionType }, this.buildRollerLink(path)),
					);
				} catch { /* ignore */ }
			}
		}

		// Terrain-specific tables
		const subfolder = folder ? `${folder}/terrain` : "terrain";
		if (!this.app.vault.getAbstractFileByPath(subfolder)) {
			try { await this.app.vault.createFolder(subfolder); } catch { /* may already exist */ }
		}
		for (const entry of this.settings.terrainPalette) {
			for (const tableType of ["description", "encounters"] as const) {
				const path = `${subfolder}/${entry.name} - ${tableType}.md`;
				if (!this.app.vault.getAbstractFileByPath(path)) {
					try {
						await this.app.vault.create(
							path,
							makeTableTemplate(this.settings.defaultTableDice, 1, { terrain: entry.name, "table-type": tableType }, this.buildRollerLink(path)),
						);
					} catch { /* ignore */ }
				}
			}
		}
	}

	/**
	 * For every hex note that has a terrain set, link its terrain's encounters table into
	 * the hex's "Encounters Table" section (if not already linked).
	 */
	async backfillTerrainLinks(): Promise<void> {
		const hexFolder = normalizeFolder(this.settings.hexFolder);
		const tablesFolder = normalizeFolder(this.settings.tablesFolder);
		const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

		const hexFiles = this.app.vault.getMarkdownFiles().filter(f => {
			if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
			return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
		});

		let linked = 0;
		for (const file of hexFiles) {
			const terrain = getTerrainFromFile(this.app, file.path);
			if (!terrain) continue;
			const tablePath = `${subfolder}/${terrain} - encounters.md`;
			const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
			if (!(tableFile instanceof TFile)) continue;

			const linkText = `[[${this.app.metadataCache.fileToLinktext(tableFile, file.path)}]]`;
			const existing = await getLinksInSection(this.app, file.path, "Encounters Table");
			const target = this.app.metadataCache.fileToLinktext(tableFile, file.path);
			if (existing.includes(target)) continue;

			await addLinkToSection(this.app, file.path, "Encounters Table", linkText);
			linked++;
		}
		new Notice(`Duckmage: linked encounters tables for ${linked} hex${linked !== 1 ? "es" : ""}.`);
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

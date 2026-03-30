import { Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { HexMapView } from "./hex-map/HexMapView";
import { HexTableView } from "./hex-table/HexTableView";
import { RandomTableView } from "./random-tables/RandomTableView";
import { HexmakerSettingTab } from "./HexmakerSettingTab";
import { DEFAULT_PALETTE_NAME, DEFAULT_PATH_TYPES, DEFAULT_SETTINGS, VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES } from "./constants";
import { normalizeFolder, makeTableTemplate } from "./utils";
import { BUNDLED_ICONS } from "./bundledIcons";
import { parseWorkflow, buildWorkflowContent } from "./random-tables/workflow";
import type { HexmakerPluginSettings, RegionData, TerrainColor, TerrainPalette } from "./types";
import DEFAULT_HEX_TEMPLATE from "./defaultHexTemplate.md";
import { getTerrainFromFile, setTerrainInFile } from "./frontmatter";
import { addLinkToSection, getLinksInSection, removeLinkFromSection } from "./sections";

export default class HexmakerPlugin extends Plugin {
	settings: HexmakerPluginSettings;
	availableIcons: string[] = [];
	vaultIconsSet: Set<string> = new Set();

	async onload() {
		await this.loadSettings();
		await this.loadAvailableIcons();
		await this.migrateHexFilesToDefaultRegion();

		this.registerView(VIEW_TYPE_HEX_MAP,       (leaf) => new HexMapView(leaf, this));
		this.registerView(VIEW_TYPE_HEX_TABLE,     (leaf) => new HexTableView(leaf, this));
		this.registerView(VIEW_TYPE_RANDOM_TABLES, (leaf) => new RandomTableView(leaf, this));
		this.addRibbonIcon("map", "Hexmaker: open hex map", () => this.openHexMap());
		this.addCommand({
			id: "open-hex-map",
			name: "Open hex map",
			callback: () => this.openHexMap(),
		});
		this.addCommand({
			id: "open-hex-table",
			name: "Open hex table",
			callback: () => void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_TABLE }),
		});
		this.addCommand({
			id: "open-random-tables",
			name: "Open random tables",
			callback: () => void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_RANDOM_TABLES }),
		});
		this.addSettingTab(new HexmakerSettingTab(this.app, this));

		interface WithOpenTable { openTable?(path: string): void; }
		this.registerObsidianProtocolHandler("duckmage-roll", (params) => {
			const filePath = params["file"];
			if (!filePath) return;
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
			if (leaves.length > 0) {
				void this.app.workspace.revealLeaf(leaves[0]);
				(leaves[0].view as unknown as WithOpenTable).openTable?.(filePath);
			} else {
				void this.app.workspace.getLeaf("tab").setViewState({
					type: VIEW_TYPE_RANDOM_TABLES,
					state: { filePath },
				});
			}
		});

		interface WithOpenWorkflow { openWorkflow?(path: string): void; }
		this.registerObsidianProtocolHandler("duckmage-workflow", (params) => {
			const filePath = params["file"];
			if (!filePath) return;
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
			if (leaves.length > 0) {
				void this.app.workspace.revealLeaf(leaves[0]);
				(leaves[0].view as unknown as WithOpenWorkflow).openWorkflow?.(filePath);
			} else {
				void this.app.workspace.getLeaf("tab").setViewState({
					type: VIEW_TYPE_RANDOM_TABLES,
					state: { filePath, mode: "workflows" },
				});
			}
		});

		// Keep linked-folder frontmatter in sync when a folder is renamed
		this.registerEvent(
			this.app.vault.on("rename", async (abstractFile, oldPath) => {
				if (!(abstractFile instanceof TFolder)) return;
				const oldFolder = normalizeFolder(oldPath);
				const newFolder = normalizeFolder(abstractFile.path);
				if (oldFolder === newFolder) return;

				const tablesPrefix = normalizeFolder(this.settings.tablesFolder);
				const tableFiles = this.app.vault.getMarkdownFiles().filter(
					(f) => !tablesPrefix || f.path.startsWith(tablesPrefix + "/"),
				);

				for (const tableFile of tableFiles) {
					const lf = this.app.metadataCache.getFileCache(tableFile)?.frontmatter?.["linked-folder"];
					if (!lf || typeof lf !== "string") continue;
					const lfNorm = normalizeFolder(lf);
					if (lfNorm !== oldFolder && !lfNorm.startsWith(oldFolder + "/")) continue;
					const updatedLf = newFolder + lfNorm.slice(oldFolder.length);
					await this.app.fileManager.processFrontMatter(tableFile, (fm) => {
						fm["linked-folder"] = updatedLf;
					});
				}
			}),
		);

		// Remove workflow steps that reference a deleted table file
		this.registerEvent(
			this.app.vault.on("delete", async (abstractFile: TAbstractFile) => {
				if (!(abstractFile instanceof TFile)) return;
				const tablesPrefix = normalizeFolder(this.settings.tablesFolder);
				if (tablesPrefix && !abstractFile.path.startsWith(tablesPrefix + "/")) return;

				// The table path stored in workflows has no .md extension
				const deletedTablePath = abstractFile.path.slice(0, -3);

				const wfPrefix = normalizeFolder(this.settings.workflowsFolder);
				const templatesPath = wfPrefix ? `${wfPrefix}/templates` : "templates";
				const workflowFiles = this.app.vault.getMarkdownFiles().filter(
					(f) => (!wfPrefix || f.path.startsWith(wfPrefix + "/"))
						&& !f.path.startsWith(templatesPath + "/")
						&& !f.basename.startsWith("_"),
				);

				for (const wfFile of workflowFiles) {
					await this.app.vault.process(wfFile, (content) => {
						const workflow = parseWorkflow(content, wfFile.basename);
						const filtered = workflow.steps.filter(s => s.tablePath !== deletedTablePath);
						if (filtered.length === workflow.steps.length) return content;
						workflow.steps = filtered;
						return buildWorkflowContent(workflow);
					});
				}
			}),
		);
	}

	onunload() {}

	private openHexMap(): void {
		void this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_MAP });
	}

	async loadSettings() {
		const data = (await this.loadData()) ?? {};
		// Migrate old single terrainPalette → terrainPalettes
		const anyData = data as Record<string, unknown>;
		if (anyData.terrainPalette && !anyData.terrainPalettes) {
			anyData.terrainPalettes = [{ name: DEFAULT_PALETTE_NAME, terrains: anyData.terrainPalette }];
			delete anyData.terrainPalette;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Deep-clone the regions array so mutations to settings.regions never alias DEFAULT_SETTINGS.regions.
		// Object.assign does a shallow copy, so on first run (data===null) settings.regions IS
		// DEFAULT_SETTINGS.regions – pushing/mutating it would corrupt the constant for the session.
		this.settings.regions = (Array.isArray(this.settings.regions) ? this.settings.regions : []).map(r => {
			const raw = r as unknown as Record<string, unknown>;
			// Migrate roadChains/riverChains → pathChains
			const pathChains = Array.isArray(r.pathChains) ? r.pathChains.map((c: { typeName: string; hexes: string[] }) => ({ typeName: c.typeName, hexes: [...c.hexes] })) : [];
			if (pathChains.length === 0) {
				for (const c of Array.isArray(raw.roadChains)  ? raw.roadChains  as string[][] : [])
					pathChains.push({ typeName: "Road",  hexes: [...c] });
				for (const c of Array.isArray(raw.riverChains) ? raw.riverChains as string[][] : [])
					pathChains.push({ typeName: "River", hexes: [...c] });
			}
			return {
				name: r.name,
				paletteName: r.paletteName ?? DEFAULT_PALETTE_NAME,
				gridSize:   r.gridSize   ? { cols: r.gridSize.cols,   rows: r.gridSize.rows }   : { cols: 20, rows: 16 },
				gridOffset: r.gridOffset ? { x: r.gridOffset.x,       y: r.gridOffset.y }       : { x: 0,    y: 0 },
				pathChains,
			};
		});
		// Migrate legacy flat gridSize/gridOffset/roadChains/riverChains into regions array
		const legacyData = data as Record<string, unknown>;
		if (!Array.isArray(this.settings.regions) || this.settings.regions.length === 0) {
			const legacyPathChains: { typeName: string; hexes: string[] }[] = [];
			for (const c of Array.isArray(legacyData.roadChains)  ? legacyData.roadChains  as string[][] : [])
				legacyPathChains.push({ typeName: "Road",  hexes: [...c] });
			for (const c of Array.isArray(legacyData.riverChains) ? legacyData.riverChains as string[][] : [])
				legacyPathChains.push({ typeName: "River", hexes: [...c] });
			this.settings.regions = [{
				name: "default",
				paletteName: DEFAULT_PALETTE_NAME,
				gridSize:   (legacyData.gridSize   as { cols: number; rows: number }) ?? { cols: 20, rows: 16 },
				gridOffset: (legacyData.gridOffset as { x: number; y: number })       ?? { x: 0, y: 0 },
				pathChains: legacyPathChains,
			}];
		}
		for (const r of this.settings.regions) {
			if (!r.paletteName) r.paletteName = DEFAULT_PALETTE_NAME;
			if (!r.gridOffset) r.gridOffset = { x: 0, y: 0 };
			if (!Array.isArray(r.pathChains)) r.pathChains = [];
		}
		// Migrate roadColor/riverColor → pathTypes
		if (!Array.isArray(this.settings.pathTypes) || this.settings.pathTypes.length === 0) {
			this.settings.pathTypes = DEFAULT_PATH_TYPES.map(p => ({ ...p }));
			const road  = this.settings.pathTypes.find(p => p.name === "Road");
			const river = this.settings.pathTypes.find(p => p.name === "River");
			if (road  && anyData.roadColor  as string) road.color  = anyData.roadColor  as string;
			if (river && anyData.riverColor as string) river.color = anyData.riverColor as string;
		}
		// Migrate "between" routing → "meander"
		for (const pt of this.settings.pathTypes) {
			if ((pt.routing as string) === "between") pt.routing = "meander";
		}
		// Ensure terrainPalettes is valid
		if (!Array.isArray(this.settings.terrainPalettes) || this.settings.terrainPalettes.length === 0) {
			this.settings.terrainPalettes = DEFAULT_SETTINGS.terrainPalettes.map(p => ({
				name: p.name,
				terrains: p.terrains.map(t => ({ ...t })),
			}));
		}
		if (!this.settings.hexOrientation) this.settings.hexOrientation = "pointy";
		if (!this.settings.tablesFolder) this.settings.tablesFolder = "world/tables";
		if (!this.settings.defaultTableDice) this.settings.defaultTableDice = 100;
		if (this.settings.questsFolder === undefined) this.settings.questsFolder = "";
		if (this.settings.featuresFolder === undefined) this.settings.featuresFolder = "";
		if (this.settings.factionsFolder === undefined) this.settings.factionsFolder = "";
		if (this.settings.hexEditorTerrainCollapsed  === undefined) this.settings.hexEditorTerrainCollapsed  = false;
		if (this.settings.hexEditorFeaturesCollapsed === undefined) this.settings.hexEditorFeaturesCollapsed = false;
		if (this.settings.hexEditorNotesCollapsed    === undefined) this.settings.hexEditorNotesCollapsed    = false;
		if (!Array.isArray(this.settings.rollTableExcludedFolders))      this.settings.rollTableExcludedFolders      = ["terrain"];
		if (!Array.isArray(this.settings.encounterTableExcludedFolders)) this.settings.encounterTableExcludedFolders = ["terrain"];
		if (!this.settings.defaultRegion) {
			this.settings.defaultRegion = this.settings.regions[0]?.name ?? "default";
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Filter a list of table files using a two-tier system:
	 *  1. Per-file frontmatter (`filterKey: false` excludes, `filterKey: true` forces include)
	 *  2. Folder-level exclusion list (paths relative to tablesFolder)
	 */
	filterTableFiles(
		files: TFile[],
		filterKey: "roll-filter" | "encounter-filter",
		excludedFolders: string[],
	): TFile[] {
		const folder = normalizeFolder(this.settings.tablesFolder);
		const prefix = folder ? folder + "/" : "";
		return files.filter(f => {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm != null) {
				const val = fm[filterKey];
				if (val === false) return false;
				if (val === true)  return true;
			}
			const rel = prefix ? f.path.slice(prefix.length) : f.path;
			return !excludedFolders.some(exc => rel.startsWith(exc + "/"));
		});
	}

	refreshHexMap(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach(leaf => {
			(leaf.view as HexMapView).renderGrid();
		});
	}

	async loadAvailableIcons() {
		this.vaultIconsSet = new Set();
		const pluginIcons: string[] = Array.from(BUNDLED_ICONS.keys());
		const vaultIcons: string[] = [];

		const iconsFolder = normalizeFolder(this.settings.iconsFolder ?? "");
		if (iconsFolder) {
			const folder = this.app.vault.getAbstractFileByPath(iconsFolder);
			if (folder instanceof TFolder) {
				for (const child of folder.children) {
					if (child instanceof TFile && /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(child.name)) {
						this.vaultIconsSet.add(child.name);
						vaultIcons.push(child.name);
					}
				}
			}
		}

		// Combine both sources, deduplicate by filename, sorted
		this.availableIcons = [...new Set([...pluginIcons, ...vaultIcons])].sort();
	}

	hexPath(x: number, y: number, regionName: string): string {
		const folder = normalizeFolder(this.settings.hexFolder);
		return folder ? `${folder}/${regionName}/${x}_${y}.md` : `${regionName}/${x}_${y}.md`;
	}

	/** Build the Obsidian URI roller link for a table file path. */
	buildRollerLink(filePath: string): string {
		const vault = encodeURIComponent(this.app.vault.getName());
		const file = encodeURIComponent(filePath);
		return `[🎲 Open in Hexmaker Roller](obsidian://duckmage-roll?vault=${vault}&file=${file})`;
	}

	/** Add a roller link to a table file if it doesn't already have one. */
	async ensureRollerLink(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		const link = this.buildRollerLink(filePath);
		await this.app.vault.process(file, (content) => {
			if (content.includes("obsidian://duckmage-roll")) return content;
			const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
			const insertAt = fmMatch ? fmMatch[0].length : 0;
			return content.slice(0, insertAt) + "\n" + link + "\n\n" + content.slice(insertAt);
		});
	}

	/** Add roller links to all existing table files in the tables folder that don't have one. */
	async ensureAllRollerLinks(): Promise<void> {
		const folder = normalizeFolder(this.settings.tablesFolder);
		const prefix = folder ? folder + "/" : "";
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => !prefix || f.path.startsWith(prefix));

		let count = 0;
		for (const file of files) {
			let added = false;
			const link = this.buildRollerLink(file.path);
			await this.app.vault.process(file, (content) => {
				if (content.includes("obsidian://duckmage-roll")) return content;
				added = true;
				const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
				const insertAt = fmMatch ? fmMatch[0].length : 0;
				return content.slice(0, insertAt) + "\n" + link + "\n\n" + content.slice(insertAt);
			});
			if (added) count++;
		}
		new Notice(`Hexmaker: added roller links to ${count} table${count !== 1 ? "s" : ""}.`);
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
						makeTableTemplate(this.settings.defaultTableDice, { "table-type": sectionType, "roll-filter": false, "encounter-filter": false }, this.buildRollerLink(path)),
					);
				} catch { /* ignore */ }
			}
		}

		// Terrain-specific tables
		const subfolder = folder ? `${folder}/terrain` : "terrain";
		if (!this.app.vault.getAbstractFileByPath(subfolder)) {
			try { await this.app.vault.createFolder(subfolder); } catch { /* may already exist */ }
		}

		// Ensure type subfolders exist
		for (const tableType of ["description", "encounters"] as const) {
			const typeSubfolder = `${subfolder}/${tableType}`;
			if (!this.app.vault.getAbstractFileByPath(typeSubfolder)) {
				try { await this.app.vault.createFolder(typeSubfolder); } catch { /* may already exist */ }
			}
		}

		// Migrate any old flat-format files ({name} - {type}.md) to the new subfolder scheme
		for (const entry of this.getAllTerrains()) {
			for (const tableType of ["description", "encounters"] as const) {
				const oldPath = `${subfolder}/${entry.name} - ${tableType}.md`;
				const newPath = `${subfolder}/${tableType}/${entry.name}.md`;
				const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
				if (oldFile instanceof TFile && !this.app.vault.getAbstractFileByPath(newPath)) {
					try { await this.app.fileManager.renameFile(oldFile, newPath); } catch { /* ignore */ }
				}
			}
		}

		// Create any still-missing table files
		for (const entry of this.getAllTerrains()) {
			for (const tableType of ["description", "encounters"] as const) {
				const path = `${subfolder}/${tableType}/${entry.name}.md`;
				if (!this.app.vault.getAbstractFileByPath(path)) {
					try {
						await this.app.vault.create(
							path,
							makeTableTemplate(this.settings.defaultTableDice, { terrain: entry.name, "table-type": tableType, "roll-filter": false, "encounter-filter": false }, this.buildRollerLink(path)),
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
			const tablePath = `${subfolder}/encounters/${terrain}.md`;
			const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
			if (!(tableFile instanceof TFile)) continue;

			const target = this.app.metadataCache.fileToLinktext(tableFile, file.path);
			const linkText = `[[${target}]]`;
			const existing = await getLinksInSection(this.app, file.path, "Encounters Table");
			if (existing.includes(target)) continue;

			await addLinkToSection(this.app, file.path, "Encounters Table", linkText);
			linked++;
		}
		new Notice(`Hexmaker: linked encounters tables for ${linked} hex${linked !== 1 ? "es" : ""}.`);
	}

	/**
	 * Replace the terrain encounters-table link in a single hex's "Encounters Table" section.
	 * Removes any existing link that resolves to a file in the terrain subfolder, then adds
	 * the correct link for the new terrain (if non-null and the table file exists).
	 */
	async syncHexEncounterTableLink(hexFilePath: string, terrain: string | null): Promise<void> {
		const tablesFolder = normalizeFolder(this.settings.tablesFolder);
		const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

		// Remove any links that point to a terrain encounters table
		const existing = await getLinksInSection(this.app, hexFilePath, "Encounters Table");
		for (const linkTarget of existing) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(linkTarget, hexFilePath);
			if (resolved && resolved.path.startsWith(subfolder + "/encounters/")) {
				await removeLinkFromSection(this.app, hexFilePath, "Encounters Table", linkTarget);
			}
		}

		if (!terrain) return;

		const tablePath = `${subfolder}/encounters/${terrain}.md`;
		const tableFile = this.app.vault.getAbstractFileByPath(tablePath);
		if (!(tableFile instanceof TFile)) return;
		const linkText = `[[${this.app.metadataCache.fileToLinktext(tableFile, hexFilePath)}]]`;
		await addLinkToSection(this.app, hexFilePath, "Encounters Table", linkText);
	}

	/**
	 * For every hex note on the map, replace its terrain encounters-table link with the
	 * one matching its current terrain.  Intended as a one-shot repair tool.
	 */
	async refreshAllTerrainEncounterLinks(): Promise<void> {
		const hexFolder = normalizeFolder(this.settings.hexFolder);
		const hexFiles = this.app.vault.getMarkdownFiles().filter(f => {
			if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
			return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
		});

		for (const file of hexFiles) {
			const terrain = getTerrainFromFile(this.app, file.path) ?? null;
			await this.syncHexEncounterTableLink(file.path, terrain);
		}
		new Notice(`Hexmaker: refreshed encounter links for ${hexFiles.length} hex${hexFiles.length !== 1 ? "es" : ""}.`);
	}

	/** Update every hex note whose terrain matches oldName to newName.
	 *  Reads file content directly (not the metadata cache) so successive renames
	 *  don't miss hexes whose cache entry hasn't refreshed yet.
	 *  Returns a Map of filePath → newName for use as terrain overrides when re-rendering. */
	async renameTerrainInHexes(oldName: string, newName: string): Promise<Map<string, string>> {
		const hexFolder = normalizeFolder(this.settings.hexFolder);
		const candidates = this.app.vault.getMarkdownFiles().filter(f => {
			if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
			return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
		});
		const overrides = new Map<string, string>();
		const CHUNK = 10;
		for (let i = 0; i < candidates.length; i += CHUNK) {
			await Promise.all(candidates.slice(i, i + CHUNK).map(async f => {
				// Read raw content — don't trust the stale metadata cache
				const content = await this.app.vault.read(f);
				const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
				if (!fmMatch) return;
				const terrainLine = fmMatch[1].match(/^\s*terrain:\s*(.+)$/m);
				if (!terrainLine || terrainLine[1].trim() !== oldName) return;
				await setTerrainInFile(this.app, f.path, newName);
				overrides.set(f.path, newName);
			}));
		}
		return overrides;
	}

	/** Re-render all open hex map views, passing terrain overrides to bypass the stale metadata cache. */
	refreshHexMapWithOverrides(terrainOverrides: Map<string, string | null>): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).forEach(leaf => {
			(leaf.view as HexMapView).renderGrid(terrainOverrides);
		});
	}

	/** Update terrain filter sets in all open hex table views after a rename. */
	refreshHexTableTerrainRename(oldName: string, newName: string): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_TABLE).forEach(leaf => {
			(leaf.view as HexTableView).renameTerrainInFilters(oldName, newName);
		});
	}

	/** Create a hex note from the configured template (or the built-in default). */
	async createHexNote(x: number, y: number, regionName: string, preloadedTemplate?: string): Promise<TFile | null> {
		const path = this.hexPath(x, y, regionName);
		let content: string;

		if (preloadedTemplate !== undefined) {
			content = preloadedTemplate;
		} else {
			const templatePath = normalizeFolder(this.settings.templatePath ?? "");
			if (templatePath) {
				const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
				if (!(templateFile instanceof TFile)) {
					new Notice("Template not found: " + templatePath);
					return null;
				}
				try {
					content = await this.app.vault.read(templateFile);
				} catch {
					new Notice("Template not found: " + templatePath);
					return null;
				}
			} else {
				content = DEFAULT_HEX_TEMPLATE;
			}
		}

		content = content
			.replace(/\{\{x\}\}/g, String(x))
			.replace(/\{\{y\}\}/g, String(y))
			.replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`);

		const hexBase = normalizeFolder(this.settings.hexFolder);
		const regionFolder = hexBase ? `${hexBase}/${regionName}` : regionName;
		if (!this.app.vault.getAbstractFileByPath(regionFolder)) {
			// Wrap in try/catch: a concurrent worker may have already created the folder.
			try { await this.app.vault.createFolder(regionFolder); } catch { /* exists */ }
		}

		try {
			return await this.app.vault.create(path, content);
		} catch {
			// A concurrent worker may have created this file between our existence check and
			// this create call.  If the file now exists, use it rather than treating it as an error.
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) return existing;
			new Notice("Could not create note at " + path);
			return null;
		}
	}

	/** Read the hex template once (used by bulk generation to avoid N redundant reads). */
	private async loadHexTemplate(): Promise<string | null> {
		const templatePath = normalizeFolder(this.settings.templatePath ?? "");
		if (templatePath) {
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			if (!(templateFile instanceof TFile)) {
				new Notice("Template not found: " + templatePath);
				return null;
			}
			try {
				return await this.app.vault.read(templateFile);
			} catch {
				new Notice("Template not found: " + templatePath);
				return null;
			}
		}
		return DEFAULT_HEX_TEMPLATE;
	}

	/**
	 * Create hex notes for every (x, y) in the cartesian product of xs × ys,
	 * skipping any that already exist on disk.  Returns the number of notes created.
	 */
	async generateHexNotes(
		regionName: string,
		xs: number[],
		ys: number[],
		onProgress?: (done: number) => void,
	): Promise<number> {
		// Read template once — avoids N vault reads for the same file
		const template = await this.loadHexTemplate();
		if (template === null) return 0;

		let created = 0;
		let done = 0;
		const CHUNK = 20;
		const pairs: [number, number][] = [];
		for (const x of xs) for (const y of ys) pairs.push([x, y]);
		for (let i = 0; i < pairs.length; i += CHUNK) {
			await Promise.all(pairs.slice(i, i + CHUNK).map(async ([x, y]) => {
				const path = this.hexPath(x, y, regionName);
				if (!this.app.vault.getAbstractFileByPath(path)) {
					const result = await this.createHexNote(x, y, regionName, template);
					if (result) created++;
				}
				done++;
			}));
			onProgress?.(done);
		}
		return created;
	}

	getRegion(name: string): RegionData | undefined {
		return this.settings.regions.find(r => r.name === name);
	}

	getPaletteByName(name: string): TerrainPalette | undefined {
		return this.settings.terrainPalettes.find(p => p.name === name);
	}

	getRegionPalette(regionName: string): TerrainColor[] {
		const region = this.getRegion(regionName);
		return this.getPaletteByName(region?.paletteName ?? "")?.terrains
			?? this.settings.terrainPalettes[0]?.terrains
			?? [];
	}

	getAllTerrains(): TerrainColor[] {
		const seen = new Set<string>();
		const result: TerrainColor[] = [];
		for (const pal of this.settings.terrainPalettes) {
			for (const t of pal.terrains) {
				if (!seen.has(t.name)) { seen.add(t.name); result.push(t); }
			}
		}
		return result;
	}

	getOrCreateRegion(name: string): RegionData {
		let r = this.getRegion(name);
		if (!r) {
			r = { name, paletteName: DEFAULT_PALETTE_NAME, gridSize: { cols: 20, rows: 16 }, gridOffset: { x: 0, y: 0 }, pathChains: [] };
			this.settings.regions.push(r);
		}
		return r;
	}

	private async migrateHexFilesToDefaultRegion(): Promise<void> {
		const hexFolder = normalizeFolder(this.settings.hexFolder);
		if (!hexFolder) return;
		const defaultFolder = `${hexFolder}/default`;
		if (!this.app.vault.getAbstractFileByPath(defaultFolder)) {
			try { await this.app.vault.createFolder(defaultFolder); } catch { /* exists */ }
		}
		const candidates = this.app.vault.getMarkdownFiles().filter(f => {
			const parent = f.parent?.path ?? "";
			return parent === hexFolder && /^-?\d+_-?\d+$/.test(f.basename);
		});
		let moved = 0;
		for (const file of candidates) {
			const newPath = `${defaultFolder}/${file.name}`;
			if (!this.app.vault.getAbstractFileByPath(newPath)) {
				try { await this.app.fileManager.renameFile(file, newPath); moved++; } catch { /* skip */ }
			}
		}
		if (moved > 0) new Notice(`Hexmaker: migrated ${moved} hex file(s) to "default" region.`);
	}
}

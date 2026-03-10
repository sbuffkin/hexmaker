import { App, ItemView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES } from "./constants";
import { getAllSectionData, setSectionContent, addLinkToSection, addBacklinkToFile } from "./sections";
import { getTerrainFromFile, setTerrainInFile } from "./frontmatter";
import { getIconUrl, normalizeFolder, makeTableTemplate } from "./utils";
import type { TerrainColor, LinkSection } from "./types";
import { RandomTableModal } from "./RandomTableModal";

// Column definitions in template order
const COLUMNS: { key: string; label: string; isLink: boolean }[] = [
	{ key: "description",      label: "Description",    isLink: false },
	{ key: "landmark",         label: "Landmark",       isLink: false },
	{ key: "towns",            label: "Towns",          isLink: true  },
	{ key: "dungeons",         label: "Dungeons",       isLink: true  },
	{ key: "features",         label: "Features",       isLink: true  },
	{ key: "encounters table", label: "Enc. Table",     isLink: true  },
	{ key: "hidden",           label: "Hidden",         isLink: false },
	{ key: "secret",           label: "Secret",         isLink: false },
	{ key: "encounters",       label: "Encounters",     isLink: false },
	{ key: "weather",          label: "Weather",        isLink: false },
	{ key: "hooks & rumors",   label: "Hooks & Rumors", isLink: false },
];

const TRUNCATE_LEN = 120;
const HEX_PATTERN = /^(?:.*\/)?(-?\d+)_(-?\d+)\.md$/;

// ── Terrain filter modal ────────────────────────────────────────────────────

class TerrainFilterModal extends Modal {
	constructor(
		app: App,
		private palette: TerrainColor[],
		private selected: Set<string>,
		private onChange: (selected: Set<string>) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Filter by Terrain");
		const { contentEl } = this;
		contentEl.addClass("duckmage-terrain-filter-modal");

		const list = contentEl.createDiv({ cls: "duckmage-terrain-filter-list" });
		for (const entry of this.palette) {
			// Checkbox inside label — clicking anywhere on the row toggles it
			const lbl = list.createEl("label", { cls: "duckmage-terrain-filter-row" });
			const cb = lbl.createEl("input") as HTMLInputElement;
			cb.type = "checkbox";
			cb.checked = this.selected.has(entry.name);
			cb.addEventListener("change", () => {
				if (cb.checked) this.selected.add(entry.name);
				else this.selected.delete(entry.name);
				this.onChange(new Set(this.selected));
			});
			const swatch = lbl.createSpan({ cls: "duckmage-hex-table-swatch" });
			swatch.style.backgroundColor = entry.color;
			lbl.appendText(entry.name);
		}

		const btnRow = contentEl.createDiv({ cls: "duckmage-terrain-filter-btns" });
		const clearBtn = btnRow.createEl("button", { text: "Clear all" });
		clearBtn.addEventListener("click", () => {
			this.selected.clear();
			this.onChange(new Set(this.selected));
			// Uncheck all visible checkboxes
			contentEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]")
				.forEach(cb => { cb.checked = false; });
		});
		btnRow.createEl("button", { text: "Done", cls: "mod-cta" })
			.addEventListener("click", () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Cell detail / edit modal ────────────────────────────────────────────────

class HexCellModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private body: string,
		private isLink: boolean,
		private filePath?: string,
		private sectionKey?: string,
		private onSave?: (newContent: string) => void,
		private beforeSave?: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		const { contentEl } = this;
		contentEl.addClass("duckmage-cell-modal");

		if (this.isLink) {
			const list = contentEl.createEl("ul", { cls: "duckmage-cell-modal-list" });
			for (const item of this.body.split(", ")) {
				list.createEl("li", { text: item });
			}
		} else {
			const textarea = contentEl.createEl("textarea", { cls: "duckmage-cell-modal-textarea" });
			textarea.value = this.body;

			const saveBtn = contentEl.createEl("button", {
				text: "Save",
				cls: "duckmage-cell-modal-save mod-cta",
			});
			saveBtn.addEventListener("click", async () => {
				const newContent = textarea.value;
				if (this.filePath && this.sectionKey) {
					await this.beforeSave?.();
					await setSectionContent(this.app, this.filePath, this.sectionKey, newContent);
					this.onSave?.(newContent.trim());
				}
				this.close();
			});
		}
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Multi-link navigation modal ──────────────────────────────────────────────

class MultiLinkNavModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private linkTargets: string[],
		private sourcePath: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		const { contentEl } = this;
		contentEl.addClass("duckmage-link-picker-modal");
		const list = contentEl.createEl("ul", { cls: "duckmage-link-picker-list" });
		for (const target of this.linkTargets) {
			const li = list.createEl("li", { cls: "duckmage-link-picker-item", text: target });
			li.addEventListener("click", () => {
				const file = this.app.metadataCache.getFirstLinkpathDest(target, this.sourcePath);
				if (file instanceof TFile) {
					this.app.workspace.getLeaf(false).openFile(file);
					this.close();
				}
			});
		}
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Terrain picker modal ──────────────────────────────────────────────────────

class TerrainPickerModal extends Modal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private hexPath: string,
		private currentTerrain: string | null,
		private onPicked: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Select terrain");
		const { contentEl } = this;
		contentEl.addClass("duckmage-terrain-picker-modal");

		const grid = contentEl.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-full" });
		for (const entry of this.plugin.settings.terrainPalette) {
			const btn = grid.createDiv({
				cls: `duckmage-terrain-option${entry.name === this.currentTerrain ? " is-selected" : ""}`,
			});
			const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
			preview.style.backgroundColor = entry.color;
			if (entry.icon) {
				const img = preview.createEl("img", { cls: "duckmage-terrain-preview-icon" });
				img.src = getIconUrl(this.plugin, entry.icon);
				img.alt = entry.name;
			}
			btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });
			btn.addEventListener("click", async () => {
				if (!this.app.vault.getAbstractFileByPath(this.hexPath)) {
					await this.plugin.createHexNote(
						...this.hexPath.replace(/\.md$/, "").split("/").pop()!.split("_").map(Number) as [number, number],
					);
				}
				await setTerrainInFile(this.app, this.hexPath, entry.name);
				this.onPicked();
				this.close();
			});
		}

		if (this.currentTerrain) {
			const clearBtn = contentEl.createEl("button", {
				text: "Clear terrain",
				cls: "duckmage-clear-btn mod-warning",
			});
			clearBtn.addEventListener("click", async () => {
				await setTerrainInFile(this.app, this.hexPath, null);
				this.onPicked();
				this.close();
			});
		}
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Link picker modal (Towns / Dungeons) ─────────────────────────────────────

class LinkPickerModal extends Modal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private hexPath: string,
		private section: LinkSection,
		private sourceFolder: string,
		private onLinked: () => void,
		private createTemplate = "",
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(`Add ${this.section}`);
		contentEl.addClass("duckmage-link-picker-modal");

		// ── Existing files list ──────────────────────────────────────────────
		const normalized = normalizeFolder(this.sourceFolder);
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => !normalized || f.path.startsWith(normalized + "/"))
			.filter(f => !f.basename.startsWith("_"))
			.sort((a, b) => a.basename.localeCompare(b.basename));

		if (files.length > 0) {
			contentEl.createEl("p", { text: "Select existing:", cls: "duckmage-link-picker-heading" });
			const list = contentEl.createEl("ul", { cls: "duckmage-link-picker-list" });
			for (const file of files) {
				const li = list.createEl("li", { cls: "duckmage-link-picker-item" });
				li.setText(file.basename);
				li.addEventListener("click", async () => {
					await this.addLink(file);
				});
			}
		}

		// ── Create new ───────────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Or create new:", cls: "duckmage-link-picker-heading" });
		const row = contentEl.createDiv({ cls: "duckmage-link-picker-create-row" });
		const input = row.createEl("input", { type: "text", cls: "duckmage-link-picker-input" });
		input.placeholder = `${this.section.slice(0, -1)} name…`;
		const createBtn = row.createEl("button", { text: "Create", cls: "mod-cta" });
		createBtn.addEventListener("click", () => this.createAndLink(input.value.trim()));
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") this.createAndLink(input.value.trim());
		});
	}

	private async addLink(file: TFile): Promise<void> {
		await this.ensureHexNote();
		const linkText = `[[${this.app.metadataCache.fileToLinktext(file, this.hexPath)}]]`;
		await addLinkToSection(this.app, this.hexPath, this.section, linkText);
		await addBacklinkToFile(this.app, file.path, this.hexPath);
		this.onLinked();
		this.close();
	}

	private async createAndLink(name: string): Promise<void> {
		if (!name) return;
		const folder = normalizeFolder(this.sourceFolder);
		const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
		let file = this.app.vault.getAbstractFileByPath(newPath);
		if (!(file instanceof TFile)) {
			try {
				if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
					await this.app.vault.createFolder(folder);
				}
				file = await this.app.vault.create(newPath, this.createTemplate);
			} catch (err) {
				new Notice(`Could not create ${newPath}: ${err}`);
				return;
			}
		}
		await this.addLink(file as TFile);
	}

	private async ensureHexNote(): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(this.hexPath);
		if (existing instanceof TFile) return;
		const folder = this.hexPath.includes("/")
			? this.hexPath.slice(0, this.hexPath.lastIndexOf("/"))
			: "";
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		await this.app.vault.create(this.hexPath, "");
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Main view ───────────────────────────────────────────────────────────────

export class HexTableView extends ItemView {
	private scrollEl: HTMLElement | null = null;
	private updateTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// Filter state
	private filterXMin: number | null = null;
	private filterXMax: number | null = null;
	private filterYMin: number | null = null;
	private filterYMax: number | null = null;
	private filterTerrains = new Set<string>();
	private filterHasTown = false;
	private filterHasDungeon = false;

	// Filter UI elements (created once in onOpen)
	private filterXMinInput: HTMLInputElement | null = null;
	private filterXMaxInput: HTMLInputElement | null = null;
	private filterYMinInput: HTMLInputElement | null = null;
	private filterYMaxInput: HTMLInputElement | null = null;
	private terrainFilterBtn: HTMLButtonElement | null = null;
	private townCb: HTMLInputElement | null = null;
	private dungeonCb: HTMLInputElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: DuckmagePlugin) {
		super(leaf);
	}

	getViewType():    string { return VIEW_TYPE_HEX_TABLE; }
	getDisplayText(): string { return "Hex table"; }

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("duckmage-hex-table-container");

		// ── Toolbar ──────────────────────────────────────────────────────────
		const toolbar = contentEl.createDiv({ cls: "duckmage-hex-table-toolbar" });

		const refreshBtn = toolbar.createEl("button", { text: "Refresh", cls: "duckmage-filter-btn" });
		refreshBtn.addEventListener("click", () => void this.loadTable());

		toolbar.createDiv({ cls: "duckmage-filter-separator" });

		// X range filter
		toolbar.createSpan({ text: "X:", cls: "duckmage-filter-label" });
		this.filterXMinInput = toolbar.createEl("input", { cls: "duckmage-filter-range-input" }) as HTMLInputElement;
		this.filterXMinInput.type = "number";
		this.filterXMinInput.placeholder = "min";
		this.filterXMinInput.addEventListener("input", () => {
			const v = this.filterXMinInput!.value;
			this.filterXMin = v !== "" ? Number(v) : null;
			this.applyFilters();
		});
		toolbar.createSpan({ text: "–", cls: "duckmage-filter-label" });
		this.filterXMaxInput = toolbar.createEl("input", { cls: "duckmage-filter-range-input" }) as HTMLInputElement;
		this.filterXMaxInput.type = "number";
		this.filterXMaxInput.placeholder = "max";
		this.filterXMaxInput.addEventListener("input", () => {
			const v = this.filterXMaxInput!.value;
			this.filterXMax = v !== "" ? Number(v) : null;
			this.applyFilters();
		});

		toolbar.createDiv({ cls: "duckmage-filter-separator" });

		// Y range filter
		toolbar.createSpan({ text: "Y:", cls: "duckmage-filter-label" });
		this.filterYMinInput = toolbar.createEl("input", { cls: "duckmage-filter-range-input" }) as HTMLInputElement;
		this.filterYMinInput.type = "number";
		this.filterYMinInput.placeholder = "min";
		this.filterYMinInput.addEventListener("input", () => {
			const v = this.filterYMinInput!.value;
			this.filterYMin = v !== "" ? Number(v) : null;
			this.applyFilters();
		});
		toolbar.createSpan({ text: "–", cls: "duckmage-filter-label" });
		this.filterYMaxInput = toolbar.createEl("input", { cls: "duckmage-filter-range-input" }) as HTMLInputElement;
		this.filterYMaxInput.type = "number";
		this.filterYMaxInput.placeholder = "max";
		this.filterYMaxInput.addEventListener("input", () => {
			const v = this.filterYMaxInput!.value;
			this.filterYMax = v !== "" ? Number(v) : null;
			this.applyFilters();
		});

		toolbar.createDiv({ cls: "duckmage-filter-separator" });

		// Terrain multi-select filter
		this.terrainFilterBtn = toolbar.createEl("button", {
			text: "Terrain: All",
			cls: "duckmage-filter-btn",
		});
		this.terrainFilterBtn.addEventListener("click", () => {
			const palette = this.plugin.settings.terrainPalette ?? [];
			new TerrainFilterModal(this.app, palette, new Set(this.filterTerrains), (selected) => {
				this.filterTerrains = selected;
				this.updateTerrainBtnLabel();
				this.applyFilters();
			}).open();
			// Note: onChange fires live as checkboxes are toggled inside the modal
		});

		toolbar.createDiv({ cls: "duckmage-filter-separator" });

		// Has Town checkbox
		const townLabel = toolbar.createEl("label", { cls: "duckmage-filter-check-label" });
		this.townCb = townLabel.createEl("input") as HTMLInputElement;
		this.townCb.type = "checkbox";
		townLabel.appendText(" Has Town");
		this.townCb.addEventListener("change", () => {
			this.filterHasTown = this.townCb!.checked;
			this.applyFilters();
		});

		// Has Dungeon checkbox
		const dungeonLabel = toolbar.createEl("label", { cls: "duckmage-filter-check-label" });
		this.dungeonCb = dungeonLabel.createEl("input") as HTMLInputElement;
		this.dungeonCb.type = "checkbox";
		dungeonLabel.appendText(" Has Dungeon");
		this.dungeonCb.addEventListener("change", () => {
			this.filterHasDungeon = this.dungeonCb!.checked;
			this.applyFilters();
		});

		toolbar.createDiv({ cls: "duckmage-filter-separator" });

		// Clear all filters
		const clearBtn = toolbar.createEl("button", { text: "Clear filters", cls: "duckmage-filter-btn" });
		clearBtn.addEventListener("click", () => this.clearFilters());

		// ── Scroll area ───────────────────────────────────────────────────────
		this.scrollEl = contentEl.createDiv({ cls: "duckmage-hex-table-scroll" });
		this.scrollEl.createSpan({ text: "Loading…", cls: "duckmage-hex-table-empty" });

		// ── Vault event listeners ─────────────────────────────────────────────
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (!(file instanceof TFile)) return;
			const folder = normalizeFolder(this.plugin.settings.hexFolder);
			if (folder && !file.path.startsWith(folder + "/")) return;
			if (!HEX_PATTERN.test(file.path)) return;

			const existing = this.updateTimers.get(file.path);
			if (existing) clearTimeout(existing);
			this.updateTimers.set(file.path, setTimeout(() => {
				this.updateTimers.delete(file.path);
				void this.updateRow(file.path);
			}, 300));
		}));

		this.registerEvent(this.app.vault.on("create", (file) => {
			if (!(file instanceof TFile)) return;
			const folder = normalizeFolder(this.plugin.settings.hexFolder);
			if (folder && !file.path.startsWith(folder + "/")) return;
			if (!HEX_PATTERN.test(file.path)) return;
			void this.loadTable();
		}));

		void this.loadTable();
	}

	async onClose(): Promise<void> {
		for (const timer of this.updateTimers.values()) clearTimeout(timer);
		this.updateTimers.clear();
		this.contentEl.empty();
	}

	async loadTable(): Promise<void> {
		if (!this.scrollEl) return;
		this.scrollEl.empty();
		this.scrollEl.createSpan({ text: "Loading…", cls: "duckmage-hex-table-empty" });

		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		let files: { path: string; x: number; y: number }[] = [];

		try {
			const listing = await this.app.vault.adapter.list(folder || "/");
			for (const filePath of listing.files) {
				const m = HEX_PATTERN.exec(filePath);
				if (m) files.push({ path: filePath, x: Number(m[1]), y: Number(m[2]) });
			}
		} catch {
			this.scrollEl.empty();
			this.scrollEl.createSpan({ text: "Could not read hex folder.", cls: "duckmage-hex-table-empty" });
			return;
		}

		files.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

		if (files.length === 0) {
			this.scrollEl.empty();
			this.scrollEl.createSpan({ text: "No hex notes found.", cls: "duckmage-hex-table-empty" });
			return;
		}

		// Update X/Y input placeholders with actual data bounds
		const xs = files.map(f => f.x);
		const ys = files.map(f => f.y);
		if (this.filterXMinInput) this.filterXMinInput.placeholder = String(Math.min(...xs));
		if (this.filterXMaxInput) this.filterXMaxInput.placeholder = String(Math.max(...xs));
		if (this.filterYMinInput) this.filterYMinInput.placeholder = String(Math.min(...ys));
		if (this.filterYMaxInput) this.filterYMaxInput.placeholder = String(Math.max(...ys));

		// Read all section data in parallel
		const sectionData = await Promise.all(
			files.map(f => getAllSectionData(this.app, f.path)),
		);

		// Build table
		const table = document.createElement("table");
		table.className = "duckmage-hex-table";

		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Hex" });
		headerRow.createEl("th", { text: "Terrain" });
		for (const col of COLUMNS) {
			headerRow.createEl("th", { text: col.label });
		}

		const tbody = table.createEl("tbody");
		for (let i = 0; i < files.length; i++) {
			const { path, x, y } = files[i];
			const { text, links } = sectionData[i];
			const tr = tbody.createEl("tr");
			tr.dataset.hexPath = path;
			this.fillRow(tr, path, x, y, text, links);
		}

		this.scrollEl.empty();
		this.scrollEl.appendChild(table);
		this.addColumnResizers(table);
		this.applyFilters();
	}

	// ── Filter helpers ────────────────────────────────────────────────────────


	private updateTerrainBtnLabel(): void {
		if (!this.terrainFilterBtn) return;
		const count = this.filterTerrains.size;
		this.terrainFilterBtn.setText(count === 0 ? "Terrain: All" : `Terrain: ${count} selected`);
		this.terrainFilterBtn.toggleClass("duckmage-filter-active", count > 0);
	}

	private clearFilters(): void {
		this.filterXMin = null;
		this.filterXMax = null;
		this.filterYMin = null;
		this.filterYMax = null;
		this.filterTerrains = new Set();
		this.filterHasTown = false;
		this.filterHasDungeon = false;

		if (this.filterXMinInput) this.filterXMinInput.value = "";
		if (this.filterXMaxInput) this.filterXMaxInput.value = "";
		if (this.filterYMinInput) this.filterYMinInput.value = "";
		if (this.filterYMaxInput) this.filterYMaxInput.value = "";
		if (this.townCb)    this.townCb.checked = false;
		if (this.dungeonCb) this.dungeonCb.checked = false;
		this.updateTerrainBtnLabel();
		this.applyFilters();
	}

	private applyFilters(): void {
		if (!this.scrollEl) return;
		const tbody = this.scrollEl.querySelector("tbody");
		if (!tbody) return;

		for (const tr of Array.from(tbody.rows)) {
			const x = Number(tr.dataset.hexX);
			const y = Number(tr.dataset.hexY);
			const terrain = tr.dataset.terrain ?? "";
			const hasTown    = tr.dataset.hasTown    === "1";
			const hasDungeon = tr.dataset.hasDungeon === "1";

			let show = true;
			if (this.filterXMin !== null && x < this.filterXMin) show = false;
			if (this.filterXMax !== null && x > this.filterXMax) show = false;
			if (this.filterYMin !== null && y < this.filterYMin) show = false;
			if (this.filterYMax !== null && y > this.filterYMax) show = false;
			if (this.filterTerrains.size > 0 && !this.filterTerrains.has(terrain)) show = false;
			if (this.filterHasTown    && !hasTown)    show = false;
			if (this.filterHasDungeon && !hasDungeon) show = false;

			tr.classList.toggle("duckmage-row-hidden", !show);
		}
	}

	// ── Row rendering ─────────────────────────────────────────────────────────

	private fillRow(
		tr: HTMLTableRowElement,
		path: string,
		x: number,
		y: number,
		text: Map<string, string>,
		links: Map<string, string[]>,
	): void {
		tr.empty();

		const palette = this.plugin.settings.terrainPalette ?? [];
		const terrainName = getTerrainFromFile(this.app, path);
		const terrainEntry = terrainName ? palette.find(p => p.name === terrainName) : undefined;

		const hasTown    = (links.get("towns")    ?? []).length > 0;
		const hasDungeon = (links.get("dungeons") ?? []).length > 0;

		// Store filter-relevant data on the row
		tr.dataset.hexX      = String(x);
		tr.dataset.hexY      = String(y);
		tr.dataset.terrain   = terrainName ?? "";
		tr.dataset.hasTown    = hasTown    ? "1" : "0";
		tr.dataset.hasDungeon = hasDungeon ? "1" : "0";

		// Coords cell — click to open note
		const coordsTd = tr.createEl("td");
		const coordsSpan = coordsTd.createSpan({
			text: `${x},${y}`,
			cls: "duckmage-hex-table-coords",
		});
		coordsSpan.addEventListener("click", () => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				void this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		// Terrain cell
		const terrainTd = tr.createEl("td", { cls: "duckmage-hex-table-cell-clickable" });
		const renderTerrainCell = () => {
			terrainTd.empty();
			const current = getTerrainFromFile(this.app, path);
			const entry = current ? palette.find(p => p.name === current) : undefined;
			if (entry) {
				const swatch = terrainTd.createSpan({ cls: "duckmage-hex-table-swatch" });
				swatch.style.backgroundColor = entry.color;
				terrainTd.appendText(entry.name);
			} else {
				terrainTd.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
			}
		};
		renderTerrainCell();
		terrainTd.addEventListener("click", () => {
			const current = getTerrainFromFile(this.app, path);
			new TerrainPickerModal(this.app, this.plugin, path, current, () => {
				renderTerrainCell();
			}).open();
		});

		// Section cells
		for (const col of COLUMNS) {
			const td = tr.createEl("td");
			if (col.isLink) {
				const linkList = links.get(col.key) ?? [];
				if (linkList.length > 0) {
					const full = linkList.join(", ");
					td.dataset.fullContent = full;
					td.setText(full);
				} else {
					td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
				}
				// Towns, Dungeons, and Encounters Table: existing items open the file/roll; empty cell opens picker
				if (col.key === "towns" || col.key === "dungeons" || col.key === "encounters table") {
					const sourceFolder = col.key === "towns"
						? this.plugin.settings.townsFolder
						: col.key === "dungeons"
						? this.plugin.settings.dungeonsFolder
						: this.plugin.settings.tablesFolder;
					const section = col.key === "towns" ? "Towns" : col.key === "dungeons" ? "Dungeons" : "Encounters Table";
					td.addClass("duckmage-hex-table-cell-clickable");
					td.addEventListener("click", () => {
						if (linkList.length === 0) {
							new LinkPickerModal(
								this.app, this.plugin, path, section, sourceFolder,
								() => void this.updateRow(path),
								col.key === "encounters table" ? makeTableTemplate(this.plugin.settings.defaultTableDice) : "",
							).open();
						} else if (linkList.length === 1) {
							if (col.key === "encounters table") {
								const file = this.app.metadataCache.getFirstLinkpathDest(linkList[0], path);
								if (file instanceof TFile) {
									new RandomTableModal(this.app, this.plugin, (result) => {
										navigator.clipboard.writeText(result);
									}).open();
								}
							} else {
								const file = this.app.metadataCache.getFirstLinkpathDest(linkList[0], path);
								if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
							}
						} else {
							// Multiple: show a nav list
							new MultiLinkNavModal(this.app, `${x},${y} — ${section}`, linkList, path).open();
						}
					});
				} else if (linkList.length > 0) {
					td.addClass("duckmage-hex-table-cell-clickable");
					td.addEventListener("click", () => {
						const current = td.dataset.fullContent ?? "";
						new HexCellModal(this.app, `${x},${y} — ${col.label}`, current, true).open();
					});
				}
			} else {
				const content = text.get(col.key) ?? "";
				td.dataset.fullContent = content;
				if (content) {
					const display = content.length > TRUNCATE_LEN
						? content.slice(0, TRUNCATE_LEN) + "…"
						: content;
					td.setText(display);
				} else {
					td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
				}
				td.addClass("duckmage-hex-table-cell-clickable");
				td.addEventListener("click", () => {
					const current = td.dataset.fullContent ?? "";
					new HexCellModal(
						this.app, `${x},${y} — ${col.label}`, current, false,
						path, col.key,
						(saved) => {
							td.dataset.fullContent = saved;
							td.empty();
							if (saved) {
								const newDisplay = saved.length > TRUNCATE_LEN
									? saved.slice(0, TRUNCATE_LEN) + "…"
									: saved;
								td.setText(newDisplay);
							} else {
								td.createSpan({ text: "–", cls: "duckmage-hex-table-empty" });
							}
						},
						async () => {
							if (!this.app.vault.getAbstractFileByPath(path)) {
								await this.plugin.createHexNote(x, y);
							}
						},
					).open();
				});
			}
		}
	}

	// ── Column resizing ───────────────────────────────────────────────────────

	private addColumnResizers(table: HTMLTableElement): void {
		const ths = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));

		// Default widths (px): Hex, Terrain, then one per COLUMN entry
		const defaultWidths = [60, 110, 220, 160, 150, 150, 150, 140, 160, 160, 160, 140, 190];

		// <col> elements + explicit table width is the only reliable way to drive
		// table-layout:fixed column widths across browsers.
		const colgroup = document.createElement("colgroup");
		const cols: HTMLTableColElement[] = [];
		let totalWidth = 0;
		for (let i = 0; i < ths.length; i++) {
			const w = defaultWidths[i] ?? 160;
			const col = document.createElement("col") as HTMLTableColElement;
			col.style.width = `${w}px`;
			colgroup.appendChild(col);
			cols.push(col);
			totalWidth += w;
		}
		table.insertBefore(colgroup, table.firstChild);
		table.style.width = `${totalWidth}px`;

		for (let i = 0; i < ths.length; i++) {
			const col = cols[i];

			const handle = ths[i].createDiv({ cls: "duckmage-col-resizer" });
			handle.addEventListener("mousedown", (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				const startX  = e.clientX;
				const startW  = parseInt(col.style.width, 10);
				const startTW = parseInt(table.style.width, 10);
				document.body.style.cursor = "col-resize";

				const onMove = (me: MouseEvent) => {
					const newW = Math.max(20, startW + me.clientX - startX);
					const delta = newW - parseInt(col.style.width, 10);
					col.style.width    = `${newW}px`;
					table.style.width  = `${startTW + (newW - startW)}px`;
				};
				const onUp = () => {
					document.body.style.cursor = "";
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup",   onUp);
				};
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup",   onUp);
			});
		}
	}

	private async updateRow(path: string): Promise<void> {
		if (!this.scrollEl) return;
		const tr = this.scrollEl.querySelector<HTMLTableRowElement>(
			`tr[data-hex-path="${CSS.escape(path)}"]`,
		);
		if (!tr) return;

		const m = HEX_PATTERN.exec(path);
		if (!m) return;
		const x = Number(m[1]);
		const y = Number(m[2]);

		const { text, links } = await getAllSectionData(this.app, path);
		this.fillRow(tr, path, x, y, text, links);
		this.applyFilters();
	}
}

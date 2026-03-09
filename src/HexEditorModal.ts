import { App, Modal, Notice, TFile } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { getIconUrl, normalizeFolder } from "./utils";
import { getTerrainFromFile, setTerrainInFile, getIconOverrideFromFile, setIconOverrideInFile } from "./frontmatter";
import { addLinkToSection, removeLinkFromSection, getLinksInSection, getAllSectionData, setSectionContent, addBacklinkToFile } from "./sections";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { TEXT_SECTIONS } from "./types";
import type { LinkSection } from "./types";

export class HexEditorModal extends Modal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private x: number,
		private y: number,
		private onChanged: (terrainOverrides?: Map<string, string | null>, iconOverrides?: Map<string, string | null>) => void,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("duckmage-hex-editor");

		const path = this.plugin.hexPath(this.x, this.y);
		const hexExists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;

		// Fetch all section data in one file read before touching the DOM
		let allText  = new Map<string, string>();
		let allLinks = new Map<string, string[]>();
		if (hexExists) {
			({ text: allText, links: allLinks } = await getAllSectionData(this.app, path));
		}

		// Render entire modal synchronously from pre-fetched data — no more chunked paints
		contentEl.empty();
		const titleRow = contentEl.createDiv({ cls: "duckmage-editor-title-row" });
		titleRow.createEl("h2", { text: `Hex ${this.x}, ${this.y}` });
		if (hexExists) {
			const file = this.app.vault.getAbstractFileByPath(path) as TFile;
			const openLink = titleRow.createEl("a", { text: "Open note", cls: "duckmage-editor-open-link" });
			openLink.addEventListener("click", () => {
				this.app.workspace.getLeaf("tab").openFile(file);
				this.close();
			});
		}

		this.renderTerrainSection(contentEl, path);

		contentEl.createEl("hr", { cls: "duckmage-editor-divider" });
		contentEl.createEl("h3", { text: "World features" });

		this.renderDropdownSection(contentEl, path, "Towns",    hexExists, this.plugin.settings.townsFolder,    allLinks.get("towns")    ?? []);
		this.renderDropdownSection(contentEl, path, "Dungeons", hexExists, this.plugin.settings.dungeonsFolder, allLinks.get("dungeons") ?? []);
		this.renderLinkSection(contentEl, path, "Features", hexExists, allLinks.get("features") ?? []);

		contentEl.createEl("hr", { cls: "duckmage-editor-divider" });
		contentEl.createEl("h3", { text: "Notes" });

		for (const { key, label } of TEXT_SECTIONS) {
			this.renderTextSection(contentEl, path, key, label, allText.get(key) ?? "");
		}
	}

	onClose() { this.contentEl.empty(); }

	private renderTerrainSection(container: HTMLElement, path: string): void {
		const currentTerrain = getTerrainFromFile(this.app, path);
		const palette = this.plugin.settings.terrainPalette;

		const section = container.createDiv({ cls: "duckmage-editor-section" });
		section.createEl("h3", { text: "Terrain" });

		const grid = section.createDiv({ cls: "duckmage-terrain-picker" });

		for (const entry of palette) {
			const btn = grid.createDiv({
				cls: `duckmage-terrain-option${entry.name === currentTerrain ? " is-selected" : ""}`,
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
				await this.ensureHexNote();
				await setTerrainInFile(this.app, path, entry.name);
				this.onChanged(new Map([[path, entry.name]]));
				this.close();
			});
		}

		// Icon override + inline Clear terrain
		const iconRow = section.createDiv({ cls: "duckmage-icon-override-row" });
		iconRow.createSpan({ text: "Icon override", cls: "duckmage-icon-override-label" });
		const iconSelect = iconRow.createEl("select", { cls: "duckmage-icon-override-select" });
		if (currentTerrain) {
			const clearBtn = iconRow.createEl("button", { text: "Clear terrain", cls: "duckmage-clear-btn mod-warning" });
			clearBtn.addEventListener("click", async () => {
				await setTerrainInFile(this.app, path, null);
				this.onChanged(new Map([[path, null]]));
				this.close();
			});
		}
		iconSelect.createEl("option", { value: "", text: "— use terrain default —" });
		for (const icon of this.plugin.availableIcons) {
			const label = icon.replace(/^bw-/, "").replace(/\.png$/, "").replace(/-/g, " ");
			iconSelect.createEl("option", { value: icon, text: label });
		}
		iconSelect.value = getIconOverrideFromFile(this.app, path) ?? "";
		iconSelect.addEventListener("change", async () => {
			await this.ensureHexNote();
			await setIconOverrideInFile(this.app, path, iconSelect.value || null);
			this.onChanged(undefined, new Map([[path, iconSelect.value || null]]));
		});
	}

	private getFilesForDropdown(folder: string): TFile[] {
		const normalized = normalizeFolder(folder);
		const all = this.app.vault.getMarkdownFiles();
		const scoped = normalized ? all.filter(f => f.path.startsWith(normalized + "/")) : all;
		return scoped
			.filter(f => !f.basename.startsWith("_"))
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	private renderDropdownSection(
		container: HTMLElement,
		path: string,
		section: LinkSection,
		hexExists: boolean,
		sourceFolder: string,
		initialLinks: string[],
	): void {
		const sectionEl = container.createDiv({ cls: "duckmage-editor-link-section" });
		const header = sectionEl.createDiv({ cls: "duckmage-link-section-header" });
		header.createEl("h4", { text: section });

		const select = header.createEl("select", { cls: "duckmage-link-select" });
		select.createEl("option", { value: "", text: "— add —" });
		for (const file of this.getFilesForDropdown(sourceFolder)) {
			select.createEl("option", { value: file.path, text: file.basename });
		}

		const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

		const refresh = async () => {
			linksEl.empty();
			this.renderLinkList(linksEl, await getLinksInSection(this.app, path, section), path, onRemove);
		};

		const onRemove = async (link: string) => {
			await removeLinkFromSection(this.app, path, section, link);
			this.onChanged();
			await refresh();
		};

		if (hexExists) {
			this.renderLinkList(linksEl, initialLinks, path, onRemove);
		} else {
			linksEl.createSpan({ text: "None", cls: "duckmage-link-empty" });
		}

		select.addEventListener("change", async () => {
			const selectedPath = select.value;
			select.value = "";
			if (!selectedPath) return;
			const file = this.app.vault.getAbstractFileByPath(selectedPath);
			if (!(file instanceof TFile)) return;
			const hexFile = await this.ensureHexNote();
			if (!hexFile) { new Notice("Could not create hex note."); return; }
			const linkText = `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`;
			await addLinkToSection(this.app, path, section, linkText);
			await addBacklinkToFile(this.app, file.path, path);
			this.onChanged();
			await refresh();
		});
	}

	private renderLinkSection(
		container: HTMLElement,
		path: string,
		section: LinkSection,
		hexExists: boolean,
		initialLinks: string[],
	): void {
		const sectionEl = container.createDiv({ cls: "duckmage-editor-link-section" });
		const header = sectionEl.createDiv({ cls: "duckmage-link-section-header" });
		header.createEl("h4", { text: section });
		const addBtn = header.createEl("button", { text: "+ Add", cls: "duckmage-add-btn" });
		const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

		if (hexExists) {
			this.renderLinkList(linksEl, initialLinks, path);
		} else {
			linksEl.createSpan({ text: "—", cls: "duckmage-link-empty" });
		}

		addBtn.addEventListener("click", () => {
			new FileLinkSuggestModal(this.app, this.plugin, async (file) => {
				const hexFile = await this.ensureHexNote();
				if (!hexFile) { new Notice("Could not create hex note."); return; }
				const linkText = `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`;
				await addLinkToSection(this.app, path, section, linkText);
				this.onChanged();
				const links = await getLinksInSection(this.app, path, section);
				linksEl.empty();
				this.renderLinkList(linksEl, links, path);
			}).open();
		});
	}

	private renderLinkList(
		container: HTMLElement,
		links: string[],
		sourcePath: string,
		onRemove?: (link: string) => void,
	): void {
		if (links.length === 0) {
			container.createSpan({ text: "None", cls: "duckmage-link-empty" });
		} else {
			for (const link of links) {
				const item = container.createDiv({ cls: "duckmage-link-item" });
				const label = item.createSpan({ text: `[[${link}]]`, cls: "duckmage-link-item-label" });
				const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
				if (file instanceof TFile) {
					label.addClass("duckmage-link-item-clickable");
					label.addEventListener("click", () => {
						this.app.workspace.getLeaf("tab").openFile(file);
						this.close();
					});
				}
				if (onRemove) {
					const removeBtn = item.createEl("button", { text: "×", cls: "duckmage-link-remove-btn" });
					removeBtn.addEventListener("click", () => onRemove(link));
				}
			}
		}
	}

	private renderTextSection(
		container: HTMLElement,
		path: string,
		section: string,
		label: string,
		initialContent: string,
	): void {
		const sectionEl = container.createDiv({ cls: "duckmage-editor-text-section" });
		sectionEl.createEl("label", { text: label, cls: "duckmage-text-section-label" });
		const textarea = sectionEl.createEl("textarea", { cls: "duckmage-text-section-textarea" });
		textarea.rows = 3;
		textarea.placeholder = `${label}…`;
		textarea.value = initialContent;

		textarea.addEventListener("blur", async () => {
			const file = await this.ensureHexNote();
			if (!file) return;
			await setSectionContent(this.app, path, section, textarea.value);
			this.onChanged();
		});
	}

	private async ensureHexNote(): Promise<TFile | null> {
		const path = this.plugin.hexPath(this.x, this.y);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return this.plugin.createHexNote(this.x, this.y);
	}
}

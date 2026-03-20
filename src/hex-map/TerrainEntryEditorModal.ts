import { App, Setting, TFile } from "obsidian";
import { DuckmageModal } from "../DuckmageModal";
import type DuckmagePlugin from "../DuckmagePlugin";
import type { TerrainColor } from "../types";
import { normalizeFolder } from "../utils";

export class TerrainEntryEditorModal extends DuckmageModal {
	// Pending values — only written to the entry on Save
	private pendingName: string;
	private pendingColor: string;
	private pendingIcon: string | undefined;
	private pendingIconColor: string | undefined;
	private pendingCategory: string | undefined;
	private readonly originalName: string;
	// Set to true by any explicit button action so onClose doesn't also autosave
	private savedOrDeleted = false;

	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private entry: TerrainColor,
		private onSave: () => void,
		private onDelete: () => void,
	) {
		super(app);
		this.originalName     = entry.name;
		this.pendingName      = entry.name;
		this.pendingColor     = entry.color;
		this.pendingIcon      = entry.icon;
		this.pendingIconColor = entry.iconColor;
		this.pendingCategory  = entry.category;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Edit terrain type" });

		new Setting(contentEl)
			.setName("Name")
			.addText(text =>
				text
					.setValue(this.pendingName)
					.onChange(value => { this.pendingName = value.trim() || this.pendingName; }),
			);

		new Setting(contentEl)
			.setName("Color")
			.addColorPicker(color =>
				color
					.setValue(this.pendingColor)
					.onChange(value => { this.pendingColor = value; }),
			);

		new Setting(contentEl)
			.setName("Icon")
			.addDropdown(dropdown => {
				dropdown.addOption("", "— no icon —");
				for (const icon of this.plugin.availableIcons) {
					const label = icon.replace(/^bw-/, "").replace(/\.png$/, "").replace(/-/g, " ");
					dropdown.addOption(icon, label);
				}
				dropdown.setValue(this.pendingIcon ?? "");
				dropdown.onChange(value => { this.pendingIcon = value || undefined; });
			});

		// Track last picked colour so toggling on restores it rather than resetting to white
		let lastIconColorPick = this.pendingIconColor ?? "#ffffff";
		new Setting(contentEl)
			.setName("Icon tint")
			.setDesc("Apply a solid colour to the icon shape (works best with monochrome icons).")
			.addToggle(toggle =>
				toggle
					.setValue(!!this.pendingIconColor)
					.onChange(enabled => {
						this.pendingIconColor = enabled ? lastIconColorPick : undefined;
					}),
			)
			.addColorPicker(picker =>
				picker
					.setValue(lastIconColorPick)
					.onChange(value => {
						lastIconColorPick = value;
						if (this.pendingIconColor !== undefined) this.pendingIconColor = value;
					}),
			);

		// Collect existing categories from the palette for the datalist
		const existingCategories = [...new Set(
			this.plugin.settings.terrainPalette
				.map(e => e.category)
				.filter((c): c is string => !!c),
		)].sort();

		let categoryInputEl: HTMLInputElement | undefined;
		new Setting(contentEl)
			.setName("Category")
			.setDesc("Group this terrain with similar types in the filter.")
			.addText(text => {
				text
					.setValue(this.pendingCategory ?? "")
					.setPlaceholder("e.g. sea, forest, mountain…")
					.onChange(value => { this.pendingCategory = value.trim() || undefined; });
				categoryInputEl = text.inputEl;
			});
		if (categoryInputEl && existingCategories.length > 0) {
			const dl = contentEl.createEl("datalist");
			dl.id = "duckmage-terrain-category-dl";
			categoryInputEl.setAttribute("list", "duckmage-terrain-category-dl");
			for (const cat of existingCategories) {
				dl.createEl("option", { value: cat });
			}
		}

		const btnRow = contentEl.createDiv({ cls: "duckmage-tee-buttons" });

		const saveBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Save" });
		saveBtn.addEventListener("click", () => {
			this.savedOrDeleted = true;
			const nameChanged = this.pendingName !== this.originalName;
			saveBtn.disabled = true;
			saveBtn.setText(nameChanged ? "Updating hexes…" : "Saving…");
			void this.doSave().then(() => this.close());
		});

		btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
			this.savedOrDeleted = true;
			this.close();
		});

		const deleteBtn = btnRow.createEl("button", { cls: "duckmage-btn-danger", text: "Delete" });
		deleteBtn.addEventListener("click", async () => {
			this.savedOrDeleted = true;
			const idx = this.plugin.settings.terrainPalette.indexOf(this.entry);
			if (idx >= 0) this.plugin.settings.terrainPalette.splice(idx, 1);
			await this.plugin.saveSettings();
			this.onDelete();
			this.close();
		});

		this.makeDraggable();
	}

	onClose(): void {
		if (!this.savedOrDeleted) {
			void this.doSave();
		}
		this.contentEl.empty();
	}

	private async doSave(): Promise<void> {
		const nameChanged = this.pendingName !== this.originalName;
		this.entry.color     = this.pendingColor;
		this.entry.icon      = this.pendingIcon;
		this.entry.iconColor = this.pendingIconColor;
		this.entry.category  = this.pendingCategory;
		if (nameChanged) {
			const oldName = this.originalName;
			const newName = this.pendingName;
			const overrides = await this.plugin.renameTerrainInHexes(oldName, newName);
			await this.renameTerrainTables(oldName, newName);
			this.entry.name = newName;
			await this.plugin.saveSettings();
			this.plugin.refreshHexMapWithOverrides(overrides);
			this.plugin.refreshHexTableTerrainRename(oldName, newName);
		} else {
			await this.plugin.saveSettings();
			this.plugin.refreshHexMap();
		}
		this.onSave();
	}

	private getTerrainTablePath(name: string, type: "description" | "encounters"): string {
		const folder = normalizeFolder(this.plugin.settings.tablesFolder);
		const sub = folder ? `${folder}/terrain` : "terrain";
		return `${sub}/${name} - ${type}.md`;
	}

	private async renameTerrainTables(oldName: string, newName: string): Promise<void> {
		for (const type of ["description", "encounters"] as const) {
			const oldPath = this.getTerrainTablePath(oldName, type);
			const newPath = this.getTerrainTablePath(newName, type);
			const file = this.app.vault.getAbstractFileByPath(oldPath);
			if (file instanceof TFile) {
				try { await this.app.vault.rename(file, newPath); } catch { /* ignore */ }
			}
		}
	}
}

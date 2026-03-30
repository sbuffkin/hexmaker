import { App, Setting, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { normalizeFolder } from "../utils";

export class TerrainEntryEditorModal extends HexmakerModal {
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
		private plugin: HexmakerPlugin,
		private palette: TerrainColor[],
		private entry: TerrainColor,
		private onSave: () => void,
		private onDelete: () => void,
		private isNew = false,
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
		let tintToggle: import("obsidian").ToggleComponent | undefined;
		new Setting(contentEl)
			.setName("Icon tint")
			.setDesc("Apply a solid colour to the icon shape (works best with monochrome icons).")
			.addToggle(toggle => {
				tintToggle = toggle;
				toggle
					.setValue(!!this.pendingIconColor)
					.onChange(enabled => {
						this.pendingIconColor = enabled ? lastIconColorPick : undefined;
					});
			})
			.addColorPicker(picker =>
				picker
					.setValue(lastIconColorPick)
					.onChange(value => {
						lastIconColorPick = value;
						// Auto-enable tint when the user picks a colour
						if (this.pendingIconColor === undefined) {
							this.pendingIconColor = value;
							tintToggle?.setValue(true);
						} else {
							this.pendingIconColor = value;
						}
					}),
			);

		// Collect existing categories from the palette for the datalist
		const existingCategories = [...new Set(
			this.palette
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
					.setPlaceholder("E.g. Sea, forest, mountain…")
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
			const idx = this.palette.indexOf(this.entry);
			if (idx >= 0) this.palette.splice(idx, 1);
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
		if (this.isNew) {
			// Brand-new entry — no hex can have this terrain yet and no table files exist
			// to rename. Just commit the name and create fresh table files.
			this.entry.name = this.pendingName;
			await this.plugin.saveSettings();
			await this.plugin.ensureTerrainTables();
			this.plugin.refreshHexMap();
		} else if (nameChanged) {
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
		return `${sub}/${type}/${name}.md`;
	}

	private async renameTerrainTables(oldName: string, newName: string): Promise<void> {
		for (const type of ["description", "encounters"] as const) {
			const oldPath = this.getTerrainTablePath(oldName, type);
			const newPath = this.getTerrainTablePath(newName, type);
			// Don't overwrite if the new terrain already has its own tables
			if (this.app.vault.getAbstractFileByPath(newPath)) continue;
			const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
			if (!(oldFile instanceof TFile)) continue;
			try {
				let content = await this.app.vault.read(oldFile);
				// Update the terrain frontmatter property to the new name
				content = content.replace(/^terrain:[ \t].+$/m, `terrain: ${newName}`);
				// Strip the old roller link so ensureRollerLink can add one with the correct path
				content = content.replace(/^.*obsidian:\/\/duckmage-roll.*$\n?/m, "");
				await this.app.vault.create(newPath, content);
				await this.plugin.ensureRollerLink(newPath);
			} catch { /* ignore */ }
		}
	}
}

import { App, Notice, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { ICON_PACK_LABELS, iconLabel, iconPack, type IconPack } from "../utils";
import { inferTerrainType } from "../terrainTypes";
import { fillTerrainTypeSelect } from "../terrainTypeSelect";

export class TerrainEntryEditorModal extends HexmakerModal {
	// Pending values — only written to the entry on Save
	private pendingName: string;
	private pendingColor: string;
	private pendingIcon: string | undefined;
	private pendingIconColor: string | undefined;
	private pendingCategory: string | undefined;
	private pendingType: string | undefined;
	/** True once the user picked a type themselves (stops name-based suggestions). */
	private typeTouched: boolean;
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
		this.pendingType      = entry.type ?? (isNew ? undefined : inferTerrainType(entry.name, entry.category));
		this.typeTouched      = !!entry.type;
	}

	onOpen(): void {
		// Rescan the icons folder so files dropped in via the OS (not the
		// in-app uploader) appear without an Obsidian restart (forum report).
		this.plugin.loadAvailableIcons();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Edit terrain type" });

		let typeSelect: HTMLSelectElement | undefined;
		new Setting(contentEl)
			.setName("Name")
			.addText(text =>
				text
					.setValue(this.pendingName)
					.onChange(value => {
						this.pendingName = value.trim() || this.pendingName;
						// Suggest a type from the name ("dark forest" → forest) until
						// the user picks one themselves.
						if (!this.typeTouched && typeSelect) {
							this.pendingType = inferTerrainType(this.pendingName, this.pendingCategory);
							typeSelect.value = this.pendingType ?? "";
						}
					}),
			);

		new Setting(contentEl)
			.setName("Type")
			.setDesc("What this terrain is (forest, water, star…), whatever you call it. Generators and the hex table use it.")
			.addDropdown(dd => {
				typeSelect = dd.selectEl;
				fillTerrainTypeSelect(dd.selectEl, this.plugin.settings, this.pendingType);
				dd.onChange(value => {
					this.pendingType = value || undefined;
					this.typeTouched = true;
				});
			});

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
				// Grouped by pack so a long icon list stays scannable.
				const groups = new Map<IconPack, HTMLOptGroupElement>();
				for (const pack of Object.keys(ICON_PACK_LABELS) as IconPack[]) {
					groups.set(pack, dropdown.selectEl.createEl("optgroup", { attr: { label: ICON_PACK_LABELS[pack] } }));
				}
				for (const icon of this.plugin.availableIcons) {
					groups.get(iconPack(icon, this.plugin.vaultIconsSet))
						?.createEl("option", { value: icon, text: iconLabel(icon) });
				}
				for (const group of groups.values()) {
					if (group.childElementCount === 0) group.remove();
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
			const nameChanged = this.pendingName !== this.originalName;
			if (nameChanged && this.palette.some(e => e !== this.entry && e.name === this.pendingName)) {
				new Notice(`A terrain named "${this.pendingName}" already exists in this palette.`);
				return;
			}
			this.savedOrDeleted = true;
			saveBtn.disabled = true;
			saveBtn.setText(nameChanged ? "Updating hexes…" : "Saving…");
			void this.doSave().then(() => this.close());
		});

		btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
			this.savedOrDeleted = true;
			this.close();
		});

		const deleteBtn = btnRow.createEl("button", { cls: "duckmage-btn-danger", text: "Delete" });
		deleteBtn.addEventListener("click", () => {
			void (async () => {
				this.savedOrDeleted = true;
				const idx = this.palette.indexOf(this.entry);
				if (idx >= 0) this.palette.splice(idx, 1);
				await this.plugin.saveSettings();
				this.onDelete();
				this.close();
			})();
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
		if (this.pendingType) this.entry.type = this.pendingType;
		else delete this.entry.type;
		if (this.isNew) {
			// Brand-new entry — no hex can have this terrain yet and no table files exist
			// to rename. Just commit the name and create fresh table files.
			this.entry.name = this.pendingName;
			await this.plugin.saveSettings();
			await this.plugin.ensureTerrainTables();
			this.plugin.refreshHexMap();
		} else if (nameChanged) {
			await this.plugin.renameTerrain(this.entry, this.pendingName);
		} else {
			await this.plugin.saveSettings();
			this.plugin.refreshHexMap();
		}
		this.onSave();
	}

}

import { App, Notice, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { renderSaveStatusLine } from "../ui/saveStatusLine";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { ICON_PACK_LABELS, iconLabel, iconPack, type IconPack } from "../utils";
import { inferTerrainType } from "../terrainTypes";
import { fillTerrainTypeSelect } from "../terrainTypeSelect";
import { isImpassable, setImpassable } from "../impassable";

export class TerrainEntryEditorModal extends HexmakerModal {
	// Pending values — only written to the entry on Save
	private pendingName: string;
	private pendingColor: string;
	private pendingIcon: string | undefined;
	private pendingIconColor: string | undefined;
	private pendingCategory: string | undefined;
	private pendingType: string | undefined;
	/** Auto-routed paths go around it (path tool). */
	private pendingImpassable: boolean;
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
		this.pendingImpassable = isImpassable({ impassable: entry.impassable, type: this.pendingType, name: entry.name, category: entry.category });
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
			.setName("Impassable")
			.setDesc("Auto-routed paths go around it. Water types (deep water, water, shallows) start impassable; turn this off to override.")
			.addToggle(toggle =>
				toggle
					.setValue(this.pendingImpassable)
					.onChange(value => { this.pendingImpassable = value; }),
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
				// Grouped by pack so a long icon list stays scannable.
				const groups = new Map<IconPack, HTMLOptGroupElement>();
				for (const pack of Object.keys(ICON_PACK_LABELS)) {
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

		// Autosaves (owner Q5, audit C6): × closes and saves; no Save or Cancel.
		renderSaveStatusLine(contentEl, { title: "Saves when you close this (×). There is no Save button." });
		this.footer({
			destructive: { text: "Delete", onClick: () => {
				void (async () => {
					this.savedOrDeleted = true;
					const idx = this.palette.indexOf(this.entry);
					if (idx >= 0) this.palette.splice(idx, 1);
					await this.plugin.saveSettings();
					this.onDelete();
					this.close();
				})();
			} },
		});

		this.makeDraggable();
	}

	onClose(): void {
		if (!this.savedOrDeleted) {
			// A name another terrain already has can't be saved: keep the old one.
			if (this.pendingName !== this.originalName && this.palette.some(e => e !== this.entry && e.name === this.pendingName)) {
				new Notice(`A terrain named "${this.pendingName}" already exists in this palette, so the name stays "${this.originalName}".`);
				this.pendingName = this.originalName;
			}
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
		setImpassable(this.entry, this.pendingImpassable);
		if (this.isNew) {
			// Brand-new entry: it was saved under its placeholder name ("New"),
			// which already gave it empty tables (HG5). Naming it moves those
			// tables to the real name; then make sure they exist.
			if (nameChanged) await this.plugin.renameTerrain(this.entry, this.pendingName);
			else await this.plugin.saveSettings();
			await this.plugin.ensureTablesForNewTerrains();
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

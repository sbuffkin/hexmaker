import { App, Notice, PluginSettingTab, Setting, TFile } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder } from "./utils";

export class DuckmageSettingTab extends PluginSettingTab {
	plugin: DuckmagePlugin;

	constructor(app: App, plugin: DuckmagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("World notes folder")
			.setDesc("Vault-relative path. Scopes the file search when adding links to hexes.")
			.addText(text =>
				text
					.setPlaceholder("world")
					.setValue(this.plugin.settings.worldFolder)
					.onChange(async value => {
						this.plugin.settings.worldFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Set up folders")
			.setDesc("Populates any blank folder settings below with defaults under the world folder, then creates those folders in your vault. Only blank fields are affected — manually set values are left untouched.")
			.addButton(btn =>
				btn.setButtonText("Generate folders").setCta().onClick(async () => {
					const world = normalizeFolder(this.plugin.settings.worldFolder) || "world";
					const defaults: [keyof typeof this.plugin.settings, string][] = [
						["hexFolder",      `${world}/hexes`],
						["townsFolder",    `${world}/towns`],
						["dungeonsFolder", `${world}/dungeons`],
						["questsFolder",   `${world}/quests`],
						["featuresFolder", `${world}/features`],
						["factionsFolder", `${world}/factions`],
						["tablesFolder",   `${world}/tables`],
					];
					for (const [key, path] of defaults) {
						if (!this.plugin.settings[key]) {
							(this.plugin.settings as unknown as Record<string, unknown>)[key] = path;
							try {
								if (!this.app.vault.getAbstractFileByPath(path)) {
									await this.app.vault.createFolder(path);
								}
							} catch { /* folder already exists */ }
						}
					}
					await this.plugin.saveSettings();
					// Ensure all region subfolders exist and generate hex notes
					const hexF = normalizeFolder(this.plugin.settings.hexFolder);
					if (hexF) {
						let totalCreated = 0;
						for (const region of this.plugin.settings.regions) {
							const regionFolder = `${hexF}/${region.name}`;
							if (!this.app.vault.getAbstractFileByPath(regionFolder)) {
								try { await this.app.vault.createFolder(regionFolder); } catch { /* exists */ }
							}
							const { cols, rows } = region.gridSize;
							const { x: ox, y: oy } = region.gridOffset;
							const xs = Array.from({ length: cols }, (_, i) => ox + i);
							const ys = Array.from({ length: rows }, (_, i) => oy + i);
							totalCreated += await this.plugin.generateHexNotes(region.name, xs, ys);
						}
						if (totalCreated > 0) new Notice(`Duckmage: generated ${totalCreated} hex note${totalCreated !== 1 ? "s" : ""}.`);
					}
					new Notice("Folders generated.");
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Hex notes folder")
			.setDesc("Vault-relative path where hex notes (x_y.md) are stored.")
			.addText(text =>
				text
					.setPlaceholder("world/hexes")
					.setValue(this.plugin.settings.hexFolder)
					.onChange(async value => {
						this.plugin.settings.hexFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Towns folder")
			.setDesc("Vault-relative folder to populate the Towns dropdown in the hex editor. Files starting with _ are excluded.")
			.addText(text =>
				text
					.setPlaceholder("world/towns")
					.setValue(this.plugin.settings.townsFolder)
					.onChange(async value => {
						this.plugin.settings.townsFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Dungeons folder")
			.setDesc("Vault-relative folder to populate the Dungeons dropdown in the hex editor. Files starting with _ are excluded.")
			.addText(text =>
				text
					.setPlaceholder("world/dungeons")
					.setValue(this.plugin.settings.dungeonsFolder)
					.onChange(async value => {
						this.plugin.settings.dungeonsFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Quests folder")
			.setDesc("Vault-relative folder to populate the Quests dropdown in the hex editor. Files starting with _ are excluded.")
			.addText(text =>
				text
					.setPlaceholder("world/quests")
					.setValue(this.plugin.settings.questsFolder)
					.onChange(async value => {
						this.plugin.settings.questsFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Features folder")
			.setDesc("Vault-relative folder to populate the Features dropdown in the hex editor. Files starting with _ are excluded.")
			.addText(text =>
				text
					.setPlaceholder("world/features")
					.setValue(this.plugin.settings.featuresFolder)
					.onChange(async value => {
						this.plugin.settings.featuresFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Factions folder")
			.setDesc("Vault-relative folder to populate the Factions dropdown in the hex editor. Files starting with _ are excluded.")
			.addText(text =>
				text
					.setPlaceholder("world/factions")
					.setValue(this.plugin.settings.factionsFolder)
					.onChange(async value => {
						this.plugin.settings.factionsFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Tables folder")
			.setDesc("Vault-relative folder for random table notes. Used by the Encounters Table section and the Random Tables view.")
			.addText(text =>
				text
					.setPlaceholder("world/tables")
					.setValue(this.plugin.settings.tablesFolder)
					.onChange(async value => {
						this.plugin.settings.tablesFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default die for new tables")
			.setDesc("Die size used when creating new random table notes (d6, d20, d100, etc.).")
			.addDropdown(dropdown =>
				dropdown
					.addOption("4",    "d4")
					.addOption("6",    "d6")
					.addOption("8",    "d8")
					.addOption("10",   "d10")
					.addOption("12",   "d12")
					.addOption("20",   "d20")
					.addOption("100",  "d100")
					.addOption("200",  "d200")
					.addOption("500",  "d500")
					.addOption("1000", "d1000")
					.setValue(String(this.plugin.settings.defaultTableDice ?? 100))
					.onChange(async value => {
						this.plugin.settings.defaultTableDice = parseInt(value, 10);
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Generate world data" });
		containerEl.createEl("p", {
			cls: "setting-item-description duckmage-generate-warning",
			text: "⚠️ Configure all folder settings above before selecting Generate. This will create terrain table notes, add roller links to all table notes, and link each hex note to its terrain's encounters table. Safe to run multiple times — existing notes and links are not overwritten.",
		});
		new Setting(containerEl)
			.setName("Generate terrain tables & hex links")
			.setDesc("Creates missing terrain table notes, adds roller links to all table notes (so they can be opened in the Duckmage Roller from within Obsidian), and links each hex note's terrain encounters table into its Encounters Table section.")
			.addButton(btn =>
				btn.setButtonText("Generate").setCta().onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("Generating…");
					try {
						await this.plugin.ensureTerrainTables();
						await this.plugin.ensureAllRollerLinks();
						await this.plugin.backfillTerrainLinks();
					} finally {
						btn.setDisabled(false);
						btn.setButtonText("Generate");
					}
				}),
			);

		new Setting(containerEl)
			.setName("Hex editor sections start collapsed")
			.setDesc("Choose which sections open collapsed by default in the right-click hex editor.")
			.then(setting => {
				const addCb = (label: string, get: () => boolean, set: (v: boolean) => void) => {
					const lbl = setting.controlEl.createEl("label", { cls: "duckmage-collapse-cb-label" });
					const cb = lbl.createEl("input") as HTMLInputElement;
					cb.type = "checkbox";
					cb.checked = get();
					cb.addEventListener("change", async () => { set(cb.checked); await this.plugin.saveSettings(); });
					lbl.appendText(label);
				};
				addCb("Terrain",        () => this.plugin.settings.hexEditorTerrainCollapsed,  v => { this.plugin.settings.hexEditorTerrainCollapsed  = v; });
				addCb("World features", () => this.plugin.settings.hexEditorFeaturesCollapsed, v => { this.plugin.settings.hexEditorFeaturesCollapsed = v; });
				addCb("Notes",          () => this.plugin.settings.hexEditorNotesCollapsed,    v => { this.plugin.settings.hexEditorNotesCollapsed    = v; });
			});

		new Setting(containerEl)
			.setName("Template path")
			.setDesc("Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ## Towns, ## Dungeons, and ## Features headings for the link sections.")
			.addText(text =>
				text
					.setPlaceholder("templates/hex.md")
					.setValue(this.plugin.settings.templatePath)
					.onChange(async value => {
						this.plugin.settings.templatePath = (value ?? "").replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default region")
			.setDesc("The region opened when the hex map is launched.")
			.addDropdown(dropdown => {
				for (const r of this.plugin.settings.regions) {
					dropdown.addOption(r.name, r.name);
				}
				dropdown
					.setValue(this.plugin.settings.defaultRegion ?? this.plugin.settings.regions[0]?.name ?? "")
					.onChange(async value => {
						this.plugin.settings.defaultRegion = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Hex orientation")
			.setDesc("Pointy-top: points face north/south, flat sides east/west. Flat-top: flat sides face north/south, points east/west.")
			.addDropdown(dropdown =>
				dropdown
					.addOption("pointy", "Pointy-top")
					.addOption("flat", "Flat-top")
					.setValue(this.plugin.settings.hexOrientation ?? "pointy")
					.onChange(async value => {
						this.plugin.settings.hexOrientation = value as "pointy" | "flat";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Hex cell spacing")
			.setDesc("Gap between hex cells (0 – 0.5 em).")
			.addSlider(slider =>
				slider
					.setLimits(0, 0.5, 0.01)
					.setValue(parseFloat(this.plugin.settings.hexGap ?? "0.15") || 0.15)
					.setDynamicTooltip()
					.onChange(async value => {
						this.plugin.settings.hexGap = String(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Custom icons folder")
			.setDesc("Vault-relative folder containing additional icon images (PNG, JPG, SVG, etc.) for the terrain palette and hex icon override. These are merged with the built-in icons.")
			.addText(text =>
				text
					.setPlaceholder("icons")
					.setValue(this.plugin.settings.iconsFolder ?? "")
					.onChange(async value => {
						this.plugin.settings.iconsFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
						await this.plugin.loadAvailableIcons();
					}),
			);

		containerEl.createEl("h3", { text: "Roads & rivers" });
		new Setting(containerEl)
			.setName("Road color")
			.setDesc("Color used to draw road lines between connected road hexes.")
			.addColorPicker(color =>
				color
					.setValue(this.plugin.settings.roadColor ?? "#a16207")
					.onChange(async value => {
						this.plugin.settings.roadColor = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("River color")
			.setDesc("Color used to draw river lines between connected river hexes.")
			.addColorPicker(color =>
				color
					.setValue(this.plugin.settings.riverColor ?? "#3b82f6")
					.onChange(async value => {
						this.plugin.settings.riverColor = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Terrain palette" });
		containerEl.createEl("p", {
			text: "Right-click a hex to set terrain. Each type can have a fill color and an icon from the plugin's icons folder or your custom icons folder.",
			cls: "setting-item-description",
		});

		const listEl = containerEl.createDiv({ cls: "duckmage-palette-list" });
		const palette = this.plugin.settings.terrainPalette ?? [];

		let dragSrcIndex = -1;

		for (let i = 0; i < palette.length; i++) {
			const entry = palette[i];
			const itemEl = listEl.createDiv({ cls: "duckmage-palette-item" });
			itemEl.draggable = true;

			// Drag handle
			itemEl.createSpan({ cls: "duckmage-palette-drag-handle", text: "⠿" });

			itemEl.addEventListener("dragstart", (e: DragEvent) => {
				dragSrcIndex = i;
				itemEl.addClass("duckmage-palette-dragging");
				e.dataTransfer?.setDragImage(itemEl, 0, 0);
			});
			itemEl.addEventListener("dragend", () => {
				itemEl.removeClass("duckmage-palette-dragging");
				listEl.querySelectorAll(".duckmage-palette-drop-target").forEach(el =>
					el.classList.remove("duckmage-palette-drop-target"),
				);
			});
			itemEl.addEventListener("dragover", (e: DragEvent) => {
				e.preventDefault();
				listEl.querySelectorAll(".duckmage-palette-drop-target").forEach(el =>
					el.classList.remove("duckmage-palette-drop-target"),
				);
				itemEl.addClass("duckmage-palette-drop-target");
			});
			itemEl.addEventListener("drop", async (e: DragEvent) => {
				e.preventDefault();
				const dropIndex = i;
				if (dragSrcIndex === -1 || dragSrcIndex === dropIndex) return;
				const pal = this.plugin.settings.terrainPalette;
				const [moved] = pal.splice(dragSrcIndex, 1);
				pal.splice(dropIndex, 0, moved);
				dragSrcIndex = -1;
				await this.plugin.saveSettings();
				this.display();
			});

			new Setting(itemEl)
				.addText(text => {
					let nameBeforeEdit = entry.name;
					text
						.setPlaceholder("Name")
						.setValue(entry.name)
						.onChange(async value => {
							const trimmed = (value ?? "").trim();
							const isDuplicate = trimmed.length > 0 && this.plugin.settings.terrainPalette.some(
								(e) => e !== entry && e.name.toLowerCase() === trimmed.toLowerCase(),
							);
							if (isDuplicate) {
								text.inputEl.addClass("duckmage-input-error");
								text.inputEl.title = `"${trimmed}" is already used by another terrain.`;
								return;
							}
							text.inputEl.removeClass("duckmage-input-error");
							text.inputEl.title = "";
							entry.name = trimmed || entry.name;
							await this.plugin.saveSettings();
						});
					text.inputEl.addEventListener("focus", () => { nameBeforeEdit = entry.name; });
					text.inputEl.addEventListener("blur", async () => {
						if (text.inputEl.hasClass("duckmage-input-error")) return;
						if (entry.name !== nameBeforeEdit) {
							await this.renameTerrainTables(nameBeforeEdit, entry.name);
						}
					});
				})
				.addColorPicker(color =>
					color.setValue(entry.color).onChange(async value => {
						entry.color = value;
						await this.plugin.saveSettings();
						this.plugin.refreshHexMap();
					}),
				)
				.addDropdown(dropdown => {
					dropdown.addOption("", "— no icon —");
					for (const icon of this.plugin.availableIcons) {
						const label = icon.replace(/^bw-/, "").replace(/\.png$/, "").replace(/-/g, " ");
						dropdown.addOption(icon, label);
					}
					dropdown.setValue(entry.icon ?? "");
					dropdown.onChange(async value => {
						entry.icon = value || undefined;
						await this.plugin.saveSettings();
						this.plugin.refreshHexMap();
					});
				})
				.addExtraButton(btn =>
					btn.setIcon("trash-2").onClick(async () => {
						this.plugin.settings.terrainPalette.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
				);
		}

		new Setting(containerEl).addButton(btn =>
			btn.setButtonText("Add terrain type").onClick(async () => {
				this.plugin.settings.terrainPalette.push({ name: "New", color: "#888888" });
				await this.plugin.saveSettings();
				await this.plugin.ensureTerrainTables();
				this.display();
			}),
		);
	}

	private getTerrainTablePath(terrainName: string, tableType: "description" | "encounters"): string {
		const folder = normalizeFolder(this.plugin.settings.tablesFolder);
		const subfolder = folder ? `${folder}/terrain` : "terrain";
		return `${subfolder}/${tableType}/${terrainName}.md`;
	}

	private async renameTerrainTables(oldName: string, newName: string): Promise<void> {
		for (const tableType of ["description", "encounters"] as const) {
			const oldPath = this.getTerrainTablePath(oldName, tableType);
			const newPath = this.getTerrainTablePath(newName, tableType);
			const file = this.app.vault.getAbstractFileByPath(oldPath);
			if (file instanceof TFile) {
				try { await this.app.vault.rename(file, newPath); } catch { /* ignore */ }
			}
		}
	}
}

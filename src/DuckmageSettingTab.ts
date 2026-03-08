import { App, PluginSettingTab, Setting } from "obsidian";
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
			.setName("Grid width")
			.setDesc("Number of hex columns.")
			.addText(text =>
				text
					.setPlaceholder("20")
					.setValue(String(this.plugin.settings.gridSize.cols))
					.onChange(async value => {
						this.plugin.settings.gridSize.cols = Number(value.trim()) || 20;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Grid height")
			.setDesc("Number of hex rows.")
			.addText(text =>
				text
					.setPlaceholder("16")
					.setValue(String(this.plugin.settings.gridSize.rows))
					.onChange(async value => {
						this.plugin.settings.gridSize.rows = Number(value.trim()) || 16;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Hex cell spacing")
			.setDesc("Gap between hex cells. A bare number is treated as em units (e.g. 0.15), or append em/px.")
			.addText(text =>
				text
					.setPlaceholder("0.15")
					.setValue(this.plugin.settings.hexGap ?? "0.15")
					.onChange(async value => {
						this.plugin.settings.hexGap = (value ?? "0.15").trim() || "0";
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
				.addText(text =>
					text
						.setPlaceholder("Name")
						.setValue(entry.name)
						.onChange(async value => {
							entry.name = (value ?? "").trim() || entry.name;
							await this.plugin.saveSettings();
						}),
				)
				.addColorPicker(color =>
					color.setValue(entry.color).onChange(async value => {
						entry.color = value;
						await this.plugin.saveSettings();
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
				this.display();
			}),
		);
	}
}

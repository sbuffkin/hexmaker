import { App, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathType, PathLineStyle, PathRouting } from "../types";
import { buildPathPreviewSvg } from "./PathPickerModal";

export class PathTypeEditorModal extends HexmakerModal {
	private pendingName: string;
	private pendingColor: string;
	private pendingWidth: number;
	private pendingLineStyle: PathLineStyle;
	private pendingRouting: PathRouting;
	private readonly originalName: string;
	private savedOrDeleted = false;

	constructor(
		app: App,
		private plugin: HexmakerPlugin,
		private entry: PathType,
		private onSave: () => void,
		private onDelete: () => void,
	) {
		super(app);
		this.originalName      = entry.name;
		this.pendingName       = entry.name;
		this.pendingColor      = entry.color;
		this.pendingWidth      = entry.width;
		this.pendingLineStyle  = entry.lineStyle;
		this.pendingRouting    = entry.routing;
	}

	onOpen(): void {
		this.makeDraggable();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Edit path type" });

		// Live preview div
		const previewDiv = contentEl.createDiv({ cls: "duckmage-path-preview duckmage-path-editor-preview" });
		const redrawPreview = () => {
			previewDiv.empty();
			previewDiv.appendChild(buildPathPreviewSvg({
				name: this.pendingName,
				color: this.pendingColor,
				width: this.pendingWidth,
				lineStyle: this.pendingLineStyle,
				routing: this.pendingRouting,
			}));
		};
		redrawPreview();

		new Setting(contentEl)
			.setName("Name")
			.addText(text =>
				text
					.setValue(this.pendingName)
					.onChange(value => {
						this.pendingName = value.trim() || this.pendingName;
					}),
			);

		new Setting(contentEl)
			.setName("Color")
			.addColorPicker(color =>
				color
					.setValue(this.pendingColor)
					.onChange(value => {
						this.pendingColor = value;
						redrawPreview();
					}),
			);

		new Setting(contentEl)
			.setName("Width")
			.addSlider(slider =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.pendingWidth)
					.setDynamicTooltip()
					.onChange(value => {
						this.pendingWidth = value;
						redrawPreview();
					}),
			);

		new Setting(contentEl)
			.setName("Line style")
			.addDropdown(dd =>
				dd
					.addOption("solid",  "Solid")
					.addOption("dashed", "Dashed")
					.addOption("dotted", "Dotted")
					.setValue(this.pendingLineStyle)
					.onChange(value => {
						this.pendingLineStyle = value as PathLineStyle;
						redrawPreview();
					}),
			);

		new Setting(contentEl)
			.setName("Routing")
			.addDropdown(dd =>
				dd
					.addOption("through",  "Through hex centers")
					.addOption("meander",  "Meander (curves via edge midpoints)")
					.addOption("edge",     "Along hex edges (tight boundary)")
					.setValue(this.pendingRouting)
					.onChange(value => {
						this.pendingRouting = value as PathRouting;
						redrawPreview();
					}),
			);

		// Save button
		const btnRow = contentEl.createDiv({ cls: "duckmage-terrain-editor-actions" });
		btnRow.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			void (async () => {
				await this.doSave();
				this.close();
			})();
		});

		// Delete button with confirm
		const deleteBtn = btnRow.createEl("button", { text: "Delete", cls: "mod-warning" });
		let confirmDiv: HTMLElement | null = null;
		deleteBtn.addEventListener("click", () => {
			if (confirmDiv) { confirmDiv.remove(); confirmDiv = null; return; }

			const chainCount = this.plugin.settings.regions.reduce(
				(sum, r) => sum + r.pathChains.filter(c => c.typeName === this.originalName).length,
				0,
			);
			confirmDiv = contentEl.createDiv({ cls: "duckmage-terrain-editor-confirm" });
			if (chainCount > 0) {
				confirmDiv.createEl("p", {
					text: `This type is used in ${chainCount} chain(s). Deleting it will remove those chains. Continue?`,
					cls: "duckmage-terrain-editor-confirm-msg",
				});
			} else {
				confirmDiv.createEl("p", { text: "Delete this path type?", cls: "duckmage-terrain-editor-confirm-msg" });
			}
			confirmDiv.createEl("button", { text: "Yes, delete", cls: "mod-warning" }).addEventListener("click", () => {
				void (async () => {
					await this.doDelete();
					this.close();
				})();
			});
			confirmDiv.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
				confirmDiv?.remove();
				confirmDiv = null;
			});
		});
	}

	onClose(): void {
		if (!this.savedOrDeleted) {
			void this.doSave();
		}
		this.contentEl.empty();
	}

	private async doSave(): Promise<void> {
		if (this.savedOrDeleted) return;
		this.savedOrDeleted = true;

		const nameChanged = this.pendingName !== this.originalName;

		this.entry.name       = this.pendingName;
		this.entry.color      = this.pendingColor;
		this.entry.width      = this.pendingWidth;
		this.entry.lineStyle  = this.pendingLineStyle;
		this.entry.routing    = this.pendingRouting;

		// If name changed, update all pathChain typeName refs
		if (nameChanged) {
			for (const region of this.plugin.settings.regions) {
				for (const chain of region.pathChains) {
					if (chain.typeName === this.originalName) chain.typeName = this.pendingName;
				}
			}
		}

		await this.plugin.saveSettings();
		this.onSave();
	}

	private async doDelete(): Promise<void> {
		if (this.savedOrDeleted) return;
		this.savedOrDeleted = true;

		// Remove from pathTypes
		const idx = this.plugin.settings.pathTypes.indexOf(this.entry);
		if (idx !== -1) this.plugin.settings.pathTypes.splice(idx, 1);

		// Remove all matching chains
		for (const region of this.plugin.settings.regions) {
			region.pathChains = region.pathChains.filter(c => c.typeName !== this.originalName);
		}

		await this.plugin.saveSettings();
		this.onDelete();
	}
}

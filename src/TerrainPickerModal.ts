import { App, Modal } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { getIconUrl } from "./utils";
import { TerrainEntryEditorModal } from "./TerrainEntryEditorModal";

export class TerrainPickerModal extends Modal {
	private editMode = false;
	private editChanged = false;

	private selectionMade = false;

	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private onSelect: (terrainName: string | null) => void,
		private onPickMode?: () => void,
		private onDismiss?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		if (this.editChanged) {
			this.plugin.refreshHexMap();
		}
		if (!this.selectionMade) {
			this.onDismiss?.();
		}
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");

		const header = contentEl.createDiv({ cls: "duckmage-tpe-header" });
		header.createEl("h2", { text: this.editMode ? "Edit terrain palette" : "Paint terrain" });
		const toggleBtn = header.createEl("button", {
			cls: "duckmage-tpe-edit-btn",
			text: this.editMode ? "← Done" : "✏ Edit",
		});
		toggleBtn.addEventListener("click", () => {
			this.editMode = !this.editMode;
			this.render();
		});

		if (this.editMode) {
			this.renderEditMode();
		} else {
			this.renderPickMode();
		}
	}

	private renderPickMode(): void {
		const { contentEl } = this;
		const section = contentEl.createDiv({ cls: "duckmage-editor-section" });
		const grid = section.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-full" });

		const eyeBtn = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-eyedropper" });
		eyeBtn.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-eyedropper" }).setText("⌖");
		eyeBtn.createSpan({ text: "Pick", cls: "duckmage-terrain-option-name" });
		eyeBtn.addEventListener("click", () => { this.selectionMade = true; this.onPickMode?.(); this.close(); });

		const clearBtn = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-clear" });
		clearBtn.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
		clearBtn.createSpan({ text: "Clear", cls: "duckmage-terrain-option-name" });
		clearBtn.addEventListener("click", () => { this.selectionMade = true; this.onSelect(null); this.close(); });

		for (const entry of this.plugin.settings.terrainPalette) {
			const btn = grid.createDiv({ cls: "duckmage-terrain-option" });
			const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
			preview.style.backgroundColor = entry.color;
			if (entry.icon) {
				const img = preview.createEl("img", { cls: "duckmage-terrain-preview-icon" });
				img.src = getIconUrl(this.plugin, entry.icon);
				img.alt = entry.name;
			}
			btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });
			btn.addEventListener("click", () => { this.selectionMade = true; this.onSelect(entry.name); this.close(); });
		}
	}

	private renderEditMode(): void {
		const { contentEl } = this;
		const palette = this.plugin.settings.terrainPalette;

		const grid = contentEl.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-full" });
		let dragSrcIndex = -1;

		const renderTiles = () => {
			grid.empty();

			for (let i = 0; i < palette.length; i++) {
				const entry = palette[i];
				const tile = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-editable" });
				tile.draggable = true;

				// Grip handle — top-left
				tile.createSpan({ cls: "duckmage-terrain-edit-grip", text: "⠿" });

				// Edit pencil — top-right; click opens per-entry editor
				const pencil = tile.createSpan({ cls: "duckmage-terrain-edit-pencil", text: "✏" });
				pencil.addEventListener("click", (e) => {
					e.stopPropagation();
					new TerrainEntryEditorModal(
						this.app,
						this.plugin,
						entry,
						() => { this.editChanged = true; renderTiles(); },
						() => { this.editChanged = true; renderTiles(); },
					).open();
				});

				// Standard colored preview + icon (same as pick mode)
				const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
				preview.style.backgroundColor = entry.color;
				if (entry.icon) {
					const img = preview.createEl("img", { cls: "duckmage-terrain-preview-icon" });
					img.src = getIconUrl(this.plugin, entry.icon);
					img.alt = entry.name;
				}
				tile.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });

				// Drag-to-reorder
				tile.addEventListener("dragstart", (e: DragEvent) => {
					// Don't drag if the user clicked the pencil
					if ((e.target as HTMLElement).closest(".duckmage-terrain-edit-pencil")) {
						e.preventDefault();
						return;
					}
					dragSrcIndex = i;
					tile.addClass("duckmage-palette-dragging");
					e.dataTransfer?.setDragImage(tile, 0, 0);
				});
				tile.addEventListener("dragend", () => {
					tile.removeClass("duckmage-palette-dragging");
					grid.querySelectorAll(".duckmage-palette-drop-target").forEach(el =>
						el.classList.remove("duckmage-palette-drop-target"),
					);
				});
				tile.addEventListener("dragover", (e: DragEvent) => {
					e.preventDefault();
					grid.querySelectorAll(".duckmage-palette-drop-target").forEach(el =>
						el.classList.remove("duckmage-palette-drop-target"),
					);
					tile.addClass("duckmage-palette-drop-target");
				});
				tile.addEventListener("drop", async (e: DragEvent) => {
					e.preventDefault();
					if (dragSrcIndex === -1 || dragSrcIndex === i) return;
					const [moved] = palette.splice(dragSrcIndex, 1);
					palette.splice(i, 0, moved);
					dragSrcIndex = -1;
					this.editChanged = true;
					await this.plugin.saveSettings();
					renderTiles();
				});
			}

			// "+" add tile at the end
			const addTile = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-add" });
			addTile.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-add" }).setText("+");
			addTile.createSpan({ text: "Add", cls: "duckmage-terrain-option-name" });
			addTile.addEventListener("click", async () => {
				const newEntry = { name: "New", color: "#888888" };
				palette.push(newEntry);
				this.editChanged = true;
				await this.plugin.saveSettings();
				await this.plugin.ensureTerrainTables();
				renderTiles();
				// Immediately open the editor for the new entry
				new TerrainEntryEditorModal(
					this.app,
					this.plugin,
					newEntry,
					() => { this.editChanged = true; renderTiles(); },
					() => { this.editChanged = true; renderTiles(); },
				).open();
			});
		};

		renderTiles();
	}
}

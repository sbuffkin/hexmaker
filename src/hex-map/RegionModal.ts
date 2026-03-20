import { App, Notice, TFolder } from "obsidian";
import { DuckmageModal } from "../DuckmageModal";
import type DuckmagePlugin from "../DuckmagePlugin";
import type { HexMapView } from "./HexMapView";
import { normalizeFolder } from "../utils";

export class RegionModal extends DuckmageModal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private view: HexMapView,
		private onChanged: () => void,
	) { super(app); }

	onOpen(): void {
		this.titleEl.setText("Regions");
		this.makeDraggable();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-region-modal");

		// Switch region list
		contentEl.createEl("h4", { text: "Switch region" });
		const list = contentEl.createEl("ul", { cls: "duckmage-region-list" });
		for (const region of this.plugin.settings.regions) {
			const li = list.createEl("li", {
				cls: "duckmage-region-item" + (region.name === this.view.activeRegionName ? " is-active" : ""),
				text: region.name,
			});
			li.addEventListener("click", () => {
				this.view.activeRegionName = region.name;
				this.onChanged();
				this.close();
			});
		}

		// Rename current region
		contentEl.createEl("h4", { text: "Rename current region" });
		const renameRow = contentEl.createDiv({ cls: "duckmage-region-row" });
		const renameInput = renameRow.createEl("input", { type: "text", value: this.view.activeRegionName }) as HTMLInputElement;
		const renameBtn = renameRow.createEl("button", { text: "Rename", cls: "mod-cta" });
		renameBtn.addEventListener("click", () => void this.renameRegion(renameInput.value.trim(), renameBtn, renameInput));
		renameInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") void this.renameRegion(renameInput.value.trim(), renameBtn, renameInput);
		});

		// Create new region
		contentEl.createEl("h4", { text: "New region" });
		const createRow = contentEl.createDiv({ cls: "duckmage-region-row" });
		const nameInput = createRow.createEl("input", { type: "text", placeholder: "region-name" }) as HTMLInputElement;
		const colsInput = createRow.createEl("input", { type: "number", value: "20" }) as HTMLInputElement;
		colsInput.style.width = "55px";
		const rowsInput = createRow.createEl("input", { type: "number", value: "16" }) as HTMLInputElement;
		rowsInput.style.width = "55px";
		const createBtn = createRow.createEl("button", { text: "Create", cls: "mod-cta" });
		createBtn.addEventListener("click", () => void this.createRegion(
			nameInput.value.trim(),
			Number(colsInput.value) || 20,
			Number(rowsInput.value) || 16,
		));
	}

	private slugify(name: string): string {
		return name.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
	}

	private async renameRegion(raw: string, btn: HTMLButtonElement, input: HTMLInputElement): Promise<void> {
		const newName = this.slugify(raw);
		if (!newName || newName === this.view.activeRegionName) return;
		if (this.plugin.settings.regions.some(r => r.name === newName)) {
			new Notice(`Region "${newName}" already exists.`); return;
		}
		btn.setText("Renaming…");
		btn.disabled = true;
		input.disabled = true;
		const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
		const oldPath = hexFolder ? `${hexFolder}/${this.view.activeRegionName}` : this.view.activeRegionName;
		const newPath = hexFolder ? `${hexFolder}/${newName}` : newName;
		const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
		if (oldFolder instanceof TFolder) {
			try { await this.app.fileManager.renameFile(oldFolder, newPath); }
			catch (e) {
				new Notice(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
				btn.setText("Rename");
				btn.disabled = false;
				input.disabled = false;
				return;
			}
		}
		const region = this.plugin.getRegion(this.view.activeRegionName);
		if (region) region.name = newName;
		if (this.plugin.settings.defaultRegion === this.view.activeRegionName) {
			this.plugin.settings.defaultRegion = newName;
		}
		this.view.activeRegionName = newName;
		await this.plugin.saveSettings();
		this.onChanged();
		this.render();
	}

	private async createRegion(raw: string, cols: number, rows: number): Promise<void> {
		const name = this.slugify(raw);
		if (!name) { new Notice("Enter a region name."); return; }
		if (this.plugin.settings.regions.some(r => r.name === name)) {
			new Notice(`Region "${name}" already exists.`); return;
		}
		const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
		const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			try { await this.app.vault.createFolder(folderPath); } catch { /* exists */ }
		}
		this.plugin.settings.regions.push({
			name, gridSize: { cols, rows }, gridOffset: { x: 0, y: 0 }, roadChains: [], riverChains: [],
		});
		this.view.activeRegionName = name;
		await this.plugin.saveSettings();
		this.onChanged();
		this.close();
		// Auto-generate all hex notes for the new region in the background
		const xs = Array.from({ length: cols }, (_, i) => i);
		const ys = Array.from({ length: rows }, (_, i) => i);
		const created = await this.plugin.generateHexNotes(name, xs, ys);
		if (created > 0) new Notice(`Duckmage: generated ${created} hex note${created !== 1 ? "s" : ""} for "${name}".`);
	}

	onClose(): void { this.contentEl.empty(); }
}

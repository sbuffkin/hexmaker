import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder, getIconUrl } from "./utils";
import { getTerrainFromFile, getIconOverrideFromFile } from "./frontmatter";
import { HexEditorModal } from "./HexEditorModal";
import { VIEW_TYPE_HEX_MAP } from "./constants";

export class HexMapView extends ItemView {
	plugin: DuckmagePlugin;
	private zoom = 1;
	private panX = 0;
	private panY = 0;
	private viewportEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DuckmagePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_HEX_MAP; }
	getDisplayText(): string { return "Hex map"; }

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("duckmage-hex-map-container");

		this.viewportEl = contentEl.createDiv({ cls: "duckmage-hex-map-viewport" });
		this.applyTransform();

		// ── Zoom (scroll wheel, no modifier required) ──────────────────────────
		this.registerDomEvent(contentEl, "wheel", (e: WheelEvent) => {
			e.preventDefault();
			const rect = contentEl.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			const newZoom = Math.min(5, Math.max(0.2, this.zoom * factor));
			this.panX = cx - (cx - this.panX) * (newZoom / this.zoom);
			this.panY = cy - (cy - this.panY) * (newZoom / this.zoom);
			this.zoom = newZoom;
			this.applyTransform();
		}, { passive: false });

		// ── Pan (click-drag) ───────────────────────────────────────────────────
		let isDragging = false;
		let hasDragged = false;
		let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

		this.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
			if (e.button !== 0) return;
			isDragging = true;
			hasDragged = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			panStartX = this.panX;
			panStartY = this.panY;
			this.viewportEl?.addClass("is-dragging");
		});

		this.registerDomEvent(document, "mousemove", (e: MouseEvent) => {
			if (!isDragging) return;
			const dx = e.clientX - dragStartX;
			const dy = e.clientY - dragStartY;
			if (!hasDragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) hasDragged = true;
			if (hasDragged) {
				this.panX = panStartX + dx;
				this.panY = panStartY + dy;
				this.applyTransform();
			}
		});

		this.registerDomEvent(document, "mouseup", () => {
			isDragging = false;
			this.viewportEl?.removeClass("is-dragging");
		});

		// Swallow clicks that ended a drag so hex click-handlers don't fire
		this.registerDomEvent(contentEl, "click", (e: MouseEvent) => {
			if (hasDragged) { e.stopPropagation(); hasDragged = false; }
		}, { capture: true } as AddEventListenerOptions);

		this.createExpandButtons(contentEl);
		this.renderGrid();
	}

	private createExpandButtons(container: HTMLElement): void {
		const dirs = [
			{
				cls: "duckmage-expand-top",
				action: async () => {
					this.plugin.settings.gridOffset.y--;
					this.plugin.settings.gridSize.rows++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-bottom",
				action: async () => {
					this.plugin.settings.gridSize.rows++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-left",
				action: async () => {
					this.plugin.settings.gridOffset.x--;
					this.plugin.settings.gridSize.cols++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-right",
				action: async () => {
					this.plugin.settings.gridSize.cols++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
		];
		for (const { cls, action } of dirs) {
			const btn = container.createEl("button", { cls: `duckmage-expand-btn ${cls}`, text: "+" });
			btn.addEventListener("click", action);
		}
	}

	private applyTransform(): void {
		if (this.viewportEl) {
			this.viewportEl.style.transform =
				`translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
		}
	}

	renderGrid(terrainOverrides?: Map<string, string | null>): void {
		if (!this.viewportEl) return;
		this.viewportEl.empty();

		const gap = this.plugin.settings.hexGap?.trim() || "0.15";
		this.viewportEl.style.setProperty("--duckmage-hex-gap", /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap);

		const { cols, rows } = this.plugin.settings.gridSize;
		const { x: ox, y: oy } = this.plugin.settings.gridOffset;
		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		const palette = this.plugin.settings.terrainPalette ?? [];
		const gridContainer = this.viewportEl.createDiv({ cls: "duckmage-hex-map-grid" });

		for (let j = 0; j < rows; j++) {
			const y = oy + j;
			// Stagger based on the actual y coordinate so adding rows above never shifts the pattern
			const rowEl = gridContainer.createDiv({
				cls: `duckmage-hex-row${y % 2 !== 0 ? " duckmage-hex-row-offset" : ""}`,
			});
			for (let i = 0; i < cols; i++) {
				const x = ox + i;
				const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
				const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
				const terrainKey = terrainOverrides?.has(path)
					? terrainOverrides.get(path)!
					: getTerrainFromFile(this.app, path);
				const terrainEntry = terrainKey != null ? palette.find(p => p.name === terrainKey) : undefined;

				const hexEl = rowEl.createDiv({
					cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
					attr: { "data-x": String(x), "data-y": String(y) },
				});
				hexEl.tabIndex = -1;

				if (terrainEntry?.color) hexEl.style.backgroundColor = terrainEntry.color;

				const iconOverride = getIconOverrideFromFile(this.app, path);
				const iconToShow = iconOverride ?? terrainEntry?.icon;
				if (iconToShow) {
					const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
					img.src = getIconUrl(this.plugin, iconToShow);
					img.alt = terrainEntry?.name ?? "";
				}

				hexEl.createSpan({ cls: "duckmage-hex-label", text: `${x},${y}` });
				if (exists) hexEl.createSpan({ cls: "duckmage-hex-dot" });

				hexEl.addEventListener("click", () => this.onHexClick(x, y));
				hexEl.addEventListener("contextmenu", (evt) => this.onHexContextMenu(evt, x, y));
			}
		}
	}

	private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
		evt.preventDefault();
		new HexEditorModal(this.app, this.plugin, x, y, (overrides) => this.renderGrid(overrides)).open();
	}

	private async onHexClick(x: number, y: number): Promise<void> {
		const path = this.plugin.hexPath(x, y);
		const abstract = this.app.vault.getAbstractFileByPath(path);
		let fileToOpen: TFile | null = abstract instanceof TFile ? abstract : null;

		if (!fileToOpen) {
			fileToOpen = await this.plugin.createHexNote(x, y);
			if (fileToOpen) this.renderGrid();
			else return;
		}

		await this.app.workspace.getLeaf(false).openFile(fileToOpen);
	}
}

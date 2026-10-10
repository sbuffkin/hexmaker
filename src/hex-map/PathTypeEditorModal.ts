import { App, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathAutoRoute, PathType, PathLineStyle, PathRouting } from "../types";
import { buildPathPreviewSvg } from "./PathPickerModal";
import { pathAvoidsImpassable, pathMeanders } from "../impassable";
import { countPathsOfType, removePathTypeFromChains, renamePathTypeInChains } from "../paths/typeRefs";

/** One line on what auto-route does with a type (the preview can't show it). */
export function pathBehaviourSummary(pt: Pick<PathType, "avoidImpassable" | "autoRoute">): string {
	const route = pt.autoRoute === "winding" ? "winds" : "keeps direct";
	return pt.avoidImpassable
		? `Auto-route ${route} and goes around impassable terrain.`
		: `Auto-route ${route} and crosses impassable terrain.`;
}

export class PathTypeEditorModal extends HexmakerModal {
	private pendingName: string;
	private pendingColor: string;
	private pendingWidth: number;
	private pendingLineStyle: PathLineStyle;
	private pendingRouting: PathRouting;
	private pendingAvoid: boolean;
	private pendingAutoRoute: PathAutoRoute;
	private readonly originalName: string;
	private savedOrDeleted = false;

	constructor(
		app: App,
		private plugin: HexmakerPlugin,
		/** The palette this type belongs to; only maps on it are touched. */
		private paletteName: string,
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
		this.pendingAvoid      = pathAvoidsImpassable(entry);
		this.pendingAutoRoute  = pathMeanders(entry) ? "winding" : "direct";
	}

	onOpen(): void {
		this.makeDraggable();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Edit path type" });

		// Live preview: how the line is drawn, plus what auto-route does
		// (which the drawing can't show).
		const previewDiv = contentEl.createDiv({ cls: "duckmage-path-preview duckmage-path-editor-preview" });
		const behaviourEl = contentEl.createDiv({ cls: "duckmage-path-editor-behaviour" });
		const redrawPreview = () => {
			previewDiv.empty();
			previewDiv.appendChild(buildPathPreviewSvg({
				name: this.pendingName,
				color: this.pendingColor,
				width: this.pendingWidth,
				lineStyle: this.pendingLineStyle,
				routing: this.pendingRouting,
				avoidImpassable: this.pendingAvoid,
				autoRoute: this.pendingAutoRoute,
			}));
			behaviourEl.setText(pathBehaviourSummary({ avoidImpassable: this.pendingAvoid, autoRoute: this.pendingAutoRoute }));
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
			.setDesc("How the line runs between hexes: a smooth curve through hex centres, a smooth curve through the middles of the edges between hexes, or straight along the hex borders.")
			.addDropdown(dd =>
				dd
					.addOption("through",  "Through hex centres")
					.addOption("meander",  "Across edge middles")
					.addOption("edge",     "Along hex borders")
					.setValue(this.pendingRouting)
					.onChange(value => {
						this.pendingRouting = value as PathRouting;
						redrawPreview();
					}),
			);

		new Setting(contentEl)
			.setName("Avoid impassable terrain")
			.setDesc("On: auto-route goes around impassable terrain (water, by default), and paths carried into generated submaps keep off water. Off: it goes anywhere, and submap paths prefer low ground and water, like a river. Drawing hex by hex ignores this.")
			.addToggle(toggle =>
				toggle
					.setValue(this.pendingAvoid)
					.onChange(value => { this.pendingAvoid = value; redrawPreview(); }),
			);

		new Setting(contentEl)
			.setName("Auto-route")
			.setDesc("Direct keeps the route close to the straight line between the two hexes you click. Winding lets it wander. Also applies to paths carried into generated submaps.")
			.addDropdown(dd =>
				dd
					.addOption("direct",  "Direct")
					.addOption("winding", "Winding")
					.setValue(this.pendingAutoRoute)
					.onChange(value => {
						this.pendingAutoRoute = value as PathAutoRoute;
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

			const pathCount = this.plugin.mapsOnPalette(this.paletteName).reduce(
				(sum, r) => sum + countPathsOfType(this.plugin.paths.storedPaths(r), this.originalName),
				0,
			);
			confirmDiv = contentEl.createDiv({ cls: "duckmage-terrain-editor-confirm" });
			if (pathCount > 0) {
				confirmDiv.createEl("p", {
					text: `This type is used by ${pathCount} path(s). Deleting it will remove those paths. Continue?`,
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
		this.entry.avoidImpassable = this.pendingAvoid;
		this.entry.autoRoute  = this.pendingAutoRoute;

		// If name changed, point every path of this type at the new name.
		// PHASE-3: while maps store pathChains (src/paths/mapPaths.ts) this edits
		// the chains; then renamePathTypeInPaths(map.paths, …).
		if (nameChanged) {
			for (const region of this.plugin.mapsOnPalette(this.paletteName)) {
				renamePathTypeInChains(region.pathChains, this.originalName, this.pendingName);
			}
		}

		await this.plugin.saveSettings();
		this.onSave();
	}

	private async doDelete(): Promise<void> {
		if (this.savedOrDeleted) return;
		this.savedOrDeleted = true;

		// Remove from the palette's path types
		const list = this.plugin.getPathTypes(this.paletteName);
		const idx = list.indexOf(this.entry);
		if (idx !== -1) list.splice(idx, 1);

		// Remove the paths of this type on maps that use this palette.
		// PHASE-3: then removePathTypeFromPaths(map.paths, …).
		for (const region of this.plugin.mapsOnPalette(this.paletteName)) {
			region.pathChains = removePathTypeFromChains(region.pathChains, this.originalName);
		}

		await this.plugin.saveSettings();
		this.onDelete();
	}
}

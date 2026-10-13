import { App, Notice, Setting } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathAutoRoute, PathType, PathLineStyle, PathRouting } from "../types";
import { buildPathPreviewSvg } from "./PathPickerModal";
import { pathAvoidsImpassable, pathMeanders } from "../impassable";
import { countPathsOfType, removePathTypeFromChains, renamePathTypeInChains } from "../paths/typeRefs";
import { renderLabeledSlider, sliderFormat } from "../ui/sliders";
import { renderSaveStatusLine } from "../ui/saveStatusLine";

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
	private pendingCarves: string;
	private pendingCarveWidth: number;
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
		this.pendingCarves     = entry.carves ?? "";
		this.pendingCarveWidth = entry.carveWidth === 1 ? 1 : 0;
	}

	protected surfaceId = "PathType";

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

		renderLabeledSlider(new Setting(contentEl).setName("Width").controlEl, {
			label: "", ariaLabel: "Width", min: 1, max: 10, step: 1, value: this.pendingWidth,
			format: sliderFormat.px,
			onInput: value => {
				this.pendingWidth = value;
				redrawPreview();
			},
		});

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

		// Carving is Advanced, its width Debug (placement: PathType.carves / carveWidth).
		const carves = new Setting(contentEl)
			.setName("Carves terrain")
			.setDesc("When you confirm an overworld path of this type into its regions, the hexes it crosses there become this: a terrain's name, or a terrain type such as water (the palette's first water terrain). Leave empty to keep the terrain. Locked hexes are never changed.")
			.addText(text =>
				text
					.setPlaceholder("None")
					.setValue(this.pendingCarves)
					.onChange(value => { this.pendingCarves = value.trim(); }),
			);
		this.place("PathType.carves", carves.settingEl);

		const carveWidth = new Setting(contentEl)
			.setName("Carve width")
			.setDesc("0: only the path's hexes. 1: those and the hexes beside them.")
			.addDropdown(dd =>
				dd
					.addOption("0", "0")
					.addOption("1", "1")
					.setValue(String(this.pendingCarveWidth))
					.onChange(value => { this.pendingCarveWidth = value === "1" ? 1 : 0; }),
			);
		this.place("PathType.carveWidth", carveWidth.settingEl);

		// Autosaves (owner Q5): × closes and saves, no Save button; the shared status line says so.
		renderSaveStatusLine(contentEl, { title: "Saves when you close this (×). There is no Save button." });
		// Delete: no confirm (owner Q6); the notice offers Undo.
		this.footer({
			destructive: { text: "Delete", onClick: () => {
				void (async () => {
					await this.doDelete();
					this.close();
				})();
			} },
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
		if (this.pendingCarves) this.entry.carves = this.pendingCarves;
		else delete this.entry.carves;
		this.entry.carveWidth = this.pendingCarveWidth;

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

		const pathCount = this.plugin.mapsOnPalette(this.paletteName).reduce(
			(sum, r) => sum + countPathsOfType(this.plugin.paths.storedPaths(r), this.originalName),
			0,
		);

		// Remove from the palette's path types
		const list = this.plugin.getPathTypes(this.paletteName);
		const entry = this.entry;
		const idx = list.indexOf(entry);
		if (idx !== -1) list.splice(idx, 1);

		// Remove the paths of this type on maps that use this palette.
		// PHASE-3: then removePathTypeFromPaths(map.paths, …).
		const before = this.plugin.mapsOnPalette(this.paletteName).map((region) => ({ region, chains: region.pathChains }));
		for (const { region } of before) {
			region.pathChains = removePathTypeFromChains(region.pathChains, this.originalName);
		}

		await this.plugin.saveSettings();
		this.onDelete();

		// The safety catch instead of a confirm: Undo puts the type and its paths back.
		const plugin = this.plugin;
		const onDelete = this.onDelete;
		const msg = createFragment((frag) => {
			frag.appendText(`Deleted path type "${this.originalName}"${pathCount ? ` and its ${pathCount} path${pathCount === 1 ? "" : "s"}` : ""}. `);
			frag.createEl("button", { text: "Undo" }).addEventListener("click", () => {
				const now = plugin.getPathTypes(this.paletteName);
				if (!now.includes(entry)) now.splice(Math.min(Math.max(0, idx), now.length), 0, entry);
				for (const { region, chains } of before) region.pathChains = chains;
				void plugin.saveSettings().then(() => onDelete());
				notice.hide();
			});
		});
		const notice = new Notice(msg, 10000);
	}
}

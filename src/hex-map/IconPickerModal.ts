import { App } from "obsidian";
import { DuckmageModal } from "../DuckmageModal";
import type DuckmagePlugin from "../DuckmagePlugin";
import { getIconUrl } from "../utils";

export class IconPickerModal extends DuckmageModal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private onSelect: (iconName: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		this.makeDraggable();
		contentEl.createEl("h2", { text: "Paint icon" });

		const section = contentEl.createDiv({ cls: "duckmage-editor-section" });
		const grid = section.createDiv({ cls: "duckmage-icon-picker" });

		// Remove icon option
		const clearBtn = grid.createDiv({ cls: "duckmage-icon-option" });
		clearBtn.createDiv({ cls: "duckmage-icon-preview duckmage-icon-preview-clear" });
		clearBtn.createSpan({ text: "Remove", cls: "duckmage-icon-option-name" });
		clearBtn.addEventListener("click", () => {
			this.onSelect(null);
			this.close();
		});

		for (const icon of this.plugin.availableIcons) {
			const label = icon.replace(/^bw-/, "").replace(/\.(png|jpg|jpeg|gif|svg|webp)$/i, "").replace(/-/g, " ");
			const btn = grid.createDiv({ cls: "duckmage-icon-option" });
			const preview = btn.createDiv({ cls: "duckmage-icon-preview" });
			const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
			img.src = getIconUrl(this.plugin, icon);
			img.alt = label;
			btn.createSpan({ text: label, cls: "duckmage-icon-option-name" });
			btn.addEventListener("click", () => {
				this.onSelect(icon);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

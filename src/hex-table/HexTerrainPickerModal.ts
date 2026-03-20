import { App } from "obsidian";
import type DuckmagePlugin from "../DuckmagePlugin";
import { DuckmageModal } from "../DuckmageModal";
import { getIconUrl, normalizeFolder, createIconEl } from "../utils";
import { setTerrainInFile } from "../frontmatter";

export class HexTerrainPickerModal extends DuckmageModal {
  constructor(
    app: App,
    private plugin: DuckmagePlugin,
    private hexPath: string,
    private currentTerrain: string | null,
    private onPicked: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Select terrain");
    const { contentEl } = this;
    contentEl.addClass("duckmage-terrain-picker-modal");

    const grid = contentEl.createDiv({
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full",
    });
    for (const entry of this.plugin.settings.terrainPalette) {
      const btn = grid.createDiv({
        cls: `duckmage-terrain-option${entry.name === this.currentTerrain ? " is-selected" : ""}`,
      });
      const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
      preview.style.backgroundColor = entry.color;
      if (entry.icon) {
        createIconEl(preview, getIconUrl(this.plugin, entry.icon), entry.name, entry.iconColor, "duckmage-terrain-preview-icon");
      }
      btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });
      btn.addEventListener("click", async () => {
        if (!this.app.vault.getAbstractFileByPath(this.hexPath)) {
          const basename = this.hexPath.replace(/\.md$/, "").split("/").pop()!;
          const [hx, hy] = basename.split("_").map(Number);
          const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
          const relative = hexFolder
            ? this.hexPath.slice(hexFolder.length + 1)
            : this.hexPath;
          const regionName = relative.split("/")[0];
          await this.plugin.createHexNote(hx, hy, regionName);
        }
        await setTerrainInFile(this.app, this.hexPath, entry.name);
        this.onPicked();
        this.close();
      });
    }

    if (this.currentTerrain) {
      const clearBtn = contentEl.createEl("button", {
        text: "Clear terrain",
        cls: "duckmage-clear-btn mod-warning",
      });
      clearBtn.addEventListener("click", async () => {
        await setTerrainInFile(this.app, this.hexPath, null);
        this.onPicked();
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

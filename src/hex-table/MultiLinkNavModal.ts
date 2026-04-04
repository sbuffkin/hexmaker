import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

export class MultiLinkNavModal extends HexmakerModal {
  constructor(
    app: App,
    private title: string,
    private linkTargets: string[],
    private sourcePath: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    contentEl.addClass("duckmage-link-picker-modal");
    const list = contentEl.createEl("ul", { cls: "duckmage-link-picker-list" });
    for (const target of this.linkTargets) {
      const li = list.createEl("li", {
        cls: "duckmage-link-picker-item",
        text: target,
      });
      li.addEventListener("click", () => {
        const file = this.app.metadataCache.getFirstLinkpathDest(
          target,
          this.sourcePath,
        );
        if (file instanceof TFile) {
          void this.app.workspace.getLeaf().openFile(file);
          this.close();
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

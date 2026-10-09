import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

/** Asks before doing something that can't be taken back from the page. */
export class ConfirmModal extends HexmakerModal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly message: string,
    private readonly confirmText: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(this.heading);
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const confirm = row.createEl("button", { text: this.confirmText, cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
